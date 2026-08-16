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
7. Infer progress only from the user's question and the model's final reply. Do not attempt to recover or infer internal reasoning, tool calls, or tool output; those fields are intentionally omitted from the input.
8. Detect the dominant language used by the user across the turns and generate the progress tree in that same language. Prefer the user's language over the assistant's.
9. Every goal and every step must include a non-empty string "id". Preserve IDs from the current tree where possible; when a node is new, create a stable unique ID from its subject and promptId.
10. Every step must include the exact promptId of the conversation turn it represents.
11. Output ONLY valid JSON matching the ProgressTree schema. Do not wrap it in markdown.`;
function buildPrompt(tree, turns, strict = false) {
    const base = `Current Progress Tree:
${JSON.stringify(tree, null, 2)}

Conversation Turns:
${JSON.stringify(turns, null, 2)}`;
    if (strict) {
        return (base +
            '\n\nIMPORTANT: Your previous output was invalid. This time output only raw JSON. No markdown, no explanation. Every goal and step must have a non-empty "id"; every step must also have the exact "promptId" from its conversation turn.');
    }
    return base;
}
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function stableHash(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
function uniqueId(base, used) {
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
        candidate = `${base}-${suffix++}`;
    }
    used.add(candidate);
    return candidate;
}
function previousGoalForCandidate(goal, previous) {
    const stepPromptIds = new Set();
    if (Array.isArray(goal.steps)) {
        for (const step of goal.steps) {
            if (!isObject(step))
                continue;
            const promptId = nonEmptyString(step.promptId);
            if (promptId)
                stepPromptIds.add(promptId);
        }
    }
    if (stepPromptIds.size > 0) {
        let best;
        let bestMatches = 0;
        for (const oldGoal of previous.goals) {
            const matches = (oldGoal.steps ?? []).filter((step) => stepPromptIds.has(step.promptId)).length;
            if (matches > bestMatches) {
                best = oldGoal;
                bestMatches = matches;
            }
        }
        if (best && bestMatches > 0)
            return best;
    }
    const subject = nonEmptyString(goal.subject);
    if (!subject)
        return undefined;
    return previous.goals.find((oldGoal) => oldGoal.subject === subject);
}
function previousStepByPromptId(previous) {
    const steps = new Map();
    for (const goal of previous.goals) {
        for (const step of goal.steps ?? []) {
            steps.set(step.promptId, step);
        }
    }
    return steps;
}
/**
 * LLMs occasionally return `""` for ids despite the prompt requiring them.
 * Repair those values before schema validation so an otherwise usable tree is
 * not discarded. Existing nodes are matched through promptId; new nodes get a
 * deterministic fallback id that remains stable across incremental extracts.
 */
function repairProgressTreeIds(parsed, previous) {
    if (!isObject(parsed) || !Array.isArray(parsed.goals)) {
        return parsed;
    }
    const previousGoalsById = new Map(previous.goals.map((goal) => [goal.id, goal]));
    const previousSteps = previousStepByPromptId(previous);
    const usedGoalIds = new Set();
    const usedStepIds = new Set();
    const goals = parsed.goals.map((goal) => {
        if (!isObject(goal))
            return goal;
        const suppliedId = nonEmptyString(goal.id);
        const previousGoal = suppliedId
            ? previousGoalsById.get(suppliedId)
            : previousGoalForCandidate(goal, previous);
        let goalId;
        if (suppliedId && !usedGoalIds.has(suppliedId)) {
            usedGoalIds.add(suppliedId);
            goalId = suppliedId;
        }
        else {
            goalId = uniqueId(previousGoal?.id ??
                `goal-${stableHash(nonEmptyString(goal.subject) ?? 'unknown-goal')}`, usedGoalIds);
        }
        const steps = Array.isArray(goal.steps)
            ? goal.steps.map((step, index) => {
                if (!isObject(step))
                    return step;
                const suppliedStepId = nonEmptyString(step.id);
                const promptId = nonEmptyString(step.promptId);
                const previousStep = promptId ? previousSteps.get(promptId) : undefined;
                let stepId;
                if (suppliedStepId && !usedStepIds.has(suppliedStepId)) {
                    usedStepIds.add(suppliedStepId);
                    stepId = suppliedStepId;
                }
                else {
                    stepId = uniqueId(previousStep?.id ?? `step-${stableHash(promptId ?? `${goalId}:${index}`)}`, usedStepIds);
                }
                return { ...step, id: stepId };
            })
            : undefined;
        return { ...goal, id: goalId, ...(steps ? { steps } : {}) };
    });
    return { ...parsed, goals: goals };
}
function extractJsonObject(text) {
    const start = text.indexOf('{');
    if (start === -1) {
        throw new Error('No JSON object found in response');
    }
    // Find the outermost balanced JSON object instead of relying on the first
    // and last braces. This handles responses that contain multiple objects or
    // trailing text after the main object.
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const char = text[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\' && inString) {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (char === '{')
            depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }
    // Fallback to the old heuristic if no balanced object was found.
    const end = text.lastIndexOf('}');
    if (end === -1 || end < start) {
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
        assistantText: truncateText(turn.assistantText, maxFieldLength),
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
    async extract(tree, turns, onProgress) {
        if (this.config.usePolling && turns.length > 5) {
            return this.extractByPolling(tree, turns, onProgress);
        }
        const result = await this.extractWithRetry(tree, turns);
        onProgress?.(result);
        return result;
    }
    async extractWithRetry(tree, turns) {
        try {
            return await this.doExtract(tree, summarizeTurns(turns, 20), false);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('No JSON object found in response') ||
                message.includes('JSON') ||
                message.includes('SyntaxError')) {
                // Prompt likely too large or model returned malformed JSON; retry with
                // only the last 5 summarized turns and a stricter prompt.
                return await this.doExtract(tree, summarizeTurns(turns, 5), true);
            }
            // Retry once with a stricter prompt before giving up.
            return await this.doExtract(tree, summarizeTurns(turns, 20), true);
        }
    }
    async extractByPolling(tree, turns, onProgress) {
        const chunkSize = 5;
        const chunks = chunkTurns(turns, chunkSize);
        let currentTree = tree;
        for (const chunk of chunks) {
            try {
                currentTree = await this.extractWithRetry(currentTree, chunk);
            }
            catch (err) {
                // If the accumulated tree makes the prompt too large, fall back to
                // extracting this chunk independently before giving up.
                console.warn('Chunk extraction failed with accumulated tree, retrying with empty tree:', err.message);
                currentTree = await this.extractWithRetry({ version: 0, goals: [] }, chunk);
            }
            onProgress?.(currentTree);
        }
        return currentTree;
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
        const parsed = repairProgressTreeIds(JSON.parse(jsonText), tree);
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