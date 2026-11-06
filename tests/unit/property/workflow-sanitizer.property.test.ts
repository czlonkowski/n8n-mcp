/**
 * Property-based tests for the telemetry WorkflowSanitizer
 * (src/telemetry/workflow-sanitizer.ts).
 *
 * Workflows are generated with a secret placed at a random location: deep in
 * node parameters (objects, arrays, `{ name, value }` pairs, JSON-in-a-string,
 * `=` expressions), in a node name (which connections then reference), in
 * node credentials, or in a workflow-level field. The secret sits in free text
 * between random delimiters under keys that do not name a secret, so the
 * value-pattern rules have to catch it, not the key rules.
 *
 * Secret-shaped strings are built at runtime from a prefix assembled by
 * concatenation and a random body, so no realistic-looking key is committed.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { WorkflowSanitizer } from '../../../src/telemetry/workflow-sanitizer';

const RUNS = { numRuns: 300 };

// ---------------------------------------------------------------------------
// Character sets and secret generators
// ---------------------------------------------------------------------------

const range = (from: string, to: string) =>
  Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(from.charCodeAt(0) + i));
const UPPER = range('A', 'Z');
const LOWER = range('a', 'z');
const DIGIT = range('0', '9');
const ALNUM = [...UPPER, ...LOWER, ...DIGIT];
const B64URL = [...ALNUM, '_', '-'];
const HEX = [...DIGIT, ...range('a', 'f')];

const str = (chars: string[], minLength: number, maxLength = minLength + 24) =>
  fc.string({ unit: fc.constantFrom(...chars), minLength, maxLength });

/**
 * A body over `chars` that ends in an alphanumeric, as real keys do and as the
 * trailing `\b` of the provider patterns requires.
 */
const body = (chars: string[], minLength: number) =>
  fc.tuple(str(chars, minLength - 1), fc.constantFrom(...ALNUM)).map(([a, b]) => a + b);

interface Secret {
  kind: string;
  /** The text placed in the workflow. */
  text: string;
  /** Secret material: no 16-character window of it may survive sanitization. */
  core: string;
}

interface Provider {
  kind: string;
  prefix: string;
  /** Alphabet of the key body. */
  chars: string[];
  /** Body length: the minimum, or the exact length when `exact`. */
  length: number;
  exact?: boolean;
}

/**
 * Provider key formats, each with a dedicated pattern in SENSITIVE_PATTERNS.
 * Lengths follow the issued formats (fixed-length ones are `exact`), not the
 * pattern minimums.
 */
const PROVIDERS: Provider[] = [
  { kind: 'openai-project', prefix: ['sk', 'proj', ''].join('-'), chars: B64URL, length: 120 },
  { kind: 'openrouter', prefix: ['sk', 'or', 'v1', ''].join('-'), chars: [...ALNUM, '-'], length: 40 },
  { kind: 'stripe', prefix: ['sk', 'live', ''].join('_'), chars: ALNUM, length: 24 },
  { kind: 'stripe-restricted', prefix: ['rk', 'test', ''].join('_'), chars: ALNUM, length: 24 },
  { kind: 'github-fine-grained', prefix: ['github', 'pat', ''].join('_'), chars: [...ALNUM, '_'], length: 50 },
  { kind: 'gitlab', prefix: ['gl', 'pat-'].join(''), chars: B64URL, length: 20, exact: true },
  { kind: 'github-classic', prefix: ['gh', 'p_'].join(''), chars: ALNUM, length: 36 },
  { kind: 'huggingface', prefix: ['hf', '_'].join(''), chars: ALNUM, length: 30 },
  { kind: 'notion', prefix: ['nt', 'n_'].join(''), chars: ALNUM, length: 40 },
  { kind: 'aws-access-key-id', prefix: ['AK', 'IA'].join(''), chars: [...UPPER, ...DIGIT], length: 16, exact: true },
  { kind: 'google-api-key', prefix: ['AI', 'za'].join(''), chars: B64URL, length: 35, exact: true },
  { kind: 'google-oauth-secret', prefix: ['GOC', 'SPX-'].join(''), chars: B64URL, length: 28, exact: true },
  { kind: 'anthropic', prefix: ['sk', 'ant', 'api03', ''].join('-'), chars: B64URL, length: 40 },
  { kind: 'shopify', prefix: ['sh', 'pat_'].join(''), chars: HEX, length: 32, exact: true },
  { kind: 'supabase-secret', prefix: ['sb', 'secret', ''].join('_'), chars: B64URL, length: 24 },
  { kind: 'openai-legacy', prefix: ['sk', ''].join('-'), chars: ALNUM, length: 32 },
];

/**
 * A provider key. Bodies are sometimes digit-free, so the provider pattern
 * has to match on its own (the generic fallback needs digits), and sometimes
 * end in a non-alphanumeric character of the provider's alphabet.
 */
const providerSecret = (p: Provider): fc.Arbitrary<Secret> =>
  fc.record({ digitFree: fc.boolean(), edgeEnd: fc.boolean() }).chain(({ digitFree, edgeEnd }) => {
    const chars = digitFree && p.chars.some((c) => !/\d/.test(c)) ? p.chars.filter((c) => !/\d/.test(c)) : p.chars;
    const specials = chars.filter((c) => !/[A-Za-z0-9]/.test(c));
    const last = edgeEnd && specials.length > 0 ? specials : chars.filter((c) => /[A-Za-z0-9]/.test(c));
    const head = p.exact ? str(chars, p.length - 1, p.length - 1) : str(chars, p.length - 1);
    return fc.tuple(head, fc.constantFrom(...last)).map(([h, l]) => ({ kind: p.kind, text: p.prefix + h + l, core: h + l }));
  });

const prefixed = (kind: string, prefix: string, bodyArb: fc.Arbitrary<string>): fc.Arbitrary<Secret> =>
  bodyArb.map((b) => ({ kind, text: prefix + b, core: b }));

const secretArb: fc.Arbitrary<Secret> = fc.oneof(
  ...PROVIDERS.map(providerSecret),
  prefixed('slack', ['xo', 'xb-'].join(''), fc.tuple(str(DIGIT, 10, 13), str(DIGIT, 10, 13), body(ALNUM, 24)).map((p) => p.join('-'))),
  fc.tuple(body(B64URL, 22), body(B64URL, 43)).map(([a, b]) => ({ kind: 'sendgrid', text: `${['S', 'G'].join('')}.${a}.${b}`, core: `${a}.${b}` })),
  prefixed('gohighlevel', ['pi', 't-'].join(''), fc.uuid()),
  // `Bearer <token>`: the token alphabet of RFC 6750 b64token.
  fc.tuple(fc.constantFrom('Bearer ', 'bearer ', 'Bearer  '), fc.constantFrom(...ALNUM), str([...B64URL, '.', '~', '+', '/'], 15, 60), fc.constantFrom('', '=', '=='))
    .map(([scheme, first, rest, pad]) => ({ kind: 'bearer', text: `${scheme}${first}${rest}${pad}`, core: first + rest })),
  // JWT: three base64url segments, header starting `eyJ`.
  fc.tuple(body(B64URL, 12), body(B64URL, 20), body(B64URL, 20))
    .map(([h, p, s]) => ({ kind: 'jwt', text: `eyJ${h}.${p}.${s}`, core: `${h}.${p}.${s}` })),
  // Credentials in a URL authority.
  fc.tuple(
    fc.constantFrom('http', 'https', 'wss', 'postgres', 'mysql', 'mongodb', 'redis'),
    str(LOWER, 3, 10),
    body(ALNUM, 16),
    fc.stringMatching(/^[a-z]{2,10}\.(com|net|io)$/),
    fc.stringMatching(/^(\/[a-z0-9]{1,8}){0,3}$/),
  ).map(([scheme, user, pass, host, path]) => ({ kind: `${scheme}-userinfo`, text: `${scheme}://${user}:${pass}@${host}${path}`, core: pass })),
  // Secret in a URL query string.
  fc.tuple(
    fc.stringMatching(/^[a-z]{2,10}\.(com|net|io)$/),
    fc.stringMatching(/^(\/[a-z0-9]{1,8}){0,3}$/),
    fc.option(fc.stringMatching(/^[a-z]{1,6}=[a-z0-9]{1,6}&$/), { nil: '' }),
    fc.constantFrom('access_token', 'api_key', 'apikey', 'api-key', 'token', 'key', 'secret', 'password', 'pwd', 'signature', 'sig', 'auth'),
    body(B64URL, 16),
  ).map(([host, path, before, param, value]) => ({ kind: `query-${param}`, text: `https://${host}${path}?${before}${param}=${value}`, core: value })),
);

/** `Basic base64(user:password)`; the pattern requires a digit (see SENSITIVE_PATTERNS). */
const basicAuthSecret: fc.Arbitrary<Secret> = fc
  .tuple(str(LOWER, 4, 10), body(ALNUM, 12))
  .map(([user, pass]) => Buffer.from(`${user}:${pass}`).toString('base64'))
  .filter((b64) => /\d/.test(b64))
  .map((b64) => ({ kind: 'basic', text: `Basic ${b64}`, core: b64.replace(/=+$/, '') }));

// ---------------------------------------------------------------------------
// Workflow generators
// ---------------------------------------------------------------------------

/**
 * Keys that classify as 'none', so the value is judged by its content alone.
 * Each is checked against the key classifier in the first test below.
 */
const NEUTRAL_KEYS = [
  'text', 'message', 'body', 'jsCode', 'options', 'values', 'fields', 'mode', 'operation',
  'query', 'html', 'systemMessage', 'prompt', 'expression', 'rules', 'conditions', 'items', 'extra',
];
const neutralKey = fc.constantFrom(...NEUTRAL_KEYS);

const word = fc.stringMatching(/^[a-z]{1,8}$/);
const prose = fc.array(word, { minLength: 0, maxLength: 5 }).map((w) => w.join(' '));
const DELIMITERS = [' ', '\n', '\t', '"', "'", '`', '(', ')', ',', ';', '<', '>', ': ', '= ', '[', ']', '{', '}'];
const delimiter = fc.constantFrom(...DELIMITERS);

const leaf = fc.oneof(prose, fc.integer(), fc.boolean(), fc.constant(null));
const paramTree = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    leaf,
    fc.array(tie('node'), { maxLength: 3 }),
    fc.dictionary(neutralKey, tie('node'), { maxKeys: 4 }),
  ),
})).node;

/** The secret inside a string, surrounded by prose and delimiters. */
const inText = (secret: Secret) =>
  fc.tuple(prose, delimiter, delimiter, prose).map(([pre, d1, d2, post]) => `${pre}${d1}${secret.text}${d2}${post}`);

type Wrap =
  | { kind: 'plain' }
  | { kind: 'json'; key: string; expr: boolean; array: boolean }
  | { kind: 'pair'; name: string };
const wrapArb: fc.Arbitrary<Wrap> = fc.oneof(
  fc.constant({ kind: 'plain' as const }),
  fc.record({ kind: fc.constant('json' as const), key: neutralKey, expr: fc.boolean(), array: fc.boolean() }),
  fc.record({ kind: fc.constant('pair' as const), name: word }),
);

const applyWrap = (text: string, wrap: Wrap): unknown => {
  switch (wrap.kind) {
    case 'plain': return text;
    case 'json': {
      const json = JSON.stringify(wrap.array ? [text] : { [wrap.key]: text });
      return wrap.expr ? `=${json}` : json;
    }
    case 'pair': return { name: wrap.name, value: text };
  }
};

type Step = { key: string } | { index: number };
const pathArb = fc.array(fc.oneof(neutralKey.map((key) => ({ key })), fc.nat(3).map((index) => ({ index }))), { maxLength: 4 });

const nest = (value: unknown, path: Step[]): unknown =>
  path.reduceRight<unknown>((inner, step) => {
    if ('key' in step) return { [step.key]: inner };
    const arr: unknown[] = Array.from({ length: step.index }, (_, i) => `item ${i}`);
    arr.push(inner);
    return arr;
  }, value);

type Location = 'parameters' | 'nodeName' | 'credentials' | 'workflowField';

interface Case {
  workflow: any;
  secret: Secret;
  location: Location;
}

const nodeTypes = fc.constantFrom('n8n-nodes-base.code', 'n8n-nodes-base.set', 'n8n-nodes-base.httpRequest', '@n8n/n8n-nodes-langchain.agent', 'n8n-nodes-base.if');

const baseNodes = fc.uniqueArray(
  fc.record({ id: fc.uuid(), name: prose.map((p) => `node ${p}`), type: nodeTypes, parameters: fc.dictionary(neutralKey, paramTree, { maxKeys: 4 }) }),
  { minLength: 1, maxLength: 4, selector: (n) => n.name },
);

const caseArb = (secrets: fc.Arbitrary<Secret>): fc.Arbitrary<Case> =>
  secrets.chain((secret) =>
    fc.record({
      nodes: baseNodes,
      at: fc.nat(),
      location: fc.constantFrom<Location>('parameters', 'parameters', 'parameters', 'nodeName', 'credentials', 'workflowField'),
      text: inText(secret),
      wrap: wrapArb,
      path: pathArb,
      injectKey: neutralKey,
    }).map(({ nodes, at, location, text, wrap, path, injectKey }) => {
      const target = at % nodes.length;
      const built = nodes.map((n, i) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        typeVersion: 1,
        position: [i * 200, 0] as [number, number],
        parameters: { ...n.parameters } as Record<string, unknown>,
      })) as any[];
      const workflow: any = { name: 'generated', nodes: built, connections: {}, settings: {} };
      const value = nest(applyWrap(text, wrap), path);
      switch (location) {
        case 'parameters':
          built[target].parameters[injectKey] = value;
          break;
        case 'nodeName':
          built[target].name = text;
          break;
        case 'credentials':
          built[target].credentials = { httpHeaderAuth: { id: '1', name: text } };
          break;
        case 'workflowField':
          workflow.meta = { [injectKey]: value };
          break;
      }
      // Chain the nodes by name so connections carry the names too.
      for (let i = 0; i + 1 < built.length; i++) {
        workflow.connections[built[i].name] = { main: [[{ node: built[i + 1].name, type: 'main', index: 0 }]] };
      }
      return { workflow, secret, location };
    }),
  );

// ---------------------------------------------------------------------------
// Leak check
// ---------------------------------------------------------------------------

const WINDOW = 16;
const windows = (core: string) => {
  if (core.length <= WINDOW) return [core];
  return Array.from({ length: core.length - WINDOW + 1 }, (_, i) => core.slice(i, i + WINDOW));
};

/** The first 16-character piece of the secret found in `serialized`, if any. */
const leakedPiece = (serialized: string, core: string) => windows(core).find((w) => serialized.includes(w));

/** Without the secret, no piece of it may occur, or a find would prove nothing. */
const secretOnlyFromInjection = (c: Case) => {
  const withoutSecret = JSON.stringify(c.workflow).split(c.secret.text).join('');
  return leakedPiece(withoutSecret, c.secret.core) === undefined;
};

const expectNoLeak = (output: unknown, c: Case) => {
  const serialized = JSON.stringify(output);
  const piece = leakedPiece(serialized, c.secret.core);
  expect(piece, `${c.secret.kind} at ${c.location} leaked "${piece}" in ${serialized}`).toBeUndefined();
};

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('WorkflowSanitizer properties', () => {
  it('neutral keys used by the generators leave a plain value untouched (generator sanity)', () => {
    // A secret under a key the classifier redacts would make the leak
    // properties pass without exercising the value patterns.
    for (const key of NEUTRAL_KEYS) {
      expect(WorkflowSanitizer.sanitizeTelemetryObject({ [key]: 'plain words' })).toEqual({ [key]: 'plain words' });
    }
  });

  it('sanitizeWorkflowRaw never lets a secret through, wherever it is placed', () => {
    fc.assert(fc.property(caseArb(fc.oneof(secretArb, basicAuthSecret)), (c) => {
      fc.pre(secretOnlyFromInjection(c));
      expectNoLeak(WorkflowSanitizer.sanitizeWorkflowRaw(c.workflow), c);
    }), RUNS);
  });

  it('sanitizeWorkflow never lets a secret through into nodes or connections', () => {
    fc.assert(fc.property(caseArb(fc.oneof(secretArb, basicAuthSecret)), (c) => {
      fc.pre(secretOnlyFromInjection(c));
      const out = WorkflowSanitizer.sanitizeWorkflow(c.workflow);
      expectNoLeak({ nodes: out.nodes, connections: out.connections }, c);
    }), RUNS);
  });

  it('sanitizeOperations never lets a secret through in diff operations', () => {
    fc.assert(fc.property(
      fc.oneof(secretArb, basicAuthSecret).chain((secret) => fc.tuple(fc.constant(secret), inText(secret), wrapArb, pathArb, neutralKey, word)),
      ([secret, text, wrap, path, key, nodeName]) => {
        const value = nest(applyWrap(text, wrap), path);
        const operations = [
          { type: 'updateNode', nodeName, updates: { [`parameters.${key}`]: value } },
          { type: 'addNode', node: { id: 'a', name: nodeName + 'x', type: 'n8n-nodes-base.set', position: [0, 0], parameters: { [key]: value } } },
          { type: 'patchNodeField', nodeName, fieldPath: `parameters.${key}`, patches: [{ find: 'x', replace: value }] },
        ];
        const c: Case = { workflow: operations, secret, location: 'parameters' };
        fc.pre(secretOnlyFromInjection(c));
        expectNoLeak(WorkflowSanitizer.sanitizeOperations(operations), c);
      },
    ), RUNS);
  });

  it('sanitizeWorkflowRaw is idempotent', () => {
    fc.assert(fc.property(caseArb(fc.oneof(secretArb, basicAuthSecret)), (c) => {
      const once = WorkflowSanitizer.sanitizeWorkflowRaw(c.workflow);
      const twice = WorkflowSanitizer.sanitizeWorkflowRaw(once);
      expect(twice).toEqual(once);
    }), RUNS);
  });

  it('sanitizeTelemetryObject is idempotent on arbitrary JSON values', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.jsonValue(),
        caseArb(fc.oneof(secretArb, basicAuthSecret)).map((c) => c.workflow.nodes),
      ),
      (value) => {
        const once = WorkflowSanitizer.sanitizeTelemetryObject(value);
        expect(WorkflowSanitizer.sanitizeTelemetryObject(once)).toEqual(once);
      },
    ), RUNS);
  });

  it('sanitizeWorkflowRaw does not modify its input', () => {
    fc.assert(fc.property(caseArb(secretArb), (c) => {
      const before = JSON.stringify(c.workflow);
      WorkflowSanitizer.sanitizeWorkflowRaw(c.workflow);
      expect(JSON.stringify(c.workflow)).toBe(before);
    }), { numRuns: 100 });
  });

  describe('each provider pattern redacts its keys on its own', () => {
    it.each(PROVIDERS.map((p) => [p.kind, p] as const))('%s', (_kind, provider) => {
      fc.assert(fc.property(caseArb(providerSecret(provider)), (c) => {
        fc.pre(secretOnlyFromInjection(c));
        expectNoLeak(WorkflowSanitizer.sanitizeWorkflowRaw(c.workflow), c);
      }), { numRuns: 200 });
    });

  });

  it('connections keep pointing at the sanitized node names', () => {
    fc.assert(fc.property(caseArb(fc.oneof(secretArb, basicAuthSecret)), (c) => {
      const out = WorkflowSanitizer.sanitizeWorkflowRaw(c.workflow);
      const names = new Set(out.nodes.map((n: any) => n.name));
      for (const [source, byType] of Object.entries<any>(out.connections)) {
        expect(names.has(source), source).toBe(true);
        for (const target of byType.main.flat()) expect(names.has(target.node), target.node).toBe(true);
      }
    }), RUNS);
  });
});
