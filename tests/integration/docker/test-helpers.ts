import { promisify } from 'util';
import { exec as execCallback, execSync } from 'child_process';
import path from 'path';

export const exec = promisify(execCallback);

/**
 * Test image name shared by all Docker integration tests.
 *
 * NOTE: must stay in sync with the `docker:test:build` script in package.json.
 * npm scripts can't reference TS constants, so the literal lives in two places.
 */
export const DOCKER_TEST_IMAGE_NAME = 'n8n-mcp-test:latest';

/**
 * Check if Docker is available on the host.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await exec('docker --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Result of attempting to ensure the Docker test image exists.
 * - "ready": image is present and tests can run
 * - "skip-no-docker": Docker is not available on the host; suite should skip
 * - "missing": Docker is available but the image is not pre-built; suite should skip
 *   with an actionable error message instead of silently auto-building (which is
 *   what caused the CI flake — npm install inside `docker build` is unreliable).
 *
 * Local devs can opt in to auto-build by setting BUILD_DOCKER_TEST_IMAGE=true,
 * but the CI workflow pre-builds the image in a dedicated step instead.
 */
export type EnsureImageResult =
  | { status: 'ready' }
  | { status: 'skip-no-docker' }
  | { status: 'missing'; message: string };

/**
 * Verify the Docker test image is available without building it.
 * If BUILD_DOCKER_TEST_IMAGE=true is set, fall back to building (local dev convenience).
 */
export async function ensureDockerTestImage(): Promise<EnsureImageResult> {
  if (!(await isDockerAvailable())) {
    return { status: 'skip-no-docker' };
  }

  let inspectError: string | null = null;
  try {
    await exec(`docker image inspect ${DOCKER_TEST_IMAGE_NAME}`);
    return { status: 'ready' };
  } catch (error) {
    // Distinguish "image truly missing" (the common case) from "daemon unreachable"
    // / permission errors. The latter look identical to "missing" in our return shape
    // otherwise, sending users down the wrong fix path.
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const message = (error as Error).message ?? '';
    const combined = `${stderr}\n${message}`;
    if (/Cannot connect to the Docker daemon|permission denied|is the docker daemon running/i.test(combined)) {
      return { status: 'skip-no-docker' };
    }
    inspectError = stderr.trim() || message.trim() || 'unknown error';
  }

  if (process.env.BUILD_DOCKER_TEST_IMAGE === 'true') {
    const projectRoot = path.resolve(__dirname, '../../../');
    try {
      execSync(`docker build -t ${DOCKER_TEST_IMAGE_NAME} .`, {
        cwd: projectRoot,
        stdio: 'inherit'
      });
      return { status: 'ready' };
    } catch (error) {
      return {
        status: 'missing',
        message: `Auto-build failed (BUILD_DOCKER_TEST_IMAGE=true). ${(error as Error).message}`
      };
    }
  }

  return {
    status: 'missing',
    message:
      `Docker image ${DOCKER_TEST_IMAGE_NAME} not found (${inspectError}). ` +
      `In CI: ensure the "Build Docker test image" step ran. ` +
      `Locally: run \`npm run docker:test:build\` first, or re-run with BUILD_DOCKER_TEST_IMAGE=true to auto-build.`
  };
}

/**
 * Wait for a container to be healthy by checking the health endpoint
 */
export async function waitForHealthy(containerName: string, timeout = 10000): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      const { stdout } = await exec(
        `docker exec ${containerName} curl -s http://localhost:3000/health`
      );
      
      if (stdout.includes('ok')) {
        return true;
      }
    } catch (error) {
      // Container might not be ready yet
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return false;
}

/**
 * Check if a container is running in HTTP mode by verifying the server is listening
 */
export async function isRunningInHttpMode(containerName: string): Promise<boolean> {
  try {
    const { stdout } = await exec(
      `docker exec ${containerName} sh -c "netstat -tln 2>/dev/null | grep :3000 || echo 'Not listening'"`
    );
    
    return stdout.includes(':3000');
  } catch {
    return false;
  }
}

/**
 * Get process environment variables from inside a running container
 */
export async function getProcessEnv(containerName: string, varName: string): Promise<string | null> {
  try {
    const { stdout } = await exec(
      `docker exec ${containerName} sh -c "cat /proc/1/environ | tr '\\0' '\\n' | grep '^${varName}=' | cut -d= -f2-"`
    );
    
    return stdout.trim() || null;
  } catch {
    return null;
  }
}