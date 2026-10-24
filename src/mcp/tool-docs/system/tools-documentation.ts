import { ToolDocumentation } from '../types';

export const toolsDocumentationDoc: ToolDocumentation = {
  name: 'tools_documentation',
  category: 'system',
  essentials: {
    description: 'The meta-documentation tool. Returns documentation for any MCP tool, including itself. Call without parameters for a comprehensive overview of all available tools. This is your starting point for discovering n8n MCP capabilities.',
    keyParameters: ['topic', 'depth'],
    example: 'tools_documentation({topic: "search_nodes"})',
    performance: 'Instant (static content)',
    tips: [
      'Call without parameters first to see all tools',
      'Can document itself: tools_documentation({topic: "tools_documentation"})',
      'Use depth:"full" for comprehensive details'
    ]
  },
  full: {
    description: 'The self-referential documentation system for all MCP tools. This tool can document any other tool, including itself. It\'s the primary discovery mechanism for understanding what tools are available and how to use them. Returns utilitarian documentation optimized for AI agent consumption.',
    parameters: {
      topic: { type: 'string', description: 'Tool name (e.g., "search_nodes"), special topic ("expression_helpers", "javascript_code_node_guide", "python_code_node_guide"), or "overview". Leave empty for quick reference.', required: false },
      depth: { type: 'string', description: 'Level of detail: "essentials" (default, concise) or "full" (comprehensive with examples)', required: false }
    },
    returns: 'Markdown-formatted documentation tailored for the requested tool and depth. For essentials: key info, parameters, example, tips. For full: complete details, all examples, use cases, best practices.',
    examples: [
      '// Get started - see all available tools',
      'tools_documentation()',
      '',
      '// Learn about a specific tool',
      'tools_documentation({topic: "search_nodes"})',
      '',
      '// Get comprehensive details',
      'tools_documentation({topic: "validate_workflow", depth: "full"})',
      '',
      '// Self-referential example - document this tool',
      'tools_documentation({topic: "tools_documentation", depth: "full"})',
      '',
      '// Guides',
      'tools_documentation({topic: "expression_helpers"})',
      'tools_documentation({topic: "javascript_code_node_guide"})',
      'tools_documentation({topic: "python_code_node_guide"})'
    ],
    useCases: [
      'Initial discovery of available MCP tools',
      'Learning how to use specific tools',
      'Finding required and optional parameters',
      'Getting working examples to copy',
      'Understanding tool performance characteristics',
      'Discovering related tools for workflows'
    ],
    performance: 'Instant - all documentation is pre-loaded in memory',
    bestPractices: [
      'Always start with tools_documentation() to see available tools',
      'Use essentials for quick parameter reference during coding',
      'Switch to full depth when debugging or learning new tools',
      'Check expression_helpers before writing a Code node for a one-line transformation',
      'Check the Code node guides when a Code node is the right choice'
    ],
    pitfalls: [
      'Tool names must match exactly - use the overview to find correct names',
      'Not all internal functions are documented',
      'Special topics (expression_helpers, code guides) require exact names'
    ],
    relatedTools: ['n8n_health_check for verifying API connection', 'search_templates for workflow examples', 'search_nodes for finding nodes']
  }
};