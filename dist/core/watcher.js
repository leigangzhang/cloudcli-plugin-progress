import fs from 'node:fs';
import readline from 'node:readline';
import { resolveSessionLogPath } from './paths.js';
import { isLogEntry, parseJsonLine } from './protocol.js';
export class FileLogWatcher {
    constructor(options = {}) {
        this.filePath = '';
        this.position = 0;
        this.lineCount = 0;
        this.watcher = null;
        this.pollTimer = null;
        this.readTimer = null;
        this.listeners = [];
        this.stopped = false;
        this.options = {
            watchImpl: options.watchImpl ?? 'auto',
            pollInterval: options.pollInterval ?? 1000,
            debounceMs: options.debounceMs ?? 100,
            projectsDir: options.projectsDir,
        };
    }
    async start(projectPath, sessionId) {
        this.filePath = (await resolveSessionLogPath(projectPath, sessionId, this.options.projectsDir)).logPath;
        await this.readNewLines();
        this.watch();
    }
    stop() {
        this.stopped = true;
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.readTimer) {
            clearTimeout(this.readTimer);
            this.readTimer = null;
        }
    }
    onLine(callback) {
        this.listeners.push(callback);
        return () => {
            const idx = this.listeners.indexOf(callback);
            if (idx !== -1)
                this.listeners.splice(idx, 1);
        };
    }
    getCursor() {
        return { bytesRead: this.position, lastLine: this.lineCount };
    }
    getFilePath() {
        return this.filePath;
    }
    watch() {
        if (this.options.watchImpl === 'watchFile') {
            this.pollTimer = setInterval(() => this.readNewLines(), this.options.pollInterval);
            return;
        }
        try {
            this.watcher = fs.watch(this.filePath, (eventType) => {
                if (eventType === 'change' || eventType === 'rename') {
                    this.scheduleRead();
                }
            });
        }
        catch {
            if (this.options.watchImpl === 'watch') {
                // Explicit watch requested but failed; do not silently fallback.
                return;
            }
            this.pollTimer = setInterval(() => this.readNewLines(), this.options.pollInterval);
        }
    }
    scheduleRead() {
        if (this.readTimer) {
            clearTimeout(this.readTimer);
        }
        this.readTimer = setTimeout(() => {
            this.readTimer = null;
            void this.readNewLines();
        }, this.options.debounceMs);
    }
    async readNewLines() {
        if (this.stopped)
            return;
        let stat;
        try {
            stat = fs.statSync(this.filePath);
        }
        catch {
            return;
        }
        const size = stat.size;
        if (size < this.position) {
            this.position = 0;
            this.lineCount = 0;
        }
        if (size === this.position) {
            return;
        }
        const stream = fs.createReadStream(this.filePath, {
            start: this.position,
            end: size - 1,
            encoding: 'utf-8',
        });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
            if (!line)
                continue;
            this.lineCount++;
            const parsed = parseJsonLine(line);
            if (isLogEntry(parsed)) {
                this.listeners.forEach((cb) => cb(parsed));
            }
        }
        this.position = size;
    }
}
//# sourceMappingURL=watcher.js.map