# n8n Update Process - Quick Reference

## ⚡ Recommended Fast Workflow (2026-03-25)

**CRITICAL FIRST STEP**: Check existing releases to avoid version conflicts!

**IMPORTANT: Community nodes are preserved incrementally!**
- `npm run update:n8n` rebuilds the base node DB (wipes community nodes temporarily)
- Community nodes must be backed up BEFORE and restored AFTER the base rebuild
- `npm run fetch:community` now upserts by default (preserves READMEs + AI summaries)
- `npm run generate:docs:incremental` only processes nodes missing docs
- Use `generate:docs:readme-only` first, then `generate:docs:summary-only` with a local LLM

```bash
# 1. CHECK EXISTING RELEASES FIRST (prevents version conflicts!)
gh release list | head -5
# Look at the latest version - your new version must be higher!

# 2. Switch to main and pull
git checkout main && git pull

# 3. Check for updates (dry run)
npm run update:n8n:check

# 4. Back up community nodes BEFORE update (update:n8n rebuilds base DB!)
sqlite3 data/nodes.db ".mode insert nodes" "SELECT * FROM nodes WHERE is_community = 1;" > /tmp/n8n_community_backup.sql

# 5. Run update and skip tests (we'll test in CI)
yes y | npm run update:n8n

# 6. Restore community nodes after rebuild
sqlite3 data/nodes.db < /tmp/n8n_community_backup.sql

# 7. Refresh community nodes (upserts - preserves existing READMEs + AI summaries!)
npm run fetch:community
# NOTE: Default mode is now "upsert" - no deletion. Use --rebuild for clean slate.

# 8. Generate docs incrementally (only for new/missing nodes)
npm run generate:docs:readme-only              # Fetch READMEs from npm (no LLM needed)
# Then with a local LLM server running (LM Studio, vLLM, Ollama):
N8N_MCP_LLM_BASE_URL="http://YOUR_SERVER:PORT/v1" \
N8N_MCP_LLM_MODEL="your-model-name" \
node dist/scripts/generate-community-docs.js --summary-only --skip-existing-summary --llm-concurrency=11
# For vLLM with thinking models, the code auto-sends chat_template_kwargs: {enable_thinking: false}
# Context length needed: 8K minimum (README truncated to 6000 chars, output max 2000 tokens)

# 9. Create feature branch
git checkout -b update/n8n-X.X.X

# 7. Update version in package.json (must be HIGHER than latest release!)
# Edit: "version": "2.XX.X" (not the version from the release list!)

# 8. Update CHANGELOG.md
# - Change version number to match package.json
# - Update date to today
# - Update dependency versions
# - Include community node refresh counts

# 9. Update README badge and node counts
# Edit line 8: Change n8n version badge to new n8n version
# Update total node count in description (core + community)

# 10. Commit and push
git add -A
git commit -m "chore: update n8n to X.X.X and bump version to 2.XX.X

- Updated n8n from X.X.X to X.X.X
- Updated n8n-core from X.X.X to X.X.X
- Updated n8n-workflow from X.X.X to X.X.X
- Updated @n8n/n8n-nodes-langchain from X.X.X to X.X.X
- Rebuilt node database with XXX nodes (XXX from n8n-nodes-base, XXX from @n8n/n8n-nodes-langchain)
- Refreshed community nodes (XXX verified + XXX npm)
- Updated README badge with new n8n version and node counts
- Updated CHANGELOG with dependency changes

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

git push -u origin update/n8n-X.X.X

# 11. Create PR
gh pr create --title "chore: update n8n to X.X.X" --body "Updates n8n and all related dependencies to the latest versions..."

# 12. After PR is merged, verify release triggered
gh release list | head -1
# If the new version appears, you're done!
# If not, the version might have already been released - bump version again and create new PR
```

### Why This Workflow?

✅ **Fast**: Skip local tests (2-3 min saved) - CI runs them anyway
✅ **Safe**: Unit tests in CI verify compatibility
✅ **Clean**: All changes in one PR with proper tracking
✅ **Automatic**: Release workflow triggers on merge if version is new

### Common Issues

**Problem**: Release workflow doesn't trigger after merge
**Cause**: Version number was already released (check `gh release list`)
**Solution**: Create new PR bumping version by one patch number

**Problem**: Integration tests fail in CI with "unauthorized"
**Cause**: n8n test instance credentials expired (infrastructure issue)
**Solution**: Ignore if unit tests pass - this is not a code problem

**Problem**: CI takes 8+ minutes
**Reason**: Integration tests need live n8n instance (slow)
**Normal**: Unit tests (~2 min) + integration tests (~6 min) = ~8 min total

## Quick One-Command Update

For a complete update with tests and publish preparation:

```bash
npm run update:all
```

This single command will:
1. ✅ Check for n8n updates and ask for confirmation
2. ✅ Update all n8n dependencies to latest compatible versions
3. ✅ Run all 1,182 tests (933 unit + 249 integration)
4. ✅ Validate critical nodes
5. ✅ Build the project
6. ✅ Bump the version
7. ✅ Update README badges
8. ✅ Prepare everything for npm publish
9. ✅ Create a comprehensive commit

## Manual Steps (if needed)

### Quick Steps to Update n8n

```bash
# 1. Update n8n dependencies automatically
npm run update:n8n

# 2. Run tests
npm test

# 3. Validate the update
npm run validate

# 4. Build
npm run build

# 5. Bump version
npm version patch

# 6. Update README badges manually
# - Update version badge
# - Update n8n version badge

# 7. Commit and push
git add -A
git commit -m "chore: update n8n to vX.X.X

- Updated n8n from X.X.X to X.X.X
- Updated n8n-core from X.X.X to X.X.X
- Updated n8n-workflow from X.X.X to X.X.X
- Updated @n8n/n8n-nodes-langchain from X.X.X to X.X.X
- Rebuilt node database with XXX nodes
- Sanitized XXX workflow templates (if present)
- All 1,182 tests passing (933 unit, 249 integration)
- All validation tests passing

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

## What the Commands Do

### `npm run update:all`
This comprehensive command:
1. Checks current branch and git status
2. Shows current versions and checks for updates
3. Updates all n8n dependencies to compatible versions
4. **Runs the complete test suite** (NEW!)
5. Validates critical nodes
6. Builds the project
7. Bumps the patch version
8. Updates version badges in README
9. Creates a detailed commit with all changes
10. Provides next steps for GitHub release and npm publish

### `npm run update:n8n`
This command:
1. Checks for the latest n8n version
2. Updates n8n and all its required dependencies (n8n-core, n8n-workflow, @n8n/n8n-nodes-langchain)
3. Runs `npm install` to update package-lock.json
4. Automatically rebuilds the node database
5. Sanitizes any workflow templates to remove API tokens
6. Shows you exactly what versions were updated

### `npm run validate`
- Validates critical nodes (httpRequest, code, slack, agent)
- Shows database statistics
- Confirms everything is working correctly

### `npm test`
- Runs all 1,182 tests
- Unit tests: 933 tests across 30 files
- Integration tests: 249 tests across 14 files
- Must pass before publishing!

## Important Notes

1. **ALWAYS check existing releases first** - Use `gh release list` to see what versions are already released. Your new version must be higher!
2. **Release workflow only triggers on version CHANGE** - If you merge a PR with an already-released version (e.g., 2.22.8), the workflow won't run. You'll need to bump to a new version (e.g., 2.22.9) and create another PR.
3. **Integration test failures in CI are usually infrastructure issues** - If unit tests pass but integration tests fail with "unauthorized", this is typically because the test n8n instance credentials need updating. The code itself is fine.
4. **Skip local tests - let CI handle them** - Running tests locally adds 2-3 minutes with no benefit since CI runs them anyway. The fast workflow skips local tests.
5. **The update script is smart** - It automatically syncs all n8n dependencies to compatible versions
6. **Database rebuild is automatic** - The update script handles this for you
7. **Template sanitization is automatic** - Any API tokens in workflow templates are replaced with placeholders
8. **Docker image builds automatically** - Pushing to GitHub triggers the workflow

## GitHub Push Protection

As of July 2025, GitHub's push protection may block database pushes if they contain API tokens in workflow templates. Our rebuild process now automatically sanitizes these tokens, but if you encounter push protection errors:

1. Make sure you've run the latest rebuild with `npm run rebuild`
2. Verify sanitization with `npm run sanitize:templates`
3. If push is still blocked, use the GitHub web interface to review and allow the push

## Time Estimate

### Fast Workflow (Recommended)
- Local work: ~2-3 minutes
  - npm install and database rebuild: ~2-3 minutes
  - File edits (CHANGELOG, README, package.json): ~30 seconds
  - Git operations (commit, push, create PR): ~30 seconds
- CI testing after PR creation: ~8-10 minutes (runs automatically)
  - Unit tests: ~2 minutes
  - Integration tests: ~6 minutes (may fail with infrastructure issues - ignore if unit tests pass)
  - Other checks: ~1 minute

**Total hands-on time: ~3 minutes** (then wait for CI)

### Full Workflow with Local Tests
- Total time: ~5-7 minutes
- Test suite: ~2.5 minutes
- npm install and database rebuild: ~2-3 minutes
- The rest: seconds

**Note**: The fast workflow is recommended since CI runs the same tests anyway.

## Troubleshooting

If tests fail:
1. Check the test output for specific failures
2. Run `npm run test:unit` or `npm run test:integration` separately
3. Fix any issues before proceeding with the update

If validation fails:
1. Check the error message - usually it's a node type reference issue
2. The update script handles most compatibility issues automatically
3. If needed, check the GitHub Actions logs for the dependency update workflow

## Alternative: Check First
To see what would be updated without making changes:
```bash
npm run update:n8n:check
```

This shows you the available updates without modifying anything.

## Publishing to npm

After updating:
```bash
# Prepare for publish (runs tests automatically)
npm run prepare:publish

# Follow the instructions to publish with OTP
cd npm-publish-temp
npm publish --otp=YOUR_OTP_CODE
```

## Creating a GitHub Release

After pushing:
```bash
gh release create vX.X.X --title "vX.X.X" --notes "Updated n8n to vX.X.X"
```