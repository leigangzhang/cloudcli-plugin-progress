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
    private watcher;
    private buffer;
    private detector;
    private store;
    private extractor?;
    private clients;
    private config;
    private options;
    private activeSessionId;
    private status;
    private errorMessage?;
    constructor(options?: ProgressServerOptions);
    start(): Promise<{
        port: number;
    }>;
    stop(): Promise<void>;
    private bindDetector;
    private handleHttp;
    private handleHealth;
    private handleWatch;
    private handleProgress;
    private handleRefresh;
    private buildProgressResponse;
    private startSession;
    private handleWs;
    private send;
    private broadcast;
    private setStatus;
}
//# sourceMappingURL=server.d.ts.map