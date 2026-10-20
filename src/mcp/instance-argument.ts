/**
 * Per-call instance targeting for multi-instance embedders.
 *
 * A hosting layer that routes one credential to several n8n instances can ask the
 * server (via `InstanceContext.instanceArgument`) to advertise an optional `instance`
 * argument on every management tool. The embedder reads the argument and routes the
 * call. The server itself never acts on it: it only advertises the argument, and
 * drops it before dispatch so handlers and their schema validation never see it.
 */
import type { InstanceContext } from '../types/instance-context';

export const INSTANCE_ARGUMENT = 'instance';

const INSTANCE_PROPERTY = {
  type: 'string',
  description:
    'Optional. Name of the n8n instance this call targets (as listed by n8n_instances). ' +
    'Targets only this call and changes nothing for other chats or agents; pass it on every call when working on several instances in parallel. ' +
    'Omit it to use the current instance.',
} as const;

export function isInstanceArgumentEnabled(context?: InstanceContext): boolean {
  return context?.instanceArgument === true;
}

/** Return a copy of the tool with the optional `instance` property added to its input schema. */
export function withInstanceArgument<T extends { inputSchema?: any }>(tool: T): T {
  const schema = tool.inputSchema ?? { type: 'object', properties: {} };
  return {
    ...tool,
    inputSchema: {
      ...schema,
      properties: { ...(schema.properties ?? {}), [INSTANCE_ARGUMENT]: INSTANCE_PROPERTY },
    },
  };
}

/** Drop the `instance` argument, if present, returning the remaining arguments. */
export function withoutInstanceArgument<T extends Record<string, any> | undefined>(args: T): T {
  if (!args || typeof args !== 'object' || !(INSTANCE_ARGUMENT in args)) return args;
  const { [INSTANCE_ARGUMENT]: _dropped, ...rest } = args;
  return rest as T;
}
