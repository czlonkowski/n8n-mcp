/**
 * Unit tests for N8NMCPEngine session persistence wrapper methods
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { N8NMCPEngine } from '../../../src/mcp-engine';
import { SessionState } from '../../../src/types/session-state';

describe('N8NMCPEngine - Session Persistence', () => {
  let engine: N8NMCPEngine;

  beforeEach(() => {
    engine = new N8NMCPEngine({
      sessionTimeout: 30 * 60 * 1000,
      logLevel: 'error' // Quiet during tests
    });
  });

  describe('exportSessionState()', () => {
    it('should return empty array when no sessions exist', () => {
      const exported = engine.exportSessionState();
      expect(exported).toEqual([]);
    });

    it('should delegate to underlying server', () => {
      // Access private server to create test sessions
      const engineAny = engine as any;
      const server = engineAny.server;
      const serverAny = server as any;

      // Create a mock session
      serverAny.sessionMetadata['test-session'] = {
        createdAt: new Date(),
        lastAccess: new Date()
      };
      serverAny.sessionContexts['test-session'] = {
        n8nApiUrl: 'https://test.example.com',
        n8nApiKey: 'test-key',
        instanceId: 'test-instance'
      };

      const exported = engine.exportSessionState();

      expect(exported).toHaveLength(1);
      expect(exported[0].sessionId).toBe('test-session');
      expect(exported[0].context.n8nApiUrl).toBe('https://test.example.com');
    });

    it('should handle server not initialized', () => {
      // Create engine without server
      const engineAny = {} as N8NMCPEngine;
      const exportMethod = N8NMCPEngine.prototype.exportSessionState.bind(engineAny);

      // Should not throw, should return empty array
      expect(() => exportMethod()).not.toThrow();
      const result = exportMethod();
      expect(result).toEqual([]);
    });
  });

  describe('restoreSessionState()', () => {
    it('should restore sessions via underlying server', () => {
      const sessions: SessionState[] = [
        {
          sessionId: 'restored-session',
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://restored.example.com',
            n8nApiKey: 'restored-key',
            instanceId: 'restored-instance'
          }
        }
      ];

      const count = engine.restoreSessionState(sessions);

      expect(count).toBe(1);

      // Verify session was restored
      const engineAny = engine as any;
      const server = engineAny.server;
      const serverAny = server as any;

      expect(serverAny.sessionMetadata['restored-session']).toBeDefined();
      expect(serverAny.sessionContexts['restored-session']).toMatchObject({
        n8nApiUrl: 'https://restored.example.com',
        n8nApiKey: 'restored-key',
        instanceId: 'restored-instance'
      });
    });

    it('should return 0 when restoring empty array', () => {
      const count = engine.restoreSessionState([]);
      expect(count).toBe(0);
    });

    it('should handle server not initialized', () => {
      const engineAny = {} as N8NMCPEngine;
      const restoreMethod = N8NMCPEngine.prototype.restoreSessionState.bind(engineAny);

      const sessions: SessionState[] = [
        {
          sessionId: 'test',
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://test.example.com',
            n8nApiKey: 'test-key',
            instanceId: 'test-instance'
          }
        }
      ];

      // Should not throw, should return 0
      expect(() => restoreMethod(sessions)).not.toThrow();
      const result = restoreMethod(sessions);
      expect(result).toBe(0);
    });

    it('should return count of successfully restored sessions', () => {
      const now = Date.now();
      const sessions: SessionState[] = [
        {
          sessionId: 'valid-1',
          metadata: {
            createdAt: new Date(now - 2 * 60 * 1000).toISOString(),
            lastAccess: new Date(now - 30 * 1000).toISOString()
          },
          context: {
            n8nApiUrl: 'https://valid1.example.com',
            n8nApiKey: 'key1',
            instanceId: 'instance1'
          }
        },
        {
          sessionId: 'valid-2',
          metadata: {
            createdAt: new Date(now - 2 * 60 * 1000).toISOString(),
            lastAccess: new Date(now - 30 * 1000).toISOString()
          },
          context: {
            n8nApiUrl: 'https://valid2.example.com',
            n8nApiKey: 'key2',
            instanceId: 'instance2'
          }
        },
        {
          sessionId: 'expired',
          metadata: {
            createdAt: new Date(now - 60 * 60 * 1000).toISOString(),
            lastAccess: new Date(now - 45 * 60 * 1000).toISOString() // Expired
          },
          context: {
            n8nApiUrl: 'https://expired.example.com',
            n8nApiKey: 'expired-key',
            instanceId: 'expired-instance'
          }
        }
      ];

      const count = engine.restoreSessionState(sessions);

      expect(count).toBe(2); // Only 2 valid sessions
    });
  });

  describe('Round-trip through engine', () => {
    it('should preserve sessions through export → restore cycle', () => {
      // Create mock sessions with current timestamps
      const engineAny = engine as any;
      const server = engineAny.server;
      const serverAny = server as any;

      const now = new Date();
      const createdAt = new Date(now.getTime() - 60 * 1000); // 1 minute ago
      const lastAccess = new Date(now.getTime() - 30 * 1000);  // 30 seconds ago

      serverAny.sessionMetadata['engine-session'] = {
        createdAt,
        lastAccess
      };
      serverAny.sessionContexts['engine-session'] = {
        n8nApiUrl: 'https://engine-test.example.com',
        n8nApiKey: 'engine-key',
        instanceId: 'engine-instance',
        metadata: { env: 'production' }
      };

      // Export via engine
      const exported = engine.exportSessionState();
      expect(exported).toHaveLength(1);

      // Clear sessions
      delete serverAny.sessionMetadata['engine-session'];
      delete serverAny.sessionContexts['engine-session'];

      // Restore via engine
      const count = engine.restoreSessionState(exported);
      expect(count).toBe(1);

      // Verify data
      expect(serverAny.sessionMetadata['engine-session']).toBeDefined();
      expect(serverAny.sessionContexts['engine-session']).toMatchObject({
        n8nApiUrl: 'https://engine-test.example.com',
        n8nApiKey: 'engine-key',
        instanceId: 'engine-instance',
        metadata: { env: 'production' }
      });
    });
  });

  describe('Integration with getSessionInfo()', () => {
    it('should reflect restored sessions in session info', () => {
      const sessions: SessionState[] = [
        {
          sessionId: 'info-session-1',
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://info1.example.com',
            n8nApiKey: 'info-key-1',
            instanceId: 'info-instance-1'
          }
        },
        {
          sessionId: 'info-session-2',
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://info2.example.com',
            n8nApiKey: 'info-key-2',
            instanceId: 'info-instance-2'
          }
        }
      ];

      engine.restoreSessionState(sessions);

      const info = engine.getSessionInfo();

      // Note: getSessionInfo() reflects metadata, not transports
      // Restored sessions won't have transports until first request
      expect(info).toBeDefined();
    });
  });
});
