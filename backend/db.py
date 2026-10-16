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

DATABASE_URL = os.getenv('DATABASE_URL')
SQLITE_PATH = os.path.join(os.path.dirname(__file__), 'translations.db')

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


def init_db():
    with connect() as conn:
        for statement in SCHEMA:
            conn.execute(statement)
        if not DATABASE_URL:
            # Local files made before timestamps became epoch seconds hold
            # text dates, which SQLite sorts above every number — they would
            # count as fresh misses for ever.
            conn.execute(
                "DELETE FROM lyrics_misses WHERE typeof(checked_at) <> 'integer'")
