import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn, LLMConfig, LLMExtractionEngine, ProgressTree } from './types.js';
export type { Anthropic };
export interface LLMExtractionEngineOptions {
    config: LLMConfig;
    client?: Anthropic;
}
export declare class LLMExtractionEngineImpl implements LLMExtractionEngine {
    private client;
    private config;
    private usageListeners;
    constructor(options: LLMExtractionEngineOptions);
    extract(tree: ProgressTree, turns: ConversationTurn[]): Promise<ProgressTree>;
    onUsage(callback: (usage: {
        inputTokens: number;
        outputTokens: number;
    }) => void): () => void;
    private doExtract;
}
//# sourceMappingURL=extractor.d.ts.map