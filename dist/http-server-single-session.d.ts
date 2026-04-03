#!/usr/bin/env node
import express from 'express';
import { InstanceContext } from './types/instance-context';
import { SessionState } from './types/session-state';
import { GenerateWorkflowHandler } from './types/generate-workflow';
export interface SingleSessionHTTPServerOptions {
    generateWorkflowHandler?: GenerateWorkflowHandler;
}
export declare class SingleSessionHTTPServer {
    private transports;
    private servers;
    private sessionMetadata;
    private sessionContexts;
    private contextSwitchLocks;
    private consoleManager;
    private expressServer;
    private sessionTimeout;
    private authToken;
    private cleanupTimer;
    private generateWorkflowHandler?;
    constructor(options?: SingleSessionHTTPServerOptions);
    private startSessionCleanup;
    private cleanupExpiredSessions;
    private removeSession;
    private getActiveSessionCount;
    private canCreateSession;
    private isValidSessionId;
    private isJsonRpcNotification;
    private sanitizeErrorForClient;
    private updateSessionAccess;
    private authenticateRequest;
    private switchSessionContext;
    private performContextSwitch;
    private getSessionMetrics;
    private loadAuthToken;
    private validateEnvironment;
    handleRequest(req: express.Request, res: express.Response, instanceContext?: InstanceContext): Promise<void>;
    private createSSESession;
    private isSessionExpired;
    start(): Promise<void>;
    shutdown(): Promise<void>;
    getSessionInfo(): {
        active: boolean;
        sessionId?: string;
        age?: number;
        sessions?: {
            total: number;
            active: number;
            expired: number;
            max: number;
            sessionIds: string[];
        };
    };
    exportSessionState(): SessionState[];
    restoreSessionState(sessions: SessionState[]): number;
}
//# sourceMappingURL=http-server-single-session.d.ts.map