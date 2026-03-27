/**
 * Unit tests for session persistence API
 * Tests export and restore functionality for multi-tenant session management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SingleSessionHTTPServer } from '../../../src/http-server-single-session';
import { SessionState } from '../../../src/types/session-state';

describe('SingleSessionHTTPServer - Session Persistence', () => {
  let server: SingleSessionHTTPServer;

  beforeEach(() => {
    server = new SingleSessionHTTPServer();
  });

  describe('exportSessionState()', () => {
    it('should return empty array when no sessions exist', () => {
      const exported = server.exportSessionState();
      expect(exported).toEqual([]);
    });

    it('should export active sessions with all required fields', () => {
      // Create mock sessions by directly manipulating internal state
      const sessionId1 = 'test-session-1';
      const sessionId2 = 'test-session-2';

      // Use current timestamps to avoid expiration
      const now = new Date();
      const createdAt1 = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes ago
      const lastAccess1 = new Date(now.getTime() - 30 * 1000);  // 30 seconds ago
      const createdAt2 = new Date(now.getTime() - 3 * 60 * 1000); // 3 minutes ago
      const lastAccess2 = new Date(now.getTime() - 20 * 1000);  // 20 seconds ago

      // Access private properties for testing
      const serverAny = server as any;

      serverAny.sessionMetadata[sessionId1] = {
        createdAt: createdAt1,
        lastAccess: lastAccess1
      };

      serverAny.sessionContexts[sessionId1] = {
        n8nApiUrl: 'https://n8n1.example.com',
        n8nApiKey: 'key1',
        instanceId: 'instance1',
        sessionId: sessionId1,
        metadata: { userId: 'user1' }
      };

      serverAny.sessionMetadata[sessionId2] = {
        createdAt: createdAt2,
        lastAccess: lastAccess2
      };

      serverAny.sessionContexts[sessionId2] = {
        n8nApiUrl: 'https://n8n2.example.com',
        n8nApiKey: 'key2',
        instanceId: 'instance2'
      };

      const exported = server.exportSessionState();

      expect(exported).toHaveLength(2);

      // Verify first session
      expect(exported[0]).toMatchObject({
        sessionId: sessionId1,
        metadata: {
          createdAt: createdAt1.toISOString(),
          lastAccess: lastAccess1.toISOString()
        },
        context: {
          n8nApiUrl: 'https://n8n1.example.com',
          n8nApiKey: 'key1',
          instanceId: 'instance1',
          sessionId: sessionId1,
          metadata: { userId: 'user1' }
        }
      });

      // Verify second session
      expect(exported[1]).toMatchObject({
        sessionId: sessionId2,
        metadata: {
          createdAt: createdAt2.toISOString(),
          lastAccess: lastAccess2.toISOString()
        },
        context: {
          n8nApiUrl: 'https://n8n2.example.com',
          n8nApiKey: 'key2',
          instanceId: 'instance2'
        }
      });
    });

    it('should skip expired sessions during export', () => {
      const serverAny = server as any;
      const now = Date.now();
      const sessionTimeout = 30 * 60 * 1000; // 30 minutes (default)

      // Create an active session (accessed recently)
      serverAny.sessionMetadata['active-session'] = {
        createdAt: new Date(now - 2 * 60 * 1000), // 2 minutes ago
        lastAccess: new Date(now - 30 * 1000)  // 30 seconds ago
      };
      serverAny.sessionContexts['active-session'] = {
        n8nApiUrl: 'https://active.example.com',
        n8nApiKey: 'active-key',
        instanceId: 'active-instance'
      };

      // Create an expired session (last accessed > 30 minutes ago)
      serverAny.sessionMetadata['expired-session'] = {
        createdAt: new Date(now - 60 * 60 * 1000), // 60 minutes ago
        lastAccess: new Date(now - 45 * 60 * 1000) // 45 minutes ago (expired)
      };
      serverAny.sessionContexts['expired-session'] = {
        n8nApiUrl: 'https://expired.example.com',
        n8nApiKey: 'expired-key',
        instanceId: 'expired-instance'
      };

      const exported = server.exportSessionState();

      expect(exported).toHaveLength(1);
      expect(exported[0].sessionId).toBe('active-session');
    });

    it('should skip sessions without required context fields', () => {
      const serverAny = server as any;

      // Session with complete context
      serverAny.sessionMetadata['complete-session'] = {
        createdAt: new Date(),
        lastAccess: new Date()
      };
      serverAny.sessionContexts['complete-session'] = {
        n8nApiUrl: 'https://complete.example.com',
        n8nApiKey: 'complete-key',
        instanceId: 'complete-instance'
      };

      // Session with missing n8nApiUrl
      serverAny.sessionMetadata['missing-url'] = {
        createdAt: new Date(),
        lastAccess: new Date()
      };
      serverAny.sessionContexts['missing-url'] = {
        n8nApiKey: 'key',
        instanceId: 'instance'
      };

      // Session with missing n8nApiKey
      serverAny.sessionMetadata['missing-key'] = {
        createdAt: new Date(),
        lastAccess: new Date()
      };
      serverAny.sessionContexts['missing-key'] = {
        n8nApiUrl: 'https://example.com',
        instanceId: 'instance'
      };

      // Session with no context at all
      serverAny.sessionMetadata['no-context'] = {
        createdAt: new Date(),
        lastAccess: new Date()
      };

      const exported = server.exportSessionState();

      expect(exported).toHaveLength(1);
      expect(exported[0].sessionId).toBe('complete-session');
    });

    it('should use sessionId as fallback for instanceId', () => {
      const serverAny = server as any;
      const sessionId = 'test-session';

      serverAny.sessionMetadata[sessionId] = {
        createdAt: new Date(),
        lastAccess: new Date()
      };
      serverAny.sessionContexts[sessionId] = {
        n8nApiUrl: 'https://example.com',
        n8nApiKey: 'key'
        // No instanceId provided
      };

      const exported = server.exportSessionState();

      expect(exported).toHaveLength(1);
      expect(exported[0].context.instanceId).toBe(sessionId);
    });
  });

  describe('restoreSessionState()', () => {
    it('should restore valid sessions correctly', () => {
      const sessions: SessionState[] = [
        {
          sessionId: 'restored-session-1',
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://restored1.example.com',
            n8nApiKey: 'restored-key-1',
            instanceId: 'restored-instance-1'
          }
        },
        {
          sessionId: 'restored-session-2',
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://restored2.example.com',
            n8nApiKey: 'restored-key-2',
            instanceId: 'restored-instance-2',
            sessionId: 'custom-session-id',
            metadata: { custom: 'data' }
          }
        }
      ];

      const count = server.restoreSessionState(sessions);

      expect(count).toBe(2);

      // Verify sessions were restored by checking internal state
      const serverAny = server as any;

      expect(serverAny.sessionMetadata['restored-session-1']).toBeDefined();
      expect(serverAny.sessionContexts['restored-session-1']).toMatchObject({
        n8nApiUrl: 'https://restored1.example.com',
        n8nApiKey: 'restored-key-1',
        instanceId: 'restored-instance-1'
      });

      expect(serverAny.sessionMetadata['restored-session-2']).toBeDefined();
      expect(serverAny.sessionContexts['restored-session-2']).toMatchObject({
        n8nApiUrl: 'https://restored2.example.com',
        n8nApiKey: 'restored-key-2',
        instanceId: 'restored-instance-2',
        sessionId: 'custom-session-id',
        metadata: { custom: 'data' }
      });
    });

    it('should skip expired sessions during restore', () => {
      const now = Date.now();
      const sessionTimeout = 30 * 60 * 1000; // 30 minutes

      const sessions: SessionState[] = [
        {
          sessionId: 'active-session',
          metadata: {
            createdAt: new Date(now - 2 * 60 * 1000).toISOString(),
            lastAccess: new Date(now - 30 * 1000).toISOString()
          },
          context: {
            n8nApiUrl: 'https://active.example.com',
            n8nApiKey: 'active-key',
            instanceId: 'active-instance'
          }
        },
        {
          sessionId: 'expired-session',
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

      const count = server.restoreSessionState(sessions);

      expect(count).toBe(1);

      const serverAny = server as any;
      expect(serverAny.sessionMetadata['active-session']).toBeDefined();
      expect(serverAny.sessionMetadata['expired-session']).toBeUndefined();
    });

    it('should skip sessions with missing required context fields', () => {
      const sessions: SessionState[] = [
        {
          sessionId: 'valid-session',
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://valid.example.com',
            n8nApiKey: 'valid-key',
            instanceId: 'valid-instance'
          }
        },
        {
          sessionId: 'missing-url',
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: '', // Empty URL
            n8nApiKey: 'key',
            instanceId: 'instance'
          }
        },
        {
          sessionId: 'missing-key',
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://example.com',
            n8nApiKey: '', // Empty key
            instanceId: 'instance'
          }
        }
      ];

      const count = server.restoreSessionState(sessions);

      expect(count).toBe(1);

      const serverAny = server as any;
      expect(serverAny.sessionMetadata['valid-session']).toBeDefined();
      expect(serverAny.sessionMetadata['missing-url']).toBeUndefined();
      expect(serverAny.sessionMetadata['missing-key']).toBeUndefined();
    });

    it('should skip duplicate sessionIds', () => {
      const serverAny = server as any;

      // Create an existing session
      serverAny.sessionMetadata['existing-session'] = {
        createdAt: new Date(),
        lastAccess: new Date()
      };

      const sessions: SessionState[] = [
        {
          sessionId: 'new-session',
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://new.example.com',
            n8nApiKey: 'new-key',
            instanceId: 'new-instance'
          }
        },
        {
          sessionId: 'existing-session', // Duplicate
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://duplicate.example.com',
            n8nApiKey: 'duplicate-key',
            instanceId: 'duplicate-instance'
          }
        }
      ];

      const count = server.restoreSessionState(sessions);

      expect(count).toBe(1);
      expect(serverAny.sessionMetadata['new-session']).toBeDefined();
    });

    it('should handle restore failures gracefully', () => {
      const sessions: any[] = [
        {
          sessionId: 'valid-session',
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://valid.example.com',
            n8nApiKey: 'valid-key',
            instanceId: 'valid-instance'
          }
        },
        {
          sessionId: 'bad-session',
          metadata: {}, // Missing required fields
          context: null // Invalid context
        },
        null, // Invalid session
        {
          // Missing sessionId
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: 'https://example.com',
            n8nApiKey: 'key',
            instanceId: 'instance'
          }
        }
      ];

      // Should not throw and should restore only the valid session
      expect(() => {
        const count = server.restoreSessionState(sessions);
        expect(count).toBe(1); // Only valid-session should be restored
      }).not.toThrow();

      // Verify the valid session was restored
      const serverAny = server as any;
      expect(serverAny.sessionMetadata['valid-session']).toBeDefined();
    });

    it('should respect MAX_SESSIONS limit during restore', () => {
      // Create 99 existing sessions (MAX_SESSIONS defaults to 100, configurable via N8N_MCP_MAX_SESSIONS env var)
      const serverAny = server as any;
      const now = new Date();
      for (let i = 0; i < 99; i++) {
        serverAny.sessionMetadata[`existing-${i}`] = {
          createdAt: now,
          lastAccess: now
        };
      }

      // Try to restore 3 sessions (should only restore 1 due to limit)
      const sessions: SessionState[] = [];
      for (let i = 0; i < 3; i++) {
        sessions.push({
          sessionId: `new-session-${i}`,
          metadata: {
            createdAt: new Date().toISOString(),
            lastAccess: new Date().toISOString()
          },
          context: {
            n8nApiUrl: `https://new${i}.example.com`,
            n8nApiKey: `new-key-${i}`,
            instanceId: `new-instance-${i}`
          }
        });
      }

      const count = server.restoreSessionState(sessions);

      expect(count).toBe(1);
      expect(serverAny.sessionMetadata['new-session-0']).toBeDefined();
      expect(serverAny.sessionMetadata['new-session-1']).toBeUndefined();
      expect(serverAny.sessionMetadata['new-session-2']).toBeUndefined();
    });

    it('should parse ISO 8601 timestamps correctly', () => {
      // Use current timestamps to avoid expiration
      const now = new Date();
      const createdAtDate = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes ago
      const lastAccessDate = new Date(now.getTime() - 30 * 1000);  // 30 seconds ago
      const createdAt = createdAtDate.toISOString();
      const lastAccess = lastAccessDate.toISOString();

      const sessions: SessionState[] = [
        {
          sessionId: 'timestamp-session',
          metadata: { createdAt, lastAccess },
          context: {
            n8nApiUrl: 'https://example.com',
            n8nApiKey: 'key',
            instanceId: 'instance'
          }
        }
      ];

      const count = server.restoreSessionState(sessions);
      expect(count).toBe(1);

      const serverAny = server as any;
      const metadata = serverAny.sessionMetadata['timestamp-session'];

      expect(metadata.createdAt).toBeInstanceOf(Date);
      expect(metadata.lastAccess).toBeInstanceOf(Date);
      expect(metadata.createdAt.toISOString()).toBe(createdAt);
      expect(metadata.lastAccess.toISOString()).toBe(lastAccess);
    });
  });

  describe('Round-trip export and restore', () => {
    it('should preserve data through export → restore cycle', () => {
      // Create sessions with current timestamps
      const serverAny = server as any;
      const now = new Date();
      const createdAt = new Date(now.getTime() - 60 * 1000); // 1 minute ago
      const lastAccess = new Date(now.getTime() - 30 * 1000);  // 30 seconds ago

      serverAny.sessionMetadata['session-1'] = {
        createdAt,
        lastAccess
      };
      serverAny.sessionContexts['session-1'] = {
        n8nApiUrl: 'https://n8n1.example.com',
        n8nApiKey: 'key1',
        instanceId: 'instance1',
        sessionId: 'custom-id-1',
        metadata: { userId: 'user1', role: 'admin' }
      };

      // Export sessions
      const exported = server.exportSessionState();
      expect(exported).toHaveLength(1);

      // Clear sessions
      delete serverAny.sessionMetadata['session-1'];
      delete serverAny.sessionContexts['session-1'];

      // Restore sessions
      const count = server.restoreSessionState(exported);
      expect(count).toBe(1);

      // Verify data integrity
      const metadata = serverAny.sessionMetadata['session-1'];
      const context = serverAny.sessionContexts['session-1'];

      expect(metadata.createdAt.toISOString()).toBe(createdAt.toISOString());
      expect(metadata.lastAccess.toISOString()).toBe(lastAccess.toISOString());

      expect(context).toMatchObject({
        n8nApiUrl: 'https://n8n1.example.com',
        n8nApiKey: 'key1',
        instanceId: 'instance1',
        sessionId: 'custom-id-1',
        metadata: { userId: 'user1', role: 'admin' }
      });
    });
  });
});
