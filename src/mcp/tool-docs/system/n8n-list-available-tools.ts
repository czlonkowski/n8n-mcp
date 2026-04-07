import { ToolDocumentation } from '../types';

export const n8nListAvailableToolsDoc: ToolDocumentation = {
  name: 'n8n_list_available_tools',
  category: 'system',
  essentials: {
    description: 'List all available n8n management tools and their capabilities',
    keyParameters: [],
    example: 'n8n_list_available_tools({})',
    performance: 'Instant - returns static tool list',
    tips: [
      'Shows only tools available with current API configuration',
      'If no n8n tools appear, run n8n_diagnostic to troubleshoot',
      'Tool availability depends on N8N_API_URL and N8N_API_KEY (or N8N_API_COOKIE) being set'
    ]
  },
  full: {
    description: `Lists all available n8n management tools based on current configuration.

This tool provides:
- Complete list of n8n management tools (when API is configured)
- Tool descriptions and capabilities
- Categorized tool listing (workflow, execution, system)
- Dynamic availability based on API configuration

The tool list is dynamic:
- Shows 14+ management tools when N8N_API_URL and N8N_API_KEY (or N8N_API_COOKIE) are configured
- Shows only documentation tools when API is not configured
- Helps discover available functionality
- Provides quick reference for tool names and purposes`,
    parameters: {},
    returns: `Object containing:
- tools: Array of available tool objects, each with:
  - name: Tool identifier (e.g., 'n8n_create_workflow')
  - description: Brief description of tool functionality
  - category: Tool category ('workflow', 'execution', 'system')
  - requiresApi: Whether tool needs API configuration
- categories: Summary count by category
- totalTools: Total number of available tools
- apiConfigured: Whether n8n API is configured`,
    examples: [
      'n8n_list_available_tools({}) - List all available tools',
      '// Check for specific tool availability\nconst tools = await n8n_list_available_tools({});\nconst hasWorkflowTools = tools.tools.some(t => t.category === "workflow");',
      '// Discover management capabilities\nconst result = await n8n_list_available_tools({});\nconsole.log(`${result.totalTools} tools available`);'
    ],
    useCases: [
      'Discovering available n8n management capabilities',
      'Checking if API configuration is working correctly',
      'Finding the right tool for a specific task',
      'Generating help documentation or command lists',
      'Verifying tool availability before automation scripts'
    ],
    performance: `Instant response:
- No API calls required
- Returns pre-defined tool list
- Filtered based on configuration
- Zero network overhead`,
    bestPractices: [
      'Check tool availability before building automation workflows',
      'Use with n8n_diagnostic if expected tools are missing',
      'Reference tool names exactly as returned by this tool',
      'Group operations by category for better organization',
      'Cache results as tool list only changes with configuration'
    ],
    pitfalls: [
      'Tool list is empty if N8N_API_URL and N8N_API_KEY (or N8N_API_COOKIE) are not set',
      'Does not validate if tools will actually work - just shows availability',
      'Tool names must be used exactly as returned',
      'Does not show tool parameters - use tools_documentation for details'
    ],
    relatedTools: ['n8n_diagnostic', 'n8n_health_check', 'tools_documentation']
  }
};