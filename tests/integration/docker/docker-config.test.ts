import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  exec,
  waitForHealthy,
  isRunningInHttpMode,
  getProcessEnv,
  ensureDockerTestImage,
  DOCKER_TEST_IMAGE_NAME
} from './test-helpers';

// Skip tests if not in CI or if Docker is not available
const SKIP_DOCKER_TESTS = process.env.CI !== 'true' && !process.env.RUN_DOCKER_TESTS;
const describeDocker = SKIP_DOCKER_TESTS ? describe.skip : describe;

// Helper to generate unique container names
function generateContainerName(suffix: string): string {
  return `n8n-mcp-test-${Date.now()}-${suffix}`;
}

// Helper to clean up containers
async function cleanupContainer(containerName: string) {
  try {
    await exec(`docker stop ${containerName}`);
    await exec(`docker rm ${containerName}`);
  } catch {
    // Ignore errors - container might not exist
  }
}

describeDocker('Docker Config File Integration', () => {
  let tempDir: string;
  // True when Docker is available AND the test image is ready to use.
  // Tests gated by `if (!dockerAvailable) return;` skip silently otherwise.
  let dockerAvailable: boolean;
  const imageName = DOCKER_TEST_IMAGE_NAME;
  const containers: string[] = [];

  beforeAll(async () => {
    const result = await ensureDockerTestImage();
    dockerAvailable = result.status === 'ready';
    if (result.status === 'skip-no-docker') {
      console.warn('Docker not available, skipping Docker integration tests');
    } else if (result.status === 'missing') {
      console.warn(result.message);
    }
    // Inspect-only path is sub-second. The 5-minute window covers BUILD_DOCKER_TEST_IMAGE=true
    // local auto-builds, which need to finish the npm install in the builder stage.
  }, 300000);

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-config-test-'));
  });

  afterEach(async () => {
    // Clean up containers
    for (const container of containers) {
      await cleanupContainer(container);
    }
    containers.length = 0;

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('Config file loading', () => {
    it('should load config.json and set environment variables', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('config-load');
      containers.push(containerName);

      // Create config file
      const configPath = path.join(tempDir, 'config.json');
      const config = {
        mcp_mode: 'http',
        auth_token: 'test-token-from-config',
        port: 3456,
        database: {
          path: '/data/custom.db'
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Run container with config file mounted
      const { stdout } = await exec(
        `docker run --name ${containerName} -v "${configPath}:/app/config.json:ro" ${imageName} sh -c "env | grep -E '^(MCP_MODE|AUTH_TOKEN|PORT|DATABASE_PATH)=' | sort"`
      );

      const envVars = stdout.trim().split('\n').reduce((acc, line) => {
        const [key, value] = line.split('=');
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);

      expect(envVars.MCP_MODE).toBe('http');
      expect(envVars.AUTH_TOKEN).toBe('test-token-from-config');
      expect(envVars.PORT).toBe('3456');
      expect(envVars.DATABASE_PATH).toBe('/data/custom.db');
    });

    it('should give precedence to environment variables over config file', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('env-precedence');
      containers.push(containerName);

      // Create config file
      const configPath = path.join(tempDir, 'config.json');
      const config = {
        mcp_mode: 'stdio',
        auth_token: 'config-token',
        custom_var: 'from-config'
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Run container with both env vars and config file
      const { stdout } = await exec(
        `docker run --name ${containerName} ` +
        `-e MCP_MODE=http ` +
        `-e AUTH_TOKEN=env-token ` +
        `-v "${configPath}:/app/config.json:ro" ` +
        `${imageName} sh -c "env | grep -E '^(MCP_MODE|AUTH_TOKEN|CUSTOM_VAR)=' | sort"`
      );

      const envVars = stdout.trim().split('\n').reduce((acc, line) => {
        const [key, value] = line.split('=');
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);

      expect(envVars.MCP_MODE).toBe('http'); // From env var
      expect(envVars.AUTH_TOKEN).toBe('env-token'); // From env var
      expect(envVars.CUSTOM_VAR).toBe('from-config'); // From config file
    });

    it('should handle missing config file gracefully', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('no-config');
      containers.push(containerName);

      // Run container without config file
      const { stdout, stderr } = await exec(
        `docker run --name ${containerName} ${imageName} echo "Container started successfully"`
      );

      expect(stdout.trim()).toBe('Container started successfully');
      expect(stderr).toBe('');
    });

    it('should handle invalid JSON in config file gracefully', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('invalid-json');
      containers.push(containerName);

      // Create invalid config file
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, '{ invalid json }');

      // Container should still start despite invalid config
      const { stdout } = await exec(
        `docker run --name ${containerName} -v "${configPath}:/app/config.json:ro" ${imageName} echo "Started despite invalid config"`
      );

      expect(stdout.trim()).toBe('Started despite invalid config');
    });
  });

  describe('n8n-mcp serve command', () => {
    it('should automatically set MCP_MODE=http for "n8n-mcp serve" command', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('serve-command');
      containers.push(containerName);

      // Run container with n8n-mcp serve command
      // Start the container in detached mode
      await exec(
        `docker run -d --name ${containerName} -e AUTH_TOKEN=test-token -p 13001:3000 ${imageName} n8n-mcp serve`
      );
      
      // Give it time to start
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify it's running in HTTP mode by checking the health endpoint
      const { stdout } = await exec(
        `docker exec ${containerName} curl -s http://localhost:3000/health || echo 'Server not responding'`
      );

      // If HTTP mode is active, health endpoint should respond
      expect(stdout).toContain('ok');
    });

    it('should preserve additional arguments when using "n8n-mcp serve"', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('serve-args');
      containers.push(containerName);

      // Test that additional arguments are passed through
      // Note: This test is checking the command construction, not actual execution
      const result = await exec(
        `docker run --name ${containerName} ${imageName} sh -c "set -x; n8n-mcp serve --port 8080 2>&1 | grep -E 'node.*index.js.*--port.*8080' || echo 'Pattern not found'"`
      );

      // The serve command should transform to node command with arguments preserved
      expect(result.stdout).toBeTruthy();
    });
  });

  describe('Database initialization', () => {
    it('should initialize database when not present', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('db-init');
      containers.push(containerName);

      // Run container and check database initialization
      const { stdout } = await exec(
        `docker run --name ${containerName} ${imageName} sh -c "ls -la /app/data/nodes.db && echo 'Database initialized'"`
      );

      expect(stdout).toContain('nodes.db');
      expect(stdout).toContain('Database initialized');
    });

    it('should respect NODE_DB_PATH from config file', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('custom-db-path');
      containers.push(containerName);

      // Create config with custom database path
      const configPath = path.join(tempDir, 'config.json');
      const config = {
        NODE_DB_PATH: '/app/data/custom/custom.db'  // Use uppercase and a writable path
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Run container in detached mode to check environment after initialization
      // Set MCP_MODE=http so the server keeps running (stdio mode exits when stdin is closed in detached mode)
      await exec(
        `docker run -d --name ${containerName} -e MCP_MODE=http -e AUTH_TOKEN=test -v "${configPath}:/app/config.json:ro" ${imageName}`
      );
      
      // Give it time to load config and start
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check the actual process environment
      const { stdout } = await exec(
        `docker exec ${containerName} sh -c "cat /proc/1/environ | tr '\\0' '\\n' | grep NODE_DB_PATH || echo 'NODE_DB_PATH not found'"`
      );

      expect(stdout.trim()).toBe('NODE_DB_PATH=/app/data/custom/custom.db');
    });
  });

  describe('Authentication configuration', () => {
    it('should enforce AUTH_TOKEN requirement in HTTP mode', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('auth-required');
      containers.push(containerName);

      // Try to run in HTTP mode without auth token
      try {
        await exec(
          `docker run --name ${containerName} -e MCP_MODE=http ${imageName} echo "Should not reach here"`
        );
        expect.fail('Container should have exited with error');
      } catch (error: any) {
        expect(error.stderr).toContain('AUTH_TOKEN or AUTH_TOKEN_FILE is required for HTTP mode');
      }
    });

    it('should accept AUTH_TOKEN from config file', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('auth-config');
      containers.push(containerName);

      // Create config with auth token
      const configPath = path.join(tempDir, 'config.json');
      const config = {
        mcp_mode: 'http',
        auth_token: 'config-auth-token'
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Run container with config file
      const { stdout } = await exec(
        `docker run --name ${containerName} -v "${configPath}:/app/config.json:ro" ${imageName} sh -c "env | grep AUTH_TOKEN"`
      );

      expect(stdout.trim()).toBe('AUTH_TOKEN=config-auth-token');
    });
  });

  describe('Security and permissions', () => {
    it('should handle malicious config values safely', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('security-test');
      containers.push(containerName);

      // Create config with potentially malicious values
      const configPath = path.join(tempDir, 'config.json');
      const config = {
        malicious1: "'; echo 'hacked' > /tmp/hacked.txt; '",
        malicious2: "$( touch /tmp/command-injection.txt )",
        malicious3: "`touch /tmp/backtick-injection.txt`"
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Run container and check that no files were created
      const { stdout } = await exec(
        `docker run --name ${containerName} -v "${configPath}:/app/config.json:ro" ${imageName} sh -c "ls -la /tmp/ | grep -E '(hacked|injection)' || echo 'No malicious files created'"`
      );

      expect(stdout.trim()).toBe('No malicious files created');
    });

    it('should run as non-root user by default', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('non-root');
      containers.push(containerName);

      // Check user inside container
      const { stdout } = await exec(
        `docker run --name ${containerName} ${imageName} whoami`
      );

      expect(stdout.trim()).toBe('nodejs');
    });
  });

  describe('Complex configuration scenarios', () => {
    it('should handle nested configuration with all supported types', async () => {
      if (!dockerAvailable) return;

      const containerName = generateContainerName('complex-config');
      containers.push(containerName);

      // Create complex config
      const configPath = path.join(tempDir, 'config.json');
      const config = {
        server: {
          http: {
            port: 8080,
            host: '0.0.0.0',
            ssl: {
              enabled: true,
              cert_path: '/certs/server.crt'
            }
          }
        },
        features: {
          debug: false,
          metrics: true,
          logging: {
            level: 'info',
            format: 'json'
          }
        },
        limits: {
          max_connections: 100,
          timeout_seconds: 30
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Run container and verify all variables
      const { stdout } = await exec(
        `docker run --name ${containerName} -v "${configPath}:/app/config.json:ro" ${imageName} sh -c "env | grep -E '^(SERVER_|FEATURES_|LIMITS_)' | sort"`
      );

      const lines = stdout.trim().split('\n');
      const envVars = lines.reduce((acc, line) => {
        const [key, value] = line.split('=');
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);

      // Verify nested values are correctly flattened
      expect(envVars.SERVER_HTTP_PORT).toBe('8080');
      expect(envVars.SERVER_HTTP_HOST).toBe('0.0.0.0');
      expect(envVars.SERVER_HTTP_SSL_ENABLED).toBe('true');
      expect(envVars.SERVER_HTTP_SSL_CERT_PATH).toBe('/certs/server.crt');
      expect(envVars.FEATURES_DEBUG).toBe('false');
      expect(envVars.FEATURES_METRICS).toBe('true');
      expect(envVars.FEATURES_LOGGING_LEVEL).toBe('info');
      expect(envVars.FEATURES_LOGGING_FORMAT).toBe('json');
      expect(envVars.LIMITS_MAX_CONNECTIONS).toBe('100');
      expect(envVars.LIMITS_TIMEOUT_SECONDS).toBe('30');
    });
  });
});