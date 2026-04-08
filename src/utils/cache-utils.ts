/**
 * Cache utilities for flexible instance configuration
 * Provides hash creation, metrics tracking, and cache configuration
 */

import { scryptSync, randomBytes } from 'crypto';
import { LRUCache } from 'lru-cache';
import { logger } from './logger';

/**
 * Per-process random salt for the cache-key KDF. Generated once at module
 * load, never persisted, rotates on process restart (the in-memory cache
 * rotates with it, so that's fine).
 */
const CACHE_KEY_SALT = randomBytes(16);

/**
 * scrypt cost parameters. Kept intentionally low: this KDF runs on cache
 * miss during request handling, and we care more about not blocking the
 * event loop than about brute-force resistance. The aggressive
 * memoization (`hashMemoCache`) means each unique input pays the cost
 * exactly once per process lifetime.
 *
 * N=1024, r=8, p=1 is roughly 2–5 ms on modern hardware. bcrypt/argon2
 * at default parameters would be 50–100 ms — too slow for a cache miss
 * path.
 */
const CACHE_KEY_SCRYPT_OPTS = { N: 1024, r: 8, p: 1 } as const;

/**
 * Cache metrics for monitoring and optimization
 */
export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  sets: number;
  deletes: number;
  clears: number;
  size: number;
  maxSize: number;
  avgHitRate: number;
  createdAt: Date;
  lastResetAt: Date;
}

/**
 * Cache configuration options
 */
export interface CacheConfig {
  max: number;
  ttlMinutes: number;
}

/**
 * Simple memoization cache for hash results
 * Limited size to prevent memory growth
 */
const hashMemoCache = new Map<string, string>();
const MAX_MEMO_SIZE = 1000;

/**
 * Metrics tracking for cache operations
 */
class CacheMetricsTracker {
  private metrics!: CacheMetrics;
  private startTime: Date;

  constructor() {
    this.startTime = new Date();
    this.reset();
  }

  /**
   * Reset all metrics to initial state
   */
  reset(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      sets: 0,
      deletes: 0,
      clears: 0,
      size: 0,
      maxSize: 0,
      avgHitRate: 0,
      createdAt: this.startTime,
      lastResetAt: new Date()
    };
  }

  /**
   * Record a cache hit
   */
  recordHit(): void {
    this.metrics.hits++;
    this.updateHitRate();
  }

  /**
   * Record a cache miss
   */
  recordMiss(): void {
    this.metrics.misses++;
    this.updateHitRate();
  }

  /**
   * Record a cache eviction
   */
  recordEviction(): void {
    this.metrics.evictions++;
  }

  /**
   * Record a cache set operation
   */
  recordSet(): void {
    this.metrics.sets++;
  }

  /**
   * Record a cache delete operation
   */
  recordDelete(): void {
    this.metrics.deletes++;
  }

  /**
   * Record a cache clear operation
   */
  recordClear(): void {
    this.metrics.clears++;
  }

  /**
   * Update cache size metrics
   */
  updateSize(current: number, max: number): void {
    this.metrics.size = current;
    this.metrics.maxSize = max;
  }

  /**
   * Update average hit rate
   */
  private updateHitRate(): void {
    const total = this.metrics.hits + this.metrics.misses;
    if (total > 0) {
      this.metrics.avgHitRate = this.metrics.hits / total;
    }
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  /**
   * Get formatted metrics for logging
   */
  getFormattedMetrics(): string {
    const { hits, misses, evictions, avgHitRate, size, maxSize } = this.metrics;
    return `Cache Metrics: Hits=${hits}, Misses=${misses}, HitRate=${(avgHitRate * 100).toFixed(2)}%, Size=${size}/${maxSize}, Evictions=${evictions}`;
  }
}

// Global metrics tracker instance
export const cacheMetrics = new CacheMetricsTracker();

/**
 * Get cache configuration from environment variables or defaults
 * @returns Cache configuration with max size and TTL
 */
export function getCacheConfig(): CacheConfig {
  const max = parseInt(process.env.INSTANCE_CACHE_MAX || '100', 10);
  const ttlMinutes = parseInt(process.env.INSTANCE_CACHE_TTL_MINUTES || '30', 10);

  // Validate configuration bounds
  const validatedMax = Math.max(1, Math.min(10000, max)) || 100;
  const validatedTtl = Math.max(1, Math.min(1440, ttlMinutes)) || 30; // Max 24 hours

  if (validatedMax !== max || validatedTtl !== ttlMinutes) {
    logger.warn('Cache configuration adjusted to valid bounds', {
      requestedMax: max,
      requestedTtl: ttlMinutes,
      actualMax: validatedMax,
      actualTtl: validatedTtl
    });
  }

  return {
    max: validatedMax,
    ttlMinutes: validatedTtl
  };
}

/**
 * Derive a cache key from a composite input string using scrypt, a key
 * derivation function on CodeQL's `js/insufficient-password-hash`
 * allowlist. Memoized for the lifetime of the process so repeated
 * lookups are O(1) — each unique input pays the KDF cost exactly once.
 *
 * Why scrypt rather than a plain hash:
 *   - The composite input contains the n8n API key, so we don't want
 *     cache-key values to be trivially reversible if they end up in
 *     logs or memory dumps.
 *   - scrypt is memory-hard and has a per-process random salt, so two
 *     server instances produce different cache keys for the same tenant.
 *   - Cost params are intentionally low (`N=1024`, ~2–5 ms) because the
 *     threat model is "don't leak credentials via cache keys", not
 *     "resist offline brute force", and the memoization layer means
 *     we only pay the cost on cache miss.
 *
 * @param input - The composite input string to derive a key from
 * @returns A 64-character hex-encoded 32-byte key
 */
export function createCacheKey(input: string): string {
  // Check memoization cache first
  if (hashMemoCache.has(input)) {
    return hashMemoCache.get(input)!;
  }

  // Derive a 32-byte key from the input using scrypt with a
  // per-process random salt. scryptSync blocks the event loop for a
  // few ms, which is acceptable because (a) it only runs on cache miss
  // and (b) memoization means each unique input runs it exactly once.
  const hash = scryptSync(input, CACHE_KEY_SALT, 32, CACHE_KEY_SCRYPT_OPTS).toString('hex');

  // Add to memoization cache with size limit
  if (hashMemoCache.size >= MAX_MEMO_SIZE) {
    // Remove oldest entries (simple FIFO)
    const firstKey = hashMemoCache.keys().next().value;
    if (firstKey) {
      hashMemoCache.delete(firstKey);
    }
  }
  hashMemoCache.set(input, hash);

  return hash;
}

/**
 * Create LRU cache with metrics tracking
 * @param onDispose - Optional callback for when items are evicted
 * @returns Configured LRU cache instance
 */
export function createInstanceCache<T extends {}>(
  onDispose?: (value: T, key: string) => void
): LRUCache<string, T> {
  const config = getCacheConfig();

  return new LRUCache<string, T>({
    max: config.max,
    ttl: config.ttlMinutes * 60 * 1000, // Convert to milliseconds
    updateAgeOnGet: true,
    dispose: (value, key) => {
      cacheMetrics.recordEviction();
      if (onDispose) {
        onDispose(value, key);
      }
      logger.debug('Cache eviction', {
        cacheKey: key.substring(0, 8) + '...',
        metrics: cacheMetrics.getFormattedMetrics()
      });
    }
  });
}

/**
 * Mutex implementation for cache operations
 * Prevents race conditions during concurrent access
 */
export class CacheMutex {
  private locks: Map<string, Promise<void>> = new Map();
  private lockTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly timeout: number = 5000; // 5 second timeout

  /**
   * Acquire a lock for the given key
   * @param key - The cache key to lock
   * @returns Promise that resolves when lock is acquired
   */
  async acquire(key: string): Promise<() => void> {
    while (this.locks.has(key)) {
      try {
        await this.locks.get(key);
      } catch {
        // Previous lock failed, we can proceed
      }
    }

    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = () => {
        resolve();
        this.locks.delete(key);
        const timeout = this.lockTimeouts.get(key);
        if (timeout) {
          clearTimeout(timeout);
          this.lockTimeouts.delete(key);
        }
      };
    });

    this.locks.set(key, lockPromise);

    // Set timeout to prevent stuck locks
    const timeout = setTimeout(() => {
      logger.warn('Cache lock timeout, forcefully releasing', { key: key.substring(0, 8) + '...' });
      releaseLock!();
    }, this.timeout);
    this.lockTimeouts.set(key, timeout);

    return releaseLock!;
  }

  /**
   * Check if a key is currently locked
   * @param key - The cache key to check
   * @returns True if the key is locked
   */
  isLocked(key: string): boolean {
    return this.locks.has(key);
  }

  /**
   * Clear all locks (use with caution)
   */
  clearAll(): void {
    this.lockTimeouts.forEach(timeout => clearTimeout(timeout));
    this.locks.clear();
    this.lockTimeouts.clear();
  }
}

/**
 * Retry configuration for API operations
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  jitterFactor: 0.3
};

/**
 * Calculate exponential backoff delay with jitter
 * @param attempt - Current attempt number (0-based)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const exponentialDelay = Math.min(
    config.baseDelayMs * Math.pow(2, attempt),
    config.maxDelayMs
  );

  // Add jitter to prevent thundering herd
  const jitter = exponentialDelay * config.jitterFactor * Math.random();

  return Math.floor(exponentialDelay + jitter);
}

/**
 * Execute function with retry logic
 * @param fn - Function to execute
 * @param config - Retry configuration
 * @param context - Optional context for logging
 * @returns Result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  context?: string
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      if (!isRetryableError(error)) {
        throw error;
      }

      if (attempt < config.maxAttempts - 1) {
        const delay = calculateBackoffDelay(attempt, config);
        logger.debug('Retrying operation after delay', {
          context,
          attempt: attempt + 1,
          maxAttempts: config.maxAttempts,
          delayMs: delay,
          error: lastError.message
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error('All retry attempts exhausted', {
    context,
    attempts: config.maxAttempts,
    lastError: lastError!.message
  });

  throw lastError!;
}

/**
 * Check if an error is retryable
 * @param error - The error to check
 * @returns True if the error is retryable
 */
function isRetryableError(error: any): boolean {
  // Network errors
  if (error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND') {
    return true;
  }

  // HTTP status codes that are retryable
  if (error.response?.status) {
    const status = error.response.status;
    return status === 429 || // Too Many Requests
           status === 503 || // Service Unavailable
           status === 504 || // Gateway Timeout
           (status >= 500 && status < 600); // Server errors
  }

  // Timeout errors
  if (error.message && error.message.toLowerCase().includes('timeout')) {
    return true;
  }

  return false;
}

/**
 * Format cache statistics for logging or display
 * @returns Formatted statistics string
 */
export function getCacheStatistics(): string {
  const metrics = cacheMetrics.getMetrics();
  const runtime = Date.now() - metrics.createdAt.getTime();
  const runtimeMinutes = Math.floor(runtime / 60000);

  return `
Cache Statistics:
  Runtime: ${runtimeMinutes} minutes
  Total Operations: ${metrics.hits + metrics.misses}
  Hit Rate: ${(metrics.avgHitRate * 100).toFixed(2)}%
  Current Size: ${metrics.size}/${metrics.maxSize}
  Total Evictions: ${metrics.evictions}
  Sets: ${metrics.sets}, Deletes: ${metrics.deletes}, Clears: ${metrics.clears}
  `.trim();
}