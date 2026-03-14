import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { N8NDocumentationMCPServer } from '../../../src/mcp/server';

let sharedMcpServer: N8NDocumentationMCPServer | null = null;

export class TestableN8NMCPServer {
  private mcpServer: N8NDocumentationMCPServer;
  private server: Server;
  private transports = new Set<Transport>();
  private static instanceCount = 0;
  private testDbPath: string;

  constructor() {
    // Use path.resolve to produce a canonical absolute path so the shared
    // database singleton always sees the exact same string, preventing
    // "Shared database already initialized with different path" errors.
    const path = require('path');
    this.testDbPath = path.resolve(process.cwd(), 'data', 'nodes.db');
    process.env.NODE_DB_PATH = this.testDbPath;

    this.server = this.createServer();

    this.mcpServer = new N8NDocumentationMCPServer();
    this.setupHandlers(this.server);
  }

  /**
   * Create a fresh MCP SDK Server instance.
   * MCP SDK 1.27+ enforces single-connection per Protocol instance,
   * so we create a new one each time we need to connect to a transport.
   */
  private createServer(): Server {
    return new Server({
      name: 'n8n-documentation-mcp',
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {}
      }
    });
  }

  private setupHandlers(server: Server) {
    // Initialize handler
    server.setRequestHandler(InitializeRequestSchema, async () => {
      return {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'n8n-documentation-mcp',
          version: '1.0.0'
        }
      };
    });

    // List tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Import the tools directly from the tools module
      const { n8nDocumentationToolsFinal } = await import('../../../src/mcp/tools');
      const { n8nManagementTools } = await import('../../../src/mcp/tools-n8n-manager');
      const { isN8nApiConfigured } = await import('../../../src/config/n8n-api');

      // Combine documentation tools with management tools if API is configured
      const tools = [...n8nDocumentationToolsFinal];
      if (isN8nApiConfigured()) {
        tools.push(...n8nManagementTools);
      }

      return { tools };
    });

    // Call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        // The mcpServer.executeTool returns raw data, we need to wrap it in the MCP response format
        const result = await this.mcpServer.executeTool(request.params.name, request.params.arguments || {});

        return {
          content: [
            {
              type: 'text' as const,
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error: any) {
        // If it's already an MCP error, throw it as is
        if (error.code && error.message) {
          throw error;
        }
        // Otherwise, wrap it in an MCP error
        throw new McpError(
          ErrorCode.InternalError,
          error.message || 'Unknown error'
        );
      }
    });
  }

  async initialize(): Promise<void> {
    // The MCP server initializes its database lazily via the shared
    // database singleton. Trigger initialization by calling executeTool.
    try {
      await this.mcpServer.executeTool('tools_documentation', {});
    } catch (error) {
      // Ignore errors, we just want to trigger initialization
    }
  }

  async connectToTransport(transport: Transport): Promise<void> {
    // Ensure transport has required properties before connecting
    if (!transport || typeof transport !== 'object') {
      throw new Error('Invalid transport provided');
    }

    // MCP SDK 1.27+ enforces single-connection per Protocol instance.
    // Close the current server and create a fresh one so that _transport
    // is guaranteed to be undefined. Reusing the same Server after close()
    // is unreliable because _transport is cleared asynchronously via the
    // transport onclose callback chain, which can fail in CI.
    try {
      await this.server.close();
    } catch {
      // Ignore errors during cleanup of previous transport
    }

    // Create a brand-new Server instance for this connection
    this.server = this.createServer();
    this.setupHandlers(this.server);

    // Track this transport for cleanup
    this.transports.add(transport);

    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    // Use a timeout to prevent hanging during cleanup
    const closeTimeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn('TestableN8NMCPServer close timeout - forcing cleanup');
        resolve();
      }, 3000);
    });

    const performClose = async () => {
      // Close the MCP SDK Server (resets _transport via _onclose)
      try {
        await this.server.close();
      } catch {
        // Ignore errors during server close
      }

      // Shut down the inner N8NDocumentationMCPServer to release the
      // shared database reference and prevent resource leaks.
      try {
        await this.mcpServer.shutdown();
      } catch {
        // Ignore errors during inner server shutdown
      }

      // Close all tracked transports with timeout protection
      const transportPromises: Promise<void>[] = [];

      for (const transport of this.transports) {
        const transportTimeout = new Promise<void>((resolve) => setTimeout(resolve, 500));

        try {
          const transportAny = transport as any;
          if (transportAny.close && typeof transportAny.close === 'function') {
            transportPromises.push(
              Promise.race([transportAny.close(), transportTimeout])
            );
          }
        } catch {
          // Ignore errors during transport cleanup
        }
      }

      await Promise.allSettled(transportPromises);
      this.transports.clear();
    };

    // Race between actual close and timeout
    await Promise.race([performClose(), closeTimeout]);
  }

  static async shutdownShared(): Promise<void> {
    if (sharedMcpServer) {
      await sharedMcpServer.shutdown();
      sharedMcpServer = null;
    }
  }
}