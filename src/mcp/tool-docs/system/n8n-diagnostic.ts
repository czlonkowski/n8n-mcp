import { ToolDocumentation } from '../types';

export const n8nDiagnosticDoc: ToolDocumentation = {
  name: 'n8n_diagnostic',
  category: 'system',
  essentials: {
    description: 'Comprehensive diagnostic with environment-aware debugging, version checks, performance metrics, and mode-specific troubleshooting',
    keyParameters: ['verbose'],
    example: 'n8n_diagnostic({verbose: true})',
    performance: 'Fast - checks environment, API, and npm version (~180ms median)',
    tips: [
      'Now includes environment-aware debugging based on MCP_MODE (http/stdio)',
      'Provides mode-specific troubleshooting (HTTP server vs Claude Desktop)',
      'Detects Docker and cloud platforms for targeted guidance',
      'Shows performance metrics: response time and cache statistics',
      'Includes data-driven tips based on 82% user success rate'
    ]
  },
  full: {
    description: `Comprehensive diagnostic tool for troubleshooting n8n API configuration and management tool availability.

This tool performs a detailed check of:
- Environment variable configuration (N8N_API_URL, N8N_API_KEY or N8N_API_COOKIE)
- API connectivity and authentication
- Tool availability status
- Common configuration issues

The diagnostic is essential when:
- n8n management tools aren't showing up in the available tools list
- API calls are failing with authentication or connection errors
- You need to verify your n8n instance configuration`,
    parameters: {
      verbose: {
        type: 'boolean',
        description: 'Include detailed debug information including full environment variables and API response details',
        required: false,
        default: false
      }
    },
    returns: `Comprehensive diagnostic report containing:
- timestamp: ISO timestamp of diagnostic run
- environment: Enhanced environment variables
  - N8N_API_URL, N8N_API_KEY (masked), N8N_API_COOKIE (masked), NODE_ENV, MCP_MODE
  - isDocker: Boolean indicating if running in Docker
  - cloudPlatform: Detected cloud platform (railway/render/fly/etc.) or null
  - nodeVersion: Node.js version
  - platform: OS platform (darwin/win32/linux)
- apiConfiguration: API configuration and connectivity status
  - configured, status (connected/error/version), config details
- versionInfo: Version check results (current, latest, upToDate, message, updateCommand)
- toolsAvailability: Tool availability breakdown (doc tools + management tools)
- performance: Performance metrics (responseTimeMs, cacheHitRate, cachedInstances)
- modeSpecificDebug: Mode-specific debugging (ALWAYS PRESENT)
  - HTTP mode: port, authTokenConfigured, serverUrl, healthCheckUrl, troubleshooting steps, commonIssues
  - stdio mode: configLocation, troubleshooting steps, commonIssues
- dockerDebug: Docker-specific guidance (if IS_DOCKER=true)
  - containerDetected, troubleshooting steps, commonIssues
- cloudPlatformDebug: Cloud platform-specific tips (if platform detected)
  - name, troubleshooting steps tailored to platform (Railway/Render/Fly/K8s/AWS/etc.)
- nextSteps: Context-specific guidance (if API connected)
- troubleshooting: Troubleshooting guidance (if API not connecting)
- setupGuide: Setup guidance (if API not configured)
- updateWarning: Update recommendation (if version outdated)
- debug: Verbose debug information (if verbose=true)`,
    examples: [
      'n8n_diagnostic({}) - Quick diagnostic check',
      'n8n_diagnostic({verbose: true}) - Detailed diagnostic with environment info',
      'n8n_diagnostic({verbose: false}) - Standard diagnostic without sensitive data'
    ],
    useCases: [
      'Initial setup verification after configuring N8N_API_URL and N8N_API_KEY (or N8N_API_COOKIE)',
      'Troubleshooting when n8n management tools are not available',
      'Debugging API connection failures or authentication errors',
      'Verifying n8n instance compatibility and feature availability',
      'Pre-deployment checks before using workflow management tools'
    ],
    performance: `Instant response time:
- No database queries
- Only checks environment and makes one test API call
- Verbose mode adds minimal overhead
- Safe to run frequently for monitoring`,
    bestPractices: [
      'Always run diagnostic first when encountering n8n tool issues',
      'Use verbose mode only in secure environments (may expose API URLs)',
      'Check diagnostic before attempting workflow operations',
      'Include diagnostic output when reporting issues',
      'Run after any configuration changes to verify setup'
    ],
    pitfalls: [
      'Verbose mode may expose sensitive configuration details - use carefully',
      'Requires proper environment variables to detect n8n configuration',
      'API connectivity test requires network access to n8n instance',
      'Does not test specific workflow operations, only basic connectivity'
    ],
    relatedTools: ['n8n_health_check', 'n8n_list_available_tools', 'tools_documentation']
  }
};