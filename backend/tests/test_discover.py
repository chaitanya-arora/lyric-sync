"""Charts by country, matching chart songs to Spotify, and search.

Apple and Spotify are stubbed: these test our own handling of them.
"""
from types import SimpleNamespace

import pytest
import requests

import db
import discover
from conftest import FakeResponse, make_track

APPLE_FEED = {'feed': {'results': [
    {'name': 'Chanson Une', 'artistName': 'Artiste', 'id': '1',
     'artworkUrl100': 'https://is1-ssl.mzstatic.com/a/100x100bb.jpg'},
    {'name': 'Chanson Deux', 'artistName': 'Autre', 'id': '2', 'artworkUrl100': None},
    {'name': '', 'artistName': 'Nobody', 'id': '3'},
]}}


@pytest.fixture
def apple(monkeypatch, database):
    """Stub Apple's feed. apple.calls lists the URLs asked for; put what
    each call should give, in order, in apple.responses."""
    stub = SimpleNamespace(calls=[], responses=[])

    def fake_get(url, **kwargs):
        stub.calls.append(url)
        response = stub.responses.pop(0) if stub.responses else FakeResponse(200, APPLE_FEED)
        if isinstance(response, Exception):
            raise response
        return response
    monkeypatch.setattr(discover.requests, 'get', fake_get)
    monkeypatch.setattr(discover.time, 'sleep', lambda s: None)
    return stub


@pytest.fixture
def signed_in(client):
    with client.session_transaction() as session:
        session['access_token'] = 'test-token'
        session['user_id'] = 'cherry'
    return client


# --- charts ---

def test_chart_lists_songs_with_bigger_artwork(signed_in, apple):
    data = signed_in.get('/discover/chart/fr').get_json()
    assert data['name'] == 'France'
    assert data['lang'] == 'FR'
    assert data['songs'] == [
        {'song': 'Chanson Une', 'artist': 'Artiste', 'apple_id': '1',
         'album_art': 'https://is1-ssl.mzstatic.com/a/300x300bb.jpg'},
        {'song': 'Chanson Deux', 'artist': 'Autre', 'apple_id': '2', 'album_art': None},
    ]


def test_chart_is_cached(signed_in, apple):
    signed_in.get('/discover/chart/fr')
    signed_in.get('/discover/chart/fr')
    assert len(apple.calls) == 1


def test_stale_chart_is_refreshed(signed_in, apple, monkeypatch):
    signed_in.get('/discover/chart/fr')
    later = db.now() + discover.CHART_TTL_SECONDS + 1
    monkeypatch.setattr(db, 'now', lambda: later)
    signed_in.get('/discover/chart/fr')
    assert len(apple.calls) == 2


def test_apple_hiccups_are_retried(signed_in, apple):
    apple.responses.extend([FakeResponse(502), requests.ConnectionError()])
    assert signed_in.get('/discover/chart/kr').status_code == 200
    assert len(apple.calls) == 3


def test_an_old_copy_beats_nothing(signed_in, apple, monkeypatch):
    signed_in.get('/discover/chart/fr')
    later = db.now() + discover.CHART_TTL_SECONDS + 1
    monkeypatch.setattr(db, 'now', lambda: later)
    apple.responses.extend([FakeResponse(502)] * 3)
    resp = signed_in.get('/discover/chart/fr')
    assert resp.status_code == 200
    assert resp.get_json()['songs'][0]['song'] == 'Chanson Une'


def test_no_chart_at_all_is_a_502(signed_in, apple):
    apple.responses.extend([FakeResponse(502)] * 3)
    assert signed_in.get('/discover/chart/jp').status_code == 502


def test_unknown_country_is_a_404(signed_in, apple):
    assert signed_in.get('/discover/chart/xx').status_code == 404
    assert signed_in.get('/discover/chart/..%2Fme').status_code == 404
    assert apple.calls == []


def test_charts_require_sign_in(client):
    assert client.get('/discover/chart/fr').status_code == 401


# --- matching a chart song to Spotify ---

@pytest.fixture
def spotify_search(signed_in, spotify, monkeypatch, database):
    """Stub Spotify search. spotify_search.params lists what was searched
    for; put the track lists each search should find in .results."""
    stub = SimpleNamespace(params=[], results=[])

    def fake_get(url, **kwargs):
        stub.params.append(kwargs.get('params'))
        items = stub.results.pop(0) if stub.results else []
        return FakeResponse(200, {'tracks': {'items': items}})
    monkeypatch.setattr(spotify, 'spotify_get', fake_get)
    return stub


def match(client, **body):
    return client.post('/discover/match', json={'song': 'Ashke', 'artist': 'Karan Aujla & MXRCI',
                                               'country': 'in', **body})


def test_match_finds_the_song_in_that_country(signed_in, spotify_search):
    spotify_search.results.append([make_track('SP1', 'Ashke')])
    assert match(signed_in).get_json() == {'track_id': 'SP1'}
    assert spotify_search.params[0]['q'] == 'track:"Ashke" artist:"Karan Aujla"'
    assert spotify_search.params[0]['market'] == 'IN'


def test_match_falls_back_to_a_looser_search(signed_in, spotify_search):
    spotify_search.results.extend([[], [make_track('SP2', 'Ashke')]])
    assert match(signed_in, song='Ashke (feat. Someone)').get_json() == {'track_id': 'SP2'}
    assert spotify_search.params[1]['q'] == 'Ashke Karan Aujla'


def test_match_is_remembered(signed_in, spotify_search):
    spotify_search.results.append([make_track('SP1', 'Ashke')])
    match(signed_in)
    assert match(signed_in).get_json() == {'track_id': 'SP1'}
    assert len(spotify_search.params) == 1


def test_song_not_on_spotify_is_a_404(signed_in, spotify_search):
    assert match(signed_in).status_code == 404


@pytest.mark.parametrize('body', [
    {'song': ''}, {'artist': None}, {'song': 'x' * 301},
])
def test_match_needs_a_song_and_artist(signed_in, spotify_search, body):
    assert match(signed_in, **body).status_code == 400
    assert spotify_search.params == []


def test_match_requires_sign_in(client):
    assert client.post('/discover/match', json={'song': 'a', 'artist': 'b'}).status_code == 401


# --- search ---

def test_search_returns_song_rows(signed_in, spotify_search):
    track = make_track('S1', 'Kesariya')
    track['album']['name'] = 'Brahmastra'
    spotify_search.results.append([track])
    data = signed_in.get('/search?q=kesariya').get_json()
    assert data['tracks'] == [{'track_id': 'S1', 'song': 'Kesariya', 'artist': 'An Artist',
                               'album': 'Brahmastra', 'album_art': 'https://art.example/S1',
                               'duration_ms': 210000}]


def test_empty_search_asks_spotify_nothing(signed_in, spotify_search):
    assert signed_in.get('/search?q=%20').get_json() == {'tracks': []}
    assert spotify_search.params == []


def test_search_requires_sign_in(client):
    assert client.get('/search?q=x').status_code == 401
