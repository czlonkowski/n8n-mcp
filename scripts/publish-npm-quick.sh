#!/bin/bash
# Quick publish script that skips tests
set -e

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🚀 Preparing n8n-mcp for npm publish (quick mode)..."

# Sync version
echo "🔄 Syncing version to package.runtime.json..."
npm run sync:runtime-version

VERSION=$(node -e "console.log(require('./package.json').version)")
echo -e "${GREEN}📌 Version: $VERSION${NC}"

# Prepare publish directory
PUBLISH_DIR="npm-publish-temp"
rm -rf $PUBLISH_DIR
mkdir -p $PUBLISH_DIR

echo "📦 Copying files..."
cp -r dist $PUBLISH_DIR/
cp -r data $PUBLISH_DIR/
cp README.md LICENSE .env.example $PUBLISH_DIR/
cp .npmignore $PUBLISH_DIR/ 2>/dev/null || true
cp package.runtime.json $PUBLISH_DIR/package.json

cd $PUBLISH_DIR

# Configure package.json
node -e "
const pkg = require('./package.json');
pkg.name = 'n8n-mcp';
pkg.description = 'Integration between n8n workflow automation and Model Context Protocol (MCP)';
pkg.bin = { 'n8n-mcp': './dist/mcp/stdio-wrapper.js' };
pkg.repository = { type: 'git', url: 'git+https://github.com/czlonkowski/n8n-mcp.git' };
pkg.keywords = ['n8n', 'mcp', 'model-context-protocol', 'ai', 'workflow', 'automation'];
pkg.author = 'Romuald Czlonkowski @ www.aiadvisors.pl/en';
pkg.license = 'MIT';
pkg.bugs = { url: 'https://github.com/czlonkowski/n8n-mcp/issues' };
pkg.homepage = 'https://github.com/czlonkowski/n8n-mcp#readme';
pkg.files = ['dist/**/*', 'data/nodes.db', '.env.example', 'README.md', 'LICENSE'];
delete pkg.private;
require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2));
"

echo ""
echo "📋 Package details:"
echo -e "${GREEN}Name:${NC} $(node -e "console.log(require('./package.json').name)")"
echo -e "${GREEN}Version:${NC} $(node -e "console.log(require('./package.json').version)")"
echo -e "${GREEN}Size:${NC} ~50MB"
echo ""
echo "✅ Ready to publish!"
echo ""
echo -e "${YELLOW}⚠️  Note: Tests were skipped in quick mode${NC}"
echo ""
echo "To publish, run:"
echo -e "  ${GREEN}cd $PUBLISH_DIR${NC}"
echo -e "  ${GREEN}npm publish --otp=YOUR_OTP_CODE${NC}"