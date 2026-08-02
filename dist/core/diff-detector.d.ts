import { ConversationBuffer } from './buffer.js';
import type { ConversationSegment, DiffDetector, LogEntry } from './types.js';
export interface DiffDetectorOptions {
    debounceMs?: number;
    minIntervalMs?: number;
    segmentLimit?: number;
}
export declare class DiffDetectorImpl implements DiffDetector {
    private buffer;
    private listeners;
    private debounceTimer;
    private lastTriggerTime;
    private options;
    constructor(buffer: ConversationBuffer, options?: DiffDetectorOptions);
    ingest(entry: LogEntry): void;
    onTrigger(callback: (segments: ConversationSegment[]) => void): () => void;
    flush(): void;
    private isRelevant;
    private scheduleTrigger;
    private fire;
}
//# sourceMappingURL=diff-detector.d.ts.map