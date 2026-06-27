# HIPAA Notice

This sample demonstrates clinical workflows that, in production, would
process Protected Health Information (PHI) as defined under the Health
Insurance Portability and Accountability Act (HIPAA) and the Health
Information Technology for Economic and Clinical Health Act (HITECH).

## Status of this sample

- **All data in this repository is synthetic.** No real PHI is present.
  See [`../NOTICE.md`](../NOTICE.md) for the full synthetic-data attestation.
- **No BAA is required** to clone, inspect, or run this sample in demo
  mode against synthetic data.
- **A Business Associate Addendum (BAA) is required** before deploying
  any part of this sample against real patient data.

## HIPAA-eligible AWS services used

The following AWS services used by this sample are HIPAA-eligible (AWS
will execute a BAA covering them):

- Amazon Connect
- Amazon Connect Health
- AWS HealthLake
- Amazon Bedrock
- Amazon Kinesis Video Streams
- Amazon ECS, AWS Fargate
- Amazon S3
- AWS Lambda
- Amazon SNS
- Amazon CloudFront
- Amazon CloudWatch
- AWS Key Management Service (AWS KMS)
- AWS Identity and Access Management (IAM)

For the authoritative current list, see the [AWS HIPAA-eligible services
page](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/).

## Operator obligations for production deployment

Before processing real PHI on any deployment derived from this sample:

1. **Execute a BAA** with AWS via your AWS account team or the AWS
   Artifact console. The BAA must be in place before any PHI is
   transmitted or stored.

2. **Implement the controls in [`RESPONSIBLE_AI.md`](../RESPONSIBLE_AI.md)**:
   - Bedrock Guardrails enabled (template provided)
   - Human-in-the-loop approval on every AI output
   - Output validation against current coding standards
   - Bias monitoring
   - Comprehensive audit logging

3. **Encrypt PHI at rest using customer-managed AWS KMS keys.** The
   sample uses AWS-managed keys for simplicity; production deployments
   should use customer-managed keys with appropriate key policies and
   rotation.

4. **Enable AWS CloudTrail logging** in the deployment account, with
   logs forwarded to a centralized security account that the
   application identity cannot modify.

5. **Implement access logging on Amazon S3 buckets** that hold clinical
   outputs.

6. **Configure VPC Flow Logs** if VPCs are deployed.

7. **Review and harden the IAM roles** in `provider-workflow/infrastructure/`
   to match your organization's least-privilege policies.

8. **Implement appropriate authentication and authorization** for the
   workspace third-party applications. The sample includes Amazon
   Cognito scaffolding; production should integrate with the organization's
   identity provider.

9. **Conduct a Security Risk Assessment** as required under HIPAA Security
   Rule §164.308(a)(1)(ii)(A) before going live.

10. **Document the workflow** in your organization's policies and
    procedures (HIPAA Security Rule §164.316).

## What this sample does not cover

- **State law variations** in healthcare privacy and AI regulation
- **International healthcare privacy regulations** (GDPR for EU, PIPEDA
  for Canada, etc.), only US HIPAA is addressed
- **FDA regulations on clinical decision support software**: this
  sample provides documentation support, not diagnostic decision support,
  but the line between the two is not always clear and depends on use
- **Specific certifications** like SOC 2, HITRUST, or ONC: these are
  inherited from AWS for the underlying services, but the application
  built on top must be assessed independently

## Reporting suspected PHI exposure

If you discover a code pattern in this sample that could lead to
inadvertent PHI exposure if deployed against real patient data, report
it via [`SECURITY.md`](../SECURITY.md). PHI-exposure vulnerabilities are
treated as high-priority.

## Disclaimer

This document is provided for general guidance and is not legal advice.
Consult your compliance and legal teams before any production deployment
involving PHI.
