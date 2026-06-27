# Care Manager Workflow

Companion code for **Blog Post 2: Closing the loop — From clinical
documentation to care manager insight with Amazon Bedrock and AWS
HealthLake**. This module implements the care-manager-facing workflow:
natural-language question → Bedrock Agent → action group Lambda →
HealthLake → natural-language answer.

## Components

| Subdirectory | Technology | What it does |
|---|---|---|
| `frontend/` | HTML/JS/CSS, served from CloudFront + S3 | Care Intelligence third-party application — chat interface |
| `backend/` | Python Flask on Amazon ECS Fargate | Thin proxy that forwards chat input to Amazon Bedrock and streams the response back |
| `bedrock-agent/action-groups/` | OpenAPI 3.0 schemas (YAML) | Define the action groups available to the Bedrock Agent (patient_summary, recent_visit, a1c_trend, overdue_a1c, no_show_patients, diabetic_risk) |
| `bedrock-agent/lambdas/` | Python Lambdas | One per action group — fulfill the agent's tool calls against HealthLake |
| `infrastructure/` | CloudFormation | Bedrock Agent + action groups + Lambdas + IAM roles |

## Six action groups at launch

| Action group | What it answers |
|---|---|
| `patient_summary` | "Give me a summary of [Patient]'s diabetic care." |
| `recent_visit` | "What did [Patient] talk about in their last visit?" |
| `a1c_trend` | "What's [Patient]'s A1c trend over the last 12 months?" |
| `overdue_a1c` | "Which diabetic patients are overdue for an A1c?" |
| `no_show_patients` | "Which patients no-showed in the last 30 days?" |
| `diabetic_risk` | "Which of my patients are at high risk for diabetic complications?" |

## Run locally (demo mode)

The care manager workflow requires deployment to a live AWS environment
because Bedrock Agents cannot be mocked offline. The shared
`bedrock-agent/lambdas/healthlake_client.py` does support running the
action group Lambdas locally against a real HealthLake datastore (set
`HEALTHLAKE_DATASTORE_ID` and configure AWS credentials), which is
useful for iterating on action group logic before redeploying.



## Run the backend locally

The care manager backend is a small Flask proxy. To run it against an
existing AWS HealthLake datastore and a deployed Bedrock Agent:

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env to set BEDROCK_AGENT_ID and BEDROCK_AGENT_ALIAS_ID from your
# care-manager Bedrock Agent stack outputs.
export $(cat .env | grep -v '^#' | xargs)
python3 server.py
# Listens on http://localhost:5001
```

To run the unit tests (no AWS credentials needed):

```bash
cd backend
pip install pytest
python3 -m pytest tests/ -v
```

The test suite mocks all Bedrock calls; 9 tests cover the happy path,
authorization errors, throttling, missing parameters, and disclaimer
attachment.

## Deploy to AWS

See [`../docs/deployment-guide.md`](../docs/deployment-guide.md) Step 5.

## Required environment variables

| Variable | Required | Description |
|---|---|---|
| `AWS_REGION` | Yes | All AWS calls |
| `BEDROCK_AGENT_ID` | Yes | The Bedrock Agent created in Step 5a |
| `BEDROCK_AGENT_ALIAS_ID` | Yes | The agent alias to invoke |
| `HEALTHLAKE_DATASTORE_ID` | Yes | Same as provider workflow |

## The Bedrock Schema Cache gotcha

When iterating on action group OpenAPI schemas during development, calling
`PrepareAgent` alone is **not sufficient** to pick up a revised schema in S3.
You must call `UpdateAgentActionGroup` first (which forces the action group
to re-read the schema), then `PrepareAgent`. Otherwise the agent will
appear to ignore your latest tool definitions.

This is documented in the deployment script `scripts/update-action-groups.sh`.

## CSR compliance

The CSR audited the predecessor repo and flagged GenAI/Responsible-AI
findings. This module:

- Uses the shared `BEDROCK_GUARDRAIL_ID` env var consumed by the proxy
  backend, applying the same healthcare guardrail as the provider workflow
- Returns a `disclaimer` field on every Bedrock-touching API response
- Surfaces an AI-content disclaimer banner in the chat UI
