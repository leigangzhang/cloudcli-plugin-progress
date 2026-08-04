import Anthropic from '@anthropic-ai/sdk';
import { validateProgressTree } from './schema.js';
const SYSTEM_PROMPT = `You are a session progress extractor. Your job is to analyze conversation turns and produce a two-level progress tree.

Rules:
1. Top-level nodes (goals) are high-level discussion topics or objectives identified across the conversation.
2. Every second-level node (step) must represent exactly one conversation turn. Use the turn's promptId as the step's promptId.
3. Do not merge multiple turns into a single step. If the same topic is discussed across multiple turns, create a separate step for each turn under the same goal.
4. Keep existing goal/step IDs stable when they still match the conversation. Only add new goals/steps, update status, or mark nodes completed based on the turns.
5. Mark a goal or step as completed only when the turn clearly indicates completion.
6. Use one clear sentence for each subject and one clear sentence for each description. Do not enforce character limits; focus on clarity and usefulness.
7. Detect the dominant language used by the user across the turns and generate the progress tree in that same language. Prefer the user's language over the assistant's.
8. Output ONLY valid JSON matching the ProgressTree schema. Do not wrap it in markdown.`;
const MERGE_SYSTEM_PROMPT = `You are a progress tree merger. Your job is to combine multiple partial progress trees into one coherent progress tree.

Rules:
1. Combine goals that discuss the same theme or objective, even if they appear in different partial trees or are non-contiguous in the conversation.
2. If multiple subjects clearly discuss the same topic, merge them under a single goal with a representative subject and description.
3. Keep every unique conversation turn as a separate step. Steps are identified by their promptId.
4. Do not drop any steps. Preserve all promptIds from all partial trees.
5. When merging duplicate goals or steps, use the highest status in this priority: completed > in_progress > pending > deleted.
6. Use one clear sentence for each subject and one clear sentence for each description.
7. Output ONLY valid JSON matching the ProgressTree schema. Do not wrap it in markdown.`;
function buildPrompt(tree, turns, strict = false) {
    const base = `Current Progress Tree:
${JSON.stringify(tree, null, 2)}

Conversation Turns:
${JSON.stringify(turns, null, 2)}`;
    if (strict) {
        return (base +
            '\n\nIMPORTANT: Your previous output was invalid. This time output only raw JSON. No markdown, no explanation.');
    }
    return base;
}
function buildMergePrompt(trees) {
    return `Partial Progress Trees:
${JSON.stringify(trees, null, 2)}

Merge these partial trees into a single progress tree. Combine goals with similar themes, keep all unique steps (one per promptId), and output valid JSON.`;
}
function extractJsonObject(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
        throw new Error('No JSON object found in response');
    }
    return text.slice(start, end + 1);
}
export function summarizeTurns(turns, turnLimit = 20, maxFieldLength = 2000) {
    return turns.slice(-turnLimit).map((turn) => ({
        promptId: turn.promptId,
        lineStart: turn.lineStart,
        lineEnd: turn.lineEnd,
        timestamp: turn.timestamp,
        userText: truncateText(turn.userText, maxFieldLength),
        thinkingText: truncateText(turn.thinkingText, maxFieldLength),
        assistantText: truncateText(turn.assistantText, maxFieldLength),
        toolText: truncateText(turn.toolText, maxFieldLength),
    }));
}
function truncateText(text, maxLength) {
    if (!text)
        return undefined;
    if (text.length <= maxLength)
        return text;
    return text.slice(0, maxLength) + '\n...[truncated]';
}
function chunkTurns(turns, size) {
    const chunks = [];
    for (let i = 0; i < turns.length; i += size) {
        chunks.push(turns.slice(i, i + size));
    }
    return chunks;
}
function statusRank(status) {
    switch (status) {
        case 'completed':
            return 3;
        case 'in_progress':
            return 2;
        case 'pending':
            return 1;
        case 'deleted':
        default:
            return 0;
    }
}
function concatenateTrees(trees) {
    const goalMap = new Map();
    let version = 0;
    for (const tree of trees) {
        version = Math.max(version, tree.version);
        for (const goal of tree.goals) {
            const existing = goalMap.get(goal.id);
            if (existing) {
                const stepMap = new Map();
                for (const step of existing.steps ?? [])
                    stepMap.set(step.id, step);
                for (const step of goal.steps ?? [])
                    stepMap.set(step.id, step);
                existing.steps = Array.from(stepMap.values());
                if (statusRank(goal.status) > statusRank(existing.status)) {
                    existing.status = goal.status;
                }
            }
            else {
                goalMap.set(goal.id, goal);
            }
        }
    }
    return { version, goals: Array.from(goalMap.values()) };
}
export class LLMExtractionEngineImpl {
    constructor(options) {
        this.usageListeners = [];
        this.config = options.config;
        this.client =
            options.client ??
                new Anthropic({
                    apiKey: this.config.apiKey,
                    baseURL: this.config.baseUrl,
                    maxRetries: this.config.maxRetries ?? 3,
                    timeout: this.config.requestTimeoutMs ?? 60000,
                });
    }
    async extract(tree, turns) {
        if (this.config.usePolling && turns.length > 5) {
            return this.extractByPolling(tree, turns);
        }
        try {
            return await this.doExtract(tree, summarizeTurns(turns, 20), false);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('No JSON object found in response')) {
                // Prompt likely too large; retry with only the last 5 summarized turns.
                return await this.doExtract(tree, summarizeTurns(turns, 5), true);
            }
            // Retry once with a stricter prompt before giving up.
            return await this.doExtract(tree, summarizeTurns(turns, 20), true);
        }
    }
    onUsage(callback) {
        this.usageListeners.push(callback);
        return () => {
            const idx = this.usageListeners.indexOf(callback);
            if (idx !== -1) {
                this.usageListeners.splice(idx, 1);
            }
        };
    }
    async extractByPolling(tree, turns) {
        const chunkSize = 5;
        const chunks = chunkTurns(turns, chunkSize);
        const partialTrees = [];
        for (const chunk of chunks) {
            const partial = await this.doExtract({ version: partialTrees.length, goals: [] }, summarizeTurns(chunk, chunkSize), false);
            partialTrees.push(partial);
        }
        const treesToMerge = tree.goals.length > 0 ? [tree, ...partialTrees] : partialTrees;
        try {
            return await this.doMerge(treesToMerge);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('Merge failed, falling back to concatenation:', message);
            return concatenateTrees(treesToMerge);
        }
    }
    async doExtract(tree, turns, strict) {
        const response = await this.client.messages.create({
            model: this.config.model,
            max_tokens: this.config.maxTokens ?? 4096,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildPrompt(tree, turns, strict) }],
        });
        const text = response.content
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join('');
        const jsonText = extractJsonObject(text);
        const parsed = JSON.parse(jsonText);
        const errors = validateProgressTree(parsed);
        if (errors.length > 0) {
            throw new Error('Schema validation failed: ' + errors.join('; '));
        }
        const usage = response.usage;
        this.usageListeners.forEach((cb) => cb({
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
        }));
        return parsed;
    }
    async doMerge(trees) {
        const response = await this.client.messages.create({
            model: this.config.model,
            max_tokens: this.config.maxTokens ?? 4096,
            system: MERGE_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildMergePrompt(trees) }],
        });
        const text = response.content
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join('');
        const jsonText = extractJsonObject(text);
        const parsed = JSON.parse(jsonText);
        const errors = validateProgressTree(parsed);
        if (errors.length > 0) {
            throw new Error('Schema validation failed: ' + errors.join('; '));
        }
        const usage = response.usage;
        this.usageListeners.forEach((cb) => cb({
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
        }));
        return parsed;
    }
}
//# sourceMappingURL=extractor.js.map