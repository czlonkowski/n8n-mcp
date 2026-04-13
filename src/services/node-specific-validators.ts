/**
 * Node-Specific Validators
 *
 * Provides detailed validation logic for commonly used n8n nodes.
 * Each validator understands the specific requirements and patterns of its node.
 */

import { ValidationError, ValidationWarning } from './config-validator';

/**
 * Upper bound on how much JS code we are willing to pattern-match against
 * in a single validation pass. Several regexes below (detected by CodeQL
 * `js/polynomial-redos`) are polynomial on crafted inputs with many
 * unbalanced braces/parentheses. A hard length cap bounds the worst-case
 * work to `O(MAX_CODE_LENGTH ^ k)`, which is a constant, and keeps
 * validation predictable for genuinely large (but legitimate) Code nodes.
 *
 * n8n Code nodes in practice stay well under 100 KB; 200 KB gives
 * substantial headroom without materially changing what gets validated.
 */
const MAX_CODE_LENGTH = 200_000;

/**
 * Upper bound for short user-supplied strings we pattern-match against
 * (spreadsheet ranges, cell references, expressions). These are always
 * tiny in practice — a few hundred chars at most — so 2 KB is generous.
 */
const MAX_SHORT_INPUT_LENGTH = 2_000;

export interface NodeValidationContext {
  config: Record<string, any>;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  suggestions: string[];
  autofix: Record<string, any>;
}

export class NodeSpecificValidators {
  /**
   * Validate Slack node configuration with operation awareness
   */
  static validateSlack(context: NodeValidationContext): void {
    const { config, errors, warnings, suggestions, autofix } = context;
    const { resource, operation } = config;
    
    // Message operations
    if (resource === 'message') {
      switch (operation) {
        case 'send':
          this.validateSlackSendMessage(context);
          break;
        case 'update':
          this.validateSlackUpdateMessage(context);
          break;
        case 'delete':
          this.validateSlackDeleteMessage(context);
          break;
      }
    }
    
    // Channel operations
    else if (resource === 'channel') {
      switch (operation) {
        case 'create':
          this.validateSlackCreateChannel(context);
          break;
        case 'get':
        case 'getAll':
          // These operations have minimal requirements
          break;
      }
    }
    
    // User operations
    else if (resource === 'user') {
      if (operation === 'get' && !config.user) {
        errors.push({
          type: 'missing_required',
          property: 'user',
          message: 'User identifier required - use email, user ID, or username',
          fix: 'Set user to an email like "john@example.com" or user ID like "U1234567890"'
        });
      }
    }
    
    // Error handling for Slack operations
    if (!config.onError && !config.retryOnFail && !config.continueOnFail) {
      warnings.push({
        type: 'best_practice',
        property: 'errorHandling',
        message: 'Slack API can have rate limits and transient failures',
        suggestion: 'Add onError: "continueRegularOutput" with retryOnFail for resilience'
      });
      autofix.onError = 'continueRegularOutput';
      autofix.retryOnFail = true;
      autofix.maxTries = 2;
      autofix.waitBetweenTries = 3000; // Slack rate limits
    }
    
    // Check for deprecated continueOnFail
    if (config.continueOnFail !== undefined) {
      warnings.push({
        type: 'deprecated',
        property: 'continueOnFail',
        message: 'continueOnFail is deprecated. Use onError instead',
        suggestion: 'Replace with onError: "continueRegularOutput"'
      });
    }
  }
  
  private static validateSlackSendMessage(context: NodeValidationContext): void {
    const { config, errors, warnings, suggestions, autofix } = context;
    
    // Channel is required for sending messages
    if (!config.channel && !config.channelId) {
      errors.push({
        type: 'missing_required',
        property: 'channel',
        message: 'Channel is required to send a message',
        fix: 'Set channel to a channel name (e.g., "#general") or ID (e.g., "C1234567890")'
      });
    }
    
    // Message content validation
    if (!config.text && !config.blocks && !config.attachments) {
      errors.push({
        type: 'missing_required',
        property: 'text',
        message: 'Message content is required - provide text, blocks, or attachments',
        fix: 'Add text field with your message content'
      });
    }
    
    // Common patterns and suggestions
    if (config.text && config.text.length > 40000) {
      warnings.push({
        type: 'inefficient',
        property: 'text',
        message: 'Message text exceeds Slack\'s 40,000 character limit',
        suggestion: 'Split into multiple messages or use a file upload'
      });
    }
    
    // Thread reply validation
    if (config.replyToThread && !config.threadTs) {
      warnings.push({
        type: 'missing_common',
        property: 'threadTs',
        message: 'Thread timestamp required when replying to thread',
        suggestion: 'Set threadTs to the timestamp of the thread parent message'
      });
    }
    
    // Mention handling
    if (config.text?.includes('@') && !config.linkNames) {
      suggestions.push('Set linkNames=true to convert @mentions to user links');
      autofix.linkNames = true;
    }
  }
  
  private static validateSlackUpdateMessage(context: NodeValidationContext): void {
    const { config, errors } = context;
    
    if (!config.ts) {
      errors.push({
        type: 'missing_required',
        property: 'ts',
        message: 'Message timestamp (ts) is required to update a message',
        fix: 'Provide the timestamp of the message to update'
      });
    }
    
    if (!config.channel && !config.channelId) {
      errors.push({
        type: 'missing_required',
        property: 'channel',
        message: 'Channel is required to update a message',
        fix: 'Provide the channel where the message exists'
      });
    }
  }
  
  private static validateSlackDeleteMessage(context: NodeValidationContext): void {
    const { config, errors, warnings } = context;
    
    if (!config.ts) {
      errors.push({
        type: 'missing_required',
        property: 'ts',
        message: 'Message timestamp (ts) is required to delete a message',
        fix: 'Provide the timestamp of the message to delete'
      });
    }
    
    if (!config.channel && !config.channelId) {
      errors.push({
        type: 'missing_required',
        property: 'channel',
        message: 'Channel is required to delete a message',
        fix: 'Provide the channel where the message exists'
      });
    }
    
    warnings.push({
      type: 'security',
      message: 'Message deletion is permanent and cannot be undone',
      suggestion: 'Consider archiving or updating the message instead if you need to preserve history'
    });
  }
  
  private static validateSlackCreateChannel(context: NodeValidationContext): void {
    const { config, errors, warnings } = context;
    
    if (!config.name) {
      errors.push({
        type: 'missing_required',
        property: 'name',
        message: 'Channel name is required',
        fix: 'Provide a channel name (lowercase, no spaces, 1-80 characters)'
      });
    } else {
      // Validate channel name format
      const name = config.name;
      if (name.includes(' ')) {
        errors.push({
          type: 'invalid_value',
          property: 'name',
          message: 'Channel names cannot contain spaces',
          fix: 'Use hyphens or underscores instead of spaces'
        });
      }
      if (name !== name.toLowerCase()) {
        errors.push({
          type: 'invalid_value',
          property: 'name',
          message: 'Channel names must be lowercase',
          fix: 'Convert the channel name to lowercase'
        });
      }
      if (name.length > 80) {
        errors.push({
          type: 'invalid_value',
          property: 'name',
          message: 'Channel name exceeds 80 character limit',
          fix: 'Shorten the channel name'
        });
      }
    }
  }
  
  /**
   * Validate Google Sheets node configuration
   */
  static validateGoogleSheets(context: NodeValidationContext): void {
    const { config, errors, warnings, suggestions } = context;
    const { operation } = config;

    // NOTE: Skip sheetId validation - it comes from credentials, not configuration
    // In real workflows, sheetId is provided by Google Sheets credentials
    // See Phase 3 validation results: 113/124 failures were false positives for this

    // Operation-specific validations
    switch (operation) {
      case 'append':
        this.validateGoogleSheetsAppend(context);
        break;
      case 'read':
        this.validateGoogleSheetsRead(context);
        break;
      case 'update':
        this.validateGoogleSheetsUpdate(context);
        break;
      case 'delete':
        this.validateGoogleSheetsDelete(context);
        break;
    }

    // Range format validation
    if (config.range) {
      this.validateGoogleSheetsRange(config.range, errors, warnings);
    }

    // FINAL STEP: Filter out sheetId errors (credential-provided field)
    // Remove any sheetId validation errors that might have been added by nested validators
    const filteredErrors: ValidationError[] = [];
    for (const error of errors) {
      // Skip sheetId errors - this field is provided by credentials
      if (error.property === 'sheetId' && error.type === 'missing_required') {
        continue;
      }
      // Skip errors about sheetId in nested paths (e.g., from resourceMapper validation)
      if (error.property && error.property.includes('sheetId') && error.type === 'missing_required') {
        continue;
      }
      filteredErrors.push(error);
    }

    // Replace errors array with filtered version
    errors.length = 0;
    errors.push(...filteredErrors);
  }
  
  private static validateGoogleSheetsAppend(context: NodeValidationContext): void {
    const { config, errors, warnings, autofix } = context;

    // In Google Sheets v4+, range is only required if NOT using the columns resourceMapper
    // The columns parameter is a resourceMapper introduced in v4 that handles range automatically
    if (!config.range && !config.columns) {
      errors.push({
        type: 'missing_required',
        property: 'range',
        message: 'Range or columns mapping is required for append operation',
        fix: 'Specify range like "Sheet1!A:B" OR use columns with mappingMode'
      });
    }
    
    // Check for common append settings
    if (!config.options?.valueInputMode) {
      warnings.push({
        type: 'missing_common',
        property: 'options.valueInputMode',
        message: 'Consider setting valueInputMode for proper data formatting',
        suggestion: 'Use "USER_ENTERED" to parse formulas and dates, or "RAW" for literal values'
      });
      autofix.options = { ...config.options, valueInputMode: 'USER_ENTERED' };
    }
  }
  
  private static validateGoogleSheetsRead(context: NodeValidationContext): void {
    const { config, errors, suggestions } = context;
    
    if (!config.range) {
      errors.push({
        type: 'missing_required',
        property: 'range',
        message: 'Range is required for read operation',
        fix: 'Specify range like "Sheet1!A:B" or "Sheet1!A1:B10"'
      });
    }
    
    // Suggest data structure options
    if (!config.options?.dataStructure) {
      suggestions.push('Consider setting options.dataStructure to "object" for easier data manipulation');
    }
  }
  
  private static validateGoogleSheetsUpdate(context: NodeValidationContext): void {
    const { config, errors } = context;
    
    if (!config.range) {
      errors.push({
        type: 'missing_required',
        property: 'range',
        message: 'Range is required for update operation',
        fix: 'Specify the exact range to update like "Sheet1!A1:B10"'
      });
    }
    
    if (!config.values && !config.rawData) {
      errors.push({
        type: 'missing_required',
        property: 'values',
        message: 'Values are required for update operation',
        fix: 'Provide the data to write to the spreadsheet'
      });
    }
  }
  
  private static validateGoogleSheetsDelete(context: NodeValidationContext): void {
    const { config, errors, warnings } = context;
    
    if (!config.toDelete) {
      errors.push({
        type: 'missing_required',
        property: 'toDelete',
        message: 'Specify what to delete (rows or columns)',
        fix: 'Set toDelete to "rows" or "columns"'
      });
    }
    
    if (config.toDelete === 'rows' && !config.startIndex && config.startIndex !== 0) {
      errors.push({
        type: 'missing_required',
        property: 'startIndex',
        message: 'Start index is required when deleting rows',
        fix: 'Specify the starting row index (0-based)'
      });
    }
    
    warnings.push({
      type: 'security',
      message: 'Deletion is permanent. Consider backing up data first',
      suggestion: 'Read the data before deletion to create a backup'
    });
  }
  
  private static validateGoogleSheetsRange(
    range: string, 
    errors: ValidationError[], 
    warnings: ValidationWarning[]
  ): void {
    // Check basic format
    if (!range.includes('!')) {
      warnings.push({
        type: 'inefficient',
        property: 'range',
        message: 'Range should include sheet name for clarity',
        suggestion: 'Format: "SheetName!A1:B10" or "SheetName!A:B"'
      });
    }
    
    // Check for common mistakes
    if (range.includes(' ') && !range.match(/^'[^']+'/)) {
      errors.push({
        type: 'invalid_value',
        property: 'range',
        message: 'Sheet names with spaces must be quoted',
        fix: 'Use single quotes around sheet name: \'Sheet Name\'!A1:B10'
      });
    }
    
    // Validate A1 notation. Length guard caps CodeQL polynomial-ReDoS
    // exposure: real spreadsheet ranges are tiny (< 100 chars); anything
    // longer is almost certainly malformed and not worth regex-matching.
    const a1Pattern = /^('[^']+'|[^!]+)!([A-Z]+\d*:?[A-Z]*\d*|[A-Z]+:[A-Z]+|\d+:\d+)$/i;
    if (range.length <= MAX_SHORT_INPUT_LENGTH && !a1Pattern.test(range)) {
      warnings.push({
        type: 'inefficient',
        property: 'range',
        message: 'Range may not be in valid A1 notation',
        suggestion: 'Examples: "Sheet1!A1:B10", "Sheet1!A:B", "Sheet1!1:10"'
      });
    }
  }
  
  /**
   * Validate OpenAI node configuration
   */
  static validateOpenAI(context: NodeValidationContext): void {
    const { config, errors, warnings, suggestions, autofix } = context;
    const { resource, operation } = config;
    
    if (resource === 'chat' && operation === 'create') {
      // Model validation
      if (!config.model) {
        errors.push({
          type: 'missing_required',
          property: 'model',
          message: 'Model selection is required',
          fix: 'Choose a model like "gpt-4", "gpt-3.5-turbo", etc.'
        });
      } else {
        // Check for deprecated models
        const deprecatedModels = ['text-davinci-003', 'text-davinci-002'];
        if (deprecatedModels.includes(config.model)) {
          warnings.push({
            type: 'deprecated',
            property: 'model',
            message: `Model ${config.model} is deprecated`,
            suggestion: 'Use "gpt-3.5-turbo" or "gpt-4" instead'
          });
        }
      }
      
      // Message validation
      if (!config.messages && !config.prompt) {
        errors.push({
          type: 'missing_required',
          property: 'messages',
          message: 'Messages or prompt required for chat completion',
          fix: 'Add messages array or use the prompt field'
        });
      }
      
      // Token limit warnings
      if (config.maxTokens && config.maxTokens > 4000) {
        warnings.push({
          type: 'inefficient',
          property: 'maxTokens',
          message: 'High token limit may increase costs significantly',
          suggestion: 'Consider if you really need more than 4000 tokens'
        });
      }
      
      // Temperature validation
      if (config.temperature !== undefined) {
        if (config.temperature < 0 || config.temperature > 2) {
          errors.push({
            type: 'invalid_value',
            property: 'temperature',
            message: 'Temperature must be between 0 and 2',
            fix: 'Set temperature between 0 (deterministic) and 2 (creative)'
          });
        }
      }
    }
    
    // Error handling for AI API calls
    if (!config.onError && !config.retryOnFail && !config.continueOnFail) {
      warnings.push({
        type: 'best_practice',
        property: 'errorHandling',
        message: 'AI APIs have rate limits and can return errors',
        suggestion: 'Add onError: "continueRegularOutput" with retryOnFail and longer wait times'
      });
      autofix.onError = 'continueRegularOutput';
      autofix.retryOnFail = true;
      autofix.maxTries = 3;
      autofix.waitBetweenTries = 5000; // Longer wait for rate limits
      autofix.alwaysOutputData = true;
    }
    
    // Check for deprecated continueOnFail
    if (config.continueOnFail !== undefined) {
      warnings.push({
        type: 'deprecated',
        property: 'continueOnFail',
        message: 'continueOnFail is deprecated. Use onError instead',
        suggestion: 'Replace with onError: "continueRegularOutput"'
      });
    }
  }
  
  /**
   * Validate MongoDB node configuration
   */
  static validateMongoDB(context: NodeValidationContext): void {
    const { config, errors, warnings, autofix } = context;
    const { operation } = config;
    
    // Collection is always required
    if (!config.collection) {
      errors.push({
        type: 'missing_required',
        property: 'collection',
        message: 'Collection name is required',
        fix: 'Specify the MongoDB collection to work with'
      });
    }
    
    switch (operation) {
      case 'find':
        // Query validation
        if (config.query) {
          try {
            JSON.parse(config.query);
          } catch (e) {
            errors.push({
              type: 'invalid_value',
              property: 'query',
              message: 'Query must be valid JSON',
              fix: 'Ensure query is valid JSON like: {"name": "John"}'
            });
          }
        }
        break;
        
      case 'insert':
        if (!config.fields && !config.documents) {
          errors.push({
            type: 'missing_required',
            property: 'fields',
            message: 'Document data is required for insert',
            fix: 'Provide the data to insert'
          });
        }
        break;
        
      case 'update':
        if (!config.query) {
          warnings.push({
            type: 'security',
            message: 'Update without query will affect all documents',
            suggestion: 'Add a query to target specific documents'
          });
        }
        break;
        
      case 'delete':
        if (!config.query || config.query === '{}') {
          errors.push({
            type: 'invalid_value',
            property: 'query',
            message: 'Delete without query would remove all documents - this is a critical security issue',
            fix: 'Add a query to specify which documents to delete'
          });
        }
        break;
    }
    
    // Error handling for MongoDB operations
    if (!config.onError && !config.retryOnFail && !config.continueOnFail) {
      if (operation === 'find') {
        warnings.push({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'MongoDB queries can fail due to connection issues',
          suggestion: 'Add onError: "continueRegularOutput" with retryOnFail'
        });
        autofix.onError = 'continueRegularOutput';
        autofix.retryOnFail = true;
        autofix.maxTries = 3;
      } else if (['insert', 'update', 'delete'].includes(operation)) {
        warnings.push({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'MongoDB write operations should handle errors carefully',
          suggestion: 'Add onError: "continueErrorOutput" to handle write failures separately'
        });
        autofix.onError = 'continueErrorOutput';
        autofix.retryOnFail = true;
        autofix.maxTries = 2;
        autofix.waitBetweenTries = 1000;
      }
    }
    
    // Check for deprecated continueOnFail
    if (config.continueOnFail !== undefined) {
      warnings.push({
        type: 'deprecated',
        property: 'continueOnFail',
        message: 'continueOnFail is deprecated. Use onError instead',
        suggestion: 'Replace with onError: "continueRegularOutput" or "continueErrorOutput"'
      });
    }
  }
  
  
  /**
   * Validate Postgres node configuration
   */
  static validatePostgres(context: NodeValidationContext): void {
    const { config, errors, warnings, suggestions, autofix } = context;
    const { operation } = config;
    
    // Common query validation
    if (['execute', 'select', 'insert', 'update', 'delete'].includes(operation)) {
      this.validateSQLQuery(context, 'postgres');
    }
    
    // Operation-specific validation
    switch (operation) {
      case 'insert':
        if (!config.table) {
          errors.push({
            type: 'missing_required',
            property: 'table',
            message: 'Table name is required for insert operation',
            fix: 'Specify the table to insert data into'
          });
        }
        
        if (!config.columns && !config.dataMode) {
          warnings.push({
            type: 'missing_common',
            property: 'columns',
            message: 'No columns specified for insert',
            suggestion: 'Define which columns to insert data into'
          });
        }
        break;
        
      case 'update':
        if (!config.table) {
          errors.push({
            type: 'missing_required',
            property: 'table',
            message: 'Table name is required for update operation',
            fix: 'Specify the table to update'
          });
        }
        
        if (!config.updateKey) {
          warnings.push({
            type: 'missing_common',
            property: 'updateKey',
            message: 'No update key specified',
            suggestion: 'Set updateKey to identify which rows to update (e.g., "id")'
          });
        }
        break;
        
      case 'delete':
        if (!config.table) {
          errors.push({
            type: 'missing_required',
            property: 'table',
            message: 'Table name is required for delete operation',
            fix: 'Specify the table to delete from'
          });
        }
        
        if (!config.deleteKey) {
          errors.push({
            type: 'missing_required',
            property: 'deleteKey',
            message: 'Delete key is required to identify rows',
            fix: 'Set deleteKey (e.g., "id") to specify which rows to delete'
          });
        }
        break;
        
      case 'execute':
        if (!config.query) {
          errors.push({
            type: 'missing_required',
            property: 'query',
            message: 'SQL query is required',
            fix: 'Provide the SQL query to execute'
          });
        }
        break;
    }
    
    // Connection pool suggestions
    if (config.connectionTimeout === undefined) {
      suggestions.push('Consider setting connectionTimeout to handle slow connections');
    }
    
    // Error handling for database operations
    if (!config.onError && !config.retryOnFail && !config.continueOnFail) {
      if (operation === 'execute' && config.query?.toLowerCase().includes('select')) {
        warnings.push({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'Database reads can fail due to connection issues',
          suggestion: 'Add onError: "continueRegularOutput" and retryOnFail: true'
        });
        autofix.onError = 'continueRegularOutput';
        autofix.retryOnFail = true;
        autofix.maxTries = 3;
      } else if (['insert', 'update', 'delete'].includes(operation)) {
        warnings.push({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'Database writes should handle errors carefully',
          suggestion: 'Add onError: "stopWorkflow" with retryOnFail for transient failures'
        });
        autofix.onError = 'stopWorkflow';
        autofix.retryOnFail = true;
        autofix.maxTries = 2;
        autofix.waitBetweenTries = 2000;
      }
    }
    
    // Check for deprecated continueOnFail
    if (config.continueOnFail !== undefined) {
      warnings.push({
        type: 'deprecated',
        property: 'continueOnFail',
        message: 'continueOnFail is deprecated. Use onError instead',
        suggestion: 'Replace with onError: "continueRegularOutput" or "stopWorkflow"'
      });
    }
  }

  /**
   * Validate AI Agent node configuration
   * Note: This provides basic model connection validation at the node level.
   * Full AI workflow validation (tools, memory, etc.) is handled by workflow-validator.
   */
  static validateAIAgent(context: NodeValidationContext): void {
    const { config, errors, warnings, suggestions, autofix } = context;

    // Check for language model configuration
    // AI Agent nodes receive model connections via ai_languageModel connection type
    // We validate this during workflow validation, but provide hints here for common issues

    // Check prompt type configuration
    if (config.promptType === 'define') {
      if (!config.text || (typeof config.text === 'string' && config.text.trim() === '')) {
        errors.push({
          type: 'missing_required',
          property: 'text',
          message: 'Custom prompt text is required when promptType is "define"',
          fix: 'Provide a custom prompt in the text field, or change promptType to "auto"'
        });
      }
    }

    // Check system message (RECOMMENDED)
    if (!config.systemMessage || (typeof config.systemMessage === 'string' && config.systemMessage.trim() === '')) {
      suggestions.push('AI Agent works best with a system message that defines the agent\'s role, capabilities, and constraints. Set systemMessage to provide context.');
    } else if (typeof config.systemMessage === 'string' && config.systemMessage.trim().length < 20) {
      warnings.push({
        type: 'inefficient',
        property: 'systemMessage',
        message: 'System message is very short (< 20 characters)',
        suggestion: 'Consider a more detailed system message to guide the agent\'s behavior'
      });
    }

    // Check output parser configuration
    if (config.hasOutputParser === true) {
      warnings.push({
        type: 'best_practice',
        property: 'hasOutputParser',
        message: 'Output parser is enabled. Ensure an ai_outputParser connection is configured in the workflow.',
        suggestion: 'Connect an output parser node (e.g., Structured Output Parser) via ai_outputParser connection type'
      });
    }

    // Check fallback model configuration
    if (config.needsFallback === true) {
      warnings.push({
        type: 'best_practice',
        property: 'needsFallback',
        message: 'Fallback model is enabled. Ensure 2 language models are connected via ai_languageModel connections.',
        suggestion: 'Connect a primary model and a fallback model to handle failures gracefully'
      });
    }

    // Check maxIterations
    if (config.maxIterations !== undefined) {
      const maxIter = Number(config.maxIterations);
      if (isNaN(maxIter) || maxIter < 1) {
        errors.push({
          type: 'invalid_value',
          property: 'maxIterations',
          message: 'maxIterations must be a positive number',
          fix: 'Set maxIterations to a value >= 1 (e.g., 10)'
        });
      } else if (maxIter > 50) {
        warnings.push({
          type: 'inefficient',
          property: 'maxIterations',
          message: `maxIterations is set to ${maxIter}. High values can lead to long execution times and high costs.`,
          suggestion: 'Consider reducing maxIterations to 10-20 for most use cases'
        });
      }
    }

    // Error handling for AI operations
    if (!config.onError && !config.retryOnFail && !config.continueOnFail) {
      warnings.push({
        type: 'best_practice',
        property: 'errorHandling',
        message: 'AI models can fail due to API limits, rate limits, or invalid responses',
        suggestion: 'Add onError: "continueRegularOutput" with retryOnFail for resilience'
      });
      autofix.onError = 'continueRegularOutput';
      autofix.retryOnFail = true;
      autofix.maxTries = 2;
      autofix.waitBetweenTries = 5000; // AI models may have rate limits
    }

    // Check for deprecated continueOnFail
    if (config.continueOnFail !== undefined) {
      warnings.push({
        type: 'deprecated',
        property: 'continueOnFail',
        message: 'continueOnFail is deprecated. Use onError instead',
        suggestion: 'Replace with onError: "continueRegularOutput" or "stopWorkflow"'
      });
    }
  }

  /**
   * Validate MySQL node configuration
   */
  static validateMySQL(context: NodeValidationContext): void {
    const { config, errors, warnings, suggestions } = context;
    const { operation } = config;
    
    // MySQL uses similar validation to Postgres
    if (['execute', 'insert', 'update', 'delete'].includes(operation)) {
      this.validateSQLQuery(context, 'mysql');
    }
    
    // Operation-specific validation (similar to Postgres)
    switch (operation) {
      case 'insert':
        if (!config.table) {
          errors.push({
            type: 'missing_required',
            property: 'table',
            message: 'Table name is required for insert operation',
            fix: 'Specify the table to insert data into'
          });
        }
        break;
        
      case 'update':
        if (!config.table) {
          errors.push({
            type: 'missing_required',
            property: 'table',
            message: 'Table name is required for update operation',
            fix: 'Specify the table to update'
          });
        }
        
        if (!config.updateKey) {
          warnings.push({
            type: 'missing_common',
            property: 'updateKey',
            message: 'No update key specified',
            suggestion: 'Set updateKey to identify which rows to update'
          });
        }
        break;
        
      case 'delete':
        if (!config.table) {
          errors.push({
            type: 'missing_required',
            property: 'table',
            message: 'Table name is required for delete operation',
            fix: 'Specify the table to delete from'
          });
        }
        break;
        
      case 'execute':
        if (!config.query) {
          errors.push({
            type: 'missing_required',
            property: 'query',
            message: 'SQL query is required',
            fix: 'Provide the SQL query to execute'
          });
        }
        break;
    }
    
    // MySQL-specific warnings
    if (config.timezone === undefined) {
      suggestions.push('Consider setting timezone to ensure consistent date/time handling');
    }
    
    // Error handling for MySQL operations (similar to Postgres)
    if (!config.onError && !config.retryOnFail && !config.continueOnFail) {
      if (operation === 'execute' && config.query?.toLowerCase().includes('select')) {
        warnings.push({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'Database queries can fail due to connection issues',
          suggestion: 'Add onError: "continueRegularOutput" and retryOnFail: true'
        });
      } else if (['insert', 'update', 'delete'].includes(operation)) {
        warnings.push({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'Database modifications should handle errors carefully',
          suggestion: 'Add onError: "stopWorkflow" with retryOnFail for transient failures'
        });
      }
    }
  }
  
  /**
   * Validate SQL queries for injection risks and common issues
   */
  private static validateSQLQuery(
    context: NodeValidationContext,
    dbType: 'postgres' | 'mysql' | 'generic' = 'generic'
  ): void {
    const { config, errors, warnings, suggestions } = context;
    const query = config.query || config.deleteQuery || config.updateQuery || '';
    
    if (!query) return;
    
    const lowerQuery = query.toLowerCase();
    
    // SQL injection checks
    if (query.includes('${') || query.includes('{{')) {
      warnings.push({
        type: 'security',
        message: 'Query contains template expressions that might be vulnerable to SQL injection',
        suggestion: 'Use parameterized queries with query parameters instead of string interpolation'
      });
      
      suggestions.push('Example: Use "SELECT * FROM users WHERE id = $1" with queryParams: [userId]');
    }
    
    // DELETE without WHERE
    if (lowerQuery.includes('delete') && !lowerQuery.includes('where')) {
      errors.push({
        type: 'invalid_value',
        property: 'query',
        message: 'DELETE query without WHERE clause will delete all records',
        fix: 'Add a WHERE clause to specify which records to delete'
      });
    }
    
    // UPDATE without WHERE
    if (lowerQuery.includes('update') && !lowerQuery.includes('where')) {
      warnings.push({
        type: 'security',
        message: 'UPDATE query without WHERE clause will update all records',
        suggestion: 'Add a WHERE clause to specify which records to update'
      });
    }
    
    // TRUNCATE warning
    if (lowerQuery.includes('truncate')) {
      warnings.push({
        type: 'security',
        message: 'TRUNCATE will remove all data from the table',
        suggestion: 'Consider using DELETE with WHERE clause if you need to keep some data'
      });
    }
    
    // DROP warning
    if (lowerQuery.includes('drop')) {
      errors.push({
        type: 'invalid_value',
        property: 'query',
        message: 'DROP operations are extremely dangerous and will permanently delete database objects',
        fix: 'Use this only if you really intend to delete tables/databases permanently'
      });
    }
    
    // Performance suggestions
    if (lowerQuery.includes('select *')) {
      suggestions.push('Consider selecting specific columns instead of * for better performance');
    }
    
    // Database-specific checks
    if (dbType === 'postgres') {
      // PostgreSQL specific validations
      if (query.includes('$$')) {
        suggestions.push('Dollar-quoted strings detected - ensure they are properly closed');
      }
    } else if (dbType === 'mysql') {
      // MySQL specific validations
      if (query.includes('`')) {
        suggestions.push('Using backticks for identifiers - ensure they are properly paired');
      }
    }
  }
  
  /**
   * Validate HTTP Request node configuration with error handling awareness
   */
  static validateHttpRequest(context: NodeValidationContext): void {
    const { config, errors, warnings, suggestions, autofix } = context;
    const { method = 'GET', url, sendBody, authentication } = config;
    
    // Basic URL validation
    if (!url) {
      errors.push({
        type: 'missing_required',
        property: 'url',
        message: 'URL is required for HTTP requests',
        fix: 'Provide the full URL including protocol (https://...)'
      });
    } else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.includes('{{')) {
      warnings.push({
        type: 'invalid_value',
        property: 'url',
        message: 'URL should start with http:// or https://',
        suggestion: 'Use https:// for secure connections'
      });
    }
    
    // Method-specific validation
    if (['POST', 'PUT', 'PATCH'].includes(method) && !sendBody) {
      warnings.push({
        type: 'missing_common',
        property: 'sendBody',
        message: `${method} requests typically include a body`,
        suggestion: 'Set sendBody: true and configure the body content'
      });
    }
    
    // Error handling recommendations
    if (!config.retryOnFail && !config.onError && !config.continueOnFail) {
      warnings.push({
        type: 'best_practice',
        property: 'errorHandling',
        message: 'HTTP requests can fail due to network issues or server errors',
        suggestion: 'Add onError: "continueRegularOutput" and retryOnFail: true for resilience'
      });
      
      // Auto-fix suggestion for error handling
      autofix.onError = 'continueRegularOutput';
      autofix.retryOnFail = true;
      autofix.maxTries = 3;
      autofix.waitBetweenTries = 1000;
    }
    
    // Check for deprecated continueOnFail
    if (config.continueOnFail !== undefined) {
      warnings.push({
        type: 'deprecated',
        property: 'continueOnFail',
        message: 'continueOnFail is deprecated. Use onError instead',
        suggestion: 'Replace with onError: "continueRegularOutput"'
      });
      autofix.onError = config.continueOnFail ? 'continueRegularOutput' : 'stopWorkflow';
      delete autofix.continueOnFail;
    }
    
    // Check retry configuration
    if (config.retryOnFail) {
      // Validate retry settings
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && (!config.maxTries || config.maxTries > 3)) {
        warnings.push({
          type: 'best_practice',
          property: 'maxTries',
          message: `${method} requests might not be idempotent. Use fewer retries.`,
          suggestion: 'Set maxTries: 2 for non-idempotent operations'
        });
      }
      
      // Suggest alwaysOutputData for debugging
      if (!config.alwaysOutputData) {
        suggestions.push('Enable alwaysOutputData to capture error responses for debugging');
        autofix.alwaysOutputData = true;
      }
    }
    
    // Authentication warnings
    if (url && url.includes('api') && !authentication) {
      warnings.push({
        type: 'security',
        property: 'authentication',
        message: 'API endpoints typically require authentication',
        suggestion: 'Configure authentication method (Bearer token, API key, etc.)'
      });
    }
    
    // Timeout recommendations
    if (!config.timeout) {
      suggestions.push('Consider setting a timeout to prevent hanging requests');
    }
  }
  
  /**
   * Validate Webhook node configuration with error handling
   */
  static validateWebhook(context: NodeValidationContext): void {
    const { config, errors, warnings, suggestions, autofix } = context;
    const { path, httpMethod = 'POST', responseMode } = config;
    
    // Path validation
    if (!path) {
      errors.push({
        type: 'missing_required',
        property: 'path',
        message: 'Webhook path is required',
        fix: 'Provide a unique path like "my-webhook" or "github-events"'
      });
    } else if (path.startsWith('/')) {
      warnings.push({
        type: 'invalid_value',
        property: 'path',
        message: 'Webhook path should not start with /',
        suggestion: 'Use "webhook-name" instead of "/webhook-name"'
      });
    }
    
    // Error handling for webhooks
    if (!config.onError && !config.continueOnFail) {
      warnings.push({
        type: 'best_practice',
        property: 'onError',
        message: 'Webhooks should always send a response, even on error',
        suggestion: 'Set onError: "continueRegularOutput" to ensure webhook responses'
      });
      autofix.onError = 'continueRegularOutput';
    }
    
    // Check for deprecated continueOnFail in webhooks
    if (config.continueOnFail !== undefined) {
      warnings.push({
        type: 'deprecated',
        property: 'continueOnFail',
        message: 'continueOnFail is deprecated. Use onError instead',
        suggestion: 'Replace with onError: "continueRegularOutput"'
      });
      autofix.onError = 'continueRegularOutput';
      delete autofix.continueOnFail;
    }
    
    // Note: responseNode mode validation moved to workflow-validator.ts
    // where it has access to node-level onError property (not just config/parameters)

    // Always output data for debugging
    if (!config.alwaysOutputData) {
      suggestions.push('Enable alwaysOutputData to debug webhook payloads');
      autofix.alwaysOutputData = true;
    }
    
    // Security suggestions
    suggestions.push('Consider adding webhook validation (HMAC signature verification)');
    suggestions.push('Implement rate limiting for public webhooks');
  }
  
  /**
   * Validate Code node configuration with n8n-specific patterns
   */
  static validateCode(context: NodeValidationContext): void {
    const { config, errors, warnings, suggestions, autofix } = context;
    const language = config.language || 'javaScript';
    const codeField = language === 'python' ? 'pythonCode' : 'jsCode';
    const code = config[codeField] || '';
    
    // Check for empty code
    if (!code || code.trim() === '') {
      errors.push({
        type: 'missing_required',
        property: codeField,
        message: 'Code cannot be empty',
        fix: 'Add your code logic. Start with: return [{json: {result: "success"}}]'
      });
      return;
    }
    
    // Language-specific validation
    if (language === 'javaScript') {
      this.validateJavaScriptCode(code, errors, warnings, suggestions);
    } else if (language === 'python') {
      this.validatePythonCode(code, errors, warnings, suggestions);
    }
    
    // Check return statement and format
    const mode = config.mode || 'runOnceForAllItems';
    this.validateReturnStatement(code, language, errors, warnings, suggestions, mode);
    
    // Check n8n variable usage
    this.validateN8nVariables(code, language, warnings, suggestions, errors);
    
    // Security and best practices
    this.validateCodeSecurity(code, language, warnings);
    
    // Error handling recommendations
    if (!config.onError && code.length > 100) {
      warnings.push({
        type: 'best_practice',
        property: 'errorHandling',
        message: 'Code nodes can throw errors - consider error handling',
        suggestion: 'Add onError: "continueRegularOutput" to handle errors gracefully'
      });
      autofix.onError = 'continueRegularOutput';
    }
    
    // Mode-specific suggestions
    if (config.mode === 'runOnceForEachItem' && code.includes('items')) {
      warnings.push({
        type: 'best_practice',
        message: 'In "Run Once for Each Item" mode, use $json instead of items array',
        suggestion: 'Access current item data with $json.fieldName'
      });
    }
    
    if (!config.mode && code.includes('$json')) {
      warnings.push({
        type: 'best_practice',
        message: '$json only works in "Run Once for Each Item" mode',
        suggestion: 'Either set mode: "runOnceForEachItem" or use items[0].json'
      });
    }
  }
  
  private static validateJavaScriptCode(
    code: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    suggestions: string[]
  ): void {
    // Check for syntax patterns that might fail
    const syntaxPatterns = [
      { pattern: /const\s+const/, message: 'Duplicate const declaration' },
      { pattern: /let\s+let/, message: 'Duplicate let declaration' },
      // Removed overly simplistic parenthesis check - it was causing false positives
      // for valid patterns like $('NodeName').first().json or func()()
      // { pattern: /\)\s*\)\s*{/, message: 'Extra closing parenthesis before {' },
      // Only check for multiple closing braces at the very end (more likely to be an error)
      { pattern: /}\s*}\s*}\s*}$/, message: 'Multiple closing braces at end - check your nesting' }
    ];
    
    syntaxPatterns.forEach(({ pattern, message }) => {
      if (pattern.test(code)) {
        errors.push({
          type: 'invalid_value',
          property: 'jsCode',
          message: `Syntax error: ${message}`,
          fix: 'Check your JavaScript syntax'
        });
      }
    });
    
    // Common async/await issues
    // Check for await inside a non-async function (but top-level await is fine).
    // Length guard caps CodeQL polynomial-ReDoS exposure: the `[^}]*await`
    // tail can backtrack on crafted input with many unbalanced braces.
    const functionWithAwait = /function\s+\w*\s*\([^)]*\)\s*{[^}]*await/;
    const arrowWithAwait = /\([^)]*\)\s*=>\s*{[^}]*await/;

    if (code.length <= MAX_CODE_LENGTH
        && (functionWithAwait.test(code) || arrowWithAwait.test(code))
        && !code.includes('async')) {
      warnings.push({
        type: 'best_practice',
        message: 'Using await inside a non-async function',
        suggestion: 'Add async keyword to the function, or use top-level await (Code nodes support it)'
      });
    }
    
    // Check for common helper usage
    if (code.includes('$helpers.httpRequest')) {
      suggestions.push('$helpers.httpRequest is async - use: const response = await $helpers.httpRequest(...)');
    }
    
    if (code.includes('DateTime') && !code.includes('DateTime.')) {
      warnings.push({
        type: 'best_practice',
        message: 'DateTime is from Luxon library',
        suggestion: 'Use DateTime.now() or DateTime.fromISO() for date operations'
      });
    }
  }
  
  private static validatePythonCode(
    code: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    suggestions: string[]
  ): void {
    // Python-specific validation
    const lines = code.split('\n');
    
    // Check for tab/space mixing (already done in base validator)
    
    // Check for common Python mistakes in n8n context
    if (code.includes('__name__') && code.includes('__main__')) {
      warnings.push({
        type: 'inefficient',
        message: 'if __name__ == "__main__" is not needed in Code nodes',
        suggestion: 'Code node Python runs directly - remove the main check'
      });
    }
    
    // Check for unavailable imports
    const unavailableImports = [
      { module: 'requests', suggestion: 'Use JavaScript Code node with $helpers.httpRequest for HTTP requests' },
      { module: 'pandas', suggestion: 'Use built-in list/dict operations or JavaScript for data manipulation' },
      { module: 'numpy', suggestion: 'Use standard Python math operations' },
      { module: 'pip', suggestion: 'External packages cannot be installed in Code nodes' }
    ];
    
    unavailableImports.forEach(({ module, suggestion }) => {
      if (code.includes(`import ${module}`) || code.includes(`from ${module}`)) {
        errors.push({
          type: 'invalid_value',
          property: 'pythonCode',
          message: `Module '${module}' is not available in Code nodes`,
          fix: suggestion
        });
      }
    });
    
    // Check indentation after colons
    lines.forEach((line, i) => {
      if (line.trim().endsWith(':') && i < lines.length - 1) {
        const nextLine = lines[i + 1];
        if (nextLine.trim() && !nextLine.startsWith(' ') && !nextLine.startsWith('\t')) {
          errors.push({
            type: 'invalid_value',
            property: 'pythonCode',
            message: `Missing indentation after line ${i + 1}`,
            fix: 'Indent the line after the colon'
          });
        }
      }
    });
  }
  
  private static validateReturnStatement(
    code: string,
    language: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    suggestions: string[],
    mode: string = 'runOnceForAllItems'
  ): void {
    const hasReturn = /return\s+/.test(code);
    
    if (!hasReturn) {
      errors.push({
        type: 'missing_required',
        property: language === 'python' ? 'pythonCode' : 'jsCode',
        message: 'Code must return data for the next node',
        fix: language === 'python' 
          ? 'Add: return [{"json": {"result": "success"}}]'
          : 'Add: return [{json: {result: "success"}}]'
      });
      return;
    }
    
    // JavaScript return format validation
    if (language === 'javaScript') {
      // In runOnceForEachItem mode, bare objects and primitives are valid
      // because n8n auto-wraps them in [{json: ...}].
      // Only check return format in runOnceForAllItems mode (the default).
      const isRunOncePerItem = mode === 'runOnceForEachItem';

      // Check for object return without array
      if (!isRunOncePerItem && /return\s+{(?!.*\[).*}\s*;?$/s.test(code) && !code.includes('json:')) {
        errors.push({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Return value must be an array of objects',
          fix: 'Wrap in array: return [{json: yourObject}]'
        });
      }

      // Skip primitive return check when helper functions are present,
      // since we can't distinguish top-level vs nested returns without AST.
      // Matches: function name(), const/let/var name = [async] function/arrow.
      // Length guard caps CodeQL polynomial-ReDoS exposure on the
      // alternation with nested `[^)]*` groups.
      const hasHelperFunctions = code.length <= MAX_CODE_LENGTH
        && /(?:function\s+\w+\s*\(|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>))/.test(code);
      if (!isRunOncePerItem && !hasHelperFunctions && /return\s+(true|false|null|undefined|\d+|['"`])/m.test(code)) {
        errors.push({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Cannot return primitive values directly',
          fix: 'Return array of objects: return [{json: {value: yourData}}]'
        });
      }
      
      // Check for array of non-objects
      if (/return\s+\[[\s\n]*['"`\d]/.test(code)) {
        errors.push({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Array items must be objects with json property',
          fix: 'Use: return [{json: {value: "data"}}] not return ["data"]'
        });
      }
      
      // Suggest proper return format for items
      if (/return\s+items\s*;?$/.test(code) && !code.includes('map')) {
        suggestions.push(
          'Returning items directly is fine if they already have {json: ...} structure. ' +
          'To modify: return items.map(item => ({json: {...item.json, newField: "value"}}))'
        );
      }
    }
    
    // Python return format validation
    if (language === 'python') {
      const isRunOncePerItem = mode === 'runOnceForEachItem';

      // Check for dict return without list
      if (!isRunOncePerItem && /return\s+{(?!.*\[).*}$/s.test(code)) {
        errors.push({
          type: 'invalid_value',
          property: 'pythonCode',
          message: 'Return value must be a list of dicts',
          fix: 'Wrap in list: return [{"json": your_dict}]'
        });
      }

      // Check for primitive return
      if (!isRunOncePerItem && /return\s+(True|False|None|\d+|['"`])/m.test(code)) {
        errors.push({
          type: 'invalid_value',
          property: 'pythonCode',
          message: 'Cannot return primitive values directly',
          fix: 'Return list of dicts: return [{"json": {"value": your_data}}]'
        });
      }
    }
  }
  
  private static validateN8nVariables(
    code: string,
    language: string,
    warnings: ValidationWarning[],
    suggestions: string[],
    errors: ValidationError[]
  ): void {
    // Check if code accesses input data
    const inputPatterns = language === 'javaScript'
      ? ['items', '$input', '$json', '$node', '$prevNode']
      : ['items', '_input'];
    
    const usesInput = inputPatterns.some(pattern => code.includes(pattern));
    
    if (!usesInput && code.length > 50) {
      warnings.push({
        type: 'missing_common',
        message: 'Code doesn\'t reference input data',
        suggestion: language === 'javaScript'
          ? 'Access input with: items, $input.all(), or $json (single-item mode)'
          : 'Access input with: items variable'
      });
    }
    
    // Check for expression syntax in Code nodes
    if (code.includes('{{') && code.includes('}}')) {
      errors.push({
        type: 'invalid_value',
        property: language === 'python' ? 'pythonCode' : 'jsCode',
        message: 'Expression syntax {{...}} is not valid in Code nodes',
        fix: 'Use regular JavaScript/Python syntax without double curly braces'
      });
    }
    
    // Check for wrong $node syntax
    if (code.includes('$node[')) {
      warnings.push({
        type: 'invalid_value',
        property: language === 'python' ? 'pythonCode' : 'jsCode',
        message: 'Use $(\'Node Name\') instead of $node[\'Node Name\'] in Code nodes',
        suggestion: 'Replace $node[\'NodeName\'] with $(\'NodeName\')'
      });
    }
    
    // Check for expression-only functions
    const expressionOnlyFunctions = ['$now()', '$today()', '$tomorrow()', '.unique()', '.pluck(', '.keys()', '.hash('];
    expressionOnlyFunctions.forEach(func => {
      if (code.includes(func)) {
        warnings.push({
          type: 'invalid_value',
          property: language === 'python' ? 'pythonCode' : 'jsCode',
          message: `${func} is an expression-only function not available in Code nodes`,
          suggestion: 'See Code node documentation for alternatives'
        });
      }
    });
    
    // Check for common variable mistakes
    if (language === 'javaScript') {
      // Using $ without proper variable
      if (/\$(?![a-zA-Z_(])/.test(code) && !code.includes('${')) {
        warnings.push({
          type: 'best_practice',
          message: 'Invalid $ usage detected',
          suggestion: 'n8n variables start with $: $json, $input, $node, $workflow, $execution'
        });
      }
      
      // Check for helpers usage
      if (code.includes('helpers.') && !code.includes('$helpers')) {
        warnings.push({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Use $helpers not helpers',
          suggestion: 'Change helpers. to $helpers.'
        });
      }
      
      // Check for $helpers usage without availability check
      if (code.includes('$helpers') && !code.includes('typeof $helpers')) {
        warnings.push({
          type: 'best_practice',
          message: '$helpers availability varies by n8n version',
          suggestion: 'Check availability first: if (typeof $helpers !== "undefined" && $helpers.httpRequest) { ... }'
        });
      }
      
      // Suggest available helpers
      if (code.includes('$helpers')) {
        suggestions.push(
          'Common $helpers methods: httpRequest(), prepareBinaryData(). Note: getWorkflowStaticData is a standalone function - use $getWorkflowStaticData() instead'
        );
      }
      
      // Check for incorrect getWorkflowStaticData usage
      if (code.includes('$helpers.getWorkflowStaticData')) {
        errors.push({
          type: 'invalid_value',
          property: 'jsCode',
          message: '$helpers.getWorkflowStaticData() will cause "$helpers is not defined" error',
          fix: 'Use $getWorkflowStaticData("global") or $getWorkflowStaticData("node") directly'
        });
      }
      
      // Check for wrong JMESPath parameter order
      if (code.includes('$jmespath(') && /\$jmespath\s*\(\s*['"`]/.test(code)) {
        warnings.push({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Code node $jmespath has reversed parameter order: $jmespath(data, query)',
          suggestion: 'Use: $jmespath(dataObject, "query.path") not $jmespath("query.path", dataObject)'
        });
      }
      
      // Check for webhook data access patterns
      if (code.includes('items[0].json') && !code.includes('.json.body')) {
        // Check if previous node reference suggests webhook
        if (code.includes('Webhook') || code.includes('webhook') || 
            code.includes('$("Webhook")') || code.includes("$('Webhook')")) {
          warnings.push({
            type: 'invalid_value',
            property: 'jsCode',
            message: 'Webhook data is nested under .body property',
            suggestion: 'Use items[0].json.body.fieldName instead of items[0].json.fieldName for webhook data'
          });
        }
        // Also check for common webhook field names that suggest webhook data
        else if (/items\[0\]\.json\.(payload|data|command|action|event|message)\b/.test(code)) {
          warnings.push({
            type: 'best_practice',
            message: 'If processing webhook data, remember it\'s nested under .body',
            suggestion: 'Webhook payloads are at items[0].json.body, not items[0].json'
          });
        }
      }
    }
    
    // Check for JMESPath filters with unquoted numeric literals (both JS and Python).
    // Length guard: this scans the full Code-node body, which is bounded.
    // Prevents CodeQL polynomial-ReDoS on crafted input with many unmatched
    // `[` / `]` brackets around the filter pattern.
    const jmespathFunction = language === 'javaScript' ? '$jmespath' : '_jmespath';
    if (code.length <= MAX_CODE_LENGTH && code.includes(jmespathFunction + '(')) {
      // Look for filter expressions with comparison operators and numbers
      const filterPattern = /\[?\?[^[\]]*(?:>=?|<=?|==|!=)\s*(\d+(?:\.\d+)?)\s*\]/g;
      let match;

      while ((match = filterPattern.exec(code)) !== null) {
        const number = match[1];
        // Check if the number is NOT wrapped in backticks
        const beforeNumber = code.substring(match.index, match.index + match[0].indexOf(number));
        const afterNumber = code.substring(match.index + match[0].indexOf(number) + number.length);
        
        if (!beforeNumber.includes('`') || !afterNumber.startsWith('`')) {
          errors.push({
            type: 'invalid_value',
            property: language === 'python' ? 'pythonCode' : 'jsCode',
            message: `JMESPath numeric literal ${number} must be wrapped in backticks`,
            fix: `Change [?field >= ${number}] to [?field >= \`${number}\`]`
          });
        }
      }
      
      // Also provide a general suggestion if JMESPath is used
      suggestions.push(
        'JMESPath in n8n requires backticks around numeric literals in filters: [?age >= `18`]'
      );
    }
  }
  
  private static validateCodeSecurity(
    code: string,
    language: string,
    warnings: ValidationWarning[]
  ): void {
    // Security checks
    const dangerousPatterns = [
      { pattern: /eval\s*\(/, message: 'Avoid eval() - it\'s a security risk' },
      { pattern: /Function\s*\(/, message: 'Avoid Function constructor - use regular functions' },
      { pattern: language === 'python' ? /exec\s*\(/ : /exec\s*\(/, message: 'Avoid exec() - it\'s a security risk' },
      { pattern: /process\.env/, message: 'Limited environment access in Code nodes' },
      { pattern: /import\s+\*/, message: 'Avoid import * - be specific about imports' }
    ];
    
    dangerousPatterns.forEach(({ pattern, message }) => {
      if (pattern.test(code)) {
        warnings.push({
          type: 'security',
          message,
          suggestion: 'Use safer alternatives or built-in functions'
        });
      }
    });
    
    // Special handling for require() - it's allowed for built-in modules
    if (code.includes('require(')) {
      // Check if it's requiring a built-in module
      const builtinModules = ['crypto', 'util', 'querystring', 'url', 'buffer'];
      const requirePattern = /require\s*\(\s*['"`](\w+)['"`]\s*\)/g;
      let match;
      
      while ((match = requirePattern.exec(code)) !== null) {
        const moduleName = match[1];
        if (!builtinModules.includes(moduleName)) {
          warnings.push({
            type: 'security',
            message: `Cannot require('${moduleName}') - only built-in Node.js modules are available`,
            suggestion: `Available modules: ${builtinModules.join(', ')}`
          });
        }
      }
      
      // If require is used without quotes, it might be dynamic
      if (/require\s*\([^'"`]/.test(code)) {
        warnings.push({
          type: 'security',
          message: 'Dynamic require() not supported',
          suggestion: 'Use static require with string literals: require("crypto")'
        });
      }
    }
    
    // Check for crypto usage without require
    if ((code.includes('crypto.') || code.includes('randomBytes') || code.includes('randomUUID')) && 
        !code.includes('require') && language === 'javaScript') {
      warnings.push({
        type: 'invalid_value',
        message: 'Using crypto without require statement',
        suggestion: 'Add: const crypto = require("crypto"); at the beginning (ignore editor warnings)'
      });
    }
    
    // File system access warning
    if (/\b(fs|path|child_process)\b/.test(code)) {
      warnings.push({
        type: 'security',
        message: 'File system and process access not available in Code nodes',
        suggestion: 'Use other n8n nodes for file operations (e.g., Read/Write Files node)'
      });
    }
  }

  /**
   * Validate Set node configuration
   */
  static validateSet(context: NodeValidationContext): void {
    const { config, errors, warnings } = context;

    // Validate jsonOutput when present (used in JSON mode or when directly setting JSON)
    if (config.jsonOutput !== undefined && config.jsonOutput !== null && config.jsonOutput !== '') {
      try {
        const parsed = JSON.parse(config.jsonOutput);

        // Set node with JSON input expects an OBJECT {}, not an ARRAY []
        // This is a common mistake that n8n UI catches but our validator should too
        if (Array.isArray(parsed)) {
          errors.push({
            type: 'invalid_value',
            property: 'jsonOutput',
            message: 'Set node expects a JSON object {}, not an array []',
            fix: 'Either wrap array items as object properties: {"items": [...]}, OR use a different approach for multiple items'
          });
        }

        // Warn about empty objects
        if (typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 0) {
          warnings.push({
            type: 'inefficient',
            property: 'jsonOutput',
            message: 'jsonOutput is an empty object - this node will output no data',
            suggestion: 'Add properties to the object or remove this node if not needed'
          });
        }
      } catch (e) {
        errors.push({
          type: 'syntax_error',
          property: 'jsonOutput',
          message: `Invalid JSON in jsonOutput: ${e instanceof Error ? e.message : 'Syntax error'}`,
          fix: 'Ensure jsonOutput contains valid JSON syntax'
        });
      }
    }

    // Validate mode-specific requirements
    if (config.mode === 'manual') {
      // In manual mode, at least one field should be defined
      const hasFieldsViaValues = config.values && Object.keys(config.values).length > 0;
      const hasFieldsViaAssignments = config.assignments?.assignments
        && Array.isArray(config.assignments.assignments)
        && config.assignments.assignments.length > 0;
      const hasFields = hasFieldsViaValues || hasFieldsViaAssignments;
      if (!hasFields && !config.jsonOutput) {
        warnings.push({
          type: 'missing_common',
          message: 'Set node has no fields configured - will output empty items',
          suggestion: 'Add field assignments or use JSON mode'
        });
      }
    }
  }

}