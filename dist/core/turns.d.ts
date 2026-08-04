import type { ConversationTurn, LogEntry } from './types.js';
export interface LogEntryWithLine {
    entry: LogEntry;
    lineNumber: number;
}
export declare function buildTurns(entries: LogEntryWithLine[]): ConversationTurn[];
export declare function buildTurnsFromLog(logPath: string): ConversationTurn[];
//# sourceMappingURL=turns.d.ts.map