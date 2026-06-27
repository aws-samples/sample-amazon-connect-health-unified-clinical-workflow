#!/usr/bin/env bash
# Package and deploy all 6 care-manager action group Lambdas.
#
# Prerequisites:
#   - The care-manager CloudFormation stack must already be deployed
#     (so the Lambda functions exist as placeholders to update)
#   - AWS CLI configured with credentials for the target account
#   - Python 3.11+ available (matches the Lambda runtime)
#
# Usage:
#   bash scripts/deploy-action-group-lambdas.sh dev
#
# The first argument is the Environment suffix (defaults to dev) and must
# match what was used when the CloudFormation stack was deployed.

set -euo pipefail

ENVIRONMENT="${1:-dev}"
LAMBDA_DIR="$(cd "$(dirname "$0")/.." && pwd)/care-manager-workflow/bedrock-agent/lambdas"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

# All 6 Lambdas — function name suffix : handler module
declare -a LAMBDAS=(
    "patient-summary:patient_summary"
    "recent-visit:recent_visit"
    "a1c-trend:a1c_trend"
    "overdue-a1c:overdue_a1c"
    "no-show-patients:no_show_patients"
    "diabetic-risk:diabetic_risk"
)

echo "Packaging shared helper..."
cp "$LAMBDA_DIR/healthlake_client.py" "$BUILD_DIR/"

echo ""
for LAMBDA in "${LAMBDAS[@]}"; do
    FUNC_SUFFIX="${LAMBDA%:*}"
    MODULE="${LAMBDA#*:}"
    FUNC_NAME="care-mgr-${FUNC_SUFFIX}-${ENVIRONMENT}"

    echo "── ${FUNC_NAME} ──"

    # Copy module to build dir alongside healthlake_client.py
    cp "$LAMBDA_DIR/${MODULE}.py" "$BUILD_DIR/"

    # Zip them together
    ZIP_PATH="$BUILD_DIR/${MODULE}.zip"
    (cd "$BUILD_DIR" && zip -q -j "$ZIP_PATH" "${MODULE}.py" "healthlake_client.py")

    # Update Lambda code
    aws lambda update-function-code \
        --function-name "$FUNC_NAME" \
        --zip-file "fileb://$ZIP_PATH" \
        --no-cli-pager \
        --output text \
        --query 'LastModified' \
        && echo "  ✓ Updated $FUNC_NAME"

    # Cleanup before next iteration
    rm -f "$BUILD_DIR/${MODULE}.py"
done

echo ""
echo "All 6 action group Lambdas updated."
echo ""
echo "Next: refresh the Bedrock Agent so it picks up any schema changes:"
echo ""
echo "  AGENT_ID=\$(aws cloudformation describe-stacks \\"
echo "      --stack-name unified-cw-care-manager \\"
echo "      --query 'Stacks[0].Outputs[?OutputKey==\`AgentId\`].OutputValue' \\"
echo "      --output text)"
echo "  aws bedrock-agent prepare-agent --agent-id \$AGENT_ID"
