import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger, LogLevel, stripLineBreaks } from '../../../src/utils/logger';

describe('stripLineBreaks', () => {
  it('replaces CR, LF and Unicode line separators with spaces', () => {
    expect(stripLineBreaks('a\nb\r\nc\u2028d\u2029e')).toBe('a b  c d e');
  });

  it('returns text without line breaks unchanged', () => {
    expect(stripLineBreaks('plain text')).toBe('plain text');
  });
});

describe('Logger line-break handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('does not read %s in the message as a format directive', () => {
    vi.stubEnv('DEBUG', 'true');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new Logger({ level: LogLevel.ERROR, timestamp: false, prefix: '' });

    logger.error('value %s', 'arg');

    expect(spy.mock.calls[0]).toEqual(['%s', '[ERROR] value %s', 'arg']);
  });

  it('keeps a forged line out of the message and string arguments', () => {
    vi.stubEnv('DEBUG', 'true');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new Logger({ level: LogLevel.ERROR, timestamp: false });

    logger.error('bad node\n[n8n-mcp] [INFO] forged', 'x\r\ny', { nested: 'a\nb' });

    expect(spy).toHaveBeenCalledTimes(1);
    const [format, message, stringArg, objectArg] = spy.mock.calls[0];
    expect(format).toBe('%s');
    expect(message).toBe('[n8n-mcp] [ERROR] bad node [n8n-mcp] [INFO] forged');
    expect(stringArg).toBe('x  y');
    // Objects are passed through; console's inspect escapes their line breaks.
    expect(objectArg).toEqual({ nested: 'a\nb' });
  });
});
