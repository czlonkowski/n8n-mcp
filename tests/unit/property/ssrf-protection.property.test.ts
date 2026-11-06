/**
 * Property-based tests for SSRFProtection (src/utils/ssrf-protection.ts).
 *
 * The example-based suite (tests/unit/utils/ssrf-protection.test.ts) pins the
 * known advisory payloads. These properties generate the address space and the
 * textual encodings instead: every address inside a blocked range must stay
 * blocked whichever way it is spelled (decimal/hex/octal/short IPv4, IPv4
 * embedded in IPv6, expanded or uppercase IPv6, percent-encoded or full-width
 * hosts, trailing dots), and public addresses must stay allowed.
 *
 * Range membership is decided by an oracle built on ipaddr.js CIDR matching,
 * independent of the regexes inside the module under test.
 *
 * DNS is mocked: IP literals and numeric hosts resolve the way libc's
 * inet_aton reads them, generated DNS names resolve to generated answer sets,
 * everything else fails. No test here touches the network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import ipaddr from 'ipaddr.js';
import { isIP } from 'net';

const dnsAnswers = vi.hoisted(() => new Map<string, Array<{ address: string; family: 4 | 6 }>>());

/** inet_aton reading of a numeric host (1-4 parts, decimal / 0x hex / 0 octal). */
const inetAton = vi.hoisted(() => (host: string): string | null => {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    let n: number;
    if (/^0x[0-9a-f]*$/i.test(part)) n = part.length === 2 ? 0 : parseInt(part.slice(2), 16);
    else if (/^0[0-7]*$/.test(part)) n = parseInt(part, 8);
    else if (/^[1-9]\d*$/.test(part)) n = parseInt(part, 10);
    else return null;
    nums.push(n);
  }
  const last = nums[nums.length - 1];
  const head = nums.slice(0, -1);
  if (head.some((n) => n > 255) || last >= 2 ** (8 * (5 - nums.length))) return null;
  let value = 0;
  head.forEach((n, i) => { value += n * 2 ** (8 * (3 - i)); });
  value += last;
  return [24, 16, 8, 0].map((s) => Math.floor(value / 2 ** s) & 0xff).join('.');
});

vi.mock('dns/promises', () => ({
  lookup: vi.fn(async (hostname: string) => {
    const family = isIP(hostname);
    if (family !== 0) return [{ address: hostname, family }];
    const numeric = inetAton(hostname);
    if (numeric !== null) return [{ address: numeric, family: 4 }];
    const answers = dnsAnswers.get(hostname);
    if (answers) return answers;
    const err: any = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
    err.code = 'ENOTFOUND';
    throw err;
  }),
}));

import { SSRFProtection } from '../../../src/utils/ssrf-protection';

type Mode = 'strict' | 'moderate' | 'permissive';
const MODES: Mode[] = ['strict', 'moderate', 'permissive'];
const RUNS = { numRuns: 300 };

// ---------------------------------------------------------------------------
// Oracle: the ranges the module documents as blocked.
// ---------------------------------------------------------------------------

const cidrs = (list: string[]) => list.map((c) => ipaddr.parseCIDR(c));

/** Blocked in strict and moderate (PRIVATE_IP_RANGES contract). */
const BLOCKED_V4 = cidrs([
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.168.0.0/16', '224.0.0.0/4', '240.0.0.0/4',
]);
/** Blocked in every mode. */
const METADATA_V4 = ['169.254.169.254', '169.254.170.2', '100.100.100.200', '192.0.0.192'];
const METADATA_V6 = ['fd00:ec2::254', 'fd20:ce::254', 'fe80::a9fe:a9fe', 'fd00:a9fe:a9fe::1'];
const METADATA_NAMES = ['metadata.google.internal', 'metadata'];
/** Blocked in strict and moderate (isPrivateOrMappedIpv6 contract). */
const BLOCKED_V6 = cidrs(['fe80::/10', 'fec0::/10', 'fc00::/7', 'ff00::/8', '::/96']);

const inRanges = (addr: string, ranges: ReturnType<typeof cidrs>) => {
  const parsed = ipaddr.parse(addr);
  return ranges.some(([net, bits]) => parsed.kind() === net.kind() && (parsed as any).match(net, bits));
};

// ---------------------------------------------------------------------------
// Address generators
// ---------------------------------------------------------------------------

const intToV4 = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 0xff).join('.');
const v4ToInt = (a: string) => a.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);

const v4InCidr = (cidr: string) => {
  const [base, bits] = cidr.split('/');
  const size = 2 ** (32 - Number(bits));
  return fc.integer({ min: 0, max: size - 1 }).map((off) => intToV4(v4ToInt(base) + off));
};

const blockedV4 = fc.oneof(
  ...BLOCKED_V4.map(([net, bits]) => v4InCidr(`${net.toString()}/${bits}`)),
  fc.constantFrom(...METADATA_V4),
);
const metadataV4 = fc.constantFrom(...METADATA_V4);
/** Private addresses moderate must still refuse: everything but 127/8 and 0.0.0.0. */
const privateNonLoopbackV4 = blockedV4.filter((a) => !a.startsWith('127.') && a !== '0.0.0.0');
const loopbackV4 = v4InCidr('127.0.0.0/8');
const publicV4 = fc
  .integer({ min: 0, max: 0xffffffff })
  .map(intToV4)
  .filter((a) => !inRanges(a, BLOCKED_V4) && !METADATA_V4.includes(a));

const hextet = fc.integer({ min: 0, max: 0xffff });
const hextets = (n: number) => fc.array(hextet, { minLength: n, maxLength: n });

const v6InPrefix = (prefix: number, mask: number) =>
  hextets(8).map((p) => [(prefix & mask) | (p[0] & ~mask & 0xffff), ...p.slice(1)]);

const blockedV6Parts = fc.oneof(
  v6InPrefix(0xfe80, 0xffc0), // link-local
  v6InPrefix(0xfec0, 0xffc0), // site-local
  v6InPrefix(0xfc00, 0xfe00), // unique local
  v6InPrefix(0xff00, 0xff00), // multicast
  hextets(2).map(([a, b]) => [0, 0, 0, 0, 0, 0, a, b]), // ::/96 incl. ::1 and ::
);
/** Global unicast outside every special prefix the module knows (2000::/3 minus 2001:0::/32, 2002::/16). */
const publicV6Parts = fc
  .tuple(fc.integer({ min: 0x2400, max: 0x3fff }), hextets(7))
  .map(([first, rest]) => [first, ...rest]);

const v4Hextets = (a: string): [number, number] => {
  const [o1, o2, o3, o4] = a.split('.').map(Number);
  return [(o1 << 8) | o2, (o3 << 8) | o4];
};

type Embedding = 'mapped' | 'siit' | 'compat' | 'nat64' | 'nat64local' | '6to4' | 'teredo';
/** Embeddings that put the IPv4 in the last 32 bits, so a dotted tail is legal. */
const TAIL_EMBEDDINGS: Embedding[] = ['mapped', 'siit', 'compat', 'nat64', 'nat64local'];
/** Embeddings whose IPv4 the module extracts and judges by the IPv4 policy. */
const TUNNEL_EMBEDDINGS: Embedding[] = ['nat64', 'nat64local', '6to4', 'teredo'];

const embed = (v4: string, kind: Embedding, filler: number[]): number[] => {
  const [hi, lo] = v4Hextets(v4);
  switch (kind) {
    case 'mapped': return [0, 0, 0, 0, 0, 0xffff, hi, lo];
    case 'siit': return [0, 0, 0, 0, 0xffff, 0, hi, lo];
    case 'compat': return [0, 0, 0, 0, 0, 0, hi, lo];
    case 'nat64': return [0x64, 0xff9b, 0, 0, 0, 0, hi, lo];
    case 'nat64local': return [0x64, 0xff9b, 1, 0, 0, 0, hi, lo];
    case '6to4': return [0x2002, hi, lo, ...filler.slice(0, 5)];
    case 'teredo': return [0x2001, 0, ...filler.slice(0, 4), hi ^ 0xffff, lo ^ 0xffff];
  }
};

// ---------------------------------------------------------------------------
// Textual encodings
// ---------------------------------------------------------------------------

interface V6Style { compress: number; pad: boolean; upper: boolean; dottedTail: boolean }
const v6Style = fc.record({
  compress: fc.integer({ min: -1, max: 7 }),
  pad: fc.boolean(),
  upper: fc.boolean(),
  dottedTail: fc.boolean(),
});

/**
 * Render eight hextets as IPv6 text. `compress` picks which zero run (if any)
 * becomes `::`, so non-RFC 5952 spellings are produced too.
 */
const renderV6 = (parts: number[], style: V6Style, allowTail: boolean): string => {
  const tail = allowTail && style.dottedTail;
  const groups = (tail ? parts.slice(0, 6) : parts).map((h) =>
    style.pad ? h.toString(16).padStart(4, '0') : h.toString(16));
  const tailText = tail
    ? [parts[6] >> 8, parts[6] & 0xff, parts[7] >> 8, parts[7] & 0xff].join('.')
    : '';

  // Zero runs of length >= 1 among the hextet groups.
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < groups.length; ) {
    if (parseInt(groups[i], 16) === 0) {
      let j = i;
      while (j < groups.length && parseInt(groups[j], 16) === 0) j++;
      runs.push([i, j]);
      i = j;
    } else i++;
  }
  let text: string;
  if (style.compress >= 0 && runs.length > 0) {
    const [s, e] = runs[style.compress % runs.length];
    const head = groups.slice(0, s).join(':');
    const rest = groups.slice(e);
    const restText = [...rest, ...(tail ? [tailText] : [])].join(':');
    text = `${head}::${restText}`;
  } else {
    text = [...groups, ...(tail ? [tailText] : [])].join(':');
  }
  return style.upper ? text.toUpperCase() : text;
};

interface V4Style { parts: 1 | 2 | 3 | 4; radixes: Array<'dec' | 'hex' | 'HEX' | 'oct'>; zeroPad: number[]; trailingDot: boolean }
const v4Style = fc.record({
  parts: fc.constantFrom(1, 2, 3, 4) as fc.Arbitrary<1 | 2 | 3 | 4>,
  radixes: fc.array(fc.constantFrom('dec', 'hex', 'HEX', 'oct') as fc.Arbitrary<'dec' | 'hex' | 'HEX' | 'oct'>, { minLength: 4, maxLength: 4 }),
  zeroPad: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 4, maxLength: 4 }),
  trailingDot: fc.boolean(),
});

/** WHATWG-legal IPv4 spellings: 1-4 parts, each decimal, hex or octal. */
const renderV4 = (addr: string, style: V4Style): string => {
  const o = addr.split('.').map(Number);
  const values =
    style.parts === 4 ? o
      : style.parts === 3 ? [o[0], o[1], o[2] * 256 + o[3]]
        : style.parts === 2 ? [o[0], o[1] * 65536 + o[2] * 256 + o[3]]
          : [v4ToInt(addr)];
  const text = values.map((v, i) => {
    const pad = '0'.repeat(style.zeroPad[i]);
    switch (style.radixes[i]) {
      case 'hex': return `0x${pad}${v.toString(16)}`;
      case 'HEX': return `0X${pad}${v.toString(16).toUpperCase()}`;
      case 'oct': return `0${pad}${v.toString(8)}`;
      default: return String(v);
    }
  }).join('.');
  return style.trailingDot ? `${text}.` : text;
};

const FULLWIDTH_DOTS = ['。', '．', '｡'];
interface HostMangle { percent: boolean[]; fullwidth: boolean[]; dot: number }
const hostMangle = fc.record({
  percent: fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
  fullwidth: fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
  dot: fc.integer({ min: 0, max: 2 }),
});

/**
 * Spellings WHATWG URL maps back to the plain host: percent-encoding and
 * full-width (IDNA-mapped) characters. Not applied to bracketed IPv6.
 */
const mangleHost = (host: string, m: HostMangle): string =>
  [...host].map((c, i) => {
    if (m.fullwidth[i % 64]) {
      if (c === '.') return FULLWIDTH_DOTS[m.dot];
      if (/[0-9A-Za-z]/.test(c)) return String.fromCharCode(c.charCodeAt(0) + 0xfee0);
    }
    if (m.percent[i % 64]) return `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`;
    return c;
  }).join('');

const urlDecoration = fc.record({
  scheme: fc.constantFrom('http', 'https', 'HTTP', 'Https'),
  port: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }),
  path: fc.stringMatching(/^(\/[a-z0-9._~-]{0,8}){0,3}$/),
  query: fc.option(fc.stringMatching(/^[a-z0-9=&]{0,12}$/), { nil: undefined }),
});
type Decoration = { scheme: string; port?: number; path: string; query?: string };

const buildUrl = (host: string, d: Decoration) =>
  `${d.scheme}://${host}${d.port !== undefined ? `:${d.port}` : ''}${d.path || '/'}${d.query !== undefined ? `?${d.query}` : ''}`;

/** Any WHATWG-recognised spelling of an IPv4 address, as a URL host. */
const v4Host = (addr: fc.Arbitrary<string>) =>
  fc.tuple(addr, v4Style, fc.boolean(), hostMangle).map(([a, style, mangle, m]) => {
    const text = renderV4(a, style);
    return { addr: a, host: mangle ? mangleHost(text, m) : text };
  });

/** IPv4 embedded in IPv6 (any embedding, any spelling), as a bracketed URL host. */
const embeddedHost = (addr: fc.Arbitrary<string>, kinds: Embedding[]) =>
  fc.tuple(addr, fc.constantFrom(...kinds), hextets(5), v6Style).map(([a, kind, filler, style]) => {
    const parts = embed(a, kind, filler);
    return { addr: a, kind, host: `[${renderV6(parts, style, TAIL_EMBEDDINGS.includes(kind))}]` };
  });

const v6Host = (parts: fc.Arbitrary<number[]>) =>
  fc.tuple(parts, v6Style).map(([p, style]) => `[${renderV6(p, style, false)}]`);

const metadataV6Host = fc.tuple(fc.constantFrom(...METADATA_V6), v6Style).map(([a, style]) =>
  `[${renderV6((ipaddr.parse(a) as ipaddr.IPv6).parts, style, false)}]`);

const caseMix = (s: string, flips: boolean[]) =>
  [...s].map((c, i) => (flips[i % flips.length] ? c.toUpperCase() : c)).join('');

const trailingDots = fc.integer({ min: 0, max: 3 }).map((n) => '.'.repeat(n));

const metadataNameHost = fc
  .tuple(fc.constantFrom(...METADATA_NAMES), fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }), trailingDots)
  .map(([name, flips, dots]) => caseMix(name, flips) + dots);

const label = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}[a-z0-9]$/);
const localhostSubdomainHost = fc
  .tuple(fc.array(label, { minLength: 0, maxLength: 3 }), fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }), trailingDots)
  .map(([labels, flips, dots]) => [...labels, caseMix('localhost', flips)].join('.') + dots);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalMode = process.env.WEBHOOK_SECURITY_MODE;
const setMode = (mode: Mode) => { process.env.WEBHOOK_SECURITY_MODE = mode; };
const sync = (url: string) => SSRFProtection.validateUrlSync(url);

/** The URL must parse at all, or a rejection proves nothing about the policy. */
const parses = (url: string) => { try { new URL(url); return true; } catch { return false; } };

describe('SSRFProtection properties', () => {
  beforeEach(() => {
    dnsAnswers.clear();
    setMode('strict');
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env.WEBHOOK_SECURITY_MODE;
    else process.env.WEBHOOK_SECURITY_MODE = originalMode;
  });

  describe('generators', () => {
    // Guards against a generator bug turning the properties below vacuous.
    it('every generated IPv4 spelling parses back to the generated address', () => {
      fc.assert(fc.property(v4Host(fc.integer({ min: 0, max: 0xffffffff }).map(intToV4)), urlDecoration, ({ addr, host }, d) => {
        expect(new URL(buildUrl(host, d)).hostname).toBe(addr);
      }), RUNS);
    });

    it('every generated IPv6 spelling parses back to the generated address', () => {
      fc.assert(fc.property(hextets(8), v6Style, fc.boolean(), (parts, style, tail) => {
        // WHATWG URL is the oracle here: ipaddr.js rejects some legal dotted
        // tails such as `::0.0.0.0`.
        const text = renderV6(parts, style, tail);
        const canonical = new URL(`http://[${new ipaddr.IPv6(parts).toString()}]/`).hostname;
        expect(new URL(`http://[${text}]/`).hostname, text).toBe(canonical);
      }), RUNS);
    });
  });

  describe('validateUrlSync, strict mode', () => {
    it('rejects every IPv4 spelling of an address in a blocked range, with any trailing dots', () => {
      fc.assert(fc.property(v4Host(blockedV4), trailingDots, urlDecoration, ({ host }, dots, d) => {
        const url = buildUrl(host + dots, d);
        expect(sync(url).valid, url).toBe(false);
      }), RUNS);
    });

    it('rejects a blocked IPv4 address embedded in IPv6 in any embedding and spelling', () => {
      fc.assert(fc.property(embeddedHost(blockedV4, [...TAIL_EMBEDDINGS, '6to4', 'teredo']), urlDecoration, ({ host }, d) => {
        const url = buildUrl(host, d);
        expect(sync(url).valid, url).toBe(false);
      }), RUNS);
    });

    it('rejects IPv6 link-local, site-local, unique-local, multicast and ::/96 in any spelling', () => {
      fc.assert(fc.property(v6Host(blockedV6Parts), urlDecoration, (host, d) => {
        const url = buildUrl(host, d);
        expect(sync(url).valid, url).toBe(false);
      }), RUNS);
    });

    it('rejects localhost and *.localhost names in any case with trailing dots', () => {
      fc.assert(fc.property(localhostSubdomainHost, urlDecoration, (host, d) => {
        const url = buildUrl(host, d);
        expect(sync(url).valid, url).toBe(false);
      }), RUNS);
    });

    it('accepts every IPv4 spelling of a public address, with any trailing dots', () => {
      fc.assert(fc.property(v4Host(publicV4), trailingDots, urlDecoration, ({ host }, dots, d) => {
        const url = buildUrl(host + dots, d);
        expect(sync(url), url).toEqual({ valid: true });
      }), RUNS);
    });

    it('accepts public IPv6 global unicast addresses in any spelling', () => {
      fc.assert(fc.property(v6Host(publicV6Parts), urlDecoration, (host, d) => {
        const url = buildUrl(host, d);
        expect(sync(url), url).toEqual({ valid: true });
      }), RUNS);
    });

    it('accepts a public IPv4 address behind NAT64, 6to4 or Teredo (DNS64 networks)', () => {
      fc.assert(fc.property(embeddedHost(publicV4, TUNNEL_EMBEDDINGS), urlDecoration, ({ host }, d) => {
        const url = buildUrl(host, d);
        expect(sync(url), url).toEqual({ valid: true });
      }), RUNS);
    });

    it('rejects userinfo and fragments whatever the host', () => {
      fc.assert(fc.property(
        v4Host(publicV4),
        fc.stringMatching(/^[a-z0-9]{1,8}$/),
        fc.option(fc.stringMatching(/^[a-z0-9]{1,8}$/), { nil: undefined }),
        fc.boolean(),
        ({ host }, user, pass, fragment) => {
          const url = fragment
            ? `http://${host}/#${user}`
            : `http://${user}${pass !== undefined ? `:${pass}` : ''}@${host}/`;
          expect(sync(url).valid, url).toBe(false);
        },
      ), RUNS);
    });
  });

  describe('validateUrlSync, moderate mode', () => {
    beforeEach(() => setMode('moderate'));

    it('rejects every IPv4 spelling of a private, non-loopback address', () => {
      fc.assert(fc.property(v4Host(privateNonLoopbackV4), urlDecoration, ({ host }, d) => {
        const url = buildUrl(host, d);
        expect(sync(url).valid, url).toBe(false);
      }), RUNS);
    });

    it('rejects any blocked IPv4 address (loopback included) embedded in IPv6', () => {
      fc.assert(fc.property(embeddedHost(blockedV4, [...TAIL_EMBEDDINGS, '6to4', 'teredo']), urlDecoration, ({ addr, kind, host }, d) => {
        // 0.0.0.1 in the compat form is ::1, the IPv6 loopback, which moderate allows on purpose.
        fc.pre(!(kind === 'compat' && addr === '0.0.0.1'));
        const url = buildUrl(host, d);
        expect(sync(url).valid, url).toBe(false);
      }), RUNS);
    });

    it('accepts every IPv4 spelling of a 127/8 loopback address, and *.localhost names', () => {
      fc.assert(fc.property(
        fc.oneof(v4Host(loopbackV4).map((h) => h.host), localhostSubdomainHost),
        urlDecoration,
        (host, d) => {
          const url = buildUrl(host, d);
          expect(sync(url), url).toEqual({ valid: true });
        },
      ), RUNS);
    });
  });

  describe('validateUrlSync, permissive mode', () => {
    beforeEach(() => setMode('permissive'));

    it('accepts private, non-metadata IPv4 addresses in any spelling', () => {
      fc.assert(fc.property(v4Host(blockedV4.filter((a) => !METADATA_V4.includes(a))), urlDecoration, ({ host }, d) => {
        const url = buildUrl(host, d);
        expect(sync(url), url).toEqual({ valid: true });
      }), RUNS);
    });
  });

  describe('cloud metadata, every mode', () => {
    const metadataHost = fc.oneof(
      fc.tuple(v4Host(metadataV4), trailingDots).map(([h, dots]) => h.host + dots),
      embeddedHost(metadataV4, [...TAIL_EMBEDDINGS, '6to4', 'teredo']).map((h) => h.host),
      metadataV6Host,
      metadataNameHost,
    );

    it('validateUrlSync rejects every spelling of a metadata endpoint in every mode', () => {
      fc.assert(fc.property(metadataHost, urlDecoration, fc.constantFrom(...MODES), (host, d, mode) => {
        setMode(mode);
        const url = buildUrl(host, d);
        expect(sync(url).valid, `${mode} ${url}`).toBe(false);
      }), RUNS);
    });

    it('validateWebhookUrl rejects every spelling of a metadata endpoint in every mode', async () => {
      await fc.assert(fc.asyncProperty(metadataHost, urlDecoration, fc.constantFrom(...MODES), async (host, d, mode) => {
        setMode(mode);
        const url = buildUrl(host, d);
        expect((await SSRFProtection.validateWebhookUrl(url)).valid, `${mode} ${url}`).toBe(false);
      }), RUNS);
    });
  });

  describe('validateWebhookUrl (resolved addresses)', () => {
    const dnsName = fc
      .tuple(fc.array(label, { minLength: 1, maxLength: 3 }), fc.constantFrom('com', 'net', 'io', 'example'))
      .map(([labels, tld]) => `${labels.join('.')}.${tld}`)
      .filter((n) => !n.endsWith('.localhost') && !METADATA_NAMES.includes(n));

    /** Resolver output: dotted IPv4, or IPv6 the way getaddrinfo/inet_ntop prints it. */
    const resolverV4 = (addr: fc.Arbitrary<string>) =>
      fc.tuple(addr, fc.constantFrom('plain', 'mapped-dotted', 'mapped-hex')).map(([a, form]) => {
        if (form === 'plain') return { address: a, family: 4 as const };
        if (form === 'mapped-dotted') return { address: `::ffff:${a}`, family: 6 as const };
        return { address: ipaddr.parse(`::ffff:${a}`).toString(), family: 6 as const };
      });
    const resolverV6 = (parts: fc.Arbitrary<number[]>) =>
      parts.map((p) => ({ address: new ipaddr.IPv6(p).toString(), family: 6 as const }));

    const publicAnswer = fc.oneof(
      publicV4.map((a) => ({ address: a, family: 4 as const })),
      resolverV6(publicV6Parts),
    );

    it('rejects a name when any of its DNS answers is blocked (mixed record sets), strict', async () => {
      await fc.assert(fc.asyncProperty(
        dnsName,
        fc.array(publicAnswer, { maxLength: 4 }),
        fc.oneof(resolverV4(blockedV4), resolverV6(blockedV6Parts)),
        fc.nat(),
        urlDecoration,
        async (name, publics, bad, at, d) => {
          const answers = [...publics];
          answers.splice(at % (publics.length + 1), 0, bad);
          dnsAnswers.set(name, answers);
          const url = buildUrl(name, d);
          expect((await SSRFProtection.validateWebhookUrl(url)).valid, `${url} -> ${JSON.stringify(answers)}`).toBe(false);
        },
      ), RUNS);
    });

    it('rejects a name with a metadata address among its DNS answers in every mode', async () => {
      await fc.assert(fc.asyncProperty(
        dnsName,
        fc.array(publicAnswer, { maxLength: 4 }),
        fc.oneof(
          resolverV4(metadataV4),
          // Resolvers print canonical text; other spellings check that the
          // comparison does not depend on it.
          fc.tuple(fc.constantFrom(...METADATA_V6), v6Style).map(([a, style]) => ({
            address: renderV6((ipaddr.parse(a) as ipaddr.IPv6).parts, style, false),
            family: 6 as const,
          })),
        ),
        fc.nat(),
        fc.constantFrom(...MODES),
        async (name, publics, bad, at, mode) => {
          setMode(mode);
          const answers = [...publics];
          answers.splice(at % (publics.length + 1), 0, bad);
          dnsAnswers.set(name, answers);
          expect((await SSRFProtection.validateWebhookUrl(`https://${name}/`)).valid, `${mode} ${JSON.stringify(answers)}`).toBe(false);
        },
      ), RUNS);
    });

    it('accepts a name whose DNS answers are all public and returns all of them for pinning', async () => {
      await fc.assert(fc.asyncProperty(dnsName, fc.array(publicAnswer, { minLength: 1, maxLength: 5 }), async (name, answers) => {
        dnsAnswers.set(name, answers);
        const result = await SSRFProtection.validateWebhookUrl(`https://${name}/`);
        expect(result.valid).toBe(true);
        expect(result.addresses).toEqual(answers);
      }), RUNS);
    });

    it('rejects every spelling of a blocked IPv4 host, including numeric hosts with trailing dots, strict', async () => {
      await fc.assert(fc.asyncProperty(v4Host(blockedV4), fc.integer({ min: 0, max: 3 }), urlDecoration, async ({ host }, dots, d) => {
        const url = buildUrl(host + '.'.repeat(dots), d);
        fc.pre(parses(url));
        expect((await SSRFProtection.validateWebhookUrl(url)).valid, url).toBe(false);
      }), RUNS);
    });

    it('agrees with validateUrlSync on every IP-literal host in every mode', async () => {
      const literalHost = fc.oneof(
        v4Host(fc.oneof(blockedV4, publicV4)).map((h) => h.host),
        embeddedHost(fc.oneof(blockedV4, publicV4), [...TAIL_EMBEDDINGS, '6to4', 'teredo']).map((h) => h.host),
        v6Host(fc.oneof(blockedV6Parts, publicV6Parts)),
        metadataV6Host,
      );
      await fc.assert(fc.asyncProperty(literalHost, urlDecoration, fc.constantFrom(...MODES), async (host, d, mode) => {
        setMode(mode);
        const url = buildUrl(host, d);
        const asyncResult = await SSRFProtection.validateWebhookUrl(url);
        expect(asyncResult.valid, `${mode} ${url}`).toBe(sync(url).valid);
      }), RUNS);
    });
  });
});
