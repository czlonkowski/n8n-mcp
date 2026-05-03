export type AuthFailureReason = 'no_auth_header' | 'invalid_auth_format' | 'invalid_token';
export declare function buildBearerChallenge(reason: AuthFailureReason, realm?: string): string;
export declare class AuthManager {
    private validTokens;
    private tokenExpiry;
    constructor();
    validateToken(token: string | undefined, expectedToken?: string): boolean;
    generateToken(expiryHours?: number): string;
    revokeToken(token: string): void;
    private cleanupExpiredTokens;
    static hashToken(token: string): string;
    static compareTokens(plainToken: string, hashedToken: string): boolean;
    static timingSafeCompare(plainToken: string, expectedToken: string): boolean;
}
//# sourceMappingURL=auth.d.ts.map