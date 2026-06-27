// Care Intelligence Workspace — Configuration
//
// These values are wired at deployment time. The recommended pattern is
// to have the CloudFront deployment substitute placeholders in this file
// with stack outputs from the care-manager Bedrock Agent stack.
//
// For local development, set them by hand to your dev environment's
// stack outputs.
//
// SECURITY: AGENT_ID and AGENT_ALIAS_ID alone are not secrets — they're
// resource identifiers. The backend's IAM role is what authorizes
// invocation. Still, treat them as deployment-specific config rather
// than hardcoded values.
window.CARE_INTELLIGENCE_CONFIG = {
    // From: aws cloudformation describe-stacks
    //   --query "Stacks[0].Outputs[?OutputKey=='AgentId'].OutputValue"
    AGENT_ID: "REPLACE_WITH_AGENT_ID",

    // From: aws cloudformation describe-stacks
    //   --query "Stacks[0].Outputs[?OutputKey=='AgentAliasId'].OutputValue"
    AGENT_ALIAS_ID: "REPLACE_WITH_AGENT_ALIAS_ID",

    REGION: "us-east-1",

    // The ALB DNS name from the care-manager backend stack. The frontend
    // will POST to ${BACKEND_URL}/api/bedrock-agent/invoke.
    //
    // Local dev:   BACKEND_URL = http://localhost:5001
    // Deployed:    BACKEND_URL = http://<alb-dns-name>
    //              (production: https://<your-cloudfront-or-acm-cert-domain>)
    BACKEND_URL: window.BACKEND_URL || ""
};
