# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""
Demo Mode — Cache Layer

When the frontend sends `X-Demo-Mode: true` header, the backend returns cached
responses instead of calling live APIs. This allows reliable demos without
depending on API availability, credentials, or network latency.

Recording: Set DEMO_RECORD=true env var to capture live API responses into the cache.
"""

import json
import os
import hashlib

CACHE_DIR = os.path.join(os.path.dirname(__file__), 'demo_cache')

# Ensure cache directory exists
os.makedirs(CACHE_DIR, exist_ok=True)

# Whether to record live responses into cache
DEMO_RECORD = os.environ.get('DEMO_RECORD', 'false').lower() == 'true'


def is_demo_request():
    """Check if the current request has the demo mode header."""
    from flask import request
    return request.headers.get('X-Demo-Mode', '').lower() == 'true'


def _cache_key(endpoint, identifier=''):
    """Generate a cache filename from endpoint and identifier."""
    safe_id = identifier[:16] if identifier else 'default'
    safe_endpoint = endpoint.replace('/', '_').strip('_')
    return f"{safe_endpoint}_{safe_id}.json"


def get_cached_response(endpoint, identifier=''):
    """Return cached JSON response if available, else None."""
    filename = _cache_key(endpoint, identifier)
    filepath = os.path.join(CACHE_DIR, filename)
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            print(f"[DEMO] Cache hit: {filename}")
            return data
        except Exception as e:
            print(f"[DEMO] Cache read error for {filename}: {e}")
    return None


def save_to_cache(endpoint, identifier, data):
    """Save a response to the cache (used in record mode)."""
    if not DEMO_RECORD:
        return
    filename = _cache_key(endpoint, identifier)
    filepath = os.path.join(CACHE_DIR, filename)
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, default=str)
        print(f"[DEMO] Recorded: {filename}")
    except Exception as e:
        print(f"[DEMO] Cache write error for {filename}: {e}")
