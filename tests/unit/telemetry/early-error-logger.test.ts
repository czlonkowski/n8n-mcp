import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EarlyErrorLogger } from '../../../src/telemetry/early-error-logger';
import { TelemetryConfigManager } from '../../../src/telemetry/config-manager';
import { IngestClient } from '../../../src/telemetry/ingest-client';

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

vi.mock('../../../src/telemetry/ingest-client');
vi.mock('../../../src/telemetry/config-manager');

describe('EarlyErrorLogger onControl wiring (server-driven disable)', () => {
  let mockConfigManager: any;
  let mockIngestClient: any;

  beforeEach(() => {
    // The class has no resetInstance(); reach into the private singleton
    // field the same way the config-manager suite resets its own singleton.
    (EarlyErrorLogger as any).instance = null;

    mockConfigManager = {
      isEnabled: vi.fn().mockReturnValue(true),
      getUserId: vi.fn().mockReturnValue('test-user-123'),
      getPackageVersion: vi.fn().mockReturnValue('2.90.0'),
      recordServerDisable: vi.fn(),
    };
    vi.mocked(TelemetryConfigManager.getInstance).mockReturnValue(mockConfigManager);

    mockIngestClient = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null, status: 201 })
      })
    };
    vi.mocked(IngestClient).mockImplementation(() => mockIngestClient);
  });

  function capturedOnControl(): (signal: { kind: string; status: number }) => void {
    const calls = vi.mocked(IngestClient).mock.calls;
    const [options] = calls[calls.length - 1];
    return (options as any).onControl;
  }

  it('disable_version records the server disable with the package version and disables the logger', async () => {
    const logger = EarlyErrorLogger.getInstance();
    await logger.waitForInit();
    expect(logger.isEnabled()).toBe(true);

    capturedOnControl()({ kind: 'disable_version', status: 410 });

    expect(mockConfigManager.recordServerDisable).toHaveBeenCalledWith('2.90.0');
    expect(logger.isEnabled()).toBe(false);
  });

  it('disable_process disables the logger for the rest of this process without persisting anything', async () => {
    const logger = EarlyErrorLogger.getInstance();
    await logger.waitForInit();
    expect(logger.isEnabled()).toBe(true);

    capturedOnControl()({ kind: 'disable_process', status: 401 });

    expect(logger.isEnabled()).toBe(false);
    expect(mockConfigManager.recordServerDisable).not.toHaveBeenCalled();
  });
});
