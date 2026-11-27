/**
 * MCP protocol revision negotiation for initialize responses built outside the SDK.
 *
 * The stdio and default HTTP paths let @modelcontextprotocol/sdk negotiate. The
 * deprecated fixed HTTP server and the N8N_MODE GET info endpoint build their
 * responses by hand, so they apply the same rule here, from the SDK's own list.
 */

import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js';

export { LATEST_PROTOCOL_VERSION };

/**
 * Same rule as the SDK Server: answer with the client's requested revision when
 * the SDK supports it, otherwise with the latest one.
 */
export function negotiateProtocolVersion(requestedVersion: unknown): string {
  return typeof requestedVersion === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
    ? requestedVersion
    : LATEST_PROTOCOL_VERSION;
}
