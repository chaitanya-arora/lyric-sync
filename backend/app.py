from flask import Flask, redirect, request, session, jsonify, render_template
from flask_cors import CORS
from dotenv import load_dotenv
import os 
import requests
import urllib.parse
import secrets

load_dotenv()

app = Flask(__name__)
CORS(app)
app.secret_key = os.getenv('FLASK_SECRET_KEY')

SPOTIFY_CLIENT_ID = os.getenv('SPOTIFY_CLIENT_ID')
SPOTIFY_CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET')
SPOTIFY_REDIRECT_URI = os.getenv('SPOTIFY_REDIRECT_URI')

SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
SPOTIFY_API_URL = 'https://api.spotify.com/v1'

SCOPE = 'user-read-currently-playing'

def parse_lrc(lrc_text):
    lines = []
    for line in lrc_text.strip().split('\n'):
        line = line.strip()
        if not line: 
            continue 
        if not line.startswith('['):
            continue # skips any line that isn't a lyric line
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

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/login')
def login():
    params= {
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

    return redirect('/me')

@app.route('/me')
def me():
    access_token = session.get('access_token')

    if not access_token:
        return redirect('/login')
    
    response = requests.get(f"{SPOTIFY_API_URL}/me", headers={'Authorization': f'Bearer {access_token}'})

    if response.status_code != 200:
        return f"Spotify API error: {response.status_code} - {response.text}", 400

    return jsonify(response.json())

@app.route('/now-playing')
def now_playing():
    access_token = session.get('access_token')

    if not access_token:
        return redirect('/login')

    response = requests.get(f"{SPOTIFY_API_URL}/me/player/currently-playing", headers={'Authorization': f'Bearer {access_token}'})

    if response.status_code == 204:
        return jsonify({'playing': False, 'message': 'Nothing is currently playing'})
    
    if response.status_code != 200:
        return f"Spotify API error: {response.status_code} - {response.text}", 400

    data = response.json()

    # only focus on tracks for MVP (ignore podcasts, audiobooks, etc.)
    if not data or data.get('currently_playing_type') != 'track':
        return jsonify({'playing': False, 'message': 'No track is playing'})
    
    track = data['item']

    return jsonify({
        'playing': True, 
        'song': track['name'], 
        'artist': ', '.join([a['name'] for a in track['artists']]),
        'album': track['album']['name'],
        'album_art': track['album']['images'][0]['url'],
        'progress_ms': data['progress_ms'], # will be used to sync lyrics (original + autotranslations)
        'duration_ms': track['duration_ms'],
        'track_id': track['id'] # will be useful when storing recently translated songs 
        })

@app.route('/lyrics')
def lyrics():
    song = request.args.get('song')
    artist = request.args.get('artist')

    if not song or not artist:
        return jsonify({'error': 'song and artist parameters required'}), 400

    response = requests.get(
        'https://lrclib.net/api/get',
        params={
            'track_name': song,
            'artist_name': artist
        },
        headers={'User-Agent': 'LyricSync/1.0 (https://github.com/chaitanya-arora/lyric-sync)'}
    )

    if response.status_code == 404:
        return jsonify({
            'found': False,
            'message': 'No lyrics found for this track'
        })

    if response.status_code != 200:
        return jsonify({
            'found': False,
            'message': f'LRCLIB error: {response.status_code}'
        }), 400

    data = response.json()

    synced_lyrics = data.get('syncedLyrics')
    plain_lyrics = data.get('plainLyrics')

    if synced_lyrics:
        parsed = parse_lrc(synced_lyrics)
        return jsonify({
            'found': True,
            'synced': True,
            'lyrics': parsed
        })

    if plain_lyrics:
        lines = [
            {'time_ms': None, 'text': line}
            for line in plain_lyrics.strip().split('\n')
            if line.strip()
        ]
        return jsonify({
            'found': True,
            'synced': False,
            'lyrics': lines
        })

    return jsonify({
        'found': False,
        'message': 'No lyrics available for this track'
    })

if __name__ == '__main__':
    app.run(debug=True)