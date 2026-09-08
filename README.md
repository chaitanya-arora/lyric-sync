# LyricSync 🎵
### Multiculturalism through music

A web app that automatically translates song lyrics in real time as you listen on Spotify, so you can enjoy music in any language without missing a word.

Grew up loving Bollywood music without always understanding the lyrics. I wanted a way to *feel* a song, not just translate it, and wanted it to live inside how I already listen to music. Built for language learners, music lovers, and anyone who's ever felt an emotional connection to a song they couldn't fully understand.

---

## Try it

🔗 **[lyric-sync-production.up.railway.app](https://lyric-sync-production.up.railway.app)**

LyricSync is currently in development mode. Spotify restricts access to approved users only, capping any app in this mode at 25 total users. If you'd like to try it, **reach out to me directly** and I'll add you to the allowlist.

---

## The problem

Streaming platforms like Spotify have made global music accessible, but lyrics remain locked behind language barriers. As a music lover and aspiring polyglot, I wanted a tool that shows the original lyric and its translation simultaneously, line by line, in sync with the song.

Tools with similar real-time translation existed, but the ones I found had weak UX and stopped at translation alone. None of them treated music discovery, being introduced to songs and artists from other cultures, as part of the experience. That gap, plus wanting to build something end to end myself rather than adapt someone else's tool, is why I built my own.

---

## Features (MVP)

- 🔐 Spotify OAuth login: connects securely to your account
- 🎵 Real-time now playing detection
- 📝 Synced lyrics fetched automatically (via LRCLIB)
- 🌍 Line-by-line translation powered by DeepL
- 🎤 Karaoke-style highlighting, the current line is always front and centre
- ⚡ Translation caching, songs you've heard before load instantly
- ⏯️ Playback controls: play, pause, skip without leaving the app
- 🔄 Auto token refresh, sessions stay alive without re-authenticating
- ✨ Animated welcome screen with flags and music from around the world

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Python, Flask, served via Gunicorn |
| Auth | Spotify OAuth 2.0 |
| Lyrics | LRCLIB API |
| Translation | DeepL API |
| Cache | SQLite |
| Hosting | Railway |
| CI | GitHub Actions (lint + smoke test on every push) |

---

## Design

Designed in Figma before a single line of code was written. 12 screens including onboarding, home, search, lyrics view, and settings.

[View Figma file →](https://www.figma.com/design/UoPAiZB3V8ZwUjF9f05Yb2/LyricSync--Spotify-Lyric-Translation?node-id=0-1&t=vLragNwPRT7K2e7W-1)

Before designing any screens, I talked to bilingual listeners about how they actually experience music in a language they don't fully speak. Two findings shaped the product: people wanted a translation that sat *alongside* the original lyrics rather than replacing them, and people cared more about discovering music from unfamiliar cultures than about literal translation accuracy. That second insight is why the scope broadened from a Bollywood-specific tool into a general lyric translation app. Since the app builds directly on Spotify's own API, I also chose to align the colour scheme and overall visual language with Spotify's branding, while adding elements specific to the translation problem I was solving.

---

## Running locally

**1. Clone the repo**
```bash
git clone https://github.com/chaitanya-arora/lyric-sync.git
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

🟢 MVP complete and deployed at [lyric-sync-production.up.railway.app](https://lyric-sync-production.up.railway.app), served through Gunicorn behind a GitHub Actions CI pipeline (lint + smoke test on every push to `main`).

Currently paused as a build-out priority. The next planned step is below. In the meantime I'm applying what I learned here (rapid UX research, full-stack ownership, deployment and CI practices) to a new project.

---

## Technical decisions

**Translation provider:** For the MVP, translation targets English only. DeepL was chosen over Google Translate for noticeably more natural output, particularly for European languages like French.

> **Note on non-Latin scripts:** Songs in languages that use non-Latin scripts (e.g. Devanagari, Hangul, Kanji) generally translate well via DeepL. However, romanised versions of these languages, where non-Latin words are written in Latin characters, can be unreliable across all translation APIs, since language detection struggles with short Latin-script phrases that could belong to multiple languages. Improved handling for romanised lyrics is planned for a future version.

**Caching:** Translations are cached in SQLite keyed by track, so a song translated once loads instantly for every subsequent listen. This avoids redundant calls to the translation API and keeps the app responsive.

**Serving:** Originally served with Flask's built-in development server. Since moved to Gunicorn as the production WSGI server, with a GitHub Actions pipeline running lint checks and a smoke test (app boot and basic route check) on every push.

**Known constraint:** Spotify apps in development mode are capped at a small, fixed number of approved users. This is a platform-level limitation, not something fixable in application code, and it's the main reason the project is paused rather than actively expanding. Rather than build further on a foundation that can't scale to the people I'd actually want to share it with, I made the call to step back, apply for extended access, and in the meantime take what I learned here into a new project.

**Planned next step:** Migrating from Spotify's API to a combination of iTunes/Deezer (for metadata) and the YouTube API (for playback), which would remove the user cap entirely.

---

## Disclaimer

LyricSync is an independent personal project built to practice full-stack development. It is not affiliated with, endorsed by, or sponsored by Spotify. The app uses Spotify's public API under their developer terms, and the visual design draws inspiration from Spotify's interface conventions for a familiar user experience, but all code, design decisions, and assets beyond Spotify's own branding elements are original work.

## About

Built by Chaitanya Arora as a personal portfolio project.
