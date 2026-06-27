"""
recent_visit action group Lambda.

Implements OpenAPI contract at action-groups/recent_visit.yaml.

Returns the most recent Encounter resource for a named patient, plus the
linked DocumentReference (SOAP note) content if available. Used by the
care manager workflow when the user asks "what did Patient X discuss in
their last visit?".

The SOAP note text is returned as four separate fields (Subjective,
Objective, Assessment, Plan) so the agent can reference them precisely
in its natural-language response.
"""
import base64
import logging

from healthlake_client import (
    extract_parameters,
    fhir_search,
    find_patient_by_name,
    patient_display_name,
    response,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    logger.info("[recent_visit] action=%s", event.get('actionGroup', 'unknown'))

    params = extract_parameters(event)
    patient_name = (params.get('patient_name') or '').strip()
    if not patient_name:
        return response(event, 400, {"error": "patient_name is required"})

    logger.info("[recent_visit] query_len=%d", len(patient_name))

    patient = find_patient_by_name(patient_name)
    if not patient:
        return response(event, 404, {
            "error": f"No patient found matching '{patient_name}'.",
        })

    patient_id = patient.get('id', '')

    # Most recent Encounter — sorted descending by date
    encounters = fhir_search('Encounter', {
        'patient': patient_id,
        '_sort': '-date',
        '_count': 1,
    })
    if not encounters:
        return response(event, 200, {
            "patient_id": patient_id,
            "patient_name": patient_display_name(patient),
            "encounter_date": None,
            "encounter_type": None,
            "soap_note": None,
            "diagnoses": [],
            "message": "No prior encounters found for this patient.",
        })

    encounter = encounters[0]
    encounter_id = encounter.get('id', '')
    enc_date = (
        encounter.get('period', {}).get('start')
        or encounter.get('actualPeriod', {}).get('start')
        or ''
    )[:10]

    enc_types = encounter.get('type', []) or []
    enc_type_str = ''
    if enc_types:
        coding = enc_types[0].get('coding', [])
        if coding:
            enc_type_str = coding[0].get('display', '') or coding[0].get('code', '')

    # Linked DocumentReference (SOAP note)
    soap = None
    docrefs = fhir_search('DocumentReference', {
        'patient': patient_id,
        'related': f'Encounter/{encounter_id}',
        '_count': 5,
    })

    # Some HealthLake DocumentReferences use 'encounter' search param instead
    if not docrefs:
        docrefs = fhir_search('DocumentReference', {
            'patient': patient_id,
            'encounter': encounter_id,
            '_count': 5,
        })

    if docrefs:
        soap = _parse_soap(docrefs[0])

    # Diagnoses from the Encounter
    diagnoses = []
    for diag in encounter.get('diagnosis', []) or []:
        condition_ref = diag.get('condition', {}).get('reference', '')
        if condition_ref.startswith('Condition/'):
            cond_id = condition_ref.split('/', 1)[1]
            # Lightweight — we already have the encounter; defer Condition
            # read until we have a bulk-fetch helper to keep this fast
            diagnoses.append({'condition_id': cond_id})

    body = {
        "patient_id": patient_id,
        "patient_name": patient_display_name(patient),
        "encounter_date": enc_date,
        "encounter_type": enc_type_str,
        "soap_note": soap,
        "diagnoses": diagnoses,
    }
    return response(event, 200, body)


def _parse_soap(docref: dict) -> dict:
    """
    Extract S/O/A/P sections from a DocumentReference. Bedrock-generated SOAP
    is stored as either base64-encoded text in content.attachment.data or a
    URL pointing to S3. This sample handles the inline case; production
    deployments should resolve S3 URLs and use signed GETs.
    """
    contents = docref.get('content', []) or []
    if not contents:
        return None

    attachment = contents[0].get('attachment', {}) or {}
    text = ''
    if attachment.get('data'):
        try:
            text = base64.b64decode(attachment['data']).decode('utf-8')
        except (ValueError, UnicodeDecodeError):
            logger.warning("[recent_visit] could not decode attachment data")
            return None
    else:
        # url-based attachment — not resolved in this sample
        logger.info("[recent_visit] attachment has url, not inline data — returning empty SOAP")
        return None

    # Naive section parsing — look for SUBJECTIVE, OBJECTIVE, ASSESSMENT, PLAN headers
    sections = {'subjective': '', 'objective': '', 'assessment': '', 'plan': ''}
    current = None
    for line in text.splitlines():
        upper = line.strip().upper()
        if upper.startswith('SUBJECTIVE'):
            current = 'subjective'
        elif upper.startswith('OBJECTIVE'):
            current = 'objective'
        elif upper.startswith('ASSESSMENT'):
            current = 'assessment'
        elif upper.startswith('PLAN'):
            current = 'plan'
        elif current and line.strip():
            sections[current] += line + '\n'

    # Strip trailing newlines
    sections = {k: v.strip() for k, v in sections.items()}
    if not any(sections.values()):
        # Couldn't parse — return raw text in 'subjective' as fallback
        sections['subjective'] = text[:2000]
    return sections
