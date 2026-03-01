import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { logger } from '../utils/logger';
import { MetadataGenerator, MetadataRequest, MetadataResult } from './metadata-generator';

export interface BatchProcessorOptions {
  apiKey: string;
  model?: string;
  batchSize?: number;
  outputDir?: string;
}

export interface BatchJob {
  id: string;
  status: 'validating' | 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'expired' | 'cancelled';
  created_at: number;
  completed_at?: number;
  input_file_id: string;
  output_file_id?: string;
  error?: any;
}

export class BatchProcessor {
  private client: OpenAI;
  private generator: MetadataGenerator;
  private batchSize: number;
  private outputDir: string;
  
  constructor(options: BatchProcessorOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.generator = new MetadataGenerator(options.apiKey, options.model);
    this.batchSize = options.batchSize || 100;
    this.outputDir = options.outputDir || './temp';
    
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }
  
  /**
   * Process templates in batches (parallel submission)
   */
  async processTemplates(
    templates: MetadataRequest[],
    progressCallback?: (message: string, current: number, total: number) => void
  ): Promise<Map<number, MetadataResult>> {
    const results = new Map<number, MetadataResult>();
    const batches = this.createBatches(templates);
    
    logger.info(`Processing ${templates.length} templates in ${batches.length} batches`);
    
    // Submit all batches in parallel
    console.log(`\n📤 Submitting ${batches.length} batch${batches.length > 1 ? 'es' : ''} to OpenAI...`);
    const batchJobs: Array<{ batchNum: number; jobPromise: Promise<any>; templates: MetadataRequest[] }> = [];
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNum = i + 1;
      
      try {
        progressCallback?.(`Submitting batch ${batchNum}/${batches.length}`, i * this.batchSize, templates.length);
        
        // Submit batch (don't wait for completion)
        const jobPromise = this.submitBatch(batch, `batch_${batchNum}`);
        batchJobs.push({ batchNum, jobPromise, templates: batch });
        
        console.log(`   📨 Submitted batch ${batchNum}/${batches.length} (${batch.length} templates)`);
      } catch (error) {
        logger.error(`Error submitting batch ${batchNum}:`, error);
        console.error(`   ❌ Failed to submit batch ${batchNum}`);
      }
    }
    
    console.log(`\n⏳ All batches submitted. Waiting for completion...`);
    console.log(`   (Batches process in parallel - this is much faster than sequential processing)`);
    
    // Process all batches in parallel and collect results as they complete
    const batchPromises = batchJobs.map(async ({ batchNum, jobPromise, templates: batchTemplates }) => {
      try {
        const completedJob = await jobPromise;
        console.log(`\n📦 Retrieving results for batch ${batchNum}/${batches.length}...`);
        
        // Retrieve and parse results
        const batchResults = await this.retrieveResults(completedJob);
        
        logger.info(`Retrieved ${batchResults.length} results from batch ${batchNum}`);
        progressCallback?.(`Retrieved batch ${batchNum}/${batches.length}`, 
          Math.min(batchNum * this.batchSize, templates.length), templates.length);
        
        return { batchNum, results: batchResults };
      } catch (error) {
        logger.error(`Error processing batch ${batchNum}:`, error);
        console.error(`   ❌ Batch ${batchNum} failed:`, error);
        return { batchNum, results: [] };
      }
    });
    
    // Wait for all batches to complete
    const allBatchResults = await Promise.all(batchPromises);
    
    // Merge all results
    for (const { batchNum, results: batchResults } of allBatchResults) {
      for (const result of batchResults) {
        results.set(result.templateId, result);
      }
      if (batchResults.length > 0) {
        console.log(`   ✅ Merged ${batchResults.length} results from batch ${batchNum}`);
      }
    }
    
    logger.info(`Batch processing complete: ${results.size} results`);
    return results;
  }
  
  /**
   * Submit a batch without waiting for completion
   */
  private async submitBatch(templates: MetadataRequest[], batchName: string): Promise<any> {
    // Create JSONL file
    const inputFile = await this.createBatchFile(templates, batchName);
    
    try {
      // Upload file to OpenAI
      const uploadedFile = await this.uploadFile(inputFile);
      
      // Create batch job
      const batchJob = await this.createBatchJob(uploadedFile.id);
      
      // Start monitoring (returns promise that resolves when complete)
      const monitoringPromise = this.monitorBatchJob(batchJob.id);
      
      // Clean up input file immediately
      try {
        fs.unlinkSync(inputFile);
      } catch {}
      
      // Store file IDs for cleanup later
      monitoringPromise.then(async (completedJob) => {
        // Cleanup uploaded files after completion
        try {
          await this.client.files.del(uploadedFile.id);
          if (completedJob.output_file_id) {
            // Note: We'll delete output file after retrieving results
          }
        } catch (error) {
          logger.warn(`Failed to cleanup files for batch ${batchName}`, error);
        }
      });
      
      return monitoringPromise;
    } catch (error) {
      // Cleanup on error
      try {
        fs.unlinkSync(inputFile);
      } catch {}
      throw error;
    }
  }
  
  /**
   * Process a single batch
   */
  private async processBatch(templates: MetadataRequest[], batchName: string): Promise<MetadataResult[]> {
    // Create JSONL file
    const inputFile = await this.createBatchFile(templates, batchName);
    
    try {
      // Upload file to OpenAI
      const uploadedFile = await this.uploadFile(inputFile);
      
      // Create batch job
      const batchJob = await this.createBatchJob(uploadedFile.id);
      
      // Monitor job until completion
      const completedJob = await this.monitorBatchJob(batchJob.id);
      
      // Retrieve and parse results
      const results = await this.retrieveResults(completedJob);
      
      // Cleanup
      await this.cleanup(inputFile, uploadedFile.id, completedJob.output_file_id);
      
      return results;
    } catch (error) {
      // Cleanup on error
      try {
        fs.unlinkSync(inputFile);
      } catch {}
      throw error;
    }
  }
  
  /**
   * Create batches from templates
   */
  private createBatches(templates: MetadataRequest[]): MetadataRequest[][] {
    const batches: MetadataRequest[][] = [];
    
    for (let i = 0; i < templates.length; i += this.batchSize) {
      batches.push(templates.slice(i, i + this.batchSize));
    }
    
    return batches;
  }
  
  /**
   * Create JSONL batch file
   */
  private async createBatchFile(templates: MetadataRequest[], batchName: string): Promise<string> {
    const filename = path.join(this.outputDir, `${batchName}_${Date.now()}.jsonl`);
    const stream = fs.createWriteStream(filename);
    
    for (const template of templates) {
      const request = this.generator.createBatchRequest(template);
      stream.write(JSON.stringify(request) + '\n');
    }
    
    stream.end();
    
    // Wait for stream to finish
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
    
    logger.debug(`Created batch file: ${filename} with ${templates.length} requests`);
    return filename;
  }
  
  /**
   * Upload file to OpenAI
   */
  private async uploadFile(filepath: string): Promise<any> {
    const file = fs.createReadStream(filepath);
    const uploadedFile = await this.client.files.create({
      file,
      purpose: 'batch'
    });
    
    logger.debug(`Uploaded file: ${uploadedFile.id}`);
    return uploadedFile;
  }
  
  /**
   * Create batch job
   */
  private async createBatchJob(fileId: string): Promise<any> {
    const batchJob = await this.client.batches.create({
      input_file_id: fileId,
      endpoint: '/v1/chat/completions',
      completion_window: '24h'
    });
    
    logger.info(`Created batch job: ${batchJob.id}`);
    return batchJob;
  }
  
  /**
   * Monitor batch job with fixed 1-minute polling interval
   */
  private async monitorBatchJob(batchId: string): Promise<any> {
    const pollInterval = 60; // Check every 60 seconds (1 minute)
    let attempts = 0;
    const maxAttempts = 120; // 120 minutes max (2 hours)
    const startTime = Date.now();
    let lastStatus = '';

    while (attempts < maxAttempts) {
      const batchJob = await this.client.batches.retrieve(batchId);
      const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);

      // Log status on every check (not just on change)
      const statusSymbol = batchJob.status === 'in_progress' ? '⚙️' :
                          batchJob.status === 'finalizing' ? '📦' :
                          batchJob.status === 'validating' ? '🔍' :
                          batchJob.status === 'completed' ? '✅' :
                          batchJob.status === 'failed' ? '❌' : '⏳';

      console.log(`   ${statusSymbol} Batch ${batchId.slice(-8)}: ${batchJob.status} (${elapsedMinutes} min, check ${attempts + 1})`);

      if (batchJob.status !== lastStatus) {
        logger.info(`Batch ${batchId} status changed: ${lastStatus} -> ${batchJob.status}`);
        lastStatus = batchJob.status;
      }

      if (batchJob.status === 'completed') {
        console.log(`   ✅ Batch ${batchId.slice(-8)} completed successfully in ${elapsedMinutes} minutes`);
        logger.info(`Batch job ${batchId} completed successfully`);
        return batchJob;
      }

      if (['failed', 'expired', 'cancelled'].includes(batchJob.status)) {
        logger.error(`Batch job ${batchId} failed with status: ${batchJob.status}`);
        throw new Error(`Batch job failed with status: ${batchJob.status}`);
      }

      // Wait before next check (always 1 minute)
      logger.debug(`Waiting ${pollInterval} seconds before next check...`);
      await this.sleep(pollInterval * 1000);

      attempts++;
    }

    throw new Error(`Batch job monitoring timed out after ${maxAttempts} minutes`);
  }
  
  /**
   * Retrieve and parse results
   */
  private async retrieveResults(batchJob: any): Promise<MetadataResult[]> {
    const results: MetadataResult[] = [];

    // Check if we have an output file (successful results)
    if (batchJob.output_file_id) {
      const fileResponse = await this.client.files.content(batchJob.output_file_id);
      const fileContent = await fileResponse.text();

      const lines = fileContent.trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        try {
          const result = JSON.parse(line);
          const parsed = this.generator.parseResult(result);
          results.push(parsed);
        } catch (error) {
          logger.error('Error parsing result line:', error);
        }
      }
      logger.info(`Retrieved ${results.length} successful results from batch job`);
    }

    // Check if we have an error file (failed results)
    if (batchJob.error_file_id) {
      logger.warn(`Batch job has error file: ${batchJob.error_file_id}`);

      try {
        const errorResponse = await this.client.files.content(batchJob.error_file_id);
        const errorContent = await errorResponse.text();

        // Save error file locally for debugging
        const errorFilePath = path.join(this.outputDir, `batch_${batchJob.id}_error.jsonl`);
        fs.writeFileSync(errorFilePath, errorContent);
        logger.warn(`Error file saved to: ${errorFilePath}`);

        // Parse errors and create default metadata for failed templates
        const errorLines = errorContent.trim().split('\n');
        logger.warn(`Found ${errorLines.length} failed requests in error file`);

        for (const line of errorLines) {
          if (!line) continue;
          try {
            const errorResult = JSON.parse(line);
            const templateId = parseInt(errorResult.custom_id?.replace('template-', '') || '0', 10);

            if (templateId > 0) {
              const errorMessage = errorResult.response?.body?.error?.message ||
                                  errorResult.error?.message ||
                                  'Unknown error';

              logger.debug(`Template ${templateId} failed: ${errorMessage}`);

              // Use getDefaultMetadata() from generator (it's private but accessible via bracket notation)
              const defaultMeta = (this.generator as any).getDefaultMetadata();
              results.push({
                templateId,
                metadata: defaultMeta,
                error: errorMessage
              });
            }
          } catch (parseError) {
            logger.error('Error parsing error line:', parseError);
          }
        }
      } catch (error) {
        logger.error('Failed to process error file:', error);
      }
    }

    // If we have no results at all, something is very wrong
    if (results.length === 0 && !batchJob.output_file_id && !batchJob.error_file_id) {
      throw new Error('No output file or error file available for batch job');
    }

    logger.info(`Total results (successful + failed): ${results.length}`);
    return results;
  }
  
  /**
   * Cleanup temporary files
   */
  private async cleanup(localFile: string, inputFileId: string, outputFileId?: string): Promise<void> {
    // Delete local file
    try {
      fs.unlinkSync(localFile);
      logger.debug(`Deleted local file: ${localFile}`);
    } catch (error) {
      logger.warn(`Failed to delete local file: ${localFile}`, error);
    }
    
    // Delete uploaded files from OpenAI
    try {
      await this.client.files.del(inputFileId);
      logger.debug(`Deleted input file from OpenAI: ${inputFileId}`);
    } catch (error) {
      logger.warn(`Failed to delete input file from OpenAI: ${inputFileId}`, error);
    }
    
    if (outputFileId) {
      try {
        await this.client.files.del(outputFileId);
        logger.debug(`Deleted output file from OpenAI: ${outputFileId}`);
      } catch (error) {
        logger.warn(`Failed to delete output file from OpenAI: ${outputFileId}`, error);
      }
    }
  }
  
  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}