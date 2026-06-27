# Deployment Notes

Practical engineering notes for deploying this sample into an AWS account.
These are guidance for the deploy-audience reader, things you'll want to
know going in to make the deployment smoother.

If you're running demo mode (`python3 server.py --demo` on your laptop),
nothing in this file applies to you.

---

## Connect Health domain creation

The Amazon Connect Health domain is not created by any CloudFormation
template in this repo. Connect Health is in preview at time of authoring,
and domains typically go through your AWS account team.

Workflow:

1. Engage your AWS account team to enable Connect Health and create a
   domain in your account.
2. Capture the domain ID (format: `dom-abc123def456`).
3. Pass it as the `DomainId` parameter to the provider-workflow backend
   and bridge stacks, and as the `ConnectHealthDomainId` parameter to
   the shared-resources stack.

---

## Amazon Bedrock Agent stack deployment

The `care-manager-workflow/infrastructure/cloudformation.yaml` template
defines a Bedrock Agent with six action groups inline (in
`AWS::Bedrock::Agent.ActionGroups`). CloudFormation support for inline
action group definitions has varied by provider version. If you hit a
validation error like `invalid ActionGroups` on first deploy:

1. Note the specific resource that failed
2. Split each action group into its own `AWS::Bedrock::AgentActionGroup`
   resource that references the parent agent via `AgentId`
3. Redeploy

The underlying AWS APIs (`CreateAgent`, `CreateAgentActionGroup`,
`PrepareAgent`) work the same way either path; this is a CFN-shape
choice, not a functional difference.

---

## Schema upload before Bedrock Agent preparation

The Bedrock Agent has `AutoPrepare: true`, meaning CloudFormation will
call `PrepareAgent` automatically during stack creation. `PrepareAgent`
requires the action group OpenAPI schemas to exist in S3 first.

**Always upload schemas before deploying the Bedrock Agent stack:**

```bash
# Step 1: Deploy the agent stack with AutoPrepare disabled, OR
# upload schemas first via the script
bash scripts/upload-action-group-schemas.sh dev

# Step 2: Now deploy the agent stack (AutoPrepare will succeed)
aws cloudformation deploy \
    --stack-name unified-cw-care-manager \
    --template-file care-manager-workflow/infrastructure/cloudformation.yaml \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
        HealthLakeDatastoreId=<from-shared-stack>
```

If you'd rather control the prepare step yourself, set `AutoPrepare: false`
in the template and run `aws bedrock-agent prepare-agent --agent-id $ID`
manually after the schemas are in place.

---

## Bedrock Agent schema cache behavior

When you update an OpenAPI schema in S3 during development, calling
`PrepareAgent` alone is not sufficient to pick up the change. The agent
caches schema content; you must force a re-read.

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

This is documented in `care-manager-workflow/bedrock-agent/lambdas/README.md`
and the `scripts/upload-action-group-schemas.sh` output.

---

## Lambda code deployment after stack creation

The action group Lambdas defined in the CFN template use placeholder
`ZipFile` code that returns 501 Not Implemented. This lets the stack
create successfully without packaging real code in the template.

Run the deploy script to replace the placeholder code with the real
implementation packaged with the shared HealthLake client:

```bash
bash scripts/deploy-action-group-lambdas.sh dev
```

The script:
- Packages each Lambda module together with `healthlake_client.py`
- Calls `aws lambda update-function-code` for all 6 action group Lambdas
- Cleans up zip artifacts between iterations

---

## HealthLake FHIR search-parameter quirks

AWS HealthLake's FHIR R4 search implementation has some documented
limitations vs. fully-compliant FHIR servers. The action group Lambdas
in this sample use patterns that should work, but if you hit unexpected
empty result sets, the most common culprits are:

| Pattern | Notes |
|---|---|
| `code=4548-4,17856-6` (comma-OR on code) | Generally supported |
| `_sort=-date` (descending date sort) | Supported on most resources; verify per resource type |
| `category=laboratory` on Observation | Supported |
| `clinical-status=active` on Condition | Supported |
| `name=Smith` (partial name match on Patient) | Behavior varies — the `find_patient_by_name` helper in `healthlake_client.py` applies token-overlap scoring on the client side as a backstop |

Refer to the [AWS HealthLake Search Parameters documentation](https://docs.aws.amazon.com/healthlake/latest/devguide/searching-with-the-healthlake-api.html)
for the authoritative supported set in your deployment region.

---

## Patient name fuzzy matching on Synthea data

Synthea-generated patient names follow a specific pattern like
`John378 Smith912` (where the numeric suffix is generation noise).
The `find_patient_by_name` helper scores candidates by token overlap
with the query, which works on real names ("John Smith") and on
Synthea names if the user types the noisy version verbatim.

For better Synthea UX, consider:

1. Stripping numeric suffixes in the loader before importing to HealthLake
2. Pre-populating an alias index that maps clean names to Synthea names
3. Switching to an exact-ID match flow if you provide a UI that
   exposes patient IDs

---

## DocumentReference SOAP attachment resolution

`recent_visit.py` decodes inline base64-encoded `DocumentReference.content
.attachment.data` only. If your HealthLake stores SOAP notes as S3 URL
pointers (common for content larger than a few KB), the Lambda logs a
warning and returns null SOAP.

To support URL-based attachments:

1. Add an S3 read permission to the action-group Lambda IAM role,
   scoped to the bucket holding ambient-documentation outputs
2. Update `_parse_soap` in `recent_visit.py` to fetch the URL and
   parse the same way

---

## ECR repository prerequisites

The provider-workflow backend, provider-workflow bridge, and
care-manager-workflow backend each need an ECR repository with a built
Docker image before their respective stacks can deploy.

Use the included script to create all three repositories in one pass:

```bash
bash scripts/create-ecr-repos.sh us-east-1
```

The script:
- Is idempotent (safe to re-run)
- Enables image scanning on push
- Configures AES256 encryption
- Tags repositories with the project tag

---

## diabetic_risk Lambda scoring

The `diabetic_risk` action group Lambda implements a composite risk
score combining A1c value, time since last A1c, and recent no-show
appointments. The scoring weights, thresholds, and contributing
factors are illustrative for the demo, not validated against clinical
outcome data.

For any production deployment:

- Validate weights against your population's outcome data
- Recalibrate the model quarterly
- Have clinical leadership review threshold changes
- Surface the score in the UI as a triage aid only, never as a
  diagnostic recommendation
- Add audit logging of every score generation event

See [`RESPONSIBLE_AI.md`](RESPONSIBLE_AI.md) for the operator
obligations around AI-generated clinical content.

---

## Production hardening checklist

This sample is a starting point. For production use against real
patient data, the following must be configured in addition to deploying
the stacks:

| Concern | Action |
|---|---|
| BAA with AWS | Execute via your AWS account team before any PHI flows |
| Bedrock Guardrails | Required — deploy `shared/bedrock-guardrails/healthcare-guardrail.yaml` and set the `BedrockGuardrailId` parameter on workflow stacks |
| KMS encryption | Switch HealthLake `CmkType` to `CUSTOMER_MANAGED_KMS_KEY` with a customer-managed key and key policy |
| HTTPS-only listeners | The sample uses HTTP listeners for brevity. Production must add ACM certificates and HTTPS listeners with HTTP→HTTPS redirect |
| CloudTrail | Enable in the deployment account with logs forwarded to a centralized security account |
| Frontend authentication | Beyond the basic Cognito scaffolding, integrate with your organization's identity provider |
| Audit logging | Implement comprehensive, immutable audit logging of every AI invocation and clinician approval |
| Bias monitoring | Periodic sampling of AI outputs by patient demographic |
| Output validation | ICD-10 and CPT code validation against current code sets |

See [`docs/HIPAA-NOTICE.md`](docs/HIPAA-NOTICE.md) for the full
operator obligations list.

---

## Contributing

If you deploy this end-to-end and find improvements, PRs are welcome.
Particularly valuable contributions:

- HTTPS-only listener variant of `backend-stack.yaml` (with ACM cert parameter)
- CloudFront-fronted frontend deployment stack for both workflows
- Synthea name-cleanup in the loader to improve fuzzy-match UX
- Care manager demo mode (mock the Bedrock Agent for no-AWS-account walkthroughs)
- Validated, peer-reviewed `diabetic_risk` scoring algorithm
