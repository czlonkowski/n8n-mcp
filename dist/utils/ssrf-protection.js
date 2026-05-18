"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSRFProtection = void 0;
const url_1 = require("url");
const promises_1 = require("dns/promises");
const net_1 = require("net");
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const ipaddr_js_1 = __importDefault(require("ipaddr.js"));
const logger_1 = require("./logger");
const CLOUD_METADATA = new Set([
    '169.254.169.254',
    '169.254.170.2',
    'metadata.google.internal',
    'metadata',
    '100.100.100.200',
    '192.0.0.192',
]);
const LOCALHOST_PATTERNS = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    'localhost.localdomain',
]);
const PRIVATE_IP_RANGES = [
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^169\.254\./,
    /^127\./,
    /^0\./,
];
class SSRFProtection {
    static isPrivateOrMappedIpv6(hostname) {
        if (!(0, net_1.isIPv6)(hostname))
            return false;
        if (hostname.startsWith('::'))
            return true;
        if (hostname.startsWith('0:0:0:0:0:ffff:'))
            return true;
        if (hostname.startsWith('fe80:'))
            return true;
        if (/^fe[c-f]/.test(hostname))
            return true;
        if (/^f[cd]/.test(hostname))
            return true;
        const embedded = SSRFProtection.tryExtractTunneledIPv4(hostname);
        if (embedded === 'non_canonical')
            return true;
        if (embedded !== null) {
            if (CLOUD_METADATA.has(embedded))
                return true;
            if (PRIVATE_IP_RANGES.some(regex => regex.test(embedded)))
                return true;
            return false;
        }
        return false;
    }
    static tryExtractTunneledIPv4(hostname) {
        let parsed;
        try {
            parsed = ipaddr_js_1.default.parse(hostname);
        }
        catch {
            return null;
        }
        if (parsed.kind() !== 'ipv6')
            return null;
        const p = parsed.parts;
        if (p[0] === 0x64 && p[1] === 0xff9b) {
            const rfc6052 = p[2] === 0 && p[3] === 0 && p[4] === 0 && p[5] === 0;
            const rfc8215 = p[2] === 0x0001 && p[3] === 0 && p[4] === 0 && p[5] === 0;
            if (rfc6052 || rfc8215) {
                return SSRFProtection.hextetsToIPv4(p[6], p[7]);
            }
            return 'non_canonical';
        }
        if (p[0] === 0x2002) {
            return SSRFProtection.hextetsToIPv4(p[1], p[2]);
        }
        if (p[0] === 0x2001 && p[1] === 0) {
            return SSRFProtection.hextetsToIPv4(p[6] ^ 0xffff, p[7] ^ 0xffff);
        }
        return null;
    }
    static hextetsToIPv4(hi, lo) {
        return `${(hi >>> 8) & 0xff}.${hi & 0xff}.${(lo >>> 8) & 0xff}.${lo & 0xff}`;
    }
    static tunneledIPv6BlockReason(addr) {
        if (!(0, net_1.isIPv6)(addr))
            return null;
        const embedded = SSRFProtection.tryExtractTunneledIPv4(addr);
        if (embedded === 'non_canonical')
            return 'IPv6 private/mapped address not allowed';
        if (typeof embedded === 'string' && CLOUD_METADATA.has(embedded)) {
            return 'Cloud metadata endpoint blocked';
        }
        return null;
    }
    static async validateWebhookUrl(urlString) {
        try {
            const url = new url_1.URL(urlString);
            const mode = (process.env.WEBHOOK_SECURITY_MODE || 'strict');
            if (!['http:', 'https:'].includes(url.protocol)) {
                return { valid: false, reason: 'Invalid protocol. Only HTTP/HTTPS allowed.' };
            }
            let hostname = url.hostname.toLowerCase();
            if (hostname.startsWith('[') && hostname.endsWith(']')) {
                hostname = hostname.slice(1, -1);
            }
            if (CLOUD_METADATA.has(hostname)) {
                logger_1.logger.warn('SSRF blocked: Cloud metadata endpoint', { hostname, mode });
                return { valid: false, reason: 'Cloud metadata endpoint blocked' };
            }
            let resolvedIP;
            let resolvedFamily;
            try {
                const { address, family } = await (0, promises_1.lookup)(hostname);
                resolvedIP = address;
                resolvedFamily = family === 6 ? 6 : 4;
                logger_1.logger.debug('DNS resolved for SSRF check', { hostname, resolvedIP, mode });
            }
            catch (error) {
                logger_1.logger.warn('DNS resolution failed for webhook URL', {
                    hostname,
                    error: error instanceof Error ? error.message : String(error)
                });
                return { valid: false, reason: 'DNS resolution failed' };
            }
            if (CLOUD_METADATA.has(resolvedIP)) {
                logger_1.logger.warn('SSRF blocked: Hostname resolves to cloud metadata IP', {
                    hostname,
                    resolvedIP,
                    mode
                });
                return { valid: false, reason: 'Hostname resolves to cloud metadata endpoint' };
            }
            const tunneledReason = SSRFProtection.tunneledIPv6BlockReason(resolvedIP);
            if (tunneledReason !== null) {
                logger_1.logger.warn('SSRF blocked: IPv6 tunneling rejection (all-mode gate)', {
                    hostname,
                    resolvedIP,
                    mode,
                    reason: tunneledReason
                });
                return { valid: false, reason: tunneledReason };
            }
            if (mode === 'permissive') {
                logger_1.logger.warn('SSRF protection in permissive mode (localhost and private IPs allowed)', {
                    hostname,
                    resolvedIP
                });
                return { valid: true, address: resolvedIP, family: resolvedFamily };
            }
            const isLocalhost = LOCALHOST_PATTERNS.has(hostname) ||
                resolvedIP === '::1' ||
                resolvedIP.startsWith('127.');
            if (mode === 'strict' && isLocalhost) {
                logger_1.logger.warn('SSRF blocked: Localhost not allowed in strict mode', {
                    hostname,
                    resolvedIP
                });
                return { valid: false, reason: 'Localhost access is blocked in strict mode' };
            }
            if (mode === 'moderate' && isLocalhost) {
                logger_1.logger.info('Localhost webhook allowed (moderate mode)', { hostname, resolvedIP });
                return { valid: true, address: resolvedIP, family: resolvedFamily };
            }
            if (PRIVATE_IP_RANGES.some(regex => regex.test(resolvedIP))) {
                logger_1.logger.warn('SSRF blocked: Private IP address', { hostname, resolvedIP, mode });
                return {
                    valid: false,
                    reason: mode === 'strict'
                        ? 'Private IP addresses not allowed'
                        : 'Private IP addresses not allowed (use WEBHOOK_SECURITY_MODE=permissive if needed)'
                };
            }
            if (SSRFProtection.isPrivateOrMappedIpv6(resolvedIP)) {
                logger_1.logger.warn('SSRF blocked: IPv6 private address', {
                    hostname,
                    resolvedIP,
                    mode
                });
                return { valid: false, reason: 'IPv6 private address not allowed' };
            }
            return { valid: true, address: resolvedIP, family: resolvedFamily };
        }
        catch (error) {
            return { valid: false, reason: 'Invalid URL format' };
        }
    }
    static createPinnedAgents(address, family) {
        const pinnedLookup = (_hostname, options, callback) => {
            if (options && options.all) {
                callback(null, [{ address, family }]);
            }
            else {
                callback(null, address, family);
            }
        };
        const httpAgent = new http_1.default.Agent({ keepAlive: false });
        const httpsAgent = new https_1.default.Agent({ keepAlive: false });
        const wrap = (agent) => {
            const proto = Object.getPrototypeOf(agent);
            const original = proto.createConnection;
            agent.createConnection = function (options, cb) {
                return original.call(this, { ...options, lookup: pinnedLookup }, cb);
            };
            agent.options = { ...(agent.options || {}), lookup: pinnedLookup };
            return agent;
        };
        return {
            httpAgent: wrap(httpAgent),
            httpsAgent: wrap(httpsAgent),
        };
    }
    static validateUrlSync(urlString) {
        if (typeof urlString !== 'string' || urlString.includes('#')) {
            return { valid: false, reason: 'URL fragments are not allowed' };
        }
        let url;
        try {
            url = new url_1.URL(urlString);
        }
        catch {
            return { valid: false, reason: 'Invalid URL format' };
        }
        if (!['http:', 'https:'].includes(url.protocol)) {
            return { valid: false, reason: 'Invalid protocol. Only HTTP/HTTPS allowed.' };
        }
        if (url.username !== '' || url.password !== '') {
            return { valid: false, reason: 'Userinfo in URL is not allowed' };
        }
        let hostname = url.hostname.toLowerCase();
        if (hostname.startsWith('[') && hostname.endsWith(']')) {
            hostname = hostname.slice(1, -1);
        }
        if (CLOUD_METADATA.has(hostname)) {
            return { valid: false, reason: 'Cloud metadata endpoint blocked' };
        }
        const tunneledReason = SSRFProtection.tunneledIPv6BlockReason(hostname);
        if (tunneledReason !== null) {
            return { valid: false, reason: tunneledReason };
        }
        const mode = (process.env.WEBHOOK_SECURITY_MODE || 'strict');
        if (mode === 'permissive') {
            return { valid: true };
        }
        if (mode === 'strict' && LOCALHOST_PATTERNS.has(hostname)) {
            return { valid: false, reason: 'Localhost access is blocked in strict mode' };
        }
        if (PRIVATE_IP_RANGES.some(regex => regex.test(hostname))) {
            return {
                valid: false,
                reason: mode === 'strict'
                    ? 'Private IP addresses not allowed'
                    : 'Private IP addresses not allowed (use WEBHOOK_SECURITY_MODE=permissive if needed)'
            };
        }
        if (SSRFProtection.isPrivateOrMappedIpv6(hostname)) {
            return { valid: false, reason: 'IPv6 private/mapped address not allowed' };
        }
        return { valid: true };
    }
}
exports.SSRFProtection = SSRFProtection;
//# sourceMappingURL=ssrf-protection.js.map