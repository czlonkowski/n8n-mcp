import { URL } from 'url';
import { lookup } from 'dns/promises';
import { isIPv6 } from 'net';
import http from 'http';
import https from 'https';
import ipaddr from 'ipaddr.js';
import { logger } from './logger';

export interface PinnedAgents {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}

export interface WebhookUrlValidationResult {
  valid: boolean;
  reason?: string;
  address?: string;
  family?: 4 | 6;
}

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
];

export class SSRFProtection {
  /**
   * IPv6 addresses that must be blocked: loopback, unspecified, link-local,
   * unique-local, site-local (deprecated), IPv4-mapped, IPv4-compatible, and
   * any IPv6→IPv4 tunneling address (NAT64, 6to4, Teredo) whose embedded IPv4
   * is private or a cloud-metadata endpoint. Tunneling prefixes with a public
   * embedded IPv4 are allowed so legitimate DNS64/NAT64 environments work.
   *
   * Hostname must be lowercased and bracket-stripped. WHATWG URL parser
   * canonicalizes IPv6 literals (zero compression, dotted-quad → hex pairs),
   * so prefix matching works against the normalized form.
   *
   * @security See GHSA-56c3-vfp2-5qqj. The sync validator previously had no
   * IPv6 gate, letting `::ffff:169.254.169.254`, `::169.254.169.254`,
   * `2002:a9fe:a9fe::`, and `64:ff9b::a9fe:a9fe` reach the HTTP client.
   */
  private static isPrivateOrMappedIpv6(hostname: string): boolean {
    // Gate on net.isIPv6 so domain names starting with hex-like labels
    // (e.g. "fcexample.com") are never misclassified as private IPv6.
    if (!isIPv6(hostname)) return false;

    // ::/96 reserved block: unspecified (`::`), loopback (`::1`), IPv4-mapped
    // (`::ffff:X`), and deprecated IPv4-compatible (`::X:Y` per RFC 4291) all
    // live here. Blocking the whole prefix avoids enumerating subforms.
    if (hostname.startsWith('::')) return true;

    // Defensive long-form IPv4-mapped — WHATWG URL normally compresses this,
    // but keep the check in case normalization ever changes.
    if (hostname.startsWith('0:0:0:0:0:ffff:')) return true;

    // Link-local fe80::/10
    if (hostname.startsWith('fe80:')) return true;

    // Site-local fec0::/10 (deprecated, RFC 3879) — still honored by some stacks.
    if (/^fe[c-f]/.test(hostname)) return true;

    // Unique local fc00::/7 (RFC 4193). Covers fc00-fdff in the first hextet.
    if (/^f[cd]/.test(hostname)) return true;

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

      // Step 3: Resolve DNS to get actual IP address
      // This prevents DNS rebinding attacks where hostname resolves to different IPs
      let resolvedIP: string;
      let resolvedFamily: 4 | 6;
      try {
        const { address, family } = await lookup(hostname);
        resolvedIP = address;
        resolvedFamily = family === 6 ? 6 : 4;

        logger.debug('DNS resolved for SSRF check', { hostname, resolvedIP, mode });
      } catch (error) {
        logger.warn('DNS resolution failed for webhook URL', {
          hostname,
          error: error instanceof Error ? error.message : String(error)
        });
        return { valid: false, reason: 'DNS resolution failed' };
      }

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
        logger.warn('SSRF protection in permissive mode (localhost and private IPs allowed)', {
          hostname,
          resolvedIP
        });
        return { valid: true, address: resolvedIP, family: resolvedFamily };
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
        return { valid: true, address: resolvedIP, family: resolvedFamily };
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

      return { valid: true, address: resolvedIP, family: resolvedFamily };
    } catch (error) {
      return { valid: false, reason: 'Invalid URL format' };
    }
  }

  /**
   * Build a pair of HTTP/HTTPS agents that resolve every hostname to a fixed
   * IP via a custom dns lookup callback. Pair with {@link validateWebhookUrl}
   * so the transport connects to the IP that was just validated, regardless
   * of what subsequent DNS queries would return.
   *
   * @security GHSA-cmrh-wvq6-wm9r
   */
  static createPinnedAgents(address: string, family: 4 | 6): PinnedAgents {
    const pinnedLookup = (
      _hostname: string,
      options: any,
      callback: any
    ): void => {
      // Node's lookup contract: when options.all is true, callback receives
      // an array of {address, family}; otherwise (address, family).
      // validateWebhookUrl resolved a single IP — return that for both shapes.
      if (options && options.all) {
        callback(null, [{ address, family }]);
      } else {
        callback(null, address, family);
      }
    };

    const httpAgent = new http.Agent({ keepAlive: false });
    const httpsAgent = new https.Agent({ keepAlive: false });

    // http.Agent stores agent-level options but does NOT forward `lookup` to
    // net.createConnection. Override createConnection so every socket gets
    // the pinned resolver.
    const wrap = <A extends http.Agent>(agent: A): A => {
      const proto = Object.getPrototypeOf(agent);
      const original = proto.createConnection;
      (agent as any).createConnection = function (options: any, cb: any) {
        return original.call(this, { ...options, lookup: pinnedLookup }, cb);
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

    if (PRIVATE_IP_RANGES.some(regex => regex.test(hostname))) {
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
