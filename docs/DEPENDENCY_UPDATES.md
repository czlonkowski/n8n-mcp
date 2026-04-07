# n8n Dependency Updates Guide

This guide explains how n8n-MCP keeps its n8n dependencies up to date with the weekly n8n release cycle.

## 🔄 Overview

n8n releases new versions weekly, typically on Wednesdays. To ensure n8n-MCP stays compatible and includes the latest nodes, we've implemented automated dependency update systems.

## 🚀 Update Methods

### 1. Manual Update Script

Run the update script locally:

```bash
# Check for updates (dry run)
npm run update:n8n:check

# Apply updates
npm run update:n8n

# Apply updates without tests (faster, but less safe)
node scripts/update-n8n-deps.js --skip-tests
```

The script will:
1. Check npm for latest versions of n8n packages
2. Update package.json
3. Run `npm install` to update lock file
4. Rebuild the node database
5. Run validation tests
6. Generate an update summary

### 2. GitHub Actions (Automated)

A GitHub Action runs every Monday at 9 AM UTC to:
1. Check for n8n updates
2. Apply updates if available
3. Create a PR with the changes
4. Run all tests in the PR

You can also trigger it manually:
1. Go to Actions → "Update n8n Dependencies"
2. Click "Run workflow"
3. Choose options:
   - **Create PR**: Creates a pull request for review
   - **Auto-merge**: Automatically merges if tests pass

### 3. Renovate Bot (Alternative)

If you prefer Renovate over the custom solution:
1. Enable Renovate on your repository
2. The included `renovate.json` will:
   - Check for n8n updates weekly
   - Group all n8n packages together
   - Create PRs with update details
   - Include links to release notes

## 📦 Tracked Dependencies

The update system tracks these n8n packages:
- `n8n-nodes-base` - Core n8n nodes (loaded by the node-loader at rebuild time)
- `n8n-core` - Runtime helpers that `n8n-nodes-base` internally `require()`s
  (declared only as a devDependency in `n8n-nodes-base`, so we install it
  ourselves)
- `n8n-workflow` - Workflow types and utilities (type-only imports in our code)
- `@n8n/n8n-nodes-langchain` - AI/LangChain nodes

> **Note:** We intentionally do not depend on the `n8n` meta package. The MCP
> server reads node metadata from a prebuilt SQLite database and never executes
> n8n nodes, so pulling in the full n8n runtime (editor backend, task runner,
> queue, typeorm, AI workflow builder, etc.) would bloat the dev dependency
> tree without any runtime benefit.

## 🔍 What Happens During Updates

1. **Version Check**: Compares current vs latest npm versions
2. **Package Update**: Updates package.json with new versions
3. **Dependency Install**: Runs npm install to update lock file
4. **Database Rebuild**: Rebuilds the SQLite database with new node definitions
5. **Validation**: Runs tests to ensure:
   - All nodes load correctly
   - Properties are extracted
   - Critical nodes work
   - Database is valid

## ⚠️ Important Considerations

### Breaking Changes

Always review n8n release notes for breaking changes:
- Check [n8n Release Notes](https://docs.n8n.io/release-notes/)
- Look for changes in node definitions
- Test critical functionality after updates

### Database Compatibility

When n8n adds new nodes or changes existing ones:
- The database rebuild process will capture changes
- New properties/operations will be extracted
- Documentation mappings may need updates

### Failed Updates

If an update fails:

1. **Check the logs** for specific errors
2. **Review release notes** for breaking changes
3. **Run validation manually**:
   ```bash
   npm run build
   npm run rebuild
   npm run validate
   ```
4. **Fix any issues** before merging

## 🛠️ Customization

### Modify Update Schedule

Edit `.github/workflows/update-n8n-deps.yml`:
```yaml
schedule:
  # Run every Wednesday at 10 AM UTC (after n8n typically releases)
  - cron: '0 10 * * 3'
```

### Add More Packages

Edit `scripts/update-n8n-deps.js`:
```javascript
const trackedDeps = [
  'n8n-nodes-base',
  'n8n-workflow',
  '@n8n/n8n-nodes-langchain',
  // Add more packages here
];
```

### Customize PR Creation

Modify the GitHub Action to:
- Add more reviewers
- Change labels
- Update PR template
- Add additional checks

## 📊 Monitoring Updates

### Check Update Status

```bash
# See current versions
npm ls n8n-nodes-base n8n-workflow @n8n/n8n-nodes-langchain

# Check latest available
npm view n8n-nodes-base version
npm view n8n-workflow version
npm view @n8n/n8n-nodes-langchain version
```

### View Update History

- Check GitHub Actions history
- Review merged PRs with "dependencies" label
- Look at git log for "chore: update n8n dependencies" commits

## 🚨 Troubleshooting

### Update Script Fails

```bash
# Run with more logging
LOG_LEVEL=debug node scripts/update-n8n-deps.js

# Skip tests to isolate issues
node scripts/update-n8n-deps.js --skip-tests

# Manually test each step
npm run build
npm run rebuild
npm run validate
```

### GitHub Action Fails

1. Check Action logs in GitHub
2. Run the update locally to reproduce
3. Fix issues and push manually
4. Re-run the Action

### Database Issues After Update

```bash
# Force rebuild
rm -f data/nodes.db
npm run rebuild

# Check specific nodes
npm run test-nodes

# Validate database
npm run validate
```

## 🔐 Security

- Updates are tested before merging
- PRs require review (unless auto-merge is enabled)
- All changes are tracked in git
- Rollback is possible via git revert

## 🎯 Best Practices

1. **Review PRs carefully** - Check for breaking changes
2. **Test after updates** - Ensure core functionality works
3. **Monitor n8n releases** - Stay informed about major changes
4. **Update regularly** - Weekly updates are easier than monthly
5. **Document issues** - Help future updates by documenting problems

## 📝 Manual Update Checklist

If updating manually:

- [ ] Check n8n release notes
- [ ] Run `npm run update:n8n:check`
- [ ] Review proposed changes
- [ ] Run `npm run update:n8n`
- [ ] Test core functionality
- [ ] Commit and push changes
- [ ] Create PR with update details
- [ ] Run full test suite
- [ ] Merge after review