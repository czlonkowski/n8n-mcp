import { AsyncLocalStorage } from 'async_hooks';
import type { InstanceContext } from '../types/instance-context';

interface RequestScope {
  /** The server the request was dispatched to. */
  owner: object;
  instanceContext: InstanceContext | undefined;
}

const requestScope = new AsyncLocalStorage<RequestScope>();

/**
 * Run `fn` with `instanceContext` as the instance context of the current request
 * to `owner`. Code reached from `fn`, including after awaits, reads it through
 * `getRequestScope(owner)`.
 */
export function runWithRequestContext<T>(owner: object, instanceContext: InstanceContext | undefined, fn: () => T): T {
  return requestScope.run({ owner, instanceContext }, fn);
}

/** The current request's scope if it belongs to `owner`, otherwise undefined. */
export function getRequestScope(owner: object): RequestScope | undefined {
  const scope = requestScope.getStore();
  return scope?.owner === owner ? scope : undefined;
}
