"""Per-user data: history, favourites, song requests and preferences.

Each test gets an empty database (SQLite, and Postgres when configured) and a
signed-in session, with Spotify stubbed out.
"""
import pytest

import app as app_module
import db
from conftest import FakeResponse


def sign_in(client, user_id='cherry'):
    with client.session_transaction() as session:
        session['access_token'] = 'test-token'
        session['user_id'] = user_id


@pytest.fixture
def user(client, database):
    sign_in(client)
    return client


def track(track_id='T1', **overrides):
    details = {'track_id': track_id, 'song': f'Song {track_id}',
               'artist': 'An Artist', 'album_art': f'https://i.scdn.co/{track_id}',
               'source_lang': 'FR', 'target_lang': 'EN'}
    details.update(overrides)
    return details


def listen(client, track_id='T1', **overrides):
    return client.post('/history', json=track(track_id, **overrides))


def history(client, query=''):
    return client.get('/history' + query).get_json()


@pytest.fixture
def clock(monkeypatch):
    """Lets a test step time forward, so 'newest first' is deterministic."""
    now = [1_800_000_000]
    monkeypatch.setattr(db, 'now', lambda: now[0])

    def tick(seconds=60):
        now[0] += seconds
    return tick


# --- signing in ---

@pytest.mark.parametrize('method, url', [
    ('get', '/history'), ('post', '/history'), ('get', '/favourites'),
    ('put', '/favourites/T1'), ('delete', '/favourites/T1'),
    ('post', '/song-requests'), ('get', '/prefs'), ('put', '/prefs'),
])
def test_user_data_requires_sign_in(client, database, method, url):
    assert getattr(client, method)(url, json={}).status_code == 401


def test_user_is_looked_up_from_spotify_once(client, database, spotify, monkeypatch):
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse(200, {'id': 'cherry', 'display_name': 'Cherry'})
    monkeypatch.setattr(spotify, 'spotify_get', fake_get)

    client.get('/history')
    client.get('/history')
    assert calls == ['https://api.spotify.com/v1/me']
    with db.connect() as conn:
        assert conn.execute('SELECT display_name FROM users').fetchone()[0] == 'Cherry'


def test_spotify_not_answering_me_means_signed_out(client, database, spotify, monkeypatch):
    monkeypatch.setattr(spotify, 'spotify_get', lambda url, **kw: FakeResponse(503))
    assert client.get('/history').status_code == 401


def test_a_new_login_forgets_the_previous_account(client, database, monkeypatch):
    """Disconnect, then connect a different Spotify account in the same browser."""
    sign_in(client, 'old-account')
    monkeypatch.setattr(app_module.requests, 'post', lambda url, **kw: FakeResponse(
        200, {'access_token': 'a', 'refresh_token': 'r'}))
    monkeypatch.setattr(app_module, 'spotify_get', lambda url, **kw: FakeResponse(
        200, {'id': 'new-account', 'display_name': 'New'}))

    location = client.get('/login').headers['Location']
    state = location.split('state=')[1].split('&')[0]
    client.get(f'/callback?code=abc&state={state}')
    with client.session_transaction() as session:
        assert session['user_id'] == 'new-account'


# --- Recently Translated ---

def test_history_is_newest_first(user, clock):
    listen(user, 'A')
    clock()
    listen(user, 'B')
    assert [t['track_id'] for t in history(user)['tracks']] == ['B', 'A']


def test_listening_again_moves_a_song_up_and_counts_it(user, clock):
    listen(user, 'A')
    clock()
    listen(user, 'B')
    clock()
    listen(user, 'A')
    tracks = history(user)['tracks']
    assert [t['track_id'] for t in tracks] == ['A', 'B']
    assert tracks[0]['play_count'] == 2


def test_history_carries_what_the_page_shows(user):
    listen(user, 'A')
    assert history(user)['tracks'][0] == {
        'track_id': 'A', 'song': 'Song A', 'artist': 'An Artist',
        'album_art': 'https://i.scdn.co/A', 'source_lang': 'FR',
        'target_lang': 'EN', 'play_count': 1,
        'last_played_at': history(user)['tracks'][0]['last_played_at'],
    }


def test_history_filters_by_language_and_counts_each(user):
    listen(user, 'A', source_lang='FR')
    listen(user, 'B', source_lang='HI')
    listen(user, 'C', source_lang='FR')
    everything = history(user)
    assert everything['total'] == 3
    assert everything['languages'] == [{'lang': 'FR', 'count': 2},
                                       {'lang': 'HI', 'count': 1}]
    assert [t['track_id'] for t in history(user, '?lang=HI')['tracks']] == ['B']


def test_history_pages_but_still_counts_everything(user):
    for i in range(5):
        listen(user, f'T{i}')
    page = history(user, '?limit=2')
    assert len(page['tracks']) == 2
    assert page['total'] == 5


def test_history_is_private_to_each_user(client, database):
    sign_in(client, 'cherry')
    listen(client, 'A')
    sign_in(client, 'someone-else')
    assert history(client)['tracks'] == []


@pytest.mark.parametrize('query', ['?lang=fr;drop', '?limit=lots'])
def test_history_rejects_bad_queries(user, query):
    assert user.get('/history' + query).status_code == 400


@pytest.mark.parametrize('overrides', [
    {'track_id': '../../me'},
    {'song': ''},
    {'artist': None},
    {'song': 'x' * 301},
    {'album_art': 'javascript:alert(1)'},
    {'album_art': 'http://plain.example/art.jpg'},
    {'source_lang': 'french'},
])
def test_history_rejects_bad_track_details(user, overrides):
    assert listen(user, **overrides).status_code == 400


def test_history_rejects_a_body_that_isnt_an_object(user):
    assert user.post('/history', json=['T1']).status_code == 400


# --- favourites ---

def favourite(client, track_id='T1', **overrides):
    body = track(track_id, **overrides)
    body.pop('target_lang')
    return client.put(f'/favourites/{track_id}', json=body)


def favourites(client):
    return client.get('/favourites').get_json()['tracks']


def test_favourites_round_trip(user):
    assert favourite(user, 'A', album='An Album', duration_ms=210000).status_code == 200
    saved = favourites(user)
    assert len(saved) == 1
    assert saved[0]['album'] == 'An Album'
    assert saved[0]['duration_ms'] == 210000


def test_favourites_are_newest_first(user, clock):
    favourite(user, 'A')
    clock()
    favourite(user, 'B')
    assert [t['track_id'] for t in favourites(user)] == ['B', 'A']


def test_saving_again_keeps_its_place(user, clock):
    favourite(user, 'A')
    clock()
    favourite(user, 'B')
    clock()
    favourite(user, 'A', song='Renamed')
    saved = favourites(user)
    assert [t['track_id'] for t in saved] == ['B', 'A']
    assert saved[1]['song'] == 'Renamed'


def test_unfavourite(user):
    favourite(user, 'A')
    assert user.delete('/favourites/A').status_code == 204
    assert favourites(user) == []


def test_unfavouriting_something_not_saved_is_fine(user):
    assert user.delete('/favourites/NOPE').status_code == 204


def test_favourites_are_private_to_each_user(client, database):
    sign_in(client, 'cherry')
    favourite(client, 'A')
    sign_in(client, 'someone-else')
    assert favourites(client) == []
    client.delete('/favourites/A')   # can't remove someone else's either
    sign_in(client, 'cherry')
    assert len(favourites(client)) == 1


def test_favourite_rejects_a_bad_track_id(user):
    assert favourite(user, 'bad id').status_code in (400, 404)


# --- song requests ---

def test_requesting_a_song_twice_stores_it_once(user):
    for _ in range(2):
        resp = user.post('/song-requests', json=track('A'))
        assert resp.get_json() == {'requested': True}
    with db.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM song_requests').fetchone()[0] == 1


def test_song_request_needs_the_track_details(user):
    assert user.post('/song-requests', json={'track_id': 'A'}).status_code == 400


# --- preferences ---

def test_prefs_default_to_english_with_translation_on(user):
    assert user.get('/prefs').get_json() == {'target_lang': 'EN', 'auto_translate': True}


def test_prefs_update_only_what_is_sent(user):
    user.put('/prefs', json={'auto_translate': False})
    resp = user.put('/prefs', json={'target_lang': 'FR'})
    assert resp.get_json() == {'target_lang': 'FR', 'auto_translate': False}
    assert user.get('/prefs').get_json() == {'target_lang': 'FR', 'auto_translate': False}


@pytest.mark.parametrize('body', [
    {'target_lang': 'XX'},
    {'target_lang': "EN'; DROP TABLE users; --"},
    {'auto_translate': 'yes'},
    {'auto_translate': 1},
    ['auto_translate'],
])
def test_prefs_reject_bad_values(user, body):
    assert user.put('/prefs', json=body).status_code == 400


def test_prefs_ignore_unknown_fields(user):
    resp = user.put('/prefs', json={'spotify_id': 'someone-else', 'auto_translate': False})
    assert resp.status_code == 200
    with db.connect() as conn:
        ids = [row[0] for row in conn.execute('SELECT spotify_id FROM users').fetchall()]
    assert ids == ['cherry']
