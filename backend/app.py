from flask import Flask, redirect, request, session, jsonify, render_template
from dotenv import load_dotenv
import functools
import os
import secrets
import requests
import urllib.parse
import re
import json

import db
from romanised import detect_language

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY')

SPOTIFY_CLIENT_ID = os.getenv('SPOTIFY_CLIENT_ID')
SPOTIFY_CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET')
SPOTIFY_REDIRECT_URI = os.getenv('SPOTIFY_REDIRECT_URI')

# The session cookie carries the Spotify tokens: keep it away from page
# scripts and cross-site requests, and off plain HTTP wherever we serve HTTPS.
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=(SPOTIFY_REDIRECT_URI or '').startswith('https://'),
)

DEEPL_API_KEY = os.getenv('DEEPL_API_KEY')
DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate'

SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
SPOTIFY_API_URL = 'https://api.spotify.com/v1'

# Without a timeout, one slow Spotify response holds a gunicorn worker until
# gunicorn kills it — and there are only two of them.
SPOTIFY_TIMEOUT = 10

SCOPE = ' '.join([
    'user-read-currently-playing',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-recently-played',
    'user-library-read',        # saved albums and podcasts, for Your Library
    'playlist-read-private',    # private playlists, for Your Library
    'user-read-email',          # the address shown in Settings
])

# how many 'recently played' tracks the sidebar shows
RECENT_LIMIT = 2

# how long to trust "LRCLIB has no lyrics" before asking again — people add
# lyrics to LRCLIB all the time
LYRICS_MISS_TTL_SECONDS = 6 * 60 * 60

db.init_db()


def parse_lrc(lrc_text):
    lines = []
    for line in lrc_text.strip().split('\n'):
        line = line.strip()
        if not line:
            continue
        if not line.startswith('['):
            continue
        try:
            timestamp_end = line.index(']')
            timestamp_str = line[1:timestamp_end]
            text = line[timestamp_end + 1:].strip()

            if not text:
                continue
            if ':' not in timestamp_str:
                continue

            minutes, rest = timestamp_str.split(':', 1)
            seconds = rest.split('.')[0]
            hundredths = rest.split('.')[1] if '.' in rest else '0'

            time_ms = (
                int(minutes) * 60 * 1000 +
                int(seconds) * 1000 +
                int(hundredths.ljust(3, '0')[:3])
            )

            lines.append({
                'time_ms': time_ms,
                'text': text
            })

        except (ValueError, IndexError):
            continue

    return lines


def fetch_lyrics(song, artist):
    response = requests.get(
        'https://lrclib.net/api/get',
        params={'track_name': song, 'artist_name': artist},
        headers={'User-Agent': 'LyricSync/1.0 (https://github.com/chaitanya-arora/lyric-sync)'},
        timeout=10
    )

    if response.status_code == 404 or response.status_code != 200:
        search_response = requests.get(
            'https://lrclib.net/api/search',
            params={'track_name': song, 'artist_name': artist},
            headers={'User-Agent': 'LyricSync/1.0 (https://github.com/chaitanya-arora/lyric-sync)'},
            timeout=10
        )

        # an outage must not be remembered as "this song has no lyrics"
        if search_response.status_code >= 500:
            search_response.raise_for_status()
        if search_response.status_code != 200:
            return {'found': False, 'message': 'No lyrics found for this track'}

        results = search_response.json()
        if not results:
            return {'found': False, 'message': 'No lyrics found for this track'}

        best = None
        for result in results:
            if result.get('syncedLyrics'):
                best = result
                break
        if not best:
            best = results[0]

        synced_lyrics = best.get('syncedLyrics')
        plain_lyrics = best.get('plainLyrics')

    else:
        data = response.json()
        synced_lyrics = data.get('syncedLyrics')
        plain_lyrics = data.get('plainLyrics')

    if synced_lyrics:
        return {'found': True, 'synced': True, 'lyrics': parse_lrc(synced_lyrics)}

    if plain_lyrics:
        lines = [
            {'time_ms': None, 'text': line}
            for line in plain_lyrics.strip().split('\n')
            if line.strip()
        ]
        return {'found': True, 'synced': False, 'lyrics': lines}

    return {'found': False, 'message': 'No lyrics available for this track'}


def refresh_access_token():
    refresh_token = session.get('refresh_token')
    if not refresh_token:
        return None
    try:
        response = requests.post(SPOTIFY_TOKEN_URL, data={
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token,
            'client_id': SPOTIFY_CLIENT_ID,
            'client_secret': SPOTIFY_CLIENT_SECRET,
        }, timeout=SPOTIFY_TIMEOUT)
        data = response.json()
        if 'access_token' in data:
            session['access_token'] = data['access_token']
            # Spotify sometimes rotates the refresh token too — store if present
            if 'refresh_token' in data:
                session['refresh_token'] = data['refresh_token']
            return data['access_token']
    except Exception:
        pass
    return None


def get_access_token():
    return session.get('access_token')


def spotify_get(url, **kwargs):
    """GET a Spotify API URL, auto-refreshing token on 401. Returns requests.Response."""
    token = get_access_token()
    if not token:
        return None
    headers = kwargs.pop('headers', {})
    headers['Authorization'] = f'Bearer {token}'
    kwargs.setdefault('timeout', SPOTIFY_TIMEOUT)
    r = requests.get(url, headers=headers, **kwargs)
    if r.status_code == 401:
        token = refresh_access_token()
        if not token:
            return r  # couldn't refresh — caller handles redirect to login
        headers['Authorization'] = f'Bearer {token}'
        r = requests.get(url, headers=headers, **kwargs)
    return r


def spotify_post(url, **kwargs):
    """POST to a Spotify API URL, auto-refreshing token on 401. Returns requests.Response."""
    token = get_access_token()
    if not token:
        return None
    headers = kwargs.pop('headers', {})
    headers['Authorization'] = f'Bearer {token}'
    kwargs.setdefault('timeout', SPOTIFY_TIMEOUT)
    r = requests.post(url, headers=headers, **kwargs)
    if r.status_code == 401:
        token = refresh_access_token()
        if not token:
            return r
        headers['Authorization'] = f'Bearer {token}'
        r = requests.post(url, headers=headers, **kwargs)
    return r


def spotify_put(url, **kwargs):
    """PUT to a Spotify API URL, auto-refreshing token on 401. Returns requests.Response."""
    token = get_access_token()
    if not token:
        return None
    headers = kwargs.pop('headers', {})
    headers['Authorization'] = f'Bearer {token}'
    kwargs.setdefault('timeout', SPOTIFY_TIMEOUT)
    r = requests.put(url, headers=headers, **kwargs)
    if r.status_code == 401:
        token = refresh_access_token()
        if not token:
            return r
        headers['Authorization'] = f'Bearer {token}'
        r = requests.put(url, headers=headers, **kwargs)
    return r


@app.errorhandler(requests.RequestException)
def upstream_unreachable(e):
    # Spotify timed out or dropped the connection. That says nothing about the
    # session, so don't answer 401 and sign the user out over it.
    app.logger.warning('Upstream request failed: %s', e)
    return jsonify({'error': 'Upstream service unavailable'}), 502


@app.route('/')
def home():
    return render_template('index.html')


@app.route('/login')
def login():
    # ties the callback to a login this browser started — without it, anyone
    # could send you to /callback with their own code and sign you in as them
    state = secrets.token_urlsafe(16)
    session['oauth_state'] = state
    params = {
        'client_id': SPOTIFY_CLIENT_ID,
        'response_type': 'code',
        'redirect_uri': SPOTIFY_REDIRECT_URI,
        'scope': SCOPE,
        'show_dialog': 'true',  # always show account picker — prevents auto-login after disconnect
        'state': state,
    }
    auth_url = f"{SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return redirect(auth_url)


@app.route('/callback')
def callback():
    code = request.args.get('code')
    error = request.args.get('error')

    expected_state = session.pop('oauth_state', None)
    if not expected_state or request.args.get('state') != expected_state:
        return "Login expired or didn't start here — please try again.", 400

    if error:
        return f"Spotify login error: {error}", 400
    if not code:
        return "No code received from Spotify", 400

    token_response = requests.post(SPOTIFY_TOKEN_URL, data={
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': SPOTIFY_REDIRECT_URI,
        'client_id': SPOTIFY_CLIENT_ID,
        'client_secret': SPOTIFY_CLIENT_SECRET,
    }, timeout=SPOTIFY_TIMEOUT)

    token_data = token_response.json()

    if 'access_token' not in token_data:
        app.logger.warning('Spotify token exchange failed: %s', token_data.get('error'))
        return "Couldn't finish connecting to Spotify — please try again.", 400

    session['access_token'] = token_data['access_token']
    session['refresh_token'] = token_data['refresh_token']
    # this login may be a different account from the last one
    session.pop('user_id', None)
    try:
        current_user_id()
    except requests.RequestException:
        pass   # looked up again on the first request that needs it

    return redirect('/')


@app.route('/me')
def me():
    access_token = get_access_token()
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401

    response = spotify_get(f"{SPOTIFY_API_URL}/me")
    if response is None or response.status_code == 401:
        return jsonify({'error': 'Not authenticated'}), 401
    if response.status_code != 200:
        return jsonify({'error': f'Spotify API error: {response.status_code}'}), 400
    return jsonify(response.json())


@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return ('', 204)  # frontend handles showing the welcome screen


def spotify_access_problem(response):
    """Why Spotify answered 403, from the message in its error body."""
    try:
        message = ((response.json().get('error') or {}).get('message') or '').lower()
    except ValueError:
        message = ''
    if 'premium' in message and 'owner' in message:
        return 'owner_premium_required'
    if 'not be registered' in message:
        return 'user_not_registered'
    # a session from before a permission was added — signing in again fixes it
    if 'scope' in message:
        return 'reconnect'
    return 'forbidden'


@app.route('/now-playing')
def now_playing():
    # This is polled with fetch, which can't follow a redirect to Spotify's
    # login page — say 401 and let the page show the connect screen.
    access_token = get_access_token()
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401

    # /me/player rather than /currently-playing: same track and position, plus
    # the shuffle, repeat and device state the player bar shows
    response = spotify_get(f"{SPOTIFY_API_URL}/me/player")
    if response is None or response.status_code == 401:
        return jsonify({'error': 'Not authenticated'}), 401

    if response.status_code == 204:
        return jsonify({'playing': False, 'message': 'Nothing is currently playing'})

    # Development-mode apps get refused outright, and the page used to sit on
    # "Connect with Spotify" without saying why. Name the reason instead.
    if response.status_code == 403:
        return jsonify({
            'error': 'Spotify refused access',
            'reason': spotify_access_problem(response)
        }), 403

    if response.status_code != 200:
        return jsonify({'error': f'Spotify API error: {response.status_code}'}), 502

    data = response.json()

    if not data or data.get('currently_playing_type') != 'track':
        return jsonify({'playing': False, 'message': 'No track is playing'})

    track = data['item']
    device = data.get('device') or {}

    return jsonify({
        'playing': True,
        'song': track['name'],
        'artist': ', '.join([a['name'] for a in track['artists']]),
        'album': track['album']['name'],
        'album_art': track['album']['images'][0]['url'] if track['album']['images'] else None,
        'progress_ms': data['progress_ms'],
        'duration_ms': track['duration_ms'],
        'track_id': track['id'],
        'is_playing': data.get('is_playing', False),
        'shuffle': bool(data.get('shuffle_state')),
        'repeat': data.get('repeat_state') or 'off',
        'device': {
            'id': device.get('id'),
            'name': device.get('name'),
            'volume_percent': device.get('volume_percent'),
            'supports_volume': device.get('supports_volume', True),
        },
    })


@app.route('/queue')
def queue():
    access_token = get_access_token()
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401

    response = spotify_get(f"{SPOTIFY_API_URL}/me/player/queue")
    if response is None or response.status_code != 200:
        return jsonify({'queue': []})

    data = response.json()
    queue_items = []

    for track in data.get('queue', [])[:5]:
        if track.get('type') != 'track':
            continue
        queue_items.append({
            'song': track['name'],
            'artist': ', '.join([a['name'] for a in track['artists']]),
            'album_art': track['album']['images'][0]['url'] if track['album']['images'] else None,
            'duration_ms': track['duration_ms'],
            'track_id': track['id']
        })

    return jsonify({'queue': queue_items})


@app.route('/context')
def context():
    access_token = get_access_token()
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401

    current_track_id = request.args.get('current')

    queue_res = spotify_get(f"{SPOTIFY_API_URL}/me/player/queue")
    # Fetch a wider window than we display: the filters below drop entries, and
    # Spotify frequently repeats the same track across consecutive entries.
    recent_res = spotify_get(f"{SPOTIFY_API_URL}/me/player/recently-played?limit=10")

    next_tracks = []
    if queue_res and queue_res.status_code == 200:
        for track in queue_res.json().get('queue', [])[:3]:
            if track.get('type') != 'track':
                continue
            next_tracks.append({
                'song': track['name'],
                'artist': ', '.join([a['name'] for a in track['artists']]),
                'album_art': track['album']['images'][0]['url'] if track['album']['images'] else None,
                'duration_ms': track['duration_ms'],
                'track_id': track['id'],
                'direction': 'next'
            })

    prev_tracks = []
    if recent_res and recent_res.status_code == 200:
        picked = []
        seen = set()
        for item in recent_res.json().get('items', []):
            track = item['track']
            # Spotify logs the playing track on replays and seeks — it belongs
            # in the player, not in 'Recently Played'.
            if track['id'] == current_track_id:
                continue
            if track['id'] in seen:
                continue
            seen.add(track['id'])
            picked.append(track)
            if len(picked) == RECENT_LIMIT:
                break

        # oldest first, so the list reads chronologically down into 'Playing Next'
        for track in reversed(picked):
            prev_tracks.append({
                'song': track['name'],
                'artist': ', '.join([a['name'] for a in track['artists']]),
                'album_art': track['album']['images'][0]['url'] if track['album']['images'] else None,
                'duration_ms': track['duration_ms'],
                'track_id': track['id'],
                'direction': 'previous'
            })

    payload = jsonify({
        'previous': prev_tracks,
        'next': next_tracks
    })
    # polled endpoint — a cached copy would defeat the point
    payload.headers['Cache-Control'] = 'no-store'
    return payload


RECENT_HISTORY_LIMIT = 50   # Spotify's maximum for recently-played


@app.route('/recently-played')
def recently_played():
    """Listening history, newest first, for the Recently Played panel."""
    access_token = get_access_token()
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401

    res = spotify_get(
        f"{SPOTIFY_API_URL}/me/player/recently-played"
        f"?limit={RECENT_HISTORY_LIMIT}"
    )
    if res is None or res.status_code != 200:
        return jsonify({'tracks': []})

    try:
        items = res.json().get('items') or []
    except ValueError:
        return jsonify({'tracks': []})

    tracks = []
    seen = set()
    for item in items:
        track = item.get('track') or {}
        track_id = track.get('id')
        # Spotify repeats a track for every play; keep only the newest, which
        # comes first, so the list reads as distinct songs rather than a log.
        if not track_id or track_id in seen:
            continue
        seen.add(track_id)
        tracks.append({
            'song': track['name'],
            'artist': ', '.join([a['name'] for a in track['artists']]),
            'album_art': track['album']['images'][0]['url'] if track['album']['images'] else None,
            'duration_ms': track['duration_ms'],
            'track_id': track_id,
            'played_at': item.get('played_at'),
        })

    payload = jsonify({'tracks': tracks})
    payload.headers['Cache-Control'] = 'no-store'
    return payload


# DeepL's target languages (GET /v2/languages?type=target), plus plain 'EN',
# which DeepL still accepts and the app has always used
TARGET_LANGUAGES = frozenset('''
    AF AN AR AS AY AZ BA BE BG BN BR BS CA CS CY DA DE DE-CH DE-DE EL EN
    EN-GB EN-US EO ES ES-419 ES-ES ET EU FA FI FR FR-CA FR-FR GA GL GN GU HA
    HE HI HR HT HU HY ID IG IS IT JA JV KA KK KO KY LA LB LN LT LV MG MI MK
    ML MN MR MS MT MY NB NE NL OC OM PA PL PS PT-BR PT-PT QU RO RU SA SK SL
    SQ SR ST SU SV SW TA TE TG TH TK TL TN TR TS TT UK UR UZ VI WO XH YI ZH
    ZH-HANS ZH-HANT ZU
'''.split())

@app.route('/devices')
def devices():
    """Spotify devices this account can play on, for the device picker."""
    if not get_access_token():
        return jsonify({'error': 'Not authenticated'}), 401
    res = spotify_get(f"{SPOTIFY_API_URL}/me/player/devices")
    if res is None or res.status_code == 401:
        return jsonify({'error': 'Not authenticated'}), 401
    if res.status_code != 200:
        return jsonify({'devices': []})
    try:
        listed = res.json().get('devices') or []
    except ValueError:
        listed = []
    payload = jsonify({'devices': [{
        'id': d.get('id'),
        'name': d.get('name'),
        'type': d.get('type'),
        'is_active': bool(d.get('is_active')),
        'is_restricted': bool(d.get('is_restricted')),
    } for d in listed if d.get('id')]})
    payload.headers['Cache-Control'] = 'no-store'
    return payload


LIBRARY_LIMIT = 20   # per kind — the card shows a sidebar's worth


def thumbnail(images):
    """Spotify lists artwork largest first (640, 300, 64). The middle size is
    sharp at the card's size on a retina screen without the full download."""
    images = images or []
    if not images:
        return None
    return images[1]['url'] if len(images) > 1 else images[0]['url']


def library_items(kind, payload):
    """One kind of Your Library entry, in the Figma's "Album • Artist" style."""
    items = []
    for entry in payload.get('items') or []:
        if not entry:
            continue
        if kind == 'playlist':
            owner = (entry.get('owner') or {}).get('display_name') or ''
            name, subtitle, uri = entry.get('name'), f'Playlist • {owner}', entry.get('uri')
            image = thumbnail(entry.get('images'))
        elif kind == 'album':
            album = entry.get('album') or {}
            artists = ', '.join(a['name'] for a in album.get('artists') or [])
            name, subtitle, uri = album.get('name'), f'Album • {artists}', album.get('uri')
            image = thumbnail(album.get('images'))
        else:
            show = entry.get('show') or {}
            name, subtitle, uri = show.get('name'), f"Podcast • {show.get('publisher') or ''}", show.get('uri')
            image = thumbnail(show.get('images'))
        if name and uri:
            items.append({'kind': kind, 'uri': uri, 'name': name,
                          'subtitle': subtitle.rstrip(' •'), 'image': image})
    return items


@app.route('/library')
def library():
    """Your Library: the account's playlists, saved albums and podcasts."""
    if not get_access_token():
        return jsonify({'error': 'Not authenticated'}), 401

    sources = [
        ('playlist', f"{SPOTIFY_API_URL}/me/playlists?limit={LIBRARY_LIMIT}"),
        ('album', f"{SPOTIFY_API_URL}/me/albums?limit={LIBRARY_LIMIT}"),
        ('show', f"{SPOTIFY_API_URL}/me/shows?limit={LIBRARY_LIMIT}"),
    ]
    items = []
    for kind, url in sources:
        res = spotify_get(url)
        if res is None or res.status_code == 401:
            return jsonify({'error': 'Not authenticated'}), 401
        if res.status_code == 403:
            return jsonify({'error': 'Spotify refused access',
                            'reason': spotify_access_problem(res)}), 403
        if res.status_code != 200:
            continue   # show what we can rather than nothing
        try:
            items += library_items(kind, res.json())
        except (ValueError, KeyError, TypeError):
            continue

    payload = jsonify({'items': items})
    payload.headers['Cache-Control'] = 'no-store'
    return payload


PLAYBACK_ACTIONS = ('play', 'pause', 'next', 'previous', 'seek', 'play_track',
                    'play_context', 'shuffle', 'repeat', 'volume', 'transfer')

# what Your Library can start playing: a whole playlist, album or podcast
CONTEXT_URI_PATTERN = re.compile(r'^spotify:(playlist|album|show):[A-Za-z0-9]{1,64}$')

REPEAT_STATES = ('off', 'context', 'track')

# Spotify device ids are opaque, but only ever letters, digits, - and _
DEVICE_ID_PATTERN = re.compile(r'^[A-Za-z0-9_-]{1,128}$')

# Spotify track ids are base62; anything else has no business in a track URI
TRACK_ID_PATTERN = re.compile(r'^[A-Za-z0-9]{1,64}$')


def spotify_error_reason(response):
    """The 'reason' Spotify puts in an error body, when there is one."""
    try:
        return (response.json().get('error') or {}).get('reason')
    except ValueError:
        return None


def is_no_active_device(response):
    if response is None:
        return False
    return (response.status_code == 404
            or spotify_error_reason(response) == 'NO_ACTIVE_DEVICE')


def pick_controllable_device():
    """A device Spotify still lists and that we're allowed to drive.

    Prefers one Spotify already considers active. Restricted devices can't be
    controlled through the Web API at all, so they're skipped.
    """
    res = spotify_get(f"{SPOTIFY_API_URL}/me/player/devices")
    if res is None or res.status_code != 200:
        return None
    try:
        devices = res.json().get('devices') or []
    except ValueError:
        return None

    usable = [d for d in devices if d.get('id') and not d.get('is_restricted')]
    if not usable:
        return None
    for device in usable:
        if device.get('is_active'):
            return device['id']
    return usable[0]['id']


def wake_device(play=False):
    """Hand playback back to a device Spotify still knows about.

    After a spell of inactivity Spotify drops the *active* device while still
    listing the device itself, which is why resuming a paused session stops
    working even with Spotify open. Transferring to it makes it active again.
    Returns True if a device took over.
    """
    device_id = pick_controllable_device()
    if not device_id:
        return False
    res = spotify_put(
        f"{SPOTIFY_API_URL}/me/player",
        json={'device_ids': [device_id], 'play': play}
    )
    return res is not None and res.status_code in (200, 202, 204)


@app.route('/playback', methods=['POST'])
def playback():
    access_token = get_access_token()
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({'error': 'expected a JSON object'}), 400

    action = body.get('action')
    if action not in PLAYBACK_ACTIONS:
        return jsonify({'error': 'Invalid action'}), 400

    track_id = body.get('track_id')
    if action == 'play_track':
        if not isinstance(track_id, str) or not TRACK_ID_PATTERN.match(track_id):
            return jsonify({'error': 'track_id must be a Spotify track id'}), 400

    context_uri = body.get('context_uri')
    if action == 'play_context' and (not isinstance(context_uri, str)
                                     or not CONTEXT_URI_PATTERN.match(context_uri)):
        return jsonify({'error': 'context_uri must be a Spotify playlist, album or show'}), 400

    state = body.get('state')
    if action == 'shuffle' and not isinstance(state, bool):
        return jsonify({'error': 'state must be true or false'}), 400
    if action == 'repeat' and state not in REPEAT_STATES:
        return jsonify({'error': 'state must be off, context or track'}), 400

    volume = body.get('volume_percent')
    if action == 'volume' and (isinstance(volume, bool) or not isinstance(volume, int)
                               or not 0 <= volume <= 100):
        return jsonify({'error': 'volume_percent must be 0 to 100'}), 400

    device_id = body.get('device_id')
    if action == 'transfer' and (not isinstance(device_id, str)
                                 or not DEVICE_ID_PATTERN.match(device_id)):
        return jsonify({'error': 'device_id must be a Spotify device id'}), 400

    position_ms = body.get('position_ms')
    if action == 'seek':
        # bool is an int subclass, so reject it explicitly
        if isinstance(position_ms, bool) or not isinstance(position_ms, int):
            return jsonify({'error': 'position_ms must be an integer'}), 400
        if position_ms < 0:
            return jsonify({'error': 'position_ms must not be negative'}), 400

    def send():
        if action == 'play':
            return spotify_put(f"{SPOTIFY_API_URL}/me/player/play")
        if action == 'pause':
            return spotify_put(f"{SPOTIFY_API_URL}/me/player/pause")
        if action == 'next':
            return spotify_post(f"{SPOTIFY_API_URL}/me/player/next")
        if action == 'previous':
            return spotify_post(f"{SPOTIFY_API_URL}/me/player/previous")
        if action == 'play_track':
            return spotify_put(
                f"{SPOTIFY_API_URL}/me/player/play",
                json={'uris': [f'spotify:track:{track_id}']}
            )
        if action == 'play_context':
            return spotify_put(f"{SPOTIFY_API_URL}/me/player/play",
                               json={'context_uri': context_uri})
        if action == 'shuffle':
            return spotify_put(f"{SPOTIFY_API_URL}/me/player/shuffle",
                               params={'state': 'true' if state else 'false'})
        if action == 'repeat':
            return spotify_put(f"{SPOTIFY_API_URL}/me/player/repeat",
                               params={'state': state})
        if action == 'volume':
            return spotify_put(f"{SPOTIFY_API_URL}/me/player/volume",
                               params={'volume_percent': volume})
        if action == 'transfer':
            # keep playing if it was, on the new device
            return spotify_put(f"{SPOTIFY_API_URL}/me/player",
                               json={'device_ids': [device_id],
                                     'play': bool(body.get('play'))})
        return spotify_put(
            f"{SPOTIFY_API_URL}/me/player/seek?position_ms={position_ms}"
        )

    r = send()

    # Resuming a session paused a while ago lands here: the device is idle
    # rather than gone. Wake it and retry, instead of telling the user to go
    # back to Spotify for something we can do ourselves.
    if is_no_active_device(r) and wake_device(play=(action == 'play')):
        if action == 'play':
            return jsonify({'success': True, 'woke_device': True})
        r = send()

    if r is None:
        return jsonify({'error': 'Not authenticated'}), 401

    if r.status_code in (200, 204):
        return jsonify({'success': True})

    # Spotify explains playback refusals in the body — pass the reason on so the
    # client can say something useful instead of failing silently.
    reason = spotify_error_reason(r)

    if reason == 'NO_ACTIVE_DEVICE' or r.status_code == 404:
        return jsonify({
            'error': 'No active Spotify device',
            'reason': 'no_active_device'
        }), 409

    if reason == 'PREMIUM_REQUIRED':
        return jsonify({
            'error': 'Spotify Premium is required to control playback',
            'reason': 'premium_required'
        }), 403

    return jsonify({'error': f'Spotify error: {r.status_code}'}), 400


@app.route('/lyrics')
def lyrics():
    if not get_access_token():
        return jsonify({'error': 'Not authenticated'}), 401

    song = request.args.get('song')
    artist = request.args.get('artist')

    if not song or not artist:
        return jsonify({'error': 'song and artist parameters required'}), 400

    return jsonify(fetch_lyrics(song, artist))


@app.route('/translate')
def translate():
    # DeepL's free quota is shared by everyone using the app — only signed-in
    # users get to spend it
    if not get_access_token():
        return jsonify({'error': 'Not authenticated'}), 401

    track_id = request.args.get('track_id')
    song = request.args.get('song')
    artist = request.args.get('artist')
    target_lang = request.args.get('target_lang', 'EN')

    if not track_id or not song or not artist:
        return jsonify({'error': 'song, artist and track_id parameters required'}), 400
    # it's part of the cache key, so anything DeepL can't use would only
    # fill the cache with junk
    if target_lang not in TARGET_LANGUAGES:
        return jsonify({'error': 'Unsupported target_lang'}), 400

    cache_key = f"{track_id}_{target_lang}"
    with db.connect() as conn:
        row = conn.execute(
            'SELECT lyrics_json FROM translations WHERE cache_key = ?',
            (cache_key,)
        ).fetchone()
        if row:
            return jsonify({
                'translated': True,
                'cached': True,
                'lyrics': json.loads(row[0])
            })

        recent_miss = conn.execute(
            'SELECT 1 FROM lyrics_misses WHERE track_id = ? AND checked_at > ?',
            (track_id, db.now() - LYRICS_MISS_TTL_SECONDS)
        ).fetchone()
        if recent_miss:
            return jsonify({'translated': False, 'message': 'No lyrics found'})

    # A timeout or outage is not the same as "this song has no lyrics": answer
    # with an error so the client retries, instead of a final "not found".
    try:
        lyrics_data = fetch_lyrics(song, artist)
    except requests.RequestException:
        return jsonify({'error': 'Lyrics service unavailable'}), 502

    if not lyrics_data.get('found'):
        with db.connect() as conn:
            conn.execute(
                'INSERT INTO lyrics_misses (track_id, checked_at) VALUES (?, ?) '
                'ON CONFLICT (track_id) DO UPDATE SET checked_at = excluded.checked_at',
                (track_id, db.now())
            )
        return jsonify({
            'translated': False,
            'message': lyrics_data.get('message', 'No lyrics found')
        })

    lyric_lines = lyrics_data['lyrics']
    texts_to_translate = [line['text'] for line in lyric_lines]

    deepl_body = {
        'text': texts_to_translate,
        'target_lang': target_lang,
        # Each line is translated on its own; telling DeepL these are
        # song lyrics steers short, ambiguous lines. Context isn't billed.
        'context': f'Lyrics of the song "{song}" by {artist}.',
    }

    # DeepL can't place romanised Hindi or Punjabi by itself, but translates
    # it well once told. English lines in the same song come back unchanged.
    romanised_lang = detect_language(texts_to_translate)
    if romanised_lang:
        deepl_body['source_lang'] = romanised_lang

    try:
        deepl_response = requests.post(
            DEEPL_API_URL,
            headers={'Authorization': f'DeepL-Auth-Key {DEEPL_API_KEY}'},
            json=deepl_body,
            timeout=10
        )
    except requests.RequestException:
        return jsonify({'error': 'Translation service unavailable'}), 502

    if deepl_response.status_code != 200:
        app.logger.warning('DeepL error %s: %s',
                           deepl_response.status_code, deepl_response.text[:200])
        return jsonify({'error': f'DeepL error: {deepl_response.status_code}'}), 502

    translations = deepl_response.json()['translations']

    combined = []
    for i, line in enumerate(lyric_lines):
        combined.append({
            'time_ms': line['time_ms'],
            'original': line['text'],
            'translation': translations[i]['text'],
            'detected_language': translations[i]['detected_source_language']
        })

    with db.connect() as conn:
        conn.execute(
            'INSERT INTO translations (cache_key, lyrics_json) VALUES (?, ?) '
            'ON CONFLICT (cache_key) DO UPDATE SET lyrics_json = excluded.lyrics_json',
            (cache_key, json.dumps(combined))
        )

    return jsonify({
        'translated': True,
        'cached': False,
        'lyrics': combined
    })



# ── per-user data ──
#
# Everything below belongs to one Spotify account, identified by its Spotify
# user id. Translations themselves stay shared: they're the same for everyone.

def save_user(user_id, display_name=None):
    with db.connect() as conn:
        conn.execute(
            'INSERT INTO users (spotify_id, display_name, created_at, last_seen_at) '
            'VALUES (?, ?, ?, ?) ON CONFLICT (spotify_id) DO UPDATE SET '
            'display_name = COALESCE(excluded.display_name, users.display_name), '
            'last_seen_at = excluded.last_seen_at',
            (user_id, display_name, db.now(), db.now())
        )


def current_user_id():
    """The signed-in Spotify account's id, looked up once per session."""
    user_id = session.get('user_id')
    if user_id:
        return user_id
    if not get_access_token():
        return None
    res = spotify_get(f"{SPOTIFY_API_URL}/me")
    if res is None or res.status_code != 200:
        return None
    try:
        me = res.json()
    except ValueError:
        return None
    user_id = me.get('id')
    if not isinstance(user_id, str) or not user_id:
        return None
    save_user(user_id, me.get('display_name'))
    session['user_id'] = user_id
    return user_id


def require_user(view):
    """Run the view with the signed-in user's id, or answer 401."""
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        user_id = current_user_id()
        if not user_id:
            return jsonify({'error': 'Not authenticated'}), 401
        return view(user_id, *args, **kwargs)
    return wrapper


LANG_CODE_PATTERN = re.compile(r'^[A-Z]{2,3}(-[A-Z]{2,4})?$')
MAX_TEXT = 300


def track_details(body, track_id=None):
    """The track a client describes, checked field by field. The id comes
    from the URL when there is one, otherwise from the body.

    Returns (details, None), or (None, message) when something is off. These
    are shown back to the user later, so nothing unchecked gets stored.
    """
    if not isinstance(body, dict):
        return None, 'expected a JSON object'
    if track_id is None:
        track_id = body.get('track_id')
    if not isinstance(track_id, str) or not TRACK_ID_PATTERN.match(track_id):
        return None, 'track_id must be a Spotify track id'

    details = {'track_id': track_id}
    for field in ('song', 'artist'):
        value = body.get(field)
        if not isinstance(value, str) or not value.strip() or len(value) > MAX_TEXT:
            return None, f'{field} is required'
        details[field] = value.strip()

    album = body.get('album')
    if album is not None and (not isinstance(album, str) or len(album) > MAX_TEXT):
        return None, 'album must be text'
    details['album'] = album

    # rendered as an <img src>, so only ever an https URL
    art = body.get('album_art')
    if art is not None and (not isinstance(art, str) or len(art) > 500
                            or not art.startswith('https://')):
        return None, 'album_art must be an https URL'
    details['album_art'] = art

    duration = body.get('duration_ms')
    if duration is not None and (isinstance(duration, bool)
                                 or not isinstance(duration, int) or duration < 0):
        return None, 'duration_ms must be a positive integer'
    details['duration_ms'] = duration

    for field in ('source_lang', 'target_lang'):
        value = body.get(field)
        if value is not None and (not isinstance(value, str)
                                  or not LANG_CODE_PATTERN.match(value)):
            return None, f'{field} must be a language code'
        details[field] = value

    return details, None


HISTORY_PAGE = 50
HISTORY_MAX = 200


@app.route('/history', methods=['POST'])
@require_user
def record_listen(user_id):
    """Note a song the user just listened to with translations showing."""
    track, error = track_details(request.get_json(silent=True))
    if error:
        return jsonify({'error': error}), 400

    with db.connect() as conn:
        conn.execute(
            'INSERT INTO listen_history (spotify_id, track_id, song, artist, '
            'album_art, source_lang, target_lang, play_count, last_played_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) '
            'ON CONFLICT (spotify_id, track_id) DO UPDATE SET '
            'song = excluded.song, artist = excluded.artist, '
            'album_art = COALESCE(excluded.album_art, listen_history.album_art), '
            'source_lang = COALESCE(excluded.source_lang, listen_history.source_lang), '
            'target_lang = COALESCE(excluded.target_lang, listen_history.target_lang), '
            'play_count = listen_history.play_count + 1, '
            'last_played_at = excluded.last_played_at',
            (user_id, track['track_id'], track['song'], track['artist'],
             track['album_art'], track['source_lang'], track['target_lang'],
             db.now())
        )
    return jsonify({'recorded': True})


@app.route('/history')
@require_user
def history(user_id):
    """Recently Translated, newest first, optionally for one language."""
    lang = request.args.get('lang')
    if lang is not None and not LANG_CODE_PATTERN.match(lang):
        return jsonify({'error': 'lang must be a language code'}), 400
    try:
        limit = min(max(int(request.args.get('limit', HISTORY_PAGE)), 1), HISTORY_MAX)
    except ValueError:
        return jsonify({'error': 'limit must be a number'}), 400

    where, params = 'spotify_id = ?', [user_id]
    if lang:
        where += ' AND source_lang = ?'
        params.append(lang)

    with db.connect() as conn:
        rows = conn.execute(
            'SELECT track_id, song, artist, album_art, source_lang, target_lang, '
            f'play_count, last_played_at FROM listen_history WHERE {where} '
            'ORDER BY last_played_at DESC, track_id LIMIT ?',
            (*params, limit)
        ).fetchall()
        # the language chips and "Show all 47 songs" count every song, not
        # just this page
        languages = conn.execute(
            'SELECT source_lang, COUNT(*) FROM listen_history '
            'WHERE spotify_id = ? AND source_lang IS NOT NULL '
            'GROUP BY source_lang ORDER BY COUNT(*) DESC, source_lang',
            (user_id,)
        ).fetchall()
        total = conn.execute(
            'SELECT COUNT(*) FROM listen_history WHERE spotify_id = ?', (user_id,)
        ).fetchone()[0]

    keys = ('track_id', 'song', 'artist', 'album_art', 'source_lang',
            'target_lang', 'play_count', 'last_played_at')
    payload = jsonify({
        'tracks': [dict(zip(keys, row)) for row in rows],
        'languages': [{'lang': lang_, 'count': count} for lang_, count in languages],
        'total': total,
    })
    payload.headers['Cache-Control'] = 'no-store'
    return payload


FAVOURITE_KEYS = ('track_id', 'song', 'artist', 'album', 'album_art',
                  'duration_ms', 'source_lang', 'added_at')


@app.route('/favourites')
@require_user
def favourites(user_id):
    with db.connect() as conn:
        rows = conn.execute(
            f'SELECT {", ".join(FAVOURITE_KEYS)} FROM favourites '
            'WHERE spotify_id = ? ORDER BY added_at DESC, track_id',
            (user_id,)
        ).fetchall()
    payload = jsonify({'tracks': [dict(zip(FAVOURITE_KEYS, row)) for row in rows]})
    payload.headers['Cache-Control'] = 'no-store'
    return payload


@app.route('/favourites/<track_id>', methods=['PUT'])
@require_user
def add_favourite(user_id, track_id):
    """Save a song. Saving it again just refreshes its details."""
    track, error = track_details(request.get_json(silent=True), track_id)
    if error:
        return jsonify({'error': error}), 400
    with db.connect() as conn:
        conn.execute(
            'INSERT INTO favourites (spotify_id, track_id, song, artist, album, '
            'album_art, duration_ms, source_lang, added_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) '
            'ON CONFLICT (spotify_id, track_id) DO UPDATE SET '
            'song = excluded.song, artist = excluded.artist, '
            'album = COALESCE(excluded.album, favourites.album), '
            'album_art = COALESCE(excluded.album_art, favourites.album_art), '
            'duration_ms = COALESCE(excluded.duration_ms, favourites.duration_ms), '
            'source_lang = COALESCE(excluded.source_lang, favourites.source_lang)',
            (user_id, track['track_id'], track['song'], track['artist'],
             track['album'], track['album_art'], track['duration_ms'],
             track['source_lang'], db.now())
        )
    return jsonify({'favourite': True})


@app.route('/favourites/<track_id>', methods=['DELETE'])
@require_user
def remove_favourite(user_id, track_id):
    with db.connect() as conn:
        conn.execute(
            'DELETE FROM favourites WHERE spotify_id = ? AND track_id = ?',
            (user_id, track_id)
        )
    return ('', 204)


@app.route('/song-requests', methods=['POST'])
@require_user
def request_song(user_id):
    """'Request this song!' — ask for lyrics we couldn't find."""
    track, error = track_details(request.get_json(silent=True))
    if error:
        return jsonify({'error': error}), 400
    with db.connect() as conn:
        conn.execute(
            'INSERT INTO song_requests (spotify_id, track_id, song, artist, requested_at) '
            'VALUES (?, ?, ?, ?, ?) ON CONFLICT (spotify_id, track_id) DO NOTHING',
            (user_id, track['track_id'], track['song'], track['artist'], db.now())
        )
    return jsonify({'requested': True})


def user_prefs(conn, user_id):
    row = conn.execute(
        'SELECT target_lang, auto_translate FROM users WHERE spotify_id = ?',
        (user_id,)
    ).fetchone()
    if not row:
        return {'target_lang': 'EN', 'auto_translate': True}
    return {'target_lang': row[0], 'auto_translate': bool(row[1])}


@app.route('/prefs')
@require_user
def get_prefs(user_id):
    with db.connect() as conn:
        return jsonify(user_prefs(conn, user_id))


@app.route('/prefs', methods=['PUT'])
@require_user
def update_prefs(user_id):
    """Change any of the user's settings; fields left out stay as they are."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({'error': 'expected a JSON object'}), 400

    changes = {}
    if 'target_lang' in body:
        if body['target_lang'] not in TARGET_LANGUAGES:
            return jsonify({'error': 'Unsupported target_lang'}), 400
        changes['target_lang'] = body['target_lang']
    if 'auto_translate' in body:
        if not isinstance(body['auto_translate'], bool):
            return jsonify({'error': 'auto_translate must be true or false'}), 400
        changes['auto_translate'] = body['auto_translate']

    # the user row may predate this database (e.g. a session from before it)
    save_user(user_id)
    with db.connect() as conn:
        for column, value in changes.items():
            # column names come from the fixed set above, never from the request
            conn.execute(f'UPDATE users SET {column} = ? WHERE spotify_id = ?',
                         (value, user_id))
        return jsonify(user_prefs(conn, user_id))


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)