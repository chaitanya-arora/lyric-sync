"""Route tests with Spotify stubbed out.

No network and no credentials: every test swaps the spotify_* helpers for a
canned response, so what's under test is our own handling of them.
"""
from urllib.parse import parse_qs, urlparse

import pytest
import requests

from conftest import FakeResponse, make_track


# --- /context ---

def recent_feed():
    """A recently-played feed with the awkward cases Spotify really returns:
    the track that is still playing, and the same track twice in a row."""
    return {'items': [
        {'track': make_track('CUR', 'Currently Playing')},
        {'track': make_track('B', 'Song B')},
        {'track': make_track('B', 'Song B')},
        {'track': make_track('A', 'Song A')},
        {'track': make_track('Z', 'Song Z')},
    ]}


@pytest.fixture
def context_client(client, spotify, monkeypatch):
    def fake_get(url, **kwargs):
        if 'queue' in url:
            return FakeResponse(200, {'queue': []})
        return FakeResponse(200, recent_feed())

    monkeypatch.setattr(spotify, 'spotify_get', fake_get)
    return client


def previous_songs(resp):
    return [track['song'] for track in resp.get_json()['previous']]


def test_context_excludes_the_playing_track(context_client):
    """Spotify logs the playing track on replays and seeks; it belongs in the
    player, not in "Recently Played"."""
    songs = previous_songs(context_client.get('/context?current=CUR'))
    assert 'Currently Playing' not in songs


def test_context_collapses_duplicate_entries(context_client):
    songs = previous_songs(context_client.get('/context?current=CUR'))
    assert songs.count('Song B') == 1


def test_context_returns_oldest_first(context_client):
    """The sidebar reads chronologically down into "Playing Next"."""
    assert previous_songs(context_client.get('/context?current=CUR')) == ['Song A', 'Song B']


def test_context_works_without_a_current_track(context_client):
    """First load has nothing playing yet — the param is optional."""
    resp = context_client.get('/context')
    assert resp.status_code == 200
    assert previous_songs(resp) == ['Song B', 'Currently Playing']


def test_context_is_not_cacheable(context_client):
    """It's polled, so a cached copy would defeat the point."""
    assert context_client.get('/context').headers.get('Cache-Control') == 'no-store'


def test_context_requires_authentication(client):
    assert client.get('/context').status_code == 401


# --- /playback: seek ---

@pytest.fixture
def playback(client, spotify, monkeypatch):
    """Client plus the list of Spotify URLs the request ended up calling."""
    calls = []

    def record(url, **kwargs):
        calls.append((url, kwargs.get('json')))
        return FakeResponse(204)

    monkeypatch.setattr(spotify, 'spotify_put', record)
    monkeypatch.setattr(spotify, 'spotify_post', record)
    return client, calls


def test_seek_forwards_the_position(playback):
    client, calls = playback
    resp = client.post('/playback', json={'action': 'seek', 'position_ms': 42000})
    assert resp.status_code == 200
    assert calls[-1][0].endswith('/me/player/seek?position_ms=42000')


def test_seek_to_zero_is_allowed(playback):
    """Rewinding to the very start is a legitimate seek, not a falsy value."""
    client, calls = playback
    assert client.post('/playback', json={'action': 'seek', 'position_ms': 0}).status_code == 200
    assert calls[-1][0].endswith('position_ms=0')


@pytest.mark.parametrize('bad_position', [
    -1,        # negative
    '5000',    # string
    1.5,       # float
    None,      # missing
    True,      # bool is an int subclass in Python
])
def test_seek_rejects_invalid_positions(playback, bad_position):
    client, calls = playback
    resp = client.post('/playback', json={'action': 'seek', 'position_ms': bad_position})
    assert resp.status_code == 400
    assert calls == [], f'{bad_position!r} was forwarded to Spotify'


def test_unknown_action_is_rejected(playback):
    client, calls = playback
    assert client.post('/playback', json={'action': 'nonsense'}).status_code == 400
    assert calls == []


# --- /playback: why it failed ---

@pytest.fixture
def failing_playback(client, spotify, monkeypatch):
    """Make every playback command fail with the given response.

    The device lookup is stubbed empty as well: a no-active-device failure now
    triggers one, and it must never reach the network from a test.
    """
    def fail_with(response):
        monkeypatch.setattr(spotify, 'spotify_put', lambda url, **kw: response)
        monkeypatch.setattr(spotify, 'spotify_post', lambda url, **kw: response)
        monkeypatch.setattr(spotify, 'spotify_get',
                            lambda url, **kw: FakeResponse(200, {'devices': []}))
        return client.post('/playback', json={'action': 'play'})

    return fail_with


def test_no_active_device_is_reported(failing_playback):
    """What Spotify returns once you close it everywhere."""
    resp = failing_playback(FakeResponse(404, {'error': {
        'status': 404,
        'message': 'Player command failed: No active device found',
        'reason': 'NO_ACTIVE_DEVICE',
    }}))
    assert resp.status_code == 409
    assert resp.get_json()['reason'] == 'no_active_device'


def test_no_active_device_reason_honoured_on_other_statuses(failing_playback):
    resp = failing_playback(FakeResponse(403, {'error': {'reason': 'NO_ACTIVE_DEVICE'}}))
    assert resp.get_json()['reason'] == 'no_active_device'


def test_premium_required_is_reported(failing_playback):
    resp = failing_playback(FakeResponse(403, {'error': {'reason': 'PREMIUM_REQUIRED'}}))
    assert resp.status_code == 403
    assert resp.get_json()['reason'] == 'premium_required'


def test_404_without_a_json_body_still_handled(failing_playback):
    """An empty body must not turn a known failure into a 500."""
    resp = failing_playback(FakeResponse(404))
    assert resp.status_code == 409
    assert resp.get_json()['reason'] == 'no_active_device'


def test_unrelated_failure_stays_generic(failing_playback):
    resp = failing_playback(FakeResponse(500))
    assert resp.status_code == 400
    assert 'reason' not in resp.get_json()


def test_missing_response_does_not_crash(client, spotify, monkeypatch):
    """The helpers return None when there's no token — reading .status_code off
    that used to raise AttributeError."""
    monkeypatch.setattr(spotify, 'spotify_put', lambda url, **kw: None)
    assert client.post('/playback', json={'action': 'play'}).status_code == 401


def test_playback_requires_authentication(client):
    assert client.post('/playback', json={'action': 'play'}).status_code == 401


# --- /playback: waking an idle device ---

PHONE = {'id': 'PHONE', 'name': 'Phone', 'is_active': False, 'is_restricted': False}
SPEAKER = {'id': 'SPK', 'name': 'Speaker', 'is_active': True, 'is_restricted': False}
LOCKED_TV = {'id': 'TV', 'name': 'TV', 'is_active': False, 'is_restricted': True}

NO_ACTIVE_DEVICE = FakeResponse(404, {'error': {'status': 404, 'reason': 'NO_ACTIVE_DEVICE'}})


@pytest.fixture
def spotify_with(spotify, monkeypatch):
    """Stub Spotify with a given device list and a queue of command responses.

    Returns the list every Spotify request is recorded into, so a test can check
    what was actually asked of Spotify — including that nothing was.
    """
    def setup(devices, command_responses):
        calls = []
        remaining = list(command_responses)

        def put(url, **kwargs):
            calls.append(('PUT', url, kwargs.get('json')))
            if url.endswith('/me/player'):      # the transfer, not a command
                return FakeResponse(204)
            return remaining.pop(0)

        def post(url, **kwargs):
            calls.append(('POST', url, None))
            return remaining.pop(0)

        def get(url, **kwargs):
            calls.append(('GET', url, None))
            return FakeResponse(200, {'devices': devices})

        monkeypatch.setattr(spotify, 'spotify_put', put)
        monkeypatch.setattr(spotify, 'spotify_post', post)
        monkeypatch.setattr(spotify, 'spotify_get', get)
        return calls

    return setup


def transfers(calls):
    return [payload for method, url, payload in calls if url.endswith('/me/player')]


def test_resume_wakes_an_idle_device(client, spotify_with):
    """The reported case: paused a few minutes, device idle but still listed."""
    calls = spotify_with([PHONE], [NO_ACTIVE_DEVICE])
    resp = client.post('/playback', json={'action': 'play'})
    assert resp.status_code == 200
    assert resp.get_json()['woke_device'] is True
    assert transfers(calls) == [{'device_ids': ['PHONE'], 'play': True}]


def test_prefers_the_device_spotify_marks_active(client, spotify_with):
    calls = spotify_with([PHONE, SPEAKER], [NO_ACTIVE_DEVICE])
    client.post('/playback', json={'action': 'play'})
    assert transfers(calls)[0]['device_ids'] == ['SPK']


def test_restricted_devices_are_never_chosen(client, spotify_with):
    """The Web API can't drive a restricted device, so waking one is pointless."""
    calls = spotify_with([LOCKED_TV], [NO_ACTIVE_DEVICE])
    resp = client.post('/playback', json={'action': 'play'})
    assert resp.status_code == 409
    assert resp.get_json()['reason'] == 'no_active_device'
    assert transfers(calls) == []


def test_no_devices_listed_reports_honestly(client, spotify_with):
    """Spotify closed everywhere — there is genuinely nothing to wake."""
    spotify_with([], [NO_ACTIVE_DEVICE])
    resp = client.post('/playback', json={'action': 'play'})
    assert resp.status_code == 409
    assert resp.get_json()['reason'] == 'no_active_device'


def test_seek_wakes_without_autoplay_then_retries(client, spotify_with):
    """Seeking shouldn't start playback as a side effect of waking a device."""
    calls = spotify_with([PHONE], [NO_ACTIVE_DEVICE, FakeResponse(204)])
    resp = client.post('/playback', json={'action': 'seek', 'position_ms': 30000})
    assert resp.status_code == 200
    assert transfers(calls) == [{'device_ids': ['PHONE'], 'play': False}]
    assert sum(1 for _, url, _ in calls if 'seek' in url) == 2, 'seek was not retried'


def test_successful_command_does_not_look_up_devices(client, spotify_with):
    """Waking is recovery only — the healthy path must cost no extra call."""
    calls = spotify_with([PHONE], [FakeResponse(204)])
    resp = client.post('/playback', json={'action': 'play'})
    assert resp.status_code == 200
    assert 'woke_device' not in resp.get_json()
    assert [c for c in calls if c[0] == 'GET'] == []


# --- /recently-played ---

@pytest.fixture
def history(client, spotify, monkeypatch):
    """Stub the recently-played feed. Spotify returns newest first."""
    def setup(items):
        monkeypatch.setattr(spotify, 'spotify_get',
                            lambda url, **kw: FakeResponse(200, {'items': items}))
        return client
    return setup


def played(track_id, name, at=None):
    return {'track': make_track(track_id, name), 'played_at': at}


def songs_from(resp):
    return [t['song'] for t in resp.get_json()['tracks']]


def test_history_is_newest_first(history):
    """Spotify's own order — the panel shows most recent at the top."""
    client = history([played('C', 'Third'), played('B', 'Second'), played('A', 'First')])
    assert songs_from(client.get('/recently-played')) == ['Third', 'Second', 'First']


def test_history_collapses_repeat_plays(history):
    """A track played three times is one entry, kept at its most recent spot."""
    client = history([played('A', 'On Repeat'), played('A', 'On Repeat'),
                      played('B', 'Something Else'), played('A', 'On Repeat')])
    assert songs_from(client.get('/recently-played')) == ['On Repeat', 'Something Else']


def test_history_carries_what_the_panel_needs(history):
    client = history([played('A', 'A Song', at='2026-09-08T21:00:00Z')])
    track = client.get('/recently-played').get_json()['tracks'][0]
    assert track['track_id'] == 'A'
    assert track['artist'] == 'An Artist'
    assert track['played_at'] == '2026-09-08T21:00:00Z'
    assert track['album_art'].endswith('/A')


def test_history_skips_entries_with_no_track_id(history):
    """Local files and podcast episodes come through without a usable id."""
    broken = {'track': {'id': None, 'name': 'Local File', 'artists': [],
                        'album': {'images': []}, 'duration_ms': 0}}
    client = history([broken, played('A', 'A Real Song')])
    assert songs_from(client.get('/recently-played')) == ['A Real Song']


def test_history_is_not_cacheable(history):
    client = history([played('A', 'A Song')])
    assert client.get('/recently-played').headers.get('Cache-Control') == 'no-store'


def test_history_survives_a_spotify_failure(client, spotify, monkeypatch):
    """An empty list beats a 500 — the panel just shows nothing."""
    monkeypatch.setattr(spotify, 'spotify_get', lambda url, **kw: FakeResponse(503))
    resp = client.get('/recently-played')
    assert resp.status_code == 200
    assert resp.get_json()['tracks'] == []


def test_history_requires_authentication(client):
    assert client.get('/recently-played').status_code == 401


# --- /playback: play a specific track ---

def test_play_track_sends_the_right_uri(playback):
    client, calls = playback
    resp = client.post('/playback', json={'action': 'play_track', 'track_id': '4cOdK2wGLETKBW3PvgPWqT'})
    assert resp.status_code == 200
    url, body = calls[-1]
    assert url.endswith('/me/player/play')
    assert body == {'uris': ['spotify:track:4cOdK2wGLETKBW3PvgPWqT']}


@pytest.mark.parametrize('bad_id', [
    None,                       # missing
    '',                         # empty
    123,                        # not a string
    'abc def',                  # whitespace
    'abc/../../v1/me/player',   # path traversal into the URI
    'abc"]}',                   # trying to break out of the JSON body
])
def test_play_track_rejects_bad_ids(playback, bad_id):
    client, calls = playback
    resp = client.post('/playback', json={'action': 'play_track', 'track_id': bad_id})
    assert resp.status_code == 400
    assert calls == [], f'{bad_id!r} was forwarded to Spotify'


def test_play_track_wakes_an_idle_device_without_resuming_the_old_song(client, spotify_with):
    """Transferring with play=True would restart whatever was paused, not the
    track that was actually clicked."""
    calls = spotify_with([PHONE], [NO_ACTIVE_DEVICE, FakeResponse(204)])
    resp = client.post('/playback', json={'action': 'play_track', 'track_id': 'abc123'})
    assert resp.status_code == 200
    assert transfers(calls) == [{'device_ids': ['PHONE'], 'play': False}]
    plays = [body for _, url, body in calls if url.endswith('/me/player/play')]
    assert plays == [{'uris': ['spotify:track:abc123']}] * 2, plays


# --- /translate ---

FOUND = {'found': True, 'synced': True,
         'lyrics': [{'time_ms': 0, 'text': 'Je vois la vie en rose'}]}
NOT_FOUND = {'found': False, 'message': 'No lyrics found for this track'}
TRANSLATE_URL = '/translate?track_id=T1&song=La+Vie+en+Rose&artist=Edith+Piaf'


class DeepLResponse(FakeResponse):
    text = 'quota exceeded'


@pytest.fixture
def translate(client, spotify, database, monkeypatch):
    """Client with a throwaway cache, LRCLIB and DeepL stubbed.

    Returns (client, stub). Set stub['lyrics'] to what fetch_lyrics returns,
    or to an exception to raise; stub['deepl'] likewise for the DeepL call.
    stub['lyrics_calls'] and stub['deepl_bodies'] record what was asked.
    """
    stub = {'lyrics': FOUND, 'lyrics_calls': 0, 'deepl_bodies': [],
            'deepl': DeepLResponse(200, {'translations': [
                {'text': 'I see life in pink', 'detected_source_language': 'FR'}]})}

    def fake_fetch(song, artist):
        stub['lyrics_calls'] += 1
        if isinstance(stub['lyrics'], Exception):
            raise stub['lyrics']
        return stub['lyrics']

    def fake_post(url, **kwargs):
        stub['deepl_bodies'].append(kwargs.get('json'))
        if isinstance(stub['deepl'], Exception):
            raise stub['deepl']
        return stub['deepl']

    monkeypatch.setattr(spotify, 'fetch_lyrics', fake_fetch)
    monkeypatch.setattr(spotify.requests, 'post', fake_post)
    return client, stub


def test_translate_returns_lines_with_their_translation(translate):
    client, _ = translate
    lyrics = client.get(TRANSLATE_URL).get_json()['lyrics']
    assert lyrics == [{'time_ms': 0, 'original': 'Je vois la vie en rose',
                       'translation': 'I see life in pink',
                       'detected_language': 'FR'}]


def test_translate_tells_deepl_these_are_song_lyrics(translate):
    client, stub = translate
    client.get(TRANSLATE_URL)
    assert 'La Vie en Rose' in stub['deepl_bodies'][0]['context']


def test_translate_serves_repeats_from_the_cache(translate):
    client, stub = translate
    client.get(TRANSLATE_URL)
    second = client.get(TRANSLATE_URL).get_json()
    assert second['cached'] is True
    assert len(stub['deepl_bodies']) == 1


def test_translate_remembers_songs_without_lyrics(translate):
    """A replay of a song LRCLIB had nothing for shouldn't ask it again."""
    client, stub = translate
    stub['lyrics'] = NOT_FOUND
    first = client.get(TRANSLATE_URL)
    second = client.get(TRANSLATE_URL)
    assert first.get_json()['translated'] is False
    assert second.get_json()['translated'] is False
    assert stub['lyrics_calls'] == 1


def test_lyrics_outage_is_retryable_not_a_miss(translate):
    """A timeout used to read as "no lyrics", so the client never retried."""
    client, stub = translate
    stub['lyrics'] = requests.Timeout()
    assert client.get(TRANSLATE_URL).status_code == 502
    stub['lyrics'] = FOUND
    assert client.get(TRANSLATE_URL).get_json()['translated'] is True


def test_deepl_failure_is_retryable_and_hides_detail(translate):
    client, stub = translate
    stub['deepl'] = DeepLResponse(456, {})
    resp = client.get(TRANSLATE_URL)
    assert resp.status_code == 502
    assert 'quota' not in resp.get_data(as_text=True)


def test_deepl_timeout_is_retryable(translate):
    client, stub = translate
    stub['deepl'] = requests.ConnectionError()
    assert client.get(TRANSLATE_URL).status_code == 502



def test_translate_requires_authentication(client):
    """DeepL's quota is shared — anonymous callers mustn't be able to spend it."""
    assert client.get(TRANSLATE_URL).status_code == 401


def test_lyrics_requires_authentication(client):
    assert client.get('/lyrics?song=a&artist=b').status_code == 401


# --- login ---

def login_state(client):
    location = client.get('/login').headers['Location']
    return parse_qs(urlparse(location).query)['state'][0]


def test_login_sends_a_state_to_spotify(client):
    assert len(login_state(client)) >= 16


def test_callback_rejects_a_missing_state(client):
    login_state(client)
    assert client.get('/callback?code=abc').status_code == 400


def test_callback_rejects_a_forged_state(client):
    login_state(client)
    assert client.get('/callback?code=abc&state=forged').status_code == 400


def test_callback_rejects_a_login_this_browser_never_started(client):
    assert client.get('/callback?code=abc&state=anything').status_code == 400


def test_callback_accepts_its_own_state_once(client, monkeypatch):
    import app as app_module
    monkeypatch.setattr(app_module.requests, 'post', lambda url, **kw: FakeResponse(
        200, {'access_token': 'a', 'refresh_token': 'r'}))
    state = login_state(client)
    assert client.get(f'/callback?code=abc&state={state}').status_code == 302
    # replaying the same callback must not log in again
    assert client.get(f'/callback?code=abc&state={state}').status_code == 400


def test_logout_is_post_only(client):
    """A GET logout could be triggered by any page embedding the URL."""
    assert client.get('/logout').status_code == 405
    assert client.post('/logout').status_code == 204


# --- reliability ---

def test_now_playing_answers_401_rather_than_redirecting(client):
    """It's polled with fetch, which can't follow a redirect to Spotify."""
    resp = client.get('/now-playing')
    assert resp.status_code == 401
    assert resp.get_json() == {'error': 'Not authenticated'}


def test_now_playing_401_when_the_session_has_lapsed(client, spotify, monkeypatch):
    """spotify_get hands back Spotify's 401 when the token refresh failed."""
    monkeypatch.setattr(spotify, 'spotify_get', lambda url, **kw: FakeResponse(401))
    assert client.get('/now-playing').status_code == 401


def test_spotify_timeout_is_a_502_not_a_sign_out(client, spotify, monkeypatch):
    def timeout(url, **kwargs):
        raise requests.Timeout()
    monkeypatch.setattr(spotify, 'spotify_get', timeout)
    assert client.get('/now-playing').status_code == 502


def test_spotify_calls_carry_a_timeout(spotify, monkeypatch):
    seen = {}

    def fake_get(url, **kwargs):
        seen.update(kwargs)
        return FakeResponse(200, {})
    monkeypatch.setattr(spotify.requests, 'get', fake_get)
    spotify.spotify_get('https://api.spotify.com/v1/me')
    assert seen['timeout'] == spotify.SPOTIFY_TIMEOUT


# --- Spotify refusing access ---

@pytest.mark.parametrize('message, reason', [
    ('Active premium subscription required for the owner of the app. When '
     'the subscription status changes, it can take a few hours before '
     'requests are allowed again.', 'owner_premium_required'),
    ('Check settings on developer.spotify.com/dashboard, the user may not be '
     'registered.', 'user_not_registered'),
    ('Something new Spotify invented', 'forbidden'),
])
def test_now_playing_names_why_spotify_refused(client, spotify, monkeypatch,
                                               message, reason):
    body = {'error': {'status': 403, 'message': message}}
    monkeypatch.setattr(spotify, 'spotify_get',
                        lambda url, **kw: FakeResponse(403, body))
    resp = client.get('/now-playing')
    assert resp.status_code == 403
    assert resp.get_json()['reason'] == reason


def test_now_playing_403_without_a_body(client, spotify, monkeypatch):
    monkeypatch.setattr(spotify, 'spotify_get', lambda url, **kw: FakeResponse(403))
    assert client.get('/now-playing').get_json()['reason'] == 'forbidden'


def test_romanised_punjabi_is_sent_as_punjabi(translate):
    """DeepL's own guess for romanised Punjabi is Wolof or Oromo."""
    client, stub = translate
    lines = ['Main tainu yaad karda haan', 'Dil mera tere naal ae',
             'Kithe chali ae sohniye', 'Mainu vi dass de']
    stub['lyrics'] = {'found': True, 'synced': True,
                      'lyrics': [{'time_ms': i, 'text': t} for i, t in enumerate(lines)]}
    stub['deepl'] = DeepLResponse(200, {'translations': [
        {'text': 'x', 'detected_source_language': 'PA'}] * len(lines)})
    client.get(TRANSLATE_URL)
    assert stub['deepl_bodies'][0]['source_lang'] == 'PA'


def test_other_languages_are_left_to_deepl_detection(translate):
    client, stub = translate
    client.get(TRANSLATE_URL)
    assert 'source_lang' not in stub['deepl_bodies'][0]


def test_translate_rejects_a_target_deepl_doesnt_offer(translate):
    """target_lang is part of the cache key — junk would only fill the cache."""
    client, stub = translate
    resp = client.get(TRANSLATE_URL + '&target_lang=XX')
    assert resp.status_code == 400
    assert stub['deepl_bodies'] == []


def test_old_text_dated_misses_are_cleared(database):
    """Local files from before epoch timestamps hold text dates, which SQLite
    sorts above any number — they'd never expire."""
    import db
    if database != 'sqlite':
        pytest.skip('only local SQLite files can hold the old format')
    with db.connect() as conn:
        conn.execute("INSERT INTO lyrics_misses VALUES ('OLD', '2026-06-18 10:00:00')")
    db.init_db()
    with db.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM lyrics_misses').fetchone()[0] == 0


# --- shuffle, repeat, volume, devices ---

@pytest.mark.parametrize('body, url, params', [
    ({'action': 'shuffle', 'state': True}, '/me/player/shuffle', {'state': 'true'}),
    ({'action': 'shuffle', 'state': False}, '/me/player/shuffle', {'state': 'false'}),
    ({'action': 'repeat', 'state': 'track'}, '/me/player/repeat', {'state': 'track'}),
    ({'action': 'volume', 'volume_percent': 0}, '/me/player/volume', {'volume_percent': 0}),
    ({'action': 'volume', 'volume_percent': 100}, '/me/player/volume', {'volume_percent': 100}),
])
def test_player_settings_reach_spotify(client, spotify, monkeypatch, body, url, params):
    calls = []

    def fake_put(u, **kwargs):
        calls.append((u, kwargs.get('params')))
        return FakeResponse(204)
    monkeypatch.setattr(spotify, 'spotify_put', fake_put)
    assert client.post('/playback', json=body).status_code == 200
    assert calls == [(f'https://api.spotify.com/v1{url}', params)]


@pytest.mark.parametrize('body', [
    {'action': 'shuffle', 'state': 'yes'},
    {'action': 'shuffle'},
    {'action': 'repeat', 'state': 'forever'},
    {'action': 'volume', 'volume_percent': 101},
    {'action': 'volume', 'volume_percent': -1},
    {'action': 'volume', 'volume_percent': True},
    {'action': 'volume', 'volume_percent': '50'},
    {'action': 'transfer', 'device_id': '../me'},
    {'action': 'transfer'},
])
def test_player_settings_reject_bad_values(playback, body):
    client, calls = playback
    assert client.post('/playback', json=body).status_code == 400
    assert calls == []


def test_playback_rejects_a_body_that_isnt_an_object(playback):
    client, _ = playback
    assert client.post('/playback', json=['play']).status_code == 400
    assert client.post('/playback', data='play').status_code == 400


def test_transfer_moves_playback_and_keeps_it_going(client, spotify, monkeypatch):
    bodies = []
    monkeypatch.setattr(spotify, 'spotify_put',
                        lambda u, **kw: bodies.append(kw.get('json')) or FakeResponse(204))
    client.post('/playback', json={'action': 'transfer', 'device_id': 'abc-123', 'play': True})
    assert bodies == [{'device_ids': ['abc-123'], 'play': True}]


def test_devices_lists_what_the_picker_needs(client, spotify, monkeypatch):
    monkeypatch.setattr(spotify, 'spotify_get', lambda url, **kw: FakeResponse(200, {'devices': [
        {'id': 'A', 'name': 'Phone', 'type': 'Smartphone', 'is_active': True,
         'is_restricted': False, 'volume_percent': 40},
        {'id': None, 'name': 'Ghost'},
    ]}))
    assert client.get('/devices').get_json() == {'devices': [
        {'id': 'A', 'name': 'Phone', 'type': 'Smartphone', 'is_active': True,
         'is_restricted': False}]}


def test_devices_requires_authentication(client):
    assert client.get('/devices').status_code == 401


def test_now_playing_reports_shuffle_repeat_and_device(client, spotify, monkeypatch):
    player = {'currently_playing_type': 'track', 'is_playing': True, 'progress_ms': 1000,
              'item': make_track('T1', 'Song'), 'shuffle_state': True,
              'repeat_state': 'context',
              'device': {'id': 'A', 'name': 'Phone', 'volume_percent': 40,
                         'supports_volume': False}}
    player['item']['album']['name'] = 'An Album'
    monkeypatch.setattr(spotify, 'spotify_get', lambda url, **kw: FakeResponse(200, player))
    data = client.get('/now-playing').get_json()
    assert data['shuffle'] is True
    assert data['repeat'] == 'context'
    assert data['device'] == {'id': 'A', 'name': 'Phone', 'volume_percent': 40,
                              'supports_volume': False}


# --- Your Library ---

LIBRARY_FEEDS = {
    'playlists': {'items': [
        {'name': 'Road Trip', 'uri': 'spotify:playlist:P1',
         'owner': {'display_name': 'Cherry'},
         'images': [{'url': 'https://i.scdn.co/big'}, {'url': 'https://i.scdn.co/mid'},
                    {'url': 'https://i.scdn.co/small'}]},
        None,   # Spotify really does return nulls here for some deleted playlists
    ]},
    'albums': {'items': [{'album': {'name': 'An Album', 'uri': 'spotify:album:A1',
                                    'artists': [{'name': 'X'}, {'name': 'Y'}],
                                    'images': [{'url': 'https://i.scdn.co/only'}]}}]},
    'shows': {'items': [{'show': {'name': 'A Podcast', 'uri': 'spotify:show:S1',
                                  'publisher': 'Someone', 'images': []}}]},
}


@pytest.fixture
def library_client(client, spotify, monkeypatch):
    def fake_get(url, **kwargs):
        kind = url.split('/me/')[1].split('?')[0]
        return FakeResponse(200, LIBRARY_FEEDS[kind])
    monkeypatch.setattr(spotify, 'spotify_get', fake_get)
    return client


def test_library_lists_playlists_albums_and_podcasts(library_client):
    assert library_client.get('/library').get_json()['items'] == [
        {'kind': 'playlist', 'uri': 'spotify:playlist:P1', 'name': 'Road Trip',
         'subtitle': 'Playlist • Cherry', 'image': 'https://i.scdn.co/mid'},
        {'kind': 'album', 'uri': 'spotify:album:A1', 'name': 'An Album',
         'subtitle': 'Album • X, Y', 'image': 'https://i.scdn.co/only'},
        {'kind': 'show', 'uri': 'spotify:show:S1', 'name': 'A Podcast',
         'subtitle': 'Podcast • Someone', 'image': None},
    ]


def test_library_asks_old_sessions_to_reconnect(client, spotify, monkeypatch):
    """Sessions from before Your Library don't have its permissions."""
    body = {'error': {'status': 403, 'message': 'Insufficient client scope'}}
    monkeypatch.setattr(spotify, 'spotify_get', lambda url, **kw: FakeResponse(403, body))
    resp = client.get('/library')
    assert resp.status_code == 403
    assert resp.get_json()['reason'] == 'reconnect'


def test_library_shows_what_it_can_when_one_feed_fails(client, spotify, monkeypatch):
    def fake_get(url, **kwargs):
        if 'albums' in url:
            return FakeResponse(500)
        return FakeResponse(200, LIBRARY_FEEDS[url.split('/me/')[1].split('?')[0]])
    monkeypatch.setattr(spotify, 'spotify_get', fake_get)
    kinds = [item['kind'] for item in client.get('/library').get_json()['items']]
    assert kinds == ['playlist', 'show']


def test_library_requires_authentication(client):
    assert client.get('/library').status_code == 401


def test_login_asks_for_the_library_and_email_permissions(client):
    scope = parse_qs(urlparse(client.get('/login').headers['Location']).query)['scope'][0]
    for permission in ('user-library-read', 'playlist-read-private', 'user-read-email'):
        assert permission in scope.split()


def test_play_context_starts_a_playlist(client, spotify, monkeypatch):
    bodies = []
    monkeypatch.setattr(spotify, 'spotify_put',
                        lambda u, **kw: bodies.append(kw.get('json')) or FakeResponse(204))
    client.post('/playback', json={'action': 'play_context',
                                   'context_uri': 'spotify:playlist:P1'})
    assert bodies == [{'context_uri': 'spotify:playlist:P1'}]


@pytest.mark.parametrize('uri', [
    'spotify:artist:A1',             # not something the card offers
    'spotify:playlist:../../me',
    'https://open.spotify.com/playlist/P1',
    None,
])
def test_play_context_rejects_other_uris(playback, uri):
    client, calls = playback
    resp = client.post('/playback', json={'action': 'play_context', 'context_uri': uri})
    assert resp.status_code == 400
    assert calls == []
