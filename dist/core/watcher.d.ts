import type { LogEntry, SessionLogWatcher } from './types.js';
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
    private stopped;
    private options;
    constructor(options?: FileLogWatcherOptions);
    start(projectPath: string, sessionId: string): Promise<void>;
    stop(): void;
    onLine(callback: (entry: LogEntry) => void): () => void;
    getCursor(): {
        bytesRead: number;
        lastLine: number;
    };
    private watch;
    private scheduleRead;
    private readNewLines;
}
//# sourceMappingURL=watcher.d.ts.map