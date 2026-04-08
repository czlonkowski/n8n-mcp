/**
 * Shared handler for the `n8n-mcp telemetry enable|disable|status` CLI
 * subcommands. Called from two places:
 *
 * 1. `src/mcp/index.ts` — covers direct `node dist/mcp/index.js telemetry ...`
 *    invocations and any pre-fix binaries still in the wild.
 * 2. `src/mcp/stdio-wrapper.ts` — the published bin entry. The wrapper calls
 *    this BEFORE its console-suppression and `MCP_MODE=stdio` setup so the
 *    status/help output still reaches the user (see Issues #693 and #711).
 *
 * Returns without side effects when `args` does not begin with `telemetry`;
 * calls `process.exit()` otherwise.
 */
export function handleTelemetryCliIfPresent(args: string[]): void {
  if (args.length === 0 || args[0] !== 'telemetry') return;

  // Lazy-require so the stdio hot path does not load TelemetryConfigManager
  // when the wrapper is invoked without a CLI subcommand.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TelemetryConfigManager } = require('./config-manager');
  const telemetryConfig = TelemetryConfigManager.getInstance();
  const action = args[1];

  switch (action) {
    case 'enable':
      telemetryConfig.enable();
      process.exit(0);
    case 'disable':
      telemetryConfig.disable();
      process.exit(0);
    case 'status':
      console.log(telemetryConfig.getStatus());
      process.exit(0);
    default:
      console.log(`
Usage: n8n-mcp telemetry [command]

Commands:
  enable   Enable anonymous telemetry
  disable  Disable anonymous telemetry
  status   Show current telemetry status

Learn more: https://github.com/czlonkowski/n8n-mcp/blob/main/PRIVACY.md
`);
      process.exit(action ? 1 : 0);
  }
}
