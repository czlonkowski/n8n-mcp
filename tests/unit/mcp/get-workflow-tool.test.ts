import { describe, it, expect } from 'vitest';
import { n8nManagementTools } from '@/mcp/tools-n8n-manager';

describe('n8n_get_workflow tool definition', () => {
  const tool = n8nManagementTools.find((t) => t.name === 'n8n_get_workflow');

  it('exists in n8nManagementTools', () => {
    expect(tool).toBeDefined();
  });

  it('exposes the active mode alongside full/details/structure/minimal', () => {
    const modeSchema = tool!.inputSchema.properties?.mode as { enum?: string[] };
    expect(modeSchema?.enum).toEqual(
      expect.arrayContaining(['full', 'details', 'structure', 'minimal', 'active'])
    );
    expect(modeSchema?.enum).toHaveLength(5);
  });

  it('opts the tool above the Claude Code default per-tool size cap (issue #777)', () => {
    // Claude Code's MCP host caps tool output at 25k tokens by default and persists
    // larger responses to disk. We declare the anthropic-spec per-tool override so
    // legitimately large workflow responses still come back inline. The value is
    // below the protocol's 500k ceiling to leave headroom for the MCP envelope.
    const meta = (tool as { _meta?: Record<string, unknown> })._meta;
    expect(meta).toBeDefined();
    const sizeCap = meta?.['anthropic/maxResultSizeChars'] as number;
    expect(sizeCap).toBeGreaterThan(25000);
    expect(sizeCap).toBeLessThanOrEqual(500000);
  });
});
