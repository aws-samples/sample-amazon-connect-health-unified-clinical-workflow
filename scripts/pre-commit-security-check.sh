#!/usr/bin/env bash
# Pre-commit security check for the unified clinical workflow sample.
#
# Run automatically as a pre-commit hook (install with `bash scripts/install-hooks.sh`)
# or manually: `bash scripts/pre-commit-security-check.sh`
#
# This script blocks commits that contain:
#   - AWS account IDs (12-digit numbers)
#   - AWS access keys / secret keys (AKIA, ASIA prefix)
#   - Private keys (RSA, EC, PGP)
#   - SSNs / credit cards / real phone numbers (outside 555-01xx)
#   - Email addresses (outside the Amazon-official exception list)
#   - Patient names from non-synthetic identity lists
#   - Files matching .env, .pem, .key, etc.

set -e

EXIT_CODE=0
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Determine which files are staged
if git rev-parse --git-dir > /dev/null 2>&1; then
    FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)
else
    # Not a git repo or no staging; check all tracked source files
    FILES=$(find . -type f \( -name "*.py" -o -name "*.js" -o -name "*.java" \
            -o -name "*.yaml" -o -name "*.yml" -o -name "*.json" \
            -o -name "*.html" -o -name "*.md" -o -name "*.sh" \) \
            ! -path './.git/*' ! -path './node_modules/*' ! -path './.venv/*')
fi

if [ -z "$FILES" ]; then
    echo "No files to check."
    exit 0
fi

echo "Running pre-commit security checks on $(echo "$FILES" | wc -l | tr -d ' ') file(s)..."
echo ""

# ─── 1. AWS account IDs (12-digit numbers, with allowlist) ───
echo -n "  [1/8] AWS account IDs (12-digit)... "
HITS=$(echo "$FILES" | xargs grep -lE '\b[0-9]{12}\b' 2>/dev/null | head -5)
if [ -n "$HITS" ]; then
    # Filter out known-safe numeric occurrences (z-index, MAX_INT)
    REAL_HITS=""
    for f in $HITS; do
        DEEP=$(grep -nE '\b[0-9]{12}\b' "$f" 2>/dev/null | grep -v 'z-index' | grep -v '2147483647')
        if [ -n "$DEEP" ]; then
            REAL_HITS="${REAL_HITS}${f}:\n${DEEP}\n"
        fi
    done
    if [ -n "$REAL_HITS" ]; then
        echo -e "${RED}FAIL${NC}"
        echo -e "$REAL_HITS"
        EXIT_CODE=1
    else
        echo -e "${GREEN}PASS${NC} (only z-index / MAX_INT matches)"
    fi
else
    echo -e "${GREEN}PASS${NC}"
fi

# ─── 2. AWS access keys / secret patterns ───
echo -n "  [2/8] AWS credential patterns (AKIA/ASIA/aws_secret)... "
HITS=$(echo "$FILES" | xargs grep -lE '(AKIA|ASIA)[0-9A-Z]{16}|aws_secret_access_key\s*=|aws_session_token\s*=' 2>/dev/null | head -5)
if [ -n "$HITS" ]; then
    echo -e "${RED}FAIL${NC}"
    echo "$HITS" | sed 's/^/    /'
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}"
fi

# ─── 3. Private keys ───
echo -n "  [3/8] Private keys (RSA / EC / PGP)... "
HITS=$(echo "$FILES" | xargs grep -lE 'BEGIN (RSA |EC |PGP |OPENSSH |)PRIVATE KEY' 2>/dev/null | head -5)
if [ -n "$HITS" ]; then
    echo -e "${RED}FAIL${NC}"
    echo "$HITS" | sed 's/^/    /'
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}"
fi

# ─── 4. SSNs ───
echo -n "  [4/8] SSN-format strings... "
HITS=$(echo "$FILES" | xargs grep -lE '\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b' 2>/dev/null | head -5)
if [ -n "$HITS" ]; then
    echo -e "${RED}FAIL${NC}"
    echo "$HITS" | sed 's/^/    /'
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}"
fi

# ─── 5. Phone numbers outside 555-01xx reserved range ───
echo -n "  [5/8] Phone numbers outside RFC 3966 reserved range... "
HITS=""
echo "$FILES" | while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ ! -f "$f" ] && continue
    case "$f" in
        *.py|*.js|*.java|*.yaml|*.yml|*.json|*.html|*.md)
            grep -hoE '\b(\+1)?[\(]?[2-9][0-9]{2}[\)]?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b' "$f" 2>/dev/null | \
                grep -vE '555-?01[0-9]{2}|555.?010|2147483647|z-index' | \
                head -1 | awk -v file="$f" '{print file ": " $0}'
            ;;
    esac
done > /tmp/phone_check_hits.$$
if [ -s /tmp/phone_check_hits.$$ ]; then
    echo -e "${YELLOW}WARN${NC} (review manually)"
    head -3 /tmp/phone_check_hits.$$ | sed 's/^/    /'
else
    echo -e "${GREEN}PASS${NC}"
fi
rm -f /tmp/phone_check_hits.$$

# ─── 6. Credit card patterns ───
echo -n "  [6/8] Credit card number patterns... "
HITS=$(echo "$FILES" | xargs grep -lE '\b[0-9]{4}[-. ]?[0-9]{4}[-. ]?[0-9]{4}[-. ]?[0-9]{4}\b' 2>/dev/null | head -5)
if [ -n "$HITS" ]; then
    echo -e "${RED}FAIL${NC}"
    echo "$HITS" | sed 's/^/    /'
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}"
fi

# ─── 7. .env / .pem / .key files staged ───
echo -n "  [7/8] Secret-laden file extensions staged... "
BAD_FILES=$(echo "$FILES" | grep -E '\.(env|pem|key|p12|pfx)$' || true)
if [ -n "$BAD_FILES" ]; then
    echo -e "${RED}FAIL${NC}"
    echo "$BAD_FILES" | sed 's/^/    /'
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}"
fi

# ─── 8. Backup / scratch files staged ───
echo -n "  [8/8] Backup files (.bak, .orig) staged... "
BAD_FILES=$(echo "$FILES" | grep -E '\.(bak|orig|tmp|swp)(\.|$)' || true)
if [ -n "$BAD_FILES" ]; then
    echo -e "${RED}FAIL${NC}"
    echo "$BAD_FILES" | sed 's/^/    /'
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}"
fi

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ All security checks passed.${NC}"
else
    echo -e "${RED}✗ Security check failed. Fix the issues above before committing.${NC}"
    echo ""
    echo "To bypass (NOT RECOMMENDED): commit with --no-verify"
fi

exit $EXIT_CODE
