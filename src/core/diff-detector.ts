 import { ConversationBuffer } from './buffer.js';
 import type { ConversationSegment, DiffDetector, LogEntry } from './types.js';

 export interface DiffDetectorOptions {
   debounceMs?: number;
   minIntervalMs?: number;
   segmentLimit?: number;
 }

 export class DiffDetectorImpl implements DiffDetector {
   private buffer: ConversationBuffer;
   private listeners: ((segments: ConversationSegment[]) => void)[] = [];
   private debounceTimer: ReturnType<typeof setTimeout> | null = null;
   private lastTriggerTime = 0;
   private options: Required<DiffDetectorOptions>;

   constructor(buffer: ConversationBuffer, options: DiffDetectorOptions = {}) {
     this.buffer = buffer;
     this.options = {
       debounceMs: options.debounceMs ?? 3000,
       minIntervalMs: options.minIntervalMs ?? 3000,
       segmentLimit: options.segmentLimit ?? 10,
     };
   }

   ingest(entry: LogEntry): void {
     this.buffer.push(entry);
     if (this.isRelevant(entry)) {
       this.scheduleTrigger();
     }
   }

   onTrigger(callback: (segments: ConversationSegment[]) => void): () => void {
     this.listeners.push(callback);
     return () => {
       const idx = this.listeners.indexOf(callback);
       if (idx !== -1) {
         this.listeners.splice(idx, 1);
       }
     };
   }

   flush(): void {
     if (this.debounceTimer) {
       clearTimeout(this.debounceTimer);
       this.debounceTimer = null;
     }
     this.fire();
   }

   private isRelevant(entry: LogEntry): boolean {
     if (entry.type === 'assistant') {
       if (entry.stopReason === 'end_turn') {
         return true;
       }
       const blocks = entry.content ?? [];
       return blocks.some((b) => b.type === 'thinking' || b.type === 'tool_use');
     }
     return entry.type === 'user';
   }

   private scheduleTrigger(): void {
     if (this.debounceTimer) {
       clearTimeout(this.debounceTimer);
     }
     this.debounceTimer = setTimeout(() => {
       this.debounceTimer = null;
       this.fire();
     }, this.options.debounceMs);
   }

   private fire(): void {
     const now = Date.now();
     const elapsed = now - this.lastTriggerTime;
     if (elapsed < this.options.minIntervalMs) {
       const delay = this.options.minIntervalMs - elapsed;
       this.debounceTimer = setTimeout(() => {
         this.debounceTimer = null;
         this.fire();
       }, delay);
       return;
     }
     this.lastTriggerTime = now;
     const segments = this.buffer.getSegments(this.options.segmentLimit);
     if (segments.length > 0) {
       this.listeners.forEach((cb) => cb(segments));
     }
   }
 }
