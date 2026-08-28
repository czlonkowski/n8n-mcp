import { URL } from 'url';
import { lookup } from 'dns/promises';
import net, { isIPv4, isIPv6 } from 'net';
import http from 'http';
import https from 'https';
import ipaddr from 'ipaddr.js';
import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';
import { logger } from './logger';

export interface PinnedAgents {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}

export interface PinnedFetch {
  fetch: (url: string | URL, init?: RequestInit) => Promise<Response>;
  close(): Promise<void>;
}

export interface WebhookUrlValidationResult {
  valid: boolean;
  reason?: string;
  /** First validated address, kept for backward compat. See {@link addresses} for the full set. */
  address?: string;
  family?: 4 | 6;
  /**
   * Every address the hostname resolved to, in DNS-answer order, each of
   * which passed the SSRF policy. Pass this to {@link SSRFProtection.createPinnedAgents}
   * so the transport can fail over across all validated candidates (e.g.
   * `localhost` resolving to `::1` first on a host where the server only
   * listens on IPv4) instead of being pinned to a single answer forever.
   */
  addresses?: Array<{ address: string; family: 4 | 6 }>;
}

// SECURITY (#978/#989/#990 resilience follow-up to GHSA-cmrh-wvq6-wm9r):
// `autoSelectFamily`/`autoSelectFamilyAttemptTimeout` were added in Node 18.13
// and are stable by 20.x. Guard for older runtimes; computed once at module
// scope rather than probed per-socket.
const supportsAutoSelectFamily = typeof (net as any).getDefaultAutoSelectFamily === 'function';

/**
 * SSRF Protection Utility with Configurable Security Modes
 *
 * Validates URLs to prevent Server-Side Request Forgery attacks including DNS rebinding
 * See: https://github.com/czlonkowski/n8n-mcp/issues/265 (HIGH-03)
 *
 * Security Modes:
 * - strict (default): Block localhost + private IPs + cloud metadata (production)
 * - moderate: Allow localhost, block private IPs + cloud metadata (local dev)
 * - permissive: Allow localhost + private IPs, block cloud metadata (testing only)
 */

// Security mode type
type SecurityMode = 'strict' | 'moderate' | 'permissive';

// Cloud metadata endpoints (ALWAYS blocked in all modes)
const CLOUD_METADATA = new Set([
  // AWS/Azure
  '169.254.169.254', // AWS/Azure metadata
  '169.254.170.2',   // AWS ECS metadata
  // Google Cloud
  'metadata.google.internal', // GCP metadata
  'metadata',
  // Alibaba Cloud
  '100.100.100.200', // Alibaba Cloud metadata
  // Oracle Cloud
  '192.0.0.192',     // Oracle Cloud metadata
]);

// Localhost patterns
const LOCALHOST_PATTERNS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'localhost.localdomain',
]);

// Private IP ranges (regex for IPv4)
const PRIVATE_IP_RANGES = [
  /^10\./,                          // 10.0.0.0/8
  /^192\.168\./,                    // 192.168.0.0/16
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^169\.254\./,                    // 169.254.0.0/16 (Link-local)
  /^127\./,                         // 127.0.0.0/8 (Loopback)
  /^0\./,                           // 0.0.0.0/8 (Invalid)
  // SECURITY (GHSA-2x5j-hrmv-ccrq): IANA special-purpose blocks that are not
  // globally reachable and therefore never a legitimate outbound target.
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 (RFC 6598 shared address space)
  /^192\.0\.0\./,                   // 192.0.0.0/24 (RFC 6890 IETF protocol assignments)
  /^(22[4-9]|23\d)\./,              // 224.0.0.0/4 (Multicast)
  /^(24\d|25[0-5])\./,              // 240.0.0.0/4 (Reserved, incl. 255.255.255.255 broadcast)
];

export class SSRFProtection {
  /**
   * IPv6 addresses that must be blocked: loopback, unspecified, link-local,
   * unique-local, site-local (deprecated), multicast, IPv4-mapped,
   * IPv4-compatible, and any IPv6→IPv4 tunneling address (NAT64, 6to4, Teredo)
   * whose embedded IPv4 is private or a cloud-metadata endpoint. Tunneling
   * prefixes with a public embedded IPv4 are allowed so legitimate DNS64/NAT64
   * environments work.
   *
   * Hostname must be bracket-stripped. WHATWG URL parser canonicalizes IPv6
   * literals (zero compression, dotted-quad → hex pairs), so prefix matching
   * works against the normalized form.
   *
   * @security See GHSA-56c3-vfp2-5qqj. The sync validator previously had no
   * IPv6 gate, letting `::ffff:169.254.169.254`, `::169.254.169.254`,
   * `2002:a9fe:a9fe::`, and `64:ff9b::a9fe:a9fe` reach the HTTP client.
   */
  private static isPrivateOrMappedIpv6(hostname: string): boolean {
    // Gate on net.isIPv6 so domain names starting with hex-like labels
    // (e.g. "fcexample.com") are never misclassified as private IPv6.
    if (!isIPv6(hostname)) return false;

    // SECURITY (GHSA-2x5j-hrmv-ccrq): normalize case here so the helper holds
    // its own precondition regardless of what the caller passes.
    hostname = hostname.toLowerCase();

    // ::/96 reserved block: unspecified (`::`), loopback (`::1`), IPv4-mapped
    // (`::ffff:X`), and deprecated IPv4-compatible (`::X:Y` per RFC 4291) all
    // live here. Blocking the whole prefix avoids enumerating subforms.
    if (hostname.startsWith('::')) return true;

    // Defensive long-form IPv4-mapped — WHATWG URL normally compresses this,
    // but keep the check in case normalization ever changes.
    if (hostname.startsWith('0:0:0:0:0:ffff:')) return true;

    // SECURITY (GHSA-2x5j-hrmv-ccrq): these blocks are matched numerically on
    // the first hextet so each covers its full CIDR span.
    const hextet = SSRFProtection.firstHextet(hostname);
    // Reaching here means net.isIPv6 accepted the input, so a parse failure
    // means the two parsers disagree about it. Fail closed rather than skip
    // the checks below.
    if (hextet === null) return true;
    if ((hextet & 0xffc0) === 0xfe80) return true; // Link-local fe80::/10 (RFC 4291)
    if ((hextet & 0xffc0) === 0xfec0) return true; // Site-local fec0::/10 (deprecated, RFC 3879)
    if ((hextet & 0xfe00) === 0xfc00) return true; // Unique local fc00::/7 (RFC 4193)
    if ((hextet & 0xff00) === 0xff00) return true; // Multicast ff00::/8 (RFC 4291)

    // Tunneling prefixes (NAT64, 6to4, Teredo) carry an embedded IPv4. Extract
    // it and reuse the IPv4 policy so we don't blanket-block legitimate users
    // on DNS64/NAT64 networks reaching public IPv4 servers, while keeping the
    // GHSA-56c3-vfp2-5qqj defense against tunneled private/metadata IPv4.
    const embedded = SSRFProtection.tryExtractTunneledIPv4(hostname);
    if (embedded === 'non_canonical') return true;
    if (embedded !== null) {
      if (CLOUD_METADATA.has(embedded)) return true;
      if (PRIVATE_IP_RANGES.some(regex => regex.test(embedded))) return true;
      return false;
    }

    return false;
  }

  /**
   * Extract the embedded IPv4 from a canonical IPv6 tunneling address.
   *
   * Returns a dotted-quad string when the address is RFC 6052 NAT64
   * (`64:ff9b::/96`), RFC 8215 local-use NAT64 at the well-known
   * `64:ff9b:1::/96` sub-prefix layout (parts[3..5] == 0), RFC 3056 6to4
   * (`2002::/16`), or RFC 4380 Teredo (`2001::/32`). Returns the literal
   * `'non_canonical'` when the prefix family is recognized but the shape
   * does not strictly match — this includes anything in `64:ff9b:1::/48`
   * outside the /96 sub-prefix layout (e.g. the literal RFC 6052 /48
   * embedding that interleaves the IPv4 around a u-octet at bits 64-71).
   * Returns `null` for any other IPv6 (caller continues with other checks).
   *
   * Parsing is delegated to `ipaddr.js` so we don't roll a homegrown hextet
   * expander — a bug there would be an SSRF bypass.
   */
  private static tryExtractTunneledIPv4(hostname: string): string | 'non_canonical' | null {
    let parsed: ReturnType<typeof ipaddr.parse>;
    try {
      parsed = ipaddr.parse(hostname);
    } catch {
      return null;
    }
    if (parsed.kind() !== 'ipv6') return null;
    const p = (parsed as ipaddr.IPv6).parts;

    // NAT64 64:ff9b: family — both layouts here put the IPv4 in the last 32
    // bits, so we recognize only the /96 well-known position for each.
    //   * RFC 6052 well-known: `64:ff9b::/96` (parts[2..5] all zero)
    //   * RFC 8215 local-use: `64:ff9b:1::/96` sub-prefix within the /48 block
    //     (parts[2]==1, parts[3..5] zero) — RFC 8215 §3.1 recommends operators
    //     embed IPv4 in /96 sub-prefixes rather than the literal RFC 6052 /48
    //     layout, which interleaves the IPv4 around a u-octet at bits 64-71.
    // Any other 64:ff9b: shape (including a literal RFC 6052 /48 embedding
    // such as `64:ff9b:1:a9fe:a9:fe00::`) is treated as non-canonical and
    // fail-safe blocked — we won't guess which slot the OS NAT64 translator
    // will read the IPv4 from.
    if (p[0] === 0x64 && p[1] === 0xff9b) {
      const rfc6052 = p[2] === 0 && p[3] === 0 && p[4] === 0 && p[5] === 0;
      const rfc8215 = p[2] === 0x0001 && p[3] === 0 && p[4] === 0 && p[5] === 0;
      if (rfc6052 || rfc8215) {
        return SSRFProtection.hextetsToIPv4(p[6], p[7]);
      }
      return 'non_canonical';
    }

    // 6to4 2002::/16 (RFC 3056) — bits 16-47 are the embedded IPv4
    if (p[0] === 0x2002) {
      return SSRFProtection.hextetsToIPv4(p[1], p[2]);
    }

    // Teredo 2001::/32 (RFC 4380) — last 32 bits are the client IPv4
    // obfuscated by XOR with all-ones.
    if (p[0] === 0x2001 && p[1] === 0) {
      return SSRFProtection.hextetsToIPv4(p[6] ^ 0xffff, p[7] ^ 0xffff);
    }

    return null;
  }

  /**
   * First 16-bit group of an IPv6 address, or null when the input does not
   * parse as IPv6. Parsing is delegated to `ipaddr.js` for the same reason
   * {@link tryExtractTunneledIPv4} does — a homegrown expander that disagreed
   * with the OS resolver would be a hole.
   */
  private static firstHextet(hostname: string): number | null {
    try {
      const parsed = ipaddr.parse(hostname);
      if (parsed.kind() !== 'ipv6') return null;
      return (parsed as ipaddr.IPv6).parts[0];
    } catch {
      return null;
    }
  }

  private static hextetsToIPv4(hi: number, lo: number): string {
    return `${(hi >>> 8) & 0xff}.${hi & 0xff}.${(lo >>> 8) & 0xff}.${lo & 0xff}`;
  }

  /**
   * Decisions that must hold across every security mode, including
   * `permissive`. Both validators return valid early under `permissive`
   * (the documented "block cloud metadata; allow everything else" mode),
   * so the broader `isPrivateOrMappedIpv6` gate wouldn't otherwise run
   * against the resolved/literal IPv6.
   *
   * Two cases need pre-permissive rejection:
   *   * **Tunneled metadata** — `64:ff9b::169.254.169.254` and equivalents
   *     across NAT64/6to4/Teredo. Without this, permissive lets IMDS
   *     traffic through an IPv6 wrapper.
   *   * **Non-canonical tunneling prefix** — `64:ff9b:` shapes that match
   *     neither RFC 6052 nor RFC 8215 (or 6to4/Teredo equivalents we don't
   *     recognize). We refuse to guess what the OS translator will route
   *     to, regardless of mode.
   *
   * Returns the user-facing reason string when blocking, or null when the
   * address is fine for the mode check that follows.
   */
  private static tunneledIPv6BlockReason(addr: string): string | null {
    if (!isIPv6(addr)) return null;
    const embedded = SSRFProtection.tryExtractTunneledIPv4(addr);
    if (embedded === 'non_canonical') return 'IPv6 private/mapped address not allowed';
    if (typeof embedded === 'string' && CLOUD_METADATA.has(embedded)) {
      return 'Cloud metadata endpoint blocked';
    }
    return null;
  }

  /**
   * Validate webhook URL for SSRF protection with configurable security modes
   *
   * @param urlString - URL to validate
   * @returns Promise with validation result
   *
   * @security Uses DNS resolution to prevent DNS rebinding attacks
   *
   * @example
   * // Production (default strict mode)
   * const result = await SSRFProtection.validateWebhookUrl('http://localhost:5678');
   * // { valid: false, reason: 'Localhost not allowed' }
   *
   * @example
   * // Local development (moderate mode)
   * process.env.WEBHOOK_SECURITY_MODE = 'moderate';
   * const result = await SSRFProtection.validateWebhookUrl('http://localhost:5678');
   * // { valid: true }
   */
  static async validateWebhookUrl(urlString: string): Promise<WebhookUrlValidationResult> {
    try {
      const url = new URL(urlString);
      const mode: SecurityMode = (process.env.WEBHOOK_SECURITY_MODE || 'strict') as SecurityMode;

      // Step 1: Must be HTTP/HTTPS (all modes)
      if (!['http:', 'https:'].includes(url.protocol)) {
        return { valid: false, reason: 'Invalid protocol. Only HTTP/HTTPS allowed.' };
      }

      // Get hostname and strip IPv6 brackets if present
      let hostname = url.hostname.toLowerCase();
      // Remove IPv6 brackets for consistent comparison
      if (hostname.startsWith('[') && hostname.endsWith(']')) {
        hostname = hostname.slice(1, -1);
      }

      // Step 2: ALWAYS block cloud metadata endpoints (all modes)
      if (CLOUD_METADATA.has(hostname)) {
        logger.warn('SSRF blocked: Cloud metadata endpoint', { hostname, mode });
        return { valid: false, reason: 'Cloud metadata endpoint blocked' };
      }

      // Step 3: Resolve DNS to get every address this hostname answers with.
      // Validating the full record set (not just the first answer) prevents
      // a mixed-record DNS-rebinding attack where a public address ships
      // alongside a private/metadata one and only the public one is checked.
      let resolved: Array<{ address: string; family: 4 | 6 }>;
      try {
        const raw = await lookup(hostname, { all: true }) as any;
        // Real Node with { all: true } always returns an array; normalize
        // defensively in case a caller/mock returns a single record.
        const list: any[] = Array.isArray(raw) ? raw : [raw];
        if (list.length === 0) {
          throw new Error('DNS lookup returned no addresses');
        }
        resolved = list.map((entry) => ({
          address: entry.address,
          family: entry.family === 6 ? 6 : 4,
        }));

        logger.debug('DNS resolved for SSRF check', {
          hostname,
          resolvedIPs: resolved.map(r => r.address),
          mode
        });
      } catch (error) {
        logger.warn('DNS resolution failed for webhook URL', {
          hostname,
          error: error instanceof Error ? error.message : String(error)
        });
        return { valid: false, reason: 'DNS resolution failed' };
      }

      // Steps 4-7: validate every resolved address. FAIL CLOSED — if any
      // address in the record set is disallowed, reject the whole hostname
      // instead of only checking the first.
      for (const { address } of resolved) {
        const check = SSRFProtection.validateResolvedAddress(hostname, address, mode);
        if (!check.valid) {
          return { valid: false, reason: check.reason };
        }
      }

      if (mode === 'permissive') {
        logger.warn('SSRF protection in permissive mode (localhost and private IPs allowed)', {
          hostname,
          resolvedIPs: resolved.map(r => r.address)
        });
      }

      const [first] = resolved;
      return { valid: true, address: first.address, family: first.family, addresses: resolved };
    } catch (error) {
      return { valid: false, reason: 'Invalid URL format' };
    }
  }

  /**
   * Validate a single resolved address against the cloud-metadata, IPv6
   * tunneling, and mode-specific (localhost / private-range) policy. Shared
   * by {@link validateWebhookUrl}'s loop over every DNS answer, so a
   * hostname with a mixed record set is checked address-by-address instead
   * of only on the first answer.
   */
  private static validateResolvedAddress(
    hostname: string,
    resolvedIP: string,
    mode: SecurityMode
  ): { valid: boolean; reason?: string } {
    // Step 4: ALWAYS block cloud metadata IPs (all modes)
    if (CLOUD_METADATA.has(resolvedIP)) {
      logger.warn('SSRF blocked: Hostname resolves to cloud metadata IP', {
        hostname,
        resolvedIP,
        mode
      });
      return { valid: false, reason: 'Hostname resolves to cloud metadata endpoint' };
    }

    // Step 4b: All-mode IPv6 tunneling gate — runs before the permissive
    // early-return. Rejects (a) tunneled cloud-metadata (any mode) and
    // (b) non-canonical tunneling prefixes (the fail-safe promise must
    // hold in permissive too, not just strict/moderate).
    const tunneledReason = SSRFProtection.tunneledIPv6BlockReason(resolvedIP);
    if (tunneledReason !== null) {
      logger.warn('SSRF blocked: IPv6 tunneling rejection (all-mode gate)', {
        hostname,
        resolvedIP,
        mode,
        reason: tunneledReason
      });
      return { valid: false, reason: tunneledReason };
    }

    // Step 5: Mode-specific validation

    // MODE: permissive - Allow everything except cloud metadata
    if (mode === 'permissive') {
      return { valid: true };
    }

    // Check if target is localhost
    const isLocalhost = LOCALHOST_PATTERNS.has(hostname) ||
                      resolvedIP === '::1' ||
                      resolvedIP.startsWith('127.');

    // MODE: strict - Block localhost and private IPs
    if (mode === 'strict' && isLocalhost) {
      logger.warn('SSRF blocked: Localhost not allowed in strict mode', {
        hostname,
        resolvedIP
      });
      return { valid: false, reason: 'Localhost access is blocked in strict mode' };
    }

    // MODE: moderate - Allow localhost, block private IPs
    if (mode === 'moderate' && isLocalhost) {
      logger.info('Localhost webhook allowed (moderate mode)', { hostname, resolvedIP });
      return { valid: true };
    }

    // Step 6: Check private IPv4 ranges (strict & moderate modes)
    if (PRIVATE_IP_RANGES.some(regex => regex.test(resolvedIP))) {
      logger.warn('SSRF blocked: Private IP address', { hostname, resolvedIP, mode });
      return {
        valid: false,
        reason: mode === 'strict'
          ? 'Private IP addresses not allowed'
          : 'Private IP addresses not allowed (use WEBHOOK_SECURITY_MODE=permissive if needed)'
      };
    }

    // Step 7: IPv6 private address check (strict & moderate modes)
    if (SSRFProtection.isPrivateOrMappedIpv6(resolvedIP)) {
      logger.warn('SSRF blocked: IPv6 private address', {
        hostname,
        resolvedIP,
        mode
      });
      return { valid: false, reason: 'IPv6 private address not allowed' };
    }

    return { valid: true };
  }

  /**
   * Build a dns lookup callback that always resolves to the given, already
   * validated addresses, regardless of hostname. Shared by
   * {@link createPinnedAgents} (axios/http.Agent callers) and
   * {@link createPinnedFetch} (undici/fetch callers).
   */
  private static buildPinnedLookup(addresses: Array<{ address: string; family: 4 | 6 }>) {
    return (_hostname: string, options: any, callback: any): void => {
      // Node's lookup contract: when options.all is true, callback receives
      // an array of {address, family}; otherwise (address, family) for the
      // first candidate. validateWebhookUrl resolved and validated the full
      // set — return all of it for `all`, and the first for the scalar shape.
      if (options && options.all) {
        callback(null, addresses.map(a => ({ address: a.address, family: a.family })));
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    };
  }

  /**
   * Build a pair of HTTP/HTTPS agents that resolve every hostname to a fixed
   * set of validated addresses via a custom dns lookup callback. Pair with
   * {@link validateWebhookUrl} so the transport only ever connects to
   * addresses that were just validated, regardless of what subsequent DNS
   * queries would return.
   *
   * `addresses` should be the full, ordered set from
   * {@link WebhookUrlValidationResult.addresses}, not just the first answer.
   * Passing every validated candidate lets `net.connect`'s Happy-Eyeballs
   * fallback (`autoSelectFamily`) try each one in turn — e.g. when `localhost`
   * resolves to `::1` first but the server only listens on IPv4 — instead of
   * hard-failing on a single pinned address (#978/#989/#990).
   *
   * @security GHSA-cmrh-wvq6-wm9r
   */
  static createPinnedAgents(addresses: Array<{ address: string; family: 4 | 6 }>): PinnedAgents {
    if (!addresses || addresses.length === 0) {
      throw new Error('createPinnedAgents requires at least one validated address');
    }

    const pinnedLookup = SSRFProtection.buildPinnedLookup(addresses);

    const httpAgent = new http.Agent({ keepAlive: false });
    const httpsAgent = new https.Agent({ keepAlive: false });

    // http.Agent stores agent-level options but does NOT forward `lookup` to
    // net.createConnection. Override createConnection so every socket gets
    // the pinned resolver.
    const wrap = <A extends http.Agent>(agent: A): A => {
      const proto = Object.getPrototypeOf(agent);
      const original = proto.createConnection;
      (agent as any).createConnection = function (options: any, cb: any) {
        const connectOptions: any = { ...options, lookup: pinnedLookup };
        // Try every pinned candidate (Happy-Eyeballs) instead of hard-failing
        // on the first — all candidates already passed SSRF validation, so
        // this doesn't weaken the pinning guarantee. Guarded for Node
        // runtimes that predate autoSelectFamily.
        if (supportsAutoSelectFamily) {
          connectOptions.autoSelectFamily = true;
          connectOptions.autoSelectFamilyAttemptTimeout = 250;
        }
        return original.call(this, connectOptions, cb);
      };
      // Expose for tests; not load-bearing at runtime.
      (agent as any).options = { ...((agent as any).options || {}), lookup: pinnedLookup };
      return agent;
    };

    return {
      httpAgent: wrap(httpAgent),
      httpsAgent: wrap(httpsAgent),
    };
  }

  /**
   * A fetch implementation whose sockets only ever connect to the given
   * validated addresses. For callers that speak fetch (the MCP SDK's
   * Streamable HTTP transport) rather than axios — see createPinnedAgents.
   * TLS still verifies against the URL hostname; only name resolution is pinned.
   *
   * Redirects are never followed (`redirect: 'manual'`). Pinning constrains
   * the addresses of the URL the caller asked for; a 3xx would hand the
   * choice of the next request's host, port and path to the server, and
   * undici would re-resolve it through the same pinned lookup — reaching a
   * different port on a validated address, or a URL that never went through
   * validateWebhookUrl at all. The 3xx is returned to the caller as an
   * ordinary non-ok response instead.
   *
   * @security GHSA-cmrh-wvq6-wm9r
   */
  static createPinnedFetch(addresses: Array<{ address: string; family: 4 | 6 }>): PinnedFetch {
    if (!addresses || addresses.length === 0) {
      throw new Error('createPinnedFetch requires at least one validated address');
    }
    const lookup = SSRFProtection.buildPinnedLookup(addresses);
    const dispatcher = new UndiciAgent({
      // `connect` options are spread into net.connect/tls.connect by undici.
      connect: { lookup, autoSelectFamily: supportsAutoSelectFamily, autoSelectFamilyAttemptTimeout: 250 } as any,
      keepAliveTimeout: 1_000,
    });
    return {
      fetch: (url, init) =>
        undiciFetch(url as any, { ...(init as any), dispatcher, redirect: 'manual' }) as unknown as Promise<Response>,
      close: () => dispatcher.close(),
    };
  }

  /**
   * Synchronous URL validation with no DNS resolution.
   *
   * Suitable for sync callers that cannot await DNS lookups. Pair with
   * {@link validateWebhookUrl} at async boundaries for full protection.
   *
   * @param urlString - URL to validate (raw input, not parsed)
   * @returns Validation result with optional reason on failure
   *
   * @security See GHSA-4ggg-h7ph-26qr.
   */
  static validateUrlSync(urlString: string): { valid: boolean; reason?: string } {
    if (typeof urlString !== 'string' || urlString.includes('#')) {
      return { valid: false, reason: 'URL fragments are not allowed' };
    }

    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      return { valid: false, reason: 'Invalid URL format' };
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, reason: 'Invalid protocol. Only HTTP/HTTPS allowed.' };
    }

    if (url.username !== '' || url.password !== '') {
      return { valid: false, reason: 'Userinfo in URL is not allowed' };
    }

    let hostname = url.hostname.toLowerCase();
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1);
    }

    if (CLOUD_METADATA.has(hostname)) {
      return { valid: false, reason: 'Cloud metadata endpoint blocked' };
    }

    // All-mode IPv6 tunneling gate — rejects tunneled metadata and
    // non-canonical tunneling prefixes before the permissive early-return.
    const tunneledReason = SSRFProtection.tunneledIPv6BlockReason(hostname);
    if (tunneledReason !== null) {
      return { valid: false, reason: tunneledReason };
    }

    const mode: SecurityMode = (process.env.WEBHOOK_SECURITY_MODE || 'strict') as SecurityMode;

    if (mode === 'permissive') {
      return { valid: true };
    }

    if (mode === 'strict' && LOCALHOST_PATTERNS.has(hostname)) {
      return { valid: false, reason: 'Localhost access is blocked in strict mode' };
    }

    // SECURITY (#984): PRIVATE_IP_RANGES are prefix regexes, so gate them on
    // isIPv4 — otherwise a DNS name like `247.example.com` is misread as an
    // IPv4 literal and wrongly refused. What a name resolves to is still
    // checked by the async validateWebhookUrl and the DNS-pinned agents.
    if (isIPv4(hostname) && PRIVATE_IP_RANGES.some(regex => regex.test(hostname))) {
      return {
        valid: false,
        reason: mode === 'strict'
          ? 'Private IP addresses not allowed'
          : 'Private IP addresses not allowed (use WEBHOOK_SECURITY_MODE=permissive if needed)'
      };
    }

    // SECURITY (GHSA-56c3-vfp2-5qqj): reject IPv4-mapped and private IPv6
    // addresses. Without this, hostnames like `::ffff:169.254.169.254` or
    // `::ffff:127.0.0.1` pass the IPv4-only checks above and reach the HTTP
    // client.
    if (SSRFProtection.isPrivateOrMappedIpv6(hostname)) {
      return { valid: false, reason: 'IPv6 private/mapped address not allowed' };
    }

    return { valid: true };
  }
}
