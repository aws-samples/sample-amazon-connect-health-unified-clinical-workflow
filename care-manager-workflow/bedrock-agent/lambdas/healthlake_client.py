"""
Shared HealthLake client for Bedrock Agent action group Lambdas.

Provides:
  - SigV4-signed FHIR REST API calls
  - Pagination handling for searches that return Bundle responses
  - PHI-safe logging convention (logs counts and IDs, never names/DOB/values)
  - Patient name fuzzy matching (case-insensitive, partial-name OK)
  - The AI disclaimer constant required in every agent response
"""
import json
import logging
import os
from datetime import datetime, timezone
from typing import Iterable, Optional

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
import urllib.request
import urllib.error
import urllib.parse

logger = logging.getLogger()
if not logger.hasHandlers():
    logger.setLevel(logging.INFO)

AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
HEALTHLAKE_DATASTORE_ID = os.environ.get('HEALTHLAKE_DATASTORE_ID', '')

# Required disclaimer attached to every response — see RESPONSIBLE_AI.md
AI_DISCLAIMER = (
    "AI-generated clinical content requires review by a licensed "
    "healthcare professional before use in patient care."
)

# Internal singleton: credentials are reused across warm invocations
_session = None


def _get_credentials():
    """Return cached boto3 credentials for SigV4 signing."""
    global _session
    if _session is None:
        _session = boto3.Session()
    return _session.get_credentials()


def fhir_search(resource_type: str, params: Optional[dict] = None,
                page_limit: int = 5) -> list:
    """
    Search a FHIR resource type with the given query parameters and return
    a list of resource dicts (Bundle entries' .resource fields).

    Follows up to ``page_limit`` "next" links for pagination. Default of 5
    pages with the FHIR default page size keeps us under the 60s Lambda
    timeout for reasonable result sets.
    """
    if not HEALTHLAKE_DATASTORE_ID:
        logger.error("HEALTHLAKE_DATASTORE_ID env var not set")
        return []

    base_url = (
        f"https://healthlake.{AWS_REGION}.amazonaws.com/"
        f"datastore/{HEALTHLAKE_DATASTORE_ID}/r4/{resource_type}"
    )
    query = urllib.parse.urlencode(params or {}, doseq=True)
    url = f"{base_url}?{query}" if query else base_url

    results = []
    pages_fetched = 0
    next_url = url

    while next_url and pages_fetched < page_limit:
        bundle = _signed_get(next_url)
        if not bundle:
            break

        entries = bundle.get('entry', []) or []
        for entry in entries:
            res = entry.get('resource')
            if res:
                results.append(res)

        # Find the "next" link if any
        next_url = None
        for link in bundle.get('link', []) or []:
            if link.get('relation') == 'next':
                next_url = link.get('url')
                break

        pages_fetched += 1

    logger.info(
        "[fhir_search] %s returned count=%d (pages=%d)",
        resource_type, len(results), pages_fetched
    )
    return results


def fhir_read(resource_type: str, resource_id: str) -> Optional[dict]:
    """Read a specific FHIR resource by id; returns the resource dict or None."""
    if not HEALTHLAKE_DATASTORE_ID:
        return None
    url = (
        f"https://healthlake.{AWS_REGION}.amazonaws.com/"
        f"datastore/{HEALTHLAKE_DATASTORE_ID}/r4/{resource_type}/{resource_id}"
    )
    res = _signed_get(url)
    if res:
        logger.info("[fhir_read] %s/%s OK", resource_type, resource_id[:8])
    return res


def _signed_get(url: str) -> Optional[dict]:
    """Signed HTTPS GET against HealthLake; returns parsed JSON or None on error."""
    credentials = _get_credentials()
    if credentials is None:
        logger.error("No AWS credentials available for SigV4 signing")
        return None

    headers = {
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json',
    }
    request = AWSRequest(method='GET', url=url, headers=headers)
    SigV4Auth(credentials, 'healthlake', AWS_REGION).add_auth(request)

    try:
        req = urllib.request.Request(
            url, headers=dict(request.headers), method='GET'
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = resp.read()
            return json.loads(body.decode('utf-8'))
    except urllib.error.HTTPError as e:
        # PHI-safe: log status code only, never response body
        logger.error("[fhir_get] HTTP %d on %s", e.code, _redact_url(url))
        return None
    except (urllib.error.URLError, OSError) as e:
        logger.error("[fhir_get] network error: %s", type(e).__name__)
        return None
    except json.JSONDecodeError:
        logger.error("[fhir_get] response is not JSON")
        return None


def _redact_url(url: str) -> str:
    """Strip query parameters that may contain patient identifiers from log output."""
    parsed = urllib.parse.urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


# ──────────────────────────────────────────────────────────────────────
# Patient name matching
# ──────────────────────────────────────────────────────────────────────

def find_patient_by_name(name_query: str) -> Optional[dict]:
    """
    Locate a single Patient resource by fuzzy name match.

    Strategy:
      1. Try HealthLake's _content search across given+family
      2. If multiple matches, return the highest-confidence single match
      3. If no matches or ambiguous, return None

    Returns the FHIR Patient resource dict, or None.

    PHI-safe: logs only the query length and match count, never the name.
    """
    name_query = (name_query or '').strip()
    if not name_query:
        return None

    # FHIR Patient search by name (matches given OR family OR family-given)
    candidates = fhir_search('Patient', {'name': name_query, '_count': 25})

    logger.info(
        "[find_patient] query_len=%d candidates=%d",
        len(name_query), len(candidates)
    )

    if not candidates:
        return None

    # Score each candidate by how well the query overlaps name tokens
    query_tokens = set(name_query.lower().split())
    best = None
    best_score = 0.0
    for patient in candidates:
        names = patient.get('name', []) or []
        if not names:
            continue
        name = names[0]
        given_tokens = {g.lower() for g in (name.get('given', []) or [])}
        family_tokens = {(name.get('family', '') or '').lower()}
        patient_tokens = given_tokens | family_tokens
        patient_tokens.discard('')

        overlap = query_tokens & patient_tokens
        if not overlap:
            continue
        # Score: fraction of query tokens that matched
        score = len(overlap) / max(len(query_tokens), 1)
        if score > best_score:
            best_score = score
            best = patient

    # Require at least one token to match
    if best_score == 0.0:
        return None

    logger.info("[find_patient] selected id=%s score=%.2f",
                (best.get('id', '?'))[:8], best_score)
    return best


# ──────────────────────────────────────────────────────────────────────
# Bedrock Agent envelope helpers
# ──────────────────────────────────────────────────────────────────────

def extract_parameters(event: dict) -> dict:
    """
    Pull parameters from the Bedrock Agent event envelope.

    Supports both:
      - OpenAPI-style: event['requestBody']['content']['application/json']
      - Function-detail style: event['parameters']
    """
    # OpenAPI-style
    body = event.get('requestBody', {}).get('content', {}) or {}
    json_body = body.get('application/json', {}) or {}
    props = json_body.get('properties', None)
    if props is not None:
        if isinstance(props, list):
            return {
                p.get('name'): _coerce_value(p.get('value'), p.get('type'))
                for p in props if 'name' in p
            }
        if isinstance(props, dict):
            return props

    # Function-detail style
    params = event.get('parameters', None)
    if params and isinstance(params, list):
        return {
            p.get('name'): _coerce_value(p.get('value'), p.get('type'))
            for p in params if 'name' in p
        }

    return {}


def _coerce_value(value, value_type):
    """Coerce a string-valued Bedrock parameter to its OpenAPI-declared type."""
    if value is None:
        return None
    if value_type in ('integer', 'int'):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    if value_type in ('number', 'float'):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    if value_type in ('boolean', 'bool'):
        if isinstance(value, bool):
            return value
        return str(value).lower() in ('true', '1', 'yes')
    return value


def response(event: dict, status_code: int, body_obj: dict) -> dict:
    """
    Format the response in the Bedrock Agent expected envelope.

    Always attaches the AI disclaimer to the body if not already present.
    """
    if isinstance(body_obj, dict) and 'disclaimer' not in body_obj:
        body_obj['disclaimer'] = AI_DISCLAIMER

    return {
        "messageVersion": "1.0",
        "response": {
            "actionGroup": event.get('actionGroup', ''),
            "apiPath": event.get('apiPath', ''),
            "httpMethod": event.get('httpMethod', 'POST'),
            "httpStatusCode": status_code,
            "responseBody": {
                "application/json": {
                    "body": json.dumps(body_obj, default=str)
                }
            }
        },
        "sessionAttributes": event.get('sessionAttributes', {}),
        "promptSessionAttributes": event.get('promptSessionAttributes', {}),
    }


# ──────────────────────────────────────────────────────────────────────
# Helpers for parsing FHIR resource bits
# ──────────────────────────────────────────────────────────────────────

def patient_display_name(patient: dict) -> str:
    """Return a display name "Given Family" from a FHIR Patient.

    NOTE: Only use this in the body returned to the Bedrock Agent — never in
    logs. The Agent will use the name in its natural-language response, but
    the LogGroup must remain PHI-free.
    """
    names = patient.get('name', []) or []
    if not names:
        return 'Unknown'
    n = names[0]
    given = ' '.join(n.get('given', []) or [])
    family = n.get('family', '') or ''
    return f"{given} {family}".strip() or 'Unknown'


def days_since(iso_date: str) -> Optional[int]:
    """Return days between iso_date (YYYY-MM-DD or full ISO) and now, or None."""
    if not iso_date:
        return None
    try:
        if 'T' in iso_date:
            d = datetime.fromisoformat(iso_date.replace('Z', '+00:00'))
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
        else:
            d = datetime.strptime(iso_date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - d).days
    except (ValueError, TypeError):
        return None


def latest_observation(observations: Iterable[dict],
                       code_filter: Optional[set] = None) -> Optional[dict]:
    """Return the most recent Observation, optionally filtered by LOINC code."""
    best = None
    best_date = None
    for obs in observations:
        if code_filter:
            codes = {
                c.get('code')
                for c in (obs.get('code', {}).get('coding') or [])
                if c.get('code')
            }
            if not codes & code_filter:
                continue
        # Prefer effectiveDateTime then issued
        d = obs.get('effectiveDateTime') or obs.get('issued')
        if not d:
            continue
        if best_date is None or d > best_date:
            best_date = d
            best = obs
    return best
