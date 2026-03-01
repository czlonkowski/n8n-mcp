import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export class DocsMapper {
  private docsPath = path.join(process.cwd(), 'n8n-docs');
  
  // Known documentation mapping fixes
  private readonly KNOWN_FIXES: Record<string, string> = {
    'httpRequest': 'httprequest',
    'code': 'code',
    'webhook': 'webhook',
    'respondToWebhook': 'respondtowebhook',
    // With package prefix
    'n8n-nodes-base.httpRequest': 'httprequest',
    'n8n-nodes-base.code': 'code',
    'n8n-nodes-base.webhook': 'webhook',
    'n8n-nodes-base.respondToWebhook': 'respondtowebhook'
  };

  async fetchDocumentation(nodeType: string): Promise<string | null> {
    // Apply known fixes first
    const fixedType = this.KNOWN_FIXES[nodeType] || nodeType;
    
    // Extract node name
    const nodeName = fixedType.split('.').pop()?.toLowerCase();
    if (!nodeName) {
      logger.warn(`Could not extract node name from: ${nodeType}`);
      return null;
    }
    
    logger.debug(`Looking for docs for: ${nodeType} -> ${nodeName}`);
    
    // Try different documentation paths - both files and directories
    const possiblePaths = [
      // Direct file paths
      `docs/integrations/builtin/core-nodes/n8n-nodes-base.${nodeName}.md`,
      `docs/integrations/builtin/app-nodes/n8n-nodes-base.${nodeName}.md`,
      `docs/integrations/builtin/trigger-nodes/n8n-nodes-base.${nodeName}.md`,
      `docs/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.${nodeName}.md`,
      `docs/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.${nodeName}.md`,
      // Directory with index.md
      `docs/integrations/builtin/core-nodes/n8n-nodes-base.${nodeName}/index.md`,
      `docs/integrations/builtin/app-nodes/n8n-nodes-base.${nodeName}/index.md`,
      `docs/integrations/builtin/trigger-nodes/n8n-nodes-base.${nodeName}/index.md`,
      `docs/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.${nodeName}/index.md`,
      `docs/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.${nodeName}/index.md`
    ];
    
    // Try each path
    for (const relativePath of possiblePaths) {
      try {
        const fullPath = path.join(this.docsPath, relativePath);
        let content = await fs.readFile(fullPath, 'utf-8');
        logger.debug(`Found docs at: ${relativePath}`);
        
        // Inject special guidance for loop nodes
        content = this.enhanceLoopNodeDocumentation(nodeType, content);
        
        return content;
      } catch (error) {
        // File doesn't exist, try next
        continue;
      }
    }
    
    logger.debug(`No docs found for ${nodeName}`);
    return null;
  }

  private enhanceLoopNodeDocumentation(nodeType: string, content: string): string {
    // Add critical output index information for SplitInBatches
    if (nodeType.includes('splitInBatches')) {
      const outputGuidance = `

## CRITICAL OUTPUT CONNECTION INFORMATION

**⚠️ OUTPUT INDICES ARE COUNTERINTUITIVE ⚠️**

The SplitInBatches node has TWO outputs with specific indices:
- **Output 0 (index 0) = "done"**: Receives final processed data when loop completes
- **Output 1 (index 1) = "loop"**: Receives current batch data during iteration

### Correct Connection Pattern:
1. Connect nodes that PROCESS items inside the loop to **Output 1 ("loop")**
2. Connect nodes that run AFTER the loop completes to **Output 0 ("done")**
3. The last processing node in the loop must connect back to the SplitInBatches node

### Common Mistake:
AI assistants often connect these backwards because the logical flow (loop first, then done) doesn't match the technical indices (done=0, loop=1).

`;
      // Insert after the main description
      const insertPoint = content.indexOf('## When to use');
      if (insertPoint > -1) {
        content = content.slice(0, insertPoint) + outputGuidance + content.slice(insertPoint);
      } else {
        // Append if no good insertion point found
        content = outputGuidance + '\n' + content;
      }
    }

    // Add guidance for IF node
    if (nodeType.includes('.if')) {
      const outputGuidance = `

## Output Connection Information

The IF node has TWO outputs:
- **Output 0 (index 0) = "true"**: Items that match the condition
- **Output 1 (index 1) = "false"**: Items that do not match the condition

`;
      const insertPoint = content.indexOf('## Node parameters');
      if (insertPoint > -1) {
        content = content.slice(0, insertPoint) + outputGuidance + content.slice(insertPoint);
      }
    }

    return content;
  }
}