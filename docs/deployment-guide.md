# Deployment Guide

End-to-end deployment of the unified clinical workflow sample to AWS.
For local demo without AWS credentials, see [`demo-mode-guide.md`](demo-mode-guide.md).

## Prerequisites

- AWS account with these services enabled in your target region:
  - Amazon Connect (instance created)
  - Amazon Connect Health
  - AWS HealthLake
  - Amazon Bedrock with Claude model access
  - Amazon ECS, AWS Fargate
  - Amazon S3, AWS Lambda, Amazon SNS
- AWS CLI configured with appropriate credentials
- A Business Associate Addendum (BAA) executed with AWS if you plan to
  ingest real patient data (not required for synthetic-data testing)
- Python 3.9+, Java 17+, Maven 3.6+, Docker
- Local clone of this repository

## Recommended region

`us-east-1` is the recommended region as it has the broadest service
availability for Amazon Connect Health and Amazon Bedrock at GA.

## Step 1 — Deploy shared infrastructure

Deploys the HealthLake datastore, the Connect Health domain, and the S3
bucket for clinical outputs.

```bash
aws cloudformation deploy \
  --stack-name unified-cw-shared \
  --template-file shared/cloudformation/shared-resources-stack.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

Note the outputs — you'll need:
- `HealthLakeDatastoreId`
- `ConnectHealthDomainId`
- `ClinicalOutputsBucketName`

## Step 2 — Deploy the Bedrock Guardrail

Required for any production deployment. Optional but recommended even for
synthetic-data testing.

```bash
aws cloudformation deploy \
  --stack-name unified-cw-guardrail \
  --template-file shared/bedrock-guardrails/healthcare-guardrail.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --parameter-overrides Environment=dev
```

Note the outputs — you'll need:
- `GuardrailId`
- `GuardrailVersion`

## Step 3 — Load synthetic FHIR data into HealthLake

```bash
cd shared/healthlake
python3 load-sample-data.py \
  --datastore-id <HealthLakeDatastoreId> \
  --region us-east-1
```

This loads Synthea-generated FHIR resources for the three demo patients
(Elena Rodriguez, Diego Ramirez, Márcia Oliveria). The script idempotently
checks for existing resources and skips them on re-run.

## Step 4 — Build and deploy the provider workflow

### 4a. Build the Java audio bridge

```bash
cd provider-workflow/bridge
mvn clean package
docker build -t connect-health-bridge:latest .
```

### 4b. Deploy the backend infrastructure

```bash
cd provider-workflow/infrastructure/backend
aws cloudformation deploy \
  --stack-name unified-cw-provider-backend \
  --template-file cloudformation.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --parameter-overrides \
    HealthLakeDatastoreId=<from-step-1> \
    DomainId=<from-step-1> \
    OutputBucketName=<from-step-1> \
    BedrockGuardrailId=<from-step-2> \
    BedrockGuardrailVersion=<from-step-2>
```

### 4c. Deploy the bridge infrastructure

```bash
cd ../bridge
aws cloudformation deploy \
  --stack-name unified-cw-provider-bridge \
  --template-file cloudformation.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --parameter-overrides \
    DomainId=<from-step-1>
```

### 4d. Deploy the Lambdas

```bash
cd ../../lambdas/patient-verification
zip -r function.zip index.py
aws lambda update-function-code \
  --function-name connect-health-patient-verification \
  --zip-file fileb://function.zip

cd ../sms-notification
zip -r function.zip lambda_function.py
aws lambda update-function-code \
  --function-name connect-health-sms-notification \
  --zip-file fileb://function.zip
```

### 4e. Import the Contact Flow

In Amazon Connect Console:

1. Open your instance → Routing → Contact Flows
2. Click "Create contact flow"
3. Use Import → upload `provider-workflow/connect-flow/contact-flow.json`
4. Replace the `<PATIENT_VERIFICATION_LAMBDA_ARN>` placeholder with the
   real ARN from the Lambda deployed in step 4d
5. Save and Publish

### 4f. Register the Clinical Workspace as a third-party application

In Amazon Connect Console → Applications:

1. Add application
2. Name: `Clinical Workspace`
3. URL: the CloudFront distribution URL from step 4b
4. Add to the routing profile that should see this app

## Step 5 — Deploy the care manager workflow

### 5a. Deploy Bedrock Agent + action groups

```bash
cd care-manager-workflow/infrastructure
aws cloudformation deploy \
  --stack-name unified-cw-care-manager \
  --template-file cloudformation.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --parameter-overrides \
    HealthLakeDatastoreId=<from-step-1> \
    BedrockGuardrailId=<from-step-2>
```

### 5b. Register the Care Intelligence as a third-party application

Same as 4f, but with the Care Intelligence CloudFront URL.

## Step 6 — Smoke test

### Provider workflow

1. Call the Connect inbound number with one of the demo patient's
   numbers (or override via SSML)
2. Enter the patient's DOB at the DTMF prompt
3. Accept the call as a clinician — Clinical Workspace should open
4. Have a conversation (the audio bridge streams to ambient docs)
5. Hang up
6. Within ~60 seconds, the workspace should display SOAP notes
7. Click "Approve & Save" — verify a new Encounter resource appears in
   HealthLake
8. Verify the patient receives an SMS

### Care manager workflow

1. Open the Care Intelligence app
2. Ask: "What did Mary Anne Johnson talk about in her last visit?"
3. Verify the agent returns a structured summary
4. Ask: "Which patients are overdue for an A1c?"
5. Verify the agent returns a list

## Teardown

```bash
# In reverse order
aws cloudformation delete-stack --stack-name unified-cw-care-manager
aws cloudformation delete-stack --stack-name unified-cw-provider-bridge
aws cloudformation delete-stack --stack-name unified-cw-provider-backend
aws cloudformation delete-stack --stack-name unified-cw-guardrail
aws cloudformation delete-stack --stack-name unified-cw-shared

# Verify all stacks deleted
aws cloudformation list-stacks --stack-status-filter DELETE_COMPLETE
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Bedrock invoke returns AccessDenied | Backend role not granted bedrock:InvokeModel | Verify IAM role policy includes the Claude model ARN |
| HealthLake query returns 403 | Domain not registered with HealthLake | Re-run step 1 stack; check CFN outputs |
| Workspace doesn't load in Agent Workspace | Third-party app URL not in CloudFront whitelist | Add the Connect instance URL to CloudFront origins |
| Audio bridge can't connect to KVS | IAM scoping mismatch on bridge ECS task role | Verify bridge role has `kinesisvideo:GetMedia` |
| Bedrock Agent returns "I don't have a tool for that" | Action group schema not preparation-uploaded | Run UpdateAgentActionGroup, then PrepareAgent |

## Cost considerations

This sample uses pay-per-use services. For a low-volume demo running 8
hours/day with 10 calls/day:

| Service | Estimated monthly cost |
|---|---|
| Amazon Connect (voice) | $10-30 |
| Amazon Connect Health (preview pricing) | Contact AWS account team |
| AWS HealthLake (per-resource storage) | $5-15 |
| Amazon Bedrock (Claude tokens) | $20-50 |
| ECS Fargate (2 services, always-on) | $30-50 |
| Other (S3, Lambda, SNS, CloudFront) | $5-15 |
| **Total** | **~$80-200/month** |

Shut down the ECS services when not testing to reduce cost.
