 import fs from 'node:fs';
 import readline from 'node:readline';
 import { resolveSessionLogPath } from './paths.js';
 import { isLogEntry, parseJsonLine } from './protocol.js';
 import type { LogEntry, SessionLogWatcher } from './types.js';

 export interface FileLogWatcherOptions {
   watchImpl?: 'auto' | 'watch' | 'watchFile';
   pollInterval?: number;
   debounceMs?: number;
   projectsDir?: string;
 }

 export class FileLogWatcher implements SessionLogWatcher {
   private filePath = '';
   private position = 0;
   private lineCount = 0;
   private watcher: fs.FSWatcher | null = null;
   private pollTimer: ReturnType<typeof setInterval> | null = null;
   private readTimer: ReturnType<typeof setTimeout> | null = null;
   private listeners: ((entry: LogEntry) => void)[] = [];
   private stopped = false;
   private options: Required<Pick<FileLogWatcherOptions, 'watchImpl' | 'pollInterval' | 'debounceMs'>> &
     Pick<FileLogWatcherOptions, 'projectsDir'>;

   constructor(options: FileLogWatcherOptions = {}) {
     this.options = {
       watchImpl: options.watchImpl ?? 'auto',
       pollInterval: options.pollInterval ?? 1000,
       debounceMs: options.debounceMs ?? 100,
       projectsDir: options.projectsDir,
     };
   }

   async start(projectPath: string, sessionId: string): Promise<void> {
     this.filePath = (await resolveSessionLogPath(projectPath, sessionId, this.options.projectsDir)).logPath;
     await this.readNewLines();
     this.watch();
   }

   stop(): void {
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

   onLine(callback: (entry: LogEntry) => void): () => void {
     this.listeners.push(callback);
     return () => {
       const idx = this.listeners.indexOf(callback);
       if (idx !== -1) this.listeners.splice(idx, 1);
     };
   }

   getCursor(): { bytesRead: number; lastLine: number } {
     return { bytesRead: this.position, lastLine: this.lineCount };
   }

   getFilePath(): string {
     return this.filePath;
   }

   private watch(): void {
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
     } catch {
       if (this.options.watchImpl === 'watch') {
         // Explicit watch requested but failed; do not silently fallback.
         return;
       }
       this.pollTimer = setInterval(() => this.readNewLines(), this.options.pollInterval);
     }
   }

   private scheduleRead(): void {
     if (this.readTimer) {
       clearTimeout(this.readTimer);
     }
     this.readTimer = setTimeout(() => {
       this.readTimer = null;
       void this.readNewLines();
     }, this.options.debounceMs);
   }

   private async readNewLines(): Promise<void> {
     if (this.stopped) return;
     let stat: fs.Stats;
     try {
       stat = fs.statSync(this.filePath);
     } catch {
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
       if (!line) continue;
       this.lineCount++;
       const parsed = parseJsonLine(line);
       if (isLogEntry(parsed)) {
         this.listeners.forEach((cb) => cb(parsed));
       }
     }
     this.position = size;
   }
 }
