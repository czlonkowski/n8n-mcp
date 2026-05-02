"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequentialMetadataProcessor = void 0;
const logger_1 = require("../utils/logger");
const metadata_generator_1 = require("./metadata-generator");
class SequentialMetadataProcessor {
    constructor(options) {
        this.generator = new metadata_generator_1.MetadataGenerator(options.apiKey, options.model, options.baseURL);
        this.concurrency = options.concurrency ?? 40;
    }
    async processTemplates(templates, progressCallback) {
        const results = new Map();
        const total = templates.length;
        let completed = 0;
        let cursor = 0;
        logger_1.logger.info(`Processing ${total} templates with concurrency ${this.concurrency}`);
        console.log(`\n📤 Direct mode: ${total} templates, concurrency ${this.concurrency}`);
        const worker = async () => {
            while (true) {
                const idx = cursor++;
                if (idx >= total)
                    return;
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
exports.SequentialMetadataProcessor = SequentialMetadataProcessor;
//# sourceMappingURL=sequential-processor.js.map