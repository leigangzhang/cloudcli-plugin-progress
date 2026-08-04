import type { ConversationSegment, LogEntry } from './types.js';
export declare class ConversationBuffer {
    private entries;
    private lineCounter;
    private lineNumbers;
    private maxEntries;
    constructor(maxEntries?: number);
    push(entry: LogEntry): void;
    getSegments(limit?: number): ConversationSegment[];
    getTurns(): import('./types.js').ConversationTurn[];
    private buildSegment;
    private processAssistantBlock;
    private processUserBlock;
}
//# sourceMappingURL=buffer.d.ts.map