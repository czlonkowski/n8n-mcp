/**
 * Regex-based credential and PII scanner for n8n workflows.
 *
 * TypeScript port of pii_prescreen.py. Catches API keys, secrets, and PII
 * with deterministic patterns. Covers 50+ service-specific key prefixes
 * plus generic PII patterns (email, phone, credit card).
 *
 * SECURITY: Raw secret values are never stored in detection results.
 * The maskSecret() function is called at scan time so only masked
 * snippets appear in the output.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecretPattern {
  regex: RegExp;
  label: string;
  category: string;
  severity: 'critical' | 'high' | 'medium';
}

export interface ScanDetection {
  label: string;
  category: string;
  severity: 'critical' | 'high' | 'medium';
  location: {
    workflowId: string;
    workflowName: string;
    nodeName?: string;
    nodeType?: string;
  };
  maskedSnippet?: string;
}

// ---------------------------------------------------------------------------
// Skip fields - structural / template fields that should not be scanned
// ---------------------------------------------------------------------------

const SKIP_FIELDS = new Set<string>([
  'expression',
  'id',
  'typeVersion',
  'position',
  'credentials',
]);

// ---------------------------------------------------------------------------
// Secret patterns (instant reject)
// ---------------------------------------------------------------------------

export const SECRET_PATTERNS: SecretPattern[] = [
  // ── AI / ML ──────────────────────────────────────────────────────────────
  { regex: /sk-(?:proj-)?[A-Za-z0-9]{20,}/, label: 'openai_key', category: 'AI/ML', severity: 'critical' },
  { regex: /sk-ant-[A-Za-z0-9_-]{20,}/, label: 'anthropic_key', category: 'AI/ML', severity: 'critical' },
  { regex: /gsk_[a-zA-Z0-9]{48,}/, label: 'groq_key', category: 'AI/ML', severity: 'critical' },
  { regex: /r8_[a-zA-Z0-9]{37}/, label: 'replicate_key', category: 'AI/ML', severity: 'critical' },
  { regex: /hf_[a-zA-Z]{34}/, label: 'huggingface_key', category: 'AI/ML', severity: 'critical' },
  { regex: /pplx-[a-zA-Z0-9]{48}/, label: 'perplexity_key', category: 'AI/ML', severity: 'critical' },

  // ── Cloud / DevOps ───────────────────────────────────────────────────────
  { regex: /AKIA[A-Z0-9]{16}/, label: 'aws_key', category: 'Cloud/DevOps', severity: 'critical' },
  { regex: /AIza[A-Za-z0-9_-]{35}/, label: 'google_api_key', category: 'Cloud/DevOps', severity: 'critical' },
  { regex: /dop_v1_[a-f0-9]{64}/, label: 'digitalocean_pat', category: 'Cloud/DevOps', severity: 'critical' },
  { regex: /do[or]_v1_[a-f0-9]{64}/, label: 'digitalocean_token', category: 'Cloud/DevOps', severity: 'critical' },
  { regex: /v(?:cp|ci|ck)_[a-zA-Z0-9]{24,}/, label: 'vercel_token', category: 'Cloud/DevOps', severity: 'critical' },
  { regex: /nfp_[a-zA-Z0-9]{40,}/, label: 'netlify_pat', category: 'Cloud/DevOps', severity: 'critical' },
  { regex: /HRKU-AA[0-9a-zA-Z_-]{58}/, label: 'heroku_key', category: 'Cloud/DevOps', severity: 'critical' },
  { regex: /glpat-[\w-]{20}/, label: 'gitlab_pat', category: 'Cloud/DevOps', severity: 'critical' },
  { regex: /npm_[a-z0-9]{36}/, label: 'npm_token', category: 'Cloud/DevOps', severity: 'critical' },

  // ── GitHub ───────────────────────────────────────────────────────────────
  { regex: /ghp_[A-Za-z0-9]{36,}/, label: 'github_pat', category: 'GitHub', severity: 'critical' },
  { regex: /gho_[A-Za-z0-9]{36,}/, label: 'github_oauth', category: 'GitHub', severity: 'critical' },
  { regex: /ghs_[A-Za-z0-9]{36,}/, label: 'github_server', category: 'GitHub', severity: 'critical' },
  { regex: /ghr_[A-Za-z0-9]{36,}/, label: 'github_refresh', category: 'GitHub', severity: 'critical' },

  // ── Auth tokens ──────────────────────────────────────────────────────────
  { regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, label: 'jwt_token', category: 'Auth tokens', severity: 'critical' },
  { regex: /sbp_[a-f0-9]{40,}/, label: 'supabase_secret', category: 'Auth tokens', severity: 'critical' },

  // ── Communication ────────────────────────────────────────────────────────
  { regex: /xox[bps]-[0-9]{10,}-[A-Za-z0-9-]+/, label: 'slack_token', category: 'Communication', severity: 'critical' },
  { regex: /\b\d{8,10}:A[a-zA-Z0-9_-]{34}\b/, label: 'telegram_bot', category: 'Communication', severity: 'critical' },

  // ── Payment ──────────────────────────────────────────────────────────────
  { regex: /[sr]k_(?:live|test)_[A-Za-z0-9]{20,}/, label: 'stripe_key', category: 'Payment', severity: 'critical' },
  { regex: /sq0(?:atp|csp)-[0-9A-Za-z_-]{22,}/, label: 'square_key', category: 'Payment', severity: 'critical' },
  { regex: /rzp_(?:live|test)_[a-zA-Z0-9]{14,}/, label: 'razorpay_key', category: 'Payment', severity: 'critical' },

  // ── Email / Marketing ────────────────────────────────────────────────────
  { regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/, label: 'sendgrid_key', category: 'Email/Marketing', severity: 'critical' },
  { regex: /key-[a-f0-9]{32}/, label: 'mailgun_key', category: 'Email/Marketing', severity: 'high' },
  { regex: /xkeysib-[a-f0-9]{64}-[a-zA-Z0-9]{16}/, label: 'brevo_key', category: 'Email/Marketing', severity: 'critical' },
  { regex: /(?<!\w)re_[a-zA-Z0-9_]{32,}/, label: 'resend_key', category: 'Email/Marketing', severity: 'critical' },
  { regex: /[a-f0-9]{32}-us\d{1,2}\b/, label: 'mailchimp_key', category: 'Email/Marketing', severity: 'critical' },

  // ── E-commerce ───────────────────────────────────────────────────────────
  { regex: /shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32,}/, label: 'shopify_token', category: 'E-commerce', severity: 'critical' },

  // ── Productivity / CRM ───────────────────────────────────────────────────
  { regex: /ntn_[0-9]{11}[A-Za-z0-9]{35}/, label: 'notion_token', category: 'Productivity/CRM', severity: 'critical' },
  { regex: /secret_[a-zA-Z0-9]{43}\b/, label: 'notion_legacy', category: 'Productivity/CRM', severity: 'critical' },
  { regex: /lin_api_[a-zA-Z0-9]{40}/, label: 'linear_key', category: 'Productivity/CRM', severity: 'critical' },
  { regex: /CFPAT-[a-zA-Z0-9_-]{43,}/, label: 'contentful_pat', category: 'Productivity/CRM', severity: 'critical' },
  { regex: /ATATT[a-zA-Z0-9_-]{50,}/, label: 'atlassian_token', category: 'Productivity/CRM', severity: 'critical' },
  { regex: /pat-(?:na1|eu1)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/, label: 'hubspot_pat', category: 'Productivity/CRM', severity: 'critical' },

  // ── Monitoring / Analytics ───────────────────────────────────────────────
  { regex: /sntr[ysu]_[a-zA-Z0-9+/=]{40,}/, label: 'sentry_token', category: 'Monitoring/Analytics', severity: 'critical' },
  { regex: /ph[cx]_[a-zA-Z0-9]{32,}/, label: 'posthog_key', category: 'Monitoring/Analytics', severity: 'critical' },
  { regex: /gl(?:c|sa)_[A-Za-z0-9+/=_]{32,}/, label: 'grafana_key', category: 'Monitoring/Analytics', severity: 'critical' },
  { regex: /NRAK-[A-Z0-9]{27}/, label: 'newrelic_key', category: 'Monitoring/Analytics', severity: 'critical' },

  // ── Database ─────────────────────────────────────────────────────────────
  { regex: /pscale_(?:tkn|pw|oauth)_[a-zA-Z0-9=._-]{32,}/, label: 'planetscale_key', category: 'Database', severity: 'critical' },
  { regex: /dapi[a-f0-9]{32}/, label: 'databricks_key', category: 'Database', severity: 'critical' },

  // ── Other services ───────────────────────────────────────────────────────
  { regex: /SK[a-f0-9]{32}/, label: 'twilio_key', category: 'Other', severity: 'critical' },
  { regex: /\bpat[A-Za-z0-9]{10,}\.[A-Za-z0-9]{20,}/, label: 'airtable_pat', category: 'Other', severity: 'critical' },
  { regex: /apify_api_[A-Za-z0-9]{20,}/, label: 'apify_key', category: 'Other', severity: 'critical' },
  { regex: /figd_[a-zA-Z0-9_-]{40,}/, label: 'figma_pat', category: 'Other', severity: 'critical' },
  { regex: /PMAK-[a-f0-9]{24}-[a-f0-9]{34}/, label: 'postman_key', category: 'Other', severity: 'critical' },
  { regex: /dp\.(?:pt|st|sa)\.[a-zA-Z0-9._-]{40,}/, label: 'doppler_token', category: 'Other', severity: 'critical' },

  // ── Generic patterns (keep last - catch-all) ────────────────────────────
  { regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/, label: 'private_key', category: 'Generic', severity: 'critical' },
  { regex: /Bearer\s+[A-Za-z0-9._-]{32,}/i, label: 'bearer_token', category: 'Generic', severity: 'high' },
  { regex: /(?:https?|postgres|mysql|mongodb|redis|amqp):\/\/[^:"\s]+:[^@"\s]+@[^\s"]+/, label: 'url_with_auth', category: 'Generic', severity: 'critical' },
];

// ---------------------------------------------------------------------------
// PII patterns (instant reject)
// ---------------------------------------------------------------------------

export const PII_PATTERNS: SecretPattern[] = [
  // Email addresses (but not template expressions like {{$json.email}})
  { regex: /(?<!\{)\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b(?!\})/, label: 'email', category: 'PII', severity: 'medium' },
  // Phone numbers (international formats)
  { regex: /(?<!\d)\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/, label: 'phone', category: 'PII', severity: 'medium' },
  // Credit card numbers
  { regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/, label: 'credit_card', category: 'PII', severity: 'high' },
];

// Combined patterns for internal use
const ALL_PATTERNS: SecretPattern[] = [...SECRET_PATTERNS, ...PII_PATTERNS];

// ---------------------------------------------------------------------------
// maskSecret - shows first 6 + last 4 chars, masks the rest with ****
// ---------------------------------------------------------------------------

/**
 * Masks a secret value, showing only the first 6 and last 4 characters.
 * Values shorter than 14 characters get fully masked to avoid leaking
 * most of the original content.
 */
export function maskSecret(value: string): string {
  if (value.length < 14) {
    return '****';
  }
  const head = value.slice(0, 6);
  const tail = value.slice(-4);
  return `${head}****${tail}`;
}

// ---------------------------------------------------------------------------
// collectStrings - recursively collect scannable string values
// ---------------------------------------------------------------------------

function collectStrings(
  obj: unknown,
  parts: string[],
  depth: number = 0,
): void {
  if (depth > 10) {
    return;
  }

  if (typeof obj === 'string') {
    // Skip pure expression strings like "={{ $json.email }}" or "{{ ... }}"
    if (obj.startsWith('=') || obj.startsWith('{{')) {
      return;
    }
    // Skip very short strings (booleans, ops like "get")
    if (obj.length > 8) {
      parts.push(obj);
    }
    return;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectStrings(item, parts, depth + 1);
    }
    return;
  }

  if (obj !== null && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (SKIP_FIELDS.has(key)) {
        continue;
      }
      collectStrings(val, parts, depth + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Workflow scanning input type (loose, to accept various workflow shapes)
// ---------------------------------------------------------------------------

interface ScanWorkflowInput {
  id?: string;
  name: string;
  nodes: Array<{
    id?: string;
    name: string;
    type: string;
    parameters?: Record<string, unknown>;
    notes?: string;
    [key: string]: unknown;
  }>;
  settings?: Record<string, unknown>;
  staticData?: Record<string, unknown>;
  pinData?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// scanText - match collected strings against all patterns
// ---------------------------------------------------------------------------

function scanText(
  parts: string[],
  location: ScanDetection['location'],
  detections: ScanDetection[],
): void {
  const text = parts.join('\n');
  for (const pattern of ALL_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (match) {
      detections.push({
        label: pattern.label,
        category: pattern.category,
        severity: pattern.severity,
        location,
        maskedSnippet: maskSecret(match[0]),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// scanWorkflow - scan a workflow for secrets and PII
// ---------------------------------------------------------------------------

/**
 * Scans an n8n workflow for embedded secrets and PII.
 *
 * Scans per-node so detections include the specific node name/type.
 * Top-level fields (pinData, staticData, settings) are attributed to
 * the workflow level (no specific node).
 *
 * SECURITY: Raw secret values are never stored in the returned detections.
 * Only masked snippets (via maskSecret()) appear in the output.
 */
export function scanWorkflow(workflow: ScanWorkflowInput): ScanDetection[] {
  const detections: ScanDetection[] = [];
  const baseLocation = {
    workflowId: workflow.id ?? '',
    workflowName: workflow.name ?? '',
  };

  // Scan each node individually for precise location reporting
  for (const node of workflow.nodes ?? []) {
    const parts: string[] = [];

    if (node.name && node.name.length > 8) parts.push(node.name);
    if (node.notes && node.notes.length > 8) parts.push(node.notes);
    if (node.parameters) collectStrings(node.parameters, parts);

    scanText(parts, { ...baseLocation, nodeName: node.name, nodeType: node.type }, detections);
  }

  // Scan top-level fields: pinData, staticData, settings
  for (const key of ['pinData', 'staticData', 'settings'] as const) {
    const data = (workflow as unknown as Record<string, unknown>)[key];
    if (data != null && typeof data === 'object') {
      const parts: string[] = [];
      collectStrings(data, parts);
      scanText(parts, { ...baseLocation }, detections);
    }
  }

  return detections;
}
