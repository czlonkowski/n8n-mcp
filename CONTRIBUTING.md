# Contributing

Contributions are welcome! Here's how to get started.

## Getting Started

1. Fork the repository
2. **Allow the maintainer to push to your fork** - When creating your PR, check "Allow edits by maintainers". This speeds up the review process and allows the maintainer to make small adjustments directly.
3. Create a feature branch (`git checkout -b feature/your-feature`)
4. Make your changes
5. Run tests (`npm test`)
6. Submit a pull request

## Local Development Setup

**Prerequisites:**
- [Node.js](https://nodejs.org/) (any version - automatic fallback if needed)
- npm or yarn
- Git

```bash
# 1. Clone the repository
git clone https://github.com/czlonkowski/n8n-mcp.git
cd n8n-mcp

# 2. Clone n8n docs (optional but recommended)
git clone https://github.com/n8n-io/n8n-docs.git ../n8n-docs

# 3. Install and build
npm install
npm run build

# 4. Initialize database
npm run rebuild

# 5. Start the server
npm start          # stdio mode for Claude Desktop
npm run start:http # HTTP mode for remote access
```

## Development Commands

```bash
# Build & Test
npm run build          # Build TypeScript
npm run rebuild        # Rebuild node database
npm run test-nodes     # Test critical nodes
npm run validate       # Validate node data
npm test               # Run all tests

# Update Dependencies
npm run update:n8n:check  # Check for n8n updates
npm run update:n8n        # Update n8n packages

# Run Server
npm run dev            # Development with auto-reload
npm run dev:http       # HTTP dev mode
```

## Testing

The project includes a comprehensive test suite:

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run specific test suites
npm run test:unit           # Unit tests
npm run test:integration    # Integration tests
```

### Test Architecture

- **Unit Tests**: Isolated component testing with mocks (services, parsers, database, MCP tools, HTTP server)
- **Integration Tests**: Full system behavior validation (n8n API, MCP protocol, database, templates, Docker)
- **Framework**: Vitest
- **API Mocking**: MSW
- **CI/CD**: Automated testing on all PRs with GitHub Actions

## Automated Releases (For Maintainers)

This project uses automated releases triggered by version changes:

```bash
# Guided release preparation
npm run prepare:release

# Test release automation
npm run test:release-automation
```

The system automatically handles GitHub releases, NPM publishing, multi-platform Docker images, and documentation updates.

See [Automated Release Guide](./docs/AUTOMATED_RELEASES.md) for details.
