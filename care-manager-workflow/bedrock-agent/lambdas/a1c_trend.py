"""
a1c_trend action group Lambda.

Implements OpenAPI contract at action-groups/a1c_trend.yaml.

Returns the hemoglobin A1c reading history for a named patient over a
time window with a directional summary (improving/worsening/stable/
insufficient_data). Used when the care manager asks about a specific
patient's A1c trajectory.
"""
import logging
from datetime import datetime, timedelta, timezone

from healthlake_client import (
    extract_parameters,
    fhir_search,
    find_patient_by_name,
    patient_display_name,
    response,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Hemoglobin A1c LOINC codes
A1C_LOINC = ['4548-4', '17856-6', '4549-2']

# Clinically meaningful change threshold (A1c percentage points)
TREND_THRESHOLD = 0.3

# Bounds — match OpenAPI schema
MONTHS_MIN = 1
MONTHS_MAX = 60
MONTHS_DEFAULT = 12


def handler(event, context):
    logger.info("[a1c_trend] action=%s", event.get('actionGroup', 'unknown'))

    params = extract_parameters(event)
    patient_name = (params.get('patient_name') or '').strip()
    months_back = params.get('months_back', MONTHS_DEFAULT)

    if not patient_name:
        return response(event, 400, {"error": "patient_name is required"})

    # Validate bounds
    try:
        months_back = int(months_back)
    except (TypeError, ValueError):
        months_back = MONTHS_DEFAULT
    months_back = max(MONTHS_MIN, min(MONTHS_MAX, months_back))

    logger.info("[a1c_trend] query_len=%d months_back=%d",
                len(patient_name), months_back)

    patient = find_patient_by_name(patient_name)
    if not patient:
        return response(event, 404, {
            "error": f"No patient found matching '{patient_name}'.",
        })

    patient_id = patient.get('id', '')

    # Compute date floor in ISO format
    floor_date = (
        datetime.now(timezone.utc) - timedelta(days=months_back * 30)
    ).strftime('%Y-%m-%d')

    # Query observations with LOINC codes for A1c, in date range
    # HealthLake supports OR via comma-separated codes
    a1c_observations = fhir_search('Observation', {
        'patient': patient_id,
        'code': ','.join(A1C_LOINC),
        'date': f'ge{floor_date}',
        '_sort': 'date',
        '_count': 100,
    })

    readings = []
    for obs in a1c_observations:
        value_qty = obs.get('valueQuantity', {}) or {}
        value = value_qty.get('value')
        if value is None:
            continue
        date_str = (
            obs.get('effectiveDateTime', '')
            or obs.get('issued', '')
        )[:10]
        if not date_str:
            continue
        readings.append({
            'date': date_str,
            'value': float(value),
            'unit': value_qty.get('unit', '%'),
        })

    readings.sort(key=lambda r: r['date'])

    direction = _direction(readings)

    logger.info("[a1c_trend] reading_count=%d direction=%s",
                len(readings), direction)

    body = {
        "patient_id": patient_id,
        "patient_name": patient_display_name(patient),
        "window_months": months_back,
        "readings": readings,
        "direction": direction,
    }
    return response(event, 200, body)


def _direction(readings: list) -> str:
    """
    Classify the trend: improving / worsening / stable / insufficient_data.

    For A1c, "improving" means trending DOWN (lower A1c is better).
    Comparison: first half average vs second half average; require
    TREND_THRESHOLD difference to call non-stable.
    """
    if len(readings) < 2:
        return 'insufficient_data'

    mid = len(readings) // 2
    first_half = readings[:mid] if mid else [readings[0]]
    second_half = readings[mid:]

    avg_first = sum(r['value'] for r in first_half) / len(first_half)
    avg_second = sum(r['value'] for r in second_half) / len(second_half)
    delta = avg_second - avg_first

    if delta <= -TREND_THRESHOLD:
        return 'improving'
    if delta >= TREND_THRESHOLD:
        return 'worsening'
    return 'stable'
