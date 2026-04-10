# Privacy Policy for n8n-mcp Telemetry

## Overview
n8n-mcp collects anonymous usage statistics to help improve the tool. This data collection is designed to respect user privacy while providing valuable insights into how the tool is used.

## What We Collect
- **Anonymous User ID**: A hashed identifier derived from your machine characteristics (no personal information)
- **Tool Usage**: Which MCP tools are used and their performance metrics
- **Workflow Patterns**: Sanitized workflow structures (all sensitive data removed)
- **Error Types**: Categories of errors encountered (no error messages with user data)
- **System Information**: Platform, architecture, Node.js version, and n8n-mcp version

## What We DON'T Collect
- Personal information or usernames
- API keys, tokens, or credentials
- URLs, endpoints, or hostnames
- Email addresses or contact information
- File paths or directory structures
- Actual workflow data or parameters
- Database connection strings
- Any authentication information

## Data Sanitization
All collected data undergoes automatic sanitization:
- URLs are replaced with `[URL]` or `[REDACTED]`
- Long alphanumeric strings (potential keys) are replaced with `[KEY]`
- Email addresses are replaced with `[EMAIL]`
- Authentication-related fields are completely removed

## Data Storage
- Data is stored securely using Supabase
- Anonymous users have write-only access (cannot read data back)
- Row Level Security (RLS) policies prevent data access by anonymous users

## Opt-Out
You can disable telemetry at any time:

**npx:**
```bash
npx n8n-mcp telemetry disable
```

**Docker:**
```
-e N8N_MCP_TELEMETRY_DISABLED=true
```

**docker-compose:**
```yaml
environment:
  N8N_MCP_TELEMETRY_DISABLED: "true"
```

To re-enable:
```bash
npx n8n-mcp telemetry enable
```

To check status:
```bash
npx n8n-mcp telemetry status
```

## Data Usage
Collected data is used solely to:
- Understand which features are most used
- Identify common error patterns
- Improve tool performance and reliability
- Guide development priorities
- Train machine learning models for workflow generation

All ML training uses sanitized, anonymized data only.
Users can opt-out at any time with `npx n8n-mcp telemetry disable`

## Data Retention
- Data is retained for analysis purposes
- No personal identification is possible from the collected data

## Changes to This Policy
We may update this privacy policy from time to time. Updates will be reflected in this document.

## Contact
For questions about telemetry or privacy, please open an issue on GitHub:
https://github.com/czlonkowski/n8n-mcp/issues

Last updated: 2025-11-06