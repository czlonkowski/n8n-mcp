import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import crypto from 'crypto';

/**
 * In-memory OAuth client store implementing RFC 7591 Dynamic Client Registration.
 * When a client registers without specifying scopes, defaults to the server's supported scopes.
 */
export class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();
  private defaultScopes: string[];

  constructor(defaultScopes: string[] = ['mcp:read', 'mcp:write']) {
    this.defaultScopes = defaultScopes;
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    clientData: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): OAuthClientInformationFull {
    const clientId = crypto.randomUUID();
    const clientSecret = crypto.randomBytes(32).toString('hex');
    const now = Math.floor(Date.now() / 1000);

    const client: OAuthClientInformationFull = {
      ...clientData,
      // If client didn't specify scopes, grant the server's supported scopes
      scope: clientData.scope || this.defaultScopes.join(' '),
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: now,
      // Secret does not expire
      client_secret_expires_at: 0,
    };

    this.clients.set(clientId, client);
    return client;
  }
}
