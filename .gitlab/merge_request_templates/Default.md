## Summary

<!-- What does this MR change? Keep it to 1-3 sentences. -->

## Type of Change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Documentation update
- [ ] Sample data update
- [ ] CI/security tooling update

## Security Checklist

- [ ] No real AWS account IDs introduced
- [ ] No PHI / PII added to sample data (Synthea-generated only)
- [ ] No new `print()` / `console.log()` calls that log clinical content
- [ ] If new Bedrock invocations: `guardrailIdentifier` is conditionally attached
- [ ] If new IAM policies: `Resource` is scoped to specific ARNs, not `*`
- [ ] If new HTML output: dynamic data uses `escapeHtml()` or `textContent`
- [ ] Pre-commit hook (`scripts/pre-commit-security-check.sh`) passes locally

## Testing

<!-- How did you verify these changes? -->

## Related Issues / Blog Posts

<!-- Link to relevant blog posts, issues, or design docs. -->
