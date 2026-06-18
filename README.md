LyricSync 🎵
A web app that automatically translates song lyrics in real time as you listen on Spotify — so you can enjoy music in any language without missing a word.
Built for language learners, music lovers, and anyone who's ever felt an emotional connection to a song they couldn't fully understand.

Try it
🔗 lyric-sync-production.up.railway.app
LyricSync is currently in development mode — Spotify restricts access to approved users only. If you'd like to try it, reach out to me directly and I'll add you to the allowlist (limited to 25 users total).

The problem
Streaming platforms like Spotify have made global music accessible, but lyrics remain locked behind language barriers. As a music lover and aspiring polyglot, I wanted a tool that shows the original lyric and its translation simultaneously — line by line, in sync with the song.
Nothing like this existed. So I built it.

Features (MVP)

Spotify OAuth login — connects securely to your account
Real-time now playing detection
Synced lyrics fetched automatically (via LRCLIB)
Line-by-line translation powered by DeepL
Karaoke-style highlighting — the current line is always front and centre
Translation caching — songs you've heard before load instantly
Playback controls — play, pause, skip without leaving the app
Auto token refresh — sessions stay alive without re-authenticating
Animated welcome screen with flags and music from around the world


Tech stack
LayerTechnologyFrontendHTML, CSS, JavaScriptBackendPython, FlaskAuthSpotify OAuth 2.0LyricsLRCLIB APITranslationDeepL APICacheSQLiteHostingRailway

Design
Designed in Figma before a single line of code was written. 12 screens including onboarding, home, search, lyrics view, and settings.
View Figma file →

Running locally

Clone the repo:

bashgit clone https://github.com/yourusername/lyric-sync.git
cd lyric-sync

Create a virtual environment:

bashpython3 -m venv venv
source venv/bin/activate

Install dependencies:

bashpip install -r requirements.txt

Create a .env file in the backend/ folder with your credentials:

SPOTIFY_CLIENT_ID=your_id
SPOTIFY_CLIENT_SECRET=your_secret
SPOTIFY_REDIRECT_URI=http://localhost:5000/callback
DEEPL_API_KEY=your_key
FLASK_SECRET_KEY=any_fixed_string

Run the backend:

bashcd backend
python app.py

Visit http://127.0.0.1:5000/


Project status
🟢 MVP complete — deployed at lyric-sync-production.up.railway.app

Technical decisions
For the MVP, translation targets English only. DeepL was chosen over Google Translate for noticeably more natural output, particularly for European languages like French.
Note on Hindi: Songs with Devanagari script (e.g. Kesariya) translate well via DeepL, with occasional misdetection between Hindi (HI) and closely related dialects (MAI) on certain phrases. Romanised Hindi (Hinglish) is unreliable across all translation APIs as language detection fails on short Latin-script phrases. A preprocessing step for Hinglish is planned for a future version.

About
Built by Chaitanya Arora as a personal portfolio project.
