"""
overdue_a1c action group Lambda.

Implements OpenAPI contract at action-groups/overdue_a1c.yaml.

Population-scope query: returns all Type 2 diabetes patients who have no
A1c reading in the last threshold_months months. Used when the care
manager asks "which patients are overdue for an A1c?".

Strategy:
  1. Search for Type 2 diabetes Conditions (SNOMED 44054006)
  2. For each, query the patient's most recent A1c Observation
  3. If last A1c is older than threshold (or absent), include in result

Population queries can be expensive. This Lambda has a 60s timeout and
limits to the first 100 diabetic patients. For larger panels, this should
be backed by Athena over a HealthLake export, not synchronous FHIR queries.
"""
import logging
from datetime import datetime, timedelta, timezone

from healthlake_client import (
    extract_parameters,
    fhir_search,
    response,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# SNOMED CT codes for Type 2 diabetes mellitus
T2DM_SNOMED = ['44054006', '422034002']  # Diabetes mellitus type 2, T2DM
A1C_LOINC = ['4548-4', '17856-6', '4549-2']

THRESHOLD_MIN = 3
THRESHOLD_MAX = 24
THRESHOLD_DEFAULT = 6
MAX_PATIENTS_SCANNED = 100  # Cap to stay within Lambda timeout


def handler(event, context):
    logger.info("[overdue_a1c] action=%s", event.get('actionGroup', 'unknown'))

    params = extract_parameters(event)
    threshold_months = params.get('threshold_months', THRESHOLD_DEFAULT)
    try:
        threshold_months = int(threshold_months)
    except (TypeError, ValueError):
        threshold_months = THRESHOLD_DEFAULT
    threshold_months = max(THRESHOLD_MIN, min(THRESHOLD_MAX, threshold_months))

    logger.info("[overdue_a1c] threshold_months=%d", threshold_months)

    # Step 1: find Type 2 diabetes conditions
    conditions = fhir_search('Condition', {
        'code': ','.join(T2DM_SNOMED),
        'clinical-status': 'active',
        '_count': MAX_PATIENTS_SCANNED,
    })
    logger.info("[overdue_a1c] t2dm_condition_count=%d", len(conditions))

    # Dedupe patient IDs (one patient may have multiple coded conditions)
    diabetic_patient_ids = set()
    for cond in conditions:
        subject_ref = cond.get('subject', {}).get('reference', '')
        if subject_ref.startswith('Patient/'):
            diabetic_patient_ids.add(subject_ref.split('/', 1)[1])

    if not diabetic_patient_ids:
        return response(event, 200, {
            "patient_count": 0,
            "patients": [],
            "message": "No active Type 2 diabetes patients found.",
        })

    # Threshold cutoff: A1c reading must be newer than this
    threshold_date = (
        datetime.now(timezone.utc) - timedelta(days=threshold_months * 30)
    )
    threshold_date_str = threshold_date.strftime('%Y-%m-%d')

    overdue = []
    for patient_id in list(diabetic_patient_ids)[:MAX_PATIENTS_SCANNED]:
        # Get most recent A1c for this patient (regardless of date)
        observations = fhir_search('Observation', {
            'patient': patient_id,
            'code': ','.join(A1C_LOINC),
            '_sort': '-date',
            '_count': 1,
        })

        last_a1c_value = None
        last_a1c_date = None
        days_since = None
        is_overdue = False

        if not observations:
            is_overdue = True
        else:
            obs = observations[0]
            value_qty = obs.get('valueQuantity', {}) or {}
            last_a1c_value = value_qty.get('value')
            last_a1c_date = (
                obs.get('effectiveDateTime', '')
                or obs.get('issued', '')
            )[:10]
            if last_a1c_date and last_a1c_date < threshold_date_str:
                is_overdue = True
            if last_a1c_date:
                try:
                    obs_dt = datetime.strptime(last_a1c_date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
                    days_since = (datetime.now(timezone.utc) - obs_dt).days
                except ValueError:
                    pass

        if not is_overdue:
            continue

        # Get patient name for the result
        from healthlake_client import fhir_read, patient_display_name
        patient = fhir_read('Patient', patient_id)
        if not patient:
            continue

        overdue.append({
            'patient_id': patient_id,
            'name': patient_display_name(patient),
            'last_a1c_value': last_a1c_value,
            'last_a1c_date': last_a1c_date,
            'days_since_last_a1c': days_since,
        })

    logger.info("[overdue_a1c] overdue_count=%d of scanned=%d",
                len(overdue), len(diabetic_patient_ids))

    # Sort by longest-overdue first (None = never had one, treat as max)
    overdue.sort(key=lambda p: p.get('days_since_last_a1c') or 10**9, reverse=True)

    return response(event, 200, {
        "patient_count": len(overdue),
        "patients": overdue,
        "threshold_months": threshold_months,
    })
