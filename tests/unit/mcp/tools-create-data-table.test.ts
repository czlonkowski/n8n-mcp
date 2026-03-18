import { describe, it, expect } from 'vitest';
import { n8nManagementTools } from '@/mcp/tools-n8n-manager';

describe('n8n_create_data_table tool definition', () => {
  const tool = n8nManagementTools.find((t) => t.name === 'n8n_create_data_table');

  it('tool is defined', () => {
    expect(tool).toBeDefined();
  });

  it('has name property in inputSchema', () => {
    expect(tool?.inputSchema.properties).toHaveProperty('name');
  });

  it('has columns property in inputSchema', () => {
    expect(tool?.inputSchema.properties).toHaveProperty('columns');
  });

  it('requires name', () => {
    expect(tool?.inputSchema.required).toContain('name');
  });

  it('columns items have name and type properties', () => {
    const columnsSchema = (tool?.inputSchema.properties as any)?.columns;
    expect(columnsSchema?.items?.properties).toHaveProperty('name');
    expect(columnsSchema?.items?.properties).toHaveProperty('type');
  });

  it('column type enum contains correct values from n8n API spec', () => {
    const columnsSchema = (tool?.inputSchema.properties as any)?.columns;
    const typeEnum: string[] = columnsSchema?.items?.properties?.type?.enum;
    expect(typeEnum).toEqual(['string', 'number', 'boolean', 'date', 'json']);
  });

  it('column type enum does not contain deprecated values', () => {
    const columnsSchema = (tool?.inputSchema.properties as any)?.columns;
    const typeEnum: string[] = columnsSchema?.items?.properties?.type?.enum;
    expect(typeEnum).not.toContain('datetime');
    expect(typeEnum).not.toContain('object');
  });
});
