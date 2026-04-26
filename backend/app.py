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
        'artist': ','.join([a['name'] for a in track['artists']]),
        'album': track['album']['name'],
        'album_art': track['album']['images'][0]['url'],
        'progress_ms': data['progress_ms'], # will be used to sync lyrics (original + autotranslations)
        'duration_ms': track['duration_ms'],
        'track_id': track['id'] # will be useful when storing recently translated songs 
        })

if __name__ == '__main__':
    app.run(debug=True)