/**
 * Node-Specific Validators
 *
 * Provides detailed validation logic for commonly used n8n nodes.
 * Each validator understands the specific requirements and patterns of its node.
 */

import { checkJmespathQuery, findJmespathCalls } from '../utils/jmespath-checks';
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

/**
 * Max distance the function-head detector scans backward from a `{` to find the
 * matching `(`. A real parameter list is short; capping the walk keeps brace
 * scanning linear on adversarial input (e.g. many unmatched `) {`).
 */
const MAX_PARAM_SCAN = 2_000;

/**
 * Caps for the Python scope/return scanners. A `def` header longer than
 * MAX_HEADER_LINES, or a return expression whose brackets do not close within
 * MAX_RETURN_LOOKAHEAD characters, is left unanalysed rather than scanned
 * further - malformed input must not turn these walks quadratic.
 */
const MAX_HEADER_LINES = 50;
const MAX_RETURN_LOOKAHEAD = 5_000;
const MAX_RETURN_TOTAL_SCAN = 200_000;

/** A name bound only across a range of one line (comprehension or lambda). */
interface PythonLocalBinding {
  name: string;
  start: number;
  end: number;
}

/** One pass over a Python Code node: every line's scope and what it binds. */
interface PythonScopeIndex {
  lines: string[];
  lineScope: number[];
  scopes: { parent: number; names: Set<string> }[];
  lineLocal: PythonLocalBinding[][];
  referenceText: string[];
}

/**
 * Detects a top-level primitive return in a JS Code node. Keyword literals
 * require a trailing word boundary so identifiers that merely start with one
 * (e.g. `return trueItems`) are not misflagged. Module-level + flagless so it
 * can be reused without `lastIndex` state.
 */
const JS_PRIMITIVE_RETURN_RE = /return\s+(?:(?:true|false|null|undefined)\b|\d+|['"`])/m;

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

    // NOTE (QA #3, deferred): a hardcoded resource→operations map was
    // considered here, but the real n8n Slack node exposes many more
    // operations per resource than easy to keep in sync (e.g. `post`,
    // `sendAndWait`, `getPermalink`, `search` for `message`). Rejecting
    // based on a stale list produced false positives on valid configs.
    // The proper fix is to derive the allowed set from the node's loaded
    // `properties_schema` — tracked as a follow-up. Until then, the switch
    // statements below perform operation-specific field checks for the
    // operations we know about, and unknown operations are not rejected.

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
  
  /**
   * In Google Sheets v4+, the `columns` resourceMapper (mappingMode "defineBelow" /
   * "autoMapInputData") carries the range/values via matchingColumns + schema, so the
   * legacy range/values fields are not required. An empty `columns: {}` object does not
   * count — a real mapping has at least a mappingMode or a value.
   */
  private static hasColumnsMapping(config: any): boolean {
    return !!(config.columns && (config.columns.mappingMode || config.columns.value));
  }

  private static validateGoogleSheetsAppend(context: NodeValidationContext): void {
    const { config, errors, warnings, autofix } = context;

    // In Google Sheets v4+, range is only required if NOT using the columns resourceMapper
    // The columns parameter is a resourceMapper introduced in v4 that handles range automatically
    if (!config.range && !this.hasColumnsMapping(config)) {
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
    const { config, suggestions } = context;

    // Range is NOT required for read: in Sheets v4+ the sheet is selected via
    // the sheetName resourceLocator and reads default to the whole sheet;
    // range is an optional advanced field.

    // Suggest data structure options
    if (!config.options?.dataStructure) {
      suggestions.push('Consider setting options.dataStructure to "object" for easier data manipulation');
    }
  }

  private static validateGoogleSheetsUpdate(context: NodeValidationContext): void {
    const { config, errors } = context;

    // In Google Sheets v4+, the columns resourceMapper (mappingMode: "defineBelow" / "autoMapInputData")
    // handles both range and values automatically via matchingColumns + schema.
    // Range/values are only required when NOT using columns mapping.
    const hasColumnsMapping = this.hasColumnsMapping(config);

    if (!config.range && !hasColumnsMapping) {
      errors.push({
        type: 'missing_required',
        property: 'range',
        message: 'Range or columns mapping is required for update operation',
        fix: 'Specify range like "Sheet1!A1:B10" OR use columns with mappingMode (e.g. defineBelow)'
      });
    }

    if (!config.values && !config.rawData && !hasColumnsMapping) {
      errors.push({
        type: 'missing_required',
        property: 'values',
        message: 'Values or columns mapping is required for update operation',
        fix: 'Provide data via values/rawData OR use columns.value with defineBelow mapping'
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
    
    // Collection is always required. The base validator already reports an
    // empty required property, so skip this when it has - one defect, one error.
    const collectionAlreadyReported = errors.some(e => e.property === 'collection');
    if (!config.collection && !collectionAlreadyReported) {
      errors.push({
        type: 'missing_required',
        property: 'collection',
        message: 'Collection name is required',
        fix: 'Specify the MongoDB collection to work with'
      });
    }
    
    switch (operation) {
      case 'find':
        // Query validation. Expression values ('=...' prefix or {{ }}
        // interpolation) resolve to JSON at runtime, so they are not parsed.
        if (config.query && typeof config.query === 'string'
            && !config.query.trim().startsWith('=') && !config.query.includes('{{')) {
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

    if (!query || typeof query !== 'string') return;

    const lowerQuery = query.toLowerCase();

    // Expression-valued queries ('=...' prefix or {{ }} interpolation) resolve
    // at runtime; the static text is not the final SQL, so destructive-keyword
    // findings are downgraded from errors to warnings.
    const isExpression = query.trim().startsWith('=') || query.includes('{{');

    // Keyword checks match statement positions only (start of query or after
    // ';'), so identifiers like drop_off_date / deleted_at can't trip them.
    const statementText = lowerQuery.replace(/^\s*=/, '');
    const startsStatement = (keyword: string): boolean =>
      new RegExp(`(^|;)\\s*${keyword}\\b`).test(statementText);
    const hasWhere = /\bwhere\b/.test(statementText);

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
    if (startsStatement('delete') && !hasWhere) {
      if (isExpression) {
        warnings.push({
          type: 'security',
          property: 'query',
          message: 'DELETE query without WHERE clause will delete all records',
          suggestion: 'The query contains an expression resolved at runtime - make sure the final SQL includes a WHERE clause'
        });
      } else {
        errors.push({
          type: 'invalid_value',
          property: 'query',
          message: 'DELETE query without WHERE clause will delete all records',
          fix: 'Add a WHERE clause to specify which records to delete'
        });
      }
    }

    // UPDATE without WHERE
    if (startsStatement('update') && !hasWhere) {
      warnings.push({
        type: 'security',
        message: 'UPDATE query without WHERE clause will update all records',
        suggestion: 'Add a WHERE clause to specify which records to update'
      });
    }

    // TRUNCATE warning
    if (startsStatement('truncate')) {
      warnings.push({
        type: 'security',
        message: 'TRUNCATE will remove all data from the table',
        suggestion: 'Consider using DELETE with WHERE clause if you need to keep some data'
      });
    }

    // DROP warning
    if (startsStatement('drop')) {
      if (isExpression) {
        warnings.push({
          type: 'security',
          property: 'query',
          message: 'DROP operations are extremely dangerous and will permanently delete database objects',
          suggestion: 'The query contains an expression resolved at runtime - make sure this DROP is intentional'
        });
      } else {
        errors.push({
          type: 'invalid_value',
          property: 'query',
          message: 'DROP operations are extremely dangerous and will permanently delete database objects',
          fix: 'Use this only if you really intend to delete tables/databases permanently'
        });
      }
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
    const rawLanguage = config.language || 'javaScript';
    // n8n's Code node accepts both the current 'pythonNative' UI value and the
    // legacy 'python' value at runtime; both store code in pythonCode.
    const language = rawLanguage === 'pythonNative' ? 'python' : rawLanguage;
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
    
    const mode = config.mode || 'runOnceForAllItems';
    // An expression resolves at runtime, so which mode the node runs in is
    // unknown here and the mode-dependent rules have to stay quiet.
    const modeIsKnown = !(typeof config.mode === 'string' && config.mode.startsWith('='));

    // Language-specific validation
    if (language === 'javaScript') {
      this.validateJavaScriptCode(code, errors, warnings, suggestions);
    } else if (language === 'python') {
      this.validatePythonCode(code, errors, warnings, suggestions, mode, modeIsKnown);
    }

    // Check return statement and format
    this.validateReturnStatement(code, language, errors, warnings, suggestions, mode, modeIsKnown);

    // Check n8n variable usage
    this.validateN8nVariables(code, language, warnings, suggestions, errors, mode);
    
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
    
    // Mode-specific suggestions ($json is a JavaScript-only accessor)
    if (language === 'javaScript' && config.mode === 'runOnceForEachItem' && code.includes('items')) {
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
  
  /**
   * Globals the Pyodide "Python (Beta)" runtime provided and native Python
   * (n8n 2.x, `language: "pythonNative"`) does not. Each one raises NameError.
   */
  private static readonly PYTHON_REMOVED_GLOBALS = ['_input', '_json', '_node', '_now', '_today', '_jmespath'];

  /**
   * Builtins the task runner denies by default (N8N_RUNNERS_BUILTINS_DENY).
   * Calling one raises NameError at runtime.
   */
  private static readonly PYTHON_DENIED_BUILTINS: Record<string, string> = {
    eval: 'Compute the value directly instead of evaluating a string',
    exec: 'Compute the value directly instead of executing a string',
    compile: 'Compute the value directly instead of compiling a string',
    open: 'Read and write files with n8n file nodes',
    input: 'Pass values in from a previous node',
    type: 'Use isinstance(x, dict) to check a type',
    getattr: 'Use dict access: d.get(key)',
    setattr: 'Use dict access: d[key] = value',
    hasattr: 'Use dict access: key in d',
    vars: 'Use dict access: d.get(key)',
    dir: 'Use dict access: key in d',
    globals: 'Pass values through function arguments',
    locals: 'Pass values through function arguments',
    object: 'Use dicts instead of objects',
    memoryview: 'Work with lists, dicts and strings',
    breakpoint: 'Use print() for debugging'
  };

  private static pythonRemovedGlobalFix(name: string, isEachItem: boolean): string {
    switch (name) {
      case '_input':
        return isEachItem ? 'Use _item (the current item dict)' : 'Use _items (the list of item dicts)';
      case '_json':
        return isEachItem ? 'Use _item["json"]' : 'Use _items[0]["json"]';
      case '_node':
        return 'No equivalent: merge the other branch upstream, or read it in JavaScript';
      case '_now':
      case '_today':
        return 'No equivalent: pass the timestamp in from an expression, or import datetime if this instance allowlists it';
      default:
        return 'No equivalent: use $jmespath in an expression, or a list comprehension';
    }
  }

  /**
   * Returns `strip(code)`, unless `code` exceeds MAX_CODE_LENGTH - in which case
   * the raw code is scanned as-is. Bounds the cost of the polynomial-in-theory
   * regexes run against the stripped view to a constant.
   */
  private static withinCapOrRaw(code: string, strip: (code: string) => string): string {
    return code.length <= MAX_CODE_LENGTH ? strip(code) : code;
  }

  /**
   * Index of the `:` that ends a `def` header - the first one at bracket depth
   * zero. Returns -1 while the header is still open, so a header split across
   * lines can be accumulated until this finds the colon.
   */
  private static pythonHeaderColonIndex(text: string, startDepth: number = 0): number {
    let depth = startDepth;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '(' || char === '[' || char === '{') depth++;
      else if (char === ')' || char === ']' || char === '}') depth--;
      else if (char === ':' && depth === 0) return i;
    }
    return -1;
  }

  /** Net bracket depth a line adds. */
  private static pythonBracketDelta(text: string): number {
    let delta = 0;
    for (const char of text) {
      if (char === '(' || char === '[' || char === '{') delta++;
      else if (char === ')' || char === ']' || char === '}') delta--;
    }
    return delta;
  }

  /** The plain identifier a binding target names, or null (e.g. `d["k"]`). */
  private static pythonTargetName(target: string): string | null {
    const bare = target.trim().replace(/^[(\[\s]+|[)\]\s]+$/g, '').replace(/^\*+/, '').trim();
    // `name: dict` (annotated) and `name=default` (parameter) both bind `name`.
    const name = bare.split(/[:=]/)[0].trim();
    return /^[A-Za-z_]\w*$/.test(name) ? name : null;
  }

  /** Split on commas that are not inside brackets. */
  private static pythonSplitTopLevel(text: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of text) {
      if (char === '(' || char === '[' || char === '{') depth++;
      else if (char === ')' || char === ']' || char === '}') depth--;
      if (char === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    parts.push(current);
    return parts;
  }

  /**
   * Parameter names of a `def` header. Defaults and annotations are expressions
   * evaluated in the ENCLOSING scope, so only the name before `=` / `:` binds.
   */
  private static pythonParameterNames(header: string): string[] {
    const open = header.indexOf('(');
    if (open === -1) return [];
    let depth = 0;
    let close = -1;
    for (let i = open; i < header.length; i++) {
      if (header[i] === '(') depth++;
      else if (header[i] === ')') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) return [];
    return this.pythonSplitTopLevel(header.slice(open + 1, close))
      .map(part => this.pythonTargetName(part))
      .filter((name): name is string => name !== null);
  }

  /**
   * Joins Python continuation lines - a trailing `\` and implicit continuation
   * inside brackets - so a statement can be parsed whole. The result has one
   * entry per source line: the line that STARTS a statement holds the joined
   * text, continuation lines hold ''. Line count is preserved so callers keep
   * their line-to-scope mapping.
   */
  private static pythonLogicalLines(lines: string[]): string[] {
    const logical = lines.map(() => '');

    // The trailing `\` is a line-join marker, not part of the statement, so it
    // is dropped - otherwise it would sit between two words of the joined text.
    const continuation = /\\[ \t]*$/;
    const withoutMarker = (line: string) => line.replace(continuation, '');

    for (let i = 0; i < lines.length; i++) {
      const start = i;
      let statement = withoutMarker(lines[i]);
      let depth = this.pythonBracketDelta(lines[i]);
      let continued = continuation.test(lines[i]);

      while ((depth > 0 || continued) && i + 1 < lines.length && statement.length <= MAX_SHORT_INPUT_LENGTH) {
        i++;
        statement += ` ${withoutMarker(lines[i]).trim()}`;
        depth += this.pythonBracketDelta(lines[i]);
        continued = continuation.test(lines[i]);
      }

      logical[start] = statement;
    }

    return logical;
  }

  /**
   * Names an import statement binds: `import a.b` binds `a`, `import a.b as c`
   * and `from m import x as c` bind `c`, `from m import x` binds `x`. A bound
   * name is a local, so the rules about runtime globals and denied builtins
   * stay quiet about it - the blocked-import warning still fires.
   */
  private static pythonImportBindings(statement: string): string[] {
    const text = statement.trim().replace(/[()]/g, ' ');
    const words = text.split(/[ \t]+/).filter(Boolean);
    if (words.length === 0) return [];

    let list: string[];
    if (words[0] === 'import') {
      list = words.slice(1);
    } else if (words[0] === 'from') {
      const keyword = words.indexOf('import');
      if (keyword === -1) return [];
      list = words.slice(keyword + 1);
    } else {
      return [];
    }

    const names: string[] = [];
    for (const part of list.join(' ').split(',')) {
      const pieces = part.trim().split(/[ \t]+/).filter(Boolean);
      if (pieces.length === 0) continue;
      const alias = pieces.indexOf('as');
      const target = alias === -1 ? pieces[0].split('.')[0] : pieces[alias + 1];
      if (target && /^[A-Za-z_]\w*$/.test(target)) names.push(target);
    }

    return names;
  }

  /** Names a statement binds in its own scope (assignment, `for`, `as`). */
  private static pythonBindingsOnLine(line: string): string[] {
    const names: string[] = [];

    // Assignment, including destructuring (`a, b = ...`) and annotated
    // (`name: dict = {}`). Augmented (`x += 1`) and comparisons are excluded.
    const assignment = /^[ \t]*([^=\n]+?)(?<![=!<>+\-*/%&|^~])=(?!=)/.exec(line);
    if (assignment) {
      this.pythonSplitTopLevel(assignment[1]).forEach(target => {
        const name = this.pythonTargetName(target);
        if (name) names.push(name);
      });
    }

    // `for a, b in ...:` as a statement binds for the rest of the block.
    const forStatement = /^[ \t]*(?:async[ \t]+)?for[ \t]+(.+?)[ \t]+in[ \t]/.exec(line);
    if (forStatement) {
      this.pythonSplitTopLevel(forStatement[1]).forEach(target => {
        const name = this.pythonTargetName(target);
        if (name) names.push(name);
      });
    }

    const asTargets = /\bas[ \t]+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = asTargets.exec(line)) !== null) names.push(match[1]);

    this.pythonImportBindings(line).forEach(name => names.push(name));

    return names;
  }

  /**
   * True when a replacement field reaching a dunder belongs to a string that is
   * actually passed to `.format(...)`. A plain literal such as
   * `label = "{obj.__class__}"` never evaluates the attribute. f-string fields
   * are real code and are already visible in the ordinary scan view.
   */
  private static pythonFormatsDunder(formatFields: string): boolean {
    const field = /\{[^{}\n]{0,200}\.__\w+__[^{}\n]{0,200}\}/g;
    let match: RegExpExecArray | null;

    while ((match = field.exec(formatFields)) !== null) {
      const after = formatFields.slice(match.index + match[0].length, match.index + match[0].length + 200);
      if (/['"][ \t]*\.[ \t]*format[ \t]*\(/.test(after)) return true;
    }

    return false;
  }

  /**
   * The bracket group that encloses `index`, or null when the position is not
   * inside one. Used to bound a comprehension or lambda to its own expression.
   */
  private static pythonEnclosingGroup(line: string, index: number): { start: number; end: number } | null {
    let closers = 0;
    let start = -1;

    for (let i = index - 1; i >= 0; i--) {
      const char = line[i];
      if (char === ')' || char === ']' || char === '}') closers++;
      else if (char === '(' || char === '[' || char === '{') {
        if (closers === 0) { start = i; break; }
        closers--;
      }
    }
    if (start === -1) return null;

    let depth = 0;
    for (let i = start; i < line.length; i++) {
      const char = line[i];
      if (char === '(' || char === '[' || char === '{') depth++;
      else if (char === ')' || char === ']' || char === '}') {
        depth--;
        if (depth === 0) return { start, end: i };
      }
    }
    return { start, end: line.length };
  }

  /**
   * Names bound by a comprehension `for` target or a `lambda` parameter, each
   * with the character range it covers. The range matters: in
   * `_json + [_json for _json in _items]` only the reference inside the
   * comprehension is bound - the first one is still the removed global.
   */
  private static pythonLineLocalBindings(line: string): PythonLocalBinding[] {
    const bindings: PythonLocalBinding[] = [];
    const add = (targets: string, range: { start: number; end: number }) => {
      this.pythonSplitTopLevel(targets).forEach(target => {
        const name = this.pythonTargetName(target);
        if (name) bindings.push({ name, ...range });
      });
    };

    const forTargets = /\bfor[ \t]+(.+?)[ \t]+in\b/g;
    let match: RegExpExecArray | null;
    while ((match = forTargets.exec(line)) !== null) {
      // A comprehension binds across the whole bracket group, including the
      // output expression written before the `for`.
      add(match[1], this.pythonEnclosingGroup(line, match.index) ?? { start: match.index, end: line.length });
    }

    const lambdas = /\blambda\b([^:\n]*):/g;
    while ((match = lambdas.exec(line)) !== null) {
      // A lambda binds from its keyword onward, never before it.
      const group = this.pythonEnclosingGroup(line, match.index);
      add(match[1], { start: match.index, end: group ? group.end : line.length });
    }

    return bindings;
  }

  /**
   * A `def` header with the names it BINDS blanked out - the function name and
   * each parameter name - while annotations and defaults are kept, because
   * those are expressions evaluated in the enclosing scope. Length is
   * preserved so the result can be split back into lines.
   */
  private static pythonMaskHeaderBindings(header: string): string {
    const chars = header.split('');
    const blank = (from: number, to: number) => {
      for (let i = from; i < to; i++) if (chars[i] !== '\n') chars[i] = ' ';
    };

    const named = /(\bdef[ \t]+)(\w+)/.exec(header);
    if (named) blank(named.index + named[1].length, named.index + named[0].length);

    const open = header.indexOf('(');
    if (open === -1) return chars.join('');
    let depth = 0;
    let close = header.length;
    for (let i = open; i < header.length; i++) {
      if (header[i] === '(') depth++;
      else if (header[i] === ')') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }

    let partStart = open + 1;
    let partDepth = 0;
    for (let i = open + 1; i <= close; i++) {
      if (i === close || (header[i] === ',' && partDepth === 0)) {
        const part = header.slice(partStart, i);
        const annotated = part.search(/[:=]/);
        blank(partStart, partStart + (annotated === -1 ? part.length : annotated));
        partStart = i + 1;
        continue;
      }
      const char = header[i];
      if (char === '(' || char === '[' || char === '{') partDepth++;
      else if (char === ')' || char === ']' || char === '}') partDepth--;
    }

    return chars.join('');
  }

  /**
   * Maps every line to the innermost `def` scope that encloses it, with the
   * names each scope binds. A `def` header line belongs to the ENCLOSING scope,
   * because parameter defaults and annotations are evaluated there.
   */
  private static pythonScopes(scan: string, logicalLines?: string[]): PythonScopeIndex {
    const lines = scan.split('\n');
    const logical = logicalLines ?? this.pythonLogicalLines(lines);
    const scopes: { parent: number; names: Set<string> }[] = [{ parent: -1, names: new Set() }];
    const lineScope = new Array(lines.length).fill(0);
    const lineLocal: PythonLocalBinding[][] = lines.map(() => []);
    const referenceText = [...lines];
    const stack: { scope: number; indent: number }[] = [{ scope: 0, indent: -1 }];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') {
        lineScope[i] = stack[stack.length - 1].scope;
        i++;
        continue;
      }

      const indent = (line.match(/^[ \t]*/) || [''])[0].length;
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const enclosing = stack[stack.length - 1].scope;

      const definition = /^[ \t]*(?:async[ \t]+)?def[ \t]+(\w+)[ \t]*\(/.exec(line);
      if (!definition) {
        lineScope[i] = enclosing;
        i++;
        continue;
      }

      // Accumulate a multi-line header, tracking bracket depth incrementally so
      // the cost stays linear. Bounded three ways so malformed code (a file of
      // unclosed `def f(` lines) cannot make this quadratic: the colon that ends
      // the header, MAX_HEADER_LINES, and - once brackets are balanced - the
      // first line that dedents back to the `def`.
      let header = line;
      let last = i;
      let headerDepth = this.pythonBracketDelta(line);
      while (this.pythonHeaderColonIndex(line, headerDepth - this.pythonBracketDelta(line)) === -1
             && last + 1 < lines.length
             && last - i < MAX_HEADER_LINES) {
        const next = lines[last + 1];
        const nextIndent = (next.match(/^[ \t]*/) || [''])[0].length;
        if (headerDepth <= 0 && next.trim() !== '' && nextIndent <= indent) break;
        last++;
        header += `\n${next}`;
        headerDepth += this.pythonBracketDelta(next);
        if (this.pythonHeaderColonIndex(next, headerDepth - this.pythonBracketDelta(next)) !== -1) break;
      }
      // The parameter NAMES are binding sites, not references to whatever the
      // runtime would otherwise provide, so they are masked out.
      const masked = this.pythonMaskHeaderBindings(header).split('\n');
      const body = scopes.push({ parent: enclosing, names: new Set(this.pythonParameterNames(header)) }) - 1;

      // A one-line def (`def helper(_json): return _json`) carries its suite on
      // the header line, and that suite runs in the function's scope.
      const colon = this.pythonHeaderColonIndex(header);
      const inlineSuite = colon !== -1 && header.slice(colon + 1).trim() !== '';

      for (let k = i; k <= last; k++) {
        lineScope[k] = k === last && inlineSuite ? body : enclosing;
        referenceText[k] = masked[k - i];
      }

      scopes[enclosing].names.add(definition[1]);
      stack.push({ scope: body, indent });
      i = last + 1;
    }

    // Bindings are read from the JOINED statement, so a target split across a
    // continuation line still counts.
    lines.forEach((line, index) => {
      const statement = logical[index] || line;
      this.pythonBindingsOnLine(statement).forEach(name => scopes[lineScope[index]].names.add(name));
      lineLocal[index] = this.pythonLineLocalBindings(line);
    });

    return { lines, lineScope, scopes, lineLocal, referenceText };
  }

  /**
   * True when `reference` matches at least one line where `name` is NOT bound by
   * the code. Python resolves names outward, so a binding in an enclosing scope
   * exempts nested references, but a binding inside a `def` never exempts a
   * top-level reference.
   *
   * Two deliberate limits, both order-insensitive because the scopes are built
   * in one pass rather than interpreted: a binding LATER in a scope exempts an
   * earlier reference in that same scope (`x = _json` below `return _json`), and
   * a `def type(...)` anywhere exempts calls written above it. Both keep the
   * rules quiet on code that names a symbol locally, which is the safer error.
   */
  private static pythonHasUnboundReference(
    index: PythonScopeIndex,
    name: string,
    reference: RegExp
  ): boolean {
    const { lineScope, scopes, lineLocal, referenceText } = index;
    const matcher = new RegExp(reference.source, reference.flags.includes('g') ? reference.flags : `${reference.flags}g`);

    return referenceText.some((line, lineNumber) => {
      let bound = false;
      for (let scope = lineScope[lineNumber]; scope !== -1; scope = scopes[scope].parent) {
        if (scopes[scope].names.has(name)) { bound = true; break; }
      }
      if (bound) return false;

      matcher.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(line)) !== null) {
        if (match[0].length === 0) matcher.lastIndex++;
        const at = match.index;
        const shadowed = lineLocal[lineNumber].some(
          local => local.name === name && at >= local.start && at <= local.end
        );
        if (!shadowed) return true;
      }
      return false;
    });
  }

  /**
   * True when a `global` statement appears inside a `def` body. Only those fail:
   * user code runs inside a wrapper function, so a nested function's `global`
   * binds to the module scope it never writes to. A top-level `global` is a
   * no-op that works.
   */
  private static pythonHasGlobalInsideFunction(index: PythonScopeIndex): boolean {
    return index.lines.some((line, line_index) =>
      index.lineScope[line_index] !== 0 && /^[ \t]*global[ \t]+\w/.test(line)
    );
  }

  private static validatePythonCode(
    code: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    suggestions: string[],
    mode: string = 'runOnceForAllItems',
    modeIsKnown: boolean = true
  ): void {
    // Python-specific validation. Every pattern below scans the
    // string/comment-stripped view so a token inside a literal (a message
    // mentioning "_input", a filename "data.json") cannot trip it.
    const lines = code.split('\n');
    const isEachItem = mode === 'runOnceForEachItem';
    const scan = this.withinCapOrRaw(code, c => this.stripPythonStringsAndComments(c));
    // Continuation lines are joined once so statements can be parsed whole, and
    // one scope pass feeds every name check below. Above the length cap the
    // scope-dependent rules are skipped rather than run against raw text.
    const logicalLines = this.pythonLogicalLines(scan.split('\n'));
    const scopeIndex = code.length <= MAX_CODE_LENGTH ? this.pythonScopes(scan, logicalLines) : null;

    // Check for tab/space mixing (already done in base validator)

    // Check for common Python mistakes in n8n context
    if (code.includes('__name__') && code.includes('__main__')) {
      warnings.push({
        type: 'inefficient',
        message: 'if __name__ == "__main__" is not needed in Code nodes',
        suggestion: 'Code node Python runs directly - remove the main check'
      });
    }

    // Removed Pyodide globals. A name the code binds itself is an ordinary
    // local, not the runtime global.
    if (scopeIndex) {
      for (const name of this.PYTHON_REMOVED_GLOBALS) {
        // The lookbehind keeps attribute access out of it: `state._json` reads a
        // field of a dict-like object, not the removed global.
        if (this.pythonHasUnboundReference(scopeIndex, name, new RegExp(`(?<![\\w.])${name}\\b`))) {
          errors.push({
            type: 'invalid_value',
            property: 'pythonCode',
            message: `${name} does not exist in native Python - it was removed with the Pyodide runtime`,
            fix: this.pythonRemovedGlobalFix(name, isEachItem)
          });
        }
      }

      // `items` is the JavaScript Code node's variable, not a Python one. The
      // guard keeps `d.items()` and `for k, v in data.items():` out of it.
      if (this.pythonHasUnboundReference(scopeIndex, 'items', /(?<![\w.])items\b(?![ \t]*=(?!=))/)) {
        errors.push({
          type: 'invalid_value',
          property: 'pythonCode',
          message: 'items does not exist in native Python; use _items (all-items mode) or _item (each-item mode)',
          fix: isEachItem ? 'Use _item (the current item dict)' : 'Use _items (the list of item dicts)'
        });
      }
    }

    // Input variables exist only in their own mode. Skipped when the node's
    // mode is an expression (resolved at runtime), and when the code binds the
    // name itself - then it is an ordinary local, not the runtime global.
    if (modeIsKnown && scopeIndex) {
      if (isEachItem && this.pythonHasUnboundReference(scopeIndex, '_items', /(?<![\w.])_items\b/)) {
        errors.push({
          type: 'invalid_value',
          property: 'pythonCode',
          message: '_items does not exist in "Run Once for Each Item" mode',
          fix: 'Use _item, or switch mode to runOnceForAllItems'
        });
      }
      if (!isEachItem && this.pythonHasUnboundReference(scopeIndex, '_item', /(?<![\w.])_item\b/)) {
        errors.push({
          type: 'invalid_value',
          property: 'pythonCode',
          message: '_item does not exist in "Run Once for All Items" mode',
          fix: 'Use _items, or switch mode to runOnceForEachItem'
        });
      }
    }

    // Items are plain dicts. `.json(` is left alone - that is a method call on
    // something else, not item access.
    if (/\.json\b(?!\s*\()/.test(scan)) {
      errors.push({
        type: 'invalid_value',
        property: 'pythonCode',
        message: 'Items are dicts: .json attribute access raises AttributeError',
        fix: 'Use dict access: item["json"]["field"] or item["json"].get("field")'
      });
    }

    // Imports are checked against an allowlist before the code runs. A statement
    // can also start after `:` (`if True: import json`) or `;`.
    const importedModules = new Set<string>();
    const importStatement = /(?:^|[:;])[ \t]*import[ \t]+([^\n;]+)/gm;
    const fromImportStatement = /(?:^|[:;])[ \t]*from[ \t]+([\w.]+)[ \t]+import\b/gm;
    // Parsed with string operations rather than a regex: `[ \t]+as[ \t]+` has
    // quantifiers either side of a literal and backtracks on long runs of tabs.
    const rootModule = (token: string) => {
      const trimmed = token.trim();
      const space = trimmed.search(/[ \t]/);
      const first = space === -1 ? trimmed : trimmed.slice(0, space);
      return first.split('.')[0];
    };
    const addModule = (token: string) => {
      const name = rootModule(token);
      if (/^[A-Za-z_]\w*$/.test(name)) importedModules.add(name);
    };
    // Scanned per joined statement so a parenthesised or backslash-continued
    // import list is seen whole.
    for (const statement of logicalLines) {
      if (!statement) continue;
      let importMatch: RegExpExecArray | null;
      importStatement.lastIndex = 0;
      while ((importMatch = importStatement.exec(statement)) !== null) {
        importMatch[1].split(',').forEach(addModule);
      }
      fromImportStatement.lastIndex = 0;
      while ((importMatch = fromImportStatement.exec(statement)) !== null) {
        // `from . import helper` has no module root; name what it pulls in, so
        // a relative import is reported like any other.
        if (rootModule(importMatch[1])) addModule(importMatch[1]);
        else this.pythonImportBindings(statement).forEach(name => importedModules.add(name));
      }
    }
    for (const moduleName of importedModules) {
      warnings.push({
        // 'security' so the minimal/runtime profiles keep it: a blocked import
        // rejects the whole node before it runs.
        type: 'security',
        property: 'pythonCode',
        message: `import ${moduleName} is blocked unless this instance allowlists the module (n8n Cloud allows none)`,
        suggestion: `Write import-free code, or confirm '${moduleName}' is allowlisted on the Python task runner first`
      });
    }

    // Class definitions
    if (/^[ \t]*class[ \t]+\w/m.test(scan)) {
      errors.push({
        type: 'invalid_value',
        property: 'pythonCode',
        message: 'class definitions fail in the sandbox: __build_class__ not found',
        fix: 'Use dicts and plain functions instead of a class'
      });
    }

    // Denied builtins. A local `def type(...)` or `type = ...` shadows the
    // builtin, so the call resolves to the user's own definition.
    for (const [name, fix] of Object.entries(scopeIndex ? this.PYTHON_DENIED_BUILTINS : {})) {
      // A bare reference raises NameError too (`fn = eval`, `return type`).
      // Excluded: attribute access (`obj.type`) via the lookbehind, and a
      // keyword-argument name (`f(type=1)`) via the lookahead.
      if (this.pythonHasUnboundReference(scopeIndex!, name, new RegExp(`(?<![\\w.])${name}\\b(?![ \\t]*=(?!=))`))) {
        errors.push({
          type: 'invalid_value',
          property: 'pythonCode',
          message: `${name}() is denied in the Python sandbox and raises NameError`,
          fix
        });
      }
    }

    // Dunder access is rejected statically, before the code runs. A format
    // string reaches it too ("{0.__class__}".format(x)), so the replacement
    // fields of every string literal are checked as well.
    const formatFields = this.withinCapOrRaw(code, c => this.stripPythonStringsAndComments(c, true, true));
    if (/\.__\w+__/.test(scan) || /\b__class__\b/.test(scan) || /\b__builtins__\b/.test(scan)
        || /(?<![\w.])__import__[ \t]*\(/.test(scan)
        || this.pythonFormatsDunder(formatFields)) {
      errors.push({
        type: 'invalid_value',
        property: 'pythonCode',
        message: 'Dunder access is rejected before the code runs: Security violations detected',
        fix: 'Remove __class__, __import__ and other dunder access'
      });
    }

    // A `global` inside a nested function never binds, because the user's code
    // already runs inside a wrapper function. A top-level `global` is harmless.
    if (scopeIndex && this.pythonHasGlobalInsideFunction(scopeIndex)) {
      errors.push({
        type: 'invalid_value',
        property: 'pythonCode',
        message: 'global does not work: your code runs inside a wrapper function',
        fix: 'Use nonlocal instead of global'
      });
    }

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
    mode: string = 'runOnceForAllItems',
    modeIsKnown: boolean = true
  ): void {
    // Detect a *real* top-level return. For JS, scan the stripped view so a
    // return that only appears inside a comment, string, or nested function
    // body (e.g. `// return "x"`) does not satisfy the "must return data" check.
    // Skip the strip for very large code (mirrors hasTopLevelPrimitiveReturn).
    const returnScanCode = language === 'javaScript'
      ? this.withinCapOrRaw(code, c => this.stripNestedJavaScriptFunctionBodies(c))
      : code;
    const hasReturn = /return\s+/.test(returnScanCode);

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

      // NOTE: a bare object return (e.g. `return {a: 1}`) is intentionally NOT
      // flagged: n8n auto-wraps a single returned object into [{json: {...}}]
      // in runOnceForAllItems mode (verified against a live n8n instance).

      if (!isRunOncePerItem && this.hasTopLevelPrimitiveReturn(code)) {
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
    
    // Python return format validation. Helper-function bodies are blanked so a
    // `return None` inside a helper is not read as the node's return value.
    // Both shapes depend on the mode, so both are skipped when the mode is an
    // expression resolved at runtime.
    if (language === 'python' && modeIsKnown) {
      const isRunOncePerItem = mode === 'runOnceForEachItem';

      if (isRunOncePerItem) {
        // A list return in each-item mode fails with
        // "A 'json' property isn't a dictionary [item 0]".
        const strippedTopLevel = this.withinCapOrRaw(
          code, c => this.stripPythonFunctionBodies(this.stripPythonStringsAndComments(c))
        );
        // Transparent parentheses don't change the shape: `return ([...])` is
        // still a list, and fails the same way.
        const parenthesisedList = (inner: string) =>
          /^\[[\s\S]*\]$/.test(inner) || inner === '_items' || /^list[ \t]*\(/.test(inner);

        if (this.pythonReturnsWholeGroup(strippedTopLevel, /^[ \t]*return[ \t]+\[/)
            || this.pythonReturnsWholeGroup(strippedTopLevel, /^[ \t]*return[ \t]+list[ \t]*\(/)
            || this.pythonReturnsWholeGroup(strippedTopLevel, /^[ \t]*return[ \t]*\(/, parenthesisedList)
            || /^[ \t]*return[ \t]+_items[ \t;]*$/m.test(strippedTopLevel)) {
          errors.push({
            type: 'invalid_value',
            property: 'pythonCode',
            message: 'Returning a list in "Run Once for Each Item" mode fails: a \'json\' property isn\'t a dictionary',
            fix: 'Return a single dict: return {"json": {"value": your_data}}'
          });
        }
      } else {
        // A single dict and a list of plain dicts are both auto-wrapped by
        // native Python, so only primitive returns are rejected here. String
        // delimiters are kept so `return "x"` (and `return f"x"`) is still
        // visible after comments and string contents are blanked.
        const topLevel = this.withinCapOrRaw(
          code, c => this.stripPythonFunctionBodies(this.stripPythonStringsAndComments(c, true))
        );
        if (/return\s+(?:(?:True|False|None)\b|[+-]?(?:\d|\.\d)|[rbfu]{0,2}['"])/m.test(topLevel)) {
          errors.push({
            type: 'invalid_value',
            property: 'pythonCode',
            message: 'Cannot return primitive values directly',
            fix: 'Return list of dicts: return [{"json": {"value": your_data}}]'
          });
        }
      }
    }
  }

  /**
   * True when a `return` whose head matches `prefix` returns that bracket group
   * whole - the group's matching close ends the statement. `return [...][0]`
   * returns an element, not a list, so it does not count.
   *
   * `prefix` must end at the opening bracket and be anchored at line start.
   */
  private static pythonReturnsWholeGroup(
    scan: string,
    prefix: RegExp,
    innerTest?: (inner: string) => boolean
  ): boolean {
    const matcher = new RegExp(prefix.source, 'gm');
    let budget = MAX_RETURN_TOTAL_SCAN;
    let match: RegExpExecArray | null;

    while ((match = matcher.exec(scan)) !== null) {
      // The prefix ends at the opening bracket.
      let position = match.index + match[0].length - 1;
      const limit = Math.min(scan.length, position + MAX_RETURN_LOOKAHEAD, position + budget);
      let depth = 0;
      let closed = -1;

      for (; position < limit; position++) {
        const char = scan[position];
        if (char === '[' || char === '(' || char === '{') depth++;
        else if (char === ']' || char === ')' || char === '}') {
          depth--;
          if (depth === 0) { closed = position; break; }
        }
      }
      budget -= position - (match.index + match[0].length - 1);
      if (budget <= 0) return false;
      if (closed === -1) continue;

      // Whatever follows on that line decides it: `return [...]` returns the
      // list, `return [...][0]` returns one element.
      const lineEnd = scan.indexOf('\n', closed);
      const rest = scan.slice(closed + 1, lineEnd === -1 ? scan.length : lineEnd);
      if (rest.replace(/;+[ \t]*$/, '').trim() !== '') continue;
      if (!innerTest) return true;

      const opened = match.index + match[0].length - 1;
      if (innerTest(scan.slice(opened + 1, closed).trim())) return true;
    }

    return false;
  }

  /**
   * Blanks the body of every `def` / `class` block (indentation-based) while
   * keeping the line count, so return-shape checks only see the node's own
   * top-level returns.
   */
  private static stripPythonFunctionBodies(code: string): string {
    const lines = code.split('\n');
    const result: string[] = [];
    let blockIndent: number | null = null;
    // A `def` header can span lines; its closing `):` is usually unindented,
    // which would otherwise be read as the end of the body. The header ends at
    // the first `:` outside brackets, so `def f(): return 1` ends on its own
    // line even though it does not END with a colon.
    let header: string | null = null;

    for (const line of lines) {
      const indentMatch = line.match(/^[ \t]*/);
      const indent = indentMatch ? indentMatch[0].length : 0;
      const isBlank = line.trim() === '';

      if (header !== null) {
        header += `\n${line}`;
        result.push('');
        if (this.pythonHeaderColonIndex(header) !== -1) header = null;
        continue;
      }

      if (blockIndent !== null) {
        if (isBlank || indent > blockIndent) {
          result.push('');
          continue;
        }
        blockIndent = null;
      }

      if (/^[ \t]*(?:async[ \t]+)?(?:def|class)[ \t]+\w/.test(line)) {
        blockIndent = indent;
        header = this.pythonHeaderColonIndex(line) === -1 ? line : null;
        result.push('');
        continue;
      }

      result.push(line);
    }

    return result.join('\n');
  }

  private static hasTopLevelPrimitiveReturn(code: string): boolean {
    const topLevelCode = this.withinCapOrRaw(code, c => this.stripNestedJavaScriptFunctionBodies(c));
    return JS_PRIMITIVE_RETURN_RE.test(topLevelCode);
  }

  /**
   * Blanks JavaScript string literals, comments and regex literals while
   * KEEPING function-body code. Template-literal string parts are blanked but
   * `${...}` interpolation code is preserved. Used by the n8n-variable
   * heuristics so `{{...}}`, bare `$` and bare `helpers.` are detected inside
   * `.map(item => { ... })` callbacks, not just at the top level.
   */
  private static stripStringsCommentsRegex(code: string): string {
    return this.stripNestedJavaScriptFunctionBodies(code, false);
  }

  private static stripNestedJavaScriptFunctionBodies(code: string, blankFunctionBodies: boolean = true): string {
    let result = '';
    let braceDepth = 0;
    const functionBodyDepths: number[] = [];
    // Brace depths at which a template-literal `${...}` interpolation was
    // opened. Interpolation content is real code (and may nest further
    // templates), so the scanner re-enters code state until the matching `}`.
    const templateInterpolationDepths: number[] = [];
    let state: 'code' | 'single' | 'double' | 'template' | 'lineComment' | 'blockComment' | 'regex' = 'code';
    // Tracks whether we are inside a `[...]` character class while in regex state,
    // so an unescaped `/` inside the class does not prematurely end the literal.
    let inRegexClass = false;

    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      const next = code[i + 1];
      const inFunctionBody = functionBodyDepths.length > 0;

      if (state === 'lineComment') {
        result += char === '\n' ? '\n' : ' ';
        if (char === '\n') state = 'code';
        continue;
      }

      if (state === 'blockComment') {
        result += char === '\n' ? '\n' : ' ';
        if (char === '*' && next === '/') {
          result += ' ';
          i++;
          state = 'code';
        }
        continue;
      }

      if (state === 'single' || state === 'double' || state === 'template') {
        if (state === 'template' && char === '$' && next === '{') {
          result += '  ';
          i++;
          braceDepth++;
          templateInterpolationDepths.push(braceDepth);
          state = 'code';
          continue;
        }
        result += char === '\n' ? '\n' : ' ';
        if (char === '\\') {
          if (next) {
            result += next === '\n' ? '\n' : ' ';
            i++;
          }
          continue;
        }
        if (
          (state === 'single' && char === "'") ||
          (state === 'double' && char === '"') ||
          (state === 'template' && char === '`')
        ) {
          state = 'code';
        }
        continue;
      }

      if (state === 'regex') {
        // A real regex literal never spans a raw newline; hitting one means we
        // misclassified a division operator — bail back to code on this line.
        if (char === '\n') {
          state = 'code';
          result += '\n';
          continue;
        }
        result += ' ';
        if (char === '\\') {
          if (next !== undefined) {
            result += ' ';
            i++;
          }
          continue;
        }
        if (char === '[') inRegexClass = true;
        else if (char === ']') inRegexClass = false;
        else if (char === '/' && !inRegexClass) state = 'code';
        continue;
      }

      if (char === '/' && next === '/') {
        result += '  ';
        i++;
        state = 'lineComment';
        continue;
      }

      if (char === '/' && next === '*') {
        result += '  ';
        i++;
        state = 'blockComment';
        continue;
      }

      // Regex literal (not division). Blank its contents so `{`/`}` inside it
      // (e.g. str.replace(/}/g, '')) do not skew brace depth.
      if (char === '/' && this.regexLiteralStartsHere(code, i)) {
        result += ' ';
        inRegexClass = false;
        state = 'regex';
        continue;
      }

      if (char === "'") {
        result += (blankFunctionBodies && inFunctionBody) ? ' ' : char;
        state = 'single';
        continue;
      }

      if (char === '"') {
        result += (blankFunctionBodies && inFunctionBody) ? ' ' : char;
        state = 'double';
        continue;
      }

      if (char === '`') {
        result += (blankFunctionBodies && inFunctionBody) ? ' ' : char;
        state = 'template';
        continue;
      }

      if (char === '{') {
        if (this.startsJavaScriptFunctionBody(code, i)) {
          functionBodyDepths.push(braceDepth + 1);
        }
        braceDepth++;
        result += (blankFunctionBodies && functionBodyDepths.length > 0) ? ' ' : char;
        continue;
      }

      if (char === '}') {
        if (templateInterpolationDepths[templateInterpolationDepths.length - 1] === braceDepth) {
          templateInterpolationDepths.pop();
          braceDepth = Math.max(0, braceDepth - 1);
          result += ' ';
          state = 'template';
          continue;
        }
        result += (blankFunctionBodies && inFunctionBody) ? ' ' : char;
        if (functionBodyDepths[functionBodyDepths.length - 1] === braceDepth) {
          functionBodyDepths.pop();
        }
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }

      result += (blankFunctionBodies && inFunctionBody) ? (char === '\n' ? '\n' : ' ') : char;
    }

    return result;
  }

  /** Is the identifier run ending at `end` (exclusive) an f-string prefix? */
  private static isFStringPrefix(code: string, end: number): boolean {
    let start = end;
    while (start > 0 && /[A-Za-z]/.test(code[start - 1])) start--;
    if (start === end || end - start > 2) return false;
    if (start > 0 && /[\w$]/.test(code[start - 1])) return false;
    const prefix = code.slice(start, end);
    return /^[rbuRBU]?[fF]$|^[fF][rbuRBU]?$/.test(prefix);
  }

  /**
   * Blanks Python string literals (single/double/triple-quoted) and `#` line
   * comments so heuristic substring checks don't fire on string content.
   * Newlines are preserved to keep the view line-aligned with the source.
   *
   * An f-string's `{...}` replacement fields ARE code and are kept, so
   * `f"{_input.all()}"` is still seen by the rules.
   *
   * `keepDelimiters` echoes the quote characters instead of blanking them, so a
   * caller can still tell that a string was there (e.g. `return "x"`) while its
   * content and any comments are gone. `keepContent` echoes the literal whole,
   * blanking comments only - used to inspect format strings.
   */
  private static stripPythonStringsAndComments(
    code: string,
    keepDelimiters: boolean = false,
    keepContent: boolean = false
  ): string {
    let result = '';
    let i = 0;
    while (i < code.length) {
      const char = code[i];

      if (char === '#') {
        while (i < code.length && code[i] !== '\n') {
          result += ' ';
          i++;
        }
        continue;
      }

      if (char === "'" || char === '"') {
        const triple = code.slice(i, i + 3) === char.repeat(3);
        const delim = triple ? char.repeat(3) : char;
        const blankedDelim = keepDelimiters || keepContent ? delim : ' '.repeat(delim.length);
        const isFString = !keepContent && this.isFStringPrefix(code, i);
        result += blankedDelim;
        i += delim.length;
        while (i < code.length) {
          if (code[i] === '\\') {
            result += code[i + 1] === '\n' ? ' \n' : '  ';
            i += 2;
            continue;
          }
          if (code.slice(i, i + delim.length) === delim) {
            result += blankedDelim;
            i += delim.length;
            break;
          }
          // An f-string replacement field holds real code. `{{` is a literal
          // brace, not a field. A string literal nested inside the field is
          // still data, so its content is blanked like any other.
          if (isFString && code[i] === '{' && code[i + 1] !== '{') {
            let depth = 0;
            let nestedQuote = '';
            do {
              const current = code[i];
              if (nestedQuote) {
                if (current === nestedQuote) nestedQuote = '';
                result += current === '\n' ? '\n' : ' ';
                i++;
                continue;
              }
              if (current === "'" || current === '"') nestedQuote = current;
              else if (current === '{') depth++;
              else if (current === '}') depth--;
              result += current === '\n' ? '\n' : current;
              i++;
            } while (i < code.length && depth > 0);
            continue;
          }
          if (isFString && code[i] === '{' && code[i + 1] === '{') {
            result += '  ';
            i += 2;
            continue;
          }
          // A single-quoted (non-triple) string cannot span a raw newline;
          // treat it as terminated to stay in sync on malformed code.
          if (code[i] === '\n' && !triple) {
            result += '\n';
            i++;
            break;
          }
          result += keepContent || code[i] === '\n' ? code[i] : ' ';
          i++;
        }
        continue;
      }

      result += char;
      i++;
    }
    return result;
  }

  // Identifiers that look like `name(...) {` but are control flow, not function bodies.
  // `await` covers `for await (... of ...) {` (the head's trailing word is `await`).
  private static readonly NON_FUNCTION_HEADS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'with', 'await',
  ]);

  private static startsJavaScriptFunctionBody(code: string, openBraceIndex: number): boolean {
    // Arrow function: ... => {
    const prefix = code.slice(Math.max(0, openBraceIndex - 500), openBraceIndex);
    if (/=>\s*$/.test(prefix)) return true;

    // function declarations/expressions and method shorthand look like
    // `<keyword/name>(<params>) {`. The param list can contain nested parens
    // (e.g. a default value that calls another function:
    // `function f(x = a.b()) {`), so locate the matching `(` by scanning
    // backward with a paren counter rather than a greedy `\([^)]*\)` regex
    // that stops at the first inner `)`.
    let i = openBraceIndex - 1;
    // Skip whitespace and any block comment between the `)` and the `{`
    // (e.g. `function f() /* note */ {`).
    while (i >= 0) {
      if (/\s/.test(code[i])) { i--; continue; }
      if (code[i] === '/' && i > 0 && code[i - 1] === '*') {
        i -= 2; // step onto the char before the closing `*/`
        while (i >= 1 && !(code[i - 1] === '/' && code[i] === '*')) i--;
        i -= 2; // step before the opening `/*`
        continue;
      }
      break;
    }
    if (i < 0 || code[i] !== ')') return false;

    // Bound the backward walk: a real parameter list is short, so cap the scan
    // distance. Without this, adversarial input (many unmatched `) {`) would
    // make each brace walk to the start of the file — quadratic overall.
    const scanFloor = Math.max(0, i - MAX_PARAM_SCAN);
    let depth = 0;
    let j = i;
    for (; j >= scanFloor; j--) {
      const c = code[j];
      if (c === ')') depth++;
      else if (c === '(') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) return false; // unbalanced, or matching '(' beyond the scan window

    // `head` is the text immediately before the matching `(` (the name area).
    const head = code.slice(Math.max(0, j - 60), j);

    // function declaration/expression, incl. generators: function, function*,
    // async function, function gen.
    if (/(?:^|[^\w$])(?:async\s+)?function\s*\*?(?:\s+[\w$]+)?\s*$/.test(head)) return true;

    // Method shorthand / class method / getter-setter / (async) generator method.
    // Exclude control-flow keywords whose head also looks like `name(`.
    const methodHead = /(?:^|[^\w$.])(?:(?:async|get|set)\s+)?\*?\s*([\w$]+)\s*$/.exec(head);
    if (methodHead && !this.NON_FUNCTION_HEADS.has(methodHead[1])) return true;

    return false;
  }

  // Keywords after which a `/` begins a regex literal rather than division.
  private static readonly REGEX_PRECEDING_KEYWORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'do', 'else', 'yield', 'await', 'case', 'throw',
  ]);

  /**
   * Decide whether a `/` at `slashIndex` (already known not to start `//` or `/*`)
   * begins a regex literal vs. a division operator, by inspecting the previous
   * significant token. Used only to keep brace counting balanced, so erring toward
   * "regex" is bounded by the newline bail-out in the scanner.
   */
  private static regexLiteralStartsHere(code: string, slashIndex: number): boolean {
    let j = slashIndex - 1;
    while (j >= 0 && /\s/.test(code[j])) j--;
    if (j < 0) return true; // start of input → regex
    const c = code[j];
    // After a value (identifier / number / `)` / `]` / `.` / a closing string or
    // template quote), `/` is division...
    if (/[\w$)\].'"`]/.test(c)) {
      // ...unless the trailing word is a keyword that precedes a regex.
      if (/[\w$]/.test(c)) {
        let k = j;
        while (k >= 0 && /[\w$]/.test(code[k])) k--;
        const word = code.slice(k + 1, j + 1);
        return this.REGEX_PRECEDING_KEYWORDS.has(word);
      }
      return false;
    }
    return true; // after ( , = : [ ! & | ? { } ; etc. → regex
  }
  
  private static validateN8nVariables(
    code: string,
    language: string,
    warnings: ValidationWarning[],
    suggestions: string[],
    errors: ValidationError[],
    mode: string = 'runOnceForAllItems'
  ): void {
    // Several heuristics below scan a stripped view (string/comment/regex
    // contents blanked) so tokens inside string literals cannot trip them.
    // Function-body code is KEPT so the checks also see inside `.map()`/
    // `.filter()` callbacks. Falls back to the raw code above the length cap
    // (mirrors other checks).
    const scanView = this.withinCapOrRaw(code, c => language === 'javaScript'
      ? this.stripStringsCommentsRegex(c)
      : this.stripPythonStringsAndComments(c));

    // Check if code accesses input data. `$(` covers the $('Node Name')
    // accessor; static/workflow context references mark intentional
    // no-input (generator-style) nodes.
    // Python: the legacy names count as "references input" so code using them
    // gets the removed-global error only, not an extra no-input warning.
    const inputPatterns = language === 'javaScript'
      ? ['items', '$input', '$json', '$node', '$prevNode', '$(', '$getWorkflowStaticData', '$workflow', '$execution', '$vars']
      : ['_items', '_item', '_input', '_json'];

    // Scan the stripped view so a pattern inside a string literal or comment
    // (e.g. a log message mentioning "$json") doesn't count as input access;
    // template-literal interpolation code is preserved in the view.
    const usesInput = inputPatterns.some(pattern => scanView.includes(pattern));

    if (!usesInput && code.length > 50) {
      const pythonSuggestion = mode === 'runOnceForEachItem'
        ? 'Access input with: _item (the current item dict)'
        : 'Access input with: _items (the list of item dicts)';
      warnings.push({
        type: 'best_practice',
        message: 'Code doesn\'t reference input data',
        suggestion: language === 'javaScript'
          ? 'Access input with: items, $input.all(), or $json (single-item mode)'
          : pythonSuggestion
      });
    }

    // Check for expression syntax in Code nodes. Scans the stripped view:
    // {{ }} inside string literals (prompts, payloads, mustache templates)
    // is valid code that n8n runs fine.
    if (scanView.includes('{{') && scanView.includes('}}')) {
      errors.push({
        type: 'invalid_value',
        property: language === 'python' ? 'pythonCode' : 'jsCode',
        message: 'Expression syntax {{...}} is not valid in Code nodes',
        fix: 'Use regular JavaScript/Python syntax without double curly braces'
      });
    }
    
    // Check for wrong $node syntax. JavaScript only: `$('Node Name')` has no
    // Python equivalent, so the suggestion would be wrong advice there.
    if (language === 'javaScript' && code.includes('$node[')) {
      warnings.push({
        type: 'invalid_value',
        property: 'jsCode',
        message: 'Use $(\'Node Name\') instead of $node[\'Node Name\'] in Code nodes',
        suggestion: 'Replace $node[\'NodeName\'] with $(\'NodeName\')'
      });
    }

    // Check for expression-only functions. JavaScript only: `$now()` cannot
    // appear in Python, and `.keys()` is an ordinary dict method there.
    if (language === 'javaScript') {
      const expressionOnlyFunctions = ['$now()', '$today()', '$tomorrow()', '.unique()', '.pluck(', '.keys()', '.hash('];
      expressionOnlyFunctions.forEach(func => {
        if (code.includes(func)) {
          warnings.push({
            type: 'invalid_value',
            property: 'jsCode',
            message: `${func} is an expression-only function not available in Code nodes`,
            suggestion: 'See Code node documentation for alternatives'
          });
        }
      });
    }

    // Check for common variable mistakes
    if (language === 'javaScript') {
      // Using $ without proper variable. Scans the stripped view so `$` in
      // regex literals (end anchors like /x$/) and string content can't trip it.
      if (/\$(?![a-zA-Z_(])/.test(scanView) && !scanView.includes('${')) {
        warnings.push({
          type: 'best_practice',
          message: 'Invalid $ usage detected',
          suggestion: 'n8n variables start with $: $json, $input, $node, $workflow, $execution'
        });
      }

      // Only flag a truly bare `helpers.` — `this.helpers.*` and `$helpers.*`
      // are valid runtime accessors, and any `x.helpers.` is member access.
      if (/(?<![.\w$])helpers\s*\./.test(scanView)) {
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
    
    // JMESPath queries passed as string literals get the same static checks as `$jmespath()`
    // inside `{{ }}` expressions (src/utils/jmespath-checks.ts); calls inside strings or comments
    // are not read, and a query held in a variable is not followed. Reversed arguments stay a
    // warning here: a Code node surfaces the runtime failure, unlike an expression, which
    // resolves to null. Python has no `_jmespath` on n8n 2.x; the Python rules report it as a
    // removed global.
    if (language === 'javaScript' && code.length <= MAX_CODE_LENGTH && code.includes('$jmespath')) {
      const calls = findJmespathCalls(code);
      for (const call of calls) {
        if (call.queryIsFirstArgument) {
          warnings.push({
            type: 'invalid_value',
            property: 'jsCode',
            message: 'Code node $jmespath has reversed parameter order: $jmespath(data, query)',
            suggestion: 'Use: $jmespath(dataObject, "query.path") not $jmespath("query.path", dataObject)'
          });
          continue;
        }
        if (call.query === undefined) continue;
        for (const finding of checkJmespathQuery(call.query)) {
          if (finding.severity === 'error') {
            errors.push({ type: 'invalid_value', property: 'jsCode', message: finding.message, fix: finding.fix });
          } else {
            warnings.push({ type: 'invalid_value', property: 'jsCode', message: finding.message, suggestion: finding.fix });
          }
        }
      }

      if (calls.length > 0) {
        suggestions.push(
          'JMESPath in n8n requires backticks around numeric literals in filters: [?age >= `18`]'
        );
      }
    }
  }
  
  private static validateCodeSecurity(
    code: string,
    language: string,
    warnings: ValidationWarning[]
  ): void {
    // Scan the string/comment/regex-stripped view so tokens inside string
    // literals (e.g. a prompt mentioning "eval(") don't warn — security-type
    // warnings survive every profile, so raw-string scanning is pure noise.
    // Template-literal interpolation code is preserved in the view.
    const securityView = language === 'javaScript'
      ? this.stripStringsCommentsRegex(code)
      : this.stripPythonStringsAndComments(code);
    // Security checks. The lookbehind excludes member access (regex.exec(),
    // obj.eval()) and identifiers that merely end in the keyword
    // (getUserFunction(), retrieval()).
    // Python patterns live in validatePythonCode: eval/exec are denied builtins
    // there (reported as errors) and every import is reported against the
    // allowlist, so repeating them here would only duplicate messages.
    const dangerousPatterns = language !== 'javaScript' ? [] : [
      { pattern: /(?<![.\w$])eval\s*\(/, message: 'Avoid eval() - it\'s a security risk' },
      { pattern: /(?<![.\w$])Function\s*\(/, message: 'Avoid Function constructor - use regular functions' },
      // Global-object forms (window.eval(), globalThis.Function()) slip past the
      // member-access lookbehind above but are the same dynamic-eval sinks.
      { pattern: /(?:window|globalThis)\s*\.\s*eval\s*\(/, message: 'Avoid eval() - it\'s a security risk' },
      { pattern: /(?:window|globalThis)\s*\.\s*Function\s*\(/, message: 'Avoid Function constructor - use regular functions' },
      { pattern: /(?<![.\w$])exec\s*\(/, message: 'Avoid exec() - it\'s a security risk' },
      { pattern: /process\.env/, message: 'Limited environment access in Code nodes' },
      { pattern: /import\s+\*/, message: 'Avoid import * - be specific about imports' }
    ];
    
    dangerousPatterns.forEach(({ pattern, message }) => {
      if (pattern.test(securityView)) {
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
    
    // File system access warning. Requires actual module usage (require/import
    // of fs/path/child_process, or fs./child_process. member access) — the bare
    // words are extremely common as data field names (e.g. item.json.path).
    const fsModuleUsagePatterns = [
      /require\s*\(\s*['"`](?:node:)?(?:fs|path|child_process)['"`]\s*\)/,
      /\bimport\b[^;\n]*\bfrom\s*['"](?:node:)?(?:fs|path|child_process)['"]/,
      /\bimport\s*\(\s*['"`](?:node:)?(?:fs|path|child_process)['"`]\s*\)/,
      /(?<![.\w$])(?:fs|child_process)\s*\.\s*\w/
    ];
    if (fsModuleUsagePatterns.some(pattern => pattern.test(code))) {
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

    // Validate jsonOutput when present (used in JSON mode or when directly setting JSON).
    // Expression values ('=...' prefix or {{ }} interpolation) resolve to JSON
    // at runtime and cannot be statically parsed.
    const jsonOutputIsExpression = typeof config.jsonOutput === 'string'
      && (config.jsonOutput.trim().startsWith('=') || config.jsonOutput.includes('{{'));
    if (config.jsonOutput !== undefined && config.jsonOutput !== null && config.jsonOutput !== ''
        && !jsonOutputIsExpression) {
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
