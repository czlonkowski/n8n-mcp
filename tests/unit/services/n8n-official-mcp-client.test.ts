import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { startFakeOfficialMcp, FakeOfficialMcp } from '../../helpers/fake-official-mcp-server';
import { N8nOfficialMcpClient } from '@/services/n8n-official-mcp-client';

let savedMode: string | undefined;
beforeAll(() => { savedMode = process.env.WEBHOOK_SECURITY_MODE; process.env.WEBHOOK_SECURITY_MODE = 'moderate'; });
afterAll(() => { if (savedMode === undefined) delete process.env.WEBHOOK_SECURITY_MODE; else process.env.WEBHOOK_SECURITY_MODE = savedMode; });

describe('N8nOfficialMcpClient', () => {
  let fake: FakeOfficialMcp;
  afterEach(async () => { await fake?.close(); });

  it('lists tools from the fake server with the bearer token', async () => {
    fake = await startFakeOfficialMcp({ token: 'tok', tools: [{ name: 'search_agents' }, { name: 'get_agent' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const caps = await client.capabilities();
    expect(caps.reachable).toBe(true);
    expect(caps.toolNames).toEqual(['search_agents', 'get_agent']);
    expect(caps.agentTools).toBe(true);
    expect(fake.requests.every(r => r.authorization === 'Bearer tok')).toBe(true);
    await client.close();
  });
});
