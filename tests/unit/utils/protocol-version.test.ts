import { describe, it, expect, afterEach } from 'vitest';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import {
  negotiateProtocolVersion,
  isN8nClient,
  isVersionSupported,
  getCompatibleVersion,
  STANDARD_PROTOCOL_VERSION,
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  N8N_PROTOCOL_VERSION,
  SUPPORTED_VERSIONS
} from '@/utils/protocol-version';

describe('protocol-version', () => {
  afterEach(() => {
    delete process.env.N8N_MODE;
  });

  describe('supported version list', () => {
    it('should only advertise revisions the pinned SDK can negotiate', () => {
      // Advertising a revision the SDK does not know means we echo back a
      // version the transport will not honor.
      for (const version of SUPPORTED_VERSIONS) {
        expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(version);
      }
    });

    it('should list revisions newest first', () => {
      const sorted = [...SUPPORTED_VERSIONS].sort().reverse();
      expect(SUPPORTED_VERSIONS).toEqual(sorted);
    });

    it('should include the standard, default and n8n revisions', () => {
      expect(SUPPORTED_VERSIONS).toContain(STANDARD_PROTOCOL_VERSION);
      expect(SUPPORTED_VERSIONS).toContain(DEFAULT_NEGOTIATED_PROTOCOL_VERSION);
      expect(SUPPORTED_VERSIONS).toContain(N8N_PROTOCOL_VERSION);
    });

    it('should treat the latest revision as the preferred one', () => {
      expect(SUPPORTED_VERSIONS[0]).toBe(STANDARD_PROTOCOL_VERSION);
    });
  });

  describe('negotiateProtocolVersion', () => {
    it.each(SUPPORTED_VERSIONS)('should honor supported version %s', (version) => {
      const result = negotiateProtocolVersion(version, { name: 'Claude Desktop' });
      expect(result.version).toBe(version);
      expect(result.isN8nClient).toBe(false);
    });

    it('should no longer downgrade modern clients to 2025-03-26', () => {
      expect(negotiateProtocolVersion('2025-11-25', { name: 'Claude Desktop' }).version)
        .toBe('2025-11-25');
      expect(negotiateProtocolVersion('2025-06-18', { name: 'Claude Desktop' }).version)
        .toBe('2025-06-18');
    });

    it('should offer the latest revision when the client requests an unsupported one', () => {
      const result = negotiateProtocolVersion('2020-01-01', { name: 'Old Client' });
      expect(result.version).toBe(STANDARD_PROTOCOL_VERSION);
      expect(result.isN8nClient).toBe(false);
    });

    it('should offer the latest revision for 2024-06-25, which was never an MCP revision', () => {
      expect(negotiateProtocolVersion('2024-06-25', { name: 'Some Client' }).version)
        .toBe(STANDARD_PROTOCOL_VERSION);
    });

    it('should fall back to the default revision when the client omits a version', () => {
      const result = negotiateProtocolVersion(undefined, { name: 'Lenient Client' });
      expect(result.version).toBe(DEFAULT_NEGOTIATED_PROTOCOL_VERSION);
      expect(result.isN8nClient).toBe(false);
    });

    it('should pin n8n clients to the n8n revision regardless of request', () => {
      for (const requested of ['2025-11-25', '2025-06-18', undefined]) {
        const result = negotiateProtocolVersion(requested, { name: 'n8n' });
        expect(result.version).toBe(N8N_PROTOCOL_VERSION);
        expect(result.isN8nClient).toBe(true);
      }
    });

    it('should pin langchain clients to the n8n revision', () => {
      const result = negotiateProtocolVersion('2025-11-25', { name: 'langchain-js' });
      expect(result.version).toBe(N8N_PROTOCOL_VERSION);
      expect(result.isN8nClient).toBe(true);
    });

    it('should pin clients detected via user agent or headers', () => {
      expect(negotiateProtocolVersion('2025-11-25', undefined, 'n8n/1.52.0').version)
        .toBe(N8N_PROTOCOL_VERSION);
      expect(
        negotiateProtocolVersion('2025-11-25', undefined, undefined, { 'x-n8n-version': '1.0.0' }).version
      ).toBe(N8N_PROTOCOL_VERSION);
    });

    it('should pin clients when N8N_MODE is set', () => {
      process.env.N8N_MODE = 'true';
      const result = negotiateProtocolVersion('2025-11-25', { name: 'Claude Desktop' });
      expect(result.version).toBe(N8N_PROTOCOL_VERSION);
      expect(result.isN8nClient).toBe(true);
    });

    it('should always explain the negotiation outcome', () => {
      const requests = ['2025-11-25', '2020-01-01', undefined];
      for (const requested of requests) {
        expect(negotiateProtocolVersion(requested).reasoning).toBeTruthy();
      }
    });
  });

  describe('isN8nClient', () => {
    it('should detect n8n and langchain by client name', () => {
      expect(isN8nClient({ name: 'n8n' })).toBe(true);
      expect(isN8nClient({ name: 'N8N-Workflow' })).toBe(true);
      expect(isN8nClient({ name: 'langchain-js' })).toBe(true);
    });

    it('should not flag unrelated clients', () => {
      expect(isN8nClient({ name: 'Claude Desktop' })).toBe(false);
      expect(isN8nClient(undefined, 'Mozilla/5.0')).toBe(false);
      expect(isN8nClient()).toBe(false);
    });
  });

  describe('isVersionSupported', () => {
    it('should accept every advertised revision', () => {
      for (const version of SUPPORTED_VERSIONS) {
        expect(isVersionSupported(version)).toBe(true);
      }
    });

    it('should reject unknown revisions', () => {
      expect(isVersionSupported('2026-07-28')).toBe(false);
      expect(isVersionSupported('2024-06-25')).toBe(false);
      expect(isVersionSupported('')).toBe(false);
    });
  });

  describe('getCompatibleVersion', () => {
    it('should return the target when supported', () => {
      expect(getCompatibleVersion('2025-06-18')).toBe('2025-06-18');
      expect(getCompatibleVersion(N8N_PROTOCOL_VERSION)).toBe(N8N_PROTOCOL_VERSION);
    });

    it('should return the default revision when no target is given', () => {
      expect(getCompatibleVersion()).toBe(DEFAULT_NEGOTIATED_PROTOCOL_VERSION);
    });

    it('should return the latest revision for an unsupported target', () => {
      expect(getCompatibleVersion('2020-01-01')).toBe(STANDARD_PROTOCOL_VERSION);
    });
  });
});
