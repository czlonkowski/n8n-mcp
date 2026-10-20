import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/database/database-adapter');
vi.mock('../../../src/database/node-repository');
vi.mock('../../../src/templates/template-service');
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
  Logger: class {},
  LogLevel: { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 },
}));

const { flushBeforeExit, trackSessionStart } = vi.hoisted(() => ({
  flushBeforeExit: vi.fn().mockResolvedValue(undefined),
  trackSessionStart: vi.fn(),
}));

// Covers every telemetry method reached through this barrel — handlers-n8n-manager
// imports the same one, so a partial stub would fail later tests in this file with
// "is not a function" rather than a meaningful assertion.
vi.mock('../../../src/telemetry', () => ({
  telemetry: {
    flushBeforeExit,
    trackSessionStart,
    trackToolUsage: vi.fn(),
    trackError: vi.fn(),
    trackEvent: vi.fn(),
    trackSearchQuery: vi.fn(),
    trackValidationDetails: vi.fn(),
    trackToolSequence: vi.fn(),
    trackWorkflowCreation: vi.fn(),
    trackWorkflowMutation: vi.fn(),
  },
}));

import { N8NDocumentationMCPServer } from '../../../src/mcp/server';

describe('MCP server shutdown flushes telemetry', () => {
  let server: N8NDocumentationMCPServer;

  beforeEach(() => {
    process.env.NODE_DB_PATH = ':memory:';
    vi.clearAllMocks();
    flushBeforeExit.mockResolvedValue(undefined);
    server = new N8NDocumentationMCPServer();
  });

  afterEach(() => {
    delete process.env.NODE_DB_PATH;
  });

  // Every shutdown path exits via process.exit(), which never emits
  // 'beforeExit', so this call is the only thing that ships a short session's
  // queued telemetry. Deleting it would otherwise fail nothing.
  it('awaits the bounded telemetry flush', async () => {
    await server.shutdown();

    expect(flushBeforeExit).toHaveBeenCalledTimes(1);
  });

  it('flushes before waiting on database initialization', async () => {
    // Telemetry needs no database, so a never-settling init must not also cost
    // the queued events: the flush is ordered ahead of that await.
    (server as any).initialized = new Promise(() => {});

    let flushed = false;
    flushBeforeExit.mockImplementation(async () => {
      flushed = true;
    });

    // shutdown() itself never settles here, which is the point — assert the
    // flush already happened rather than awaiting the call.
    void server.shutdown();
    await vi.waitFor(() => expect(flushed).toBe(true));
  });

  it('still shuts down cleanly when the flush rejects', async () => {
    // Telemetry must never change a shutdown's outcome: src/mcp/index.ts turns a
    // throwing shutdown into exit code 1 and skips stdin teardown.
    flushBeforeExit.mockRejectedValue(new Error('backend unreachable'));

    await expect(server.shutdown()).resolves.toBeUndefined();
    // Resolving is not enough — assert the cleanup past the flush actually ran.
    expect((server as any).db).toBeNull();
    expect((server as any).repository).toBeNull();
  });
});
