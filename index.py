"""Vercel's way in: it looks for a Flask `app` in a file like this one at the
top of the repo. The app itself lives in backend/, which imports its
neighbours (db, discover) by plain name, so that folder goes on the path.
Locally, run backend/app.py as before.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app import app  # noqa: E402,F401
