/**
 * Protocol Version Negotiation Utility
 * 
 * Handles MCP protocol version negotiation between server and clients,
 * with special handling for n8n clients that require specific versions.
 */

export interface ClientInfo {
  name?: string;
  version?: string;
  [key: string]: any;
}

export interface ProtocolNegotiationResult {
  version: string;
  isN8nClient: boolean;
  reasoning: string;
}

/**
 * Latest MCP protocol revision this server offers.
 *
 * Must stay within the pinned @modelcontextprotocol/sdk's
 * SUPPORTED_PROTOCOL_VERSIONS — the SDK cannot serve a revision it does not know.
 */
export const STANDARD_PROTOCOL_VERSION = '2025-11-25';

/**
 * n8n specific protocol version (what n8n expects)
 */
export const N8N_PROTOCOL_VERSION = '2024-11-05';

/**
 * Revision assumed when a client omits protocolVersion during initialize.
 *
 * The field is required by the spec, but lenient clients leave it out. Mirroring
 * the SDK's DEFAULT_NEGOTIATED_PROTOCOL_VERSION keeps those clients on the
 * revision they already received instead of handing them a newer one they may
 * not implement.
 */
export const DEFAULT_NEGOTIATED_PROTOCOL_VERSION = '2025-03-26';

/**
 * Supported protocol versions in order of preference.
 *
 * Mirrors the SDK's SUPPORTED_PROTOCOL_VERSIONS. Every entry here must be one
 * the SDK can negotiate, otherwise we echo back a revision the transport will
 * not honor.
 */
export const SUPPORTED_VERSIONS = [
  STANDARD_PROTOCOL_VERSION,           // 2025-11-25
  '2025-06-18',
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION, // 2025-03-26
  N8N_PROTOCOL_VERSION,                // 2024-11-05
  '2024-10-07',
];

/**
 * Detect if the client is n8n based on various indicators
 */
export function isN8nClient(
  clientInfo?: ClientInfo, 
  userAgent?: string,
  headers?: Record<string, string | string[] | undefined>
): boolean {
  // Check client info
  if (clientInfo?.name) {
    const clientName = clientInfo.name.toLowerCase();
    if (clientName.includes('n8n') || clientName.includes('langchain')) {
      return true;
    }
  }

  // Check user agent
  if (userAgent) {
    const ua = userAgent.toLowerCase();
    if (ua.includes('n8n') || ua.includes('langchain')) {
      return true;
    }
  }

  // Check headers for n8n-specific indicators
  if (headers) {
    // Check for n8n-specific headers or values
    const headerValues = Object.values(headers).join(' ').toLowerCase();
    if (headerValues.includes('n8n') || headerValues.includes('langchain')) {
      return true;
    }
    
    // Check specific header patterns that n8n might use
    if (headers['x-n8n-version'] || headers['x-langchain-version']) {
      return true;
    }
  }

  // Check environment variable that might indicate n8n mode
  if (process.env.N8N_MODE === 'true') {
    return true;
  }

  return false;
}

/**
 * Negotiate protocol version based on client information
 */
export function negotiateProtocolVersion(
  clientRequestedVersion?: string,
  clientInfo?: ClientInfo,
  userAgent?: string,
  headers?: Record<string, string | string[] | undefined>
): ProtocolNegotiationResult {
  const isN8n = isN8nClient(clientInfo, userAgent, headers);
  
  // For n8n clients, always use the n8n-specific version
  if (isN8n) {
    return {
      version: N8N_PROTOCOL_VERSION,
      isN8nClient: true,
      reasoning: 'n8n client detected, using n8n-compatible protocol version'
    };
  }

  // If client requested a specific version, try to honor it if supported
  if (clientRequestedVersion && SUPPORTED_VERSIONS.includes(clientRequestedVersion)) {
    return {
      version: clientRequestedVersion,
      isN8nClient: false,
      reasoning: `Using client-requested version: ${clientRequestedVersion}`
    };
  }

  // If client requested an unsupported version, use the closest supported one
  if (clientRequestedVersion) {
    // For now, default to standard version for unknown requests
    return {
      version: STANDARD_PROTOCOL_VERSION,
      isN8nClient: false,
      reasoning: `Client requested unsupported version ${clientRequestedVersion}, using standard version`
    };
  }

  // Client omitted protocolVersion — stay on the conservative default rather
  // than offering our latest to a client that never stated what it speaks
  return {
    version: DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
    isN8nClient: false,
    reasoning: 'Client did not request a version, using default negotiated version'
  };
}

/**
 * Check if a protocol version is supported
 */
export function isVersionSupported(version: string): boolean {
  return SUPPORTED_VERSIONS.includes(version);
}

/**
 * Get the most appropriate protocol version for backwards compatibility
 * This is used when we need to maintain compatibility with older clients
 */
export function getCompatibleVersion(targetVersion?: string): string {
  if (!targetVersion) {
    return DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
  }

  if (SUPPORTED_VERSIONS.includes(targetVersion)) {
    return targetVersion;
  }

  // If not supported, return the most recent supported version
  return STANDARD_PROTOCOL_VERSION;
}

/**
 * Log protocol version negotiation for debugging
 */
export function logProtocolNegotiation(
  result: ProtocolNegotiationResult,
  logger: any,
  context?: string
): void {
  const logContext = context ? `[${context}] ` : '';
  
  logger.info(`${logContext}Protocol version negotiated`, {
    version: result.version,
    isN8nClient: result.isN8nClient,
    reasoning: result.reasoning
  });
  
  if (result.isN8nClient) {
    logger.info(`${logContext}Using n8n-compatible protocol version for better integration`);
  }
}