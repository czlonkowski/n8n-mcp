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
    // Webhook URLs (replace with placeholder but keep structure) - MUST BE FIRST
    { pattern: /https?:\/\/[^\s/]+\/webhook\/[^\s]+/g, placeholder: '[REDACTED_WEBHOOK]' },
    { pattern: /https?:\/\/[^\s/]+\/hook\/[^\s]+/g, placeholder: '[REDACTED_WEBHOOK]' },

    // Self-hosted n8n hostnames — Gap 5 (customer-identifying topology).
    // Requires a label after `n8n.` so `https://n8n.io/...` (public docs) is
    // intentionally NOT matched.
    { pattern: /https?:\/\/n8n\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/?#][^\s"'<>]*)?/gi, placeholder: '[REDACTED_N8N_HOST_URL]' },

    // Supabase project URLs — Gap 6 (20-char project ref . supabase.co)
    { pattern: /https?:\/\/[a-z]{20}\.supabase\.co(?:[/?#][^\s"'<>]*)?/gi, placeholder: '[REDACTED_SUPABASE_URL]' },

    // URLs with authentication - MUST BE BEFORE BEARER TOKENS
    { pattern: /https?:\/\/[^:]+:[^@]+@[^\s/]+/g, placeholder: '[REDACTED_URL_WITH_AUTH]' },
    { pattern: /wss?:\/\/[^:]+:[^@]+@[^\s/]+/g, placeholder: '[REDACTED_URL_WITH_AUTH]' },
    { pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s]+/g, placeholder: '[REDACTED_URL_WITH_AUTH]' }, // Database protocols - includes port and path

    // Bearer tokens — placed before provider/JWT/long-token patterns so that
    // "Bearer <secret>" is consumed as one unit and the prefix is preserved.
    // Token-character class excludes common delimiters (quotes, commas,
    // semicolons, closing brackets) so wrapping syntax like
    // `auth: 'Bearer <token>'` is preserved instead of being eaten with the token.
    { pattern: /Bearer\s+[^\s'"`,;}\]]+/gi, placeholder: 'Bearer [REDACTED]' },

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

    // PII — emails and phones in free-text node parameters
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, placeholder: '[REDACTED_EMAIL]' },
    // Lookbehind/lookahead reject digit-or-hyphen neighbours so UUIDs and other
    // hex-with-hyphen IDs aren't misclassified as phone numbers.
    { pattern: /(?<![\d-])(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?![\d-])/g, placeholder: '[REDACTED_PHONE]' },

    // Generic token fallbacks (idempotency-safe via negative lookahead)
    { pattern: /\b(?!REDACTED)[A-Za-z0-9_-]{32,}\b/g, placeholder: '[REDACTED_TOKEN]' }, // Long tokens (32+ chars)
    { pattern: /\b(?!REDACTED)[A-Za-z0-9_-]{20,31}\b/g, placeholder: '[REDACTED]' }, // Short tokens (20-31 chars)
  ];

  private static readonly SENSITIVE_FIELDS = [
    'apiKey',
    'api_key',
    'token',
    'secret',
    'password',
    'credential',
    'auth',
    'authorization',
    'webhook',
    'webhookUrl',
    'url',
    'endpoint',
    'host',
    'server',
    'database',
    'connectionString',
    'privateKey',
    'publicKey',
    'certificate',
  ];

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

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = this.isSensitiveField(key);
      const isUrlField = lowerKey.includes('url') ||
                         lowerKey.includes('endpoint') ||
                         lowerKey.includes('webhook');

      // SECURITY (GHSA-f3rg-xqjj-cj9w): URL-like fields (url, endpoint, webhook)
      // are fully redacted rather than partially sanitized, because preserving
      // the path or query string leaks customer IDs, tenant identifiers, signed
      // request parameters, and tokens shorter than the generic-token threshold.
      if (isSensitive) {
        sanitized[key] = isUrlField ? '[REDACTED_URL]' : '[REDACTED]';
      }
      // Recursively sanitize non-sensitive nested objects
      else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value);
      }
      // Pattern-sanitize non-sensitive strings
      else if (typeof value === 'string') {
        sanitized[key] = this.sanitizeString(value);
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
  private static sanitizeString(value: string): string {
    // First check if this is a webhook URL
    if (value.includes('/webhook/') || value.includes('/hook/')) {
      return 'https://[webhook-url]';
    }

    let sanitized = value;

    // Apply all sensitive patterns with their specific placeholders
    for (const patternDef of this.SENSITIVE_PATTERNS) {
      // Skip webhook patterns - already handled above
      if (patternDef.placeholder.includes('WEBHOOK')) {
        continue;
      }

      // Special handling for URL with auth - preserve path after credentials
      if (patternDef.placeholder === '[REDACTED_URL_WITH_AUTH]') {
        const matches = value.match(patternDef.pattern);
        if (matches) {
          for (const match of matches) {
            // Extract path after the authenticated URL
            const fullUrlMatch = value.indexOf(match);
            if (fullUrlMatch !== -1) {
              const afterUrl = value.substring(fullUrlMatch + match.length);
              // If there's a path after the URL, preserve it
              if (afterUrl && afterUrl.startsWith('/')) {
                const pathPart = afterUrl.split(/[\s?&#]/)[0]; // Get path until query/fragment
                sanitized = sanitized.replace(match + pathPart, patternDef.placeholder + pathPart);
              } else {
                sanitized = sanitized.replace(match, patternDef.placeholder);
              }
            }
          }
        }
        continue;
      }

      // Apply pattern with its specific placeholder
      sanitized = sanitized.replace(patternDef.pattern, patternDef.placeholder);
    }

    return sanitized;
  }

  /**
   * Check if a field name is sensitive
   */
  private static isSensitiveField(fieldName: string): boolean {
    const lowerFieldName = fieldName.toLowerCase();
    return this.SENSITIVE_FIELDS.some(sensitive =>
      lowerFieldName.includes(sensitive.toLowerCase())
    );
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