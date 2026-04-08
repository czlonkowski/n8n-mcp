"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RETRY_CONFIG = exports.CacheMutex = exports.cacheMetrics = void 0;
exports.getCacheConfig = getCacheConfig;
exports.createCacheKey = createCacheKey;
exports.createInstanceCache = createInstanceCache;
exports.calculateBackoffDelay = calculateBackoffDelay;
exports.withRetry = withRetry;
exports.getCacheStatistics = getCacheStatistics;
const crypto_1 = require("crypto");
const lru_cache_1 = require("lru-cache");
const logger_1 = require("./logger");
const CACHE_KEY_SALT = (0, crypto_1.randomBytes)(16);
const CACHE_KEY_SCRYPT_OPTS = { N: 1024, r: 8, p: 1 };
const hashMemoCache = new Map();
const MAX_MEMO_SIZE = 1000;
class CacheMetricsTracker {
    constructor() {
        this.startTime = new Date();
        this.reset();
    }
    reset() {
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
    recordHit() {
        this.metrics.hits++;
        this.updateHitRate();
    }
    recordMiss() {
        this.metrics.misses++;
        this.updateHitRate();
    }
    recordEviction() {
        this.metrics.evictions++;
    }
    recordSet() {
        this.metrics.sets++;
    }
    recordDelete() {
        this.metrics.deletes++;
    }
    recordClear() {
        this.metrics.clears++;
    }
    updateSize(current, max) {
        this.metrics.size = current;
        this.metrics.maxSize = max;
    }
    updateHitRate() {
        const total = this.metrics.hits + this.metrics.misses;
        if (total > 0) {
            this.metrics.avgHitRate = this.metrics.hits / total;
        }
    }
    getMetrics() {
        return { ...this.metrics };
    }
    getFormattedMetrics() {
        const { hits, misses, evictions, avgHitRate, size, maxSize } = this.metrics;
        return `Cache Metrics: Hits=${hits}, Misses=${misses}, HitRate=${(avgHitRate * 100).toFixed(2)}%, Size=${size}/${maxSize}, Evictions=${evictions}`;
    }
}
exports.cacheMetrics = new CacheMetricsTracker();
function getCacheConfig() {
    const max = parseInt(process.env.INSTANCE_CACHE_MAX || '100', 10);
    const ttlMinutes = parseInt(process.env.INSTANCE_CACHE_TTL_MINUTES || '30', 10);
    const validatedMax = Math.max(1, Math.min(10000, max)) || 100;
    const validatedTtl = Math.max(1, Math.min(1440, ttlMinutes)) || 30;
    if (validatedMax !== max || validatedTtl !== ttlMinutes) {
        logger_1.logger.warn('Cache configuration adjusted to valid bounds', {
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
function createCacheKey(input) {
    if (hashMemoCache.has(input)) {
        return hashMemoCache.get(input);
    }
    const hash = (0, crypto_1.scryptSync)(input, CACHE_KEY_SALT, 32, CACHE_KEY_SCRYPT_OPTS).toString('hex');
    if (hashMemoCache.size >= MAX_MEMO_SIZE) {
        const firstKey = hashMemoCache.keys().next().value;
        if (firstKey) {
            hashMemoCache.delete(firstKey);
        }
    }
    hashMemoCache.set(input, hash);
    return hash;
}
function createInstanceCache(onDispose) {
    const config = getCacheConfig();
    return new lru_cache_1.LRUCache({
        max: config.max,
        ttl: config.ttlMinutes * 60 * 1000,
        updateAgeOnGet: true,
        dispose: (value, key) => {
            exports.cacheMetrics.recordEviction();
            if (onDispose) {
                onDispose(value, key);
            }
            logger_1.logger.debug('Cache eviction', {
                cacheKey: key.substring(0, 8) + '...',
                metrics: exports.cacheMetrics.getFormattedMetrics()
            });
        }
    });
}
class CacheMutex {
    constructor() {
        this.locks = new Map();
        this.lockTimeouts = new Map();
        this.timeout = 5000;
    }
    async acquire(key) {
        while (this.locks.has(key)) {
            try {
                await this.locks.get(key);
            }
            catch {
            }
        }
        let releaseLock;
        const lockPromise = new Promise((resolve) => {
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
        const timeout = setTimeout(() => {
            logger_1.logger.warn('Cache lock timeout, forcefully releasing', { key: key.substring(0, 8) + '...' });
            releaseLock();
        }, this.timeout);
        this.lockTimeouts.set(key, timeout);
        return releaseLock;
    }
    isLocked(key) {
        return this.locks.has(key);
    }
    clearAll() {
        this.lockTimeouts.forEach(timeout => clearTimeout(timeout));
        this.locks.clear();
        this.lockTimeouts.clear();
    }
}
exports.CacheMutex = CacheMutex;
exports.DEFAULT_RETRY_CONFIG = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    jitterFactor: 0.3
};
function calculateBackoffDelay(attempt, config = exports.DEFAULT_RETRY_CONFIG) {
    const exponentialDelay = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
    const jitter = exponentialDelay * config.jitterFactor * Math.random();
    return Math.floor(exponentialDelay + jitter);
}
async function withRetry(fn, config = exports.DEFAULT_RETRY_CONFIG, context) {
    let lastError;
    for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (!isRetryableError(error)) {
                throw error;
            }
            if (attempt < config.maxAttempts - 1) {
                const delay = calculateBackoffDelay(attempt, config);
                logger_1.logger.debug('Retrying operation after delay', {
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
    logger_1.logger.error('All retry attempts exhausted', {
        context,
        attempts: config.maxAttempts,
        lastError: lastError.message
    });
    throw lastError;
}
function isRetryableError(error) {
    if (error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND') {
        return true;
    }
    if (error.response?.status) {
        const status = error.response.status;
        return status === 429 ||
            status === 503 ||
            status === 504 ||
            (status >= 500 && status < 600);
    }
    if (error.message && error.message.toLowerCase().includes('timeout')) {
        return true;
    }
    return false;
}
function getCacheStatistics() {
    const metrics = exports.cacheMetrics.getMetrics();
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
//# sourceMappingURL=cache-utils.js.map