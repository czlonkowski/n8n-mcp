import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SequentialMetadataProcessor } from '../../../src/templates/sequential-processor';
import { MetadataRequest, TemplateMetadata } from '../../../src/templates/metadata-generator';

const mockChatCreate = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor(public config: any) {}
    chat = { completions: { create: mockChatCreate } };
  }
}));

const VALID_METADATA: TemplateMetadata = {
  categories: ['AI/ML'],
  complexity: 'simple',
  use_cases: ['testing'],
  estimated_setup_minutes: 10,
  required_services: ['Test Service'],
  key_features: ['feature one'],
  target_audience: ['developers']
};

function makeRequest(id: number): MetadataRequest {
  return { templateId: id, name: `Template ${id}`, nodes: ['n8n-nodes-base.set'] };
}

function mockOk() {
  mockChatCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(VALID_METADATA) } }]
  });
}

function mockFail(message = 'boom') {
  mockChatCreate.mockRejectedValueOnce(new Error(message));
}

describe('SequentialMetadataProcessor', () => {
  beforeEach(() => {
    mockChatCreate.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('returns one result per template', async () => {
    [1, 2, 3].forEach(mockOk);
    const proc = new SequentialMetadataProcessor({
      baseURL: 'http://localhost:8000/v1',
      apiKey: 'not-needed',
      concurrency: 2
    });

    const results = await proc.processTemplates([makeRequest(1), makeRequest(2), makeRequest(3)]);

    expect(results.size).toBe(3);
    expect(results.get(1)?.error).toBeUndefined();
    expect(results.get(2)?.metadata.categories).toEqual(['AI/ML']);
    expect(mockChatCreate).toHaveBeenCalledTimes(3);
  });

  it('captures per-template failures without aborting the batch', async () => {
    mockOk();
    mockFail('rate limited');
    mockOk();
    const proc = new SequentialMetadataProcessor({
      baseURL: 'http://localhost:8000/v1',
      apiKey: 'not-needed',
      concurrency: 1
    });

    const results = await proc.processTemplates([makeRequest(10), makeRequest(20), makeRequest(30)]);

    expect(results.size).toBe(3);
    expect(results.get(20)?.error).toContain('rate limited');
    // Failure should still produce a row with default metadata so the caller can update DB selectively
    expect(results.get(20)?.metadata).toBeDefined();
    expect(results.get(10)?.error).toBeUndefined();
    expect(results.get(30)?.error).toBeUndefined();
  });

  it('reports progress through the callback', async () => {
    [1, 2].forEach(mockOk);
    const calls: Array<{ message: string; current: number; total: number }> = [];
    const proc = new SequentialMetadataProcessor({
      baseURL: 'http://localhost:8000/v1',
      apiKey: 'not-needed',
      concurrency: 1
    });

    await proc.processTemplates(
      [makeRequest(1), makeRequest(2)],
      (message, current, total) => calls.push({ message, current, total })
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ message: 'Generating metadata', current: 1, total: 2 });
    expect(calls[1]).toEqual({ message: 'Generating metadata', current: 2, total: 2 });
  });

  it('caps concurrency at the template count', async () => {
    [1, 2].forEach(mockOk);
    const proc = new SequentialMetadataProcessor({
      baseURL: 'http://localhost:8000/v1',
      apiKey: 'not-needed',
      concurrency: 100
    });

    const results = await proc.processTemplates([makeRequest(1), makeRequest(2)]);

    expect(results.size).toBe(2);
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it('returns an empty map for an empty input', async () => {
    const proc = new SequentialMetadataProcessor({
      baseURL: 'http://localhost:8000/v1',
      apiKey: 'not-needed',
      concurrency: 4
    });

    const results = await proc.processTemplates([]);

    expect(results.size).toBe(0);
    expect(mockChatCreate).not.toHaveBeenCalled();
  });
});
