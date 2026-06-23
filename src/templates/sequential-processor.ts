import { logger } from '../utils/logger';
import { MetadataGenerator, MetadataRequest, MetadataResult } from './metadata-generator';

export interface SequentialProcessorOptions {
  apiKey: string;
  baseURL: string;
  model?: string;
  concurrency?: number;
}

/**
 * Direct (non-batch) metadata processor. Used against OpenAI-compatible servers
 * such as vLLM that do not implement the /v1/batches endpoint. Issues
 * chat.completions.create() calls in parallel up to a concurrency limit.
 */
export class SequentialMetadataProcessor {
  private generator: MetadataGenerator;
  private concurrency: number;

  constructor(options: SequentialProcessorOptions) {
    this.generator = new MetadataGenerator(options.apiKey, options.model, options.baseURL);
    this.concurrency = options.concurrency ?? 40;
  }

  async processTemplates(
    templates: MetadataRequest[],
    progressCallback?: (message: string, current: number, total: number) => void
  ): Promise<Map<number, MetadataResult>> {
    const results = new Map<number, MetadataResult>();
    const total = templates.length;
    let completed = 0;
    let cursor = 0;

    logger.info(`Processing ${total} templates with concurrency ${this.concurrency}`);
    console.log(`\n📤 Direct mode: ${total} templates, concurrency ${this.concurrency}`);

    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= total) return;
        const template = templates[idx];
        const result = await this.generator.generateDirect(template);
        results.set(template.templateId, result);
        completed++;
        progressCallback?.(`Generating metadata`, completed, total);
      }
    };

    const workers = Array.from({ length: Math.min(this.concurrency, total) }, () => worker());
    await Promise.all(workers);

    const failed = Array.from(results.values()).filter(r => r.error).length;
    console.log(`\n✅ Completed ${completed - failed}/${total} (${failed} failed)`);

    return results;
  }
}
