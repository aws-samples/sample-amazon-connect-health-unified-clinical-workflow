import json, os, boto3, urllib.request, urllib.parse
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from datetime import datetime, timezone

DATASTORE_ID    = os.environ.get("HEALTHLAKE_DATASTORE_ID", "7b6900c95ca6033ec7bbf64a6a6d0a7d")
DOMAIN_ID       = os.environ.get("DOMAIN_ID",        "dom-r7hxvtclpmb13tegc6jt0")
SUBSCRIPTION_ID = os.environ.get("SUBSCRIPTION_ID",  "sub-5J4N5WEiU7zVF9ujoMGhg")
REGION          = os.environ.get("AWS_DEFAULT_REGION","us-east-1")
BASE_URL        = f"https://healthlake.us-east-1.amazonaws.com/datastore/{DATASTORE_ID}/r4"

def fhir_get(path):
    url = f"{BASE_URL}/{path}"
    creds = boto3.session.Session().get_credentials().get_frozen_credentials()
    req = AWSRequest(method="GET", url=url, headers={"Content-Type": "application/fhir+json"})
    SigV4Auth(creds, "healthlake", REGION).add_auth(req)
    prepped = req.prepare()
    http_req = urllib.request.Request(url, headers=dict(prepped.headers))
    with urllib.request.urlopen(http_req, timeout=10) as resp:
        return json.loads(resp.read().decode())

def parse_dob(dtmf):
    """MMDDYYYY -> YYYY-MM-DD"""
    d = dtmf.strip() if dtmf else ""
    if len(d) != 8 or not d.isdigit():
        return None
    return f"{d[4:8]}-{d[0:2]}-{d[2:4]}"

def normalize_phone(phone):
    """Normalize to E.164 +1XXXXXXXXXX"""
    digits = ''.join(c for c in phone if c.isdigit())
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith('1'):
        return f"+{digits}"
    return f"+{digits}"

def has_upcoming_appointment(patient_id):
    """Check if patient has a booked appointment"""
    try:
        bundle = fhir_get(f"Appointment?patient={patient_id}&status=booked&_count=5")
        return len(bundle.get("entry", [])) > 0
    except:
        return False  # Don't block on appointment check failure

def lambda_handler(event, context):
    details      = event.get("Details", {})
    contact_data = details.get("ContactData", {})
    params       = details.get("Parameters", {})
    attrs        = contact_data.get("Attributes", {})

    # Get caller phone number (ANI)
    caller_phone_raw = contact_data.get("CustomerEndpoint", {}).get("Address", "")
    caller_phone     = normalize_phone(caller_phone_raw) if caller_phone_raw else ""

    # Get DOB input
    dob_dtmf = (attrs.get("dob_input") or params.get("dob_input", "")).strip()

    print(f"[VERIFY] Caller ANI received (length={len(caller_phone_raw)}; redacted — PHI). Normalized form computed.")
    print(f"[VERIFY] DOB input received (length={len(dob_dtmf) if dob_dtmf else 0}; redacted — PHI)")

    if not caller_phone:
        print("[VERIFY] No caller ID — cannot verify")
        return {"verified": "false", "error": "no_caller_id"}

    # Step 1: Look up patient by phone number
    try:
        encoded_phone = urllib.parse.quote(caller_phone)
        bundle = fhir_get(f"Patient?telecom={encoded_phone}&_count=5")
    except Exception as e:
        print(f"[VERIFY] HealthLake phone lookup error: {e}")
        return {"verified": "false", "error": "healthlake_error"}

    entries = bundle.get("entry", [])
    print(f"[VERIFY] Patients found by phone (redacted — PHI): {len(entries)} match(es)")

    if not entries:
        print("[VERIFY] No patient found for this phone number")
        return {"verified": "false", "error": "phone_not_registered"}

    patient   = entries[0]["resource"]
    pid       = patient["id"]
    name_obj  = patient.get("name", [{}])[0]
    full_name = f"{name_obj.get('given',[''])[0]} {name_obj.get('family','')}".strip()
    dob_fhir  = patient.get("birthDate", "")

    print(f"[VERIFY] Found patient: ID={pid[:8]}... (name/DOB redacted — PHI)")

    # Step 2: Check for booked appointment
    has_appt = has_upcoming_appointment(pid)
    print(f"[VERIFY] Has booked appointment: {has_appt}")

    # Step 3: Verify DOB if provided
    dob_input = parse_dob(dob_dtmf)
    if dob_input:
        if dob_input != dob_fhir:
            print(f"[VERIFY] DOB mismatch (values redacted — PHI)")
            return {"verified": "false", "error": "dob_mismatch",
                    "patient_name": full_name}  # Let flow say "wrong DOB"
        print(f"[VERIFY] DOB verified (value redacted — PHI)")
    else:
        print(f"[VERIFY] No DOB provided — ANI-only verification")

    print(f"[VERIFY] ✅ Verified (name redacted — PHI) | Appointment: {has_appt}")

    return {
        "verified":        "true",
        "patient_id":      pid,
        "patient_name":    full_name,
        "has_appointment": "true" if has_appt else "false",
        "domain_id":       DOMAIN_ID,
        "subscription_id": SUBSCRIPTION_ID,
        "datastore_id":    DATASTORE_ID,
    }
