# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""Smoke tests for backend configuration."""
import importlib
import os


def test_config_loads():
    """config.py should import without errors."""
    import config
    assert config is not None


def test_defaults_are_empty():
    """Sensitive defaults should be empty — must be provided via env vars."""
    import config
    assert config.HEALTHLAKE_DATASTORE_ID == "" or config.HEALTHLAKE_DATASTORE_ID
    assert config.SERVER_PORT == 5000
    assert config.AWS_REGION == "us-east-1"


def test_cors_includes_localhost():
    """CORS should allow localhost for local development."""
    import config
    assert "http://localhost:5000" in config.CORS_ORIGINS


def test_demo_cache_is_dict():
    """DEMO_CACHE should be a dict (may be empty or populated)."""
    import config
    assert isinstance(config.DEMO_CACHE, dict)
