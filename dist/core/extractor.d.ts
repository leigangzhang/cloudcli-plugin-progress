import Anthropic from '@anthropic-ai/sdk';
import { type ExtractionTraceContext, type ExtractionTraceEvent } from './trace.js';
import type { ConversationTurn, LLMConfig, LLMExtractionEngine, ProgressTree } from './types.js';
export type { Anthropic };
export interface LLMExtractionEngineOptions {
    config: LLMConfig;
    client?: Anthropic;
    trace?: (event: ExtractionTraceEvent) => void;
}
export declare class LLMExtractionEngineImpl implements LLMExtractionEngine {
    private client;
    private config;
    private usageListeners;
    private trace;
    constructor(options: LLMExtractionEngineOptions);
    extract(tree: ProgressTree, turns: ConversationTurn[], onProgress?: (tree: ProgressTree) => void, traceContext?: ExtractionTraceContext): Promise<ProgressTree>;
    private extractChunk;
    onUsage(callback: (usage: {
        inputTokens: number;
        outputTokens: number;
    }) => void): () => void;
    private doExtract;
}
//# sourceMappingURL=extractor.d.ts.map