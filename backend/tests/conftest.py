"""Shared pytest setup.

Puts backend/ on the import path so tests can `from app import ...` whatever
directory pytest was started from, and hands tests a Flask client.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as app_module  # noqa: E402  (needs the path set above)
import db  # noqa: E402

# Storage tests run on SQLite always, and on Postgres too when
# TEST_DATABASE_URL points at a database they're free to wipe (CI sets one).
DATABASES = ['sqlite'] + (['postgres'] if os.getenv('TEST_DATABASE_URL') else [])


@pytest.fixture
def client(monkeypatch):
    # CI has no .env, and sessions (OAuth state, logout) need a signing key
    monkeypatch.setattr(app_module.app, 'secret_key', 'test-secret')
    return app_module.app.test_client()


@pytest.fixture(params=DATABASES)
def database(request, monkeypatch, tmp_path):
    """An empty database for one test, never the real cache."""
    if request.param == 'postgres':
        import psycopg
        url = os.environ['TEST_DATABASE_URL']
        with psycopg.connect(url) as conn:
            conn.execute('DROP SCHEMA public CASCADE')
            conn.execute('CREATE SCHEMA public')
        monkeypatch.setattr(db, 'DATABASE_URL', url)
    else:
        monkeypatch.setattr(db, 'DATABASE_URL', None)
        monkeypatch.setattr(db, 'SQLITE_PATH', str(tmp_path / 'test.db'))
    db.init_db()
    return request.param


@pytest.fixture
def spotify(monkeypatch):
    """Stand in for a logged-in Spotify session.

    Returns the app module so a test can swap out spotify_get/put/post. Nothing
    here touches the network or needs real credentials.
    """
    monkeypatch.setattr(app_module, 'get_access_token', lambda: 'test-token')
    return app_module


class FakeResponse:
    """The slice of requests.Response that the app actually uses."""

    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        if self._payload is None:
            raise ValueError('no JSON body')
        return self._payload


def make_track(track_id, name):
    return {
        'id': track_id,
        'name': name,
        'type': 'track',
        'artists': [{'name': 'An Artist'}],
        'album': {'images': [{'url': f'https://art.example/{track_id}'}]},
        'duration_ms': 210000,
    }
