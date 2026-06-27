"""
patient_summary action group Lambda.

Implements OpenAPI contract at action-groups/patient_summary.yaml.

Returns a structured narrative summary of one patient: active conditions,
current medications, recent lab readings, and identified care gaps.

PHI-safe logging: logs counts and ID prefixes only, never patient names or
clinical values. The Agent envelope (returned to Bedrock) does carry the
patient's name and clinical content — that flows to the LLM for response
composition. CloudWatch logs never see it.
"""
import logging

from healthlake_client import (
    extract_parameters,
    find_patient_by_name,
    fhir_search,
    latest_observation,
    patient_display_name,
    response,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Common LOINC codes — used to surface key lab values
A1C_LOINC = {'4548-4', '17856-6', '4549-2'}
LDL_LOINC = {'13457-7', '18262-6', '2089-1'}
GLUCOSE_LOINC = {'2345-7', '2339-0'}


def handler(event, context):
    """Bedrock Agent action group entrypoint."""
    logger.info("[patient_summary] action=%s",
                event.get('actionGroup', 'unknown'))

    params = extract_parameters(event)
    patient_name = (params.get('patient_name') or '').strip()
    focus_area = (params.get('focus_area') or '').strip().lower()

    if not patient_name:
        return response(event, 400, {
            "error": "patient_name is required",
        })

    logger.info("[patient_summary] query_len=%d focus=%s",
                len(patient_name), focus_area or 'none')

    patient = find_patient_by_name(patient_name)
    if not patient:
        return response(event, 404, {
            "error": f"No patient found matching '{patient_name}'. "
                     "Ask the user to provide more name detail.",
        })

    patient_id = patient.get('id', '')

    # Pull related clinical data — scoped to this patient
    conditions = fhir_search('Condition', {
        'patient': patient_id,
        'clinical-status': 'active',
        '_count': 50,
    })
    medications = fhir_search('MedicationRequest', {
        'patient': patient_id,
        'status': 'active',
        '_count': 50,
    })
    observations = fhir_search('Observation', {
        'patient': patient_id,
        'category': 'laboratory',
        '_count': 100,
    })

    # Structured summary
    condition_names = [_concept_text(c.get('code')) for c in conditions]
    medication_names = [
        _concept_text(m.get('medicationCodeableConcept'))
        for m in medications
    ]

    # Recent labs: A1c, LDL, glucose
    recent_labs = []
    for label, codes in [('Hemoglobin A1c', A1C_LOINC),
                         ('LDL Cholesterol', LDL_LOINC),
                         ('Glucose', GLUCOSE_LOINC)]:
        obs = latest_observation(observations, code_filter=codes)
        if obs:
            recent_labs.append({
                'name': label,
                'value': _observation_value(obs),
                'unit': _observation_unit(obs),
                'date': obs.get('effectiveDateTime', '')[:10],
            })

    # Naive care-gap detection: diabetic patient with no A1c in 6+ months
    care_gaps = []
    has_diabetes = any(
        'diabetes' in (n or '').lower() for n in condition_names
    )
    has_a1c_obs = any(lab['name'] == 'Hemoglobin A1c' for lab in recent_labs)
    if has_diabetes and not has_a1c_obs:
        care_gaps.append('Type 2 diabetes diagnosis but no A1c reading in the available data')

    body = {
        "patient_id": patient_id,
        "patient_name": patient_display_name(patient),
        "summary_text": _build_summary_text(
            patient, condition_names, medication_names,
            recent_labs, care_gaps, focus_area
        ),
        "conditions": [c for c in condition_names if c],
        "medications": [m for m in medication_names if m],
        "recent_labs": recent_labs,
        "care_gaps": care_gaps,
    }
    return response(event, 200, body)


def _concept_text(coding_or_concept) -> str:
    """Extract human-readable text from a CodeableConcept or coding wrapper."""
    if not coding_or_concept:
        return ''
    if isinstance(coding_or_concept, dict):
        text = coding_or_concept.get('text', '')
        if text:
            return text
        codings = coding_or_concept.get('coding', [])
        if codings:
            return codings[0].get('display', '') or codings[0].get('code', '')
    return ''


def _observation_value(obs: dict):
    """Extract the numeric value from an Observation."""
    v = obs.get('valueQuantity')
    if v:
        return v.get('value')
    return None


def _observation_unit(obs: dict) -> str:
    v = obs.get('valueQuantity')
    if v:
        return v.get('unit', '')
    return ''


def _build_summary_text(patient, conditions, medications,
                       recent_labs, care_gaps, focus_area) -> str:
    """Build a one-paragraph narrative for the agent to compose around."""
    bits = []
    name = patient_display_name(patient)
    age = _age(patient)
    bits.append(f"{name}" + (f", age {age}." if age else "."))

    if conditions:
        cond_str = ', '.join(c for c in conditions[:5] if c)
        bits.append(f"Active conditions: {cond_str}.")
    if medications:
        med_str = ', '.join(m for m in medications[:5] if m)
        bits.append(f"Current medications: {med_str}.")
    if recent_labs:
        lab_strs = [
            f"{l['name']} {l['value']}{l['unit']} on {l['date']}"
            for l in recent_labs if l.get('value') is not None
        ]
        if lab_strs:
            bits.append("Recent labs: " + '; '.join(lab_strs) + ".")
    if care_gaps:
        bits.append("Care gaps: " + '; '.join(care_gaps) + ".")
    if focus_area:
        bits.append(f"(Care manager focus: {focus_area}.)")
    return ' '.join(bits)


def _age(patient: dict):
    """Compute age in years from Patient.birthDate, or None."""
    from datetime import datetime
    bd = patient.get('birthDate')
    if not bd:
        return None
    try:
        d = datetime.strptime(bd, '%Y-%m-%d')
        return (datetime.now() - d).days // 365
    except (ValueError, TypeError):
        return None
