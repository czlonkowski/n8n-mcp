import { logger } from './logger';

/**
 * Resolves various node type input formats to all possible template node type formats.
 * Templates store node types in full n8n format (e.g., "n8n-nodes-base.slack").
 * This function handles various input formats and expands them to all possible matches.
 * 
 * @param nodeTypes Array of node types in various formats
 * @returns Array of all possible template node type formats
 * 
 * @example
 * resolveTemplateNodeTypes(['slack']) 
 * // Returns: ['n8n-nodes-base.slack', 'n8n-nodes-base.slackTrigger']
 * 
 * resolveTemplateNodeTypes(['nodes-base.webhook'])
 * // Returns: ['n8n-nodes-base.webhook']
 * 
 * resolveTemplateNodeTypes(['httpRequest'])
 * // Returns: ['n8n-nodes-base.httpRequest']
 */
export function resolveTemplateNodeTypes(nodeTypes: string[]): string[] {
  const resolvedTypes = new Set<string>();
  
  for (const nodeType of nodeTypes) {
    // Add all variations for this node type
    const variations = generateTemplateNodeVariations(nodeType);
    variations.forEach(v => resolvedTypes.add(v));
  }
  
  const result = Array.from(resolvedTypes);
  logger.debug(`Resolved ${nodeTypes.length} input types to ${result.length} template variations`, {
    input: nodeTypes,
    output: result
  });
  
  return result;
}

/**
 * Generates all possible template node type variations for a single input.
 * 
 * @param nodeType Single node type in any format
 * @returns Array of possible template formats
 */
function generateTemplateNodeVariations(nodeType: string): string[] {
  const variations = new Set<string>();
  
  // If it's already in full n8n format, just return it
  if (nodeType.startsWith('n8n-nodes-base.') || nodeType.startsWith('@n8n/n8n-nodes-langchain.')) {
    variations.add(nodeType);
    return Array.from(variations);
  }
  
  // Handle partial prefix formats (e.g., "nodes-base.slack" -> "n8n-nodes-base.slack")
  if (nodeType.startsWith('nodes-base.')) {
    const nodeName = nodeType.replace('nodes-base.', '');
    variations.add(`n8n-nodes-base.${nodeName}`);
    // Also try camelCase variations
    addCamelCaseVariations(variations, nodeName, 'n8n-nodes-base');
  } else if (nodeType.startsWith('nodes-langchain.')) {
    const nodeName = nodeType.replace('nodes-langchain.', '');
    variations.add(`@n8n/n8n-nodes-langchain.${nodeName}`);
    // Also try camelCase variations
    addCamelCaseVariations(variations, nodeName, '@n8n/n8n-nodes-langchain');
  } else if (!nodeType.includes('.')) {
    // Bare node name (e.g., "slack", "webhook", "httpRequest")
    // Try both packages with various case combinations
    
    // For n8n-nodes-base
    variations.add(`n8n-nodes-base.${nodeType}`);
    addCamelCaseVariations(variations, nodeType, 'n8n-nodes-base');
    
    // For langchain (less common for bare names, but include for completeness)
    variations.add(`@n8n/n8n-nodes-langchain.${nodeType}`);
    addCamelCaseVariations(variations, nodeType, '@n8n/n8n-nodes-langchain');
    
    // Add common related node types (e.g., "slack" -> also include "slackTrigger")
    addRelatedNodeTypes(variations, nodeType);
  }
  
  return Array.from(variations);
}

/**
 * Adds camelCase variations for a node name.
 * 
 * @param variations Set to add variations to
 * @param nodeName The node name to create variations for
 * @param packagePrefix The package prefix to use
 */
function addCamelCaseVariations(variations: Set<string>, nodeName: string, packagePrefix: string): void {
  const lowerName = nodeName.toLowerCase();
  
  // Common patterns in n8n node names
  const patterns = [
    // Pattern: somethingTrigger (e.g., slackTrigger, webhookTrigger)
    { suffix: 'trigger', capitalize: true },
    { suffix: 'Trigger', capitalize: false },
    // Pattern: somethingRequest (e.g., httpRequest)
    { suffix: 'request', capitalize: true },
    { suffix: 'Request', capitalize: false },
    // Pattern: somethingDatabase (e.g., mysqlDatabase, postgresDatabase)
    { suffix: 'database', capitalize: true },
    { suffix: 'Database', capitalize: false },
    // Pattern: somethingSheet/Sheets (e.g., googleSheets)
    { suffix: 'sheet', capitalize: true },
    { suffix: 'Sheet', capitalize: false },
    { suffix: 'sheets', capitalize: true },
    { suffix: 'Sheets', capitalize: false },
  ];
  
  // Check if the lowercase name matches any pattern
  for (const pattern of patterns) {
    const lowerSuffix = pattern.suffix.toLowerCase();
    
    if (lowerName.endsWith(lowerSuffix)) {
      // Name already has the suffix, try different capitalizations
      const baseName = lowerName.slice(0, -lowerSuffix.length);
      if (baseName) {
        if (pattern.capitalize) {
          // Capitalize the suffix
          const capitalizedSuffix = pattern.suffix.charAt(0).toUpperCase() + pattern.suffix.slice(1).toLowerCase();
          variations.add(`${packagePrefix}.${baseName}${capitalizedSuffix}`);
        } else {
          // Use the suffix as-is
          variations.add(`${packagePrefix}.${baseName}${pattern.suffix}`);
        }
      }
    } else if (!lowerName.includes(lowerSuffix)) {
      // Name doesn't have the suffix, try adding it
      if (pattern.capitalize) {
        const capitalizedSuffix = pattern.suffix.charAt(0).toUpperCase() + pattern.suffix.slice(1).toLowerCase();
        variations.add(`${packagePrefix}.${lowerName}${capitalizedSuffix}`);
      }
    }
  }
  
  // Handle specific known cases
  const specificCases: Record<string, string[]> = {
    'http': ['httpRequest'],
    'httprequest': ['httpRequest'],
    'mysql': ['mysql', 'mysqlDatabase'],
    'postgres': ['postgres', 'postgresDatabase'],
    'postgresql': ['postgres', 'postgresDatabase'],
    'mongo': ['mongoDb', 'mongodb'],
    'mongodb': ['mongoDb', 'mongodb'],
    'google': ['googleSheets', 'googleDrive', 'googleCalendar'],
    'googlesheet': ['googleSheets'],
    'googlesheets': ['googleSheets'],
    'microsoft': ['microsoftTeams', 'microsoftExcel', 'microsoftOutlook'],
    'slack': ['slack'],
    'discord': ['discord'],
    'telegram': ['telegram'],
    'webhook': ['webhook'],
    'schedule': ['scheduleTrigger'],
    'cron': ['cron', 'scheduleTrigger'],
    'email': ['emailSend', 'emailReadImap', 'gmail'],
    'gmail': ['gmail', 'gmailTrigger'],
    'code': ['code'],
    'javascript': ['code'],
    'python': ['code'],
    'js': ['code'],
    'set': ['set'],
    'if': ['if'],
    'switch': ['switch'],
    'merge': ['merge'],
    'loop': ['splitInBatches'],
    'split': ['splitInBatches', 'splitOut'],
    'ai': ['openAi'],
    'openai': ['openAi'],
    'chatgpt': ['openAi'],
    'gpt': ['openAi'],
    'api': ['httpRequest', 'graphql', 'webhook'],
    'csv': ['spreadsheetFile', 'readBinaryFile'],
    'excel': ['microsoftExcel', 'spreadsheetFile'],
    'spreadsheet': ['spreadsheetFile', 'googleSheets', 'microsoftExcel'],
  };
  
  const cases = specificCases[lowerName];
  if (cases) {
    cases.forEach(c => variations.add(`${packagePrefix}.${c}`));
  }
}

/**
 * Adds related node types for common patterns.
 * For example, "slack" should also include "slackTrigger".
 * 
 * @param variations Set to add variations to
 * @param nodeName The base node name
 */
function addRelatedNodeTypes(variations: Set<string>, nodeName: string): void {
  const lowerName = nodeName.toLowerCase();
  
  // Map of base names to their related node types
  const relatedTypes: Record<string, string[]> = {
    'slack': ['slack', 'slackTrigger'],
    'gmail': ['gmail', 'gmailTrigger'],
    'telegram': ['telegram', 'telegramTrigger'],
    'discord': ['discord', 'discordTrigger'],
    'webhook': ['webhook', 'webhookTrigger'],
    'http': ['httpRequest', 'webhook'],
    'email': ['emailSend', 'emailReadImap', 'gmail', 'gmailTrigger'],
    'google': ['googleSheets', 'googleDrive', 'googleCalendar', 'googleDocs'],
    'microsoft': ['microsoftTeams', 'microsoftExcel', 'microsoftOutlook', 'microsoftOneDrive'],
    'database': ['postgres', 'mysql', 'mongoDb', 'redis', 'postgresDatabase', 'mysqlDatabase'],
    'db': ['postgres', 'mysql', 'mongoDb', 'redis'],
    'sql': ['postgres', 'mysql', 'mssql'],
    'nosql': ['mongoDb', 'redis', 'couchDb'],
    'schedule': ['scheduleTrigger', 'cron'],
    'time': ['scheduleTrigger', 'cron', 'wait'],
    'file': ['readBinaryFile', 'writeBinaryFile', 'moveBinaryFile'],
    'binary': ['readBinaryFile', 'writeBinaryFile', 'moveBinaryFile'],
    'csv': ['spreadsheetFile', 'readBinaryFile'],
    'excel': ['microsoftExcel', 'spreadsheetFile'],
    // Native data-shaping nodes first, Code last. Matching is a plain OR over
    // nodes_used, so the order only documents the preferred node.
    // splitInBatches is a loop node, not a transform, so it is not listed.
    'json': ['set', 'code'],
    'transform': ['set', 'aggregate', 'summarize', 'splitOut', 'merge', 'code'],
    'ai': ['openAi', 'agent', 'lmChatOpenAi', 'lmChatAnthropic'],
    'llm': ['openAi', 'agent', 'lmChatOpenAi', 'lmChatAnthropic', 'lmChatGoogleGemini'],
    'agent': ['agent', 'toolAgent'],
    'chat': ['chatTrigger', 'agent'],
  };
  
  const related = relatedTypes[lowerName];
  if (related) {
    related.forEach(r => {
      variations.add(`n8n-nodes-base.${r}`);
      // Also check if it might be a langchain node
      if (['agent', 'toolAgent', 'chatTrigger', 'lmChatOpenAi', 'lmChatAnthropic', 'lmChatGoogleGemini'].includes(r)) {
        variations.add(`@n8n/n8n-nodes-langchain.${r}`);
      }
    });
  }
}