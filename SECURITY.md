# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in n8n-mcp, please report it through [GitHub's private vulnerability reporting](https://github.com/czlonkowski/n8n-mcp/security/advisories/new). Do not create public issues for security vulnerabilities.

## Supported Versions

Only the latest release receives security patches. We recommend always running the latest version.

## Response Process

1. We will acknowledge your report within 72 hours
2. We will investigate and determine severity
3. If confirmed, we will develop and release a fix
4. We will credit reporters in the advisory (unless they prefer otherwise)

For the full incident response process, see our [Incident Response Plan](.github/INCIDENT_RESPONSE.md).

## Scope

n8n-mcp is a proxy to the n8n REST API. The security boundary is n8n itself, not n8n-mcp. Reports about capabilities that are inherent to the n8n API (e.g., creating workflows with Code nodes) are out of scope, as n8n-mcp does not grant any capability beyond what the n8n API already provides.

In-scope examples:
- Authentication bypass in the MCP HTTP transport
- Information disclosure (credential leaks, token exposure)
- Injection vulnerabilities in n8n-mcp's own code
- Dependency vulnerabilities with a viable exploit path

Out-of-scope examples:
- n8n platform capabilities accessible through any n8n API client
- General LLM prompt injection risks (these affect all MCP servers equally)
- Denial of service through normal API usage

For deployment hardening guidance, see the [Security & Hardening guide](./docs/SECURITY_HARDENING.md). For the STRIDE threat model, see [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md).
