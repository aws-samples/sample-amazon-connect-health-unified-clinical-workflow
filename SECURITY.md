# Security Policy

## Reporting a Vulnerability

If you discover a potential security issue in this project, we ask that you
notify AWS Security via the [vulnerability reporting page](https://aws.amazon.com/security/vulnerability-reporting/)
or directly via email to <aws-security@amazon.com>.

**Please do not create a public GitHub or GitLab issue for security vulnerabilities.**

## What to Include

When reporting, please provide:

1. A description of the vulnerability and its potential impact
2. Steps to reproduce, or proof-of-concept code (if applicable)
3. The version of the sample you tested against (commit hash)
4. Any suggested mitigations

## Response

AWS Security will acknowledge receipt within 24 hours and provide an initial
assessment within 5 business days. We follow the
[AWS Vulnerability Disclosure Policy](https://aws.amazon.com/security/vulnerability-reporting/)
for coordinated disclosure.

## Scope

This security policy covers:

- The sample code in this repository
- The CloudFormation templates in this repository
- The deployment scripts in `scripts/`

This policy does **not** cover:

- Issues with Amazon Connect Health, AWS HealthLake, Amazon Bedrock, or other
  AWS services (report those directly to AWS Security)
- Issues in dependencies (Python, Node, Java packages): report those to the
  upstream maintainer

## Healthcare-Specific Notes

This sample handles workflows that, in production, would touch Protected
Health Information (PHI). Vulnerabilities that could enable PHI exposure,
even in the sample's synthetic-data context, are treated as high-priority.
Examples include:

- IAM policies in this sample that, if copy-pasted by a customer, would
  grant excessive access to a HealthLake datastore or Connect Health domain
- Cross-Site Scripting (XSS) or injection vulnerabilities in frontend code
  that could be exploited if the sample were deployed against real patient
  data
- Logging or telemetry patterns that could exfiltrate PHI

If you find one of these patterns, please report through the channels above.

## Acknowledgments

We recognize researchers who responsibly disclose security issues. With your
permission, we will list you in our [Security Hall of Fame](https://aws.amazon.com/security/vulnerability-reporting/)
upon coordinated disclosure.
