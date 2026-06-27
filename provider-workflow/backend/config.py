# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""
Amazon Connect Health Demo — Backend Configuration

All configurable values live here. Override via environment variables for deployment.
For local development, set values in your shell or a .env file.
"""
import os

# =============================================================================
# AWS Configuration
# =============================================================================
# In ECS, leave AWS_PROFILE empty to use IAM role.
# For local dev, set to your AWS CLI profile name.
AWS_PROFILE = os.environ.get("AWS_PROFILE", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# =============================================================================
# Amazon Connect Health API (HealthAgent)
# =============================================================================
SERVICE_NAME = os.environ.get("SERVICE_NAME", "connecthealth")
SERVICE_ENDPOINT = os.environ.get("SERVICE_ENDPOINT", "https://runtime.health-agent.us-east-1.api.aws")
DOMAIN_ID = os.environ.get("DOMAIN_ID", "")  # e.g., dom-abc123def456

# =============================================================================
# HealthLake
# =============================================================================
HEALTHLAKE_DATASTORE_ID = os.environ.get("HEALTHLAKE_DATASTORE_ID", "")
HEALTHLAKE_DATASTORE_NAME = os.environ.get("HEALTHLAKE_DATASTORE_NAME", "")

# =============================================================================
# S3 - Patient Insights Output
# =============================================================================
S3_OUTPUT_BUCKET = os.environ.get("S3_OUTPUT_BUCKET", "")  # e.g., s3://my-bucket/insights-output/

# =============================================================================
# S3 - Streaming Output
# =============================================================================
STREAMING_OUTPUT_BUCKET = os.environ.get("STREAMING_OUTPUT_BUCKET", "")  # e.g., my-bucket (no s3:// prefix)
STREAMING_OUTPUT_REGION = os.environ.get("STREAMING_OUTPUT_REGION", "us-east-1")

# =============================================================================
# SMS Configuration (optional — requires Pinpoint SMS setup)
# =============================================================================
SMS_AWS_PROFILE = os.environ.get("SMS_AWS_PROFILE", "")
SMS_REGION = os.environ.get("SMS_REGION", "us-east-1")
SMS_ORIGINATION_NUMBER = os.environ.get("SMS_ORIGINATION_NUMBER", "")  # e.g., +18005551234

# =============================================================================
# Bedrock - Narrative Synthesis
# =============================================================================
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
BEDROCK_MAX_TOKENS = int(os.environ.get("BEDROCK_MAX_TOKENS", "2048"))

# Bedrock Guardrails (Responsible AI for healthcare AI content)
# Required for production deployments. Configure a guardrail using the template at
# shared/bedrock-guardrails/healthcare-guardrail.yaml and set both env vars below.
# Leave blank to disable (sample/demo only; not recommended for any data containing PHI).
BEDROCK_GUARDRAIL_ID = os.environ.get("BEDROCK_GUARDRAIL_ID", "")
BEDROCK_GUARDRAIL_VERSION = os.environ.get("BEDROCK_GUARDRAIL_VERSION", "DRAFT")

# =============================================================================
# Demo Mode - Cached S3 paths (patient_id -> s3_uri)
# After running Patient Insights jobs, add the output S3 URIs here to skip
# re-running jobs on every page load. Format:
#   "patient_fhir_id": "s3://bucket/insights-output/job-id/patient-id/summary.json"
# =============================================================================
DEMO_CACHE = {
    # Patient A
    "46383dd73c1d282831d3e7c9101d4901497c32345d4e2fcc657c2eaf9d03830d": os.environ.get("DEMO_CACHE_PATIENT_A", ""),
    # Patient B
    "698345153023e19306b525ad8a6c7eca0cfc22dfff2a21b51945d5175d6d18f2": os.environ.get("DEMO_CACHE_PATIENT_B", ""),
    # Patient C
    "0725e4075c0a604253ba23c24746cc8dea085e10cc6e9a51c309619a1d65137a": os.environ.get("DEMO_CACHE_PATIENT_C", ""),
}
# Remove empty entries
DEMO_CACHE = {k: v for k, v in DEMO_CACHE.items() if v}

# =============================================================================
# Server
# =============================================================================
SERVER_HOST = os.environ.get("SERVER_HOST", "127.0.0.1")
SERVER_PORT = int(os.environ.get("SERVER_PORT", "5000"))
DEBUG = os.environ.get("DEBUG", "false").lower() == "true"

# CORS - Allow frontend to call backend
# Add your CloudFront distribution URLs here after deployment.
CORS_ORIGINS = [
    "http://localhost:5000",
    "http://localhost:8000",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:8000",
]
_extra_cors = os.environ.get("CORS_ORIGINS", "")
if _extra_cors:
    if _extra_cors.strip() == "*":
        CORS_ORIGINS = "*"
    else:
        CORS_ORIGINS.extend([u.strip() for u in _extra_cors.split(",") if u.strip()])

# =============================================================================
# Default Patient ID (from HealthLake)
# =============================================================================
DEFAULT_PATIENT_ID = os.environ.get("DEFAULT_PATIENT_ID", "")
