from flask import Flask, redirect, request, session, jsonify
from dotenv import load_dotenv
import os 
import requests
import urllib.parse
import secrets

load_dotenv()

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)

SPOTIFY_CLIENT_ID = os.getenv('SPOTIFY_CLIENT_ID')
SPOTIFY_CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET')
SPOTIFY_REDIRECT_URI = os.getenv('SPOTIFY_REDIRECT_URI')

SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
SPOTIFY_API_URL = 'https://api.spotify.com/v1'

SCOPE = 'user-read-currently-playing'

@app.route('/')
def home():
    return 'LyricSync is alive!'

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

    return jsonify(response.json())

if __name__ == '__main__':
    app.run(debug=True)