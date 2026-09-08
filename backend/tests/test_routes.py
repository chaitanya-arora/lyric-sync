"""Route tests with Spotify stubbed out.

No network and no credentials: every test swaps the spotify_* helpers for a
canned response, so what's under test is our own handling of them.
"""
import pytest

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
        calls.append(url)
        return FakeResponse(204)

    monkeypatch.setattr(spotify, 'spotify_put', record)
    monkeypatch.setattr(spotify, 'spotify_post', record)
    return client, calls


def test_seek_forwards_the_position(playback):
    client, calls = playback
    resp = client.post('/playback', json={'action': 'seek', 'position_ms': 42000})
    assert resp.status_code == 200
    assert calls[-1].endswith('/me/player/seek?position_ms=42000')


def test_seek_to_zero_is_allowed(playback):
    """Rewinding to the very start is a legitimate seek, not a falsy value."""
    client, calls = playback
    assert client.post('/playback', json={'action': 'seek', 'position_ms': 0}).status_code == 200
    assert calls[-1].endswith('position_ms=0')


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
