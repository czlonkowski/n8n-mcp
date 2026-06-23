import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { InstanceContext } from './instance-context';

export interface AdditionalToolContext {
  instanceContext?: InstanceContext;
}

export interface AdditionalTool {
  tool: Tool;
  /**
   * Handler invoked for `tools/call` requests matching `tool.name`.
   *
   * Handlers must be stateless or key any internal state by
   * `context.instanceContext.instanceId` — the same handler reference is shared
   * across all per-tenant sessions, so cross-call state inside a closure leaks
   * across tenants.
   */
  handler: (args: unknown, context: AdditionalToolContext) => Promise<CallToolResult>;
}
