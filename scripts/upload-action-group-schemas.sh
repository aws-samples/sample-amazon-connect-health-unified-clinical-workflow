#!/usr/bin/env bash
# Upload all 6 action group OpenAPI schemas to the S3 bucket created by the
# care-manager CloudFormation stack.
#
# Usage:
#   bash scripts/upload-action-group-schemas.sh dev

set -euo pipefail

ENVIRONMENT="${1:-dev}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMA_DIR="$REPO_ROOT/care-manager-workflow/bedrock-agent/action-groups"
STACK_NAME="${STACK_NAME:-unified-cw-care-manager}"

BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='SchemaBucketName'].OutputValue" \
    --output text)

if [ -z "$BUCKET" ] || [ "$BUCKET" = "None" ]; then
    echo "ERROR: Could not resolve schema bucket from stack $STACK_NAME"
    exit 1
fi

echo "Uploading schemas to s3://$BUCKET/action-groups/"
echo ""

for schema in "$SCHEMA_DIR"/*.yaml; do
    fname=$(basename "$schema")
    aws s3 cp "$schema" "s3://$BUCKET/action-groups/$fname" \
        --no-cli-pager \
        --only-show-errors
    echo "  ✓ $fname"
done

echo ""
echo "Schemas uploaded. To make the agent re-read them (schema cache gotcha):"
echo ""
echo "  AGENT_ID=\$(aws cloudformation describe-stacks \\"
echo "      --stack-name $STACK_NAME \\"
echo "      --query 'Stacks[0].Outputs[?OutputKey==\`AgentId\`].OutputValue' \\"
echo "      --output text)"
echo "  # For each action group, run aws bedrock-agent update-agent-action-group ..."
echo "  aws bedrock-agent prepare-agent --agent-id \$AGENT_ID"
