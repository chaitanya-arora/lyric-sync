"""What's popular around the world, for Home, the language tiles and Explore.

Apple publishes a free, keyless "most played" chart for each country's music
storefront, updated daily. Spotify no longer offers featured or editorial
playlists to new apps, so those charts are where popular-by-country comes
from; a song is matched to Spotify only when someone goes to play it.
"""
import json
import time

import requests

import db

APPLE_CHART_URL = 'https://rss.marketingtools.apple.com/api/v2/{country}/music/most-played/{limit}/songs.json'
CHART_SIZE = 25
CHART_TTL_SECONDS = 12 * 60 * 60   # Apple updates them daily
APPLE_TIMEOUT = 10
APPLE_ATTEMPTS = 3                  # its feed throws the odd 502

# The storefronts Explore offers: name, and the language most of their
# charts are sung in (DeepL codes, for colour and Top Picks).
COUNTRIES = {
    'ar': ('Argentina', 'ES'), 'au': ('Australia', 'EN'), 'br': ('Brazil', 'PT'),
    'ca': ('Canada', 'EN'), 'cl': ('Chile', 'ES'), 'co': ('Colombia', 'ES'),
    'de': ('Germany', 'DE'), 'eg': ('Egypt', 'AR'), 'es': ('Spain', 'ES'),
    'fr': ('France', 'FR'), 'gb': ('United Kingdom', 'EN'), 'gh': ('Ghana', 'EN'),
    'gr': ('Greece', 'EL'), 'hk': ('Hong Kong', 'ZH'), 'id': ('Indonesia', 'ID'),
    'ie': ('Ireland', 'EN'), 'il': ('Israel', 'HE'), 'in': ('India', 'HI'),
    'it': ('Italy', 'IT'), 'jp': ('Japan', 'JA'), 'ke': ('Kenya', 'SW'),
    'kr': ('South Korea', 'KO'), 'lk': ('Sri Lanka', 'SI'), 'ma': ('Morocco', 'AR'),
    'mx': ('Mexico', 'ES'), 'my': ('Malaysia', 'MS'), 'ng': ('Nigeria', 'EN'),
    'nl': ('Netherlands', 'NL'), 'np': ('Nepal', 'NE'), 'nz': ('New Zealand', 'EN'),
    'pe': ('Peru', 'ES'), 'ph': ('Philippines', 'TL'), 'pk': ('Pakistan', 'UR'),
    'pl': ('Poland', 'PL'), 'pt': ('Portugal', 'PT'), 'ru': ('Russia', 'RU'),
    'sa': ('Saudi Arabia', 'AR'), 'se': ('Sweden', 'SV'), 'th': ('Thailand', 'TH'),
    'tr': ('Turkey', 'TR'), 'tw': ('Taiwan', 'ZH'), 'ua': ('Ukraine', 'UK'),
    'us': ('United States', 'EN'), 'vn': ('Vietnam', 'VI'), 'za': ('South Africa', 'EN'),
}


class ChartUnavailable(Exception):
    """Apple's feed didn't answer and there's no earlier copy to fall back on."""


def artwork(url, size=300):
    """Apple's artwork URLs end in the size asked for; the feed asks for 100."""
    if not url:
        return None
    return url.replace('100x100bb', f'{size}x{size}bb')


def parse_chart(payload):
    songs = []
    for entry in (payload.get('feed') or {}).get('results') or []:
        name, artist = entry.get('name'), entry.get('artistName')
        if not name or not artist:
            continue
        songs.append({
            'song': name,
            'artist': artist,
            'album_art': artwork(entry.get('artworkUrl100')),
            'apple_id': entry.get('id'),
        })
    return songs


def fetch_from_apple(country):
    url = APPLE_CHART_URL.format(country=country, limit=CHART_SIZE)
    for attempt in range(APPLE_ATTEMPTS):
        try:
            res = requests.get(url, timeout=APPLE_TIMEOUT,
                               headers={'User-Agent': 'LyricSync'})
            if res.status_code == 200:
                return parse_chart(res.json())
        except (requests.RequestException, ValueError):
            pass
        if attempt + 1 < APPLE_ATTEMPTS:
            time.sleep(0.5 * (attempt + 1))
    return None


def chart(country):
    """The country's most played songs, from the cache while it's fresh.

    If Apple can't be reached, a stale copy is better than nothing.
    """
    with db.connect() as conn:
        row = conn.execute(
            'SELECT songs_json, fetched_at FROM charts WHERE country = ?', (country,)
        ).fetchone()
    if row and row[1] > db.now() - CHART_TTL_SECONDS:
        return json.loads(row[0])

    songs = fetch_from_apple(country)
    if songs:
        with db.connect() as conn:
            conn.execute(
                'INSERT INTO charts (country, songs_json, fetched_at) VALUES (?, ?, ?) '
                'ON CONFLICT (country) DO UPDATE SET songs_json = excluded.songs_json, '
                'fetched_at = excluded.fetched_at',
                (country, json.dumps(songs), db.now())
            )
        return songs
    if row:
        return json.loads(row[0])
    raise ChartUnavailable(country)


def match_key(song, artist):
    return f'{song.strip().lower()}\x1f{artist.strip().lower()}'


def cached_match(song, artist):
    with db.connect() as conn:
        row = conn.execute(
            'SELECT track_id FROM track_matches WHERE match_key = ?',
            (match_key(song, artist),)
        ).fetchone()
    return row[0] if row else None


def remember_match(song, artist, track_id):
    with db.connect() as conn:
        conn.execute(
            'INSERT INTO track_matches (match_key, track_id, matched_at) VALUES (?, ?, ?) '
            'ON CONFLICT (match_key) DO UPDATE SET track_id = excluded.track_id, '
            'matched_at = excluded.matched_at',
            (match_key(song, artist), track_id, db.now())
        )


def match_queries(song, artist):
    """Spotify searches to try, strictest first. Field filters find the exact
    song when the titles agree; a plain search catches "(feat. ...)" and
    other differences in how the two services title things."""
    clean_song = song.replace('"', '')
    first_artist = artist.split(',')[0].split('&')[0].split(' feat')[0].replace('"', '').strip()
    return [
        f'track:"{clean_song}" artist:"{first_artist}"',
        f'{clean_song.split(" (")[0]} {first_artist}',
    ]
