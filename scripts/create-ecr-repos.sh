#!/usr/bin/env bash
# Create the ECR repositories required by the provider-workflow and
# care-manager-workflow ECS Fargate services. Run once per AWS account
# per region before deploying the workflow stacks.
#
# Usage:
#   bash scripts/create-ecr-repos.sh [region]
#
# The created repos:
#   - patient-insights-backend      (provider-workflow backend)
#   - connect-health-bridge         (provider-workflow Java audio bridge)
#   - care-manager-backend          (care-manager-workflow Flask proxy)
#
# Idempotent: re-running is safe; existing repos are reported and skipped.

set -euo pipefail

REGION="${1:-${AWS_REGION:-us-east-1}}"

REPOS=(
    "patient-insights-backend"
    "connect-health-bridge"
    "care-manager-backend"
)

echo "Region: $REGION"
echo ""

for repo in "${REPOS[@]}"; do
    existing=$(aws ecr describe-repositories \
        --repository-names "$repo" \
        --region "$REGION" \
        --query 'repositories[0].repositoryUri' \
        --output text 2>/dev/null || echo "")

    if [ -n "$existing" ] && [ "$existing" != "None" ]; then
        echo "  ✓ $repo (already exists)"
        echo "    URI: $existing"
    else
        new_uri=$(aws ecr create-repository \
            --repository-name "$repo" \
            --region "$REGION" \
            --image-scanning-configuration scanOnPush=true \
            --encryption-configuration encryptionType=AES256 \
            --tags Key=Project,Value=amazon-connect-health-unified-clinical-workflow \
            --query 'repository.repositoryUri' \
            --output text)
        echo "  ✓ $repo (created)"
        echo "    URI: $new_uri"
    fi
done

echo ""
echo "Use these URIs as the ECRRepositoryURI parameter when deploying:"
echo "  - patient-insights-backend → provider-workflow backend stack"
echo "  - connect-health-bridge    → provider-workflow bridge stack"
echo "  - care-manager-backend     → care-manager-workflow backend stack"
