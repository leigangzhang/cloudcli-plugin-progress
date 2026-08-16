import type { SessionLogEntry, SessionLogWatcher } from './types.js';
export interface FileLogWatcherOptions {
    watchImpl?: 'auto' | 'watch' | 'watchFile';
    pollInterval?: number;
    debounceMs?: number;
    projectsDir?: string;
}
export declare class FileLogWatcher implements SessionLogWatcher {
    private filePath;
    private position;
    private lineCount;
    private watcher;
    private pollTimer;
    private readTimer;
    private listeners;
    private pendingPartialLine;
    private stopped;
    private options;
    constructor(options?: FileLogWatcherOptions);
    start(projectPath: string, sessionId: string): Promise<void>;
    startWithPath(filePath: string): Promise<void>;
    stop(): void;
    onLine(callback: (entry: SessionLogEntry) => void): () => void;
    getCursor(): {
        bytesRead: number;
        lastLine: number;
    };
    getFilePath(): string;
    private watch;
    private scheduleRead;
    private readNewLines;
    private emitLines;
}
//# sourceMappingURL=watcher.d.ts.map