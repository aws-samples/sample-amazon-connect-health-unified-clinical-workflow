# Architecture

This document describes the two-workflow architecture and the shared
foundation services. For deployment instructions, see
[`deployment-guide.md`](deployment-guide.md).

## Design principles

1. **One Amazon Connect Health domain, one HealthLake datastore.** The
   provider workflow and the care manager workflow query the same data.
   No ETL, no batch replication, no separate analytics store.
2. **Single-account.** All AWS services live in the same AWS account as
   the application backend. No cross-account assume-role required.
3. **Third-party application pattern.** Both workspaces register as
   Amazon Connect third-party applications and embed inside Agent
   Workspace. Same delivery vehicle, different role-specific UI.
4. **Data plane execution.** Real-time paths (audio capture, transcript
   relay, Bedrock invocation) operate via data plane APIs to remain
   available during regional events.
5. **Responsible AI by default.** Bedrock invocations conditionally
   attach a healthcare-tuned Guardrail. All AI outputs carry disclaimers.
   Persistence requires explicit clinician approval.

## Provider workflow (Figure 1)

A patient calls the clinic. Amazon Connect verifies their identity, opens
an ambient documentation session, routes the call to a clinician, and the
Clinical Workspace third-party app displays a pre-prepared chart with
patient insights. The conversation streams to Amazon Connect Health
ambient documentation, which produces SOAP notes and medical codes. The
clinician reviews, approves, and the data writes to AWS HealthLake.

### Figure 1 components

1. **Patient phone**: dials in to the clinic's Amazon Connect number.
2. **Amazon Connect**: Contact Flow handles call routing, DTMF
   verification, and media streaming activation.
3. **AWS Lambda (patient verification)**: invoked from Contact Flow,
   queries AWS HealthLake for a matching Patient resource using caller
   phone number and DTMF-entered DOB.
4. **AWS HealthLake**: FHIR R4 datastore. Holds Patient, Encounter,
   DocumentReference, Condition, Observation, MedicationRequest resources.
5. **Amazon Kinesis Video Streams**: receives call audio when Contact
   Flow activates Start Media Streaming.
6. **Amazon ECS on AWS Fargate (audio bridge)**: Java service that
   consumes KVS audio fragments, upsamples 8kHz → 16kHz PCM, and streams
   to Amazon Connect Health ambient documentation.
7. **Amazon Connect Health**: point-of-care capabilities (patient
   insights, ambient documentation, medical coding).
8. **Amazon Connect Agent Workspace**: hosts the Clinical Workspace
   third-party application.
9. **Clinical Workspace**: frontend (CloudFront + S3) and backend (ECS
   Fargate, Python Flask), renders patient chart, live transcript,
   SOAP notes, medical codes, and after-visit summary.
10. **Amazon S3**: stores ambient-documentation output (SOAP, codes,
    after-visit summary, transcript).
11. **AWS Lambda + Amazon SNS**: S3 event triggers SMS delivery of the
    after-visit summary to the patient.

### Data flow

```
Patient phone ──→ Amazon Connect Contact Flow
                       │
                       ├──→ AWS Lambda (verify) ──→ HealthLake
                       │
                       ├──→ Start Media Streaming ──→ KVS
                       │                                │
                       │                                ▼
                       │                    ECS Java audio bridge
                       │                                │
                       │                                ▼
                       │                    Amazon Connect Health
                       │                    (ambient documentation)
                       │                                │
                       │                                ▼
                       │                                S3
                       │                                │
                       └──→ Agent Workspace ──→ Clinical Workspace
                                                       │
                                                       │ (clinician approves)
                                                       ▼
                                                  HealthLake
                                                  (Encounter, DocRef, Condition)
                                                       │
                                                       │ (S3 event on AVS)
                                                       ▼
                                              SMS Lambda → SNS → Patient
```

## Care manager workflow (Figure 2)

A care manager opens the Care Intelligence workspace, types a question in
natural language. Amazon Bedrock Agents reason about the question, call an
action group (one Lambda per task, patient summary, recent visit, A1c
trend, overdue A1c, no-show patients, diabetic risk), the Lambda queries
HealthLake, and the agent composes a natural-language response.

### Figure 2 components

1. **Care manager**: interacts with a browser-based chat interface.
2. **Amazon Connect Agent Workspace**: hosts the Care Intelligence
   third-party application.
3. **Care Intelligence app**: frontend (CloudFront) + backend (ECS
   Fargate Python proxy).
4. **Amazon Bedrock Agent**: Anthropic Claude model with action groups.
5. **Action group OpenAPI schemas**: stored in S3, describe the
   available tools to the agent.
6. **AWS Lambda functions**: one per action group, fulfill the agent's
   tool calls.
7. **AWS HealthLake**: same datastore as the provider workflow.
8. **Foundation model**: composes natural-language answers from tool
   results.

### Data flow

```
Care manager ──→ Agent Workspace ──→ Care Intelligence app
                                              │
                                              ▼
                                  ECS backend proxy
                                              │
                                              ▼
                                  Amazon Bedrock Agent
                                              │
                                              ├──→ Reads schemas from S3
                                              │
                                              ▼
                                  Tool call ──→ AWS Lambda
                                                     │
                                                     ▼
                                              HealthLake (FHIR query)
                                                     │
                                                     ▼
                                              Tool result
                                                     │
                                                     ▼
                                  Bedrock foundation model
                                  (compose response)
                                              │
                                              ▼
                                  Natural-language answer ──→ Care manager
```

## Shared foundation

| Resource | Purpose |
|---|---|
| AWS HealthLake datastore | Single FHIR R4 datastore both workflows query |
| Amazon Connect Health domain | Logical container for all AI capabilities |
| Amazon Bedrock Guardrail | Healthcare-tuned content filters, PII redaction, denied topics |
| Amazon S3 (clinical outputs bucket) | Ambient documentation outputs |
| Amazon S3 (action group schemas bucket) | OpenAPI schemas for Bedrock Agent |
| IAM roles | One ECS task role per service, one Lambda execution role per function, all scoped to specific ARNs |

## Network and security

- All inter-service traffic is HTTPS / TLS.
- S3 objects are encrypted at rest with AWS KMS (default keys; production
  should use customer-managed keys).
- ECS task roles follow least privilege: scoped to a single HealthLake
  datastore, S3 bucket, Connect Health domain, and Bedrock model.
- CloudFront distributions sit in front of both ALBs; origin access
  uses signed requests.
- Amazon Connect Health, AWS HealthLake, Amazon Bedrock, AWS Lambda, and
  Amazon ECS are HIPAA-eligible. A BAA must be in place before processing
  real patient data.
