/**
 * Workflow Sanitizer
 * Removes sensitive data from workflows before telemetry storage
 */

import { createHash } from 'crypto';
import { redactEmailAddresses } from './email-redaction';

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
  placeholder: string | ((match: string) => string);
  // Skip the pattern when the string does not contain this text.
  requires?: string;
}

export class WorkflowSanitizer {
  // SECURITY (GHSA-68rj-xv59-f2ch): end-of-key matching.
  private static readonly SENSITIVE_PATTERNS: PatternDefinition[] = [
    // Webhook URLs (replace with placeholder but keep structure) - MUST BE FIRST.
    // The URL stops at whitespace, quotes and brackets so a webhook URL inside
    // code or prose is redacted in place without eating the surrounding syntax.
    // SECURITY (GHSA-xvxq-x6hr-xc2c): match the URL, then test its path.
    {
      pattern: /https?:\/\/[^\s"'`<>(){}\[\],;]*/gi,
      placeholder: (url) => (WorkflowSanitizer.WEBHOOK_PATH.test(url.replace(/^https?:\/\//i, '')) ? '[REDACTED_WEBHOOK]' : url),
    },
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
    // SECURITY (GHSA-xvxq-x6hr-xc2c): find JWTs within dotted tokens.
    { pattern: /[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g, placeholder: (token) => WorkflowSanitizer.redactJwts(token), requires: 'eyJ' },

    // Supabase secret and publishable keys
    { pattern: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_])/g, placeholder: '[REDACTED_SUPABASE_KEY]' },

    // OpenAI / OpenRouter — sk-proj- and sk-or- BEFORE the generic sk- below
    { pattern: /\bsk-proj-[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_])/g, placeholder: '[REDACTED_LLM_API_KEY]' },
    { pattern: /\bsk-or-(?:v1-)?[A-Za-z0-9-]{40,}(?![A-Za-z0-9_])/g, placeholder: '[REDACTED_LLM_API_KEY]' },

    // Stripe (sk_test/live, rk_test/live)
    { pattern: /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{24,}\b/g, placeholder: '[REDACTED_STRIPE_KEY]' },

    // GitHub PATs (fine-grained + classic)
    { pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bghp_[A-Za-z0-9]{36,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },

    // GitLab PAT
    { pattern: /\bglpat-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_])/g, placeholder: '[REDACTED_API_TOKEN]' },

    // Hugging Face, Notion, GoHighLevel, Slack
    { pattern: /\bhf_[A-Za-z0-9]{30,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bntn_[A-Za-z0-9]{40,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bpit-[a-f0-9-]{36}(?![A-Za-z0-9_])/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bxox[bpaors]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9_])/g, placeholder: '[REDACTED_API_TOKEN]' },

    // AWS access key id
    { pattern: /\bAKIA[A-Z0-9]{16}\b/g, placeholder: '[REDACTED_API_TOKEN]' },

    // Prefixed keys whose bodies can carry too few digits for the generic
    // fallback: Google API keys and OAuth client secrets, SendGrid, Anthropic,
    // Shopify.
    { pattern: /\bAIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_])/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bGOCSPX-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_])/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_])/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_])/g, placeholder: '[REDACTED_LLM_API_KEY]' },
    { pattern: /\bshpat_[a-f0-9]{32}\b/g, placeholder: '[REDACTED_API_TOKEN]' },

    // Generic OpenAI sk- (unchanged regex; placeholder upgraded to type-aware)
    { pattern: /\bsk-[A-Za-z0-9]{16,}\b/g, placeholder: '[REDACTED_LLM_API_KEY]' },
  ];

  // PII in free-text node parameters. Applied after UUIDs are shielded: the
  // phone pattern would otherwise match the digit runs inside hex ids.
  // Emails are redacted first, by redactEmailAddresses.
  private static readonly PII_PATTERNS: PatternDefinition[] = [
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
    /\b(?!REDACTED)(?=(?:[A-Za-z_-]{0,64}\d){3})(?=[^A-Z]{0,64}[A-Z])(?=[^a-z]{0,64}[a-z])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_])/g,
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

  // Webhook path inside a URL with its scheme removed.
  private static readonly WEBHOOK_PATH = /\/webhook(?:s|-test)?\/./i;

  // Last words of a `{ name, value }` parameter name that hold a secret
  // (`X-Amz-Signature`, `Ocp-Apim-Subscription-Key`); `code` only as the whole
  // name, since `countryCode` and `statusCode` are data.
  private static readonly SECRET_PARAM_LAST_WORDS = new Set(['key', 'sig', 'signature']);
  private static readonly SECRET_PARAM_NAMES = new Set(['code']);

  // SECURITY (GHSA-xvxq-x6hr-xc2c): bound input sizes.
  private static readonly MAX_STRING_LENGTH = 100_000;
  private static readonly MAX_KEY_LENGTH = 256;
  private static readonly MAX_NESTED_WORKFLOW_DEPTH = 3;
  private static readonly MAX_JSON_DEPTH = 4;
  private static readonly MAX_JSON_WORK = 1_000_000;
  private static readonly MAX_JSON_NESTING = 64;
  private static jsonDepth = 0;
  private static jsonBudget = 0;

  private static readonly EMAIL_DOMAIN = /[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/y;

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
    // SECURITY (GHSA-xvxq-x6hr-xc2c): one sticky flag per key.
    const kinds = this.nodeKindsByKey(workflows);
    // The diff engine applies addNode operations before the others, so every
    // added node is known before any edit is classified.
    for (const op of operations) {
      if (op && typeof op === 'object' && op.node && typeof op.node === 'object' && !Array.isArray(op.node)) {
        this.recordNodeKind(kinds, op.node.id, op.node.name, !this.isKnownNonSticky(op.node.type));
      }
    }
    const isContentPath = (path: unknown) =>
      typeof path === 'string' && (path === 'parameters.content' || path.startsWith('parameters.content.'));
    // Content edits are kept only when every node the target could resolve to
    // is known not to be a sticky note; an unknown target counts as sticky.
    // Returns undefined when no node is known for the target, otherwise
    // whether any known node may be a sticky note.
    const targetMaySticky = (op: any): boolean | undefined => {
      let found: boolean | undefined;
      const keys = [];
      if (typeof op.nodeId === 'string') keys.push(`id:${op.nodeId}`, this.nodeKey(op.nodeId));
      if (typeof op.nodeName === 'string') keys.push(this.nodeKey(op.nodeName));
      for (const key of keys) {
        const kind = kinds.get(key);
        if (kind !== undefined) found = found === true || kind;
      }
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
      const resolved = targetMaySticky(rest);
      const targetsSticky = uncertain || resolved !== false;
      if (rest.updates && typeof rest.updates === 'object' && !Array.isArray(rest.updates) && typeof rest.updates.name === 'string') {
        this.recordNodeKind(kinds, undefined, rest.updates.name, resolved !== false);
      }
      if (rest.node && typeof rest.node === 'object' && !Array.isArray(rest.node)) {
        const { notes, ...node } = rest.node;
        this.recordNodeKind(kinds, node.id, node.name, !this.isKnownNonSticky(node.type));
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

  /**
   * For each id/name key in the given workflows: whether any node known under
   * it may be a sticky note (its type is not a known non-sticky type).
   */
  private static nodeKindsByKey(workflows: any[]): Map<string, boolean> {
    const kinds = new Map<string, boolean>();
    for (const workflow of workflows) {
      if (!workflow || !Array.isArray(workflow.nodes)) continue;
      for (const node of workflow.nodes) {
        if (node && typeof node === 'object') this.recordNodeKind(kinds, node.id, node.name, !this.isKnownNonSticky(node.type));
      }
    }
    return kinds;
  }

  private static recordNodeKind(kinds: Map<string, boolean>, id: unknown, name: unknown, maySticky: boolean): void {
    const keys = [];
    if (typeof id === 'string') keys.push(`id:${id}`, this.nodeKey(id));
    if (typeof name === 'string') keys.push(this.nodeKey(name));
    for (const key of keys) {
      kinds.set(key, kinds.get(key) === true || maySticky);
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
  static sanitizeNodeName(name: string): string {
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
          kind = this.classifyParamName(sibling);
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
    if (value.length > this.MAX_STRING_LENGTH) {
      return '[REDACTED_LONG_STRING]';
    }
    const structured = this.sanitizeJsonText(value);
    if (structured === undefined) {
      return this.sanitizeText(value, redactOpaqueTokens);
    }
    if (structured.length > this.MAX_STRING_LENGTH) {
      return '[REDACTED_LONG_STRING]';
    }
    // Keep the original formatting when the text patterns give the same JSON.
    const fromStructure = this.sanitizeText(structured, redactOpaqueTokens);
    const fromText = this.sanitizeText(value, redactOpaqueTokens);
    return this.sameJson(fromText, fromStructure) ? fromText : fromStructure;
  }

  /** Whether two JSON texts (optionally `=`-prefixed) hold the same value. */
  private static sameJson(a: string, b: string): boolean {
    if (a.startsWith('=') !== b.startsWith('=')) return false;
    try {
      const parse = (text: string) => JSON.stringify(JSON.parse(text.startsWith('=') ? text.slice(1) : text));
      return parse(a) === parse(b);
    } catch {
      return false;
    }
  }

  /**
   * SECURITY (GHSA-rqgx-cvr7-hc6x): a string holding a JSON object or array
   * (optionally after the `=` expression prefix) is parsed and sanitized with
   * the object rules. Returns the compact re-serialized text; undefined when
   * the string is not JSON or nothing changed; `[REDACTED_NESTED_JSON]` when
   * it is JSON beyond the depth or size budget.
   */
  private static sanitizeJsonText(value: string): string | undefined {
    const prefix = value.startsWith('=') ? '=' : '';
    const body = prefix ? value.slice(1) : value;
    const trimmed = body.trim();
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) {
      return undefined;
    }
    if (this.jsonDepth === 0) {
      this.jsonBudget = this.MAX_JSON_WORK;
    }
    if (body.length > this.jsonBudget) {
      return prefix + '[REDACTED_NESTED_JSON]';
    }
    this.jsonBudget -= body.length;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return undefined;
    }
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    if (this.jsonDepth >= this.MAX_JSON_DEPTH || this.jsonNesting(body) > this.MAX_JSON_NESTING) {
      return prefix + '[REDACTED_NESTED_JSON]';
    }
    this.jsonDepth++;
    try {
      const sanitized = this.sanitizeObject(parsed);
      const output = JSON.stringify(sanitized);
      return output === JSON.stringify(parsed) ? undefined : prefix + output;
    } finally {
      this.jsonDepth--;
    }
  }

  /** Deepest bracket nesting in JSON text, counting only up to the limit plus one. */
  private static jsonNesting(text: string): number {
    let depth = 0;
    let max = 0;
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') {
        inString = true;
      } else if (c === '{' || c === '[') {
        depth++;
        if (depth > max) {
          max = depth;
          if (max > this.MAX_JSON_NESTING) return max;
        }
      } else if (c === '}' || c === ']') {
        depth--;
      }
    }
    return max;
  }

  /** Pattern-based sanitization of one string. */
  private static sanitizeText(value: string, redactOpaqueTokens: boolean): string {
    // NUL never occurs in workflow JSON and would collide with the UUID shield.
    let sanitized = this.applyPatterns(
      this.redactKeyedLiterals(value.replace(/\u0000/g, '')),
      this.SENSITIVE_PATTERNS
    );

    // Shield the UUIDs that survived the secret patterns; restored at the end.
    const uuids: string[] = [];
    sanitized = sanitized.replace(this.UUID_PATTERN, (uuid) => {
      uuids.push(uuid);
      return `\u0000uuid${uuids.length - 1}\u0000`;
    });

    sanitized = this.applyPatterns(redactEmailAddresses(sanitized, this.EMAIL_DOMAIN, '[REDACTED_EMAIL]'), this.PII_PATTERNS);

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
    for (const { pattern, placeholder, requires } of patterns) {
      if (requires !== undefined && !result.includes(requires)) continue;
      result = typeof placeholder === 'string'
        ? result.replace(pattern, placeholder)
        : result.replace(pattern, placeholder);
    }
    return result;
  }

  /**
   * Redact JWTs (`eyJ...` and two more base64url segments of 10+ characters)
   * inside one dot-joined token.
   */
  private static redactJwts(token: string): string {
    if (!token.includes('eyJ')) return token;
    const runs = token.split('.');
    const out: string[] = [];
    let i = 0;
    while (i < runs.length) {
      const run = runs[i];
      const start = this.jwtStart(run);
      const third = i + 2 < runs.length ? runs[i + 2] : undefined;
      const thirdEnd = third === undefined ? -1 : this.lastWordCharEnd(third);
      if (start >= 0 && run.length - start - 3 >= 10 && third !== undefined &&
          runs[i + 1].length >= 10 && thirdEnd >= 10) {
        out.push(run.slice(0, start) + '[REDACTED_JWT]' + third.slice(thirdEnd));
        i += 3;
      } else {
        out.push(run);
        i += 1;
      }
    }
    return out.join('.');
  }

  /** First `eyJ` in a base64url run that starts at a word boundary, or -1. */
  private static jwtStart(run: string): number {
    for (let at = run.indexOf('eyJ'); at >= 0; at = run.indexOf('eyJ', at + 1)) {
      if (at === 0 || run[at - 1] === '-') return at;
    }
    return -1;
  }

  /** Length of the run up to and including its last word character. */
  private static lastWordCharEnd(run: string): number {
    let end = run.length;
    while (end > 0 && run[end - 1] === '-') end--;
    return end;
  }

  /**
   * SECURITY (GHSA-rqgx-cvr7-hc6x): redact quoted values under secret keys in
   * serialized text (`"X-API-Key": "..."` in JSON, `apiKey: '...'` or
   * `password = "..."` in code).
   */
  private static redactKeyedLiterals(text: string): string {
    if (!/["']/.test(text) || !/[:=]/.test(text)) return text;
    const n = text.length;
    // Next unescaped double quote, single quote and line break at or after each index.
    const nextDouble = new Int32Array(n + 1).fill(n);
    const nextSingle = new Int32Array(n + 1).fill(n);
    const nextBreak = new Int32Array(n + 1).fill(n);
    const escaped = new Uint8Array(n);
    for (let j = 0, backslashes = 0; j < n; j++) {
      escaped[j] = backslashes % 2;
      backslashes = text.charCodeAt(j) === 92 ? backslashes + 1 : 0;
    }
    for (let j = n - 1; j >= 0; j--) {
      const c = text[j];
      nextDouble[j] = c === '"' && !escaped[j] ? j : nextDouble[j + 1];
      nextSingle[j] = c === "'" && !escaped[j] ? j : nextSingle[j + 1];
      nextBreak[j] = c === '\n' || c === '\r' ? j : nextBreak[j + 1];
    }

    const parts: string[] = [];
    let copied = 0;
    let floor = 0;
    let previous: [number, number] | undefined;
    for (let i = 0; i < n; ) {
      const c = text[i];
      if (c !== '"' && c !== "'") { i++; continue; }
      const close = (c === '"' ? nextDouble : nextSingle)[i + 1];
      if (close >= n || close > nextBreak[i + 1]) { i++; continue; }
      const key = this.keyBefore(text, i, floor, previous);
      if (key !== undefined && this.classifyKey(key) === 'secret') {
        parts.push(text.slice(copied, i + 1), String(this.redactSecret(text.slice(i + 1, close))));
        copied = close;
      }
      previous = [i, close + 1];
      floor = close + 1;
      i = close + 1;
    }
    if (copied === 0) return text;
    parts.push(text.slice(copied));
    return parts.join('');
  }

  /**
   * The key a quoted value at `start` is assigned to: a quoted key or an
   * identifier followed by `:` or `=`. Looks back no further than `floor`,
   * the end of the previous quoted string.
   */
  private static keyBefore(text: string, start: number, floor: number, previous: [number, number] | undefined): string | undefined {
    const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
    let j = start - 1;
    while (j >= floor && isSpace(text[j])) j--;
    if (j < floor) return undefined;
    const separator = text[j];
    if (separator === '=') {
      const before = text[j - 1];
      if (j - 1 >= floor && (before === '=' || before === '!' || before === '<' || before === '>')) return undefined;
    } else if (separator !== ':') {
      return undefined;
    }
    j--;
    while (j >= floor && isSpace(text[j])) j--;
    if (previous !== undefined && j === previous[1] - 1 && j === floor - 1) {
      return text.slice(previous[0] + 1, previous[1] - 1);
    }
    const end = j + 1;
    while (j >= floor && end - j <= 64 && /[\w$.-]/.test(text[j])) j--;
    return end - j > 1 ? text.slice(j + 1, end) : undefined;
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
    // SECURITY (GHSA-xvxq-x6hr-xc2c): bound key length.
    if (key.length > this.MAX_KEY_LENGTH) {
      return 'secret';
    }
    const words = this.keyWords(key);
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

  /** Words of a key: camelCase, snake_case and kebab-case are split. */
  private static keyWords(key: string): string[] {
    return key
      // `URLs` is the acronym plus a plural, not `UR` + `Ls`.
      .replace(/(?<![A-Z])([A-Z]{2,})s(?![a-z])/g, '$1S')
      .split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[^A-Za-z0-9]+/)
      // `url2`, `token1`: a trailing number does not change the word.
      .map((word) => word.toLowerCase().replace(/(?<!\d)\d+$/, ''))
      .filter(Boolean);
  }

  /**
   * SECURITY (GHSA-rqgx-cvr7-hc6x): classify the `name` of a `{ name, value }`
   * parameter, which also covers names that hold a secret only in that role.
   */
  private static classifyParamName(name: string): 'url' | 'secret' | 'none' {
    const kind = this.classifyKey(name);
    if (kind !== 'none') return kind;
    const words = this.keyWords(name);
    const last = words[words.length - 1];
    if (last === undefined || this.COUNT_WORDS.has(last)) return 'none';
    return this.SECRET_PARAM_LAST_WORDS.has(last) || (words.length === 1 && this.SECRET_PARAM_NAMES.has(last))
      ? 'secret'
      : 'none';
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
    // SECURITY (GHSA-xvxq-x6hr-xc2c): nested versions are sanitized in place.
    return this.sanitizeWorkflowRawInPlace(JSON.parse(JSON.stringify(workflow)), 0);
  }

  private static sanitizeWorkflowRawInPlace(sanitized: any, depth: number): any {
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
    // SECURITY (GHSA-xvxq-x6hr-xc2c): bound nesting depth.
    const nested = (value: any) => depth < this.MAX_NESTED_WORKFLOW_DEPTH
      ? this.sanitizeWorkflowRawInPlace(value, depth + 1)
      : '[REDACTED_NESTED_WORKFLOW]';
    const { nodes, connections, ...rest } = sanitized;
    const others: any = {};
    for (const [key, value] of Object.entries(rest)) {
      if (isWorkflowLike(value)) {
        sanitized[key] = nested(value);
      } else if (Array.isArray(value) && value.some(isWorkflowLike)) {
        sanitized[key] = value.map((item) =>
          isWorkflowLike(item) ? nested(item) : this.sanitizeTelemetryObject(item)
        );
      } else {
        others[key] = value;
      }
    }
    Object.assign(sanitized, this.sanitizeObject(others));

    return sanitized;
  }
}