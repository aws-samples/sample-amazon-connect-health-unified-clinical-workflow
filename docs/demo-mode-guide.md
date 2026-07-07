# Demo Mode Guide

Run the unified clinical workflow sample locally without any AWS
credentials or live AWS services. Demo mode serves Synthea-generated
cached responses from `provider-workflow/backend/demo_cache/` instead of
calling Amazon Connect Health, AWS HealthLake, and Amazon Bedrock.

This guide covers the provider workflow in demo mode. The care manager
workflow demo will be added in a future release (requires offline mock
for Bedrock Agents).

## What demo mode shows

You'll see the complete end-to-end provider workflow with three synthetic
patients:

| Patient | Conditions | What you'll see |
|---|---|---|
| Elena Rodriguez (b. 1962) | Hypertension, hyperlipidemia, tension headaches | Full SOAP note for headache evaluation visit |
| Diego Ramirez (b. 1985) | Dental complaints, post-procedural follow-up | Pre-visit summary of dental conditions and abscess history |
| Márcia Oliveria (b. 1963) | Type 2 diabetes, ophthalmology referral lapse | Pre-visit summary with A1c trend and care gaps |

## Setup

```bash
git clone https://github.com/aws-samples/sample-amazon-connect-health-unified-clinical-workflow.git
cd sample-amazon-connect-health-unified-clinical-workflow

# Install local pre-commit hook (optional but recommended)
bash scripts/install-hooks.sh

# Set up Python environment
cd provider-workflow/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
# Start the backend in demo mode
python3 server.py --demo
```

You should see:

```
 * Running on http://localhost:5000
 [DEMO MODE] No AWS calls will be made. Serving cached responses.
```

Open `http://localhost:5000` in a browser.

## Walkthrough

### 1. Patient list

The home screen shows three synthetic patients. Click any patient to open
their chart.

### 2. Pre-visit summary

When you open a patient, the workspace fires a `synthesize_previsit` call
to the backend. In demo mode, this returns the cached Bedrock response
from `demo_cache/synthesize_previsit_<mrn>.json`. You'll see:

- The patient's story (narrative paragraph with [REF#] citations)
- Since-last-visit events (vital signs, procedures, meds)
- Visit priorities (must-address, outstanding, checklist)

### 3. Patient insights

Click "Load Patient Insights", returns cached Amazon Connect Health
Patient Insights output from `demo_cache/patient_insights_<mrn>.json`,
showing structured clinical sections.

### 4. Simulated consultation

The "Start Consultation" flow is gated, in demo mode it can't actually
record audio, but it walks through the consent banner and reminds the
patient that AI assistance will be used.

### 5. SOAP notes (cached)

Switch to the SOAP overlay (Ctrl+Shift+S). Demo mode loads
`demo_cache/streaming_outputs_default.json` which contains a complete
SOAP note for a hypertension + tension-headache visit, including:

- SUBJECTIVE (HPI, ROS, PMH, Medications)
- OBJECTIVE (Vital Signs, Physical Exam)
- ASSESSMENT (3 diagnoses)
- PLAN (treatment, follow-up)
- ICD-10 and CPT codes with confidence scores
- After-visit summary

### 6. Approve & save (no-op in demo)

The "Approve & Save" button is disabled in demo mode (it would normally
write FHIR resources to HealthLake, there's nothing to write to). The
disclaimer banner remains visible to demonstrate the human-in-the-loop
requirement.

## Toggle demo mode at runtime

You can also toggle demo mode without restarting the server:

- **Via UI**: Press `Ctrl+Shift+D` to flip demo mode on/off
- **Via header**: Send `X-Demo-Mode: true` on any API request

## Recording new demo data

If you have a real (synthetic) HealthLake datastore and a real Amazon
Connect Health domain configured, you can record fresh cached responses:

```bash
DEMO_RECORD=true python3 server.py
```

All API responses will be saved to `demo_cache/` automatically. Switch
off recording when you have what you need.

> ⚠️ **Do not run `DEMO_RECORD=true` against any HealthLake datastore
> that contains real patient data.** Recording would write live PHI to
> disk and into the demo_cache directory.

## Limitations of demo mode

| Feature | Demo mode behavior |
|---|---|
| Live audio capture | Not available — playback only |
| Live Bedrock invocations | Cached responses only |
| Live HealthLake reads | Cached responses only |
| Approve & save → FHIR write | Disabled (no datastore to write to) |
| SMS notification | Logs the message but doesn't send |
| Patient verification via Connect Contact Flow | Skipped — patient selection is from the UI |

For full end-to-end testing, use the [live deployment guide](deployment-guide.md).
