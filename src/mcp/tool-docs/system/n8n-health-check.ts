import { ToolDocumentation } from '../types';

export const n8nHealthCheckDoc: ToolDocumentation = {
  name: 'n8n_health_check',
  category: 'system',
  essentials: {
    description: 'Check n8n instance health, API connectivity, version status, and performance metrics',
    keyParameters: ['mode', 'verbose'],
    example: 'n8n_health_check({mode: "status"})',
    performance: 'Fast - single API call (~150-200ms median)',
    tips: [
      'Use before starting workflow operations to ensure n8n is responsive',
      'Automatically checks if n8n-mcp version is outdated',
      'Returns version info, performance metrics, and next-step recommendations',
      'New: Shows cache hit rate and response time for performance monitoring'
    ]
  },
  full: {
    description: `Performs a comprehensive health check of the configured n8n instance through its API.

This tool verifies:
- API endpoint accessibility and response time
- n8n instance version and build information
- Authentication status and permissions
- Available features and enterprise capabilities
- Database connectivity (as reported by n8n)
- Queue system status (if configured)

Health checks are crucial for:
- Monitoring n8n instance availability
- Detecting performance degradation
- Verifying API compatibility before operations
- Ensuring authentication is working correctly`,
    parameters: {
      mode: {
        type: 'string',
        required: false,
        description: 'Operation mode: "status" (default) for quick health check, "diagnostic" for detailed debug info including env vars and tool status',
        default: 'status',
        enum: ['status', 'diagnostic']
      },
      verbose: {
        type: 'boolean',
        required: false,
        description: 'Include extra details in diagnostic mode',
        default: false
      }
    },
    returns: `Health status object containing:
- status: Overall health status ('healthy', 'degraded', 'error')
- n8nVersion: n8n instance version information
- instanceId: Unique identifier for the n8n instance
- features: Object listing available features and their status
- mcpVersion: Current n8n-mcp version
- supportedN8nVersion: Recommended n8n version for compatibility
- versionCheck: Version status information
  - current: Current n8n-mcp version
  - latest: Latest available version from npm
  - upToDate: Boolean indicating if version is current
  - message: Formatted version status message
  - updateCommand: Command to update (if outdated)
- performance: Performance metrics
  - responseTimeMs: API response time in milliseconds
  - cacheHitRate: Cache efficiency percentage
  - cachedInstances: Number of cached API instances
- nextSteps: Recommended actions after health check
- updateWarning: Warning if version is outdated (if applicable)`,
    examples: [
      'n8n_health_check({}) - Complete health check with version and performance data',
      '// Use in monitoring scripts\nconst health = await n8n_health_check({});\nif (health.status !== "ok") alert("n8n is down!");\nif (!health.versionCheck.upToDate) console.log("Update available:", health.versionCheck.updateCommand);',
      '// Check before critical operations\nconst health = await n8n_health_check({});\nif (health.performance.responseTimeMs > 1000) console.warn("n8n is slow");\nif (health.versionCheck.isOutdated) console.log(health.updateWarning);'
    ],
    useCases: [
      'Pre-flight checks before workflow deployments',
      'Continuous monitoring of n8n instance health',
      'Troubleshooting connectivity or performance issues',
      'Verifying n8n version compatibility with workflows',
      'Detecting feature availability (enterprise features, queue mode, etc.)'
    ],
    performance: `Fast response expected:
- Single HTTP request to /health endpoint
- Typically responds in <100ms for healthy instances
- Timeout after 10 seconds indicates severe issues
- Minimal server load - safe for frequent polling`,
    bestPractices: [
      'Run health checks before batch operations or deployments',
      'Set up automated monitoring with regular health checks',
      'Log response times to detect performance trends',
      'Check version compatibility when deploying workflows',
      'Use health status to implement circuit breaker patterns'
    ],
    pitfalls: [
      'Requires N8N_API_URL and N8N_API_KEY (or N8N_API_COOKIE) to be configured',
      'Network issues may cause false negatives',
      'Does not check individual workflow health',
      'Health endpoint might be cached - not real-time for all metrics'
    ],
    relatedTools: ['n8n_list_workflows', 'n8n_validate_workflow', 'n8n_workflow_versions']
  }
};