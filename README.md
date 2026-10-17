# LyricSync
### Multiculturalism through music

A web app that translates song lyrics in real time as you listen on Spotify, line by line and in sync with the song, and helps you find music from around the world in languages you don't speak yet.

I grew up loving Bollywood music without always understanding the lyrics. I wanted a way to *feel* a song, not just translate it, and I wanted it to live inside how I already listen to music.

Built for language learners, music lovers, and anyone who's ever felt an emotional connection to a song they couldn't fully understand.

**Live:** [lyric-sync-production.up.railway.app](https://lyric-sync-production.up.railway.app)

LyricSync runs in Spotify's development mode, which caps an app at 5 manually approved users. If you'd like to try it, **reach out to me directly** and I'll add you to the allowlist.

---

## The problem

Streaming platforms like Spotify have made global music accessible, but lyrics remain locked behind language barriers. As a music lover and aspiring polyglot, I wanted a tool that shows the original lyric and its translation together, line by line, in sync with the song.

Tools with similar real-time translation existed, but the ones I found had weak UX and stopped at translation alone. None of them treated music discovery, being introduced to songs and artists from other cultures, as part of the experience. That gap, plus wanting to build something end to end myself rather than adapt someone else's tool, is why I built my own.

---

## Features

**Lyrics, understood**
- Synced lyrics for whatever's playing on Spotify, with each line's translation underneath and the current line highlighted
- Translation into 25 languages (English by default), set once in Settings
- Romanised Hindi and Punjabi detected and translated properly, where translation services usually give up
- Every language has its own colour, which Now Playing and the player take on while that language is playing
- A per-song timing nudge for lyrics that run a beat early or late

**A full player**
- Play, pause, skip, seek, shuffle, repeat, volume, queue, and switching between your Spotify devices
- Plays in the browser itself through Spotify's Web Playback SDK (Premium)
- A paused song stays on screen for an hour and picks up where it left off, even after Spotify has let the device go

**Discovering music**
- **Home** greets you in the language you listen to most, with Jump back in, nine language tiles, and Top picks in your languages
- **Explore:** spin a 3D globe, land on a country, and hear what's most played there today
- **Chart pages** for 45 countries, each with a photo of the place
- **Search** across Spotify
- A **music passport** with a stamp for every language you've listened in, and a small celebration the first time you hear a new one

**Yours**
- Recently Translated, filterable by language, and a Favourites playlist
- Your Spotify playlists, albums and podcasts in the sidebar
- Settings and history follow your Spotify account across devices
- Keyboard shortcuts: Space, ← →, L, T, [ ], /

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript, [globe.gl](https://globe.gl) for Explore |
| Backend | Python, Flask, served by Gunicorn |
| Database | PostgreSQL in production, SQLite locally |
| Auth & playback | Spotify OAuth 2.0, Web API and Web Playback SDK |
| Lyrics | [LRCLIB](https://lrclib.net) |
| Translation | [DeepL](https://www.deepl.com) |
| Charts | Apple Music's public most-played charts, matched to Spotify on demand |
| Hosting | Railway, auto-deployed from `main` |
| CI | GitHub Actions: flake8 and the full test suite, against SQLite and Postgres |

---

## Design

Designed in Figma before a single line of code was written: 12 screens including onboarding, home, search, lyrics view, and settings.

[View Figma file →](https://www.figma.com/design/UoPAiZB3V8ZwUjF9f05Yb2/LyricSync--Spotify-Lyric-Translation?node-id=0-1&t=vLragNwPRT7K2e7W-1)

Before designing any screens, I talked to bilingual listeners about how they actually experience music in a language they don't fully speak. Two findings shaped the product: people wanted a translation that sat *alongside* the original lyrics rather than replacing them, and people cared more about discovering music from unfamiliar cultures than about literal translation accuracy. That second insight is why the scope broadened from a Bollywood-specific tool into a general lyric translation app.

The layout keeps the familiar shape of a music player (sidebar, main view, player bar) so it's easy to pick up. The look is LyricSync's own: the nine bright colours from the Figma's Browse All tiles, one per language, drawn as soft radial "bubbles"; Righteous for headings with Inter for everything you read; languages shown in their own scripts; and drawn icons rather than emoji.

---

## Running locally

**1. Clone and set up**
```bash
git clone https://github.com/chaitanya-arora/lyric-sync.git
cd lyric-sync
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**2. Add your keys**
```bash
cp .env.example .env
```
Fill in `.env` with a Spotify app's client ID and secret, a DeepL API key, and any fixed secret string. On the [Spotify dashboard](https://developer.spotify.com/dashboard), add `http://127.0.0.1:5000/callback` as a redirect URI and enable the Web API and Web Playback SDK.

Without `DATABASE_URL`, everything is kept in a local SQLite file, so there's no database to install.

**3. Run**
```bash
python backend/app.py
```
Then open **http://127.0.0.1:5000**. Use `127.0.0.1` rather than `localhost`, both in the redirect URI (Spotify only accepts loopback IPs for local redirects) and in the browser, because sign-in checks that it comes back to the same site that started it.

---

## Tests

```bash
pip install -r requirements-dev.txt
pytest backend/tests
flake8 backend
```

Spotify, LRCLIB, DeepL and Apple are stubbed, so the suite needs no keys or network. Database tests run on SQLite. Set `TEST_DATABASE_URL` to a Postgres database to run them against Postgres too, as CI does.

---

## Project structure

```
backend/
  app.py            Flask app: Spotify sign-in and API calls, lyrics, translation, user data
  db.py             Postgres or SQLite, behind one small interface
  discover.py       Country charts and matching their songs to Spotify
  romanised.py      Spotting romanised Hindi and Punjabi
  templates/        The single page
  static/
    app.js          Everything in the browser
    style.css       Design tokens and styles
    places.js       A credited photo for each country's chart page
  tests/            pytest suite
Procfile            How Railway starts Gunicorn
```

---

## Technical decisions

**Tech stack:** This was my first real end-to-end project, so I chose Flask and vanilla JavaScript deliberately: something lightweight that built on skills I already had, rather than learning a new framework and full-stack development at the same time.

**Translation provider:** DeepL was chosen over Google Translate for noticeably more natural output, particularly for European languages like French.

**Romanised lyrics:** Songs in non-Latin scripts (Devanagari, Hangul, Kanji) translate well through DeepL. Romanised lyrics, the same languages written in Latin letters, don't: auto-detection mistakes them for other languages. LyricSync counts words that only appear in romanised Hindi or Punjabi across the whole song, then tells DeepL the source language, which makes the translations come back properly.

**Storage:** Translations are cached in Postgres and shared between users, so a song translated once loads instantly for everyone after. Each user's history, favourites and settings are stored against their Spotify account. Locally the same SQL runs on SQLite, so development needs no database server.

**Discovery without editorial playlists:** Spotify no longer gives new apps its featured or editorial playlists, so the charts come from Apple's free most-played chart for each country. They're cached for 12 hours, and a chart song is matched to Spotify only when someone plays it.

**Being a good API citizen:** The app asks Spotify less often while paused or in a background tab, waits out short rate limits, and treats "Spotify is busy" differently from "you're signed out", so a slow moment never asks you to reconnect.

**Known constraint:** Spotify apps in development mode are capped at 5 approved users. That's a platform limit, not something application code can fix, and it's the main thing standing between LyricSync and more people. Moving metadata to iTunes or Deezer and playback to YouTube would remove the cap, and is the planned next step for sharing it widely.

---

## Testing & deployment

Backend logic and API routes are covered by a pytest suite of 200+ tests, run by GitHub Actions on every push and pull request, against both SQLite and Postgres. The app auto-deploys to Railway on every commit to `main`, so what's live always reflects the latest tested code.

Beyond automated tests, I use LyricSync myself daily and have shared it with a few friends. That real usage surfaces edge cases and awkward UX flows that tests don't catch.

---

## What's next

- Moving off Spotify's API to remove the 5-user cap
- A mobile app
- Recommendations: songs in the language you're listening to, from similar artists, one tap from your queue

---

## Credits

- Lyrics from [LRCLIB](https://lrclib.net), translations by [DeepL](https://www.deepl.com)
- Country charts from Apple Music's public RSS feeds
- Place photos from [Wikimedia Commons](https://commons.wikimedia.org), each credited in the app with its photographer and licence
- Flags by [flag-icons](https://github.com/lipis/flag-icons) (MIT), globe by [globe.gl](https://globe.gl) (MIT)
- Fonts: [Righteous](https://fonts.google.com/specimen/Righteous) and [Inter](https://fonts.google.com/specimen/Inter) (SIL Open Font License)

## Disclaimer

LyricSync is an independent personal project, not affiliated with, endorsed by, or sponsored by Spotify or Apple. It uses Spotify's public API under their developer terms. All code and design beyond those services' own content is original work.

## About

Built by Chaitanya Arora as a personal portfolio project. Released under the [MIT License](LICENSE).
