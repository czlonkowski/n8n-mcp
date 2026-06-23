/**
 * Task Templates Service
 *
 * @deprecated This module is deprecated as of v2.15.0 and will be removed in v2.16.0.
 * The get_node_for_task tool has been removed in favor of template-based configuration examples.
 *
 * Migration:
 * - Use `search_nodes({query: "webhook", includeExamples: true})` to find nodes with real template configs
 * - Use `get_node_essentials({nodeType: "nodes-base.webhook", includeExamples: true})` for top 3 examples
 * - New approach provides 2,646 real templates vs 31 hardcoded tasks
 *
 * Provides pre-configured node settings for common tasks.
 * This helps AI agents quickly configure nodes for specific use cases.
 */

export interface TaskTemplate {
  task: string;
  description: string;
  nodeType: string;
  configuration: Record<string, any>;
  userMustProvide: Array<{
    property: string;
    description: string;
    example?: any;
  }>;
  optionalEnhancements?: Array<{
    property: string;
    description: string;
    when?: string;
  }>;
  notes?: string[];
}

export class TaskTemplates {
  private static templates: Record<string, TaskTemplate> = {
    // HTTP Request Tasks
    'get_api_data': {
      task: 'get_api_data',
      description: 'Make a simple GET request to retrieve data from an API',
      nodeType: 'nodes-base.httpRequest',
      configuration: {
        method: 'GET',
        url: '',
        authentication: 'none',
        // Default error handling for API calls
        onError: 'continueRegularOutput',
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 1000,
        alwaysOutputData: true
      },
      userMustProvide: [
        {
          property: 'url',
          description: 'The API endpoint URL',
          example: 'https://api.example.com/users'
        }
      ],
      optionalEnhancements: [
        {
          property: 'authentication',
          description: 'Add authentication if the API requires it',
          when: 'API requires authentication'
        },
        {
          property: 'sendHeaders',
          description: 'Add custom headers if needed',
          when: 'API requires specific headers'
        },
        {
          property: 'alwaysOutputData',
          description: 'Set to true to capture error responses',
          when: 'Need to debug API errors'
        }
      ]
    },
    
    'post_json_request': {
      task: 'post_json_request',
      description: 'Send JSON data to an API endpoint',
      nodeType: 'nodes-base.httpRequest',
      configuration: {
        method: 'POST',
        url: '',
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: '',
        // POST requests might modify data, so be careful with retries
        onError: 'continueRegularOutput',
        retryOnFail: true,
        maxTries: 2,
        waitBetweenTries: 1000,
        alwaysOutputData: true
      },
      userMustProvide: [
        {
          property: 'url',
          description: 'The API endpoint URL',
          example: 'https://api.example.com/users'
        },
        {
          property: 'jsonBody',
          description: 'The JSON data to send',
          example: '{\n  "name": "John Doe",\n  "email": "john@example.com"\n}'
        }
      ],
      optionalEnhancements: [
        {
          property: 'authentication',
          description: 'Add authentication if required'
        },
        {
          property: 'onError',
          description: 'Set to "continueRegularOutput" for non-critical operations',
          when: 'Failure should not stop the workflow'
        }
      ],
      notes: [
        'Make sure jsonBody contains valid JSON',
        'Content-Type header is automatically set to application/json',
        'Be careful with retries on non-idempotent operations'
      ]
    },
    
    'call_api_with_auth': {
      task: 'call_api_with_auth',
      description: 'Make an authenticated API request',
      nodeType: 'nodes-base.httpRequest',
      configuration: {
        method: 'GET',
        url: '',
        authentication: 'genericCredentialType',
        genericAuthType: 'headerAuth',
        sendHeaders: true,
        // Authentication calls should handle auth failures gracefully
        onError: 'continueErrorOutput',
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 2000,
        alwaysOutputData: true,
        headerParameters: {
          parameters: [
            {
              name: '',
              value: ''
            }
          ]
        }
      },
      userMustProvide: [
        {
          property: 'url',
          description: 'The API endpoint URL'
        },
        {
          property: 'headerParameters.parameters[0].name',
          description: 'The header name for authentication',
          example: 'Authorization'
        },
        {
          property: 'headerParameters.parameters[0].value',
          description: 'The authentication value',
          example: 'Bearer YOUR_API_KEY'
        }
      ],
      optionalEnhancements: [
        {
          property: 'method',
          description: 'Change to POST/PUT/DELETE as needed'
        }
      ]
    },
    
    // Webhook Tasks
    'receive_webhook': {
      task: 'receive_webhook',
      description: 'Set up a webhook to receive data from external services',
      nodeType: 'nodes-base.webhook',
      configuration: {
        httpMethod: 'POST',
        path: 'webhook',
        responseMode: 'lastNode',
        responseData: 'allEntries',
        // Webhooks should always respond, even on error
        onError: 'continueRegularOutput',
        alwaysOutputData: true
      },
      userMustProvide: [
        {
          property: 'path',
          description: 'The webhook path (will be appended to your n8n URL)',
          example: 'github-webhook'
        }
      ],
      optionalEnhancements: [
        {
          property: 'httpMethod',
          description: 'Change if the service sends GET/PUT/etc'
        },
        {
          property: 'responseCode',
          description: 'Set custom response code (default 200)'
        }
      ],
      notes: [
        'The full webhook URL will be: https://your-n8n.com/webhook/[path]',
        'Test URL will be different from production URL'
      ]
    },
    
    'webhook_with_response': {
      task: 'webhook_with_response',
      description: 'Receive webhook and send custom response',
      nodeType: 'nodes-base.webhook',
      configuration: {
        httpMethod: 'POST',
        path: 'webhook',
        responseMode: 'responseNode',
        responseData: 'firstEntryJson',
        responseCode: 200,
        // Ensure webhook always sends response
        onError: 'continueRegularOutput',
        alwaysOutputData: true
      },
      userMustProvide: [
        {
          property: 'path',
          description: 'The webhook path'
        }
      ],
      notes: [
        'Use with a Respond to Webhook node to send custom response',
        'responseMode: responseNode requires a Respond to Webhook node'
      ]
    },
    
    'process_webhook_data': {
      task: 'process_webhook_data',
      description: 'Process incoming webhook data with Code node (shows correct data access)',
      nodeType: 'nodes-base.code',
      configuration: {
        language: 'javaScript',
        jsCode: `// ⚠️ CRITICAL: Webhook data is nested under 'body' property!
// Connect this Code node after a Webhook node

// Access webhook payload data - it's under .body, not directly under .json
const webhookData = items[0].json.body;  // ✅ CORRECT
const headers = items[0].json.headers;   // HTTP headers
const query = items[0].json.query;       // Query parameters

// Common mistake to avoid:
// const command = items[0].json.testCommand;  // ❌ WRONG - will be undefined!
// const command = items[0].json.body.testCommand;  // ✅ CORRECT

// Process the webhook data
try {
  // Validate required fields
  if (!webhookData.command) {
    throw new Error('Missing required field: command');
  }
  
  // Process based on command
  let result = {};
  switch (webhookData.command) {
    case 'process':
      result = {
        status: 'processed',
        data: webhookData.data,
        processedAt: DateTime.now().toISO()
      };
      break;
      
    case 'validate':
      result = {
        status: 'validated',
        isValid: true,
        validatedFields: Object.keys(webhookData.data || {})
      };
      break;
      
    default:
      result = {
        status: 'unknown_command',
        command: webhookData.command
      };
  }
  
  // Return processed data
  return [{
    json: {
      ...result,
      requestId: headers['x-request-id'] || crypto.randomUUID(),
      source: query.source || 'webhook',
      originalCommand: webhookData.command,
      metadata: {
        httpMethod: items[0].json.httpMethod,
        webhookPath: items[0].json.webhookPath,
        timestamp: DateTime.now().toISO()
      }
    }
  }];
  
} catch (error) {
  // Return error response
  return [{
    json: {
      status: 'error',
      error: error.message,
      timestamp: DateTime.now().toISO()
    }
  }];
}`,
        onError: 'continueRegularOutput'
      },
      userMustProvide: [],
      notes: [
        '⚠️ WEBHOOK DATA IS AT items[0].json.body, NOT items[0].json',
        'This is the most common webhook processing mistake',
        'Headers are at items[0].json.headers',
        'Query parameters are at items[0].json.query',
        'Connect this Code node directly after a Webhook node'
      ]
    },
    
    // Database Tasks
    'query_postgres': {
      task: 'query_postgres',
      description: 'Query data from PostgreSQL database',
      nodeType: 'nodes-base.postgres',
      configuration: {
        operation: 'executeQuery',
        query: '',
        // Database reads can continue on error
        onError: 'continueRegularOutput',
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 1000
      },
      userMustProvide: [
        {
          property: 'query',
          description: 'The SQL query to execute',
          example: 'SELECT * FROM users WHERE active = true LIMIT 10'
        }
      ],
      optionalEnhancements: [
        {
          property: 'additionalFields.queryParams',
          description: 'Use parameterized queries for security',
          when: 'Using dynamic values'
        }
      ],
      notes: [
        'Always use parameterized queries to prevent SQL injection',
        'Configure PostgreSQL credentials in n8n'
      ]
    },
    
    'insert_postgres_data': {
      task: 'insert_postgres_data',
      description: 'Insert data into PostgreSQL table',
      nodeType: 'nodes-base.postgres',
      configuration: {
        operation: 'insert',
        table: '',
        columns: '',
        returnFields: '*',
        // Database writes should stop on error by default
        onError: 'stopWorkflow',
        retryOnFail: true,
        maxTries: 2,
        waitBetweenTries: 1000
      },
      userMustProvide: [
        {
          property: 'table',
          description: 'The table name',
          example: 'users'
        },
        {
          property: 'columns',
          description: 'Comma-separated column names',
          example: 'name,email,created_at'
        }
      ],
      notes: [
        'Input data should match the column structure',
        'Use expressions like {{ $json.fieldName }} to map data'
      ]
    },
    
    // AI/LangChain Tasks
    'chat_with_ai': {
      task: 'chat_with_ai',
      description: 'Send a message to an AI model and get response',
      nodeType: 'nodes-base.openAi',
      configuration: {
        resource: 'chat',
        operation: 'message',
        modelId: 'gpt-3.5-turbo',
        messages: {
          values: [
            {
              role: 'user',
              content: ''
            }
          ]
        },
        // AI calls should handle rate limits and API errors
        onError: 'continueRegularOutput',
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 5000,
        alwaysOutputData: true
      },
      userMustProvide: [
        {
          property: 'messages.values[0].content',
          description: 'The message to send to the AI',
          example: '{{ $json.userMessage }}'
        }
      ],
      optionalEnhancements: [
        {
          property: 'modelId',
          description: 'Change to gpt-4 for better results'
        },
        {
          property: 'options.temperature',
          description: 'Adjust creativity (0-1)'
        },
        {
          property: 'options.maxTokens',
          description: 'Limit response length'
        }
      ]
    },
    
    'ai_agent_workflow': {
      task: 'ai_agent_workflow',
      description: 'Create an AI agent that can use tools',
      nodeType: '@n8n/n8n-nodes-langchain.agent',
      configuration: {
        promptType: 'define',
        text: '={{ $json.query }}',
        options: {
          systemMessage: 'You are a helpful assistant.'
        }
      },
      userMustProvide: [
        {
          property: 'text',
          description: 'The input prompt for the agent',
          example: '={{ $json.query }}'
        }
      ],
      optionalEnhancements: [
        {
          property: 'options.systemMessage',
          description: 'Customize the agent\'s behavior'
        }
      ],
      notes: [
        'Connect tool nodes to give the agent capabilities',
        'Configure the AI model credentials'
      ]
    },
    
    // Data Processing Tasks
    'transform_data': {
      task: 'transform_data',
      description: 'Transform data structure using JavaScript',
      nodeType: 'nodes-base.code',
      configuration: {
        language: 'javaScript',
        jsCode: `// Transform each item
const results = [];

for (const item of items) {
  results.push({
    json: {
      // Transform your data here
      id: item.json.id,
      processedAt: new Date().toISOString()
    }
  });
}

return results;`
      },
      userMustProvide: [],
      notes: [
        'Access input data via items array',
        'Each item has a json property with the data',
        'Return array of objects with json property'
      ]
    },
    
    'filter_data': {
      task: 'filter_data',
      description: 'Filter items based on conditions',
      nodeType: 'nodes-base.if',
      configuration: {
        // IF v2.2+ requires conditions.options, a combinator ('and'|'or'), and a
        // stable id per condition; see node-sanitizer.ts / n8n-validation.ts /
        // type-structures.ts for the enforced shape.
        conditions: {
          options: {
            version: 2,
            leftValue: '',
            caseSensitive: true,
            typeValidation: 'strict'
          },
          combinator: 'and',
          conditions: [
            {
              id: '1',
              leftValue: '',
              rightValue: '',
              operator: {
                type: 'string',
                operation: 'equals'
              }
            }
          ]
        }
      },
      userMustProvide: [
        {
          property: 'conditions.conditions[0].leftValue',
          description: 'The value to check',
          example: '{{ $json.status }}'
        },
        {
          property: 'conditions.conditions[0].rightValue',
          description: 'The value to compare against',
          example: 'active'
        }
      ],
      notes: [
        'True output contains matching items',
        'False output contains non-matching items'
      ]
    },
    
    // Communication Tasks
    'send_slack_message': {
      task: 'send_slack_message',
      description: 'Send a message to Slack channel',
      nodeType: 'nodes-base.slack',
      configuration: {
        resource: 'message',
        operation: 'post',
        channel: '',
        text: '',
        // Messaging can continue on error
        onError: 'continueRegularOutput',
        retryOnFail: true,
        maxTries: 2,
        waitBetweenTries: 2000
      },
      userMustProvide: [
        {
          property: 'channel',
          description: 'The Slack channel',
          example: '#general'
        },
        {
          property: 'text',
          description: 'The message text',
          example: 'New order received: {{ $json.orderId }}'
        }
      ],
      optionalEnhancements: [
        {
          property: 'attachments',
          description: 'Add rich message attachments'
        },
        {
          property: 'blocks',
          description: 'Use Block Kit for advanced formatting'
        }
      ]
    },
    
    'send_email': {
      task: 'send_email',
      description: 'Send an email notification',
      nodeType: 'nodes-base.emailSend',
      configuration: {
        fromEmail: '',
        toEmail: '',
        subject: '',
        text: '',
        // Email sending should retry on transient failures
        onError: 'continueRegularOutput',
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 3000,
        alwaysOutputData: true
      },
      userMustProvide: [
        {
          property: 'fromEmail',
          description: 'Sender email address',
          example: 'notifications@company.com'
        },
        {
          property: 'toEmail',
          description: 'Recipient email address',
          example: '{{ $json.customerEmail }}'
        },
        {
          property: 'subject',
          description: 'Email subject',
          example: 'Order Confirmation #{{ $json.orderId }}'
        },
        {
          property: 'text',
          description: 'Email body (plain text)',
          example: 'Thank you for your order!'
        }
      ],
      optionalEnhancements: [
        {
          property: 'html',
          description: 'Use HTML for rich formatting'
        },
        {
          property: 'attachments',
          description: 'Attach files to the email'
        }
      ]
    },
    
    // AI Tool Usage Tasks
    'use_google_sheets_as_tool': {
      task: 'use_google_sheets_as_tool',
      description: 'Use Google Sheets as an AI tool for reading/writing data',
      nodeType: 'nodes-base.googleSheets',
      configuration: {
        operation: 'append',
        sheetId: '={{ $fromAI("sheetId", "The Google Sheets ID") }}',
        range: '={{ $fromAI("range", "The range to append to, e.g. A:Z") }}',
        dataMode: 'autoMap'
      },
      userMustProvide: [
        {
          property: 'Google Sheets credentials',
          description: 'Configure Google Sheets API credentials in n8n'
        },
        {
          property: 'Tool name in AI Agent',
          description: 'Give it a descriptive name like "Log Results to Sheet"'
        },
        {
          property: 'Tool description',
          description: 'Describe when and how the AI should use this tool'
        }
      ],
      notes: [
        'Connect this node to the ai_tool port of an AI Agent node',
        'The AI can dynamically determine sheetId and range using $fromAI',
        'Works great for logging AI analysis results or reading data for processing'
      ]
    },
    
    'use_slack_as_tool': {
      task: 'use_slack_as_tool',
      description: 'Use Slack as an AI tool for sending notifications',
      nodeType: 'nodes-base.slack',
      configuration: {
        resource: 'message',
        operation: 'post',
        channel: '={{ $fromAI("channel", "The Slack channel, e.g. #general") }}',
        text: '={{ $fromAI("message", "The message to send") }}',
        attachments: []
      },
      userMustProvide: [
        {
          property: 'Slack credentials',
          description: 'Configure Slack OAuth2 credentials in n8n'
        },
        {
          property: 'Tool configuration in AI Agent',
          description: 'Name it something like "Send Slack Notification"'
        }
      ],
      notes: [
        'Perfect for AI agents that need to notify teams',
        'The AI determines channel and message content dynamically',
        'Can be enhanced with blocks for rich formatting'
      ]
    },
    
    'multi_tool_ai_agent': {
      task: 'multi_tool_ai_agent',
      description: 'AI agent with multiple tools for complex automation',
      nodeType: '@n8n/n8n-nodes-langchain.agent',
      configuration: {
        promptType: 'define',
        text: '={{ $json.query }}',
        options: {
          systemMessage: 'You are an intelligent assistant with access to multiple tools. Use them wisely to complete tasks.'
        }
      },
      userMustProvide: [
        {
          property: 'AI model credentials',
          description: 'OpenAI, Anthropic, or other LLM credentials'
        },
        {
          property: 'Multiple tool nodes',
          description: 'Connect various nodes to the ai_tool port'
        },
        {
          property: 'Tool descriptions',
          description: 'Clear descriptions for each connected tool'
        }
      ],
      optionalEnhancements: [
        {
          property: 'Memory',
          description: 'Add memory nodes for conversation context'
        },
        {
          property: 'Custom tools',
          description: 'Create Code nodes as custom tools'
        }
      ],
      notes: [
        'Connect multiple nodes: HTTP Request, Slack, Google Sheets, etc.',
        'Each tool should have a clear, specific purpose',
        'Test each tool individually before combining',
        'Set N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true for community nodes'
      ]
    },
    
    // Error Handling Templates
    'api_call_with_retry': {
      task: 'api_call_with_retry',
      description: 'Resilient API call with automatic retry on failure',
      nodeType: 'nodes-base.httpRequest',
      configuration: {
        method: 'GET',
        url: '',
        // Retry configuration for transient failures
        retryOnFail: true,
        maxTries: 5,
        waitBetweenTries: 2000,
        // Always capture response for debugging
        alwaysOutputData: true,
        // Add request tracking
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: 'X-Request-ID',
              value: '={{ $workflow.id }}-{{ $itemIndex }}'
            }
          ]
        }
      },
      userMustProvide: [
        {
          property: 'url',
          description: 'The API endpoint to call',
          example: 'https://api.example.com/resource/{{ $json.id }}'
        }
      ],
      optionalEnhancements: [
        {
          property: 'authentication',
          description: 'Add API authentication'
        },
        {
          property: 'onError',
          description: 'Change to "stopWorkflow" for critical API calls',
          when: 'This is a critical API call that must succeed'
        }
      ],
      notes: [
        'Retries help with rate limits and transient network issues',
        'waitBetweenTries prevents hammering the API',
        'alwaysOutputData captures error responses for debugging',
        'Consider exponential backoff for production use'
      ]
    },
    
    'fault_tolerant_processing': {
      task: 'fault_tolerant_processing',
      description: 'Data processing that continues despite individual item failures',
      nodeType: 'nodes-base.code',
      configuration: {
        language: 'javaScript',
        jsCode: `// Process items with error handling
const results = [];

for (const item of items) {
  try {
    // Your processing logic here
    const processed = {
      ...item.json,
      processed: true,
      timestamp: new Date().toISOString()
    };
    
    results.push({ json: processed });
  } catch (error) {
    // Log error but continue processing
    console.error('Processing failed for item:', item.json.id, error);
    
    // Add error item to results
    results.push({
      json: {
        ...item.json,
        error: error.message,
        processed: false
      }
    });
  }
}

return results;`,
        // Continue workflow even if code fails entirely
        onError: 'continueRegularOutput',
        alwaysOutputData: true
      },
      userMustProvide: [
        {
          property: 'Processing logic',
          description: 'Replace the comment with your data transformation logic'
        }
      ],
      optionalEnhancements: [
        {
          property: 'Error notification',
          description: 'Add IF node after to handle error items separately'
        }
      ],
      notes: [
        'Individual item failures won\'t stop processing of other items',
        'Error items are marked and can be handled separately',
        'continueOnFail ensures workflow continues even on total failure'
      ]
    },
    
    'webhook_with_error_handling': {
      task: 'webhook_with_error_handling',
      description: 'Webhook that gracefully handles processing errors',
      nodeType: 'nodes-base.webhook',
      configuration: {
        httpMethod: 'POST',
        path: 'resilient-webhook',
        responseMode: 'responseNode',
        responseData: 'firstEntryJson',
        // Always continue to ensure response is sent
        onError: 'continueRegularOutput',
        alwaysOutputData: true
      },
      userMustProvide: [
        {
          property: 'path',
          description: 'Unique webhook path',
          example: 'order-processor'
        },
        {
          property: 'Respond to Webhook node',
          description: 'Add node to send appropriate success/error responses'
        }
      ],
      optionalEnhancements: [
        {
          property: 'Validation',
          description: 'Add IF node to validate webhook payload'
        },
        {
          property: 'Error logging',
          description: 'Add error handler node for failed requests'
        }
      ],
      notes: [
        'onError: continueRegularOutput ensures webhook always sends a response',
        'Use Respond to Webhook node to send appropriate status codes',
        'Log errors but don\'t expose internal errors to webhook callers',
        'Consider rate limiting for public webhooks'
      ]
    },
    
    // Modern Error Handling Patterns
    'modern_error_handling_patterns': {
      task: 'modern_error_handling_patterns',
      description: 'Examples of modern error handling using onError property',
      nodeType: 'nodes-base.httpRequest',
      configuration: {
        method: 'GET',
        url: '',
        // Modern error handling approach
        onError: 'continueRegularOutput', // Options: continueRegularOutput, continueErrorOutput, stopWorkflow
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 2000,
        alwaysOutputData: true
      },
      userMustProvide: [
        {
          property: 'url',
          description: 'The API endpoint'
        },
        {
          property: 'onError',
          description: 'Choose error handling strategy',
          example: 'continueRegularOutput'
        }
      ],
      notes: [
        'onError replaces the deprecated continueOnFail property',
        'continueRegularOutput: Continue with normal output on error',
        'continueErrorOutput: Route errors to error output for special handling', 
        'stopWorkflow: Stop the entire workflow on error',
        'Combine with retryOnFail for resilient workflows'
      ]
    },
    
    'database_transaction_safety': {
      task: 'database_transaction_safety',
      description: 'Database operations with proper error handling',
      nodeType: 'nodes-base.postgres',
      configuration: {
        operation: 'executeQuery',
        query: 'BEGIN; INSERT INTO orders ...; COMMIT;',
        // For transactions, don\'t retry automatically
        onError: 'continueErrorOutput',
        retryOnFail: false,
        alwaysOutputData: true
      },
      userMustProvide: [
        {
          property: 'query',
          description: 'Your SQL query or transaction'
        }
      ],
      notes: [
        'Transactions should not be retried automatically',
        'Use continueErrorOutput to handle errors separately',
        'Consider implementing compensating transactions',
        'Always log transaction failures for audit'
      ]
    },
    
    'ai_rate_limit_handling': {
      task: 'ai_rate_limit_handling',
      description: 'AI API calls with rate limit handling',
      nodeType: 'nodes-base.openAi',
      configuration: {
        resource: 'chat',
        operation: 'message',
        modelId: 'gpt-4',
        messages: {
          values: [
            {
              role: 'user',
              content: ''
            }
          ]
        },
        // Handle rate limits with exponential backoff
        onError: 'continueRegularOutput',
        retryOnFail: true,
        maxTries: 5,
        waitBetweenTries: 5000,
        alwaysOutputData: true
      },
      userMustProvide: [
        {
          property: 'messages.values[0].content',
          description: 'The prompt for the AI'
        }
      ],
      notes: [
        'AI APIs often have rate limits',
        'Longer wait times help avoid hitting limits',
        'Consider implementing exponential backoff in Code node',
        'Monitor usage to stay within quotas'
      ]
    },
    
    // Code Node Tasks
    'custom_ai_tool': {
      task: 'custom_ai_tool',
      description: 'Create a custom tool for AI agents using Code node',
      nodeType: 'nodes-base.code',
      configuration: {
        language: 'javaScript',
        mode: 'runOnceForEachItem',
        jsCode: `// Custom AI Tool - Example: Text Analysis
// This code will be called by AI agents with $json containing the input

// Access the input from the AI agent
const text = $json.text || '';
const operation = $json.operation || 'analyze';

// Perform the requested operation
let result = {};

switch (operation) {
  case 'wordCount':
    result = {
      wordCount: text.split(/\\s+/).filter(word => word.length > 0).length,
      characterCount: text.length,
      lineCount: text.split('\\n').length
    };
    break;
    
  case 'extract':
    // Extract specific patterns (emails, URLs, etc.)
    result = {
      emails: text.match(/[\\w.-]+@[\\w.-]+\\.\\w+/g) || [],
      urls: text.match(/https?:\\/\\/[^\\s]+/g) || [],
      numbers: text.match(/\\b\\d+\\b/g) || []
    };
    break;
    
  default:
    result = {
      error: 'Unknown operation',
      availableOperations: ['wordCount', 'extract']
    };
}

return [{
  json: {
    ...result,
    originalText: text,
    operation: operation,
    processedAt: DateTime.now().toISO()
  }
}];`,
        onError: 'continueRegularOutput'
      },
      userMustProvide: [],
      notes: [
        'Connect this to AI Agent node\'s tool input',
        'AI will pass data in $json',
        'Use "Run Once for Each Item" mode for AI tools',
        'Return structured data the AI can understand'
      ]
    },
    
    'aggregate_data': {
      task: 'aggregate_data',
      description: 'Aggregate data from multiple items into summary statistics',
      nodeType: 'nodes-base.code',
      configuration: {
        language: 'javaScript',
        jsCode: `// Aggregate data from all items
const stats = {
  count: 0,
  sum: 0,
  min: Infinity,
  max: -Infinity,
  values: [],
  categories: {},
  errors: []
};

// Process each item
for (const item of items) {
  try {
    const value = item.json.value || item.json.amount || 0;
    const category = item.json.category || 'uncategorized';
    
    stats.count++;
    stats.sum += value;
    stats.min = Math.min(stats.min, value);
    stats.max = Math.max(stats.max, value);
    stats.values.push(value);
    
    // Count by category
    stats.categories[category] = (stats.categories[category] || 0) + 1;
    
  } catch (error) {
    stats.errors.push({
      item: item.json,
      error: error.message
    });
  }
}

// Calculate additional statistics
const average = stats.count > 0 ? stats.sum / stats.count : 0;
const sorted = [...stats.values].sort((a, b) => a - b);
const median = sorted.length > 0 
  ? sorted[Math.floor(sorted.length / 2)] 
  : 0;

return [{
  json: {
    totalItems: stats.count,
    sum: stats.sum,
    average: average,
    median: median,
    min: stats.min === Infinity ? 0 : stats.min,
    max: stats.max === -Infinity ? 0 : stats.max,
    categoryCounts: stats.categories,
    errorCount: stats.errors.length,
    errors: stats.errors,
    processedAt: DateTime.now().toISO()
  }
}];`,
        onError: 'continueRegularOutput'
      },
      userMustProvide: [],
      notes: [
        'Assumes items have "value" or "amount" field',
        'Groups by "category" field if present',
        'Returns single item with all statistics',
        'Handles errors gracefully'
      ]
    },
    
    'batch_process_with_api': {
      task: 'batch_process_with_api',
      description: 'Process items in batches with API calls',
      nodeType: 'nodes-base.code',
      configuration: {
        language: 'javaScript',
        jsCode: `// Batch process items with API calls
const BATCH_SIZE = 10;
const API_URL = 'https://api.example.com/batch-process'; // USER MUST UPDATE
const results = [];

// Process items in batches
for (let i = 0; i < items.length; i += BATCH_SIZE) {
  const batch = items.slice(i, i + BATCH_SIZE);
  
  try {
    // Prepare batch data
    const batchData = batch.map(item => ({
      id: item.json.id,
      data: item.json
    }));
    
    // Make API request for batch
    const response = await $helpers.httpRequest({
      method: 'POST',
      url: API_URL,
      body: {
        items: batchData
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // Add results
    if (response.results && Array.isArray(response.results)) {
      response.results.forEach((result, index) => {
        results.push({
          json: {
            ...batch[index].json,
            ...result,
            batchNumber: Math.floor(i / BATCH_SIZE) + 1,
            processedAt: DateTime.now().toISO()
          }
        });
      });
    }
    
    // Add delay between batches to avoid rate limits
    if (i + BATCH_SIZE < items.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
  } catch (error) {
    // Add failed batch items with error
    batch.forEach(item => {
      results.push({
        json: {
          ...item.json,
          error: error.message,
          status: 'failed',
          batchNumber: Math.floor(i / BATCH_SIZE) + 1
        }
      });
    });
  }
}

return results;`,
        onError: 'continueRegularOutput',
        retryOnFail: true,
        maxTries: 2
      },
      userMustProvide: [
        {
          property: 'jsCode',
          description: 'Update API_URL in the code',
          example: 'https://your-api.com/batch'
        }
      ],
      notes: [
        'Processes items in batches of 10',
        'Includes delay between batches',
        'Handles batch failures gracefully',
        'Update API_URL and adjust BATCH_SIZE as needed'
      ]
    },
    
    'error_safe_transform': {
      task: 'error_safe_transform',
      description: 'Transform data with comprehensive error handling',
      nodeType: 'nodes-base.code',
      configuration: {
        language: 'javaScript',
        jsCode: `// Safe data transformation with validation
const results = [];
const errors = [];

for (const item of items) {
  try {
    // Validate required fields
    const required = ['id', 'name']; // USER SHOULD UPDATE
    const missing = required.filter(field => !item.json[field]);
    
    if (missing.length > 0) {
      throw new Error(\`Missing required fields: \${missing.join(', ')}\`);
    }
    
    // Transform data with type checking
    const transformed = {
      // Ensure ID is string
      id: String(item.json.id),
      
      // Clean and validate name
      name: String(item.json.name).trim(),
      
      // Parse numbers safely
      amount: parseFloat(item.json.amount) || 0,
      
      // Parse dates safely
      date: item.json.date 
        ? DateTime.fromISO(item.json.date).isValid 
          ? DateTime.fromISO(item.json.date).toISO()
          : null
        : null,
      
      // Boolean conversion
      isActive: Boolean(item.json.active || item.json.isActive),
      
      // Array handling
      tags: Array.isArray(item.json.tags) 
        ? item.json.tags.filter(tag => typeof tag === 'string')
        : [],
      
      // Nested object handling
      metadata: typeof item.json.metadata === 'object' 
        ? item.json.metadata 
        : {},
      
      // Add processing info
      processedAt: DateTime.now().toISO(),
      originalIndex: items.indexOf(item)
    };
    
    results.push({
      json: transformed
    });
    
  } catch (error) {
    errors.push({
      json: {
        error: error.message,
        originalData: item.json,
        index: items.indexOf(item),
        status: 'failed'
      }
    });
  }
}

// Add summary at the end
results.push({
  json: {
    _summary: {
      totalProcessed: results.length - errors.length,
      totalErrors: errors.length,
      successRate: ((results.length - errors.length) / items.length * 100).toFixed(2) + '%',
      timestamp: DateTime.now().toISO()
    }
  }
});

// Include errors at the end
return [...results, ...errors];`,
        onError: 'continueRegularOutput'
      },
      userMustProvide: [
        {
          property: 'jsCode',
          description: 'Update required fields array',
          example: "const required = ['id', 'email', 'name'];"
        }
      ],
      notes: [
        'Validates all data types',
        'Handles missing/invalid data gracefully',
        'Returns both successful and failed items',
        'Includes processing summary'
      ]
    },
    
    'async_data_processing': {
      task: 'async_data_processing',
      description: 'Process data with async operations and proper error handling',
      nodeType: 'nodes-base.code',
      configuration: {
        language: 'javaScript',
        jsCode: `// Async processing with concurrent limits
const CONCURRENT_LIMIT = 5;
const results = [];

// Process items with concurrency control
async function processItem(item, index) {
  try {
    // Simulate async operation (replace with actual logic)
    // Example: API call, database query, file operation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Actual processing logic here
    const processed = {
      ...item.json,
      processed: true,
      index: index,
      timestamp: DateTime.now().toISO()
    };
    
    // Example async operation - external API call
    if (item.json.needsEnrichment) {
      const enrichment = await $helpers.httpRequest({
        method: 'GET',
        url: \`https://api.example.com/enrich/\${item.json.id}\`
      });
      processed.enrichment = enrichment;
    }
    
    return { json: processed };
    
  } catch (error) {
    return {
      json: {
        ...item.json,
        error: error.message,
        status: 'failed',
        index: index
      }
    };
  }
}

// Process in batches with concurrency limit
for (let i = 0; i < items.length; i += CONCURRENT_LIMIT) {
  const batch = items.slice(i, i + CONCURRENT_LIMIT);
  const batchPromises = batch.map((item, batchIndex) => 
    processItem(item, i + batchIndex)
  );
  
  const batchResults = await Promise.all(batchPromises);
  results.push(...batchResults);
}

return results;`,
        onError: 'continueRegularOutput',
        retryOnFail: true,
        maxTries: 2
      },
      userMustProvide: [],
      notes: [
        'Processes 5 items concurrently',
        'Prevents overwhelming external services',
        'Each item processed independently',
        'Errors don\'t affect other items'
      ]
    },
    
    'python_data_analysis': {
      task: 'python_data_analysis',
      description: 'Analyze data using Python with statistics',
      nodeType: 'nodes-base.code',
      configuration: {
        language: 'python',
        pythonCode: `# Python data analysis - use underscore prefix for built-in variables
import json
from datetime import datetime
import statistics

# Collect data for analysis
values = []
categories = {}
dates = []

# Use _input.all() to get items in Python
for item in _input.all():
    # Convert JsProxy to Python dict for safe access
    item_data = item.json.to_py()
    
    # Extract numeric values
    if 'value' in item_data or 'amount' in item_data:
        value = item_data.get('value', item_data.get('amount', 0))
        if isinstance(value, (int, float)):
            values.append(value)
    
    # Count categories
    category = item_data.get('category', 'uncategorized')
    categories[category] = categories.get(category, 0) + 1
    
    # Collect dates
    if 'date' in item_data:
        dates.append(item_data['date'])

# Calculate statistics
result = {
    'itemCount': len(_input.all()),
    'values': {
        'count': len(values),
        'sum': sum(values) if values else 0,
        'mean': statistics.mean(values) if values else 0,
        'median': statistics.median(values) if values else 0,
        'min': min(values) if values else 0,
        'max': max(values) if values else 0,
        'stdev': statistics.stdev(values) if len(values) > 1 else 0
    },
    'categories': categories,
    'dateRange': {
        'earliest': min(dates) if dates else None,
        'latest': max(dates) if dates else None,
        'count': len(dates)
    },
    'analysis': {
        'hasNumericData': len(values) > 0,
        'hasCategoricalData': len(categories) > 0,
        'hasTemporalData': len(dates) > 0,
        'dataQuality': 'good' if len(values) > len(items) * 0.8 else 'partial'
    },
    'processedAt': datetime.now().isoformat()
}

# Return single summary item
return [{'json': result}]`,
        onError: 'continueRegularOutput'
      },
      userMustProvide: [],
      notes: [
        'Uses Python statistics module',
        'Analyzes numeric, categorical, and date data',
        'Returns comprehensive summary',
        'Handles missing data gracefully'
      ]
    }
  };
  
  /**
   * Get all available tasks
   */
  static getAllTasks(): string[] {
    return Object.keys(this.templates);
  }
  
  /**
   * Get tasks for a specific node type
   */
  static getTasksForNode(nodeType: string): string[] {
    return Object.entries(this.templates)
      .filter(([_, template]) => template.nodeType === nodeType)
      .map(([task, _]) => task);
  }
  
  /**
   * Get a specific task template
   */
  static getTaskTemplate(task: string): TaskTemplate | undefined {
    return this.templates[task];
  }
  
  /**
   * Get a specific task template (alias for getTaskTemplate)
   */
  static getTemplate(task: string): TaskTemplate | undefined {
    return this.getTaskTemplate(task);
  }
  
  /**
   * Search for tasks by keyword
   */
  static searchTasks(keyword: string): string[] {
    const lower = keyword.toLowerCase();
    return Object.entries(this.templates)
      .filter(([task, template]) => 
        task.toLowerCase().includes(lower) ||
        template.description.toLowerCase().includes(lower) ||
        template.nodeType.toLowerCase().includes(lower)
      )
      .map(([task, _]) => task);
  }
  
  /**
   * Get task categories
   */
  static getTaskCategories(): Record<string, string[]> {
    return {
      'HTTP/API': ['get_api_data', 'post_json_request', 'call_api_with_auth', 'api_call_with_retry'],
      'Webhooks': ['receive_webhook', 'webhook_with_response', 'webhook_with_error_handling', 'process_webhook_data'],
      'Database': ['query_postgres', 'insert_postgres_data', 'database_transaction_safety'],
      'AI/LangChain': ['chat_with_ai', 'ai_agent_workflow', 'multi_tool_ai_agent', 'ai_rate_limit_handling'],
      'Data Processing': ['transform_data', 'filter_data', 'fault_tolerant_processing', 'process_webhook_data'],
      'Communication': ['send_slack_message', 'send_email'],
      'AI Tool Usage': ['use_google_sheets_as_tool', 'use_slack_as_tool', 'multi_tool_ai_agent'],
      'Error Handling': ['modern_error_handling_patterns', 'api_call_with_retry', 'fault_tolerant_processing', 'webhook_with_error_handling', 'database_transaction_safety', 'ai_rate_limit_handling']
    };
  }
}