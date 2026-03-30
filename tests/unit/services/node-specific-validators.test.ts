import { describe, it, expect, beforeEach } from 'vitest';
import { NodeSpecificValidators, NodeValidationContext } from '@/services/node-specific-validators';
import { ValidationError, ValidationWarning } from '@/services/config-validator';

describe('NodeSpecificValidators', () => {
  let context: NodeValidationContext;

  beforeEach(() => {
    context = {
      config: {},
      errors: [],
      warnings: [],
      suggestions: [],
      autofix: {}
    };
  });

  describe('validateSlack', () => {
    describe('message send operation', () => {
      beforeEach(() => {
        context.config = {
          resource: 'message',
          operation: 'send'
        };
      });

      it('should require channel for sending messages', () => {
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.errors).toHaveLength(2); // channel and text errors
        expect(context.errors[0]).toMatchObject({
          type: 'missing_required',
          property: 'channel',
          message: 'Channel is required to send a message'
        });
      });

      it('should accept channelId as alternative to channel', () => {
        context.config.channelId = 'C1234567890';
        context.config.text = 'Hello';
        
        NodeSpecificValidators.validateSlack(context);
        
        const channelErrors = context.errors.filter(e => e.property === 'channel');
        expect(channelErrors).toHaveLength(0);
      });

      it('should require message content', () => {
        context.config.channel = '#general';
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'text',
          message: 'Message content is required - provide text, blocks, or attachments',
          fix: 'Add text field with your message content'
        });
      });

      it('should accept blocks as alternative to text', () => {
        context.config.channel = '#general';
        context.config.blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Hello' } }];
        
        NodeSpecificValidators.validateSlack(context);
        
        const textErrors = context.errors.filter(e => e.property === 'text');
        expect(textErrors).toHaveLength(0);
      });

      it('should accept attachments as alternative to text', () => {
        context.config.channel = '#general';
        context.config.attachments = [{ text: 'Attachment text' }];
        
        NodeSpecificValidators.validateSlack(context);
        
        const textErrors = context.errors.filter(e => e.property === 'text');
        expect(textErrors).toHaveLength(0);
      });

      it('should warn about text exceeding character limit', () => {
        context.config.channel = '#general';
        context.config.text = 'a'.repeat(40001);
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.warnings).toContainEqual({
          type: 'inefficient',
          property: 'text',
          message: 'Message text exceeds Slack\'s 40,000 character limit',
          suggestion: 'Split into multiple messages or use a file upload'
        });
      });

      it('should warn about missing threadTs when replying to thread', () => {
        context.config.channel = '#general';
        context.config.text = 'Reply';
        context.config.replyToThread = true;
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.warnings).toContainEqual({
          type: 'missing_common',
          property: 'threadTs',
          message: 'Thread timestamp required when replying to thread',
          suggestion: 'Set threadTs to the timestamp of the thread parent message'
        });
      });

      it('should suggest linkNames for mentions', () => {
        context.config.channel = '#general';
        context.config.text = 'Hello @user';
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.suggestions).toContain('Set linkNames=true to convert @mentions to user links');
        expect(context.autofix.linkNames).toBe(true);
      });
    });

    describe('message update operation', () => {
      beforeEach(() => {
        context.config = {
          resource: 'message',
          operation: 'update'
        };
      });

      it('should require timestamp for updating messages', () => {
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'ts',
          message: 'Message timestamp (ts) is required to update a message',
          fix: 'Provide the timestamp of the message to update'
        });
      });

      it('should require channel for updating messages', () => {
        context.config.ts = '1234567890.123456';
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'channel',
          message: 'Channel is required to update a message',
          fix: 'Provide the channel where the message exists'
        });
      });
    });

    describe('message delete operation', () => {
      beforeEach(() => {
        context.config = {
          resource: 'message',
          operation: 'delete'
        };
      });

      it('should require timestamp for deleting messages', () => {
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'ts',
          message: 'Message timestamp (ts) is required to delete a message',
          fix: 'Provide the timestamp of the message to delete'
        });
      });

      it('should warn about permanent deletion', () => {
        context.config.ts = '1234567890.123456';
        context.config.channel = '#general';
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          message: 'Message deletion is permanent and cannot be undone',
          suggestion: 'Consider archiving or updating the message instead if you need to preserve history'
        });
      });
    });

    describe('channel create operation', () => {
      beforeEach(() => {
        context.config = {
          resource: 'channel',
          operation: 'create'
        };
      });

      it('should require channel name', () => {
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'name',
          message: 'Channel name is required',
          fix: 'Provide a channel name (lowercase, no spaces, 1-80 characters)'
        });
      });

      it('should validate channel name format', () => {
        context.config.name = 'Test Channel';
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'name',
          message: 'Channel names cannot contain spaces',
          fix: 'Use hyphens or underscores instead of spaces'
        });
      });

      it('should require lowercase channel names', () => {
        context.config.name = 'TestChannel';
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'name',
          message: 'Channel names must be lowercase',
          fix: 'Convert the channel name to lowercase'
        });
      });

      it('should validate channel name length', () => {
        context.config.name = 'a'.repeat(81);
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'name',
          message: 'Channel name exceeds 80 character limit',
          fix: 'Shorten the channel name'
        });
      });
    });

    describe('user operations', () => {
      it('should require user identifier for get operation', () => {
        context.config = {
          resource: 'user',
          operation: 'get'
        };
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'user',
          message: 'User identifier required - use email, user ID, or username',
          fix: 'Set user to an email like "john@example.com" or user ID like "U1234567890"'
        });
      });
    });

    describe('error handling', () => {
      it('should suggest error handling for Slack operations', () => {
        context.config = {
          resource: 'message',
          operation: 'send',
          channel: '#general',
          text: 'Hello'
        };
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'Slack API can have rate limits and transient failures',
          suggestion: 'Add onError: "continueRegularOutput" with retryOnFail for resilience'
        });
        
        expect(context.autofix).toMatchObject({
          onError: 'continueRegularOutput',
          retryOnFail: true,
          maxTries: 2,
          waitBetweenTries: 3000
        });
      });

      it('should warn about deprecated continueOnFail', () => {
        context.config = {
          resource: 'message',
          operation: 'send',
          channel: '#general',
          text: 'Hello',
          continueOnFail: true
        };
        
        NodeSpecificValidators.validateSlack(context);
        
        expect(context.warnings).toContainEqual({
          type: 'deprecated',
          property: 'continueOnFail',
          message: 'continueOnFail is deprecated. Use onError instead',
          suggestion: 'Replace with onError: "continueRegularOutput"'
        });
      });
    });
  });

  describe('validateGoogleSheets', () => {
    describe('common validations', () => {
      it('should require range for read operation (sheetId comes from credentials)', () => {
        context.config = {
          operation: 'read'
        };

        NodeSpecificValidators.validateGoogleSheets(context);

        // NOTE: sheetId validation was removed because it's provided by credentials, not configuration
        // The actual error is missing range, which is checked first
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'range',
          message: 'Range is required for read operation',
          fix: 'Specify range like "Sheet1!A:B" or "Sheet1!A1:B10"'
        });
      });

      it('should accept documentId as alternative to sheetId', () => {
        context.config = {
          operation: 'read',
          documentId: '1234567890',
          range: 'Sheet1!A:B'
        };
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        const sheetIdErrors = context.errors.filter(e => e.property === 'sheetId');
        expect(sheetIdErrors).toHaveLength(0);
      });
    });

    describe('append operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'append',
          sheetId: '1234567890'
        };
      });

      it('should require range or columns for append', () => {
        NodeSpecificValidators.validateGoogleSheets(context);

        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'range',
          message: 'Range or columns mapping is required for append operation',
          fix: 'Specify range like "Sheet1!A:B" OR use columns with mappingMode'
        });
      });

      it('should suggest valueInputMode', () => {
        context.config.range = 'Sheet1!A:B';
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        expect(context.warnings).toContainEqual({
          type: 'missing_common',
          property: 'options.valueInputMode',
          message: 'Consider setting valueInputMode for proper data formatting',
          suggestion: 'Use "USER_ENTERED" to parse formulas and dates, or "RAW" for literal values'
        });
        
        expect(context.autofix.options).toMatchObject({
          valueInputMode: 'USER_ENTERED'
        });
      });
    });

    describe('read operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'read',
          sheetId: '1234567890'
        };
      });

      it('should require range for read', () => {
        NodeSpecificValidators.validateGoogleSheets(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'range',
          message: 'Range is required for read operation',
          fix: 'Specify range like "Sheet1!A:B" or "Sheet1!A1:B10"'
        });
      });

      it('should suggest data structure option', () => {
        context.config.range = 'Sheet1!A:B';
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        expect(context.suggestions).toContain('Consider setting options.dataStructure to "object" for easier data manipulation');
      });
    });

    describe('update operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'update',
          sheetId: '1234567890'
        };
      });

      it('should require range for update', () => {
        NodeSpecificValidators.validateGoogleSheets(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'range',
          message: 'Range is required for update operation',
          fix: 'Specify the exact range to update like "Sheet1!A1:B10"'
        });
      });

      it('should require values for update', () => {
        context.config.range = 'Sheet1!A1:B10';
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'values',
          message: 'Values are required for update operation',
          fix: 'Provide the data to write to the spreadsheet'
        });
      });

      it('should accept rawData as alternative to values', () => {
        context.config.range = 'Sheet1!A1:B10';
        context.config.rawData = [[1, 2], [3, 4]];
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        const valuesErrors = context.errors.filter(e => e.property === 'values');
        expect(valuesErrors).toHaveLength(0);
      });
    });

    describe('delete operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'delete',
          sheetId: '1234567890'
        };
      });

      it('should require toDelete specification', () => {
        NodeSpecificValidators.validateGoogleSheets(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'toDelete',
          message: 'Specify what to delete (rows or columns)',
          fix: 'Set toDelete to "rows" or "columns"'
        });
      });

      it('should require startIndex for row deletion', () => {
        context.config.toDelete = 'rows';
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'startIndex',
          message: 'Start index is required when deleting rows',
          fix: 'Specify the starting row index (0-based)'
        });
      });

      it('should accept startIndex of 0', () => {
        context.config.toDelete = 'rows';
        context.config.startIndex = 0;
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        const startIndexErrors = context.errors.filter(e => e.property === 'startIndex');
        expect(startIndexErrors).toHaveLength(0);
      });

      it('should warn about permanent deletion', () => {
        context.config.toDelete = 'rows';
        context.config.startIndex = 0;
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          message: 'Deletion is permanent. Consider backing up data first',
          suggestion: 'Read the data before deletion to create a backup'
        });
      });
    });

    describe('range validation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'read',
          sheetId: '1234567890'
        };
      });

      it('should suggest including sheet name in range', () => {
        context.config.range = 'A1:B10';
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        expect(context.warnings).toContainEqual({
          type: 'inefficient',
          property: 'range',
          message: 'Range should include sheet name for clarity',
          suggestion: 'Format: "SheetName!A1:B10" or "SheetName!A:B"'
        });
      });

      it('should validate sheet names with spaces', () => {
        context.config.range = 'Sheet Name!A1:B10';
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'range',
          message: 'Sheet names with spaces must be quoted',
          fix: 'Use single quotes around sheet name: \'Sheet Name\'!A1:B10'
        });
      });

      it('should accept quoted sheet names with spaces', () => {
        context.config.range = "'Sheet Name'!A1:B10";
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        const rangeErrors = context.errors.filter(e => e.property === 'range' && e.message.includes('quoted'));
        expect(rangeErrors).toHaveLength(0);
      });

      it('should validate A1 notation format', () => {
        // Use an invalid range that doesn't match the A1 pattern
        context.config.range = 'Sheet1!123ABC';
        
        NodeSpecificValidators.validateGoogleSheets(context);
        
        expect(context.warnings).toContainEqual({
          type: 'inefficient',
          property: 'range',
          message: 'Range may not be in valid A1 notation',
          suggestion: 'Examples: "Sheet1!A1:B10", "Sheet1!A:B", "Sheet1!1:10"'
        });
      });
    });
  });

  describe('validateOpenAI', () => {
    describe('chat create operation', () => {
      beforeEach(() => {
        context.config = {
          resource: 'chat',
          operation: 'create'
        };
      });

      it('should require model selection', () => {
        NodeSpecificValidators.validateOpenAI(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'model',
          message: 'Model selection is required',
          fix: 'Choose a model like "gpt-4", "gpt-3.5-turbo", etc.'
        });
      });

      it('should warn about deprecated models', () => {
        context.config.model = 'text-davinci-003';
        context.config.messages = [{ role: 'user', content: 'Hello' }];
        
        NodeSpecificValidators.validateOpenAI(context);
        
        expect(context.warnings).toContainEqual({
          type: 'deprecated',
          property: 'model',
          message: 'Model text-davinci-003 is deprecated',
          suggestion: 'Use "gpt-3.5-turbo" or "gpt-4" instead'
        });
      });

      it('should require messages or prompt', () => {
        context.config.model = 'gpt-4';
        
        NodeSpecificValidators.validateOpenAI(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'messages',
          message: 'Messages or prompt required for chat completion',
          fix: 'Add messages array or use the prompt field'
        });
      });

      it('should accept prompt as alternative to messages', () => {
        context.config.model = 'gpt-4';
        context.config.prompt = 'Hello AI';
        
        NodeSpecificValidators.validateOpenAI(context);
        
        const messageErrors = context.errors.filter(e => e.property === 'messages');
        expect(messageErrors).toHaveLength(0);
      });

      it('should warn about high token limits', () => {
        context.config.model = 'gpt-4';
        context.config.messages = [{ role: 'user', content: 'Hello' }];
        context.config.maxTokens = 5000;
        
        NodeSpecificValidators.validateOpenAI(context);
        
        expect(context.warnings).toContainEqual({
          type: 'inefficient',
          property: 'maxTokens',
          message: 'High token limit may increase costs significantly',
          suggestion: 'Consider if you really need more than 4000 tokens'
        });
      });

      it('should validate temperature range', () => {
        context.config.model = 'gpt-4';
        context.config.messages = [{ role: 'user', content: 'Hello' }];
        context.config.temperature = 2.5;
        
        NodeSpecificValidators.validateOpenAI(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'temperature',
          message: 'Temperature must be between 0 and 2',
          fix: 'Set temperature between 0 (deterministic) and 2 (creative)'
        });
      });
    });

    describe('error handling', () => {
      it('should suggest error handling for AI API calls', () => {
        context.config = {
          resource: 'chat',
          operation: 'create',
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }]
        };
        
        NodeSpecificValidators.validateOpenAI(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'AI APIs have rate limits and can return errors',
          suggestion: 'Add onError: "continueRegularOutput" with retryOnFail and longer wait times'
        });
        
        expect(context.autofix).toMatchObject({
          onError: 'continueRegularOutput',
          retryOnFail: true,
          maxTries: 3,
          waitBetweenTries: 5000,
          alwaysOutputData: true
        });
      });

      it('should warn about deprecated continueOnFail', () => {
        context.config = {
          resource: 'chat',
          operation: 'create',
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          continueOnFail: true
        };
        
        NodeSpecificValidators.validateOpenAI(context);
        
        expect(context.warnings).toContainEqual({
          type: 'deprecated',
          property: 'continueOnFail',
          message: 'continueOnFail is deprecated. Use onError instead',
          suggestion: 'Replace with onError: "continueRegularOutput"'
        });
      });
    });
  });

  describe('validateMongoDB', () => {
    describe('common validations', () => {
      it('should require collection name', () => {
        context.config = {
          operation: 'find'
        };
        
        NodeSpecificValidators.validateMongoDB(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'collection',
          message: 'Collection name is required',
          fix: 'Specify the MongoDB collection to work with'
        });
      });
    });

    describe('find operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'find',
          collection: 'users'
        };
      });

      it('should validate query JSON', () => {
        context.config.query = '{ invalid json';
        
        NodeSpecificValidators.validateMongoDB(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'query',
          message: 'Query must be valid JSON',
          fix: 'Ensure query is valid JSON like: {"name": "John"}'
        });
      });

      it('should accept valid JSON query', () => {
        context.config.query = '{"name": "John"}';
        
        NodeSpecificValidators.validateMongoDB(context);
        
        const queryErrors = context.errors.filter(e => e.property === 'query');
        expect(queryErrors).toHaveLength(0);
      });
    });

    describe('insert operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'insert',
          collection: 'users'
        };
      });

      it('should require document data', () => {
        NodeSpecificValidators.validateMongoDB(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'fields',
          message: 'Document data is required for insert',
          fix: 'Provide the data to insert'
        });
      });

      it('should accept documents as alternative to fields', () => {
        context.config.documents = [{ name: 'John' }];
        
        NodeSpecificValidators.validateMongoDB(context);
        
        const fieldsErrors = context.errors.filter(e => e.property === 'fields');
        expect(fieldsErrors).toHaveLength(0);
      });
    });

    describe('update operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'update',
          collection: 'users'
        };
      });

      it('should warn about update without query', () => {
        NodeSpecificValidators.validateMongoDB(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          message: 'Update without query will affect all documents',
          suggestion: 'Add a query to target specific documents'
        });
      });
    });

    describe('delete operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'delete',
          collection: 'users'
        };
      });

      it('should error on delete without query', () => {
        NodeSpecificValidators.validateMongoDB(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'query',
          message: 'Delete without query would remove all documents - this is a critical security issue',
          fix: 'Add a query to specify which documents to delete'
        });
      });

      it('should error on delete with empty query', () => {
        context.config.query = '{}';
        
        NodeSpecificValidators.validateMongoDB(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'query',
          message: 'Delete without query would remove all documents - this is a critical security issue',
          fix: 'Add a query to specify which documents to delete'
        });
      });
    });

    describe('error handling', () => {
      it('should suggest error handling for find operations', () => {
        context.config = {
          operation: 'find',
          collection: 'users'
        };
        
        NodeSpecificValidators.validateMongoDB(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'MongoDB queries can fail due to connection issues',
          suggestion: 'Add onError: "continueRegularOutput" with retryOnFail'
        });
        
        expect(context.autofix).toMatchObject({
          onError: 'continueRegularOutput',
          retryOnFail: true,
          maxTries: 3
        });
      });

      it('should suggest different error handling for write operations', () => {
        context.config = {
          operation: 'insert',
          collection: 'users',
          fields: { name: 'John' }
        };
        
        NodeSpecificValidators.validateMongoDB(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'MongoDB write operations should handle errors carefully',
          suggestion: 'Add onError: "continueErrorOutput" to handle write failures separately'
        });
        
        expect(context.autofix).toMatchObject({
          onError: 'continueErrorOutput',
          retryOnFail: true,
          maxTries: 2,
          waitBetweenTries: 1000
        });
      });

      it('should warn about deprecated continueOnFail', () => {
        context.config = {
          operation: 'find',
          collection: 'users',
          continueOnFail: true
        };
        
        NodeSpecificValidators.validateMongoDB(context);
        
        expect(context.warnings).toContainEqual({
          type: 'deprecated',
          property: 'continueOnFail',
          message: 'continueOnFail is deprecated. Use onError instead',
          suggestion: 'Replace with onError: "continueRegularOutput" or "continueErrorOutput"'
        });
      });
    });
  });

  describe('validatePostgres', () => {
    describe('insert operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'insert'
        };
      });

      it('should require table name', () => {
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'table',
          message: 'Table name is required for insert operation',
          fix: 'Specify the table to insert data into'
        });
      });

      it('should warn about missing columns', () => {
        context.config.table = 'users';
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.warnings).toContainEqual({
          type: 'missing_common',
          property: 'columns',
          message: 'No columns specified for insert',
          suggestion: 'Define which columns to insert data into'
        });
      });

      it('should not warn if dataMode is set', () => {
        context.config.table = 'users';
        context.config.dataMode = 'autoMapInputData';
        
        NodeSpecificValidators.validatePostgres(context);
        
        const columnWarnings = context.warnings.filter(w => w.property === 'columns');
        expect(columnWarnings).toHaveLength(0);
      });
    });

    describe('update operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'update'
        };
      });

      it('should require table name', () => {
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'table',
          message: 'Table name is required for update operation',
          fix: 'Specify the table to update'
        });
      });

      it('should warn about missing updateKey', () => {
        context.config.table = 'users';
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.warnings).toContainEqual({
          type: 'missing_common',
          property: 'updateKey',
          message: 'No update key specified',
          suggestion: 'Set updateKey to identify which rows to update (e.g., "id")'
        });
      });
    });

    describe('delete operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'delete'
        };
      });

      it('should require table name', () => {
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'table',
          message: 'Table name is required for delete operation',
          fix: 'Specify the table to delete from'
        });
      });

      it('should require deleteKey', () => {
        context.config.table = 'users';
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'deleteKey',
          message: 'Delete key is required to identify rows',
          fix: 'Set deleteKey (e.g., "id") to specify which rows to delete'
        });
      });
    });

    describe('execute operation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'execute'
        };
      });

      it('should require SQL query', () => {
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'query',
          message: 'SQL query is required',
          fix: 'Provide the SQL query to execute'
        });
      });
    });

    describe('SQL query validation', () => {
      beforeEach(() => {
        context.config = {
          operation: 'execute'
        };
      });

      it('should warn about SQL injection risks', () => {
        context.config.query = 'SELECT * FROM users WHERE id = ${userId}';
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          message: 'Query contains template expressions that might be vulnerable to SQL injection',
          suggestion: 'Use parameterized queries with query parameters instead of string interpolation'
        });
      });

      it('should error on DELETE without WHERE', () => {
        context.config.query = 'DELETE FROM users';
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'query',
          message: 'DELETE query without WHERE clause will delete all records',
          fix: 'Add a WHERE clause to specify which records to delete'
        });
      });

      it('should warn on UPDATE without WHERE', () => {
        context.config.query = 'UPDATE users SET active = true';
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          message: 'UPDATE query without WHERE clause will update all records',
          suggestion: 'Add a WHERE clause to specify which records to update'
        });
      });

      it('should warn about TRUNCATE', () => {
        context.config.query = 'TRUNCATE TABLE users';
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          message: 'TRUNCATE will remove all data from the table',
          suggestion: 'Consider using DELETE with WHERE clause if you need to keep some data'
        });
      });

      it('should error on DROP operations', () => {
        context.config.query = 'DROP TABLE users';
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'query',
          message: 'DROP operations are extremely dangerous and will permanently delete database objects',
          fix: 'Use this only if you really intend to delete tables/databases permanently'
        });
      });

      it('should suggest specific columns instead of SELECT *', () => {
        context.config.query = 'SELECT * FROM users';
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.suggestions).toContain('Consider selecting specific columns instead of * for better performance');
      });

      it('should suggest PostgreSQL-specific dollar quotes', () => {
        context.config.query = 'CREATE FUNCTION test() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql';
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.suggestions).toContain('Dollar-quoted strings detected - ensure they are properly closed');
      });
    });

    describe('connection and error handling', () => {
      it('should suggest connection timeout', () => {
        context.config = {
          operation: 'execute',
          query: 'SELECT * FROM users'
        };
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.suggestions).toContain('Consider setting connectionTimeout to handle slow connections');
      });

      it('should suggest error handling for read operations', () => {
        context.config = {
          operation: 'execute',
          query: 'SELECT * FROM users'
        };
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'Database reads can fail due to connection issues',
          suggestion: 'Add onError: "continueRegularOutput" and retryOnFail: true'
        });
        
        expect(context.autofix).toMatchObject({
          onError: 'continueRegularOutput',
          retryOnFail: true,
          maxTries: 3
        });
      });

      it('should suggest different error handling for write operations', () => {
        context.config = {
          operation: 'insert',
          table: 'users'
        };
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'Database writes should handle errors carefully',
          suggestion: 'Add onError: "stopWorkflow" with retryOnFail for transient failures'
        });
        
        expect(context.autofix).toMatchObject({
          onError: 'stopWorkflow',
          retryOnFail: true,
          maxTries: 2,
          waitBetweenTries: 2000
        });
      });

      it('should warn about deprecated continueOnFail', () => {
        context.config = {
          operation: 'execute',
          query: 'SELECT * FROM users',
          continueOnFail: true
        };
        
        NodeSpecificValidators.validatePostgres(context);
        
        expect(context.warnings).toContainEqual({
          type: 'deprecated',
          property: 'continueOnFail',
          message: 'continueOnFail is deprecated. Use onError instead',
          suggestion: 'Replace with onError: "continueRegularOutput" or "stopWorkflow"'
        });
      });
    });
  });

  describe('validateMySQL', () => {
    describe('operations', () => {
      it('should validate insert operation', () => {
        context.config = {
          operation: 'insert'
        };
        
        NodeSpecificValidators.validateMySQL(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'table',
          message: 'Table name is required for insert operation',
          fix: 'Specify the table to insert data into'
        });
      });

      it('should validate update operation', () => {
        context.config = {
          operation: 'update'
        };
        
        NodeSpecificValidators.validateMySQL(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'table',
          message: 'Table name is required for update operation',
          fix: 'Specify the table to update'
        });
      });

      it('should validate delete operation', () => {
        context.config = {
          operation: 'delete'
        };
        
        NodeSpecificValidators.validateMySQL(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'table',
          message: 'Table name is required for delete operation',
          fix: 'Specify the table to delete from'
        });
      });

      it('should validate execute operation', () => {
        context.config = {
          operation: 'execute'
        };
        
        NodeSpecificValidators.validateMySQL(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'query',
          message: 'SQL query is required',
          fix: 'Provide the SQL query to execute'
        });
      });
    });

    describe('MySQL-specific features', () => {
      it('should suggest timezone configuration', () => {
        context.config = {
          operation: 'execute',
          query: 'SELECT NOW()'
        };
        
        NodeSpecificValidators.validateMySQL(context);
        
        expect(context.suggestions).toContain('Consider setting timezone to ensure consistent date/time handling');
      });

      it('should check for MySQL backticks', () => {
        context.config = {
          operation: 'execute',
          query: 'SELECT `name` FROM `users`'
        };
        
        NodeSpecificValidators.validateMySQL(context);
        
        expect(context.suggestions).toContain('Using backticks for identifiers - ensure they are properly paired');
      });
    });

    describe('error handling', () => {
      it('should suggest error handling for queries', () => {
        context.config = {
          operation: 'execute',
          query: 'SELECT * FROM users'
        };
        
        NodeSpecificValidators.validateMySQL(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'Database queries can fail due to connection issues',
          suggestion: 'Add onError: "continueRegularOutput" and retryOnFail: true'
        });
      });

      it('should suggest error handling for modifications', () => {
        context.config = {
          operation: 'update',
          table: 'users',
          updateKey: 'id'
        };
        
        NodeSpecificValidators.validateMySQL(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'Database modifications should handle errors carefully',
          suggestion: 'Add onError: "stopWorkflow" with retryOnFail for transient failures'
        });
      });
    });
  });

  describe('validateHttpRequest', () => {
    describe('URL validation', () => {
      it('should require URL', () => {
        context.config = {
          method: 'GET'
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'url',
          message: 'URL is required for HTTP requests',
          fix: 'Provide the full URL including protocol (https://...)'
        });
      });

      it('should warn about missing protocol', () => {
        context.config = {
          method: 'GET',
          url: 'example.com/api'
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.warnings).toContainEqual({
          type: 'invalid_value',
          property: 'url',
          message: 'URL should start with http:// or https://',
          suggestion: 'Use https:// for secure connections'
        });
      });

      it('should accept URLs with expressions', () => {
        context.config = {
          method: 'GET',
          url: '{{$node.Config.json.apiUrl}}/users'
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        const urlWarnings = context.warnings.filter(w => w.property === 'url');
        expect(urlWarnings).toHaveLength(0);
      });
    });

    describe('method-specific validation', () => {
      it('should suggest body for POST requests', () => {
        context.config = {
          method: 'POST',
          url: 'https://api.example.com/users'
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.warnings).toContainEqual({
          type: 'missing_common',
          property: 'sendBody',
          message: 'POST requests typically include a body',
          suggestion: 'Set sendBody: true and configure the body content'
        });
      });

      it('should suggest body for PUT requests', () => {
        context.config = {
          method: 'PUT',
          url: 'https://api.example.com/users/1'
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.warnings).toContainEqual({
          type: 'missing_common',
          property: 'sendBody',
          message: 'PUT requests typically include a body',
          suggestion: 'Set sendBody: true and configure the body content'
        });
      });

      it('should suggest body for PATCH requests', () => {
        context.config = {
          method: 'PATCH',
          url: 'https://api.example.com/users/1'
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.warnings).toContainEqual({
          type: 'missing_common',
          property: 'sendBody',
          message: 'PATCH requests typically include a body',
          suggestion: 'Set sendBody: true and configure the body content'
        });
      });
    });

    describe('error handling', () => {
      it('should suggest error handling for HTTP requests', () => {
        context.config = {
          method: 'GET',
          url: 'https://api.example.com/data'
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'HTTP requests can fail due to network issues or server errors',
          suggestion: 'Add onError: "continueRegularOutput" and retryOnFail: true for resilience'
        });
        
        expect(context.autofix).toMatchObject({
          onError: 'continueRegularOutput',
          retryOnFail: true,
          maxTries: 3,
          waitBetweenTries: 1000
        });
      });

      it('should handle deprecated continueOnFail', () => {
        context.config = {
          method: 'GET',
          url: 'https://api.example.com/data',
          continueOnFail: true
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.warnings).toContainEqual({
          type: 'deprecated',
          property: 'continueOnFail',
          message: 'continueOnFail is deprecated. Use onError instead',
          suggestion: 'Replace with onError: "continueRegularOutput"'
        });
        
        expect(context.autofix.onError).toBe('continueRegularOutput');
        expect(context.autofix.continueOnFail).toBeUndefined();
      });

      it('should handle continueOnFail false', () => {
        context.config = {
          method: 'GET',
          url: 'https://api.example.com/data',
          continueOnFail: false
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.autofix.onError).toBe('stopWorkflow');
      });
    });

    describe('retry configuration', () => {
      it('should warn about retrying non-idempotent operations', () => {
        context.config = {
          method: 'POST',
          url: 'https://api.example.com/orders',
          retryOnFail: true,
          maxTries: 5
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'maxTries',
          message: 'POST requests might not be idempotent. Use fewer retries.',
          suggestion: 'Set maxTries: 2 for non-idempotent operations'
        });
      });

      it('should suggest alwaysOutputData for debugging', () => {
        context.config = {
          method: 'GET',
          url: 'https://api.example.com/data',
          retryOnFail: true
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.suggestions).toContain('Enable alwaysOutputData to capture error responses for debugging');
        expect(context.autofix.alwaysOutputData).toBe(true);
      });
    });

    describe('authentication and security', () => {
      it('should warn about missing authentication for API endpoints', () => {
        context.config = {
          method: 'GET',
          url: 'https://api.example.com/users'
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          property: 'authentication',
          message: 'API endpoints typically require authentication',
          suggestion: 'Configure authentication method (Bearer token, API key, etc.)'
        });
      });

      it('should not warn about authentication for non-API URLs', () => {
        context.config = {
          method: 'GET',
          url: 'https://example.com/public-page'
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        const authWarnings = context.warnings.filter(w => w.property === 'authentication');
        expect(authWarnings).toHaveLength(0);
      });
    });

    describe('timeout', () => {
      it('should suggest timeout configuration', () => {
        context.config = {
          method: 'GET',
          url: 'https://api.example.com/data'
        };
        
        NodeSpecificValidators.validateHttpRequest(context);
        
        expect(context.suggestions).toContain('Consider setting a timeout to prevent hanging requests');
      });
    });
  });

  describe('validateWebhook', () => {
    describe('path validation', () => {
      it('should require webhook path', () => {
        context.config = {
          httpMethod: 'POST'
        };
        
        NodeSpecificValidators.validateWebhook(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'path',
          message: 'Webhook path is required',
          fix: 'Provide a unique path like "my-webhook" or "github-events"'
        });
      });

      it('should warn about leading slash in path', () => {
        context.config = {
          path: '/my-webhook',
          httpMethod: 'POST'
        };
        
        NodeSpecificValidators.validateWebhook(context);
        
        expect(context.warnings).toContainEqual({
          type: 'invalid_value',
          property: 'path',
          message: 'Webhook path should not start with /',
          suggestion: 'Use "webhook-name" instead of "/webhook-name"'
        });
      });
    });

    describe('error handling', () => {
      it('should suggest error handling for webhooks', () => {
        context.config = {
          path: 'my-webhook',
          httpMethod: 'POST'
        };
        
        NodeSpecificValidators.validateWebhook(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'onError',
          message: 'Webhooks should always send a response, even on error',
          suggestion: 'Set onError: "continueRegularOutput" to ensure webhook responses'
        });
        
        expect(context.autofix.onError).toBe('continueRegularOutput');
      });

      it('should handle deprecated continueOnFail', () => {
        context.config = {
          path: 'my-webhook',
          httpMethod: 'POST',
          continueOnFail: true
        };
        
        NodeSpecificValidators.validateWebhook(context);
        
        expect(context.warnings).toContainEqual({
          type: 'deprecated',
          property: 'continueOnFail',
          message: 'continueOnFail is deprecated. Use onError instead',
          suggestion: 'Replace with onError: "continueRegularOutput"'
        });
        
        expect(context.autofix.onError).toBe('continueRegularOutput');
        expect(context.autofix.continueOnFail).toBeUndefined();
      });
    });

    describe('response mode validation', () => {
      // NOTE: responseNode mode validation was moved to workflow-validator.ts in Phase 5
      // because it requires access to node-level onError property, not just config/parameters.
      // See workflow-validator.ts checkWebhookErrorHandling() method for the actual implementation.
      // The validation cannot be performed at the node-specific-validator level.

      it.skip('should error on responseNode without error handling - MOVED TO WORKFLOW VALIDATOR', () => {
        context.config = {
          path: 'my-webhook',
          httpMethod: 'POST',
          responseMode: 'responseNode'
        };

        NodeSpecificValidators.validateWebhook(context);

        expect(context.errors).toContainEqual({
          type: 'invalid_configuration',
          property: 'responseMode',
          message: 'responseNode mode requires onError: "continueRegularOutput"',
          fix: 'Set onError to ensure response is always sent'
        });
      });

      it.skip('should not error on responseNode with proper error handling - MOVED TO WORKFLOW VALIDATOR', () => {
        context.config = {
          path: 'my-webhook',
          httpMethod: 'POST',
          responseMode: 'responseNode',
          onError: 'continueRegularOutput'
        };

        NodeSpecificValidators.validateWebhook(context);
        
        const responseModeErrors = context.errors.filter(e => e.property === 'responseMode');
        expect(responseModeErrors).toHaveLength(0);
      });
    });

    describe('debugging and security', () => {
      it('should suggest alwaysOutputData for debugging', () => {
        context.config = {
          path: 'my-webhook',
          httpMethod: 'POST'
        };
        
        NodeSpecificValidators.validateWebhook(context);
        
        expect(context.suggestions).toContain('Enable alwaysOutputData to debug webhook payloads');
        expect(context.autofix.alwaysOutputData).toBe(true);
      });

      it('should suggest security measures', () => {
        context.config = {
          path: 'my-webhook',
          httpMethod: 'POST'
        };
        
        NodeSpecificValidators.validateWebhook(context);
        
        expect(context.suggestions).toContain('Consider adding webhook validation (HMAC signature verification)');
        expect(context.suggestions).toContain('Implement rate limiting for public webhooks');
      });
    });
  });

  describe('validateCode', () => {
    describe('empty code validation', () => {
      it('should error on empty JavaScript code', () => {
        context.config = {
          language: 'javaScript',
          jsCode: ''
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'jsCode',
          message: 'Code cannot be empty',
          fix: 'Add your code logic. Start with: return [{json: {result: "success"}}]'
        });
      });

      it('should error on whitespace-only code', () => {
        context.config = {
          language: 'javaScript',
          jsCode: '   \n\t  '
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'jsCode',
          message: 'Code cannot be empty',
          fix: 'Add your code logic. Start with: return [{json: {result: "success"}}]'
        });
      });

      it('should error on empty Python code', () => {
        context.config = {
          language: 'python',
          pythonCode: ''
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'pythonCode',
          message: 'Code cannot be empty',
          fix: 'Add your code logic. Start with: return [{json: {result: "success"}}]'
        });
      });
    });

    describe('JavaScript syntax validation', () => {
      it('should detect duplicate const declarations', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const const x = 5; return [{json: {x}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Syntax error: Duplicate const declaration',
          fix: 'Check your JavaScript syntax'
        });
      });

      it('should warn about await in non-async function', () => {
        context.config = {
          language: 'javaScript',
          jsCode: `
            function fetchData() {
              const result = await fetch('https://api.example.com');
              return [{json: result}];
            }
          `
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          message: 'Using await inside a non-async function',
          suggestion: 'Add async keyword to the function, or use top-level await (Code nodes support it)'
        });
      });

      it('should suggest async usage for $helpers.httpRequest', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const response = $helpers.httpRequest(...); return [{json: response}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.suggestions).toContain('$helpers.httpRequest is async - use: const response = await $helpers.httpRequest(...)');
      });

      it('should warn about DateTime usage', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const now = DateTime(); return [{json: {now}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          message: 'DateTime is from Luxon library',
          suggestion: 'Use DateTime.now() or DateTime.fromISO() for date operations'
        });
      });
    });

    describe('Python syntax validation', () => {
      it('should warn about unnecessary main check', () => {
        context.config = {
          language: 'python',
          pythonCode: `
if __name__ == "__main__":
    result = {"status": "ok"}
    return [{"json": result}]
          `
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'inefficient',
          message: 'if __name__ == "__main__" is not needed in Code nodes',
          suggestion: 'Code node Python runs directly - remove the main check'
        });
      });

      it('should not warn about __name__ without __main__', () => {
        context.config = {
          language: 'python',
          pythonCode: `
module_name = __name__
return [{"json": {"module": module_name}}]
          `
        };
        
        NodeSpecificValidators.validateCode(context);
        
        const mainWarnings = context.warnings.filter(w => w.message.includes('__main__'));
        expect(mainWarnings).toHaveLength(0);
      });

      it('should error on unavailable imports', () => {
        context.config = {
          language: 'python',
          pythonCode: 'import requests\nreturn [{"json": {"status": "ok"}}]'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'pythonCode',
          message: 'Module \'requests\' is not available in Code nodes',
          fix: 'Use JavaScript Code node with $helpers.httpRequest for HTTP requests'
        });
      });

      it('should check indentation after colons', () => {
        context.config = {
          language: 'python',
          pythonCode: `
def process():
result = "ok"
return [{"json": {"result": result}}]
          `
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'pythonCode',
          message: 'Missing indentation after line 2',
          fix: 'Indent the line after the colon'
        });
      });
    });

    describe('return statement validation', () => {
      it('should error on missing return statement', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const result = {status: "ok"}; // missing return'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'jsCode',
          message: 'Code must return data for the next node',
          fix: 'Add: return [{json: {result: "success"}}]'
        });
      });

      it('should error on object return without array', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'return {status: "ok"};'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Return value must be an array of objects',
          fix: 'Wrap in array: return [{json: yourObject}]'
        });
      });

      it('should error on primitive return', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'return "success";'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Cannot return primitive values directly',
          fix: 'Return array of objects: return [{json: {value: yourData}}]'
        });
      });

      it('should not error on primitive return inside helper functions', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'function isValid(item) { return false; }\nconst items = $input.all();\nreturn items.filter(isValid).map(i => ({json: i.json}));'
        };

        NodeSpecificValidators.validateCode(context);

        const primitiveErrors = context.errors.filter(e => e.message === 'Cannot return primitive values directly');
        expect(primitiveErrors).toHaveLength(0);
      });

      it('should not error on primitive return inside arrow function helpers', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const isValid = (item) => { return false; };\nreturn $input.all().filter(isValid).map(i => ({json: i.json}));'
        };

        NodeSpecificValidators.validateCode(context);

        const primitiveErrors = context.errors.filter(e => e.message === 'Cannot return primitive values directly');
        expect(primitiveErrors).toHaveLength(0);
      });

      it('should not error on primitive return inside async function helpers', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'async function fetchData(url) { return null; }\nconst data = await fetchData("https://api.example.com");\nreturn [{json: {data}}];'
        };

        NodeSpecificValidators.validateCode(context);

        const primitiveErrors = context.errors.filter(e => e.message === 'Cannot return primitive values directly');
        expect(primitiveErrors).toHaveLength(0);
      });

      it('should still error on primitive return without helper functions', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'return "success";'
        };

        NodeSpecificValidators.validateCode(context);

        expect(context.errors).toContainEqual(expect.objectContaining({
          message: 'Cannot return primitive values directly'
        }));
      });

      it('should error on Python primitive return', () => {
        context.config = {
          language: 'python',
          pythonCode: 'return "success"'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'pythonCode',
          message: 'Cannot return primitive values directly',
          fix: 'Return list of dicts: return [{"json": {"value": your_data}}]'
        });
      });

      it('should error on array of non-objects', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'return ["item1", "item2"];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Array items must be objects with json property',
          fix: 'Use: return [{json: {value: "data"}}] not return ["data"]'
        });
      });

      it('should suggest proper items return format', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'return items;'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.suggestions).toContain(
          'Returning items directly is fine if they already have {json: ...} structure. ' +
          'To modify: return items.map(item => ({json: {...item.json, newField: "value"}}))'
        );
      });
    });

    describe('n8n variable usage', () => {
      it('should warn when code doesn\'t reference input data', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const result = Math.random(); return [{json: {result}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'missing_common',
          message: 'Code doesn\'t reference input data',
          suggestion: 'Access input with: items, $input.all(), or $json (single-item mode)'
        });
      });

      it('should error on expression syntax in code', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const name = {{$json.name}}; return [{json: {name}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Expression syntax {{...}} is not valid in Code nodes',
          fix: 'Use regular JavaScript/Python syntax without double curly braces'
        });
      });

      it('should warn about wrong $node syntax', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const data = $node[\'Previous Node\'].json; return [{json: data}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Use $(\'Node Name\') instead of $node[\'Node Name\'] in Code nodes',
          suggestion: 'Replace $node[\'NodeName\'] with $(\'NodeName\')'
        });
      });

      it('should warn about expression-only functions', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const now = $now(); return [{json: {now}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: '$now() is an expression-only function not available in Code nodes',
          suggestion: 'See Code node documentation for alternatives'
        });
      });

      it('should warn about invalid $ usage', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const value = $; return [{json: {value}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          message: 'Invalid $ usage detected',
          suggestion: 'n8n variables start with $: $json, $input, $node, $workflow, $execution'
        });
      });

      it('should not warn about $() node reference syntax', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const data = $("Previous Node").first().json;\nreturn [{json: data}];'
        };

        NodeSpecificValidators.validateCode(context);

        const dollarWarnings = context.warnings.filter(w => w.message === 'Invalid $ usage detected');
        expect(dollarWarnings).toHaveLength(0);
      });

      it('should not warn about $_ variables', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const $_temp = 1;\nreturn [{json: {value: $_temp}}];'
        };

        NodeSpecificValidators.validateCode(context);

        const dollarWarnings = context.warnings.filter(w => w.message === 'Invalid $ usage detected');
        expect(dollarWarnings).toHaveLength(0);
      });

      it('should correct helpers usage', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const result = helpers.httpRequest(); return [{json: {result}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Use $helpers not helpers',
          suggestion: 'Change helpers. to $helpers.'
        });
      });

      it('should warn about $helpers availability', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const result = await $helpers.httpRequest(); return [{json: {result}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          message: '$helpers availability varies by n8n version',
          suggestion: 'Check availability first: if (typeof $helpers !== "undefined" && $helpers.httpRequest) { ... }'
        });
      });

      it('should error on incorrect getWorkflowStaticData usage', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const data = $helpers.getWorkflowStaticData(); return [{json: data}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: '$helpers.getWorkflowStaticData() will cause "$helpers is not defined" error',
          fix: 'Use $getWorkflowStaticData("global") or $getWorkflowStaticData("node") directly'
        });
      });

      it('should warn about wrong JMESPath parameter order', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const result = $jmespath("name", data); return [{json: {result}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Code node $jmespath has reversed parameter order: $jmespath(data, query)',
          suggestion: 'Use: $jmespath(dataObject, "query.path") not $jmespath("query.path", dataObject)'
        });
      });

      it('should warn about webhook data access', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const payload = items[0].json.payload; return [{json: {payload}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          message: 'If processing webhook data, remember it\'s nested under .body',
          suggestion: 'Webhook payloads are at items[0].json.body, not items[0].json'
        });
      });

      it('should warn about webhook data access when webhook node is referenced', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const webhookData = $("Webhook"); const data = items[0].json.someField; return [{json: {data}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Webhook data is nested under .body property',
          suggestion: 'Use items[0].json.body.fieldName instead of items[0].json.fieldName for webhook data'
        });
      });

      it('should warn when code includes webhook string', () => {
        context.config = {
          language: 'javaScript',
          jsCode: '// Process webhook response\nconst data = items[0].json.data; return [{json: {data}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'Webhook data is nested under .body property',
          suggestion: 'Use items[0].json.body.fieldName instead of items[0].json.fieldName for webhook data'
        });
      });

      it('should error on JMESPath numeric literals without backticks', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const filtered = $jmespath(data, "[?age >= 18]"); return [{json: {filtered}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'jsCode',
          message: 'JMESPath numeric literal 18 must be wrapped in backticks',
          fix: 'Change [?field >= 18] to [?field >= `18`]'
        });
      });
    });

    describe('code security', () => {
      it('should warn about eval usage', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const result = eval("1 + 1"); return [{json: {result}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          message: 'Avoid eval() - it\'s a security risk',
          suggestion: 'Use safer alternatives or built-in functions'
        });
      });

      it('should warn about Function constructor', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const fn = new Function("return 1"); return [{json: {result: fn()}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          message: 'Avoid Function constructor - use regular functions',
          suggestion: 'Use safer alternatives or built-in functions'
        });
      });

      it('should warn about unavailable modules', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const axios = require("axios"); return [{json: {}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          message: 'Cannot require(\'axios\') - only built-in Node.js modules are available',
          suggestion: 'Available modules: crypto, util, querystring, url, buffer'
        });
      });

      it('should warn about dynamic require', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const module = require(moduleName); return [{json: {}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          message: 'Dynamic require() not supported',
          suggestion: 'Use static require with string literals: require("crypto")'
        });
      });

      it('should warn about crypto usage without require', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const hash = crypto.createHash("sha256"); return [{json: {hash}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'invalid_value',
          message: 'Using crypto without require statement',
          suggestion: 'Add: const crypto = require("crypto"); at the beginning (ignore editor warnings)'
        });
      });

      it('should warn about file system access', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const fs = require("fs"); return [{json: {}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'security',
          message: 'File system and process access not available in Code nodes',
          suggestion: 'Use other n8n nodes for file operations (e.g., Read/Write Files node)'
        });
      });
    });

    describe('mode-specific validation', () => {
      it('should warn about items usage in single-item mode', () => {
        context.config = {
          mode: 'runOnceForEachItem',
          language: 'javaScript',
          jsCode: 'const allItems = items.length; return [{json: {count: allItems}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          message: 'In "Run Once for Each Item" mode, use $json instead of items array',
          suggestion: 'Access current item data with $json.fieldName'
        });
      });

      it('should warn about $json usage without single-item mode', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'const name = $json.name; return [{json: {name}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          message: '$json only works in "Run Once for Each Item" mode',
          suggestion: 'Either set mode: "runOnceForEachItem" or use items[0].json'
        });
      });
    });

    describe('error handling', () => {
      it('should suggest error handling for complex code', () => {
        context.config = {
          language: 'javaScript',
          jsCode: 'a'.repeat(101) + '\nreturn [{json: {}}];'
        };
        
        NodeSpecificValidators.validateCode(context);
        
        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'Code nodes can throw errors - consider error handling',
          suggestion: 'Add onError: "continueRegularOutput" to handle errors gracefully'
        });

        expect(context.autofix.onError).toBe('continueRegularOutput');
      });
    });
  });

  describe('validateSet', () => {
    it('should not warn when Set v3 has populated assignments', () => {
      context.config = {
        mode: 'manual',
        assignments: {
          assignments: [
            { id: '1', name: 'status', value: 'active', type: 'string' }
          ]
        }
      };

      NodeSpecificValidators.validateSet(context);

      const fieldWarnings = context.warnings.filter(w => w.message.includes('no fields configured'));
      expect(fieldWarnings).toHaveLength(0);
    });

    it('should not warn when Set v2 has populated values', () => {
      context.config = {
        mode: 'manual',
        values: {
          string: [{ name: 'field', value: 'val' }]
        }
      };

      NodeSpecificValidators.validateSet(context);

      const fieldWarnings = context.warnings.filter(w => w.message.includes('no fields configured'));
      expect(fieldWarnings).toHaveLength(0);
    });

    it('should warn when Set v3 has empty assignments array', () => {
      context.config = {
        mode: 'manual',
        assignments: { assignments: [] }
      };

      NodeSpecificValidators.validateSet(context);

      const fieldWarnings = context.warnings.filter(w => w.message.includes('no fields configured'));
      expect(fieldWarnings).toHaveLength(1);
    });

    it('should warn when Set manual mode has no values or assignments', () => {
      context.config = {
        mode: 'manual'
      };

      NodeSpecificValidators.validateSet(context);

      const fieldWarnings = context.warnings.filter(w => w.message.includes('no fields configured'));
      expect(fieldWarnings).toHaveLength(1);
    });

    it('should not warn when Set manual mode has jsonOutput', () => {
      context.config = {
        mode: 'manual',
        jsonOutput: '{"key":"value"}'
      };

      NodeSpecificValidators.validateSet(context);

      const fieldWarnings = context.warnings.filter(w => w.message.includes('no fields configured'));
      expect(fieldWarnings).toHaveLength(0);
    });
  });

  describe('validateAIAgent', () => {
    let context: NodeValidationContext;

    beforeEach(() => {
      context = {
        config: {},
        errors: [],
        warnings: [],
        suggestions: [],
        autofix: {}
      };
    });

    describe('prompt configuration', () => {
      it('should require text when promptType is "define"', () => {
        context.config.promptType = 'define';
        context.config.text = '';

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'text',
          message: 'Custom prompt text is required when promptType is "define"',
          fix: 'Provide a custom prompt in the text field, or change promptType to "auto"'
        });
      });

      it('should not require text when promptType is "auto"', () => {
        context.config.promptType = 'auto';

        NodeSpecificValidators.validateAIAgent(context);

        const textErrors = context.errors.filter(e => e.property === 'text');
        expect(textErrors).toHaveLength(0);
      });

      it('should accept valid text with promptType "define"', () => {
        context.config.promptType = 'define';
        context.config.text = 'You are a helpful assistant that analyzes data.';

        NodeSpecificValidators.validateAIAgent(context);

        const textErrors = context.errors.filter(e => e.property === 'text');
        expect(textErrors).toHaveLength(0);
      });

      it('should reject whitespace-only text with promptType "define"', () => {
        // Edge case: Text is only whitespace
        context.config.promptType = 'define';
        context.config.text = '   \n\t  ';

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'text',
          message: 'Custom prompt text is required when promptType is "define"',
          fix: 'Provide a custom prompt in the text field, or change promptType to "auto"'
        });
      });

      it('should accept very long text with promptType "define"', () => {
        // Edge case: Very long prompt text (common for complex AI agents)
        context.config.promptType = 'define';
        context.config.text = 'You are a helpful assistant. '.repeat(100); // 3200 characters

        NodeSpecificValidators.validateAIAgent(context);

        const textErrors = context.errors.filter(e => e.property === 'text');
        expect(textErrors).toHaveLength(0);
      });

      it('should handle undefined text with promptType "define"', () => {
        // Edge case: Text is undefined
        context.config.promptType = 'define';
        context.config.text = undefined;

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'text',
          message: 'Custom prompt text is required when promptType is "define"',
          fix: 'Provide a custom prompt in the text field, or change promptType to "auto"'
        });
      });

      it('should handle null text with promptType "define"', () => {
        // Edge case: Text is null
        context.config.promptType = 'define';
        context.config.text = null;

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.errors).toContainEqual({
          type: 'missing_required',
          property: 'text',
          message: 'Custom prompt text is required when promptType is "define"',
          fix: 'Provide a custom prompt in the text field, or change promptType to "auto"'
        });
      });
    });

    describe('system message validation', () => {
      it('should suggest adding system message when missing', () => {
        context.config = {};

        NodeSpecificValidators.validateAIAgent(context);

        // Should contain a suggestion about system message
        const hasSysMessageSuggestion = context.suggestions.some(s =>
          s.toLowerCase().includes('system message')
        );
        expect(hasSysMessageSuggestion).toBe(true);
      });

      it('should warn when system message is too short', () => {
        context.config.systemMessage = 'Help';

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.warnings).toContainEqual({
          type: 'inefficient',
          property: 'systemMessage',
          message: 'System message is very short (< 20 characters)',
          suggestion: 'Consider a more detailed system message to guide the agent\'s behavior'
        });
      });

      it('should accept adequate system message', () => {
        context.config.systemMessage = 'You are a helpful assistant that analyzes customer feedback.';

        NodeSpecificValidators.validateAIAgent(context);

        const systemWarnings = context.warnings.filter(w => w.property === 'systemMessage');
        expect(systemWarnings).toHaveLength(0);
      });

      it('should suggest adding system message when empty string', () => {
        // Edge case: Empty string system message
        context.config.systemMessage = '';

        NodeSpecificValidators.validateAIAgent(context);

        // Should contain a suggestion about system message
        const hasSysMessageSuggestion = context.suggestions.some(s =>
          s.toLowerCase().includes('system message')
        );
        expect(hasSysMessageSuggestion).toBe(true);
      });

      it('should suggest adding system message when whitespace only', () => {
        // Edge case: Whitespace-only system message
        context.config.systemMessage = '   \n\t  ';

        NodeSpecificValidators.validateAIAgent(context);

        // Should contain a suggestion about system message
        const hasSysMessageSuggestion = context.suggestions.some(s =>
          s.toLowerCase().includes('system message')
        );
        expect(hasSysMessageSuggestion).toBe(true);
      });

      it('should accept very long system messages', () => {
        // Edge case: Very long system message (>1000 chars) for complex agents
        context.config.systemMessage = 'You are a highly specialized assistant. '.repeat(30); // ~1260 chars

        NodeSpecificValidators.validateAIAgent(context);

        const systemWarnings = context.warnings.filter(w => w.property === 'systemMessage');
        expect(systemWarnings).toHaveLength(0);
      });

      it('should handle system messages with special characters', () => {
        // Edge case: System message with special characters, emojis, unicode
        context.config.systemMessage = 'You are an assistant 🤖 that handles data with special chars: @#$%^&*(){}[]|\\/<>~`';

        NodeSpecificValidators.validateAIAgent(context);

        const systemWarnings = context.warnings.filter(w => w.property === 'systemMessage');
        expect(systemWarnings).toHaveLength(0);
      });

      it('should handle system messages with newlines and formatting', () => {
        // Edge case: Multi-line system message with formatting
        context.config.systemMessage = `You are a helpful assistant.

Your responsibilities include:
1. Analyzing customer feedback
2. Generating reports
3. Providing insights

Always be professional and concise.`;

        NodeSpecificValidators.validateAIAgent(context);

        const systemWarnings = context.warnings.filter(w => w.property === 'systemMessage');
        expect(systemWarnings).toHaveLength(0);
      });

      it('should warn about exactly 19 character system message', () => {
        // Edge case: Just under the 20 character threshold
        context.config.systemMessage = 'Be a good assistant'; // 19 chars

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.warnings).toContainEqual({
          type: 'inefficient',
          property: 'systemMessage',
          message: 'System message is very short (< 20 characters)',
          suggestion: 'Consider a more detailed system message to guide the agent\'s behavior'
        });
      });

      it('should not warn about exactly 20 character system message', () => {
        // Edge case: Exactly at the 20 character threshold
        context.config.systemMessage = 'Be a great assistant'; // 20 chars

        NodeSpecificValidators.validateAIAgent(context);

        const systemWarnings = context.warnings.filter(w => w.property === 'systemMessage');
        expect(systemWarnings).toHaveLength(0);
      });
    });

    describe('maxIterations validation', () => {
      it('should reject invalid maxIterations values', () => {
        context.config.maxIterations = -5;

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'maxIterations',
          message: 'maxIterations must be a positive number',
          fix: 'Set maxIterations to a value >= 1 (e.g., 10)'
        });
      });

      it('should warn about very high maxIterations', () => {
        context.config.maxIterations = 100;

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.warnings).toContainEqual(
          expect.objectContaining({
            type: 'inefficient',
            property: 'maxIterations'
          })
        );
      });

      it('should accept reasonable maxIterations', () => {
        context.config.maxIterations = 15;

        NodeSpecificValidators.validateAIAgent(context);

        const maxIterErrors = context.errors.filter(e => e.property === 'maxIterations');
        expect(maxIterErrors).toHaveLength(0);
      });

      it('should reject maxIterations of 0', () => {
        // Edge case: Zero iterations is invalid
        context.config.maxIterations = 0;

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'maxIterations',
          message: 'maxIterations must be a positive number',
          fix: 'Set maxIterations to a value >= 1 (e.g., 10)'
        });
      });

      it('should accept maxIterations of 1', () => {
        // Edge case: Minimum valid value
        context.config.maxIterations = 1;

        NodeSpecificValidators.validateAIAgent(context);

        const maxIterErrors = context.errors.filter(e => e.property === 'maxIterations');
        expect(maxIterErrors).toHaveLength(0);
      });

      it('should warn about maxIterations of 51', () => {
        // Edge case: Just above the threshold (50)
        context.config.maxIterations = 51;

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.warnings).toContainEqual(
          expect.objectContaining({
            type: 'inefficient',
            property: 'maxIterations',
            message: expect.stringContaining('51')
          })
        );
      });

      it('should handle extreme maxIterations values', () => {
        // Edge case: Very large number
        context.config.maxIterations = Number.MAX_SAFE_INTEGER;

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.warnings).toContainEqual(
          expect.objectContaining({
            type: 'inefficient',
            property: 'maxIterations'
          })
        );
      });

      it('should reject NaN maxIterations', () => {
        // Edge case: Not a number
        context.config.maxIterations = 'invalid';

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'maxIterations',
          message: 'maxIterations must be a positive number',
          fix: 'Set maxIterations to a value >= 1 (e.g., 10)'
        });
      });

      it('should reject negative decimal maxIterations', () => {
        // Edge case: Negative decimal
        context.config.maxIterations = -0.5;

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.errors).toContainEqual({
          type: 'invalid_value',
          property: 'maxIterations',
          message: 'maxIterations must be a positive number',
          fix: 'Set maxIterations to a value >= 1 (e.g., 10)'
        });
      });
    });

    describe('error handling', () => {
      it('should suggest error handling when not configured', () => {
        context.config = {};

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.warnings).toContainEqual({
          type: 'best_practice',
          property: 'errorHandling',
          message: 'AI models can fail due to API limits, rate limits, or invalid responses',
          suggestion: 'Add onError: "continueRegularOutput" with retryOnFail for resilience'
        });

        expect(context.autofix).toMatchObject({
          onError: 'continueRegularOutput',
          retryOnFail: true,
          maxTries: 2,
          waitBetweenTries: 5000
        });
      });

      it('should warn about deprecated continueOnFail', () => {
        context.config.continueOnFail = true;

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.warnings).toContainEqual({
          type: 'deprecated',
          property: 'continueOnFail',
          message: 'continueOnFail is deprecated. Use onError instead',
          suggestion: 'Replace with onError: "continueRegularOutput" or "stopWorkflow"'
        });
      });
    });

    describe('output parser and fallback warnings', () => {
      it('should warn when output parser is enabled', () => {
        context.config.hasOutputParser = true;

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.warnings).toContainEqual(
          expect.objectContaining({
            property: 'hasOutputParser'
          })
        );
      });

      it('should warn when fallback model is enabled', () => {
        context.config.needsFallback = true;

        NodeSpecificValidators.validateAIAgent(context);

        expect(context.warnings).toContainEqual(
          expect.objectContaining({
            property: 'needsFallback'
          })
        );
      });
    });
  });
});