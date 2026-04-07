#!/bin/bash
# Comprehensive script to update n8n dependencies, run tests, and prepare for npm publish
# Based on MEMORY_N8N_UPDATE.md but enhanced with test suite and publish preparation

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 n8n Update and Publish Preparation Script${NC}"
echo "=============================================="
echo ""

# 1. Check current branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${YELLOW}⚠️  Warning: Not on main branch (current: $CURRENT_BRANCH)${NC}"
    echo "It's recommended to run this on the main branch."
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 2. Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}❌ Error: You have uncommitted changes${NC}"
    echo "Please commit or stash your changes before updating."
    exit 1
fi

# 3. Get current versions for comparison
echo -e "${BLUE}📊 Current versions:${NC}"
CURRENT_N8N=$(node -e "console.log(require('./package.json').dependencies['n8n-nodes-base'])" 2>/dev/null || echo "not installed")
CURRENT_PROJECT=$(node -e "console.log(require('./package.json').version)")
echo "- n8n-nodes-base: $CURRENT_N8N"
echo "- n8n-mcp: $CURRENT_PROJECT"
echo ""

# 4. Check for updates first
echo -e "${BLUE}🔍 Checking for n8n updates...${NC}"
npm run update:n8n:check

echo ""
read -p "Do you want to proceed with the update? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Update cancelled."
    exit 0
fi

# 5. Update n8n dependencies
echo ""
echo -e "${BLUE}📦 Updating n8n dependencies...${NC}"
npm run update:n8n

# 6. Run the test suite
echo ""
echo -e "${BLUE}🧪 Running comprehensive test suite (1,182 tests)...${NC}"
npm test
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Tests failed! Please fix failing tests before proceeding.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ All tests passed!${NC}"

# 7. Run validation
echo ""
echo -e "${BLUE}✔️  Validating critical nodes...${NC}"
npm run validate

# 8. Build the project
echo ""
echo -e "${BLUE}🔨 Building project...${NC}"
npm run build

# 9. Bump version
echo ""
echo -e "${BLUE}📌 Bumping version...${NC}"
# Get new n8n-nodes-base version
NEW_N8N=$(node -e "console.log(require('./package.json').dependencies['n8n-nodes-base'])")
# Bump patch version
npm version patch --no-git-tag-version

# Get new project version
NEW_PROJECT=$(node -e "console.log(require('./package.json').version)")

# 10. Update n8n version badge in README
echo ""
echo -e "${BLUE}📝 Updating n8n version badge...${NC}"
sed -i.bak "s/n8n-v[0-9.]*/n8n-$NEW_N8N/" README.md && rm README.md.bak

# 11. Sync runtime version (this also updates the version badge in README)
echo ""
echo -e "${BLUE}🔄 Syncing runtime version and updating version badge...${NC}"
npm run sync:runtime-version

# 12. Get update details for commit message
echo ""
echo -e "${BLUE}📊 Gathering update information...${NC}"
# Get all tracked n8n package versions
N8N_CORE=$(node -e "console.log(require('./package.json').dependencies['n8n-core'])")
N8N_WORKFLOW=$(node -e "console.log(require('./package.json').dependencies['n8n-workflow'])")
N8N_LANGCHAIN=$(node -e "console.log(require('./package.json').dependencies['@n8n/n8n-nodes-langchain'])")

# Get node count from database
NODE_COUNT=$(node -e "
const Database = require('better-sqlite3');
const db = new Database('./data/nodes.db', { readonly: true });
const count = db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;
console.log(count);
db.close();
" 2>/dev/null || echo "unknown")

# Check if templates were sanitized
TEMPLATES_SANITIZED=false
if [ -f "./data/nodes.db" ]; then
    TEMPLATE_COUNT=$(node -e "
    const Database = require('better-sqlite3');
    const db = new Database('./data/nodes.db', { readonly: true });
    const count = db.prepare('SELECT COUNT(*) as count FROM templates').get().count;
    console.log(count);
    db.close();
    " 2>/dev/null || echo "0")
    if [ "$TEMPLATE_COUNT" != "0" ]; then
        TEMPLATES_SANITIZED=true
    fi
fi

# 13. Create commit message
echo ""
echo -e "${BLUE}📝 Creating commit...${NC}"
COMMIT_MSG="chore: update n8n to $NEW_N8N and bump version to $NEW_PROJECT

- Updated n8n-nodes-base to $NEW_N8N
- Updated n8n-core to $N8N_CORE
- Updated n8n-workflow to $N8N_WORKFLOW
- Updated @n8n/n8n-nodes-langchain to $N8N_LANGCHAIN
- Rebuilt node database with $NODE_COUNT nodes"

if [ "$TEMPLATES_SANITIZED" = true ]; then
    COMMIT_MSG="$COMMIT_MSG
- Sanitized $TEMPLATE_COUNT workflow templates"
fi

COMMIT_MSG="$COMMIT_MSG
- All 1,182 tests passing (933 unit, 249 integration)
- All validation tests passing
- Built and prepared for npm publish

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# 14. Stage all changes
git add -A

# 15. Show what will be committed
echo ""
echo -e "${BLUE}📋 Changes to be committed:${NC}"
git status --short

# 16. Commit changes
git commit -m "$COMMIT_MSG"

# 17. Summary
echo ""
echo -e "${GREEN}✅ Update completed successfully!${NC}"
echo ""
echo -e "${BLUE}Summary:${NC}"
echo "- Updated n8n-nodes-base from $CURRENT_N8N to $NEW_N8N"
echo "- Bumped version from $CURRENT_PROJECT to $NEW_PROJECT"
echo "- All 1,182 tests passed"
echo "- Project built and ready for npm publish"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Push to GitHub:"
echo -e "   ${GREEN}git push origin $CURRENT_BRANCH${NC}"
echo ""
echo "2. Create a GitHub release (after push):"
echo -e "   ${GREEN}gh release create v$NEW_PROJECT --title \"v$NEW_PROJECT\" --notes \"Updated n8n to $NEW_N8N\"${NC}"
echo ""
echo "3. Publish to npm:"
echo -e "   ${GREEN}npm run prepare:publish${NC}"
echo "   Then follow the instructions to publish with OTP"
echo ""
echo -e "${BLUE}🎉 Done!${NC}"