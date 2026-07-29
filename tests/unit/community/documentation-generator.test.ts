import { describe, it, expect, vi } from 'vitest';
import {
  DocumentationGenerator,
  DocumentationInput,
} from '@/community/documentation-generator';

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function buildPrompt(input: DocumentationInput): string {
  // The constructor only configures an HTTP client, so no server is contacted.
  const generator = new DocumentationGenerator({ baseUrl: 'http://localhost:1/v1' });
  return (generator as any).buildPrompt(input);
}

const baseInput: DocumentationInput = {
  nodeType: 'n8n-nodes-pdf.mergePdfs',
  displayName: 'mergePdfs',
  description: 'PDF toolkit',
  readme: '# PDF toolkit',
  npmPackageName: 'n8n-nodes-pdf',
};

describe('DocumentationGenerator - prompt', () => {
  it('should describe the package, not one sibling, when node names are given (#967)', () => {
    const prompt = buildPrompt({
      ...baseInput,
      nodeNames: ['mergePdfs', 'html2Pdf', 'addWatermark'],
    });

    expect(prompt).toContain('n8n-nodes-pdf');
    expect(prompt).toContain('mergePdfs, html2Pdf, addWatermark');
    // The summary is stored on every node of the package, so no single node may
    // be presented as the subject.
    expect(prompt).not.toContain('- Name: mergePdfs');
    expect(prompt).not.toContain('n8n-nodes-pdf.mergePdfs');
  });

  it('should keep the single-node prompt when no node names are given', () => {
    const prompt = buildPrompt(baseInput);

    expect(prompt).toContain('- Name: mergePdfs');
    expect(prompt).toContain('- Type: n8n-nodes-pdf.mergePdfs');
  });

  it('should include the README in both shapes', () => {
    expect(buildPrompt(baseInput)).toContain('# PDF toolkit');
    expect(buildPrompt({ ...baseInput, nodeNames: ['mergePdfs'] })).toContain('# PDF toolkit');
  });
});
