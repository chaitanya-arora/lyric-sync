# LyricSync 🎵

A web app that automatically translates song lyrics in real time as you listen on Spotify — so you can enjoy music in any language without missing a word.

Built for language learners, music lovers, and anyone who's ever felt an emotional connection to a song they couldn't fully understand.

---

## Try it

🔗 **[lyric-sync-production.up.railway.app](https://lyric-sync-production.up.railway.app)**

LyricSync is currently in development mode — Spotify restricts access to approved users only. If you'd like to try it, **reach out to me directly** and I'll add you to the allowlist (limited to 25 users total).

---

## The problem

Streaming platforms like Spotify have made global music accessible, but lyrics remain locked behind language barriers. As a music lover and aspiring polyglot, I wanted a tool that shows the original lyric and its translation simultaneously — line by line, in sync with the song.

Nothing like this existed. So I built it.

---

## Features (MVP)

- 🔐 Spotify OAuth login — connects securely to your account
- 🎵 Real-time now playing detection
- 📝 Synced lyrics fetched automatically (via LRCLIB)
- 🌍 Line-by-line translation powered by DeepL
- 🎤 Karaoke-style highlighting — the current line is always front and centre
- ⚡ Translation caching — songs you've heard before load instantly
- ⏯️ Playback controls — play, pause, skip without leaving the app
- 🔄 Auto token refresh — sessions stay alive without re-authenticating
- ✨ Animated welcome screen with flags and music from around the world

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Python, Flask |
| Auth | Spotify OAuth 2.0 |
| Lyrics | LRCLIB API |
| Translation | DeepL API |
| Cache | SQLite |
| Hosting | Railway |

---

## Design

Designed in Figma before a single line of code was written. 12 screens including onboarding, home, search, lyrics view, and settings.

[View Figma file →](https://www.figma.com/design/UoPAiZB3V8ZwUjF9f05Yb2/LyricSync--Spotify-Lyric-Translation?node-id=0-1&t=vLragNwPRT7K2e7W-1)

---

## Running locally

**1. Clone the repo**
```bash
git clone https://github.com/yourusername/lyric-sync.git
cd lyric-sync
```

**2. Create a virtual environment**
```bash
python3 -m venv venv
source venv/bin/activate
```

**3. Install dependencies**
```bash
pip install -r requirements.txt
```

**4. Create a `.env` file in the `backend/` folder**
```
SPOTIFY_CLIENT_ID=your_id
SPOTIFY_CLIENT_SECRET=your_secret
SPOTIFY_REDIRECT_URI=http://localhost:5000/callback
DEEPL_API_KEY=your_key
FLASK_SECRET_KEY=any_fixed_string
```

**5. Run the backend**
```bash
cd backend
python app.py
```

**6. Visit `http://127.0.0.1:5000/`**

---

## Project status

🟢 MVP complete — deployed at [lyric-sync-production.up.railway.app](https://lyric-sync-production.up.railway.app)

---

## Technical decisions

For the MVP, translation targets English only. DeepL was chosen over Google Translate for noticeably more natural output, particularly for European languages like French.

# LyricSync 🎵

A web app that automatically translates song lyrics in real time as you listen on Spotify — so you can enjoy music in any language without missing a word.

Built for language learners, music lovers, and anyone who's ever felt an emotional connection to a song they couldn't fully understand.

---

## Try it

🔗 **[lyric-sync-production.up.railway.app](https://lyric-sync-production.up.railway.app)**

LyricSync is currently in development mode — Spotify restricts access to approved users only. If you'd like to try it, **reach out to me directly** and I'll add you to the allowlist (limited to 25 users total).

---

## The problem

Streaming platforms like Spotify have made global music accessible, but lyrics remain locked behind language barriers. As a music lover and aspiring polyglot, I wanted a tool that shows the original lyric and its translation simultaneously — line by line, in sync with the song.

Nothing like this existed. So I built it.

---

## Features (MVP)

- 🔐 Spotify OAuth login — connects securely to your account
- 🎵 Real-time now playing detection
- 📝 Synced lyrics fetched automatically (via LRCLIB)
- 🌍 Line-by-line translation powered by DeepL
- 🎤 Karaoke-style highlighting — the current line is always front and centre
- ⚡ Translation caching — songs you've heard before load instantly
- ⏯️ Playback controls — play, pause, skip without leaving the app
- 🔄 Auto token refresh — sessions stay alive without re-authenticating
- ✨ Animated welcome screen with flags and music from around the world

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Python, Flask |
| Auth | Spotify OAuth 2.0 |
| Lyrics | LRCLIB API |
| Translation | DeepL API |
| Cache | SQLite |
| Hosting | Railway |

---

## Design

Designed in Figma before a single line of code was written. 12 screens including onboarding, home, search, lyrics view, and settings.

[View Figma file →](https://www.figma.com/design/UoPAiZB3V8ZwUjF9f05Yb2/LyricSync--Spotify-Lyric-Translation?node-id=0-1&t=vLragNwPRT7K2e7W-1)

---

## Running locally

**1. Clone the repo**
```bash
git clone https://github.com/yourusername/lyric-sync.git
cd lyric-sync
```

**2. Create a virtual environment**
```bash
python3 -m venv venv
source venv/bin/activate
```

**3. Install dependencies**
```bash
pip install -r requirements.txt
```

**4. Create a `.env` file in the `backend/` folder**
```
SPOTIFY_CLIENT_ID=your_id
SPOTIFY_CLIENT_SECRET=your_secret
SPOTIFY_REDIRECT_URI=http://localhost:5000/callback
DEEPL_API_KEY=your_key
FLASK_SECRET_KEY=any_fixed_string
```

**5. Run the backend**
```bash
cd backend
python app.py
```

**6. Visit `http://127.0.0.1:5000/`**

---

## Project status

🟢 MVP complete — deployed at [lyric-sync-production.up.railway.app](https://lyric-sync-production.up.railway.app)

---

## Technical decisions

For the MVP, translation targets English only. DeepL was chosen over Google Translate for noticeably more natural output, particularly for European languages like French.

> **Note on non-Latin scripts:** Songs in languages that use non-Latin scripts (e.g. Devanagari, Hangul, Kanji) generally translate well via DeepL. However, romanised versions of these languages — where non-Latin words are written in Latin characters — can be unreliable across all translation APIs, as language detection struggles with short Latin-script phrases that could belong to multiple languages. Improved handling for romanised lyrics is planned for a future version.

---

## About

Built by Chaitanya Arora as a personal portfolio project.
