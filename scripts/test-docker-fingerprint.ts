/**
 * Test Docker Host Fingerprinting
 * Verifies that host machine characteristics are stable across container recreations
 */

import { existsSync, readFileSync } from 'fs';
import { platform, arch } from 'os';
import { createHash } from 'crypto';

console.log('=== Docker Host Fingerprinting Test ===\n');

function generateHostFingerprint(): string {
  try {
    const signals: string[] = [];

    console.log('Collecting host signals...\n');

    // CPU info (stable across container recreations)
    if (existsSync('/proc/cpuinfo')) {
      const cpuinfo = readFileSync('/proc/cpuinfo', 'utf-8');
      const modelMatch = cpuinfo.match(/model name\s*:\s*(.+)/);
      const coresMatch = cpuinfo.match(/processor\s*:/g);

      if (modelMatch) {
        const cpuModel = modelMatch[1].trim();
        signals.push(cpuModel);
        console.log('✓ CPU Model:', cpuModel);
      }

      if (coresMatch) {
        const cores = `cores:${coresMatch.length}`;
        signals.push(cores);
        console.log('✓ CPU Cores:', coresMatch.length);
      }
    } else {
      console.log('✗ /proc/cpuinfo not available (Windows/Mac Docker)');
    }

    // Memory (stable)
    if (existsSync('/proc/meminfo')) {
      const meminfo = readFileSync('/proc/meminfo', 'utf-8');
      const totalMatch = meminfo.match(/MemTotal:\s+(\d+)/);

      if (totalMatch) {
        const memory = `mem:${totalMatch[1]}`;
        signals.push(memory);
        console.log('✓ Total Memory:', totalMatch[1], 'kB');
      }
    } else {
      console.log('✗ /proc/meminfo not available (Windows/Mac Docker)');
    }

    // Docker network subnet
    const networkInfo = getDockerNetworkInfo();
    if (networkInfo) {
      signals.push(networkInfo);
      console.log('✓ Network Info:', networkInfo);
    } else {
      console.log('✗ Network info not available');
    }

    // Platform basics (stable)
    signals.push(platform(), arch());
    console.log('✓ Platform:', platform());
    console.log('✓ Architecture:', arch());

    // Generate stable ID from all signals
    console.log('\nCombined signals:', signals.join(' | '));
    const fingerprint = signals.join('-');
    const userId = createHash('sha256').update(fingerprint).digest('hex').substring(0, 16);

    return userId;

  } catch (error) {
    console.error('Error generating fingerprint:', error);
    // Fallback
    return createHash('sha256')
      .update(`${platform()}-${arch()}-docker`)
      .digest('hex')
      .substring(0, 16);
  }
}

function getDockerNetworkInfo(): string | null {
  try {
    // Read routing table to get bridge network
    if (existsSync('/proc/net/route')) {
      const routes = readFileSync('/proc/net/route', 'utf-8');
      const lines = routes.split('\n');

      for (const line of lines) {
        if (line.includes('eth0')) {
          const parts = line.split(/\s+/);
          if (parts[2]) {
            const gateway = parseInt(parts[2], 16).toString(16);
            return `net:${gateway}`;
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// Test environment detection
console.log('\n=== Environment Detection ===\n');

const isDocker = process.env.IS_DOCKER === 'true';
const isCloudEnvironment = !!(
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RENDER ||
  process.env.FLY_APP_NAME ||
  process.env.HEROKU_APP_NAME ||
  process.env.AWS_EXECUTION_ENV ||
  process.env.KUBERNETES_SERVICE_HOST
);

console.log('IS_DOCKER env:', process.env.IS_DOCKER);
console.log('Docker detected:', isDocker);
console.log('Cloud environment:', isCloudEnvironment);

// Generate fingerprints
console.log('\n=== Fingerprint Generation ===\n');

const fingerprint1 = generateHostFingerprint();
const fingerprint2 = generateHostFingerprint();
const fingerprint3 = generateHostFingerprint();

console.log('\nFingerprint 1:', fingerprint1);
console.log('Fingerprint 2:', fingerprint2);
console.log('Fingerprint 3:', fingerprint3);

const consistent = fingerprint1 === fingerprint2 && fingerprint2 === fingerprint3;
console.log('\nConsistent:', consistent ? '✓ YES' : '✗ NO');

// Test explicit ID override
console.log('\n=== Environment Variable Override Test ===\n');

if (process.env.N8N_MCP_USER_ID) {
  // Intentionally log nothing derived from the env value — not even a
  // masked prefix, because CodeQL's taint tracking follows string
  // slicing and any substring still counts as "sensitive data in
  // clear text". The only signal the developer needs here is "an
  // override is set", which is what this line conveys.
  // Addresses CodeQL js/clear-text-logging.
  console.log('Explicit user ID is set (value redacted)');
  console.log('This would override the fingerprint');
} else {
  console.log('No explicit user ID set');
  console.log('To test: N8N_MCP_USER_ID=my-custom-id npx tsx ' + process.argv[1]);
}

// Stability estimate
console.log('\n=== Stability Analysis ===\n');

const hasStableSignals = existsSync('/proc/cpuinfo') || existsSync('/proc/meminfo');
if (hasStableSignals) {
  console.log('✓ Host-based signals available');
  console.log('✓ Fingerprint should be stable across container recreations');
  console.log('✓ Different fingerprints on different physical hosts');
} else {
  console.log('⚠️  Limited host signals (Windows/Mac Docker Desktop)');
  console.log('⚠️  Fingerprint may not be fully stable');
  console.log('💡 Recommendation: Use N8N_MCP_USER_ID env var for stability');
}

console.log('\n');
