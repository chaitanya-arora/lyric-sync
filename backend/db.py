"""Where LyricSync keeps what it remembers.

Postgres when DATABASE_URL is set — on Railway, where the filesystem is wiped
on every deploy and a SQLite file would lose the cache each time. Otherwise a
SQLite file next to app.py, so local dev and the tests need no database
server. The SQL below is written to run unchanged on both.
"""
import os
import sqlite3
import time
from contextlib import contextmanager

# Neon on Vercel sets both names; some setups only POSTGRES_URL
DATABASE_URL = os.getenv('DATABASE_URL') or os.getenv('POSTGRES_URL')
SQLITE_PATH = os.path.join(os.path.dirname(__file__), 'translations.db')
if os.getenv('VERCEL') and not DATABASE_URL:
    # Vercel's filesystem is read-only apart from /tmp, and /tmp doesn't
    # last: this only keeps a deploy without a database from crashing.
    SQLITE_PATH = '/tmp/translations.db'

SCHEMA = [
    # translated lyrics, shared by everyone — keyed "{track_id}_{target_lang}"
    '''CREATE TABLE IF NOT EXISTS translations (
        cache_key TEXT PRIMARY KEY,
        lyrics_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''',
    # tracks LRCLIB had nothing for, so a replay doesn't ask it again
    '''CREATE TABLE IF NOT EXISTS lyrics_misses (
        track_id TEXT PRIMARY KEY,
        checked_at BIGINT
    )''',
    # one row per Spotify account, carrying its preferences
    '''CREATE TABLE IF NOT EXISTS users (
        spotify_id TEXT PRIMARY KEY,
        display_name TEXT,
        target_lang TEXT NOT NULL DEFAULT 'EN',
        auto_translate BOOLEAN NOT NULL DEFAULT TRUE,
        created_at BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL
    )''',
    # songs each user has listened to with translations — Recently Translated
    '''CREATE TABLE IF NOT EXISTS listen_history (
        spotify_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        song TEXT NOT NULL,
        artist TEXT NOT NULL,
        album_art TEXT,
        source_lang TEXT,
        target_lang TEXT,
        play_count INTEGER NOT NULL DEFAULT 1,
        last_played_at BIGINT NOT NULL,
        PRIMARY KEY (spotify_id, track_id)
    )''',
    '''CREATE INDEX IF NOT EXISTS listen_history_recent
        ON listen_history (spotify_id, last_played_at)''',
    '''CREATE TABLE IF NOT EXISTS favourites (
        spotify_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        song TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        album_art TEXT,
        duration_ms INTEGER,
        source_lang TEXT,
        added_at BIGINT NOT NULL,
        PRIMARY KEY (spotify_id, track_id)
    )''',
    # each country's most played songs from Apple, refreshed twice a day
    '''CREATE TABLE IF NOT EXISTS charts (
        country TEXT PRIMARY KEY,
        songs_json TEXT NOT NULL,
        fetched_at BIGINT NOT NULL
    )''',
    # a chart song's Spotify track, found once and remembered
    '''CREATE TABLE IF NOT EXISTS track_matches (
        match_key TEXT PRIMARY KEY,
        track_id TEXT NOT NULL,
        matched_at BIGINT NOT NULL
    )''',
    # which Spotify account a sign-in belongs to, by a hash of its refresh
    # token — so a session that loses its user id gets it back without
    # asking Spotify, which may be rate-limiting us
    '''CREATE TABLE IF NOT EXISTS logins (
        token_hash TEXT PRIMARY KEY,
        spotify_id TEXT NOT NULL,
        created_at BIGINT NOT NULL
    )''',
    # songs people asked us to find lyrics for
    '''CREATE TABLE IF NOT EXISTS song_requests (
        spotify_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        song TEXT NOT NULL,
        artist TEXT NOT NULL,
        requested_at BIGINT NOT NULL,
        PRIMARY KEY (spotify_id, track_id)
    )''',
]


# Columns added after a table first shipped. CREATE TABLE IF NOT EXISTS
# leaves an existing table alone, so these are added where they're missing.
COLUMNS_ADDED = [
    # finished the welcome steps, including choosing a language
    ('users', 'onboarded', 'BOOLEAN NOT NULL DEFAULT FALSE'),
]


def now():
    """Timestamps are stored as epoch seconds: the one format both databases
    compare and sort the same way."""
    return int(time.time())


class Connection:
    """Wraps either driver behind one execute() taking '?' placeholders."""

    def __init__(self, conn, postgres):
        self._conn = conn
        self._postgres = postgres

    def execute(self, sql, params=()):
        if self._postgres:
            sql = sql.replace('?', '%s')
        return self._conn.execute(sql, params)


@contextmanager
def connect():
    """A connection that commits when the block finishes, or rolls back if it
    raises."""
    if DATABASE_URL:
        import psycopg   # only needed where Postgres is configured
        with psycopg.connect(DATABASE_URL) as conn:
            yield Connection(conn, postgres=True)
        return

    conn = sqlite3.connect(SQLITE_PATH)
    try:
        with conn:
            yield Connection(conn, postgres=False)
    finally:
        conn.close()


def column_exists(conn, table, column):
    if DATABASE_URL:
        return conn.execute(
            'SELECT 1 FROM information_schema.columns '
            'WHERE table_name = ? AND column_name = ?',
            (table, column)
        ).fetchone() is not None
    rows = conn.execute(f'PRAGMA table_info({table})').fetchall()
    return any(row[1] == column for row in rows)


def init_db():
    with connect() as conn:
        for statement in SCHEMA:
            conn.execute(statement)
        for table, column, definition in COLUMNS_ADDED:
            if not column_exists(conn, table, column):
                # names come from the fixed list above, never from a request
                conn.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')
        if not DATABASE_URL:
            # Local files made before timestamps became epoch seconds hold
            # text dates, which SQLite sorts above every number — they would
            # count as fresh misses for ever.
            conn.execute(
                "DELETE FROM lyrics_misses WHERE typeof(checked_at) <> 'integer'")
