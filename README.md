# LyricSync 🎵

A web app that automatically translates song lyrics in real time 
as you listen on Spotify — so you can enjoy music in any language 
without missing a word.

Built for language learners, music lovers, and anyone who's ever 
felt an emotional connection to a song they couldn't fully understand.

---

## The problem

Streaming platforms like Spotify have made global music accessible, 
but lyrics remain locked behind language barriers. As an 
Australian-Indian who grew up loving Bollywood, and someone learning 
French through music, I wanted a tool that shows the original lyric 
and its translation simultaneously — line by line, in sync with 
the song.

Nothing like this existed. So I built it.

---

## Features (MVP)

- Spotify OAuth login — connects securely to your account
- Real-time now playing detection
- Synced lyrics fetched automatically (via LRCLIB)
- Line-by-line translation powered by DeepL
- Karaoke-style highlighting — the current line is always front 
  and centre
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

Designed in Figma before a single line of code was written. 
12 screens including onboarding, home, search, lyrics view, 
and settings.

Link to Figma file: https://www.figma.com/design/UoPAiZB3V8ZwUjF9f05Yb2/LyricSync--Spotify-Lyric-Translation?node-id=0-1&t=vLragNwPRT7K2e7W-1 

---

## Running locally

1. Clone the repo
   git clone https://github.com/yourusername/lyric-sync.git
   cd lyric-sync

2. Create a virtual environment
   python3 -m venv venv
   source venv/bin/activate

3. Install dependencies
   pip install -r requirements.txt

4. Create a .env file in the root with your credentials
   SPOTIFY_CLIENT_ID=your_id
   SPOTIFY_CLIENT_SECRET=your_secret
   SPOTIFY_REDIRECT_URI=http://localhost:5000/callback
   DEEPL_API_KEY=your_key

5. Run the backend
   cd backend
   python app.py

6. Visit http://localhost:5000

---

## Project status

🟡 In progress — currently building Layer 5 (Getting real time lyrics for language translation)

---

## About

Built by Cherry Arora as a personal portfolio project.
Motivated by a genuine love of French music and Bollywood,
and a frustration that the tools to bridge language gaps 
in music didn't exist.
