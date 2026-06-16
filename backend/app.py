from flask import Flask, redirect, request, session, jsonify, render_template
from flask_cors import CORS
from dotenv import load_dotenv
import os
import requests
import urllib.parse

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

# added user-read-playback-state and user-modify-playback-state for queue + controls
SCOPE = 'user-read-currently-playing user-read-playback-state user-modify-playback-state'

translation_cache = {}


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
        headers={'User-Agent': 'LyricSync/1.0 (https://github.com/chaitanya-arora/lyric-sync)'}
    )

    if response.status_code == 404 or response.status_code != 200:
        search_response = requests.get(
            'https://lrclib.net/api/search',
            params={'track_name': song, 'artist_name': artist},
            headers={'User-Agent': 'LyricSync/1.0 (https://github.com/chaitanya-arora/lyric-sync)'}
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


def get_access_token():
    return session.get('access_token')


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
        return redirect('/login')

    response = requests.get(
        f"{SPOTIFY_API_URL}/me",
        headers={'Authorization': f'Bearer {access_token}'}
    )

    if response.status_code != 200:
        return f"Spotify API error: {response.status_code} - {response.text}", 400

    return jsonify(response.json())


@app.route('/now-playing')
def now_playing():
    access_token = get_access_token()
    if not access_token:
        return redirect('/login')

    response = requests.get(
        f"{SPOTIFY_API_URL}/me/player/currently-playing",
        headers={'Authorization': f'Bearer {access_token}'}
    )

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

    response = requests.get(
        f"{SPOTIFY_API_URL}/me/player/queue",
        headers={'Authorization': f'Bearer {access_token}'}
    )

    if response.status_code != 200:
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


@app.route('/playback', methods=['POST'])
def playback():
    access_token = get_access_token()
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401

    action = request.json.get('action')
    headers = {'Authorization': f'Bearer {access_token}'}

    if action == 'play':
        r = requests.put(f"{SPOTIFY_API_URL}/me/player/play", headers=headers)
    elif action == 'pause':
        r = requests.put(f"{SPOTIFY_API_URL}/me/player/pause", headers=headers)
    elif action == 'next':
        r = requests.post(f"{SPOTIFY_API_URL}/me/player/next", headers=headers)
    elif action == 'previous':
        r = requests.post(f"{SPOTIFY_API_URL}/me/player/previous", headers=headers)
    else:
        return jsonify({'error': 'Invalid action'}), 400

    # spotify returns 204 on success for playback actions
    if r.status_code in (200, 204):
        return jsonify({'success': True})

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
    if cache_key in translation_cache:
        return jsonify({
            'translated': True,
            'cached': True,
            'lyrics': translation_cache[cache_key]
        })

    lyrics_data = fetch_lyrics(song, artist)

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
        json={'text': texts_to_translate, 'target_lang': target_lang}
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

    translation_cache[cache_key] = combined

    return jsonify({
        'translated': True,
        'cached': False,
        'lyrics': combined
    })


if __name__ == '__main__':
    app.run(debug=True)