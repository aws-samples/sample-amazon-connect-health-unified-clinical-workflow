# Notice: Sample Code and Synthetic Data

This repository contains sample code and synthetic data that demonstrate how
to build clinical workflows on AWS using Amazon Connect Health, AWS HealthLake,
and Amazon Bedrock.

## All Data Is Synthetic

No file in this repository contains:

- Real Protected Health Information (PHI) under HIPAA, HITECH, or any
  international healthcare privacy regulation
- Real Personally Identifiable Information (PII) of any individual
- Real AWS account identifiers, resource ARNs, access keys, or secrets
- Real medical record numbers, NPIs, or other identifiers from any
  production system

Patient names (Elena Rodriguez, Diego Ramirez, Márcia Oliveria) are
synthetic identities. The underlying FHIR clinical data was generated using
[Synthea](https://synthea.mitre.org/), MITRE's open-source synthetic patient
generator, which produces realistic but entirely fictional medical records. Clinical narratives, vital signs, and procedure
descriptions are illustrative scenarios written for demonstration purposes
only. Phone numbers use the RFC 3966 reserved range (555-0100 through
555-0199) for fictional/example use.

See `provider-workflow/backend/demo_cache/README.md` for a complete
inventory of synthetic data in this sample.

## Not For Production Use Without Configuration

This sample is published for educational purposes. Before deploying any
part of this code into an environment that handles real patient data, you
must, at minimum:

1. **Configure Amazon Bedrock Guardrails** using the template at
   `shared/bedrock-guardrails/healthcare-guardrail.yaml` and set the
   `BEDROCK_GUARDRAIL_ID` environment variable on the backend.
2. **Execute a HIPAA-eligible Business Associate Addendum (BAA)** with AWS
   for your AWS account, covering all services used by this workload.
3. **Review and harden the IAM roles** in `provider-workflow/infrastructure/`
   to match your organization's least-privilege policies.
4. **Implement human-in-the-loop review** of every AI-generated clinical
   output (SOAP notes, medical codes, patient insights, after-visit
   summaries) before any clinical use, as required by the disclaimers
   already present in the user interface.
5. **Enable comprehensive audit logging** on AWS HealthLake, Amazon Connect
   Health, and Amazon Bedrock.

The disclaimers shown in the user interface (in `provider-workflow/frontend/`)
are required and must remain visible to clinicians in any derived deployment.

## Responsible AI

See `RESPONSIBLE_AI.md` for the responsible-AI commitments embedded in this
sample and the corresponding obligations for any production deployment built
on this code.
