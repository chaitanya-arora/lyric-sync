"""Shared pytest setup.

Puts backend/ on the import path so tests can `from app import ...` whatever
directory pytest was started from, and hands tests a Flask client.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as app_module  # noqa: E402  (needs the path set above)


@pytest.fixture
def client():
    return app_module.app.test_client()


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

    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload

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
