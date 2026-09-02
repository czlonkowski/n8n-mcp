/**
 * Workflow Sanitizer
 * Removes sensitive data from workflows before telemetry storage
 */

import { createHash } from 'crypto';

interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  position: [number, number];
  parameters: any;
  credentials?: any;
  disabled?: boolean;
  typeVersion?: number;
}

interface SanitizedWorkflow {
  nodes: WorkflowNode[];
  connections: any;
  nodeCount: number;
  nodeTypes: string[];
  hasTrigger: boolean;
  hasWebhook: boolean;
  complexity: 'simple' | 'medium' | 'complex';
  workflowHash: string;
}

interface PatternDefinition {
  pattern: RegExp;
  placeholder: string;
}

export class WorkflowSanitizer {
  private static readonly SENSITIVE_PATTERNS: PatternDefinition[] = [
    // Webhook URLs (replace with placeholder but keep structure) - MUST BE FIRST.
    // The URL stops at whitespace, quotes and brackets so a webhook URL inside
    // code or prose is redacted in place without eating the surrounding syntax.
    { pattern: /https?:\/\/[^\s/]+\/webhook\/[^\s"'`<>(){}\[\],;]+/g, placeholder: '[REDACTED_WEBHOOK]' },
    { pattern: /https?:\/\/[^\s/]+\/hook\/[^\s"'`<>(){}\[\],;]+/g, placeholder: '[REDACTED_WEBHOOK]' },

    // Self-hosted n8n hostnames — Gap 5 (customer-identifying topology).
    // Requires a label after `n8n.` so `https://n8n.io/...` (public docs) is
    // intentionally NOT matched.
    { pattern: /https?:\/\/n8n\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/?#][^\s"'<>]*)?/gi, placeholder: '[REDACTED_N8N_HOST_URL]' },

    // Supabase project URLs — Gap 6 (20-char project ref . supabase.co)
    { pattern: /https?:\/\/[a-z]{20}\.supabase\.co(?:[/?#][^\s"'<>]*)?/gi, placeholder: '[REDACTED_SUPABASE_URL]' },

    // URLs with authentication - MUST BE BEFORE BEARER TOKENS. The userinfo
    // classes exclude whitespace, '/' and '@' so the match cannot run from a
    // scheme in one line to an '@' several lines later. The path after the
    // host is outside the match and therefore preserved.
    { pattern: /https?:\/\/[^\s/:@]+:[^\s/@]+@[^\s/"'`<>,;)\]}]+/g, placeholder: '[REDACTED_URL_WITH_AUTH]' },
    { pattern: /wss?:\/\/[^\s/:@]+:[^\s/@]+@[^\s/"'`<>,;)\]}]+/g, placeholder: '[REDACTED_URL_WITH_AUTH]' },
    { pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s/:@]+:[^\s/@]+@[^\s"'`<>,;)\]}]+/g, placeholder: '[REDACTED_URL_WITH_AUTH]' }, // Database protocols - includes port and path

    // Bearer tokens — placed before provider/JWT/long-token patterns so that
    // "Bearer <secret>" is consumed as one unit and the prefix is preserved.
    // Token-character class excludes common delimiters (quotes, commas,
    // semicolons, closing brackets) so wrapping syntax like
    // `auth: 'Bearer <token>'` is preserved instead of being eaten with the
    // token, and excludes '{' and '$' so `Bearer {{ $json.token }}` and
    // `Bearer ${token}` (references, not secrets) are left alone.
    { pattern: /Bearer\s+[^\s'"`,;{}\]$]+/gi, placeholder: 'Bearer [REDACTED]' },

    // Generic JWT (catches Supabase anon + service_role + any other JWT). Three base64url segments, dot-separated.
    { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, placeholder: '[REDACTED_JWT]' },

    // Supabase secret and publishable keys
    { pattern: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}\b/g, placeholder: '[REDACTED_SUPABASE_KEY]' },

    // OpenAI / OpenRouter — sk-proj- and sk-or- BEFORE the generic sk- below
    { pattern: /\bsk-proj-[A-Za-z0-9_-]{40,}\b/g, placeholder: '[REDACTED_LLM_API_KEY]' },
    { pattern: /\bsk-or-(?:v1-)?[A-Za-z0-9-]{40,}\b/g, placeholder: '[REDACTED_LLM_API_KEY]' },

    // Stripe (sk_test/live, rk_test/live)
    { pattern: /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{24,}\b/g, placeholder: '[REDACTED_STRIPE_KEY]' },

    // GitHub PATs (fine-grained + classic)
    { pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bghp_[A-Za-z0-9]{36,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },

    // GitLab PAT
    { pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },

    // Hugging Face, Notion, GoHighLevel, Slack
    { pattern: /\bhf_[A-Za-z0-9]{30,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bntn_[A-Za-z0-9]{40,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bpit-[a-f0-9-]{36}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bxox[bpaors]-[A-Za-z0-9-]{10,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },

    // AWS access key id
    { pattern: /\bAKIA[A-Z0-9]{16}\b/g, placeholder: '[REDACTED_API_TOKEN]' },

    // Generic OpenAI sk- (unchanged regex; placeholder upgraded to type-aware)
    { pattern: /\bsk-[A-Za-z0-9]{16,}\b/g, placeholder: '[REDACTED_LLM_API_KEY]' },
  ];

  // PII in free-text node parameters. Applied after UUIDs are shielded: the
  // phone pattern would otherwise match the digit runs inside hex ids.
  private static readonly PII_PATTERNS: PatternDefinition[] = [
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, placeholder: '[REDACTED_EMAIL]' },
    // Lookbehind/lookahead reject word-character and hyphen neighbours so the
    // digit runs inside identifiers (`f0418644027c`) aren't misclassified as
    // phone numbers.
    { pattern: /(?<![\w-])(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?![\w-])/g, placeholder: '[REDACTED_PHONE]' },
  ];

  // Generic fallback for secrets no provider pattern knows: an opaque run of
  // 32+ token characters containing at least three digits. A secret is a
  // random string, and a random string that long carries several digits;
  // human-written identifiers of that length carry none or a version/index
  // number (`predefinedCredentialType`, `n8n-auto-generated-fromAI-override`,
  // `users-current-day-1-minute-before-midnight`). The former 20-31 character
  // fallback and the digit-free 32+ match redacted such identifiers and left
  // most telemetry workflows invalid (n8n-mcp-backend#151). The negative
  // lookahead keeps existing placeholders intact so sanitization is idempotent.
  private static readonly OPAQUE_TOKEN_PATTERN = /\b(?!REDACTED)(?=(?:[A-Za-z_-]*\d){3})[A-Za-z0-9_-]{32,}\b/g;

  // UUIDs are identifiers (node ids, webhookId, default webhook paths,
  // resource ids), never secrets. sanitizeString shields them from the PII
  // patterns and the opaque-token fallback, including when embedded in a
  // longer hyphenated run. Secret patterns run first: a UUID after `Bearer `
  // or `pit-` is a token and is redacted with its prefix.
  private static readonly UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  private static readonly UUID_SHIELD = /\u0000uuid(\d+)\u0000/g;

  // Key classification works on the words of the key (camelCase, snake_case
  // and kebab-case are split), not on substrings: `accessToken` and
  // `client_secret` are secrets, `authentication`, `nodeCredentialType` and
  // `tokenizer` are not. Plurals are listed where a plural key still holds
  // secrets (`credentials`, `secrets`); `tokens` is deliberately absent
  // because `maxTokens` is a count.
  private static readonly SECRET_KEY_WORDS = new Set([
    'token',
    'secret',
    'secrets',
    'password',
    'passwords',
    'passwd',
    'passphrase',
    'authorization',
    'credentials',
    'cookie',
    'certificate',
  ]);

  // Compound names matched against the key with its separators removed.
  private static readonly SECRET_KEY_COMPOUNDS = [
    'apikey',
    'authkey',
    'authvalue',
    'privatekey',
    'publickey',
    'accesskey',
    'signingkey',
    'encryptionkey',
    'connectionstring',
  ];

  // Topology-identifying keys: redacted like secrets (GHSA-f3rg-xqjj-cj9w).
  private static readonly TOPOLOGY_KEY_WORDS = new Set([
    'host',
    'hosts',
    'hostname',
    'server',
    'servers',
    'database',
    'databases',
  ]);

  // URL-like keys are fully redacted with a URL placeholder.
  private static readonly URL_KEY_WORDS = new Set([
    'url',
    'urls',
    'endpoint',
    'endpoints',
    'webhook',
    'webhooks',
  ]);

  // A redacted secret keeps its HTTP auth scheme so the header shape survives.
  private static readonly AUTH_SCHEME_PREFIX = /^(Bearer|Basic|Digest)\s+/i;

  /**
   * Sanitize a complete workflow
   */
  static sanitizeWorkflow(workflow: any): SanitizedWorkflow {
    // Create a deep copy to avoid modifying original
    const sanitized = JSON.parse(JSON.stringify(workflow));

    // Sanitize nodes
    if (sanitized.nodes && Array.isArray(sanitized.nodes)) {
      sanitized.nodes = sanitized.nodes.map((node: WorkflowNode) =>
        this.sanitizeNode(node)
      );
    }

    // Sanitize connections (keep structure only)
    if (sanitized.connections) {
      sanitized.connections = this.sanitizeConnections(sanitized.connections);
    }

    // Remove other potentially sensitive data
    delete sanitized.settings?.errorWorkflow;
    delete sanitized.staticData;
    delete sanitized.pinData;
    delete sanitized.credentials;
    delete sanitized.sharedWorkflows;
    delete sanitized.ownedBy;
    delete sanitized.createdBy;
    delete sanitized.updatedBy;

    // Calculate metrics
    const nodeTypes = sanitized.nodes?.map((n: WorkflowNode) => n.type) || [];
    const uniqueNodeTypes = [...new Set(nodeTypes)] as string[];

    const hasTrigger = nodeTypes.some((type: string) =>
      type.includes('trigger') || type.includes('webhook')
    );

    const hasWebhook = nodeTypes.some((type: string) =>
      type.includes('webhook')
    );

    // Calculate complexity
    const nodeCount = sanitized.nodes?.length || 0;
    let complexity: 'simple' | 'medium' | 'complex' = 'simple';
    if (nodeCount > 20) {
      complexity = 'complex';
    } else if (nodeCount > 10) {
      complexity = 'medium';
    }

    // Generate workflow hash (for deduplication)
    const workflowStructure = JSON.stringify({
      nodeTypes: uniqueNodeTypes.sort(),
      connections: sanitized.connections
    });
    const workflowHash = createHash('sha256')
      .update(workflowStructure)
      .digest('hex')
      .substring(0, 16);

    return {
      nodes: sanitized.nodes || [],
      connections: sanitized.connections || {},
      nodeCount,
      nodeTypes: uniqueNodeTypes,
      hasTrigger,
      hasWebhook,
      complexity,
      workflowHash
    };
  }

  /**
   * Sanitize an arbitrary value before telemetry storage.
   * SECURITY (GHSA-8g7g-hmwm-6rv2): redact secrets from caller-supplied
   * values (operations diffs, validation results, error messages) prior to enqueue.
   */
  static sanitizeTelemetryObject<T = any>(value: any): T {
    if (value === null || value === undefined) {
      return value as T;
    }
    if (typeof value === 'string') {
      return this.sanitizeString(value) as unknown as T;
    }
    return this.sanitizeObject(value) as T;
  }

  /**
   * Sanitize a single node
   */
  private static sanitizeNode(node: WorkflowNode): WorkflowNode {
    const sanitized = { ...node };

    // Remove credentials entirely
    delete sanitized.credentials;

    // Sanitize parameters
    if (sanitized.parameters) {
      sanitized.parameters = this.sanitizeObject(sanitized.parameters);
    }

    return sanitized;
  }

  /**
   * Recursively sanitize an object
   */
  private static sanitizeObject(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    const sanitized: any = {};

    // n8n stores header, query and body parameters as `{ name, value }` pairs
    // (and Set-node assignments the same way), so a `value` inherits the
    // classification of its sibling `name`: `{ name: 'X-API-Key', value }`
    // is a secret even though neither key says so.
    const siblingName = typeof obj.name === 'string' ? obj.name : undefined;
    // A resource locator's `value` is the id of a sheet, page or channel: an
    // identifier the workflow needs, not a secret. Its `cachedResultUrl` is
    // still a URL field.
    const isResourceLocator = obj.__rl === true;

    for (const [key, value] of Object.entries(obj)) {
      let kind = this.classifyKey(key);
      if (kind === 'none' && key === 'value' && siblingName !== undefined) {
        kind = this.classifyKey(siblingName);
      }

      // SECURITY (GHSA-f3rg-xqjj-cj9w): URL-like fields (url, endpoint, webhook)
      // are fully redacted rather than partially sanitized, because preserving
      // the path or query string leaks customer IDs, tenant identifiers, signed
      // request parameters, and tokens shorter than the generic-token threshold.
      if (kind === 'url') {
        sanitized[key] = '[REDACTED_URL]';
      }
      else if (kind === 'secret') {
        sanitized[key] = this.redactSecret(value);
      }
      // Recursively sanitize non-sensitive nested objects
      else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value);
      }
      // Pattern-sanitize non-sensitive strings
      else if (typeof value === 'string') {
        sanitized[key] = this.sanitizeString(value, !(isResourceLocator && key === 'value'));
      }
      // Keep other types as-is
      else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Sanitize string values
   */
  private static sanitizeString(value: string, redactOpaqueTokens = true): string {
    let sanitized = value;
    for (const patternDef of this.SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(patternDef.pattern, patternDef.placeholder);
    }

    // Shield the UUIDs that survived the secret patterns; restored at the end.
    const uuids: string[] = [];
    sanitized = sanitized.replace(this.UUID_PATTERN, (uuid) => {
      uuids.push(uuid);
      return `\u0000uuid${uuids.length - 1}\u0000`;
    });

    for (const patternDef of this.PII_PATTERNS) {
      sanitized = sanitized.replace(patternDef.pattern, patternDef.placeholder);
    }

    if (redactOpaqueTokens) {
      sanitized = sanitized.replace(this.OPAQUE_TOKEN_PATTERN, '[REDACTED_TOKEN]');
    }

    return uuids.length === 0
      ? sanitized
      : sanitized.replace(this.UUID_SHIELD, (_, index) => uuids[Number(index)]);
  }

  private static redactSecret(value: unknown): string {
    const scheme = typeof value === 'string' ? value.match(this.AUTH_SCHEME_PREFIX) : null;
    return scheme ? `${scheme[1]} [REDACTED]` : '[REDACTED]';
  }

  /**
   * Classify a key by its words: 'url' (fully redacted with a URL
   * placeholder), 'secret' (fully redacted) or 'none' (value is sanitized by
   * pattern only).
   */
  private static classifyKey(key: string): 'url' | 'secret' | 'none' {
    const words = key
      .split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((word) => word.toLowerCase());
    const joined = words.join('');

    if (
      words.some((word) => this.SECRET_KEY_WORDS.has(word)) ||
      this.SECRET_KEY_COMPOUNDS.some((compound) => joined.includes(compound))
    ) {
      return 'secret';
    }
    // `webhookId`, `databaseId`, `serverId`: an identifier the workflow
    // needs, not the URL or host the other words suggest.
    if (words[words.length - 1] === 'id') {
      return 'none';
    }
    if (words.some((word) => this.URL_KEY_WORDS.has(word))) {
      return 'url';
    }
    if (words.some((word) => this.TOPOLOGY_KEY_WORDS.has(word))) {
      return 'secret';
    }
    return 'none';
  }

  /**
   * Sanitize connections (keep structure only)
   */
  private static sanitizeConnections(connections: any): any {
    if (!connections || typeof connections !== 'object') {
      return connections;
    }

    const sanitized: any = {};

    for (const [nodeId, nodeConnections] of Object.entries(connections)) {
      if (typeof nodeConnections === 'object' && nodeConnections !== null) {
        sanitized[nodeId] = {};

        for (const [connType, connArray] of Object.entries(nodeConnections as any)) {
          if (Array.isArray(connArray)) {
            sanitized[nodeId][connType] = connArray.map((conns: any) => {
              if (Array.isArray(conns)) {
                return conns.map((conn: any) => ({
                  node: conn.node,
                  type: conn.type,
                  index: conn.index
                }));
              }
              return conns;
            });
          } else {
            sanitized[nodeId][connType] = connArray;
          }
        }
      } else {
        sanitized[nodeId] = nodeConnections;
      }
    }

    return sanitized;
  }

  /**
   * Generate a hash for workflow deduplication
   */
  static generateWorkflowHash(workflow: any): string {
    const sanitized = this.sanitizeWorkflow(workflow);
    return sanitized.workflowHash;
  }

  /**
   * Sanitize workflow and return raw workflow object (without metrics)
   * For use in telemetry where we need plain workflow structure
   */
  static sanitizeWorkflowRaw(workflow: any): any {
    // Create a deep copy to avoid modifying original
    const sanitized = JSON.parse(JSON.stringify(workflow));

    // Sanitize nodes
    if (sanitized.nodes && Array.isArray(sanitized.nodes)) {
      sanitized.nodes = sanitized.nodes.map((node: WorkflowNode) =>
        this.sanitizeNode(node)
      );
    }

    // Sanitize connections (keep structure only)
    if (sanitized.connections) {
      sanitized.connections = this.sanitizeConnections(sanitized.connections);
    }

    // Remove other potentially sensitive data
    delete sanitized.settings?.errorWorkflow;
    delete sanitized.staticData;
    delete sanitized.pinData;
    delete sanitized.credentials;
    delete sanitized.sharedWorkflows;
    delete sanitized.ownedBy;
    delete sanitized.createdBy;
    delete sanitized.updatedBy;

    return sanitized;
  }
}