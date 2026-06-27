# Provider Workflow

Companion code for **Blog Post 1: Building a unified clinical workflow on
Amazon Connect**. This module implements the clinician-facing workflow:
patient call → verification → ambient documentation → SOAP review →
HealthLake persistence → SMS follow-up.

## Components

| Subdirectory | Technology | What it does |
|---|---|---|
| `backend/` | Python Flask on Amazon ECS Fargate | REST API for patient context, Bedrock pre-visit synthesis, FHIR resource lookups, FHIR writeback on approval |
| `bridge/` | Java on Amazon ECS Fargate | Consumes audio from Amazon KVS, upsamples 8→16 kHz, streams to Amazon Connect Health ambient documentation |
| `frontend/` | HTML/JS/CSS, served from CloudFront + S3 | Clinical Workspace third-party application — patient chart, live transcript, SOAP overlay |
| `lambdas/patient-verification/` | Python Lambda | Invoked from Contact Flow, matches caller phone + DOB to a HealthLake Patient resource |
| `lambdas/sms-notification/` | Python Lambda | Triggered by S3 event on after-visit summary, sends SMS via SNS |
| `connect-flow/contact-flow.json` | Amazon Connect Contact Flow | Orchestrates patient verification, media streaming, and routing |
| `infrastructure/backend/` | CloudFormation | Backend ECS service, ALB, CloudFront, IAM roles |
| `infrastructure/bridge/` | CloudFormation | Bridge ECS service, KVS access, WebSocket API |

## Run locally (demo mode)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 server.py --demo
# Open http://localhost:5000
```

See [`../docs/demo-mode-guide.md`](../docs/demo-mode-guide.md).

## Deploy to AWS

See [`../docs/deployment-guide.md`](../docs/deployment-guide.md) for the
end-to-end deployment of this workflow.

## Required environment variables (backend)

| Variable | Required for | Default |
|---|---|---|
| `AWS_REGION` | All AWS calls | `us-east-1` |
| `AWS_PROFILE` | Local dev only | (default chain) |
| `HEALTHLAKE_DATASTORE_ID` | HealthLake operations | (none — must set) |
| `DOMAIN_ID` | Connect Health operations | (none — must set) |
| `S3_OUTPUT_BUCKET` | Reading ambient docs outputs | (none — must set) |
| `STREAMING_OUTPUT_BUCKET` | Reading streaming outputs | falls back to `S3_OUTPUT_BUCKET` |
| `BEDROCK_MODEL_ID` | Bedrock invocations | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` |
| `BEDROCK_REGION` | Bedrock invocations | `us-east-1` |
| `BEDROCK_GUARDRAIL_ID` | Production safety (REQUIRED for real PHI) | (blank by default) |
| `BEDROCK_GUARDRAIL_VERSION` | Pin guardrail version | `DRAFT` |
| `SMS_AWS_PROFILE` | If SMS in separate account | (uses default) |
| `SMS_ORIGINATION_NUMBER` | SNS sender ID | (none) |
| `CORS_ORIGINS` | Browser CORS | `*` (locked down in production) |

## Required environment variables (SMS Lambda)

| Variable | Required | Description |
|---|---|---|
| `SESSION_METADATA_BUCKET` | Yes | S3 bucket holding session metadata |
| `CLINIC_PHONE` | Yes | Display number in SMS (use `(555) 010-01xx` for testing) |
| `DEMO_PHONE_OVERRIDE` | No | If set, route all SMS to this number (for testing) |

## CSR compliance

This module has been audited against the AWS Code Security Review (CSR)
findings on the predecessor `sample-amazon-connect-health-clinical-workspace`
repo. See the root `CHANGELOG.md` for the full list of findings resolved.

## Testing

```bash
cd backend
pip install pytest
pytest tests/
```

Java tests (bridge):

```bash
cd bridge
mvn test
```
