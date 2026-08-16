import type { LLMConfig, LLMExtractionEngine } from './core/types.js';
export interface ProgressServerOptions {
    port?: number;
    config?: LLMConfig;
    projectsDir?: string;
    snapshotDir?: string;
    extractor?: LLMExtractionEngine;
    detectorOptions?: import('./core/diff-detector.js').DiffDetectorOptions;
}
export declare class ProgressServer {
    private httpServer?;
    private wss?;
    private extractor?;
    private clients;
    private sessions;
    private cloudcliToReal;
    private config;
    private options;
    constructor(options?: ProgressServerOptions);
    start(): Promise<{
        port: number;
    }>;
    stop(): Promise<void>;
    private chooseExtractor;
    private createSessionExtractor;
    private bindDetector;
    private migrateClients;
    private getSessionTurns;
    private getOrCreateSession;
    private resolveSessionId;
    private handleHttp;
    private handleHealth;
    private handleWatch;
    private handleProgress;
    private handleRefresh;
    private handleTurn;
    private handleDebug;
    private buildProgressResponse;
    private getDefaultSessionId;
    private handleWs;
    private send;
    private broadcast;
    private setStatus;
}
//# sourceMappingURL=server.d.ts.map