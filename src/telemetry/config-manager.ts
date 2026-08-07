/**
 * Telemetry Configuration Manager
 * Handles telemetry settings, opt-in/opt-out, and first-run detection
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { hostname, platform, arch } from 'os';

export interface TelemetryConfig {
  enabled: boolean;
  userId: string;
  firstRun?: string;
  lastModified?: string;
  version?: string;
}

export class TelemetryConfigManager {
  private static instance: TelemetryConfigManager;
  private readonly configDir: string;
  private readonly configPath: string;
  private config: TelemetryConfig | null = null;

  private constructor() {
    this.configDir = join(homedir(), '.n8n-mcp');
    this.configPath = join(this.configDir, 'telemetry.json');
  }

  static getInstance(): TelemetryConfigManager {
    if (!TelemetryConfigManager.instance) {
      TelemetryConfigManager.instance = new TelemetryConfigManager();
    }
    return TelemetryConfigManager.instance;
  }

  /**
   * Generate a deterministic anonymous user ID based on machine characteristics
   * Uses Docker/cloud-specific method for containerized environments
   */
  private generateUserId(): string {
    // Use boot_id for all Docker/cloud environments (stable across container updates)
    if (process.env.IS_DOCKER === 'true' || this.isCloudEnvironment()) {
      return this.generateDockerStableId();
    }

    // Local installations use file-based method with hostname
    const machineId = `${hostname()}-${platform()}-${arch()}-${homedir()}`;
    return createHash('sha256').update(machineId).digest('hex').substring(0, 16);
  }

  /**
   * Generate stable user ID for Docker/cloud environments
   * Priority: boot_id → combined signals → generic fallback
   */
  private generateDockerStableId(): string {
    // Priority 1: Try boot_id (stable across container recreations)
    const bootId = this.readBootId();
    if (bootId) {
      const fingerprint = `${bootId}-${platform()}-${arch()}`;
      return createHash('sha256').update(fingerprint).digest('hex').substring(0, 16);
    }

    // Priority 2: Try combined host signals
    const combinedFingerprint = this.generateCombinedFingerprint();
    if (combinedFingerprint) {
      return combinedFingerprint;
    }

    // Priority 3: Generic Docker ID (allows aggregate statistics)
    const genericId = `docker-${platform()}-${arch()}`;
    return createHash('sha256').update(genericId).digest('hex').substring(0, 16);
  }

  /**
   * Read host boot_id from /proc (available in Linux containers)
   * Returns null if not available or invalid format
   */
  private readBootId(): string | null {
    try {
      const bootIdPath = '/proc/sys/kernel/random/boot_id';

      if (!existsSync(bootIdPath)) {
        return null;
      }

      const bootId = readFileSync(bootIdPath, 'utf-8').trim();

      // Validate UUID format (8-4-4-4-12 hex digits)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(bootId)) {
        return null;
      }

      return bootId;
    } catch (error) {
      // File not readable or other error
      return null;
    }
  }

  /**
   * Generate fingerprint from combined host signals
   * Fallback for environments where boot_id is not available
   */
  private generateCombinedFingerprint(): string | null {
    try {
      const signals: string[] = [];

      // CPU cores (stable)
      if (existsSync('/proc/cpuinfo')) {
        const cpuinfo = readFileSync('/proc/cpuinfo', 'utf-8');
        const cores = (cpuinfo.match(/processor\s*:/g) || []).length;
        if (cores > 0) {
          signals.push(`cores:${cores}`);
        }
      }

      // Memory (stable)
      if (existsSync('/proc/meminfo')) {
        const meminfo = readFileSync('/proc/meminfo', 'utf-8');
        const totalMatch = meminfo.match(/MemTotal:\s+(\d+)/);
        if (totalMatch) {
          signals.push(`mem:${totalMatch[1]}`);
        }
      }

      // Kernel version (stable)
      if (existsSync('/proc/version')) {
        const version = readFileSync('/proc/version', 'utf-8');
        const kernelMatch = version.match(/Linux version ([\d.]+)/);
        if (kernelMatch) {
          signals.push(`kernel:${kernelMatch[1]}`);
        }
      }

      // Platform and arch
      signals.push(platform(), arch());

      // Need at least 3 signals for reasonable uniqueness
      if (signals.length < 3) {
        return null;
      }

      const fingerprint = signals.join('-');
      return createHash('sha256').update(fingerprint).digest('hex').substring(0, 16);
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if running in a cloud environment
   */
  private isCloudEnvironment(): boolean {
    return !!(
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.RENDER ||
      process.env.FLY_APP_NAME ||
      process.env.HEROKU_APP_NAME ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.KUBERNETES_SERVICE_HOST ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.AZURE_FUNCTIONS_ENVIRONMENT
    );
  }

  /**
   * Load configuration from disk or create default
   */
  loadConfig(): TelemetryConfig {
    if (this.config) {
      return this.config;
    }

    if (!existsSync(this.configPath)) {
      // First run - create default config
      const version = this.getPackageVersion();

      // Check if telemetry is disabled via environment variable
      const envDisabled = this.isDisabledByEnvironment();

      this.config = {
        enabled: !envDisabled, // Respect env var on first run
        userId: this.generateUserId(),
        firstRun: new Date().toISOString(),
        version
      };

      this.saveConfig();

      // Only show notice if not disabled via environment
      if (!envDisabled) {
        this.showFirstRunNotice();
      }

      return this.config;
    }

    try {
      const rawConfig = readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(rawConfig);

      // Ensure userId exists (for upgrades from older versions)
      if (!this.config!.userId) {
        this.config!.userId = this.generateUserId();
        this.saveConfig();
      }

      return this.config!;
    } catch (error) {
      console.error('Failed to load telemetry config, using defaults:', error);
      this.config = {
        enabled: false,
        userId: this.generateUserId()
      };
      return this.config;
    }
  }

  /**
   * Save configuration to disk
   */
  private saveConfig(): void {
    if (!this.config) return;

    try {
      if (!existsSync(this.configDir)) {
        mkdirSync(this.configDir, { recursive: true });
      }

      this.config.lastModified = new Date().toISOString();
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save telemetry config:', error);
    }
  }

  /**
   * Check if telemetry is enabled
   * Priority: Environment variable > Config file > Default (true)
   */
  isEnabled(): boolean {
    // Check environment variables first (for Docker users)
    if (this.isDisabledByEnvironment()) {
      return false;
    }

    const config = this.loadConfig();
    return config.enabled;
  }

  /**
   * Check if telemetry is disabled via environment variable
   */
  private isDisabledByEnvironment(): boolean {
    const envVars = [
      'N8N_MCP_TELEMETRY_DISABLED',
      'TELEMETRY_DISABLED',
      'DISABLE_TELEMETRY'
    ];

    for (const varName of envVars) {
      const value = process.env[varName];
      if (value !== undefined) {
        const normalized = value.toLowerCase().trim();

        // Warn about invalid values
        if (!['true', 'false', '1', '0', ''].includes(normalized)) {
          console.warn(
            `⚠️  Invalid telemetry environment variable value: ${varName}="${value}"\n` +
            `   Use "true" to disable or "false" to enable telemetry.`
          );
        }

        // Accept common truthy values
        if (normalized === 'true' || normalized === '1') {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get the anonymous user ID
   */
  getUserId(): string {
    const config = this.loadConfig();
    return config.userId;
  }

  /**
   * Check if this is the first run
   */
  isFirstRun(): boolean {
    return !existsSync(this.configPath);
  }

  /**
   * Enable telemetry
   */
  enable(): void {
    const config = this.loadConfig();
    config.enabled = true;
    this.config = config;
    this.saveConfig();
    console.log('✓ Anonymous telemetry enabled');
  }

  /**
   * Disable telemetry
   */
  disable(): void {
    const config = this.loadConfig();
    config.enabled = false;
    this.config = config;
    this.saveConfig();
    console.log('✓ Anonymous telemetry disabled');
  }

  /**
   * Get current status
   */
  getStatus(): string {
    const config = this.loadConfig();

    // Check if disabled by environment
    const envDisabled = this.isDisabledByEnvironment();

    let status = config.enabled ? 'ENABLED' : 'DISABLED';
    if (envDisabled) {
      status = 'DISABLED (via environment variable)';
    }

    return `
Telemetry Status: ${status}
Anonymous ID: ${config.userId}
First Run: ${config.firstRun || 'Unknown'}
Config Path: ${this.configPath}

To opt-out: npx n8n-mcp telemetry disable
To opt-in:  npx n8n-mcp telemetry enable

For Docker: Set N8N_MCP_TELEMETRY_DISABLED=true
`;
  }

  /**
   * Show first-run notice to user.
   *
   * Written to stderr, never stdout: in stdio mode stdout is the JSON-RPC
   * channel, and this notice landing there produced a burst of
   * `is not valid JSON` parse errors in the client on every fresh install.
   * stderr is the channel the MCP spec reserves for logging, and Claude Desktop
   * persists it to mcp-server-*.log, so the notice is more visible here than it
   * was before — the published bin stubs console.* entirely, so on that path it
   * previously reached nobody at all.
   *
   * Uses process.stderr.write rather than console.error so the notice survives
   * the console silencing installed by stdio-wrapper.ts (see utils/stdio-guard.ts).
   */
  private showFirstRunNotice(): void {
    process.stderr.write(`
╔════════════════════════════════════════════════════════════╗
║              Anonymous Usage Statistics                     ║
╠════════════════════════════════════════════════════════════╣
║                                                             ║
║  n8n-mcp collects anonymous usage data to improve the      ║
║  tool and understand how it's being used.                  ║
║                                                             ║
║  We track:                                                 ║
║  • Which MCP tools are used (no parameters)                ║
║  • Workflow structures (sanitized, no sensitive data)      ║
║  • Error patterns (hashed, no details)                     ║
║  • Performance metrics (timing, success rates)             ║
║                                                             ║
║  We NEVER collect:                                         ║
║  • URLs, API keys, or credentials                          ║
║  • Workflow content or actual data                         ║
║  • Personal or identifiable information                    ║
║  • n8n instance details or locations                       ║
║                                                             ║
║  Your anonymous ID: ${this.config?.userId || 'generating...'}          ║
║                                                             ║
║  This helps me understand usage patterns and improve       ║
║  n8n-mcp for everyone. Thank you for your support!         ║
║                                                             ║
║  To opt-out at any time:                                   ║
║  npx n8n-mcp telemetry disable                            ║
║                                                             ║
║  Data deletion requests:                                   ║
║  Email romuald@n8n-mcp.com with your anonymous ID          ║
║                                                             ║
║  Learn more:                                               ║
║  https://github.com/czlonkowski/n8n-mcp/blob/main/PRIVACY.md ║
║                                                             ║
╚════════════════════════════════════════════════════════════╝
`);
  }

  /**
   * Get package version safely
   */
  private getPackageVersion(): string {
    try {
      // Try multiple approaches to find package.json
      const possiblePaths = [
        resolve(__dirname, '..', '..', 'package.json'),
        resolve(process.cwd(), 'package.json'),
        resolve(__dirname, '..', '..', '..', 'package.json')
      ];

      for (const packagePath of possiblePaths) {
        if (existsSync(packagePath)) {
          const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
          if (packageJson.version) {
            return packageJson.version;
          }
        }
      }

      // Fallback: try require (works in some environments)
      try {
        const packageJson = require('../../package.json');
        return packageJson.version || 'unknown';
      } catch {
        // Ignore require error
      }

      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }
}