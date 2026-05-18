import http from 'http';
import https from 'https';
export interface PinnedAgents {
    httpAgent: http.Agent;
    httpsAgent: https.Agent;
}
export interface WebhookUrlValidationResult {
    valid: boolean;
    reason?: string;
    address?: string;
    family?: 4 | 6;
}
export declare class SSRFProtection {
    private static isPrivateOrMappedIpv6;
    private static tryExtractTunneledIPv4;
    private static hextetsToIPv4;
    private static tunneledIPv6BlockReason;
    static validateWebhookUrl(urlString: string): Promise<WebhookUrlValidationResult>;
    static createPinnedAgents(address: string, family: 4 | 6): PinnedAgents;
    static validateUrlSync(urlString: string): {
        valid: boolean;
        reason?: string;
    };
}
//# sourceMappingURL=ssrf-protection.d.ts.map