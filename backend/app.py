from flask import Flask, redirect, request, session, jsonify, render_template
from flask_cors import CORS
from dotenv import load_dotenv
import os
import requests
import urllib.parse
import re
import json

load_dotenv()

app = Flask(__name__)
CORS(app)
app.secret_key = os.getenv('FLASK_SECRET_KEY')

SPOTIFY_CLIENT_ID = os.getenv('SPOTIFY_CLIENT_ID')
SPOTIFY_CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET')
SPOTIFY_REDIRECT_URI = os.getenv('SPOTIFY_REDIRECT_URI')

DEEPL_API_KEY = os.getenv('DEEPL_API_KEY')
DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate'

SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
SPOTIFY_API_URL = 'https://api.spotify.com/v1'

SCOPE = 'user-read-currently-playing user-read-playback-state user-modify-playback-state user-read-recently-played'

# how many 'recently played' tracks the sidebar shows
RECENT_LIMIT = 2

import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), 'translations.db')

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS translations (
                cache_key TEXT PRIMARY KEY,
                lyrics_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

init_db()


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
        })
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
    r = requests.put(url, headers=headers, **kwargs)
    if r.status_code == 401:
        token = refresh_access_token()
        if not token:
            return r
        headers['Authorization'] = f'Bearer {token}'
        r = requests.put(url, headers=headers, **kwargs)
    return r


@app.route('/')
def home():
    return render_template('index.html')


@app.route('/login')
def login():
    params = {
        'client_id': SPOTIFY_CLIENT_ID,
        'response_type': 'code',
        'redirect_uri': SPOTIFY_REDIRECT_URI,
        'scope': SCOPE,
        'show_dialog': 'true',  # always show account picker — prevents auto-login after disconnect
    }
    auth_url = f"{SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return redirect(auth_url)


@app.route('/callback')
def callback():
    code = request.args.get('code')
    error = request.args.get('error')

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
    })

    token_data = token_response.json()

    if 'access_token' not in token_data:
        return f"Failed to get token: {token_data}", 400

    session['access_token'] = token_data['access_token']
    session['refresh_token'] = token_data['refresh_token']

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


@app.route('/logout', methods=['POST', 'GET'])
def logout():
    session.clear()
    return ('', 204)  # frontend handles showing the welcome screen


@app.route('/now-playing')
def now_playing():
    access_token = get_access_token()
    if not access_token:
        return redirect('/login')

    response = spotify_get(f"{SPOTIFY_API_URL}/me/player/currently-playing")
    if response is None:
        return redirect('/login')

    if response.status_code == 204:
        return jsonify({'playing': False, 'message': 'Nothing is currently playing'})

    if response.status_code != 200:
        return f"Spotify API error: {response.status_code} - {response.text}", 400

    data = response.json()

    if not data or data.get('currently_playing_type') != 'track':
        return jsonify({'playing': False, 'message': 'No track is playing'})

    track = data['item']

    return jsonify({
        'playing': True,
        'song': track['name'],
        'artist': ', '.join([a['name'] for a in track['artists']]),
        'album': track['album']['name'],
        'album_art': track['album']['images'][0]['url'] if track['album']['images'] else None,
        'progress_ms': data['progress_ms'],
        'duration_ms': track['duration_ms'],
        'track_id': track['id'],
        'is_playing': data.get('is_playing', False)
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


PLAYBACK_ACTIONS = ('play', 'pause', 'next', 'previous', 'seek', 'play_track')

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

    action = request.json.get('action')
    if action not in PLAYBACK_ACTIONS:
        return jsonify({'error': 'Invalid action'}), 400

    track_id = request.json.get('track_id')
    if action == 'play_track':
        if not isinstance(track_id, str) or not TRACK_ID_PATTERN.match(track_id):
            return jsonify({'error': 'track_id must be a Spotify track id'}), 400

    position_ms = request.json.get('position_ms')
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
    song = request.args.get('song')
    artist = request.args.get('artist')

    if not song or not artist:
        return jsonify({'error': 'song and artist parameters required'}), 400

    return jsonify(fetch_lyrics(song, artist))


@app.route('/translate')
def translate():
    track_id = request.args.get('track_id')
    song = request.args.get('song')
    artist = request.args.get('artist')
    target_lang = request.args.get('target_lang', 'EN')

    if not track_id or not song or not artist:
        return jsonify({'error': 'song, artist and track_id parameters required'}), 400

    cache_key = f"{track_id}_{target_lang}"
    with sqlite3.connect(DB_PATH) as conn:
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

    try:
        lyrics_data = fetch_lyrics(song, artist)
    except Exception as e:
        return jsonify({
            'translated': False,
            'message': f'Lyrics fetch failed: {str(e)}'
        })

    if not lyrics_data.get('found'):
        return jsonify({
            'translated': False,
            'message': lyrics_data.get('message', 'No lyrics found')
        })

    lyric_lines = lyrics_data['lyrics']
    texts_to_translate = [line['text'] for line in lyric_lines]

    deepl_response = requests.post(
        DEEPL_API_URL,
        headers={'Authorization': f'DeepL-Auth-Key {DEEPL_API_KEY}'},
        json={'text': texts_to_translate, 'target_lang': target_lang},
        timeout=10
    )

    if deepl_response.status_code != 200:
        return jsonify({
            'error': f'DeepL error: {deepl_response.status_code}',
            'detail': deepl_response.text
        }), 400

    translations = deepl_response.json()['translations']

    combined = []
    for i, line in enumerate(lyric_lines):
        combined.append({
            'time_ms': line['time_ms'],
            'original': line['text'],
            'translation': translations[i]['text'],
            'detected_language': translations[i]['detected_source_language']
        })

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            'INSERT OR REPLACE INTO translations (cache_key, lyrics_json) VALUES (?, ?)',
            (cache_key, json.dumps(combined))
        )
        conn.commit()

    return jsonify({
        'translated': True,
        'cached': False,
        'lyrics': combined
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)