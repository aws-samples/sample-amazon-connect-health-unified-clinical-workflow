"""
no_show_patients action group Lambda.

Implements OpenAPI contract at action-groups/no_show_patients.yaml.

Returns patients who had a scheduled Appointment in the last lookback_days
days but no corresponding Encounter resource (i.e., they didn't show up).

Strategy:
  1. Query Appointment resources with status='booked' or 'noshow' in date range
  2. For each, check if a linked Encounter exists
  3. If Appointment.status == 'noshow' OR no Encounter found, include in result

Notes on FHIR semantics:
  - Some EHRs explicitly set Appointment.status to 'noshow'; trust that.
  - For Appointments with status='fulfilled' or 'booked', cross-check via
    linked Encounter. This handles EHRs that don't update Appointment status.
"""
import logging
from datetime import datetime, timedelta, timezone

from healthlake_client import (
    extract_parameters,
    fhir_read,
    fhir_search,
    patient_display_name,
    response,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

LOOKBACK_MIN = 1
LOOKBACK_MAX = 180
LOOKBACK_DEFAULT = 30
MAX_APPOINTMENTS_SCANNED = 200


def handler(event, context):
    logger.info("[no_show_patients] action=%s",
                event.get('actionGroup', 'unknown'))

    params = extract_parameters(event)
    lookback_days = params.get('lookback_days', LOOKBACK_DEFAULT)
    try:
        lookback_days = int(lookback_days)
    except (TypeError, ValueError):
        lookback_days = LOOKBACK_DEFAULT
    lookback_days = max(LOOKBACK_MIN, min(LOOKBACK_MAX, lookback_days))

    logger.info("[no_show_patients] lookback_days=%d", lookback_days)

    # Date range: from lookback_days ago to yesterday (we only count
    # appointments that have already passed)
    now = datetime.now(timezone.utc)
    floor_date = (now - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
    ceiling_date = (now - timedelta(days=1)).strftime('%Y-%m-%d')

    # Search Appointments in date range
    appointments = fhir_search('Appointment', {
        'date': [f'ge{floor_date}', f'le{ceiling_date}'],
        '_count': MAX_APPOINTMENTS_SCANNED,
    })

    logger.info("[no_show_patients] appointment_count=%d", len(appointments))

    no_shows = []
    for appt in appointments:
        status = (appt.get('status', '') or '').lower()
        appt_id = appt.get('id', '')

        is_noshow = False
        if status == 'noshow':
            is_noshow = True
        elif status in ('booked', 'pending', 'arrived'):
            # Check whether a linked Encounter exists
            encounters = fhir_search('Encounter', {
                'appointment': appt_id,
                '_count': 1,
            })
            if not encounters:
                is_noshow = True
        else:
            # fulfilled, cancelled, etc. — not a no-show
            continue

        if not is_noshow:
            continue

        # Extract patient and details
        patient_id = _patient_id_from_appointment(appt)
        if not patient_id:
            continue

        patient = fhir_read('Patient', patient_id)
        if not patient:
            continue

        scheduled = (appt.get('start', '') or '')[:10]
        appt_type = _appointment_type(appt)

        no_shows.append({
            'patient_id': patient_id,
            'name': patient_display_name(patient),
            'scheduled_date': scheduled,
            'appointment_type': appt_type,
        })

    logger.info("[no_show_patients] no_show_count=%d", len(no_shows))

    # Sort by most recent scheduled date first
    no_shows.sort(key=lambda p: p.get('scheduled_date', ''), reverse=True)

    return response(event, 200, {
        "patient_count": len(no_shows),
        "patients": no_shows,
        "lookback_days": lookback_days,
    })


def _patient_id_from_appointment(appt: dict):
    """Pull the patient ID from Appointment.participant[].actor.reference."""
    for participant in appt.get('participant', []) or []:
        actor = participant.get('actor', {}) or {}
        ref = actor.get('reference', '') or ''
        if ref.startswith('Patient/'):
            return ref.split('/', 1)[1]
    return None


def _appointment_type(appt: dict) -> str:
    """Best-effort label for an appointment's type."""
    appt_type = appt.get('appointmentType', {}) or {}
    text = appt_type.get('text', '')
    if text:
        return text
    coding = appt_type.get('coding', []) or []
    if coding:
        return coding[0].get('display', '') or coding[0].get('code', '')
    # Fallback: service type
    service_types = appt.get('serviceType', []) or []
    if service_types:
        st_coding = service_types[0].get('coding', []) or []
        if st_coding:
            return st_coding[0].get('display', '') or st_coding[0].get('code', '')
    return 'Unknown'
