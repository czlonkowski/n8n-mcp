#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
{
    const { handleTelemetryCliIfPresent } = require('../telemetry/telemetry-cli');
    handleTelemetryCliIfPresent(process.argv.slice(2));
}
process.env.MCP_MODE = 'stdio';
process.env.DISABLE_CONSOLE_OUTPUT = 'true';
process.env.LOG_LEVEL = 'error';
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;
const originalConsoleDebug = console.debug;
const originalConsoleTrace = console.trace;
const originalConsoleDir = console.dir;
const originalConsoleTime = console.time;
const originalConsoleTimeEnd = console.timeEnd;
console.log = () => { };
console.error = () => { };
console.warn = () => { };
console.info = () => { };
console.debug = () => { };
console.trace = () => { };
console.dir = () => { };
console.time = () => { };
console.timeEnd = () => { };
console.timeLog = () => { };
console.group = () => { };
console.groupEnd = () => { };
console.table = () => { };
console.clear = () => { };
console.count = () => { };
console.countReset = () => { };
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const stderrWrite = process.stderr.write.bind(process.stderr);
process.stdout.write = function (chunk, encodingOrCallback, callback) {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    const trimmed = str.trimStart();
    if (trimmed.startsWith('{') && trimmed.includes('"jsonrpc"')) {
        return originalStdoutWrite(chunk, encodingOrCallback, callback);
    }
    return stderrWrite(chunk, encodingOrCallback, callback);
};
const server_1 = require("./server");
let server = null;
async function main() {
    try {
        server = new server_1.N8NDocumentationMCPServer();
        await server.run();
    }
    catch (error) {
        originalConsoleError('Fatal error:', error);
        process.exit(1);
    }
}
process.on('uncaughtException', (error) => {
    originalConsoleError('Uncaught exception:', error);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    originalConsoleError('Unhandled rejection:', reason);
    process.exit(1);
});
let isShuttingDown = false;
async function shutdown(signal) {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    originalConsoleError(`Received ${signal}, shutting down gracefully...`);
    try {
        if (server) {
            await server.shutdown();
        }
    }
    catch (error) {
        originalConsoleError('Error during shutdown:', error);
    }
    process.stdin.pause();
    process.stdin.destroy();
    setTimeout(() => {
        process.exit(0);
    }, 500).unref();
    process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGHUP', () => void shutdown('SIGHUP'));
process.stdin.on('end', () => {
    originalConsoleError('stdin closed, shutting down...');
    void shutdown('STDIN_CLOSE');
});
main();
//# sourceMappingURL=stdio-wrapper.js.map