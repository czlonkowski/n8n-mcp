import { ToolDocumentation } from '../types';

export const getNodeDoc: ToolDocumentation = {
  name: 'get_node',
  category: 'configuration',
  essentials: {
    description: 'Unified node information tool with progressive detail levels and multiple modes. Get node schema, docs, search properties, or version info.',
    keyParameters: ['nodeType', 'detail', 'mode', 'includeTypeInfo', 'includeExamples'],
    example: 'get_node({nodeType: "nodes-base.httpRequest", detail: "standard"})',
    performance: 'Instant (<10ms) for minimal/standard, moderate for full',
    tips: [
      'Use detail="standard" (default) for most tasks - shows required fields',
      'Use mode="docs" for readable markdown documentation',
      'Use mode="search_properties" with propertyQuery to find specific fields',
      'Use mode="versions" to check version history and breaking changes',
      'Add includeExamples=true to get real-world configuration examples'
    ]
  },
  full: {
    description: `**Detail Levels (mode="info", default):**
- minimal (~200 tokens): Basic metadata only - nodeType, displayName, description, category
- standard (~1-2K tokens): Essential properties + operations - recommended for most tasks
- full (~3-8K tokens): Complete node schema - use only when standard insufficient

**Operation Modes:**
- info (default): Node schema with configurable detail level
- docs: Readable markdown documentation with examples and patterns
- search_properties: Find specific properties within a node
- versions: List all available versions with breaking changes summary
- compare: Compare two versions with property-level changes
- breaking: Show only breaking changes between versions
- migrations: Show auto-migratable changes between versions`,
    parameters: {
      nodeType: { type: 'string', required: true, description: 'Full node type with prefix: "nodes-base.httpRequest" or "nodes-langchain.agent"' },
      detail: { type: 'string', required: false, description: 'Detail level for mode=info: "minimal", "standard" (default), "full"' },
      mode: { type: 'string', required: false, description: 'Operation mode: "info" (default), "docs", "search_properties", "versions", "compare", "breaking", "migrations"' },
      includeTypeInfo: { type: 'boolean', required: false, description: 'Include type structure metadata (validation rules, JS types). Adds ~80-120 tokens per property' },
      includeExamples: { type: 'boolean', required: false, description: 'Include real-world configuration examples from templates. Adds ~200-400 tokens per example' },
      propertyQuery: { type: 'string', required: false, description: 'For mode=search_properties: search term to find properties (e.g., "auth", "header", "body")' },
      maxPropertyResults: { type: 'number', required: false, description: 'For mode=search_properties: max results (default 20)' },
      fromVersion: { type: 'string', required: false, description: 'For compare/breaking/migrations modes: source typeVersion as workflows store it (e.g., "1", "4.1")' },
      toVersion: { type: 'string', required: false, description: 'For compare/breaking/migrations modes: target typeVersion (e.g., "2"). Defaults to the current version' }
    },
    returns: `Depends on mode:
- info: Node schema with properties based on detail level
- docs: Markdown documentation string
- search_properties: Array of matching property paths with descriptions
- versions: Version history with breaking changes flags
- compare/breaking/migrations: Version comparison details`,
    examples: [
      '// Standard detail (recommended for AI agents)\nget_node({nodeType: "nodes-base.httpRequest"})',
      '// Minimal for quick metadata check\nget_node({nodeType: "nodes-base.slack", detail: "minimal"})',
      '// Full detail with examples\nget_node({nodeType: "nodes-base.googleSheets", detail: "full", includeExamples: true})',
      '// Get readable documentation\nget_node({nodeType: "nodes-base.webhook", mode: "docs"})',
      '// Search for authentication properties\nget_node({nodeType: "nodes-base.httpRequest", mode: "search_properties", propertyQuery: "auth"})',
      '// Check version history\nget_node({nodeType: "nodes-base.executeWorkflow", mode: "versions"})',
      '// Compare specific versions\nget_node({nodeType: "nodes-base.httpRequest", mode: "compare", fromVersion: "3", toVersion: "4.1"})'
    ],
    useCases: [
      'Configure nodes for workflow building (use detail=standard)',
      'Find specific configuration options (use mode=search_properties)',
      'Get human-readable node documentation (use mode=docs)',
      'Check for breaking changes before version upgrades (use mode=breaking)',
      'Understand complex types with includeTypeInfo=true'
    ],
    performance: `Token costs by detail level:
- minimal: ~200 tokens
- standard: ~1000-2000 tokens (default)
- full: ~3000-8000 tokens
- includeTypeInfo: +80-120 tokens per property
- includeExamples: +200-400 tokens per example
- Version modes: ~400-1200 tokens`,
    bestPractices: [
      'Start with detail="standard" - it covers 95% of use cases',
      'Only use detail="full" if standard is missing required properties',
      'Use mode="docs" when explaining nodes to users',
      'Combine includeTypeInfo=true for complex nodes (filter, resourceMapper)',
      'Check version history before configuring versioned nodes'
    ],
    pitfalls: [
      'detail="full" returns large responses (~100KB) - use sparingly',
      'Node type must include prefix (nodes-base. or nodes-langchain.)',
      'includeExamples only works with mode=info and detail=standard',
      'Version modes require nodes with multiple versions in database'
    ],
    relatedTools: ['search_nodes', 'validate_node', 'validate_workflow']
  }
};
