import { describe, it, expect, beforeEach, afterEach, vi, MockInstance } from 'vitest';
import { TelemetryConfigManager } from '../../../src/telemetry/config-manager';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn()
  };
});

// The opt-out variables this suite reasons about. The test environment disables
// telemetry globally (vitest.config.ts) so no test run can reach the backend;
// this suite owns the opt-out logic itself, so it controls them explicitly
// instead of inheriting whatever the ambient environment says.
const OPT_OUT_VARS = [
  'N8N_MCP_TELEMETRY_DISABLED',
  'TELEMETRY_DISABLED',
  'DISABLE_TELEMETRY'
] as const;

describe('TelemetryConfigManager', () => {
  let manager: TelemetryConfigManager;
  let savedOptOutVars: Record<string, string | undefined>;
  // Owned here so individual tests can assert on them without re-spying.
  let stderrWrite: MockInstance;
  let stdoutWrite: MockInstance;
  let consoleLog: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear singleton instance
    (TelemetryConfigManager as any).instance = null;

    savedOptOutVars = {};
    for (const name of OPT_OUT_VARS) {
      savedOptOutVars[name] = process.env[name];
      delete process.env[name];
    }

    // Suppress the first-run notice in test output. It goes to stderr, never
    // stdout — stdout is the JSON-RPC channel in stdio mode.
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(savedOptOutVars)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }

    vi.restoreAllMocks();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = TelemetryConfigManager.getInstance();
      const instance2 = TelemetryConfigManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('loadConfig', () => {
    it('should create default config on first run', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      manager = TelemetryConfigManager.getInstance();
      const config = manager.loadConfig();

      expect(config.enabled).toBe(true);
      expect(config.userId).toMatch(/^[a-f0-9]{16}$/);
      expect(config.firstRun).toBeDefined();
      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(
        join(homedir(), '.n8n-mcp'),
        { recursive: true }
      );
      expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
    });

    // In stdio mode process.stdout is the JSON-RPC channel. This notice used to
    // be console.log'd, so every fresh install fed 34 lines of box-drawing
    // characters into the client's JSON parser.
    it('should write the first-run notice to stderr and never to stdout', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      manager = TelemetryConfigManager.getInstance();
      manager.loadConfig();

      const stderrOutput = stderrWrite.mock.calls.map(c => String(c[0])).join('');
      expect(stderrOutput).toContain('Usage Telemetry');

      // The protocol channel must stay untouched.
      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(consoleLog).not.toHaveBeenCalled();
    });

    it('should load existing config from disk', () => {
      const mockConfig = {
        enabled: false,
        userId: 'test-user-id',
        firstRun: '2024-01-01T00:00:00Z'
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      manager = TelemetryConfigManager.getInstance();
      const config = manager.loadConfig();

      expect(config).toEqual(mockConfig);
    });

    it('should handle corrupted config file gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('invalid json');

      manager = TelemetryConfigManager.getInstance();
      const config = manager.loadConfig();

      expect(config.enabled).toBe(false);
      expect(config.userId).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should add userId to config if missing', () => {
      const mockConfig = {
        enabled: true,
        firstRun: '2024-01-01T00:00:00Z'
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      manager = TelemetryConfigManager.getInstance();
      const config = manager.loadConfig();

      expect(config.userId).toMatch(/^[a-f0-9]{16}$/);
      expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
    });
  });

  describe('isEnabled', () => {
    it('should return true when telemetry is enabled', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: true,
        userId: 'test-id'
      }));

      manager = TelemetryConfigManager.getInstance();
      expect(manager.isEnabled()).toBe(true);
    });

    it('should return false when telemetry is disabled', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: false,
        userId: 'test-id'
      }));

      manager = TelemetryConfigManager.getInstance();
      expect(manager.isEnabled()).toBe(false);
    });
  });

  describe('getUserId', () => {
    it('should return consistent user ID', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: true,
        userId: 'test-user-id-123'
      }));

      manager = TelemetryConfigManager.getInstance();
      expect(manager.getUserId()).toBe('test-user-id-123');
    });
  });

  describe('isFirstRun', () => {
    it('should return true if config file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      manager = TelemetryConfigManager.getInstance();
      expect(manager.isFirstRun()).toBe(true);
    });

    it('should return false if config file exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);

      manager = TelemetryConfigManager.getInstance();
      expect(manager.isFirstRun()).toBe(false);
    });
  });

  describe('enable/disable', () => {
    beforeEach(() => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: false,
        userId: 'test-id'
      }));
    });

    it('should enable telemetry', () => {
      manager = TelemetryConfigManager.getInstance();
      manager.enable();

      const calls = vi.mocked(writeFileSync).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toContain('"enabled": true');
    });

    it('should disable telemetry', () => {
      manager = TelemetryConfigManager.getInstance();
      manager.disable();

      const calls = vi.mocked(writeFileSync).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toContain('"enabled": false');
    });
  });

  describe('getStatus', () => {
    it('should return formatted status string', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: true,
        userId: 'test-id',
        firstRun: '2024-01-01T00:00:00Z'
      }));

      manager = TelemetryConfigManager.getInstance();
      const status = manager.getStatus();

      expect(status).toContain('ENABLED');
      expect(status).toContain('test-id');
      expect(status).toContain('2024-01-01T00:00:00Z');
      expect(status).toContain('npx n8n-mcp telemetry');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle file system errors during config creation', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(mkdirSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should not crash on file system errors
      expect(() => TelemetryConfigManager.getInstance()).not.toThrow();
    });

    it('should handle write errors during config save', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: false,
        userId: 'test-id'
      }));
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error('Disk full');
      });

      manager = TelemetryConfigManager.getInstance();

      // Should not crash on write errors
      expect(() => manager.enable()).not.toThrow();
      expect(() => manager.disable()).not.toThrow();
    });

    it('should handle missing home directory', () => {
      // Mock homedir to return empty string
      const originalHomedir = require('os').homedir;
      vi.doMock('os', () => ({
        homedir: () => ''
      }));

      vi.mocked(existsSync).mockReturnValue(false);

      expect(() => TelemetryConfigManager.getInstance()).not.toThrow();
    });

    it('should generate valid user ID when crypto.randomBytes fails', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      // Mock crypto to fail
      vi.doMock('crypto', () => ({
        randomBytes: () => {
          throw new Error('Crypto not available');
        }
      }));

      manager = TelemetryConfigManager.getInstance();
      const config = manager.loadConfig();

      expect(config.userId).toBeDefined();
      expect(config.userId).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should handle concurrent access to config file', () => {
      let readCount = 0;
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        readCount++;
        if (readCount === 1) {
          return JSON.stringify({
            enabled: false,
            userId: 'test-id-1'
          });
        }
        return JSON.stringify({
          enabled: true,
          userId: 'test-id-2'
        });
      });

      const manager1 = TelemetryConfigManager.getInstance();
      const manager2 = TelemetryConfigManager.getInstance();

      // Should be same instance due to singleton pattern
      expect(manager1).toBe(manager2);
    });

    it('should handle environment variable overrides', () => {
      const originalEnv = process.env.N8N_MCP_TELEMETRY_DISABLED;

      // Test with environment variable set to disable telemetry
      process.env.N8N_MCP_TELEMETRY_DISABLED = 'true';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: true,
        userId: 'test-id'
      }));

      (TelemetryConfigManager as any).instance = null;
      manager = TelemetryConfigManager.getInstance();

      expect(manager.isEnabled()).toBe(false);

      // Test with environment variable set to enable telemetry
      process.env.N8N_MCP_TELEMETRY_DISABLED = 'false';
      (TelemetryConfigManager as any).instance = null;
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: true,
        userId: 'test-id'
      }));
      manager = TelemetryConfigManager.getInstance();

      expect(manager.isEnabled()).toBe(true);

      // Restore original environment. Assigning an undefined value would set the
      // literal string "undefined", which config-manager reads as an invalid
      // opt-out value; afterEach restores it either way, but keep the local
      // restore honest.
      if (originalEnv === undefined) {
        delete process.env.N8N_MCP_TELEMETRY_DISABLED;
      } else {
        process.env.N8N_MCP_TELEMETRY_DISABLED = originalEnv;
      }
    });

    it('should handle invalid JSON in config file gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('{ invalid json syntax');

      manager = TelemetryConfigManager.getInstance();
      const config = manager.loadConfig();

      expect(config.enabled).toBe(false); // Default to disabled on corrupt config
      expect(config.userId).toMatch(/^[a-f0-9]{16}$/); // Should generate new user ID
    });

    it('should handle config file with partial structure', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: true
        // Missing userId and firstRun
      }));

      manager = TelemetryConfigManager.getInstance();
      const config = manager.loadConfig();

      expect(config.enabled).toBe(true);
      expect(config.userId).toMatch(/^[a-f0-9]{16}$/);
      // firstRun might not be defined if config is partial and loaded from disk
      // The implementation only adds firstRun on first creation
    });

    it('should handle config file with invalid data types', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: 'not-a-boolean',
        userId: 12345, // Not a string
        firstRun: null
      }));

      manager = TelemetryConfigManager.getInstance();
      const config = manager.loadConfig();

      // The config manager loads the data as-is, so we get the original types
      // The validation happens during usage, not loading
      expect(config.enabled).toBe('not-a-boolean');
      expect(config.userId).toBe(12345);
    });

    it('should handle very large config files', () => {
      const largeConfig = {
        enabled: true,
        userId: 'test-id',
        firstRun: '2024-01-01T00:00:00Z',
        extraData: 'x'.repeat(1000000) // 1MB of data
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(largeConfig));

      expect(() => TelemetryConfigManager.getInstance()).not.toThrow();
    });

    it('should handle config directory creation race conditions', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      let mkdirCallCount = 0;
      vi.mocked(mkdirSync).mockImplementation(() => {
        mkdirCallCount++;
        if (mkdirCallCount === 1) {
          throw new Error('EEXIST: file already exists');
        }
        return undefined;
      });

      expect(() => TelemetryConfigManager.getInstance()).not.toThrow();
    });

    it('should handle file system permission changes', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: false,
        userId: 'test-id'
      }));

      manager = TelemetryConfigManager.getInstance();

      // Simulate permission denied on subsequent write
      vi.mocked(writeFileSync).mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => manager.enable()).not.toThrow();
    });

    it('should handle system clock changes affecting timestamps', () => {
      const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year in future
      const pastDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year in past

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: true,
        userId: 'test-id',
        firstRun: futureDate.toISOString()
      }));

      manager = TelemetryConfigManager.getInstance();
      const config = manager.loadConfig();

      expect(config.firstRun).toBeDefined();
      expect(new Date(config.firstRun as string).getTime()).toBeGreaterThan(0);
    });

    it('should handle config updates during runtime', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: false,
        userId: 'test-id'
      }));

      manager = TelemetryConfigManager.getInstance();
      expect(manager.isEnabled()).toBe(false);

      // Simulate external config change by clearing cache first
      (manager as any).config = null;
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: true,
        userId: 'test-id'
      }));

      // Now calling loadConfig should pick up changes
      const newConfig = manager.loadConfig();
      expect(newConfig.enabled).toBe(true);
      expect(manager.isEnabled()).toBe(true);
    });

    it('should handle multiple rapid enable/disable calls', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: false,
        userId: 'test-id'
      }));

      manager = TelemetryConfigManager.getInstance();

      // Rapidly toggle state
      for (let i = 0; i < 100; i++) {
        if (i % 2 === 0) {
          manager.enable();
        } else {
          manager.disable();
        }
      }

      // Should not crash and maintain consistent state
      expect(typeof manager.isEnabled()).toBe('boolean');
    });

    it('should handle user ID collision (extremely unlikely)', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      // Mock crypto to always return same bytes
      const mockBytes = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
      vi.doMock('crypto', () => ({
        randomBytes: () => mockBytes
      }));

      (TelemetryConfigManager as any).instance = null;
      const manager1 = TelemetryConfigManager.getInstance();
      const userId1 = manager1.getUserId();

      (TelemetryConfigManager as any).instance = null;
      const manager2 = TelemetryConfigManager.getInstance();
      const userId2 = manager2.getUserId();

      // Should generate same ID from same random bytes
      expect(userId1).toBe(userId2);
      expect(userId1).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should handle status generation with missing fields', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: true
        // Missing userId and firstRun
      }));

      manager = TelemetryConfigManager.getInstance();
      const status = manager.getStatus();

      expect(status).toContain('ENABLED');
      expect(status).toBeDefined();
      expect(typeof status).toBe('string');
    });
  });

  describe('Docker/Cloud user ID generation', () => {
    let originalIsDocker: string | undefined;
    let originalRailway: string | undefined;

    beforeEach(() => {
      originalIsDocker = process.env.IS_DOCKER;
      originalRailway = process.env.RAILWAY_ENVIRONMENT;
    });

    afterEach(() => {
      if (originalIsDocker === undefined) {
        delete process.env.IS_DOCKER;
      } else {
        process.env.IS_DOCKER = originalIsDocker;
      }

      if (originalRailway === undefined) {
        delete process.env.RAILWAY_ENVIRONMENT;
      } else {
        process.env.RAILWAY_ENVIRONMENT = originalRailway;
      }
    });

    describe('boot_id reading', () => {
      it('should read valid boot_id from /proc/sys/kernel/random/boot_id', () => {
        const mockBootId = 'f3c371fe-8a77-4592-8332-7a4d0d88d4ac';
        process.env.IS_DOCKER = 'true';

        vi.mocked(existsSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return true;
          return false;
        });

        vi.mocked(readFileSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return mockBootId;
          throw new Error('File not found');
        });

        (TelemetryConfigManager as any).instance = null;
        manager = TelemetryConfigManager.getInstance();
        const userId = manager.getUserId();

        expect(userId).toMatch(/^[a-f0-9]{16}$/);
        expect(vi.mocked(readFileSync)).toHaveBeenCalledWith(
          '/proc/sys/kernel/random/boot_id',
          'utf-8'
        );
      });

      it('should validate boot_id UUID format', () => {
        const invalidBootId = 'not-a-valid-uuid';
        process.env.IS_DOCKER = 'true';

        vi.mocked(existsSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return true;
          if (path === '/proc/cpuinfo') return true;
          if (path === '/proc/meminfo') return true;
          return false;
        });

        vi.mocked(readFileSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return invalidBootId;
          if (path === '/proc/cpuinfo') return 'processor: 0\nprocessor: 1\n';
          if (path === '/proc/meminfo') return 'MemTotal: 8040052 kB\n';
          throw new Error('File not found');
        });

        (TelemetryConfigManager as any).instance = null;
        manager = TelemetryConfigManager.getInstance();
        const userId = manager.getUserId();

        // Should fallback to combined fingerprint, not use invalid boot_id
        expect(userId).toMatch(/^[a-f0-9]{16}$/);
      });

      it('should handle boot_id file not existing', () => {
        process.env.IS_DOCKER = 'true';

        vi.mocked(existsSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return false;
          if (path === '/proc/cpuinfo') return true;
          if (path === '/proc/meminfo') return true;
          return false;
        });

        vi.mocked(readFileSync).mockImplementation((path: any) => {
          if (path === '/proc/cpuinfo') return 'processor: 0\nprocessor: 1\n';
          if (path === '/proc/meminfo') return 'MemTotal: 8040052 kB\n';
          throw new Error('File not found');
        });

        (TelemetryConfigManager as any).instance = null;
        manager = TelemetryConfigManager.getInstance();
        const userId = manager.getUserId();

        // Should fallback to combined fingerprint
        expect(userId).toMatch(/^[a-f0-9]{16}$/);
      });

      it('should handle boot_id read errors gracefully', () => {
        process.env.IS_DOCKER = 'true';

        vi.mocked(existsSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return true;
          return false;
        });

        vi.mocked(readFileSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') {
            throw new Error('Permission denied');
          }
          throw new Error('File not found');
        });

        (TelemetryConfigManager as any).instance = null;
        manager = TelemetryConfigManager.getInstance();
        const userId = manager.getUserId();

        // Should fallback gracefully
        expect(userId).toMatch(/^[a-f0-9]{16}$/);
      });

      it('should generate consistent user ID from same boot_id', () => {
        const mockBootId = 'f3c371fe-8a77-4592-8332-7a4d0d88d4ac';
        process.env.IS_DOCKER = 'true';

        vi.mocked(existsSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return true;
          return false;
        });

        vi.mocked(readFileSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return mockBootId;
          throw new Error('File not found');
        });

        (TelemetryConfigManager as any).instance = null;
        const manager1 = TelemetryConfigManager.getInstance();
        const userId1 = manager1.getUserId();

        (TelemetryConfigManager as any).instance = null;
        const manager2 = TelemetryConfigManager.getInstance();
        const userId2 = manager2.getUserId();

        // Same boot_id should produce same user_id
        expect(userId1).toBe(userId2);
      });
    });

    describe('combined fingerprint fallback', () => {
      it('should generate fingerprint from CPU, memory, and kernel', () => {
        process.env.IS_DOCKER = 'true';

        vi.mocked(existsSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return false;
          if (path === '/proc/cpuinfo') return true;
          if (path === '/proc/meminfo') return true;
          if (path === '/proc/version') return true;
          return false;
        });

        vi.mocked(readFileSync).mockImplementation((path: any) => {
          if (path === '/proc/cpuinfo') return 'processor: 0\nprocessor: 1\nprocessor: 2\nprocessor: 3\n';
          if (path === '/proc/meminfo') return 'MemTotal: 8040052 kB\n';
          if (path === '/proc/version') return 'Linux version 5.15.49-linuxkit';
          throw new Error('File not found');
        });

        (TelemetryConfigManager as any).instance = null;
        manager = TelemetryConfigManager.getInstance();
        const userId = manager.getUserId();

        expect(userId).toMatch(/^[a-f0-9]{16}$/);
      });

      it('should require at least 3 signals for combined fingerprint', () => {
        process.env.IS_DOCKER = 'true';

        vi.mocked(existsSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return false;
          // Only platform and arch available (2 signals)
          return false;
        });

        (TelemetryConfigManager as any).instance = null;
        manager = TelemetryConfigManager.getInstance();
        const userId = manager.getUserId();

        // Should fallback to generic Docker ID
        expect(userId).toMatch(/^[a-f0-9]{16}$/);
      });

      it('should handle partial /proc data', () => {
        process.env.IS_DOCKER = 'true';

        vi.mocked(existsSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return false;
          if (path === '/proc/cpuinfo') return true;
          // meminfo missing
          return false;
        });

        vi.mocked(readFileSync).mockImplementation((path: any) => {
          if (path === '/proc/cpuinfo') return 'processor: 0\nprocessor: 1\n';
          throw new Error('File not found');
        });

        (TelemetryConfigManager as any).instance = null;
        manager = TelemetryConfigManager.getInstance();
        const userId = manager.getUserId();

        // Should include platform and arch, so 4 signals total
        expect(userId).toMatch(/^[a-f0-9]{16}$/);
      });
    });

    describe('environment detection', () => {
      it('should use Docker method when IS_DOCKER=true', () => {
        process.env.IS_DOCKER = 'true';

        vi.mocked(existsSync).mockReturnValue(false);

        (TelemetryConfigManager as any).instance = null;
        manager = TelemetryConfigManager.getInstance();
        const userId = manager.getUserId();

        expect(userId).toMatch(/^[a-f0-9]{16}$/);
        // Should attempt to read boot_id
        expect(vi.mocked(existsSync)).toHaveBeenCalledWith('/proc/sys/kernel/random/boot_id');
      });

      it('should use Docker method for Railway environment', () => {
        process.env.RAILWAY_ENVIRONMENT = 'production';
        delete process.env.IS_DOCKER;

        vi.mocked(existsSync).mockReturnValue(false);

        (TelemetryConfigManager as any).instance = null;
        manager = TelemetryConfigManager.getInstance();
        const userId = manager.getUserId();

        expect(userId).toMatch(/^[a-f0-9]{16}$/);
        // Should attempt to read boot_id
        expect(vi.mocked(existsSync)).toHaveBeenCalledWith('/proc/sys/kernel/random/boot_id');
      });

      it('should use file-based method for local installation', () => {
        delete process.env.IS_DOCKER;
        delete process.env.RAILWAY_ENVIRONMENT;

        vi.mocked(existsSync).mockReturnValue(false);

        (TelemetryConfigManager as any).instance = null;
        manager = TelemetryConfigManager.getInstance();
        const userId = manager.getUserId();

        expect(userId).toMatch(/^[a-f0-9]{16}$/);
        // Should NOT attempt to read boot_id
        const calls = vi.mocked(existsSync).mock.calls;
        const bootIdCalls = calls.filter(call => call[0] === '/proc/sys/kernel/random/boot_id');
        expect(bootIdCalls.length).toBe(0);
      });

      it('should detect cloud platforms', () => {
        const cloudEnvVars = [
          'RAILWAY_ENVIRONMENT',
          'RENDER',
          'FLY_APP_NAME',
          'HEROKU_APP_NAME',
          'AWS_EXECUTION_ENV',
          'KUBERNETES_SERVICE_HOST',
          'GOOGLE_CLOUD_PROJECT',
          'AZURE_FUNCTIONS_ENVIRONMENT'
        ];

        cloudEnvVars.forEach(envVar => {
          // Clear all env vars
          cloudEnvVars.forEach(v => delete process.env[v]);
          delete process.env.IS_DOCKER;

          // Set one cloud env var
          process.env[envVar] = 'true';

          vi.mocked(existsSync).mockReturnValue(false);

          (TelemetryConfigManager as any).instance = null;
          manager = TelemetryConfigManager.getInstance();
          const userId = manager.getUserId();

          expect(userId).toMatch(/^[a-f0-9]{16}$/);

          // Should attempt to read boot_id
          const calls = vi.mocked(existsSync).mock.calls;
          const bootIdCalls = calls.filter(call => call[0] === '/proc/sys/kernel/random/boot_id');
          expect(bootIdCalls.length).toBeGreaterThan(0);

          // Clean up
          delete process.env[envVar];
        });
      });
    });

    describe('fallback chain execution', () => {
      it('should fallback from boot_id → combined → generic', () => {
        process.env.IS_DOCKER = 'true';

        // All methods fail
        vi.mocked(existsSync).mockReturnValue(false);
        vi.mocked(readFileSync).mockImplementation(() => {
          throw new Error('File not found');
        });

        (TelemetryConfigManager as any).instance = null;
        manager = TelemetryConfigManager.getInstance();
        const userId = manager.getUserId();

        // Should still generate a generic Docker ID
        expect(userId).toMatch(/^[a-f0-9]{16}$/);
      });

      it('should use boot_id if available (highest priority)', () => {
        const mockBootId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        process.env.IS_DOCKER = 'true';

        vi.mocked(existsSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return true;
          return true; // All other files available too
        });

        vi.mocked(readFileSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return mockBootId;
          if (path === '/proc/cpuinfo') return 'processor: 0\n';
          if (path === '/proc/meminfo') return 'MemTotal: 1000000 kB\n';
          return 'mock data';
        });

        (TelemetryConfigManager as any).instance = null;
        const manager1 = TelemetryConfigManager.getInstance();
        const userId1 = manager1.getUserId();

        // Now break boot_id but keep combined signals
        vi.mocked(existsSync).mockImplementation((path: any) => {
          if (path === '/proc/sys/kernel/random/boot_id') return false;
          return true;
        });

        (TelemetryConfigManager as any).instance = null;
        const manager2 = TelemetryConfigManager.getInstance();
        const userId2 = manager2.getUserId();

        // Different methods should produce different IDs
        expect(userId1).not.toBe(userId2);
        expect(userId1).toMatch(/^[a-f0-9]{16}$/);
        expect(userId2).toMatch(/^[a-f0-9]{16}$/);
      });
    });
  });
});