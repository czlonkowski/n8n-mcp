# Privacy Policy for n8n-mcp Telemetry

**Version 2 — effective 2026-09-02.**

This version replaces the policy dated 2025-11-06. Changes apply to data collected on or after the effective date. See [Changes to This Policy](#changes-to-this-policy) for what changed and why.

## Overview

n8n-mcp collects usage data to improve the tool and to build datasets and machine learning models for workflow generation. Telemetry is enabled by default and can be turned off at any time (see [Opt-Out](#opt-out)).

The data is pseudonymous at the point of collection: it carries an installation identifier but no name, email, or account. Workflow structures are further processed into an anonymized dataset before they are retained, as described in [How Workflow Data Is Processed](#how-workflow-data-is-processed).

## Who Is Responsible

The data controller is:

AiAdvisors Romuald Członkowski, a sole proprietorship (jednoosobowa działalność gospodarcza) registered in Poland
Contact: romuald@n8n-mcp.com
Postal address available on request.

## What We Collect

- **Installation ID**: A 16-character hash that identifies an installation of n8n-mcp. On local installations it is derived from machine characteristics (hostname, platform, architecture, home directory path) and stored in your telemetry config file. In Docker and cloud environments it is derived from the host's boot identifier. It does not contain your name, username, or hostname in readable form, but it is a stable identifier and is therefore treated as pseudonymous data, not anonymous data.
- **Tool usage**: Which MCP tools are called, whether the call succeeded, and how long it took. Tool arguments are not sent, with one exception listed next.
- **Workflow change intent**: The free-text `intent` argument passed to workflow update tools (for example "Add error handling for API failures"), after removal of email addresses, phone numbers, URLs, and credential-like strings. Together with the intent we record the types of operations applied (for example "add node", "remove connection"), with node parameters inside those operations redacted.
- **Workflow structures**: Workflows that are created, updated, or validated through n8n-mcp, after sanitization. A sanitized workflow contains node types, node names, connections between nodes, and node parameters with sensitive fields removed and sensitive values replaced by placeholders. See [Data Sanitization](#data-sanitization) for what is removed. Node parameters that survive sanitization are collected.
- **Error categories**: The kind of error encountered, with messages sanitized to remove user data.
- **System information**: Platform, CPU architecture, Node.js version, n8n-mcp version, whether the process runs in Docker, and which cloud platform is detected, if any.
- **Performance metrics**: Startup duration and checkpoints, request timing, and success rates.

## What We Don't Collect

- Names, usernames, email addresses, or other contact details
- API keys, tokens, passwords, or credentials of any kind
- URLs, hostnames, or the address of your n8n instance
- File paths or directory listings
- Workflow execution data: input and output items, run results, pinned data, static data
- Credentials attached to workflows or nodes
- Workflow ownership or sharing information
- The prompts you write to your AI assistant, other than the `intent` field described above

## Data Sanitization

Sanitization runs on your machine before anything is sent. The code is public in `src/telemetry/`, principally `workflow-sanitizer.ts`, `intent-sanitizer.ts`, and `error-sanitizer.ts`.

For workflows:

- Fields whose names indicate secrets or endpoints (for example `apiKey`, `token`, `password`, `url`, `host`, `connectionString`, `privateKey`) are replaced with `[REDACTED]`
- Credentials, pinned data, static data, sharing and ownership fields are deleted
- Webhook URLs, n8n instance URLs, database connection strings, and URLs containing login details are replaced with placeholders
- Bearer tokens, JWTs, and API keys with recognizable prefixes (OpenAI, Anthropic, Stripe, GitHub, GitLab, Slack, AWS, Supabase, Hugging Face, Notion, and others) are replaced with placeholders
- Long alphanumeric strings that could be undetected keys are replaced with placeholders
- Email addresses and phone numbers are replaced with placeholders

For intent text and error messages, the same email, phone, URL, and credential patterns are applied.

Sanitization is pattern-based and cannot guarantee that every piece of sensitive data is caught. A second, stricter pass runs server-side before workflow data is retained, described in the next section.

## How Workflow Data Is Processed

Sanitized workflows are not retained in the form in which they are received. They are held in a processing queue and transformed into an anonymized dataset by an automated job that runs daily. The job:

1. Reads the sanitized workflow only. The installation ID is not read and is not carried forward.
2. Rejects and permanently discards any workflow that still contains a credential, an API key, or a token detected by a second, stricter scan.
3. Replaces any remaining email addresses, phone numbers, payment card numbers, and URLs with placeholders.
4. Submits the workflow to an automated review that discards workflows containing organization-specific logic, hardcoded identifiers, or personal information that pattern matching cannot detect.
5. Generates a machine-written description, a set of keywords, and a name for each workflow that passes review. These descriptions are written by a language model, not copied from user input.
6. Stores the result in a dataset that has no installation identifier, no reference to the original submission, and no link to any person or organization.
7. Deletes the original submission from the processing queue, whether it was accepted or rejected.

The retained workflow dataset therefore consists of anonymized workflow structures and machine-generated descriptions. We do not consider it personal data. The rejection and sanitization scan has been audited against the full dataset and re-applied retroactively to all rows collected before the current standard was in place.

Workflow change records (the intent text, the operations applied, and the workflow before and after the change) are processed the same way after 7 days: the installation ID is removed, records containing credentials are discarded, remaining personal data patterns are replaced with placeholders, and the result is retained as part of the anonymized dataset.

Event data is reduced each night to counts. Raw events are kept for 7 days, then deleted. The installation ID is used only to count unique installations, to derive these counts, and to honour deletion requests. To count new and returning installations we keep a registry holding, per installation, a keyed hash of the ID and the dates it was first and last seen. Registry rows are deleted 12 months after the last activity.

## Data Storage and Service Providers

- The processing queue and event data are stored with Supabase. Clients have write-only access; row-level security prevents any client from reading data back.
- The anonymized workflow dataset is stored on servers we operate with a European hosting provider.
- Automated review and description generation use AI service providers acting on our instructions. They receive sanitized workflow content, never the installation ID.

All providers process the data as our processors under contract. We remain the controller.

## How We Use the Data

We use collected data to:

- Understand which features are used and how
- Identify common error patterns and improve reliability
- Guide development priorities
- Build datasets of workflow structures and patterns
- Train, fine-tune, and evaluate machine learning models for workflow generation, validation, and assistance
- Publish aggregated statistics about n8n-mcp usage

Datasets and models are built only from the anonymized dataset described above, never from the processing queue, raw workflow change records, or event data carrying installation IDs.

## Sharing and Licensing

We do not sell or share the processing queue or any data carrying an installation ID with third parties, other than the processors listed above.

We may:

- Publish aggregated statistics that cannot be traced to any installation
- Share or license the anonymized workflow dataset, datasets derived from it, and models trained on it with third parties, including commercial partners
- Transfer the anonymized dataset, derived datasets, and models as part of a merger, acquisition, financing, or sale of assets. Data carrying an installation ID would be transferred in such an event only to a successor that assumes the obligations of this policy

## Your Grant to Us

By leaving telemetry enabled you grant us a worldwide, non-exclusive, royalty-free, perpetual license to use, reproduce, modify, aggregate, and create derivative works from the data you submit, including the right to sublicense derivative works and anonymized datasets to third parties for the purposes described in this policy.

The first-run notice states that leaving telemetry enabled means accepting this policy, and links to it.

## Legal Basis

Where the GDPR or a similar law applies, we process pseudonymous telemetry on the basis of our legitimate interest in improving n8n-mcp and in building the datasets and models described above (GDPR Article 6(1)(f)). Telemetry is designed so that this interest can be met without collecting identifying information: the installation ID serves only to count unique installations and to honour deletion requests, and you can stop collection at any time.

The anonymized workflow dataset falls outside the scope of these laws once processing under [How Workflow Data Is Processed](#how-workflow-data-is-processed) is complete.

## Your Rights

You can find your installation ID by running:

```bash
npx n8n-mcp telemetry status
```

With that ID you can ask us to:

- Delete all event data associated with the ID
- Tell you what event data we hold for the ID

Send requests to romuald@n8n-mcp.com quoting the ID. Deletion covers raw events, raw workflow change records, the processing queue, and the registry entry. It cannot reach the anonymized dataset or aggregated statistics, because they do not carry the ID and we have no way to identify which rows came from you.

If you are in the European Union you also have the right to lodge a complaint with your national data protection authority.

## Data Retention

- **Processing queue (raw sanitized workflows)**: Deleted by the daily processing job after transformation, normally within 24 hours of submission
- **Raw events** (tool usage, sessions, searches, errors, validation results, workflow creation, health checks, diagnostics, startup): Reduced each night to daily and hourly counts that carry no installation ID, then deleted. Raw events are kept for 7 days
- **Raw workflow change records**: Kept for 7 days, then anonymized as described above
- **Installation registry** (keyed hash of the ID, first-seen and last-seen dates): Deleted 12 months after the last activity
- **Aggregated statistics**: Retained indefinitely. They contain counts only, no installation ID
- **Anonymized workflow dataset, anonymized workflow change records, derived datasets, and models**: Retained indefinitely

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

Disabling telemetry stops all collection from that moment. It does not delete data already collected; use the contact above for deletion.

## Changes to This Policy

We may update this policy. Changes are published in this file, with the version and effective date at the top, and take effect only for data collected after the effective date. The full history is available in the repository's version control.

**Version 2 (2026-09-02)**: Rewritten to describe the installation ID as pseudonymous rather than anonymous; to state that sanitized node parameters and workflow change intents are collected; to describe the server-side anonymization pipeline; to add sharing, licensing, successor, legal basis, rights, and retention sections; and to name the controller and a contact address.

**2025-11-06**: Added training of machine learning models as a purpose.

**2025-09-25**: First version.

## Contact

Privacy requests and questions: romuald@n8n-mcp.com

General questions about telemetry can also be raised on GitHub:
https://github.com/czlonkowski/n8n-mcp/issues
