"""Unit tests for LyricSync's backend.

Run with: pytest backend/tests/ -v
"""
from app import app, parse_lrc


# --- parse_lrc tests ---

def test_parse_lrc_basic_line():
    lrc = "[00:12.50]Hello world"
    result = parse_lrc(lrc)
    assert len(result) == 1
    assert result[0]['text'] == 'Hello world'
    assert result[0]['time_ms'] == 12500


def test_parse_lrc_multiple_lines_in_order():
    lrc = "[00:01.00]First line\n[00:05.00]Second line"
    result = parse_lrc(lrc)
    assert len(result) == 2
    assert result[0]['text'] == 'First line'
    assert result[1]['text'] == 'Second line'
    assert result[0]['time_ms'] < result[1]['time_ms']


def test_parse_lrc_minutes_and_seconds():
    lrc = "[02:30.00]Two minutes thirty seconds in"
    result = parse_lrc(lrc)
    expected_ms = (2 * 60 * 1000) + (30 * 1000)
    assert result[0]['time_ms'] == expected_ms


def test_parse_lrc_ignores_blank_lines():
    lrc = "[00:01.00]First line\n\n\n[00:02.00]Second line"
    result = parse_lrc(lrc)
    assert len(result) == 2


def test_parse_lrc_ignores_lines_without_timestamp():
    lrc = "This is a header with no timestamp\n[00:01.00]Actual lyric"
    result = parse_lrc(lrc)
    assert len(result) == 1
    assert result[0]['text'] == 'Actual lyric'


def test_parse_lrc_ignores_empty_lyric_text():
    lrc = "[00:01.00]\n[00:02.00]Real lyric here"
    result = parse_lrc(lrc)
    assert len(result) == 1
    assert result[0]['text'] == 'Real lyric here'


def test_parse_lrc_handles_malformed_timestamp_gracefully():
    lrc = "[not-a-timestamp]Should be skipped\n[00:03.00]Valid line"
    result = parse_lrc(lrc)
    assert len(result) == 1
    assert result[0]['text'] == 'Valid line'


def test_parse_lrc_missing_hundredths_defaults_to_zero():
    lrc = "[00:05]No hundredths given"
    result = parse_lrc(lrc)
    assert len(result) == 1
    assert result[0]['time_ms'] == 5000


def test_parse_lrc_empty_input_returns_empty_list():
    assert parse_lrc("") == []


# --- Flask app smoke tests ---

def test_app_boots():
    assert app is not None


def test_home_route_returns_200(client):
    resp = client.get('/')
    assert resp.status_code == 200


def test_me_route_without_session_is_unauthorized_or_redirect(client):
    """Without a logged-in session, /me should not silently succeed."""
    resp = client.get('/me')
    assert resp.status_code in (401, 302, 403)
