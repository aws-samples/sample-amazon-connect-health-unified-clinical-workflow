# Action Group Lambdas

One Python Lambda per Bedrock Agent action group. Each follows the same
pattern:

1. Receive the Bedrock Agent's tool-call event
2. Extract parameters from `requestBody.content['application/json'].properties`
3. Resolve patient via fuzzy name match (where applicable)
4. Query AWS HealthLake (SigV4-signed FHIR REST calls)
5. Return a structured response in the Bedrock Agent envelope

All Lambdas use the shared `healthlake_client.py` helper for SigV4 signing,
FHIR pagination, patient resolution, and Bedrock envelope formatting.

## Files

| File | Action group | Lines | What it does |
|---|---|---|---|
| `healthlake_client.py` | _(shared helper)_ | 359 | SigV4 FHIR client + Bedrock envelope helpers |
| `patient_summary.py` | `patient_summary` | 189 | Narrative summary: conditions + meds + recent labs + care gaps |
| `recent_visit.py` | `recent_visit` | 165 | Most recent Encounter + SOAP note (S/O/A/P sections) |
| `a1c_trend.py` | `a1c_trend` | 138 | A1c history over time window + improving/worsening/stable |
| `overdue_a1c.py` | `overdue_a1c` | 143 | T2DM patients with no A1c in last threshold_months months |
| `no_show_patients.py` | `no_show_patients` | 146 | Patients who missed appointments in last lookback_days days |
| `diabetic_risk.py` | `diabetic_risk` | 219 | Composite risk score on T2DM patients (A1c + adherence) |

Each Lambda has its own CloudFormation function resource in
`../infrastructure/cloudformation.yaml`. The CFN template uses inline
`ZipFile` placeholder code (returns 501 Not Implemented) so the stack
deploys successfully; deploy real code with
`bash scripts/deploy-action-group-lambdas.sh` after stack creation.

## Deployment

After the CloudFormation stack `unified-cw-care-manager` is deployed:

```bash
# 1. Upload OpenAPI schemas to the S3 bucket
bash scripts/upload-action-group-schemas.sh dev

# 2. Update each Lambda's code (zips the module + healthlake_client.py shared helper)
bash scripts/deploy-action-group-lambdas.sh dev

# 3. Refresh the Bedrock Agent so it re-reads any schema changes
AGENT_ID=$(aws cloudformation describe-stacks \
    --stack-name unified-cw-care-manager \
    --query 'Stacks[0].Outputs[?OutputKey==`AgentId`].OutputValue' \
    --output text)
aws bedrock-agent prepare-agent --agent-id $AGENT_ID

# 4. Smoke test via the AWS CLI
aws bedrock-agent-runtime invoke-agent \
    --agent-id $AGENT_ID \
    --agent-alias-id $(aws cloudformation describe-stacks \
        --stack-name unified-cw-care-manager \
        --query 'Stacks[0].Outputs[?OutputKey==`AgentAliasId`].OutputValue' \
        --output text) \
    --session-id smoke-test-1 \
    --input-text "What patients are overdue for an A1c?"
```

## Required IAM permissions (already set by CloudFormation)

Each Lambda runs with the `ActionGroupLambdaRole`, scoped to:

- `healthlake:ReadResource` / `SearchWithGet` / `SearchWithPost` on the
  specific datastore ARN
- `logs:CreateLogStream` / `PutLogEvents` on the shared LogGroup ARN only

No other AWS permissions are granted. If you add new query capabilities
that touch other services (e.g., Bedrock for additional summarization),
update the IAM role policy in `../infrastructure/cloudformation.yaml`.

## The Bedrock Agent schema cache gotcha

Per the blog Post 2 callout, when you update an OpenAPI schema in S3
during development, calling `PrepareAgent` alone is NOT sufficient.

```bash
# Wrong (schema stays cached):
aws bedrock-agent prepare-agent --agent-id $AGENT_ID

# Right (forces re-read from S3):
aws bedrock-agent update-agent-action-group \
    --agent-id $AGENT_ID \
    --agent-version DRAFT \
    --action-group-id $ACTION_GROUP_ID \
    --api-schema "s3={s3BucketName=$BUCKET,s3ObjectKey=action-groups/patient_summary.yaml}" \
    --action-group-name patient_summary \
    --action-group-executor "lambda=$LAMBDA_ARN"

aws bedrock-agent prepare-agent --agent-id $AGENT_ID
```

The CFN template uses `AutoPrepare: true` to handle this on stack create
or update, but ad-hoc schema iterations during development bypass CFN
and need the manual `update-agent-action-group` call.

## PHI-safe logging convention

All Lambdas in this directory follow the repository's PHI-safe logging
convention (see `../../../RESPONSIBLE_AI.md` and the Package 3 commit
history):

- **Never log**: patient names, DOB, phone, SSN, full record values
- **OK to log**: counts, lengths, ID prefixes (first 8 chars), direction
  labels, status codes
- **Pattern**: `logger.info("[func_name] count=%d direction=%s", count, dir)`

The patient name DOES appear in the response body returned to Bedrock —
that's how the agent composes natural-language answers. CloudWatch logs
remain PHI-free because we never write that body to a logger call.

## Risk-scoring disclaimer (diabetic_risk.py)

The `diabetic_risk` Lambda implements a sample composite risk function
combining A1c values, time since last A1c, and recent no-shows. **This
is not a validated clinical tool.** A production implementation should:

- Validate scoring weights against your population's outcome data
- Recalibrate periodically (quarterly recommended)
- Have clinical leadership review scoring logic and threshold changes
- Surface in the UI as a triage aid, never as a diagnostic recommendation
- Include audit logging of every score generated

The disclaimer attached to every response (via
`healthlake_client.response()`) reinforces this to the care manager,
but the operator is responsible for ensuring the workflow honors it.
