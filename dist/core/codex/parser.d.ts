import type { ConversationTurn, SessionLogEntry } from '../types.js';
import type { CodexEntryWithLine } from './types.js';
export declare function buildCodexTurns(entries: CodexEntryWithLine[]): ConversationTurn[];
export declare function buildCodexTurnsFromLog(logPath: string): ConversationTurn[];
export declare function isCodexProgressEntry(entry: SessionLogEntry): boolean;
//# sourceMappingURL=parser.d.ts.map