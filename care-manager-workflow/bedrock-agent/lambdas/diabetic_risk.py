"""
diabetic_risk action group Lambda.

Implements OpenAPI contract at action-groups/diabetic_risk.yaml.

Returns Type 2 diabetes patients scored on a composite risk function over:
  - Most recent A1c value (higher = higher risk)
  - Time since last A1c (longer = higher risk)
  - Active care gaps (each adds risk weight)
  - Outstanding overdue appointments / no-shows

Score is normalized to [0.0, 1.0]. Higher = higher complication risk.

⚠️ This is a SAMPLE risk function for demonstration. Real clinical risk
   scoring requires validation against outcomes data, periodic recalibration,
   and oversight by clinical leadership. See RESPONSIBLE_AI.md for
   production obligations.

⚠️ The agent's response should ALWAYS explain to the care manager that the
   risk score is a triage aid, not a clinical decision. This is enforced by
   the disclaimer attached to every response (in healthlake_client.response).
"""
import logging
from datetime import datetime, timezone

from healthlake_client import (
    extract_parameters,
    fhir_read,
    fhir_search,
    patient_display_name,
    response,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

T2DM_SNOMED = ['44054006', '422034002']
A1C_LOINC = ['4548-4', '17856-6', '4549-2']

TOP_N_MIN = 1
TOP_N_MAX = 100
TOP_N_DEFAULT = 10
SCORE_MIN_DEFAULT = 0.5
MAX_PATIENTS_SCANNED = 100

# A1c thresholds for risk weighting
A1C_TARGET = 7.0       # below this is acceptable
A1C_ELEVATED = 8.0     # above this is concerning
A1C_HIGH_RISK = 9.0    # above this is high risk
A1C_VERY_HIGH = 10.0   # above this is very high risk

# Days-since-A1c thresholds
DAYS_RECENT = 90       # under 3 months is recent
DAYS_OVERDUE = 180     # over 6 months is overdue
DAYS_NEGLECTED = 365   # over 1 year is neglected


def handler(event, context):
    logger.info("[diabetic_risk] action=%s",
                event.get('actionGroup', 'unknown'))

    params = extract_parameters(event)
    top_n = params.get('top_n', TOP_N_DEFAULT)
    min_score = params.get('min_score', SCORE_MIN_DEFAULT)

    try:
        top_n = int(top_n)
    except (TypeError, ValueError):
        top_n = TOP_N_DEFAULT
    top_n = max(TOP_N_MIN, min(TOP_N_MAX, top_n))

    try:
        min_score = float(min_score)
    except (TypeError, ValueError):
        min_score = SCORE_MIN_DEFAULT
    min_score = max(0.0, min(1.0, min_score))

    logger.info("[diabetic_risk] top_n=%d min_score=%.2f", top_n, min_score)

    # Step 1: find Type 2 diabetes patients
    conditions = fhir_search('Condition', {
        'code': ','.join(T2DM_SNOMED),
        'clinical-status': 'active',
        '_count': MAX_PATIENTS_SCANNED,
    })

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

    logger.info("[diabetic_risk] diabetic_patient_count=%d",
                len(diabetic_patient_ids))

    # Step 2: score each
    scored = []
    for patient_id in list(diabetic_patient_ids)[:MAX_PATIENTS_SCANNED]:
        a1c_score, factors, last_a1c_value, last_a1c_date = _a1c_signal(patient_id)
        appt_score, appt_factors = _appointment_signal(patient_id)
        risk_score = min(1.0, a1c_score + appt_score)

        if risk_score < min_score:
            continue

        patient = fhir_read('Patient', patient_id)
        if not patient:
            continue

        scored.append({
            'patient_id': patient_id,
            'name': patient_display_name(patient),
            'risk_score': round(risk_score, 2),
            'last_a1c_value': last_a1c_value,
            'last_a1c_date': last_a1c_date,
            'contributing_factors': factors + appt_factors,
        })

    # Sort descending by score
    scored.sort(key=lambda p: p['risk_score'], reverse=True)
    scored = scored[:top_n]

    logger.info("[diabetic_risk] returned_count=%d", len(scored))

    return response(event, 200, {
        "patient_count": len(scored),
        "patients": scored,
        "scoring_notes": (
            "Sample risk score combining most-recent A1c, time since last A1c, "
            "and recent no-show appointments. Not a validated clinical tool — "
            "use only as a triage aid."
        ),
    })


def _a1c_signal(patient_id: str):
    """Return (score_contribution, factors, last_value, last_date) for A1c."""
    observations = fhir_search('Observation', {
        'patient': patient_id,
        'code': ','.join(A1C_LOINC),
        '_sort': '-date',
        '_count': 1,
    })

    if not observations:
        return 0.7, ['No A1c reading on record (neglected monitoring)'], None, None

    obs = observations[0]
    value_qty = obs.get('valueQuantity', {}) or {}
    value = value_qty.get('value')
    date_str = (obs.get('effectiveDateTime', '') or obs.get('issued', ''))[:10]

    factors = []
    score = 0.0

    # A1c value contribution
    if value is not None:
        value = float(value)
        if value >= A1C_VERY_HIGH:
            score += 0.6
            factors.append(f'Very high A1c: {value:.1f}%')
        elif value >= A1C_HIGH_RISK:
            score += 0.45
            factors.append(f'High A1c: {value:.1f}%')
        elif value >= A1C_ELEVATED:
            score += 0.25
            factors.append(f'Elevated A1c: {value:.1f}%')
        elif value >= A1C_TARGET:
            score += 0.1
            factors.append(f'A1c above target: {value:.1f}%')

    # Time since A1c contribution
    if date_str:
        try:
            obs_dt = datetime.strptime(date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
            days = (datetime.now(timezone.utc) - obs_dt).days
            if days >= DAYS_NEGLECTED:
                score += 0.3
                factors.append(f'A1c last checked {days} days ago (neglected)')
            elif days >= DAYS_OVERDUE:
                score += 0.2
                factors.append(f'A1c last checked {days} days ago (overdue)')
            elif days <= DAYS_RECENT:
                # Bonus reduction for fresh A1c
                score = max(0.0, score - 0.05)
        except ValueError:
            pass

    return score, factors, value, date_str


def _appointment_signal(patient_id: str):
    """Return (score_contribution, factors) based on recent no-shows."""
    # Look back 90 days for noshow Appointments
    from datetime import timedelta
    floor = (datetime.now(timezone.utc) - timedelta(days=90)).strftime('%Y-%m-%d')

    no_shows = fhir_search('Appointment', {
        'patient': patient_id,
        'status': 'noshow',
        'date': f'ge{floor}',
        '_count': 10,
    })

    if not no_shows:
        return 0.0, []
    n = len(no_shows)
    if n >= 3:
        return 0.25, [f'{n} no-show appointments in last 90 days']
    if n == 2:
        return 0.15, ['2 no-show appointments in last 90 days']
    return 0.08, ['1 no-show appointment in last 90 days']
