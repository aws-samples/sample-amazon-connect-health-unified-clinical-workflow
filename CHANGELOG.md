# Changelog

All notable changes to this sample are documented here. This project follows
[Semantic Versioning](https://semver.org/) for releases tagged in git.

## [Unreleased]

### Added
- Dependabot configuration (`.github/dependabot.yml`) scanning Maven,
  Python, and GitHub Actions dependencies weekly, with grouped
  patch/minor updates per ecosystem.
- Auto-merge workflow (`.github/workflows/dependabot-auto-merge.yml`)
  that approves and merges patch/minor Dependabot PRs automatically
  and leaves major-version bumps for human review.
- Architecture diagrams as PNGs (`docs/images/figure-1-provider-workflow.png`,
  `docs/images/figure-2-care-manager-workflow.png`) with editable draw.io
  PDF sources, embedded in the README's Architecture section.
- `THIRD-PARTY-LICENSES` file documenting Synthea (Apache 2.0, MITRE)
  and Python runtime dependencies (Flask, Flask-CORS, boto3, botocore,
  requests, gunicorn) — required for aws-samples publication.

### Changed
- Repository clone URLs in `README.md` and `docs/demo-mode-guide.md`
  updated from internal GitLab to the target `github.com/aws-samples`
  destination in preparation for public publication.
- Minor text edits and restructure: reordered README to lead with
  "What this sample shows" → "Architecture" → "Repository structure"
  before audience routing; replaced em-dashes in prose with colons
  (heading labels, list items) and commas/parentheses (mid-sentence)
  for cleaner reading.

## [0.1.0] - 2026-06-27

Initial release.

### Provider workflow (Blog Post 1)
- Python Flask backend (ECS Fargate) with SigV4-signed HealthLake calls,
  Bedrock invocations with conditional Guardrails, and FHIR writeback
  on clinician approval
- Java audio bridge (ECS Fargate) consuming Kinesis Video Streams audio
  and forwarding to Amazon Connect Health ambient documentation
- Clinical Workspace third-party application (HTML/JS frontend)
- Patient verification Lambda + SMS notification Lambda
- Amazon Connect Contact Flow
- CloudFormation templates: backend (with CodeBuild + CloudFront proxy
  stacks), bridge (with CodeBuild + CloudFront + WebSocket API stacks)

### Care manager workflow (Blog Post 2)
- Amazon Bedrock Agent with six action groups querying AWS HealthLake:
  `patient_summary`, `recent_visit`, `a1c_trend`, `overdue_a1c`,
  `no_show_patients`, `diabetic_risk`
- Six OpenAPI 3.0 schemas defining the agent's tool contracts
- Six Python Lambda implementations with a shared SigV4 FHIR client
- Flask proxy backend (ECS Fargate) calling `bedrock-agent-runtime
  InvokeAgent` for the chat UI, with 9 unit tests
- Care Intelligence third-party application (HTML/JS frontend)
- CloudFormation templates: Bedrock Agent stack + ECS backend stack

### Shared infrastructure
- HealthLake datastore + S3 buckets + IAM roles CFN stack
- Healthcare-specific Amazon Bedrock Guardrail CFN template
- Synthea bulk-import Python script for HealthLake

### Demo mode
- Provider workflow runs entirely locally against cached Synthea data —
  no AWS credentials required
- Three synthetic patients with full clinical narratives, SOAP notes,
  medical codes, and after-visit summaries

### Security & Responsible AI
- Bedrock Guardrails template with HIGH content filters, PII redaction,
  denied topics for unsupervised diagnosis/treatment, word filters for
  HITL bypass phrases
- PHI-safe logging convention across all Python and JavaScript code
- IAM roles scoped to specific resource ARNs (no wildcards on data ARNs)
- Required AI-content disclaimers on every UI surface and API response
- Pre-commit security check with 8 enforced patterns
- GitLab CI pipeline (lint + security + test stages)

### Documentation
- `README.md` with audience-aware quick-start paths
- `docs/architecture.md`, `docs/deployment-guide.md`,
  `docs/demo-mode-guide.md`, `docs/HIPAA-NOTICE.md`
- `RESPONSIBLE_AI.md`, `SECURITY.md`, `NOTICE.md`, `DEPLOYMENT_NOTES.md`
- Per-workflow README files and Lambda implementation notes

### License
- MIT-0
