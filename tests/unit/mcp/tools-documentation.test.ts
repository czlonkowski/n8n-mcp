import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getToolDocumentation,
  getToolsOverview,
  searchToolDocumentation,
  getToolsByCategory,
  getAllCategories
} from '@/mcp/tools-documentation';

// Mock the tool-docs import
vi.mock('@/mcp/tool-docs', () => ({
  toolsDocumentation: {
    search_nodes: {
      name: 'search_nodes',
      category: 'discovery',
      essentials: {
        description: 'Search nodes by keywords',
        keyParameters: ['query', 'mode', 'limit'],
        example: 'search_nodes({query: "slack"})',
        performance: 'Instant (<10ms)',
        tips: ['Use single words for precision', 'Try FUZZY mode for typos']
      },
      full: {
        description: 'Full-text search across all n8n nodes with multiple matching modes',
        parameters: {
          query: {
            type: 'string',
            description: 'Search terms',
            required: true
          },
          mode: {
            type: 'string',
            description: 'Search mode',
            enum: ['OR', 'AND', 'FUZZY'],
            default: 'OR'
          },
          limit: {
            type: 'number',
            description: 'Max results',
            default: 20
          }
        },
        returns: 'Array of matching nodes with metadata',
        examples: [
          'search_nodes({query: "webhook"})',
          'search_nodes({query: "http request", mode: "AND"})'
        ],
        useCases: ['Finding integration nodes', 'Discovering available triggers'],
        performance: 'Instant - uses in-memory index',
        bestPractices: ['Start with single words', 'Use FUZZY for uncertain names'],
        pitfalls: ['Overly specific queries may return no results'],
        relatedTools: ['get_node', 'get_node_documentation']
      }
    },
    validate_workflow: {
      name: 'validate_workflow',
      category: 'validation',
      essentials: {
        description: 'Validate complete workflow structure',
        keyParameters: ['workflow', 'options'],
        example: 'validate_workflow(workflow)',
        performance: 'Moderate (100-500ms)',
        tips: ['Run before deployment', 'Check all validation types']
      },
      full: {
        description: 'Comprehensive workflow validation',
        parameters: {
          workflow: {
            type: 'object',
            description: 'Workflow JSON',
            required: true
          },
          options: {
            type: 'object',
            description: 'Validation options'
          }
        },
        returns: 'Validation results with errors and warnings',
        examples: ['validate_workflow(workflow)'],
        useCases: ['Pre-deployment checks', 'CI/CD validation'],
        performance: 'Depends on workflow complexity',
        bestPractices: ['Validate before saving', 'Fix errors first'],
        pitfalls: ['Large workflows may take time'],
        relatedTools: ['validate_node']
      }
    },
    get_node_essentials: {
      name: 'get_node_essentials',
      category: 'configuration',
      essentials: {
        description: 'Get essential node properties only',
        keyParameters: ['nodeType'],
        example: 'get_node_essentials("nodes-base.slack")',
        performance: 'Fast (<100ms)',
        tips: ['Use this before get_node_info', 'Returns 95% smaller payload']
      },
      full: {
        description: 'Returns 10-20 most important properties',
        parameters: {
          nodeType: {
            type: 'string',
            description: 'Full node type with prefix',
            required: true
          }
        },
        returns: 'Essential properties with examples',
        examples: ['get_node_essentials("nodes-base.httpRequest")'],
        useCases: ['Quick configuration', 'Property discovery'],
        performance: 'Fast - pre-filtered data',
        bestPractices: ['Always try essentials first'],
        pitfalls: ['May not include all advanced options'],
        relatedTools: ['get_node_info']
      }
    }
  }
}));

// No need to mock package.json - let the actual module read it

describe('tools-documentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getToolDocumentation', () => {
    describe('essentials mode', () => {
      it('should return essential documentation for existing tool', () => {
        const doc = getToolDocumentation('search_nodes', 'essentials');
        
        expect(doc).toContain('# search_nodes');
        expect(doc).toContain('Search nodes by keywords');
        expect(doc).toContain('**Example**: search_nodes({query: "slack"})');
        expect(doc).toContain('**Key parameters**: query, mode, limit');
        expect(doc).toContain('**Performance**: Instant (<10ms)');
        expect(doc).toContain('- Use single words for precision');
        expect(doc).toContain('- Try FUZZY mode for typos');
        expect(doc).toContain('For full documentation, use: tools_documentation({topic: "search_nodes", depth: "full"})');
      });

      it('should return error message for unknown tool', () => {
        const doc = getToolDocumentation('unknown_tool', 'essentials');
        expect(doc).toBe("Tool 'unknown_tool' not found. Use tools_documentation() to see available tools.");
      });

      it('should use essentials as default depth', () => {
        const docDefault = getToolDocumentation('search_nodes');
        const docEssentials = getToolDocumentation('search_nodes', 'essentials');
        expect(docDefault).toBe(docEssentials);
      });
    });

    describe('full mode', () => {
      it('should return complete documentation for existing tool', () => {
        const doc = getToolDocumentation('search_nodes', 'full');
        
        expect(doc).toContain('# search_nodes');
        expect(doc).toContain('Full-text search across all n8n nodes');
        expect(doc).toContain('## Parameters');
        expect(doc).toContain('- **query** (string, required): Search terms');
        expect(doc).toContain('- **mode** (string): Search mode');
        expect(doc).toContain('- **limit** (number): Max results');
        expect(doc).toContain('## Returns');
        expect(doc).toContain('Array of matching nodes with metadata');
        expect(doc).toContain('## Examples');
        expect(doc).toContain('search_nodes({query: "webhook"})');
        expect(doc).toContain('## Common Use Cases');
        expect(doc).toContain('- Finding integration nodes');
        expect(doc).toContain('## Performance');
        expect(doc).toContain('Instant - uses in-memory index');
        expect(doc).toContain('## Best Practices');
        expect(doc).toContain('- Start with single words');
        expect(doc).toContain('## Common Pitfalls');
        expect(doc).toContain('- Overly specific queries');
        expect(doc).toContain('## Related Tools');
        expect(doc).toContain('- get_node');
      });
    });

    describe('special documentation topics', () => {
      it('should return JavaScript Code node guide for javascript_code_node_guide', () => {
        const doc = getToolDocumentation('javascript_code_node_guide', 'essentials');
        expect(doc).toContain('# JavaScript Code Node Guide');
        expect(doc).toContain('$input.all()');
        expect(doc).toContain('DateTime');
      });

      it('should return Python Code node guide for python_code_node_guide', () => {
        const doc = getToolDocumentation('python_code_node_guide', 'essentials');
        expect(doc).toContain('# Python Code Node Guide');
        expect(doc).toContain('_input.all()');
        expect(doc).toContain('_json');
      });

      it('should return full JavaScript guide when requested', () => {
        const doc = getToolDocumentation('javascript_code_node_guide', 'full');
        expect(doc).toContain('# JavaScript Code Node Complete Guide');
        expect(doc).toContain('## Data Access Patterns');
        expect(doc).toContain('## Available Built-in Functions');
        expect(doc).toContain('$helpers.httpRequest');
      });

      it('should return full Python guide when requested', () => {
        const doc = getToolDocumentation('python_code_node_guide', 'full');
        expect(doc).toContain('# Python Code Node Complete Guide');
        expect(doc).toContain('## Available Built-in Modules');
        expect(doc).toContain('## Limitations & Workarounds');
        expect(doc).toContain('import json');
      });
    });
  });

  describe('getToolsOverview', () => {
    describe('essentials mode', () => {
      it('should return essential overview with categories', () => {
        const overview = getToolsOverview('essentials');
        
        expect(overview).toContain('# n8n MCP Tools Reference');
        expect(overview).toContain('## Important: Compatibility Notice');
        // The tools-documentation module dynamically reads version from package.json
        // so we need to read it the same way to match
        const packageJson = require('../../../package.json');
        const n8nVersion = packageJson.dependencies['n8n-nodes-base'].replace(/[^0-9.]/g, '');
        expect(overview).toContain(`n8n version ${n8nVersion}`);
        expect(overview).toContain('## Code Node Configuration');
        expect(overview).toContain('## Standard Workflow Pattern');
        expect(overview).toContain('**Discovery Tools**');
        expect(overview).toContain('**Configuration Tools**');
        expect(overview).toContain('**Validation Tools**');
        expect(overview).toContain('## Performance Characteristics');
        expect(overview).toContain('- Instant (<10ms)');
        expect(overview).toContain('tools_documentation({topic: "tool_name", depth: "full"})');
      });

      it('should use essentials as default', () => {
        const overviewDefault = getToolsOverview();
        const overviewEssentials = getToolsOverview('essentials');
        expect(overviewDefault).toBe(overviewEssentials);
      });
    });

    describe('full mode', () => {
      it('should return complete overview with all tools', () => {
        const overview = getToolsOverview('full');
        
        expect(overview).toContain('# n8n MCP Tools - Complete Reference');
        expect(overview).toContain('## All Available Tools by Category');
        expect(overview).toContain('### Discovery');
        expect(overview).toContain('- **search_nodes**: Search nodes by keywords');
        expect(overview).toContain('### Validation');
        expect(overview).toContain('- **validate_workflow**: Validate complete workflow structure');
        expect(overview).toContain('## Usage Notes');
      });
    });
  });

  describe('searchToolDocumentation', () => {
    it('should find tools matching keyword in name', () => {
      const results = searchToolDocumentation('search');
      expect(results).toContain('search_nodes');
    });

    it('should find tools matching keyword in description', () => {
      const results = searchToolDocumentation('workflow');
      expect(results).toContain('validate_workflow');
    });

    it('should be case insensitive', () => {
      const resultsLower = searchToolDocumentation('search');
      const resultsUpper = searchToolDocumentation('SEARCH');
      expect(resultsLower).toEqual(resultsUpper);
    });

    it('should return empty array for no matches', () => {
      const results = searchToolDocumentation('nonexistentxyz123');
      expect(results).toEqual([]);
    });

    it('should search in both essentials and full descriptions', () => {
      const results = searchToolDocumentation('validation');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('getToolsByCategory', () => {
    it('should return tools for discovery category', () => {
      const tools = getToolsByCategory('discovery');
      expect(tools).toContain('search_nodes');
    });

    it('should return tools for validation category', () => {
      const tools = getToolsByCategory('validation');
      expect(tools).toContain('validate_workflow');
    });

    it('should return tools for configuration category', () => {
      const tools = getToolsByCategory('configuration');
      expect(tools).toContain('get_node_essentials');
    });

    it('should return empty array for unknown category', () => {
      const tools = getToolsByCategory('unknown_category');
      expect(tools).toEqual([]);
    });
  });

  describe('getAllCategories', () => {
    it('should return all unique categories', () => {
      const categories = getAllCategories();
      expect(categories).toContain('discovery');
      expect(categories).toContain('validation');
      expect(categories).toContain('configuration');
    });

    it('should not have duplicates', () => {
      const categories = getAllCategories();
      const uniqueCategories = new Set(categories);
      expect(categories.length).toBe(uniqueCategories.size);
    });

    it('should return non-empty array', () => {
      const categories = getAllCategories();
      expect(categories.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing tool gracefully', () => {
      const doc = getToolDocumentation('missing_tool');
      expect(doc).toContain("Tool 'missing_tool' not found");
      expect(doc).toContain('Use tools_documentation()');
    });

    it('should handle empty search query', () => {
      const results = searchToolDocumentation('');
      // Should match all tools since empty string is in everything
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Documentation Quality', () => {
    it('should format parameters correctly in full mode', () => {
      const doc = getToolDocumentation('search_nodes', 'full');
      
      // Check parameter formatting
      expect(doc).toMatch(/- \*\*query\*\* \(string, required\): Search terms/);
      expect(doc).toMatch(/- \*\*mode\*\* \(string\): Search mode/);
      expect(doc).toMatch(/- \*\*limit\*\* \(number\): Max results/);
    });

    it('should include code blocks for examples', () => {
      const doc = getToolDocumentation('search_nodes', 'full');
      expect(doc).toContain('```javascript');
      expect(doc).toContain('```');
    });

    it('should have consistent section headers', () => {
      const doc = getToolDocumentation('search_nodes', 'full');
      const expectedSections = [
        '## Parameters',
        '## Returns',
        '## Examples',
        '## Common Use Cases',
        '## Performance',
        '## Best Practices',
        '## Common Pitfalls',
        '## Related Tools'
      ];
      
      expectedSections.forEach(section => {
        expect(doc).toContain(section);
      });
    });
  });
});