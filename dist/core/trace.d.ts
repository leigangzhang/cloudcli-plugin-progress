import type { ConversationTurn, LogProvider } from './types.js';
export type ExtractionMode = 'incremental' | 'full';
export interface ExtractionTraceContext {
    requestId: string;
    sessionId: string;
    cloudcliSessionId?: string;
    projectPath?: string;
    provider: LogProvider;
    logPath?: string;
    mode: ExtractionMode;
    parseScope?: 'full_file' | 'buffer';
    chunkIndex?: number;
    chunkTotal?: number;
}
export interface ConversationTraceMetrics {
    characters: number;
    userCharacters: number;
    assistantCharacters: number;
    thinkingCharacters: number;
    toolCharacters: number;
    estimatedTokens: number;
}
export interface ExtractionUsageTrace {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
}
export type ExtractionTraceEvent = {
    type: 'conversation';
    context: ExtractionTraceContext;
    turnCount: number;
    turnIds: string[];
    turns: ConversationTurn[];
    metrics: ConversationTraceMetrics;
} | {
    type: 'prompt';
    context: ExtractionTraceContext;
    attempt: number;
    strict: boolean;
    turnWindow: number;
    promptCharacters: number;
    estimatedPromptTokens: number;
    prompt: string;
} | {
    type: 'usage';
    context: ExtractionTraceContext;
    attempt: number;
    usage: ExtractionUsageTrace;
    error?: string;
    prompt?: string;
} | {
    type: 'response';
    context: ExtractionTraceContext;
    attempt: number;
    rawOutput: string;
    outputCharacters: number;
    parsedCharacters: number;
    outputTokens: number;
    error?: string;
};
export declare function estimateTokens(text: string | undefined): number;
export declare function measureConversationTurns(turns: ConversationTurn[]): ConversationTraceMetrics;
export declare function createTraceRequestId(): string;
export declare function extractionTraceEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function resolveExtractionTraceEnabled(configuredTrace: boolean | undefined, env?: NodeJS.ProcessEnv): boolean;
export declare function getExtractionTraceLogPath(env?: NodeJS.ProcessEnv, home?: string): string;
export declare function writeExtractionTrace(value: unknown, env?: NodeJS.ProcessEnv, home?: string): void;
//# sourceMappingURL=trace.d.ts.map