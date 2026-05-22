# Automated Release Process

This document describes the automated release system for n8n-mcp, which handles version detection, changelog parsing, and multi-artifact publishing.

## Overview

The automated release system is triggered when the version in `package.json` is updated and pushed to the main branch. It handles:

- 🏷️ **GitHub Releases**: Creates releases with changelog content
- 📦 **NPM Publishing**: Publishes optimized runtime package
- 🐳 **Docker Images**: Builds and pushes multi-platform images
- 📚 **Documentation**: Updates version badges automatically

## Quick Start

### For Maintainers

Use the prepared release script for a guided experience:

```bash
npm run prepare:release
```

This script will:
1. Prompt for the new version
2. Update `package.json` and `package.runtime.json`
3. Update the changelog
4. Run tests and build
5. Create a git commit
6. Optionally push to trigger the release

### Manual Process

1. **Update the version**:
   ```bash
   # Edit package.json version field
   vim package.json
   
   # Sync to runtime package
   npm run sync:runtime-version
   ```

2. **Update the changelog**:
   ```bash
   # Edit docs/CHANGELOG.md
   vim docs/CHANGELOG.md
   ```

3. **Test and commit**:
   ```bash
   # Ensure everything works
   npm test
   npm run build
   npm run rebuild
   
   # Commit changes
   git add package.json package.runtime.json docs/CHANGELOG.md
   git commit -m "chore: release vX.Y.Z"
   git push
   ```

## Workflow Details

### Version Detection

The workflow monitors pushes to the main branch and detects when `package.json` version changes:

```yaml
paths:
  - 'package.json'
  - 'package.runtime.json'
```

### Changelog Parsing

Automatically extracts release notes from `docs/CHANGELOG.md` using the version header format:

```markdown
## [2.10.0] - 2025-08-02

### Added
- New feature descriptions

### Changed
- Changed feature descriptions

### Fixed
- Bug fix descriptions
```

### Release Artifacts

#### GitHub Release
- Created with extracted changelog content
- Tagged with `vX.Y.Z` format
- Includes installation instructions
- Links to documentation

#### NPM Package
- Published as `n8n-mcp` on npmjs.com
- Uses runtime-only dependencies (8 packages vs 50+ dev deps)
- Optimized for `npx` usage
- ~50MB vs 1GB+ with dev dependencies

#### Docker Images
- **Standard**: `ghcr.io/czlonkowski/n8n-mcp:vX.Y.Z`
- **Railway**: `ghcr.io/czlonkowski/n8n-mcp-railway:vX.Y.Z`
- Multi-platform: linux/amd64, linux/arm64
- Semantic version tags: `vX.Y.Z`, `vX.Y`, `vX`, `latest`

## Configuration

### Required Secrets

Set these in GitHub repository settings → Secrets:

| Secret | Description | Required |
|--------|-------------|----------|
| `DOCKERHUB_USERNAME` | Docker Hub username for image pushes | ✅ Yes |
| `DOCKERHUB_TOKEN` | Docker Hub access token | ✅ Yes |
| `GITHUB_TOKEN` | Automatically provided by GitHub Actions | ✅ Auto |

NPM publishing uses [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers) (OIDC) — no `NPM_TOKEN` secret is required.

### NPM Trusted Publisher Setup

The `publish-npm` job authenticates to npm via short-lived OIDC tokens minted by GitHub Actions. This is configured once on the npm side:

1. Login to [npmjs.com](https://www.npmjs.com) as a maintainer of `n8n-mcp`.
2. Go to the package page → **Settings** → **Trusted Publishers** → **Add publisher**.
3. Configure:
   - **Publisher**: GitHub Actions
   - **Organization or user**: `czlonkowski`
   - **Repository**: `n8n-mcp`
   - **Workflow filename**: `release.yml`
   - **Environment**: `npm-publish`
4. Save.

The matching GitHub environment must exist (Settings → Environments → `npm-publish`). No protection rules are required, though a required reviewer can be added for an approval gate before each release.

The workflow declares `id-token: write` and `environment: npm-publish` on the `publish-npm` job; `npm publish` detects the OIDC runtime and authenticates automatically. Provenance attestations are published with every release.

## Testing

### Test Release Automation

Validate the release system without triggering a release:

```bash
npm run test:release-automation
```

This checks:
- ✅ File existence and structure
- ✅ Version detection logic
- ✅ Changelog parsing
- ✅ Build process
- ✅ NPM package preparation
- ✅ Docker configuration
- ✅ Workflow syntax
- ✅ Environment setup

### Local Testing

Test individual components:

```bash
# Test version detection
node -e "console.log(require('./package.json').version)"

# Test changelog parsing
node scripts/test-release-automation.js

# Test npm package preparation
npm run prepare:publish

# Test Docker build
docker build -t test-image .
```

## Workflow Jobs

### 1. Version Detection
- Compares current vs previous version in git history
- Determines if it's a prerelease (alpha, beta, rc, dev)
- Outputs version information for other jobs

### 2. Changelog Extraction
- Parses `docs/CHANGELOG.md` for the current version
- Extracts content between version headers
- Provides formatted release notes

### 3. GitHub Release Creation
- Creates annotated git tag
- Creates GitHub release with changelog content
- Handles prerelease flag for alpha/beta versions

### 4. Build and Test
- Installs dependencies
- Runs full test suite
- Builds TypeScript
- Rebuilds node database
- Type checking

### 5. NPM Publishing
- Prepares optimized package structure
- Uses `package.runtime.json` for dependencies
- Publishes to npmjs.com registry
- Automatic cleanup

### 6. Docker Building
- Multi-platform builds (amd64, arm64)
- Two image variants (standard, railway)
- Semantic versioning tags
- GitHub Container Registry

### 7. Documentation Updates
- Updates version badges in README
- Commits documentation changes
- Automatic push back to repository

## Monitoring

### GitHub Actions
Monitor releases at: https://github.com/czlonkowski/n8n-mcp/actions

### Release Status
- **GitHub Releases**: https://github.com/czlonkowski/n8n-mcp/releases
- **NPM Package**: https://www.npmjs.com/package/n8n-mcp
- **Docker Images**: https://github.com/czlonkowski/n8n-mcp/pkgs/container/n8n-mcp

### Notifications

The workflow provides comprehensive summaries:
- ✅ Success notifications with links
- ❌ Failure notifications with error details
- 📊 Artifact information and installation commands

## Troubleshooting

### Common Issues

#### NPM Publishing Fails
```
Error: 401 Unauthorized
```
or
```
npm error code ENEEDAUTH
npm error need auth This command requires you to be logged in
```
**Solution**: Verify the Trusted Publisher configuration on npmjs.com matches the workflow:
- Repository: `czlonkowski/n8n-mcp`
- Workflow filename: `release.yml` (filename only, no path)
- Environment: `npm-publish`

Also confirm the `publish-npm` job in the workflow still has `permissions: id-token: write` and `environment: npm-publish`. Runner npm must be ≥ 11.5.1 — the `Upgrade npm` step handles this.

#### Docker Build Fails
```
Error: failed to solve: could not read from registry
```
**Solution**: Check GitHub Container Registry permissions and GITHUB_TOKEN.

#### Changelog Parsing Fails
```
No changelog entries found for version X.Y.Z
```
**Solution**: Ensure changelog follows the correct format:
```markdown
## [X.Y.Z] - YYYY-MM-DD
```

#### Version Detection Fails
```
Version not incremented
```
**Solution**: Ensure new version is greater than the previous version.

### Recovery Steps

#### Failed NPM Publish
1. Check if version was already published
2. If not, manually publish:
   ```bash
   npm run prepare:publish
   cd npm-publish-temp
   npm publish
   ```

#### Failed Docker Build
1. Build locally to test:
   ```bash
   docker build -t test-build .
   ```
2. Re-trigger workflow or push a fix

#### Incomplete Release
1. Delete the created tag if needed:
   ```bash
   git tag -d vX.Y.Z
   git push --delete origin vX.Y.Z
   ```
2. Fix issues and push again

## Security

### Secrets Management
- NPM auth uses Trusted Publishers (OIDC) — no long-lived npm token stored in the repo
- Each release mints a short-lived token scoped to the workflow run
- Provenance attestations are signed and published with every release, linking the package back to the exact commit + workflow run
- GITHUB_TOKEN has automatic scoping
- No secrets are logged or exposed

### Package Security
- Runtime package excludes development dependencies
- No build tools or test frameworks in published package
- Minimal attack surface (~50MB vs 1GB+)

### Docker Security
- Multi-stage builds
- Non-root user execution
- Minimal base images
- Security scanning enabled

## Changelog Format

The automated system expects changelog entries in [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- New features for next release

## [2.10.0] - 2025-08-02

### Added
- Automated release system
- Multi-platform Docker builds

### Changed
- Improved version detection
- Enhanced error handling

### Fixed
- Fixed changelog parsing edge cases
- Fixed Docker build optimization

## [2.9.1] - 2025-08-01

...
```

## Version Strategy

### Semantic Versioning
- **MAJOR** (X.0.0): Breaking changes
- **MINOR** (X.Y.0): New features, backward compatible
- **PATCH** (X.Y.Z): Bug fixes, backward compatible

### Prerelease Versions
- **Alpha**: `X.Y.Z-alpha.N` - Early development
- **Beta**: `X.Y.Z-beta.N` - Feature complete, testing
- **RC**: `X.Y.Z-rc.N` - Release candidate

Prerelease versions are automatically detected and marked appropriately.

## Best Practices

### Before Releasing
1. ✅ Run `npm run test:release-automation`
2. ✅ Update changelog with meaningful descriptions
3. ✅ Test locally with `npm test && npm run build`
4. ✅ Review breaking changes
5. ✅ Consider impact on users

### Version Bumping
- Use `npm run prepare:release` for guided process
- Follow semantic versioning strictly
- Document breaking changes clearly
- Consider backward compatibility

### Changelog Writing
- Be specific about changes
- Include migration notes for breaking changes
- Credit contributors
- Use consistent formatting

## Contributing

### For Maintainers
1. Use automated tools: `npm run prepare:release`
2. Follow semantic versioning
3. Update changelog thoroughly
4. Test before releasing

### For Contributors
- Breaking changes require MAJOR version bump
- New features require MINOR version bump
- Bug fixes require PATCH version bump
- Update changelog in PR descriptions

---

🤖 *This automated release system was designed with [Claude Code](https://claude.ai/code)*