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
  notes?: string;
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
    { pattern: /https?:\/\/[^\s"'`<>(){}\[\],;]*?\/webhook(?:s|-test)?\/[^\s"'`<>(){}\[\],;]+/gi, placeholder: '[REDACTED_WEBHOOK]' },
    { pattern: /https?:\/\/[^\s/]+\/hook\/[^\s"'`<>(){}\[\],;]+/gi, placeholder: '[REDACTED_WEBHOOK]' },
    { pattern: /https?:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/gi, placeholder: '[REDACTED_WEBHOOK]' },

    // Self-hosted n8n hostnames — Gap 5 (customer-identifying topology).
    // Requires a label after `n8n.` so `https://n8n.io/...` (public docs) is
    // intentionally NOT matched.
    { pattern: /https?:\/\/n8n\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/?#][^\s"'<>]*)?/gi, placeholder: '[REDACTED_N8N_HOST_URL]' },

    // Supabase project URLs — Gap 6 (20-char project ref . supabase.co)
    { pattern: /https?:\/\/[a-z]{20}\.supabase\.co(?:[/?#][^\s"'<>]*)?/gi, placeholder: '[REDACTED_SUPABASE_URL]' },

    // URLs with authentication - MUST BE BEFORE BEARER TOKENS. The userinfo
    // classes exclude whitespace, '/', '@', quotes and code delimiters so the
    // match cannot run from a scheme in one statement to an '@' in a later
    // one. The path after the host is outside the match and therefore preserved.
    { pattern: /https?:\/\/[^\s/:@"'`<>,;()]+:[^\s/@"'`<>,;()]+@[^\s/"'`<>,;)\]}]+/gi, placeholder: '[REDACTED_URL_WITH_AUTH]' },
    { pattern: /wss?:\/\/[^\s/:@"'`<>,;()]+:[^\s/@"'`<>,;()]+@[^\s/"'`<>,;)\]}]+/gi, placeholder: '[REDACTED_URL_WITH_AUTH]' },
    { pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s/:@"'`<>,;()]+:[^\s/@"'`<>,;()]+@[^\s"'`<>,;)\]}]+/gi, placeholder: '[REDACTED_URL_WITH_AUTH]' }, // Database protocols - includes port and path

    // Secrets passed as query-string parameters in URLs inside free text,
    // code or error messages (URL-named fields are redacted whole elsewhere).
    { pattern: /([?&](?:access_token|api_key|apikey|api-key|token|key|secret|password|pwd|signature|sig|auth)=)[^&\s"'`<>]+/gi, placeholder: '$1[REDACTED]' },

    // Bearer tokens — placed before provider/JWT/long-token patterns so that
    // "Bearer <secret>" is consumed as one unit and the prefix is preserved.
    // Token-character class excludes common delimiters (quotes, commas,
    // semicolons, closing brackets) so wrapping syntax like
    // `auth: 'Bearer <token>'` is preserved instead of being eaten with the
    // token. A value starting with '{' or '$' is a reference
    // (`Bearer {{ $json.token }}`, `Bearer ${token}`), not a secret, and one
    // starting with '[' is an existing placeholder.
    { pattern: /Bearer\s+(?![{$[])[^\s'"`,;{}\]]+/gi, placeholder: 'Bearer [REDACTED]' },

    // Basic credentials: base64 of `user:password`. Requires a digit (the ':'
    // byte nearly always encodes to one) so prose such as "Basic Authentication"
    // is not matched.
    { pattern: /\bBasic\s+(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{12,}={0,2}/g, placeholder: 'Basic [REDACTED]' },

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

    // Prefixed keys whose bodies can carry too few digits for the generic
    // fallback: Google API keys and OAuth client secrets, SendGrid, Anthropic,
    // Shopify.
    { pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, placeholder: '[REDACTED_LLM_API_KEY]' },
    { pattern: /\bshpat_[a-f0-9]{32}\b/g, placeholder: '[REDACTED_API_TOKEN]' },

    // Generic OpenAI sk- (unchanged regex; placeholder upgraded to type-aware)
    { pattern: /\bsk-[A-Za-z0-9]{16,}\b/g, placeholder: '[REDACTED_LLM_API_KEY]' },
  ];

  // PII in free-text node parameters. Applied after UUIDs are shielded: the
  // phone pattern would otherwise match the digit runs inside hex ids.
  private static readonly PII_PATTERNS: PatternDefinition[] = [
    // The local part is bounded (64 is the RFC limit): unbounded, the class
    // scanned to the end of every long token run and made the pass quadratic.
    { pattern: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, placeholder: '[REDACTED_EMAIL]' },
    // Lookbehind/lookahead reject word-character and hyphen neighbours so the
    // digit runs inside identifiers (`f0418644027c`) aren't misclassified as
    // phone numbers.
    { pattern: /(?<![\w-])(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?![\w-])/g, placeholder: '[REDACTED_PHONE]' },
  ];

  // Generic fallback for secrets no provider pattern knows. A secret is a
  // random string and a random string of 32+ characters carries digits;
  // human-written identifiers of that length carry none or a version/index
  // number (`predefinedCredentialType`, `n8n-auto-generated-fromAI-override`,
  // `users-current-day-1-minute-before-midnight`). The former 20-31 character
  // fallback and the digit-free 32+ match redacted such identifiers and left
  // most telemetry workflows invalid (n8n-mcp-backend#151). Two shapes:
  // - a run of letters and digits only (base64/base62 keys) with any digit;
  // - a run that also has '-' or '_' (slugs and model names such as
  //   `llama-4-maverick-17b-128e-instruct` live here) with three digits and
  //   both upper- and lower-case letters. Each digit must lie within 64
  //   characters of the previous so the lookahead stays linear.
  // The negative lookahead keeps existing placeholders intact so sanitization
  // is idempotent.
  private static readonly OPAQUE_TOKEN_PATTERNS = [
    /\b(?!REDACTED)(?=(?:[A-Za-z_-]{0,64}\d){3})(?=[^A-Z]{0,64}[A-Z])(?=[^a-z]{0,64}[a-z])[A-Za-z0-9_-]{32,}\b/g,
    /\b(?!REDACTED)(?=[A-Za-z]{0,64}\d)[A-Za-z0-9]{32,}\b/g,
  ];

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
    'pwd',
    'passphrase',
    'authorization',
    'credentials',
    'cookie',
    'cookies',
    'certificate',
  ]);

  // Keys that are secrets only as a whole: `credential` as a word would also
  // match the enum key `nodeCredentialType`. `auth` is a secret as the last
  // word (`basicAuth`, `X-Auth`) but not inside `genericAuthType`.
  private static readonly SECRET_KEYS = new Set(['credential', 'jwt']);

  // A key ending in one of these counts or sizes something (`maxTokenLimit`,
  // `token_length`, `passwordLength`) rather than holding it.
  private static readonly COUNT_WORDS = new Set(['limit', 'length', 'count', 'size', 'budget', 'usage']);

  // Compound names matched against the key with its separators removed. This
  // also covers all-caps keys (`ACCESSTOKEN`) that the word splitter cannot
  // segment.
  private static readonly SECRET_KEY_COMPOUNDS = [
    'apikey',
    'apitoken',
    'accesstoken',
    'refreshtoken',
    'clientsecret',
    'secretkey',
    'authkey',
    'authvalue',
    'privatekey',
    'publickey',
    'accesskey',
    'sshkey',
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

  // Keys naming a URL, endpoint or webhook.
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

    this.sanitizeGraph(sanitized);

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
   * Sanitize workflow diff operations before telemetry storage. Free-text
   * fields (operation and group descriptions, node notes) are removed; the
   * rest goes through {@link sanitizeTelemetryObject}.
   */
  static sanitizeOperations<T = any>(operations: any, workflows: any[] = []): T {
    if (!Array.isArray(operations)) {
      return this.sanitizeTelemetryObject<T>(operations);
    }
    const types = this.nodeTypesByKey(workflows);
    // The diff engine applies addNode operations before the others, so every
    // added node is known before any edit is classified.
    for (const op of operations) {
      if (op && typeof op === 'object' && op.node && typeof op.node === 'object' && !Array.isArray(op.node)) {
        this.recordNodeType(types, op.node.id, op.node.name, op.node.type);
      }
    }
    const isContentPath = (path: unknown) =>
      typeof path === 'string' && (path === 'parameters.content' || path.startsWith('parameters.content.'));
    // Content edits are kept only when every node the target could resolve to
    // is known not to be a sticky note; an unknown target counts as sticky.
    const targetTypes = (op: any): Set<unknown> => {
      const found = new Set<unknown>();
      const keys = [];
      if (typeof op.nodeId === 'string') keys.push(`id:${op.nodeId}`, this.nodeKey(op.nodeId));
      if (typeof op.nodeName === 'string') keys.push(this.nodeKey(op.nodeName));
      for (const key of keys) for (const type of types.get(key) ?? []) found.add(type);
      return found;
    };
    // A batch that changes a node type, or renames through a patch, makes
    // target types uncertain; every content edit in it is then removed.
    const uncertain = operations.some((op: any) => {
      if (!op || typeof op !== 'object') return false;
      const updates = op.updates;
      if (updates && typeof updates === 'object' && !Array.isArray(updates) &&
          Object.keys(updates).some((key) => key === 'type' || key.startsWith('type.'))) {
        return true;
      }
      return op.type === 'patchNodeField' && (op.fieldPath === 'type' || op.fieldPath === 'name');
    });
    const stripped = operations.map((op: any) => {
      if (!op || typeof op !== 'object' || Array.isArray(op)) {
        return op;
      }
      const { description, ...rest } = op;
      const resolved = targetTypes(rest);
      const targetsSticky = uncertain || resolved.size === 0 || [...resolved].some((type) => !this.isKnownNonSticky(type));
      if (rest.updates && typeof rest.updates === 'object' && !Array.isArray(rest.updates) && typeof rest.updates.name === 'string') {
        for (const type of resolved.size > 0 ? resolved : [undefined]) this.recordNodeType(types, undefined, rest.updates.name, type);
      }
      if (rest.node && typeof rest.node === 'object' && !Array.isArray(rest.node)) {
        const { notes, ...node } = rest.node;
        this.recordNodeType(types, node.id, node.name, node.type);
        if (this.isStickyType(node.type)) {
          node.parameters = this.withoutContent(node.parameters);
        }
        rest.node = node;
      }
      if (rest.updates && typeof rest.updates === 'object' && !Array.isArray(rest.updates)) {
        const { notes, ...updates } = rest.updates;
        if (targetsSticky) {
          for (const key of Object.keys(updates)) {
            if (isContentPath(key)) delete updates[key];
          }
          if (updates.parameters !== undefined) {
            updates.parameters = this.withoutContent(updates.parameters);
          }
        }
        rest.updates = updates;
      }
      if (rest.type === 'patchNodeField' && (rest.fieldPath === 'notes' || (targetsSticky && isContentPath(rest.fieldPath)))) {
        delete rest.patches;
      }
      if (Array.isArray(rest.nodeGroups)) {
        rest.nodeGroups = this.stripGroupDescriptions(rest.nodeGroups);
      }
      if (rest.settings && typeof rest.settings === 'object' && !Array.isArray(rest.settings)) {
        const { errorWorkflow, ...settings } = rest.settings;
        rest.settings = settings;
      }
      return rest;
    });
    return this.sanitizeTelemetryObject<T>(stripped);
  }

  private static stripGroupDescriptions(groups: any[]): any[] {
    return groups.map((group: any) => {
      if (!group || typeof group !== 'object' || Array.isArray(group)) {
        return group;
      }
      const { description, ...kept } = group;
      return kept;
    });
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
    if (!node || typeof node !== 'object') {
      return node;
    }

    // SECURITY (GHSA-gg57-wj7g-vfrv): notes are free text, removed entirely;
    // fields other than the structural ones are sanitized.
    const { id, name, type, typeVersion, position, parameters, credentials, notes, ...rest } = node;
    const sanitized: WorkflowNode = { ...this.sanitizeObject(rest), id, name, type, position } as WorkflowNode;
    if (typeVersion !== undefined) sanitized.typeVersion = typeVersion;

    // Sanitize parameters
    if (parameters) {
      sanitized.parameters = this.sanitizeObject(
        this.isStickyType(type) ? this.withoutContent(parameters) : parameters
      );
    } else if (parameters !== undefined) {
      sanitized.parameters = parameters;
    }

    return sanitized;
  }

  private static isStickyType(type: unknown): boolean {
    return typeof type === 'string' && /stickynote$/i.test(type);
  }

  private static isKnownNonSticky(type: unknown): boolean {
    return typeof type === 'string' && !this.isStickyType(type);
  }

  /** Sticky-note text is free text and is removed. */
  private static withoutContent(parameters: any): any {
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
      return parameters;
    }
    const { content, ...rest } = parameters;
    return rest;
  }

  /** Loose name key: matching more than the diff engine does only removes more. */
  private static nodeKey(name: string): string {
    return `name:${name.replace(/\\/g, '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
  }

  /** Node types known for each id/name key in the given workflows. */
  private static nodeTypesByKey(workflows: any[]): Map<string, Set<unknown>> {
    const types = new Map<string, Set<unknown>>();
    for (const workflow of workflows) {
      if (!workflow || !Array.isArray(workflow.nodes)) continue;
      for (const node of workflow.nodes) {
        if (node && typeof node === 'object') this.recordNodeType(types, node.id, node.name, node.type);
      }
    }
    return types;
  }

  private static recordNodeType(types: Map<string, Set<unknown>>, id: unknown, name: unknown, type: unknown): void {
    const keys = [];
    if (typeof id === 'string') keys.push(`id:${id}`, this.nodeKey(id));
    if (typeof name === 'string') keys.push(this.nodeKey(name));
    for (const key of keys) {
      if (!types.has(key)) types.set(key, new Set());
      types.get(key)!.add(type);
    }
  }

  /**
   * SECURITY (GHSA-gg57-wj7g-vfrv): sanitize nodes and connections in place.
   * Node names are sanitized through one map so connection keys and targets
   * keep pointing at the same nodes.
   */
  private static sanitizeGraph(workflow: any): void {
    if (Array.isArray(workflow.nodes)) {
      workflow.nodes = workflow.nodes.map((node: WorkflowNode) => {
        const sanitized = this.sanitizeNode(node);
        if (sanitized && typeof sanitized.name === 'string') {
          sanitized.name = this.sanitizeNodeName(sanitized.name);
        }
        return sanitized;
      });
    } else if (workflow.nodes !== undefined) {
      workflow.nodes = this.sanitizeTelemetryObject(workflow.nodes);
    }

    if (workflow.connections !== undefined) {
      workflow.connections = this.sanitizeConnections(workflow.connections);
    }
  }

  /**
   * SECURITY (GHSA-gg57-wj7g-vfrv): a name that needed redaction gets a short
   * suffix derived from the original, so distinct nodes stay distinct and the
   * same node gets the same name in every snapshot.
   */
  private static sanitizeNodeName(name: string): string {
    const sanitized = this.sanitizeString(name);
    if (sanitized === name) {
      return name;
    }
    return `${sanitized} #${createHash('sha256').update(name).digest('hex').substring(0, 8)}`;
  }

  /**
   * Recursively sanitize an object
   */
  private static sanitizeObject(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => (typeof item === 'string' ? this.sanitizeString(item) : this.sanitizeObject(item)));
    }

    const sanitized: any = {};

    // n8n stores header, query and body parameters as `{ name, value }` pairs
    // (Set-node assignments too) and diff operations as `{ field, value }`,
    // so a `value` inherits the classification of its sibling `name` or
    // `field`: `{ name: 'X-API-Key', value }` is a secret even though neither
    // key says so.
    const sibling = [obj.name, obj.field].find((v) => typeof v === 'string') as string | undefined;
    // A resource locator's `value` is the id of a sheet, page or channel: an
    // identifier the workflow needs, not a secret. In `url` mode it is a URL
    // and is treated like one.
    const resourceLocatorMode = obj.__rl === true && typeof obj.mode === 'string' ? obj.mode : undefined;

    for (const [key, value] of Object.entries(obj)) {
      let kind = this.classifyKey(key);
      if (kind === 'none' && key === 'value') {
        if (resourceLocatorMode === 'url') {
          kind = 'url';
        } else if (sibling !== undefined) {
          kind = this.classifyKey(sibling);
        }
      }

      // SECURITY (GHSA-f3rg-xqjj-cj9w): URL-like fields (url, endpoint, webhook)
      // are fully redacted rather than partially sanitized, because preserving
      // the path or query string leaks customer IDs, tenant identifiers, signed
      // request parameters, and tokens shorter than the generic-token threshold.
      // Numbers, booleans and null under such keys are flags and counts
      // (`previewUrl: false`, `token_length: 500`), not secrets, and keep
      // their type; strings, arrays and objects are redacted.
      if (kind === 'url') {
        sanitized[key] = this.redactUrlValue(value);
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
        const isResourceLocatorId = resourceLocatorMode !== undefined && key === 'value';
        sanitized[key] = this.sanitizeString(value, !isResourceLocatorId);
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
    // NUL never occurs in workflow JSON and would collide with the UUID shield.
    let sanitized = this.applyPatterns(value.replace(/\u0000/g, ''), this.SENSITIVE_PATTERNS);

    // Shield the UUIDs that survived the secret patterns; restored at the end.
    const uuids: string[] = [];
    sanitized = sanitized.replace(this.UUID_PATTERN, (uuid) => {
      uuids.push(uuid);
      return `\u0000uuid${uuids.length - 1}\u0000`;
    });

    sanitized = this.applyPatterns(sanitized, this.PII_PATTERNS);

    // Both fallbacks need a digit; skipping digit-free strings keeps the
    // fallback off long prose and code that cannot contain a match.
    if (redactOpaqueTokens && /\d/.test(sanitized)) {
      for (const pattern of this.OPAQUE_TOKEN_PATTERNS) {
        sanitized = sanitized.replace(pattern, '[REDACTED_TOKEN]');
      }
    }

    return uuids.length === 0
      ? sanitized
      : sanitized.replace(this.UUID_SHIELD, (marker, index) => uuids[Number(index)] ?? marker);
  }

  private static applyPatterns(value: string, patterns: PatternDefinition[]): string {
    let result = value;
    for (const { pattern, placeholder } of patterns) {
      result = result.replace(pattern, placeholder);
    }
    return result;
  }

  private static redactSecret(value: unknown): unknown {
    if (typeof value !== 'string' && typeof value !== 'object') {
      return value;
    }
    const scheme = typeof value === 'string' ? value.match(this.AUTH_SCHEME_PREFIX) : null;
    return scheme ? `${scheme[1]} [REDACTED]` : '[REDACTED]';
  }

  // Keeps the shape of a URL-named value (`urls: ['...']`, `{ url, method }`)
  // and redacts every string in it.
  private static redactUrlValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return '[REDACTED_URL]';
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.redactUrlValue(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.redactUrlValue(v)]));
    }
    return value;
  }

  /**
   * Classify a key by its words: 'url' and 'secret' keys are redacted whole
   * (see sanitizeObject), 'none' leaves the value to the pattern sanitizer.
   */
  private static classifyKey(key: string): 'url' | 'secret' | 'none' {
    const words = key
      // `URLs` is the acronym plus a plural, not `UR` + `Ls`.
      .replace(/([A-Z]{2,})s(?![a-z])/g, '$1S')
      .split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[^A-Za-z0-9]+/)
      // `url2`, `token1`: a trailing number does not change the word.
      .map((word) => word.toLowerCase().replace(/\d+$/, ''))
      .filter(Boolean);
    const joined = words.join('');
    const last = words[words.length - 1];

    // `webhookId`, `databaseId`, `apiKeyId`: an identifier the workflow needs,
    // not the URL, host or secret the other words suggest. `maxTokenLimit`,
    // `passwordLength`: a number about a secret, not the secret.
    if (last === 'id' || this.COUNT_WORDS.has(last)) {
      return 'none';
    }
    // A URL that also names a secret (`accessTokenUrl`, `authorizationUrl`)
    // is an endpoint and keeps the URL placeholder.
    if (words.some((word) => this.URL_KEY_WORDS.has(word))) {
      return 'url';
    }
    if (
      last === 'auth' ||
      this.SECRET_KEYS.has(joined) ||
      words.some((word) => this.SECRET_KEY_WORDS.has(word) || this.TOPOLOGY_KEY_WORDS.has(word)) ||
      this.SECRET_KEY_COMPOUNDS.some((compound) => joined.includes(compound))
    ) {
      return 'secret';
    }
    return 'none';
  }

  /**
   * Sanitize connections (keep structure only)
   */
  private static sanitizeConnections(connections: any): any {
    if (!connections || typeof connections !== 'object' || Array.isArray(connections)) {
      return this.sanitizeTelemetryObject(connections);
    }

    // SECURITY (GHSA-gg57-wj7g-vfrv): node names are renamed with the same
    // function as the nodes; unexpected shapes are sanitized as data.
    const sanitized: any = {};

    for (const [sourceName, nodeConnections] of Object.entries(connections)) {
      const nodeId = this.sanitizeNodeName(sourceName);
      if (typeof nodeConnections === 'object' && nodeConnections !== null && !Array.isArray(nodeConnections)) {
        sanitized[nodeId] = {};

        for (const [connType, connArray] of Object.entries(nodeConnections as any)) {
          if (Array.isArray(connArray)) {
            sanitized[nodeId][connType] = connArray.map((conns: any) => {
              if (Array.isArray(conns)) {
                return conns.map((conn: any) =>
                  conn && typeof conn === 'object'
                    ? {
                        node: typeof conn.node === 'string' ? this.sanitizeNodeName(conn.node) : conn.node,
                        type: conn.type,
                        index: conn.index
                      }
                    : this.sanitizeTelemetryObject(conn)
                );
              }
              return this.sanitizeTelemetryObject(conns);
            });
          } else {
            sanitized[nodeId][connType] = this.sanitizeTelemetryObject(connArray);
          }
        }
      } else {
        sanitized[nodeId] = this.sanitizeTelemetryObject(nodeConnections);
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

    this.sanitizeGraph(sanitized);

    // Remove other potentially sensitive data
    delete sanitized.settings?.errorWorkflow;
    delete sanitized.staticData;
    delete sanitized.pinData;
    delete sanitized.credentials;
    delete sanitized.sharedWorkflows;
    delete sanitized.ownedBy;
    delete sanitized.createdBy;
    delete sanitized.updatedBy;
    // SECURITY (GHSA-gg57-wj7g-vfrv)
    delete sanitized.description;
    delete sanitized.shared;
    delete sanitized.homeProject;
    if (Array.isArray(sanitized.nodeGroups)) {
      sanitized.nodeGroups = this.stripGroupDescriptions(sanitized.nodeGroups);
    }

    // SECURITY (GHSA-gg57-wj7g-vfrv): sanitize every other field; nested
    // workflow versions get the full workflow pass.
    const isWorkflowLike = (value: unknown) =>
      !!value && typeof value === 'object' && Array.isArray((value as any).nodes);
    const { nodes, connections, ...rest } = sanitized;
    const others: any = {};
    for (const [key, value] of Object.entries(rest)) {
      if (isWorkflowLike(value)) {
        sanitized[key] = this.sanitizeWorkflowRaw(value);
      } else if (Array.isArray(value) && value.some(isWorkflowLike)) {
        sanitized[key] = value.map((item) =>
          isWorkflowLike(item) ? this.sanitizeWorkflowRaw(item) : this.sanitizeTelemetryObject(item)
        );
      } else {
        others[key] = value;
      }
    }
    Object.assign(sanitized, this.sanitizeObject(others));

    return sanitized;
  }
}