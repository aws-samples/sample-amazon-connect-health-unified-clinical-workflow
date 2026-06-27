# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""
Cognito JWT Authentication for Amazon Connect Health Demo

Validates ID tokens from Cognito User Pool on all /api/* endpoints.
Skipped for:
  - Local development when Cognito env vars are not set
  - Health check endpoint (/api/health)
  - Static file serving (/, /<path>)

Note: Demo mode (X-Demo-Mode header) does NOT bypass authentication.
Authenticated demo requests return cached data from individual endpoints.
"""

import json
import time
import hmac
import hashlib
import base64
import struct
import os
import requests as http_requests
from functools import wraps, lru_cache
from flask import request, jsonify

# Cognito config — set via environment variables
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "")
COGNITO_REGION = os.environ.get("COGNITO_REGION", os.environ.get("AWS_REGION", "us-east-1"))

# Paths that skip authentication
SKIP_AUTH_PATHS = {"/api/health", "/api/demo/status"}


def _is_auth_enabled():
    """Auth is enabled only when Cognito config is provided."""
    return bool(COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID)


@lru_cache(maxsize=1)
def _get_jwks():
    """Fetch and cache Cognito JWKS (JSON Web Key Set)."""
    url = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}/.well-known/jwks.json"
    # URL is constructed from env vars only (COGNITO_REGION, COGNITO_USER_POOL_ID),
    # never from user input. Using requests (not urllib) to avoid file:// support.
    assert url.startswith("https://cognito-idp."), "Unexpected JWKS URL scheme"  # nosemgrep: dynamic-urllib-use-detected
    try:
        resp = http_requests.get(url, timeout=5)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[AUTH] Failed to fetch JWKS: {e}")
        return None


def _b64url_decode(data):
    """Base64url decode (no padding)."""
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data)


def _decode_jwt_unverified(token):
    """Decode JWT header and payload without signature verification."""
    parts = token.split(".")
    if len(parts) != 3:
        return None, None
    try:
        header = json.loads(_b64url_decode(parts[0]))
        payload = json.loads(_b64url_decode(parts[1]))
        return header, payload
    except Exception:
        return None, None


def _int_from_bytes(b):
    """Convert bytes to integer (big-endian)."""
    result = 0
    for byte in b:
        result = (result << 8) | byte
    return result


def _verify_rs256(token, jwk):
    """
    Verify RS256 JWT signature using the JWK public key.
    Pure Python — no external crypto libraries needed.
    """
    parts = token.split(".")
    message = f"{parts[0]}.{parts[1]}".encode("utf-8")
    signature = _b64url_decode(parts[2])

    # Extract RSA public key components from JWK
    n = _int_from_bytes(_b64url_decode(jwk["n"]))
    e = _int_from_bytes(_b64url_decode(jwk["e"]))

    # RSA verify: signature^e mod n
    sig_int = _int_from_bytes(signature)
    decrypted = pow(sig_int, e, n)

    # Convert back to bytes
    key_size = (n.bit_length() + 7) // 8
    decrypted_bytes = decrypted.to_bytes(key_size, byteorder="big")

    # PKCS#1 v1.5 padding: 0x00 0x01 [padding 0xFF...] 0x00 [DigestInfo + Hash]
    # SHA-256 DigestInfo prefix
    sha256_prefix = bytes([
        0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86,
        0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05,
        0x00, 0x04, 0x20
    ])

    # Compute SHA-256 of the message
    message_hash = hashlib.sha256(message).digest()

    # Expected suffix
    expected_suffix = sha256_prefix + message_hash

    # Verify padding structure
    if decrypted_bytes[0] != 0x00 or decrypted_bytes[1] != 0x01:
        return False

    # Find the 0x00 separator after padding
    separator_idx = decrypted_bytes.index(0x00, 2)
    # All bytes between 0x01 and separator should be 0xFF
    if not all(b == 0xFF for b in decrypted_bytes[2:separator_idx]):
        return False

    actual_suffix = decrypted_bytes[separator_idx + 1:]
    return actual_suffix == expected_suffix


def validate_token(token):
    """
    Validate a Cognito JWT token.
    Returns (payload, None) on success, (None, error_message) on failure.
    """
    if not token:
        return None, "No token provided"

    # Strip "Bearer " prefix if present
    if token.startswith("Bearer "):
        token = token[7:]

    # Decode header and payload
    header, payload = _decode_jwt_unverified(token)
    if not header or not payload:
        return None, "Invalid token format"

    # Check algorithm
    if header.get("alg") != "RS256":
        return None, f"Unsupported algorithm: {header.get('alg')}"

    # Check expiration
    exp = payload.get("exp", 0)
    if time.time() > exp:
        return None, "Token expired"

    # Check issuer
    expected_issuer = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"
    if payload.get("iss") != expected_issuer:
        return None, "Invalid issuer"

    # Check audience (client_id) — in Cognito ID tokens it's in 'aud', access tokens in 'client_id'
    token_aud = payload.get("aud") or payload.get("client_id")
    if token_aud != COGNITO_CLIENT_ID:
        return None, "Invalid audience"

    # Verify signature against JWKS
    jwks = _get_jwks()
    if not jwks:
        return None, "Could not fetch JWKS"

    kid = header.get("kid")
    jwk = next((k for k in jwks.get("keys", []) if k["kid"] == kid), None)
    if not jwk:
        # Key might have rotated — clear cache and retry once
        _get_jwks.cache_clear()
        jwks = _get_jwks()
        if jwks:
            jwk = next((k for k in jwks.get("keys", []) if k["kid"] == kid), None)
        if not jwk:
            return None, "Unknown signing key"

    try:
        if not _verify_rs256(token, jwk):
            return None, "Invalid signature"
    except Exception as e:
        return None, f"Signature verification failed: {e}"

    return payload, None


def require_auth(f):
    """Decorator to require Cognito authentication on a route."""
    @wraps(f)
    def decorated(*args, **kwargs):
        # Skip auth if not configured (local dev without Cognito)
        if not _is_auth_enabled():
            return f(*args, **kwargs)

        token = request.headers.get("Authorization", "")
        payload, error = validate_token(token)
        if error:
            return jsonify({"error": "Unauthorized", "message": error}), 401

        # Attach user info to request for downstream use
        request.cognito_user = payload
        return f(*args, **kwargs)
    return decorated


def init_auth(app):
    """
    Register a before_request hook that enforces auth on all /api/* routes
    (except health check and static files).
    """
    if not _is_auth_enabled():
        print("[AUTH] Cognito not configured — authentication disabled")
        return

    print(f"[AUTH] Cognito authentication enabled")
    print(f"[AUTH]   User Pool: {COGNITO_USER_POOL_ID}")
    print(f"[AUTH]   Client ID: {COGNITO_CLIENT_ID}")
    print(f"[AUTH]   Region:    {COGNITO_REGION}")

    @app.before_request
    def check_auth():
        path = request.path

        # Skip CORS preflight requests (browser sends OPTIONS without token)
        if request.method == "OPTIONS":
            return None

        # Skip non-API routes (static files)
        if not path.startswith("/api/"):
            return None

        # Skip exempt paths
        if path in SKIP_AUTH_PATHS:
            return None

        token = request.headers.get("Authorization", "")
        payload, error = validate_token(token)
        if error:
            return jsonify({"error": "Unauthorized", "message": error}), 401

        request.cognito_user = payload
        return None
