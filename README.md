# LyricSync 🎵

A web app that automatically translates song lyrics in real time as you listen on Spotify — so you can enjoy music in any language without missing a word.

Built for language learners, music lovers, and anyone who's ever felt an emotional connection to a song they couldn't fully understand.

---

## The problem

Streaming platforms like Spotify have made global music accessible, but lyrics remain locked behind language barriers. As an music lover and aspiring polygot, I wanted a tool that shows the original lyric and its translation simultaneously — line by line, in sync with the song.

Nothing like this existed. So I built it.

---

## Features (MVP)

- Spotify OAuth login — connects securely to your account
- Real-time now playing detection
- Synced lyrics fetched automatically (via LRCLIB)
- Line-by-line translation powered by DeepL
- Karaoke-style highlighting — the current line is always front and centre
- Translation caching — songs you've heard before load instantly
- Language selector — French, Hindi, Korean, and more

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Python, Flask |
| Auth | Spotify OAuth 2.0 |
| Lyrics | LRCLIB API |
| Translation | DeepL API |
| Hosting | Railway (backend) + Vercel (frontend) |

---

## Design

Designed in Figma before a single line of code was written. 12 screens including onboarding, home, search, lyrics view, and settings.

Link to Figma file: https://www.figma.com/design/UoPAiZB3V8ZwUjF9f05Yb2/LyricSync--Spotify-Lyric-Translation?node-id=0-1&t=vLragNwPRT7K2e7W-1 

---

## Running locally

1. Clone the repo: 
     git clone https://github.com/yourusername/lyric-sync.git
     cd lyric-sync

3. Create a virtual environment
     python3 -m venv venv
     source venv/bin/activate

4. Install dependencies
     pip install -r requirements.txt

5. Create a .env file in the root with your credentials
    SPOTIFY_CLIENT_ID=your_id
    SPOTIFY_CLIENT_SECRET=your_secret
    SPOTIFY_REDIRECT_URI=http://localhost:5000/callback
    DEEPL_API_KEY=your_key
    FLASK_SECRET_KEY=your_secret_key

7. Run the backend
     cd backend
     python app.py

8. Visit http://127.0.0.1:5000/

---

## Project status

🟡 In progress — currently building Karaoke-style lyrics UI synced to playback

---

## Technical decisions

For the MVP, I have chosen to focus on building functionality for French -> English translation and then extend to other languages. This is why I chose to use DeepL over Google Translate to handle lyric translation as DeepL produces noticeably more natural translations for European languages, particularly French. 

**Hindi translation:** Songs with Devanagari script (e.g. Kesariya)
translate well via DeepL, with occasional misdetection between Hindi
(HI) and the closely related Maithili (MAI) on certain phrases.
Romanised Hindi (Hinglish) is unreliable across all translation APIs
as language detection fails on short Latin-script phrases. A
preprocessing step for Hinglish is planned for version 2.
---

## About

Built by Chaitanya Arora as a personal portfolio project.
