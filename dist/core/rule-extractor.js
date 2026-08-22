const QUERY_GOAL_ID = 'user-queries';
const QUERY_GOAL_SUBJECT = 'User queries';
const QUERY_SUBJECT_LIMIT = 120;
function stableHash(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
function normalizeSubject(value) {
    const normalized = value?.replace(/\s+/g, ' ').trim();
    if (!normalized)
        return undefined;
    if (normalized.length <= QUERY_SUBJECT_LIMIT)
        return normalized;
    return `${normalized.slice(0, QUERY_SUBJECT_LIMIT)}...`;
}
function buildStep(turn) {
    const subject = normalizeSubject(turn.userText);
    if (!subject)
        return undefined;
    return {
        id: `query-${stableHash(turn.promptId)}`,
        subject,
        status: turn.assistantText ? 'completed' : 'pending',
        promptId: turn.promptId,
        lineStart: turn.lineStart,
        lineEnd: turn.lineEnd,
    };
}
function mergeSteps(existing, turns) {
    const byPromptId = new Map((existing ?? []).map((step) => [step.promptId, step]));
    for (const turn of turns) {
        const step = buildStep(turn);
        if (step)
            byPromptId.set(step.promptId, step);
    }
    return Array.from(byPromptId.values());
}
function buildQueryGoal(existing, steps) {
    const hasPending = steps.some((step) => step.status !== 'completed');
    return {
        id: QUERY_GOAL_ID,
        subject: QUERY_GOAL_SUBJECT,
        status: hasPending ? 'in_progress' : 'completed',
        steps,
        ...(existing?.description ? { description: existing.description } : {}),
    };
}
export class RuleBasedExtractionEngine {
    constructor() {
        this.mode = 'default';
    }
    async extract(tree, turns, onProgress, traceContext) {
        if (traceContext?.mode === 'full') {
            const steps = mergeSteps([], turns);
            const updated = {
                version: tree.version + 1,
                goals: steps.length > 0 ? [buildQueryGoal(undefined, steps)] : [],
            };
            onProgress?.(updated);
            return updated;
        }
        const queryGoal = tree.goals.find((goal) => goal.id === QUERY_GOAL_ID);
        const mergedSteps = mergeSteps(queryGoal?.steps, turns);
        const goals = tree.goals.filter((goal) => goal.id !== QUERY_GOAL_ID);
        if (mergedSteps.length > 0) {
            goals.push(buildQueryGoal(queryGoal, mergedSteps));
        }
        const updated = { version: tree.version + 1, goals };
        onProgress?.(updated);
        return updated;
    }
    onUsage(_callback) {
        return () => { };
    }
}
//# sourceMappingURL=rule-extractor.js.map