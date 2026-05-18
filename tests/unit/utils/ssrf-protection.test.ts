import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dns module before importing SSRFProtection
vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

import { SSRFProtection } from '../../../src/utils/ssrf-protection';
import * as dns from 'dns/promises';

/**
 * Unit tests for SSRFProtection with configurable security modes
 *
 * SECURITY: These tests verify SSRF protection blocks malicious URLs in all modes
 * See: https://github.com/czlonkowski/n8n-mcp/issues/265 (HIGH-03)
 */
describe('SSRFProtection', () => {
  const originalEnv = process.env.WEBHOOK_SECURITY_MODE;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    // Default mock: simulate real DNS behavior - return the hostname as IP if it looks like an IP
    vi.mocked(dns.lookup).mockImplementation(async (hostname: any) => {
      // Handle special hostname "localhost"
      if (hostname === 'localhost') {
        return { address: '127.0.0.1', family: 4 } as any;
      }

      // If hostname is an IP address, return it as-is (simulating real DNS behavior)
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      const ipv6Regex = /^([0-9a-fA-F]{0,4}:)+[0-9a-fA-F]{0,4}$/;

      if (ipv4Regex.test(hostname)) {
        return { address: hostname, family: 4 } as any;
      }
      if (ipv6Regex.test(hostname) || hostname === '::1') {
        return { address: hostname, family: 6 } as any;
      }

      // For actual hostnames, return a public IP by default
      return { address: '8.8.8.8', family: 4 } as any;
    });
  });

  afterEach(() => {
    // Restore original environment
    if (originalEnv) {
      process.env.WEBHOOK_SECURITY_MODE = originalEnv;
    } else {
      delete process.env.WEBHOOK_SECURITY_MODE;
    }
    vi.restoreAllMocks();
  });

  describe('Strict Mode (default)', () => {
    beforeEach(() => {
      delete process.env.WEBHOOK_SECURITY_MODE; // Use default strict
    });

    it('should block localhost', async () => {
      const localhostURLs = [
        'http://localhost:3000/webhook',
        'http://127.0.0.1/webhook',
        'http://[::1]/webhook',
      ];

      for (const url of localhostURLs) {
        const result = await SSRFProtection.validateWebhookUrl(url);
        expect(result.valid, `URL ${url} should be blocked but was valid`).toBe(false);
        expect(result.reason, `URL ${url} should have a reason`).toBeDefined();
      }
    });

    it('should block AWS metadata endpoint', async () => {
      const result = await SSRFProtection.validateWebhookUrl('http://169.254.169.254/latest/meta-data');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Cloud metadata');
    });

    it('should block GCP metadata endpoint', async () => {
      const result = await SSRFProtection.validateWebhookUrl('http://metadata.google.internal/computeMetadata/v1/');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Cloud metadata');
    });

    it('should block Alibaba Cloud metadata endpoint', async () => {
      const result = await SSRFProtection.validateWebhookUrl('http://100.100.100.200/latest/meta-data');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Cloud metadata');
    });

    it('should block Oracle Cloud metadata endpoint', async () => {
      const result = await SSRFProtection.validateWebhookUrl('http://192.0.0.192/opc/v2/instance/');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Cloud metadata');
    });

    it('should block private IP ranges', async () => {
      const privateIPs = [
        'http://10.0.0.1/webhook',
        'http://192.168.1.1/webhook',
        'http://172.16.0.1/webhook',
        'http://172.31.255.255/webhook',
      ];

      for (const url of privateIPs) {
        const result = await SSRFProtection.validateWebhookUrl(url);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Private IP');
      }
    });

    it('should allow public URLs', async () => {
      const publicURLs = [
        'https://hooks.example.com/webhook',
        'https://api.external.com/callback',
        'http://public-service.com:8080/hook',
      ];

      for (const url of publicURLs) {
        const result = await SSRFProtection.validateWebhookUrl(url);
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
      }
    });

    it('should block non-HTTP protocols', async () => {
      const invalidProtocols = [
        'file:///etc/passwd',
        'ftp://internal-server/file',
        'gopher://old-service',
      ];

      for (const url of invalidProtocols) {
        const result = await SSRFProtection.validateWebhookUrl(url);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('protocol');
      }
    });
  });

  describe('Moderate Mode', () => {
    beforeEach(() => {
      process.env.WEBHOOK_SECURITY_MODE = 'moderate';
    });

    it('should allow localhost', async () => {
      const localhostURLs = [
        'http://localhost:5678/webhook',
        'http://127.0.0.1:5678/webhook',
        'http://[::1]:5678/webhook',
      ];

      for (const url of localhostURLs) {
        const result = await SSRFProtection.validateWebhookUrl(url);
        expect(result.valid).toBe(true);
      }
    });

    it('should still block private IPs', async () => {
      const privateIPs = [
        'http://10.0.0.1/webhook',
        'http://192.168.1.1/webhook',
        'http://172.16.0.1/webhook',
      ];

      for (const url of privateIPs) {
        const result = await SSRFProtection.validateWebhookUrl(url);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Private IP');
      }
    });

    it('should still block cloud metadata', async () => {
      const metadataURLs = [
        'http://169.254.169.254/latest/meta-data',
        'http://metadata.google.internal/computeMetadata/v1/',
      ];

      for (const url of metadataURLs) {
        const result = await SSRFProtection.validateWebhookUrl(url);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('metadata');
      }
    });

    it('should allow public URLs', async () => {
      const result = await SSRFProtection.validateWebhookUrl('https://api.example.com/webhook');
      expect(result.valid).toBe(true);
    });
  });

  describe('Permissive Mode', () => {
    beforeEach(() => {
      process.env.WEBHOOK_SECURITY_MODE = 'permissive';
    });

    it('should allow localhost', async () => {
      const result = await SSRFProtection.validateWebhookUrl('http://localhost:5678/webhook');
      expect(result.valid).toBe(true);
    });

    it('should allow private IPs', async () => {
      const privateIPs = [
        'http://10.0.0.1/webhook',
        'http://192.168.1.1/webhook',
        'http://172.16.0.1/webhook',
      ];

      for (const url of privateIPs) {
        const result = await SSRFProtection.validateWebhookUrl(url);
        expect(result.valid).toBe(true);
      }
    });

    it('should still block cloud metadata', async () => {
      const metadataURLs = [
        'http://169.254.169.254/latest/meta-data',
        'http://metadata.google.internal/computeMetadata/v1/',
        'http://169.254.170.2/v2/metadata',
      ];

      for (const url of metadataURLs) {
        const result = await SSRFProtection.validateWebhookUrl(url);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('metadata');
      }
    });

    // The "metadata blocked in all modes" promise must hold for IPv6-tunneled
    // metadata too — otherwise permissive mode lets an attacker reach IMDS via
    // `64:ff9b::169.254.169.254` and equivalents.
    it.each([
      ['http://[64:ff9b::a9fe:a9fe]/',     'NAT64 RFC 6052'],
      ['http://[64:ff9b:1::a9fe:a9fe]/',   'NAT64 RFC 8215'],
      ['http://[2002:a9fe:a9fe::]/',       '6to4'],
      ['http://[2001::5601:5601]/',        'Teredo (XOR)'],
    ])('blocks tunneled cloud metadata in permissive sync mode: %s (%s)', (url) => {
      const result = SSRFProtection.validateUrlSync(url);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Cloud metadata endpoint blocked');
    });

    it.each([
      ['64:ff9b::a9fe:a9fe',   'NAT64 RFC 6052'],
      ['64:ff9b:1::a9fe:a9fe', 'NAT64 RFC 8215'],
      ['2002:a9fe:a9fe::',     '6to4'],
      ['2001::5601:5601',      'Teredo (XOR)'],
    ])('blocks tunneled cloud metadata via DNS in permissive async mode: %s (%s)', async (address) => {
      vi.mocked(dns.lookup).mockResolvedValue({ address, family: 6 } as any);
      const result = await SSRFProtection.validateWebhookUrl('http://evil-domain.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('metadata');
    });

    // The fail-safe stance for non-canonical tunneling prefixes must also hold
    // in permissive mode — refusing to guess where an unknown wire format will
    // route is mode-independent.
    it.each([
      ['http://[64:ff9b:2::1]',             'unknown 64:ff9b: sub-prefix'],
      ['http://[64:ff9b:1:a9fe:a9:fe00::]', '/48 RFC 6052 embedding shape'],
    ])('blocks non-canonical tunneling in permissive sync mode: %s (%s)', (url) => {
      const result = SSRFProtection.validateUrlSync(url);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('IPv6 private/mapped address not allowed');
    });

    it.each([
      ['64:ff9b:2::1',             'unknown 64:ff9b: sub-prefix'],
      ['64:ff9b:1:a9fe:a9:fe00::', '/48 RFC 6052 embedding shape'],
    ])('blocks non-canonical tunneling via DNS in permissive async mode: %s (%s)', async (address) => {
      vi.mocked(dns.lookup).mockResolvedValue({ address, family: 6 } as any);
      const result = await SSRFProtection.validateWebhookUrl('http://evil-domain.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('IPv6 private/mapped address not allowed');
    });

    it('should allow public URLs', async () => {
      const result = await SSRFProtection.validateWebhookUrl('https://api.example.com/webhook');
      expect(result.valid).toBe(true);
    });
  });

  describe('DNS Rebinding Prevention', () => {
    it('should block hostname resolving to private IP (strict mode)', async () => {
      delete process.env.WEBHOOK_SECURITY_MODE; // strict

      // Mock DNS lookup to return private IP
      vi.mocked(dns.lookup).mockResolvedValue({ address: '10.0.0.1', family: 4 } as any);

      const result = await SSRFProtection.validateWebhookUrl('http://evil.example.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Private IP');
    });

    it('should block hostname resolving to private IP (moderate mode)', async () => {
      process.env.WEBHOOK_SECURITY_MODE = 'moderate';

      // Mock DNS lookup to return private IP
      vi.mocked(dns.lookup).mockResolvedValue({ address: '192.168.1.100', family: 4 } as any);

      const result = await SSRFProtection.validateWebhookUrl('http://internal.company.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Private IP');
    });

    it('should allow hostname resolving to private IP (permissive mode)', async () => {
      process.env.WEBHOOK_SECURITY_MODE = 'permissive';

      // Mock DNS lookup to return private IP
      vi.mocked(dns.lookup).mockResolvedValue({ address: '192.168.1.100', family: 4 } as any);

      const result = await SSRFProtection.validateWebhookUrl('http://internal.company.com/webhook');
      expect(result.valid).toBe(true);
    });

    it('should block hostname resolving to cloud metadata (all modes)', async () => {
      const modes = ['strict', 'moderate', 'permissive'];

      for (const mode of modes) {
        process.env.WEBHOOK_SECURITY_MODE = mode;

        // Mock DNS lookup to return cloud metadata IP
        vi.mocked(dns.lookup).mockResolvedValue({ address: '169.254.169.254', family: 4 } as any);

        const result = await SSRFProtection.validateWebhookUrl('http://evil-domain.com/webhook');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('metadata');
      }
    });

    it('should block hostname resolving to localhost IP (strict mode)', async () => {
      delete process.env.WEBHOOK_SECURITY_MODE; // strict

      // Mock DNS lookup to return localhost IP
      vi.mocked(dns.lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 } as any);

      const result = await SSRFProtection.validateWebhookUrl('http://suspicious-domain.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    // DNS64 environments synthesize a NAT64 AAAA record on the fly. On Node 17+
    // verbatim DNS ordering returns the NAT64 address first, so legitimate
    // public-IPv4 servers must work via this path.
    it('allows hostname resolving to NAT64-wrapped public IPv4 (strict mode)', async () => {
      delete process.env.WEBHOOK_SECURITY_MODE; // strict
      vi.mocked(dns.lookup).mockResolvedValue({ address: '64:ff9b::808:808', family: 6 } as any);

      const result = await SSRFProtection.validateWebhookUrl('https://n8n.example.com/api/v1/workflows');
      expect(result.valid).toBe(true);
      expect(result.address).toBe('64:ff9b::808:808');
      expect(result.family).toBe(6);
    });

    // DNS rebinding via tunneling prefixes: attacker resolves a public hostname
    // to a NAT64/6to4 address whose embedded IPv4 is private/metadata. Must be
    // blocked in every mode where the embedded IPv4 would itself be blocked.
    it.each([
      ['strict',   '64:ff9b::a9fe:a9fe', 'NAT64-wrapped metadata IPv4'],
      ['moderate', '64:ff9b::a00:1',     'NAT64-wrapped 10.0.0.1 (RFC1918)'],
      ['strict',   '2002:a9fe:a9fe::',   '6to4-wrapped metadata IPv4'],
    ])('blocks hostname resolving to %s mode: %s (%s)', async (mode, address) => {
      if (mode === 'strict') {
        delete process.env.WEBHOOK_SECURITY_MODE;
      } else {
        process.env.WEBHOOK_SECURITY_MODE = mode;
      }
      vi.mocked(dns.lookup).mockResolvedValue({ address, family: 6 } as any);

      const result = await SSRFProtection.validateWebhookUrl('http://evil-domain.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe('IPv6 Protection', () => {
    it('should block IPv6 localhost (strict mode)', async () => {
      delete process.env.WEBHOOK_SECURITY_MODE; // strict

      // Mock DNS to return IPv6 localhost
      vi.mocked(dns.lookup).mockResolvedValue({ address: '::1', family: 6 } as any);

      const result = await SSRFProtection.validateWebhookUrl('http://ipv6-test.com/webhook');
      expect(result.valid).toBe(false);
      // Updated: IPv6 localhost is now caught by the localhost check, not IPv6 check
      expect(result.reason).toContain('Localhost');
    });

    it('should block IPv6 link-local (strict mode)', async () => {
      delete process.env.WEBHOOK_SECURITY_MODE; // strict

      // Mock DNS to return IPv6 link-local
      vi.mocked(dns.lookup).mockResolvedValue({ address: 'fe80::1', family: 6 } as any);

      const result = await SSRFProtection.validateWebhookUrl('http://ipv6-local.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('IPv6 private');
    });

    it('should block IPv6 unique local (strict mode)', async () => {
      delete process.env.WEBHOOK_SECURITY_MODE; // strict

      // Mock DNS to return IPv6 unique local
      vi.mocked(dns.lookup).mockResolvedValue({ address: 'fc00::1', family: 6 } as any);

      const result = await SSRFProtection.validateWebhookUrl('http://ipv6-internal.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('IPv6 private');
    });

    it('should block IPv6 unique local fd00::/8 (strict mode)', async () => {
      delete process.env.WEBHOOK_SECURITY_MODE; // strict

      // Mock DNS to return IPv6 unique local fd00::/8
      vi.mocked(dns.lookup).mockResolvedValue({ address: 'fd00::1', family: 6 } as any);

      const result = await SSRFProtection.validateWebhookUrl('http://ipv6-fd00.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('IPv6 private');
    });

    it('should block IPv6 unspecified address (strict mode)', async () => {
      delete process.env.WEBHOOK_SECURITY_MODE; // strict

      // Mock DNS to return IPv6 unspecified address
      vi.mocked(dns.lookup).mockResolvedValue({ address: '::', family: 6 } as any);

      const result = await SSRFProtection.validateWebhookUrl('http://ipv6-unspecified.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('IPv6 private');
    });

    it('should block IPv4-mapped IPv6 addresses (strict mode)', async () => {
      delete process.env.WEBHOOK_SECURITY_MODE; // strict

      // Mock DNS to return IPv4-mapped IPv6 address
      vi.mocked(dns.lookup).mockResolvedValue({ address: '::ffff:127.0.0.1', family: 6 } as any);

      const result = await SSRFProtection.validateWebhookUrl('http://ipv4-mapped.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('IPv6 private');
    });
  });

  describe('DNS Resolution Failures', () => {
    it('should handle DNS resolution failure gracefully', async () => {
      // Mock DNS lookup to fail
      vi.mocked(dns.lookup).mockRejectedValue(new Error('ENOTFOUND'));

      const result = await SSRFProtection.validateWebhookUrl('http://non-existent-domain.invalid/webhook');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('DNS resolution failed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed URLs', async () => {
      const malformedURLs = [
        'not-a-url',
        'http://',
        '://missing-protocol.com',
      ];

      for (const url of malformedURLs) {
        const result = await SSRFProtection.validateWebhookUrl(url);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Invalid URL format');
      }
    });

    it('should handle URL with special characters safely', async () => {
      const result = await SSRFProtection.validateWebhookUrl('https://example.com/webhook?param=value&other=123');
      expect(result.valid).toBe(true);
    });
  });

  /**
   * Sync URL validation — verifies the sync guard that runs inside
   * validateInstanceContext and must not make any DNS calls.
   */
  describe('validateUrlSync', () => {
    beforeEach(() => {
      delete process.env.WEBHOOK_SECURITY_MODE;
    });

    it('should reject URL with trailing fragment', () => {
      const result = SSRFProtection.validateUrlSync('http://169.254.169.254#');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('URL fragments are not allowed');
    });

    it('should reject HTTPS variant with trailing fragment', () => {
      const result = SSRFProtection.validateUrlSync('https://169.254.169.254#');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('URL fragments are not allowed');
    });

    it('should reject fragment with content after the hash', () => {
      const result = SSRFProtection.validateUrlSync('http://n8n.example.com#trailing');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('URL fragments are not allowed');
    });

    it('should reject URLs with userinfo', () => {
      const result = SSRFProtection.validateUrlSync('http://user:pass@n8n.example.com');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Userinfo in URL is not allowed');
    });

    it('should reject URLs with username only', () => {
      const result = SSRFProtection.validateUrlSync('http://user@n8n.example.com');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Userinfo in URL is not allowed');
    });

    it('should reject AWS/Azure metadata endpoint in all modes', () => {
      for (const mode of ['strict', 'moderate', 'permissive']) {
        process.env.WEBHOOK_SECURITY_MODE = mode;
        const result = SSRFProtection.validateUrlSync('http://169.254.169.254');
        expect(result.valid, `mode=${mode}`).toBe(false);
        expect(result.reason).toBe('Cloud metadata endpoint blocked');
      }
    });

    it('should reject all cloud metadata endpoints in all modes', () => {
      const metadataUrls = [
        'http://169.254.170.2',         // AWS ECS
        'http://metadata.google.internal', // GCP
        'http://metadata',                 // GCP short
        'http://100.100.100.200',          // Alibaba
        'http://192.0.0.192',              // Oracle
      ];
      for (const mode of ['strict', 'moderate', 'permissive']) {
        process.env.WEBHOOK_SECURITY_MODE = mode;
        for (const url of metadataUrls) {
          const result = SSRFProtection.validateUrlSync(url);
          expect(result.valid, `url=${url} mode=${mode}`).toBe(false);
          expect(result.reason).toBe('Cloud metadata endpoint blocked');
        }
      }
    });

    it('should reject private IPv4 literals in strict mode', () => {
      delete process.env.WEBHOOK_SECURITY_MODE; // strict default
      const privateUrls = [
        'http://10.0.0.1',
        'http://192.168.1.1',
        'http://172.16.0.1',
        'http://172.31.255.255',
      ];
      for (const url of privateUrls) {
        const result = SSRFProtection.validateUrlSync(url);
        expect(result.valid, `url=${url}`).toBe(false);
        expect(result.reason).toContain('Private IP');
      }
    });

    it('should reject private IPv4 literals in moderate mode', () => {
      process.env.WEBHOOK_SECURITY_MODE = 'moderate';
      const result = SSRFProtection.validateUrlSync('http://10.0.0.1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Private IP');
    });

    it('should allow private IPv4 literals in permissive mode', () => {
      process.env.WEBHOOK_SECURITY_MODE = 'permissive';
      const result = SSRFProtection.validateUrlSync('http://10.0.0.1');
      expect(result.valid).toBe(true);
    });

    it('should reject localhost literals in strict mode', () => {
      delete process.env.WEBHOOK_SECURITY_MODE;
      const localhostUrls = [
        'http://localhost',
        'http://127.0.0.1',
        'http://0.0.0.0',
      ];
      for (const url of localhostUrls) {
        const result = SSRFProtection.validateUrlSync(url);
        expect(result.valid, `url=${url}`).toBe(false);
      }
    });

    it('should allow localhost literals in moderate and permissive modes', () => {
      for (const mode of ['moderate', 'permissive']) {
        process.env.WEBHOOK_SECURITY_MODE = mode;
        const result = SSRFProtection.validateUrlSync('http://localhost:5678');
        expect(result.valid, `mode=${mode}`).toBe(true);
      }
    });

    it('should reject non-http(s) protocols', () => {
      const badProtocols = [
        'file:///etc/passwd',
        'gopher://example.com',
        'ftp://example.com',
        'data:text/plain;base64,aGVsbG8=',
      ];
      for (const url of badProtocols) {
        const result = SSRFProtection.validateUrlSync(url);
        expect(result.valid, `url=${url}`).toBe(false);
        expect(result.reason).toContain('protocol');
      }
    });

    it('should reject malformed URLs', () => {
      const malformed = ['not-a-url', 'http://', '://missing-protocol.com', ''];
      for (const url of malformed) {
        const result = SSRFProtection.validateUrlSync(url);
        expect(result.valid, `url=${url}`).toBe(false);
      }
    });

    it('should accept valid public URLs', () => {
      const validUrls = [
        'https://n8n.example.com',
        'https://n8n.example.com/api/v1',
        'https://n8n.example.com:8443',
        'http://n8n.example.com/path?query=1',
      ];
      for (const url of validUrls) {
        const result = SSRFProtection.validateUrlSync(url);
        expect(result.valid, `url=${url}`).toBe(true);
        expect(result.reason).toBeUndefined();
      }
    });

    it('should not perform DNS resolution', () => {
      // Spin through a representative set; dns.lookup must never be called.
      SSRFProtection.validateUrlSync('https://n8n.example.com');
      SSRFProtection.validateUrlSync('http://169.254.169.254');
      SSRFProtection.validateUrlSync('http://10.0.0.1');
      SSRFProtection.validateUrlSync('http://localhost');
      SSRFProtection.validateUrlSync('http://evil.example.com#');
      expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(0);
    });

    it('should reject non-string input safely', () => {
      // @ts-expect-error testing runtime guard
      const result = SSRFProtection.validateUrlSync(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('URL fragments are not allowed');
    });

    // GHSA-56c3-vfp2-5qqj — IPv4-mapped IPv6 and private IPv6 addresses
    // were skipped by the IPv4-only checks, enabling SSRF to cloud metadata,
    // RFC1918 networks, and localhost via SDK embedders.
    describe('IPv6 private and IPv4-mapped addresses (GHSA-56c3-vfp2-5qqj)', () => {
      it('should reject IPv4-mapped IPv6 cloud metadata and private ranges in strict and moderate modes', () => {
        const payloads = [
          'http://[::ffff:169.254.169.254]', // AWS/Azure IMDS via IPv4-mapped
          'http://[::ffff:127.0.0.1]:5678',  // localhost via IPv4-mapped
          'http://[::ffff:10.0.0.1]',        // RFC1918 10.x
          'http://[::ffff:192.168.1.1]',     // RFC1918 192.168.x
          'http://[::ffff:172.16.0.1]',      // RFC1918 172.16.x
        ];
        for (const mode of ['strict', 'moderate']) {
          process.env.WEBHOOK_SECURITY_MODE = mode;
          for (const url of payloads) {
            const result = SSRFProtection.validateUrlSync(url);
            expect(result.valid, `url=${url} mode=${mode}`).toBe(false);
            expect(result.reason).toBe('IPv6 private/mapped address not allowed');
          }
        }
      });

      it('should reject long-form IPv4-mapped IPv6 localhost', () => {
        delete process.env.WEBHOOK_SECURITY_MODE;
        const result = SSRFProtection.validateUrlSync('http://[0:0:0:0:0:ffff:7f00:1]');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('IPv6 private/mapped address not allowed');
      });

      it('should reject private IPv6 addresses in strict and moderate modes', () => {
        const payloads = [
          'http://[::1]',        // IPv6 loopback (strict hits LOCALHOST_PATTERNS first)
          'http://[fe80::1]',    // Link-local
          'http://[fc00::1]',    // Unique local (literal fc00:)
          'http://[fd00::1]',    // Unique local (literal fd00:)
        ];
        for (const mode of ['strict', 'moderate']) {
          process.env.WEBHOOK_SECURITY_MODE = mode;
          for (const url of payloads) {
            const result = SSRFProtection.validateUrlSync(url);
            expect(result.valid, `url=${url} mode=${mode}`).toBe(false);
          }
        }
      });

      it('should reject IPv4-compatible IPv6 (::X:Y) that embeds cloud metadata or private IPv4', () => {
        // WHATWG URL normalizes ::a.b.c.d into ::XXXX:YYYY hex form. The
        // low 32 bits can hold any IPv4 including IMDS/RFC1918/loopback.
        const payloads = [
          'http://[::169.254.169.254]',  // → ::a9fe:a9fe (AWS/Azure IMDS)
          'http://[::127.0.0.1]',        // → ::7f00:1 (loopback)
          'http://[::10.0.0.1]',         // → ::a00:1 (RFC1918)
        ];
        for (const url of payloads) {
          const result = SSRFProtection.validateUrlSync(url);
          expect(result.valid, `url=${url}`).toBe(false);
          expect(result.reason).toBe('IPv6 private/mapped address not allowed');
        }
      });

      it('should reject 6to4 (2002::/16) embedding cloud metadata IPv4', () => {
        const result = SSRFProtection.validateUrlSync('http://[2002:a9fe:a9fe::]');
        expect(result.valid).toBe(false);
        // Tunneled metadata is gated as metadata in all modes (including permissive)
        // rather than as a generic IPv6-private rejection.
        expect(result.reason).toBe('Cloud metadata endpoint blocked');
      });

      it('should reject NAT64 (64:ff9b::/96) embedding cloud metadata IPv4', () => {
        const result = SSRFProtection.validateUrlSync('http://[64:ff9b::a9fe:a9fe]');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Cloud metadata endpoint blocked');
      });

      it('should reject full fc00::/7 ULA range, not just fc00:/fd00: literals', () => {
        // RFC 4193: fc00::/7 spans fc00-fdff in the first hextet.
        const payloads = [
          'http://[fcba::1]',     // ULA outside literal fc00:
          'http://[fd12:3456::]', // ULA outside literal fd00:
        ];
        for (const url of payloads) {
          const result = SSRFProtection.validateUrlSync(url);
          expect(result.valid, `url=${url}`).toBe(false);
          expect(result.reason).toBe('IPv6 private/mapped address not allowed');
        }
      });

      it('should reject site-local fec0::/10 (deprecated, RFC 3879)', () => {
        const result = SSRFProtection.validateUrlSync('http://[fec0::1]');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('IPv6 private/mapped address not allowed');
      });

      it('should not false-positive on public IPv6 addresses', () => {
        // 2001:db8::/32 is the documentation range but is still parseable and
        // public-routable from the validator's perspective; must NOT be blocked.
        const publicPayloads = [
          'http://[2001:db8::1]',
          'http://[2606:4700:4700::1111]', // Cloudflare
          'http://[2620:0:2d0:200::7]',
        ];
        for (const url of publicPayloads) {
          const result = SSRFProtection.validateUrlSync(url);
          expect(result.valid, `url=${url}`).toBe(true);
        }
      });

      it('should not false-positive on domain names starting with hex-like labels', () => {
        // isPrivateOrMappedIpv6 gates on net.isIPv6; domain names with "fc"/"fd"
        // labels must not be misclassified as ULA.
        const domains = [
          'http://fcexample.com',
          'http://fdexample.com',
          'http://fec0example.com',
        ];
        for (const url of domains) {
          const result = SSRFProtection.validateUrlSync(url);
          expect(result.valid, `url=${url}`).toBe(true);
        }
      });

      it('should not perform DNS resolution for IPv6 payloads', () => {
        SSRFProtection.validateUrlSync('http://[::ffff:169.254.169.254]');
        SSRFProtection.validateUrlSync('http://[::ffff:127.0.0.1]:5678');
        SSRFProtection.validateUrlSync('http://[fe80::1]');
        SSRFProtection.validateUrlSync('http://[2002:a9fe:a9fe::]');
        SSRFProtection.validateUrlSync('http://[64:ff9b::a9fe:a9fe]');
        SSRFProtection.validateUrlSync('http://[64:ff9b::808:808]');
        SSRFProtection.validateUrlSync('http://[2001::f7f7:f7f7]');
        expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(0);
      });

      // IPv6 tunneling prefixes (NAT64 RFC 6052/8215, 6to4 RFC 3056, Teredo RFC 4380)
      // all embed an IPv4 address. The block decision depends on what that
      // embedded IPv4 is, not on the prefix family. Public-IPv4 tunneling is
      // legitimate (e.g. DNS64/NAT64 networks reaching public servers); only
      // private/metadata embeddings are dangerous. Tunneled metadata is gated
      // earlier than tunneled-private (so it surfaces the cloud-metadata
      // reason verbatim) because metadata is unconditionally blocked in every
      // mode, including permissive.
      describe('tunneled IPv4 (NAT64, 6to4, Teredo) — block when embedded IPv4 is metadata', () => {
        const metadataPayloads: Array<[string, string]> = [
          ['http://[64:ff9b::a9fe:a9fe]',   'IMDS via NAT64 RFC 6052'],
          ['http://[64:ff9b:1::a9fe:a9fe]', 'IMDS via NAT64 RFC 8215'],
          ['http://[2002:a9fe:a9fe::]',     'IMDS via 6to4'],
          // 169.254.169.254 → 0xa9fe^0xffff=0x5601 (both halves)
          ['http://[2001::5601:5601]',      'IMDS via Teredo'],
        ];
        it.each(metadataPayloads)('blocks %s (%s)', (url) => {
          const result = SSRFProtection.validateUrlSync(url);
          expect(result.valid).toBe(false);
          expect(result.reason).toBe('Cloud metadata endpoint blocked');
        });
      });

      describe('tunneled IPv4 (NAT64, 6to4, Teredo) — block when embedded IPv4 is private/loopback', () => {
        const privatePayloads: Array<[string, string]> = [
          // NAT64 RFC 6052 well-known /96 (64:ff9b::/96)
          ['http://[64:ff9b::7f00:1]',      'loopback via NAT64'],
          ['http://[64:ff9b::a00:1]',       '10.0.0.1 (RFC1918) via NAT64'],
          ['http://[64:ff9b::ac10:1]',      '172.16.0.1 (RFC1918) via NAT64'],
          ['http://[64:ff9b::c0a8:1]',      '192.168.0.1 (RFC1918) via NAT64'],
          // NAT64 RFC 8215 local-use /96 sub-prefix (64:ff9b:1::/96)
          ['http://[64:ff9b:1::7f00:1]',    'loopback via RFC 8215 NAT64'],
          // 6to4 RFC 3056 (2002::/16) — embedded IPv4 in bits 16-47
          ['http://[2002:7f00:1::]',        'loopback via 6to4'],
          ['http://[2002:a00:1::]',         'RFC1918 via 6to4'],
          // Teredo RFC 4380 (2001::/32) — client IPv4 in last 32 bits XOR 0xffff:0xffff
          // 127.0.0.1 → (0x7f00^0xffff=0x80ff, 0x0001^0xffff=0xfffe)
          ['http://[2001::80ff:fffe]',      'loopback via Teredo'],
          // 10.0.0.1 → (0x0a00^0xffff=0xf5ff, 0x0001^0xffff=0xfffe)
          ['http://[2001::f5ff:fffe]',      'RFC1918 via Teredo'],
        ];
        it.each(privatePayloads)('blocks %s (%s)', (url) => {
          const result = SSRFProtection.validateUrlSync(url);
          expect(result.valid).toBe(false);
          expect(result.reason).toBe('IPv6 private/mapped address not allowed');
        });
      });

      describe('tunneled IPv4 (NAT64, 6to4, Teredo) — allow when embedded IPv4 is public', () => {
        const allowedPayloads: Array<[string, string]> = [
          ['http://[64:ff9b::808:808]',   'Google DNS 8.8.8.8 via NAT64'],
          ['http://[64:ff9b::101:101]',   'Cloudflare 1.1.1.1 via NAT64'],
          ['http://[64:ff9b:1::808:808]', 'Google DNS via RFC 8215 NAT64'],
          ['http://[2002:808:808::]',     'Google DNS via 6to4'],
          // 8.8.8.8 → (0x0808^0xffff=0xf7f7, 0x0808^0xffff=0xf7f7)
          ['http://[2001::f7f7:f7f7]',    'Google DNS via Teredo'],
        ];
        it.each(allowedPayloads)('allows %s (%s)', (url) => {
          const result = SSRFProtection.validateUrlSync(url);
          expect(result.valid, `url=${url}`).toBe(true);
        });
      });

      it.each([
        // parts[2]=2 — neither well-known NAT64 (parts[2..5]==0) nor RFC 8215
        // local-use (parts[2]==1, parts[3..5]==0). Refuse to guess.
        ['http://[64:ff9b:2::1]',             'unknown 64:ff9b: sub-prefix'],
        // parts[2]==1 BUT parts[3]!=0 — would be a literal RFC 6052 /48
        // embedding (IPv4 split around a u-octet at bits 64-71). RFC 8215
        // §3.1 recommends /96 sub-prefixes over the /48 embedding precisely
        // because the latter is rarely deployed; we refuse rather than guess
        // which slot the OS NAT64 translator will read the IPv4 from.
        ['http://[64:ff9b:1:a9fe:a9:fe00::]', '/48 RFC 6052 embedding shape'],
      ])('should block non-canonical 64:ff9b: shapes: %s (%s)', (url) => {
        const result = SSRFProtection.validateUrlSync(url);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('IPv6 private/mapped address not allowed');
      });
    });
  });

  // SECURITY (GHSA-cmrh-wvq6-wm9r): pinned-transport regression tests.
  describe('Transport pinning', () => {
    beforeEach(() => {
      delete process.env.WEBHOOK_SECURITY_MODE;
    });

    it('should return resolved address and family on success', async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: '93.184.216.34', family: 4 } as any);
      const result = await SSRFProtection.validateWebhookUrl('https://example.com');
      expect(result.valid).toBe(true);
      expect(result.address).toBe('93.184.216.34');
      expect(result.family).toBe(4);
    });

    it('should return IPv6 family when hostname resolves to v6', async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: '2606:4700:4700::1111', family: 6 } as any);
      const result = await SSRFProtection.validateWebhookUrl('https://example.com');
      expect(result.valid).toBe(true);
      expect(result.address).toBe('2606:4700:4700::1111');
      expect(result.family).toBe(6);
    });

    it('createPinnedAgents lookup returns the pinned IP regardless of hostname', () => {
      const { httpAgent, httpsAgent } = SSRFProtection.createPinnedAgents('93.184.216.34', 4);
      const httpLookup = (httpAgent as any).options.lookup;
      const httpsLookup = (httpsAgent as any).options.lookup;
      expect(typeof httpLookup).toBe('function');
      expect(typeof httpsLookup).toBe('function');

      const captured: Array<{ address: string; family: number }> = [];
      httpLookup('rebind.example.test', {}, (_err: any, address: string, family: number) => {
        captured.push({ address, family });
      });
      httpsLookup('different-host.example.test', {}, (_err: any, address: string, family: number) => {
        captured.push({ address, family });
      });

      expect(captured).toEqual([
        { address: '93.184.216.34', family: 4 },
        { address: '93.184.216.34', family: 4 },
      ]);
    });

    it('pinned lookup ignores subsequent dns.lookup answers', async () => {
      // Validator DNS answer (the "good" IP). Subsequent dns.lookup calls
      // simulate an attacker-controlled resolver flipping to a private IP —
      // the pinned agent's lookup must never consult them.
      let dnsCalls = 0;
      vi.mocked(dns.lookup).mockImplementation(async () => {
        dnsCalls += 1;
        return dnsCalls === 1
          ? ({ address: '1.1.1.1', family: 4 } as any)
          : ({ address: '127.0.0.1', family: 4 } as any);
      });

      const validation = await SSRFProtection.validateWebhookUrl('https://rebind.example.test');
      expect(validation.valid).toBe(true);
      expect(validation.address).toBe('1.1.1.1');

      const { httpAgent } = SSRFProtection.createPinnedAgents(
        validation.address!,
        validation.family!
      );

      const transportCalls: Array<{ address: string; family: number }> = [];
      const lookup = (httpAgent as any).options.lookup as Function;
      // Two separate "transport-time" calls: pinned lookup must return the
      // validated IP both times and must not dispatch to dns.lookup.
      lookup('rebind.example.test', {}, (_e: any, addr: string, fam: number) => {
        transportCalls.push({ address: addr, family: fam });
      });
      lookup('rebind.example.test', {}, (_e: any, addr: string, fam: number) => {
        transportCalls.push({ address: addr, family: fam });
      });

      expect(transportCalls).toEqual([
        { address: '1.1.1.1', family: 4 },
        { address: '1.1.1.1', family: 4 },
      ]);
      // Validator burned exactly one dns.lookup; the transport burned zero.
      expect(dnsCalls).toBe(1);
    });

    it('agents disable keep-alive so connections do not leak across hosts', () => {
      const { httpAgent, httpsAgent } = SSRFProtection.createPinnedAgents('1.2.3.4', 4);
      expect((httpAgent as any).keepAlive).toBe(false);
      expect((httpsAgent as any).keepAlive).toBe(false);
    });

    it('does not return address/family on rejection', async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: '169.254.169.254', family: 4 } as any);
      const result = await SSRFProtection.validateWebhookUrl('http://attacker.example');
      expect(result.valid).toBe(false);
      expect(result.address).toBeUndefined();
      expect(result.family).toBeUndefined();
    });
  });
});
