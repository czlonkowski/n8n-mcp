"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleTelemetryCliIfPresent = handleTelemetryCliIfPresent;
function handleTelemetryCliIfPresent(args) {
    if (args.length === 0 || args[0] !== 'telemetry')
        return;
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
//# sourceMappingURL=telemetry-cli.js.map