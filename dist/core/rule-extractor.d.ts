import type { ConversationTurn, ExtractionMode, LLMExtractionEngine, ProgressTree } from './types.js';
import type { ExtractionTraceContext } from './trace.js';
export declare class RuleBasedExtractionEngine implements LLMExtractionEngine {
    extract(tree: ProgressTree, turns: ConversationTurn[], onProgress?: (tree: ProgressTree) => void, traceContext?: ExtractionTraceContext): Promise<ProgressTree>;
    onUsage(_callback: (usage: {
        inputTokens: number;
        outputTokens: number;
    }) => void): () => void;
    readonly mode: ExtractionMode;
}
//# sourceMappingURL=rule-extractor.d.ts.map