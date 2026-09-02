import { describe, it, expect } from 'vitest';
import { toolsDocumentation } from '@/mcp/tool-docs';
import { n8nDocumentationToolsFinal } from '@/mcp/tools';
import { n8nManagementTools } from '@/mcp/tools-n8n-manager';
import { queryResponseArtifactTool } from '@/services/mcp-response-bounding';
import { getToolDocumentation, getToolsOverview } from '@/mcp/tools-documentation';

/**
 * The sibling tools-documentation.test.ts mocks @/mcp/tool-docs, so it can verify the
 * lookup logic but never that the registry actually covers the tools we expose. That gap
 * shipped: query_response_artifact was fully callable while
 * tools_documentation({topic: 'query_response_artifact'}) answered "not found", because the
 * response-bounding layer registers its wrappers separately from src/mcp/tools.ts.
 *
 * This file deliberately imports the real registry.
 */

const registeredTools = [
  ...n8nDocumentationToolsFinal,
  ...n8nManagementTools,
  queryResponseArtifactTool,
];

describe('tool documentation coverage', () => {
  it('exposes at least one tool from every registration layer', () => {
    // Guards against a source list going empty and making the coverage test vacuous.
    expect(n8nDocumentationToolsFinal.length).toBeGreaterThan(0);
    expect(n8nManagementTools.length).toBeGreaterThan(0);
    expect(queryResponseArtifactTool.name).toBe('query_response_artifact');
  });

  it.each(registeredTools.map((tool) => tool.name))(
    'documents %s',
    (name) => {
      expect(
        toolsDocumentation[name],
        `${name} is registered as a tool but has no entry in src/mcp/tool-docs. ` +
          'Add one there, or tools_documentation() will report it as not found.'
      ).toBeDefined();
    }
  );

  it.each(registeredTools.map((tool) => tool.name))(
    'answers tools_documentation for %s',
    (name) => {
      // Match the exact sentinel, not the phrase: several tools legitimately describe
      // "errors if the find string is not found" in their own prose.
      const sentinel = `Tool '${name}' not found`;
      expect(getToolDocumentation(name, 'essentials')).not.toContain(sentinel);
      expect(getToolDocumentation(name, 'full')).not.toContain(sentinel);
    }
  );

  it('keeps every docs entry name equal to its registry key', () => {
    for (const [key, doc] of Object.entries(toolsDocumentation)) {
      expect(doc.name, `registry key ${key} holds a doc named ${doc.name}`).toBe(key);
    }
  });

  it('states the real tool count in the overview', () => {
    // The overview said "24 Tools Total" while 26 were exposed, which is how the missing
    // wrapper stayed invisible to anyone reading the catalogue.
    const overview = getToolsOverview('essentials');
    const declared = overview.match(/\((\d+) Tools Total\)/);
    expect(declared, 'overview no longer declares a tool total').not.toBeNull();
    expect(Number(declared![1])).toBe(registeredTools.length);
  });

  it('lists only the semantic artifact query in the overview', () => {
    const overview = getToolsOverview('essentials');
    expect(overview).toContain('query_response_artifact');
    expect(overview).not.toContain('read_response_artifact');
  });
});
