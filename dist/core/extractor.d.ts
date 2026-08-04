import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn, LLMConfig, LLMExtractionEngine, ProgressTree } from './types.js';
export type { Anthropic };
export interface LLMExtractionEngineOptions {
    config: LLMConfig;
    client?: Anthropic;
}
export declare function summarizeTurns(turns: ConversationTurn[], turnLimit?: number, maxFieldLength?: number): ConversationTurn[];
export declare class LLMExtractionEngineImpl implements LLMExtractionEngine {
    private client;
    private config;
    private usageListeners;
    constructor(options: LLMExtractionEngineOptions);
    extract(tree: ProgressTree, turns: ConversationTurn[], onProgress?: (tree: ProgressTree) => void): Promise<ProgressTree>;
    private extractWithRetry;
    private extractByPolling;
    onUsage(callback: (usage: {
        inputTokens: number;
        outputTokens: number;
    }) => void): () => void;
    private doExtract;
}
//# sourceMappingURL=extractor.d.ts.map