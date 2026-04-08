#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./server");
const logger_1 = require("../utils/logger");
const telemetry_cli_1 = require("../telemetry/telemetry-cli");
const early_error_logger_1 = require("../telemetry/early-error-logger");
const startup_checkpoints_1 = require("../telemetry/startup-checkpoints");
const fs_1 = require("fs");
process.on('uncaughtException', (error) => {
    if (process.env.MCP_MODE !== 'stdio') {
        console.error('Uncaught Exception:', error);
    }
    logger_1.logger.error('Uncaught Exception:', error);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    if (process.env.MCP_MODE !== 'stdio') {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    }
    logger_1.logger.error('Unhandled Rejection:', reason);
    process.exit(1);
});
function isContainerEnvironment() {
    const dockerEnv = (process.env.IS_DOCKER || '').toLowerCase();
    const containerEnv = (process.env.IS_CONTAINER || '').toLowerCase();
    if (['true', '1', 'yes'].includes(dockerEnv)) {
        return true;
    }
    if (['true', '1', 'yes'].includes(containerEnv)) {
        return true;
    }
    try {
        return (0, fs_1.existsSync)('/.dockerenv') || (0, fs_1.existsSync)('/run/.containerenv');
    }
    catch (error) {
        logger_1.logger.debug('Container detection filesystem check failed:', error);
        return false;
    }
}
async function main() {
    const startTime = Date.now();
    const earlyLogger = early_error_logger_1.EarlyErrorLogger.getInstance();
    const checkpoints = [];
    try {
        earlyLogger.logCheckpoint(startup_checkpoints_1.STARTUP_CHECKPOINTS.PROCESS_STARTED);
        checkpoints.push(startup_checkpoints_1.STARTUP_CHECKPOINTS.PROCESS_STARTED);
        (0, telemetry_cli_1.handleTelemetryCliIfPresent)(process.argv.slice(2));
        const mode = process.env.MCP_MODE || 'stdio';
        earlyLogger.logCheckpoint(startup_checkpoints_1.STARTUP_CHECKPOINTS.TELEMETRY_INITIALIZING);
        checkpoints.push(startup_checkpoints_1.STARTUP_CHECKPOINTS.TELEMETRY_INITIALIZING);
        earlyLogger.logCheckpoint(startup_checkpoints_1.STARTUP_CHECKPOINTS.TELEMETRY_READY);
        checkpoints.push(startup_checkpoints_1.STARTUP_CHECKPOINTS.TELEMETRY_READY);
        try {
            if (mode === 'http') {
                console.error(`Starting n8n Documentation MCP Server in ${mode} mode...`);
                console.error('Current directory:', process.cwd());
                console.error('Node version:', process.version);
            }
            earlyLogger.logCheckpoint(startup_checkpoints_1.STARTUP_CHECKPOINTS.MCP_HANDSHAKE_STARTING);
            checkpoints.push(startup_checkpoints_1.STARTUP_CHECKPOINTS.MCP_HANDSHAKE_STARTING);
            if (mode === 'http') {
                if (process.env.USE_FIXED_HTTP === 'true') {
                    logger_1.logger.warn('DEPRECATION WARNING: USE_FIXED_HTTP=true is deprecated as of v2.31.8. ' +
                        'The fixed HTTP implementation does not support SSE streaming required by clients like OpenAI Codex. ' +
                        'Please unset USE_FIXED_HTTP to use the modern SingleSessionHTTPServer which supports both JSON-RPC and SSE. ' +
                        'This option will be removed in a future version. See: https://github.com/czlonkowski/n8n-mcp/issues/524');
                    console.warn('\n⚠️  DEPRECATION WARNING ⚠️');
                    console.warn('USE_FIXED_HTTP=true is deprecated as of v2.31.8.');
                    console.warn('The fixed HTTP implementation does not support SSE streaming.');
                    console.warn('Please unset USE_FIXED_HTTP to use SingleSessionHTTPServer.');
                    console.warn('See: https://github.com/czlonkowski/n8n-mcp/issues/524\n');
                    const { startFixedHTTPServer } = await Promise.resolve().then(() => __importStar(require('../http-server')));
                    await startFixedHTTPServer();
                }
                else {
                    const { SingleSessionHTTPServer } = await Promise.resolve().then(() => __importStar(require('../http-server-single-session')));
                    const server = new SingleSessionHTTPServer();
                    const shutdown = async () => {
                        await server.shutdown();
                        process.exit(0);
                    };
                    process.on('SIGTERM', shutdown);
                    process.on('SIGINT', shutdown);
                    await server.start();
                }
            }
            else {
                const server = new server_1.N8NDocumentationMCPServer(undefined, earlyLogger);
                let isShuttingDown = false;
                const shutdown = async (signal = 'UNKNOWN') => {
                    if (isShuttingDown)
                        return;
                    isShuttingDown = true;
                    try {
                        logger_1.logger.info(`Shutdown initiated by: ${signal}`);
                        await server.shutdown();
                        if (process.stdin && !process.stdin.destroyed) {
                            process.stdin.pause();
                            process.stdin.destroy();
                        }
                        setTimeout(() => {
                            logger_1.logger.warn('Shutdown timeout exceeded, forcing exit');
                            process.exit(0);
                        }, 1000).unref();
                    }
                    catch (error) {
                        logger_1.logger.error('Error during shutdown:', error);
                        process.exit(1);
                    }
                };
                process.on('SIGTERM', () => shutdown('SIGTERM'));
                process.on('SIGINT', () => shutdown('SIGINT'));
                process.on('SIGHUP', () => shutdown('SIGHUP'));
                const isContainer = isContainerEnvironment();
                if (!isContainer && process.stdin.readable && !process.stdin.destroyed) {
                    try {
                        process.stdin.on('end', () => shutdown('STDIN_END'));
                        process.stdin.on('close', () => shutdown('STDIN_CLOSE'));
                    }
                    catch (error) {
                        logger_1.logger.error('Failed to register stdin handlers, using signal handlers only:', error);
                    }
                }
                await server.run();
            }
            earlyLogger.logCheckpoint(startup_checkpoints_1.STARTUP_CHECKPOINTS.MCP_HANDSHAKE_COMPLETE);
            checkpoints.push(startup_checkpoints_1.STARTUP_CHECKPOINTS.MCP_HANDSHAKE_COMPLETE);
            earlyLogger.logCheckpoint(startup_checkpoints_1.STARTUP_CHECKPOINTS.SERVER_READY);
            checkpoints.push(startup_checkpoints_1.STARTUP_CHECKPOINTS.SERVER_READY);
            const startupDuration = Date.now() - startTime;
            earlyLogger.logStartupSuccess(checkpoints, startupDuration);
            logger_1.logger.info(`Server startup completed in ${startupDuration}ms (${checkpoints.length} checkpoints passed)`);
        }
        catch (error) {
            const failedCheckpoint = (0, startup_checkpoints_1.findFailedCheckpoint)(checkpoints);
            earlyLogger.logStartupError(failedCheckpoint, error);
            if (mode !== 'stdio') {
                console.error('Failed to start MCP server:', error);
                logger_1.logger.error('Failed to start MCP server', error);
                if (error instanceof Error && error.message.includes('nodes.db not found')) {
                    console.error('\nTo fix this issue:');
                    console.error('1. cd to the n8n-mcp directory');
                    console.error('2. Run: npm run build');
                    console.error('3. Run: npm run rebuild');
                }
                else if (error instanceof Error && error.message.includes('NODE_MODULE_VERSION')) {
                    console.error('\nTo fix this Node.js version mismatch:');
                    console.error('1. cd to the n8n-mcp directory');
                    console.error('2. Run: npm rebuild better-sqlite3');
                    console.error('3. If that doesn\'t work, try: rm -rf node_modules && npm install');
                }
            }
            process.exit(1);
        }
    }
    catch (outerError) {
        logger_1.logger.error('Critical startup error:', outerError);
        process.exit(1);
    }
}
if (require.main === module) {
    main().catch(console.error);
}
//# sourceMappingURL=index.js.map