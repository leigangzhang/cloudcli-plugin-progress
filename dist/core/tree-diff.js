const EVIDENCE_LIMIT = 1000;
function buildGoalMap(tree) {
    return new Map(tree.goals.map((g) => [g.id, g]));
}
function buildStepMap(goal) {
    return new Map((goal.steps ?? []).map((s) => [s.id, s]));
}
function normalize(value) {
    return value ?? '';
}
function isStepChanged(oldStep, newStep) {
    return (oldStep.subject !== newStep.subject ||
        oldStep.status !== newStep.status ||
        normalize(oldStep.toolUse) !== normalize(newStep.toolUse));
}
function isGoalChanged(oldGoal, newGoal) {
    if (oldGoal.subject !== newGoal.subject ||
        normalize(oldGoal.description) !== normalize(newGoal.description) ||
        oldGoal.status !== newGoal.status) {
        return true;
    }
    const oldSteps = buildStepMap(oldGoal);
    const newSteps = newGoal.steps ?? [];
    if (oldSteps.size !== newSteps.length)
        return true;
    for (const step of newSteps) {
        const oldStep = oldSteps.get(step.id);
        if (!oldStep || isStepChanged(oldStep, step))
            return true;
    }
    return false;
}
function extractKeywords(text) {
    const keywords = new Set();
    const normalized = text.toLowerCase();
    const english = normalized.match(/[a-z0-9]{3,}/g) ?? [];
    english.forEach((w) => keywords.add(w));
    const cjk = normalized.replace(/[^\u4e00-\u9fa5]/g, '');
    for (let i = 0; i < cjk.length - 1; i++) {
        keywords.add(cjk.slice(i, i + 2));
    }
    return Array.from(keywords);
}
function scoreSegment(segment, keywords) {
    const haystack = `${segment.textExcerpt ?? ''} ${segment.thinkingExcerpt ?? ''}`.toLowerCase();
    return keywords.reduce((score, kw) => score + (haystack.includes(kw) ? 1 : 0), 0);
}
function selectRelevantSegments(subject, description, segments, maxSegments = 3) {
    const keywords = extractKeywords(`${subject} ${description ?? ''}`);
    if (keywords.length === 0 || segments.length === 0) {
        return segments.slice(-maxSegments);
    }
    const scored = segments.map((segment) => ({ segment, score: scoreSegment(segment, keywords) }));
    scored.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        return (a.segment.lineNumber ?? 0) - (b.segment.lineNumber ?? 0);
    });
    const relevant = scored.filter((s) => s.score > 0).slice(0, maxSegments).map((s) => s.segment);
    if (relevant.length > 0)
        return relevant;
    return segments.slice(-maxSegments);
}
function extractSourceInfo(segments) {
    const promptIds = [];
    const lines = [];
    const excerpts = [];
    const seenPrompts = new Set();
    for (const segment of segments) {
        if (segment.promptId && !seenPrompts.has(segment.promptId)) {
            seenPrompts.add(segment.promptId);
            promptIds.push(segment.promptId);
        }
        if (segment.lineNumber !== undefined && !lines.includes(segment.lineNumber)) {
            lines.push(segment.lineNumber);
        }
        if (segment.textExcerpt) {
            excerpts.push(segment.textExcerpt);
        }
        else if (segment.thinkingExcerpt) {
            excerpts.push(segment.thinkingExcerpt);
        }
    }
    const evidence = excerpts.join('\n---\n').slice(0, EVIDENCE_LIMIT);
    return { sourcePromptIds: promptIds, sourceLines: lines.sort((a, b) => a - b), evidence };
}
function annotateStep(step, segments) {
    const relevant = selectRelevantSegments(step.subject, step.description, segments);
    const { sourcePromptIds, sourceLines, evidence } = extractSourceInfo(relevant);
    return {
        ...step,
        sourcePromptIds,
        sourceLines,
        evidence,
    };
}
function annotateGoal(goal, segments) {
    const relevant = selectRelevantSegments(goal.subject, goal.description, segments);
    const { sourcePromptIds, sourceLines, evidence } = extractSourceInfo(relevant);
    return {
        ...goal,
        sourcePromptIds,
        sourceLines,
        evidence,
    };
}
export function annotateTreeChanges(oldTree, newTree, segments, force = false) {
    const oldGoals = buildGoalMap(oldTree);
    const annotatedGoals = [];
    for (const goal of newTree.goals) {
        const oldGoal = oldGoals.get(goal.id);
        let annotatedGoal = goal;
        if (force || !oldGoal || isGoalChanged(oldGoal, goal)) {
            annotatedGoal = annotateGoal(goal, segments);
        }
        const oldSteps = oldGoal ? buildStepMap(oldGoal) : new Map();
        const annotatedSteps = [];
        for (const step of goal.steps ?? []) {
            const oldStep = oldSteps.get(step.id);
            if (force || !oldStep || isStepChanged(oldStep, step)) {
                annotatedSteps.push(annotateStep(step, segments));
            }
            else {
                annotatedSteps.push({
                    ...step,
                    sourcePromptIds: oldStep.sourcePromptIds,
                    sourceLines: oldStep.sourceLines,
                    evidence: oldStep.evidence,
                });
            }
        }
        annotatedGoal = { ...annotatedGoal, steps: annotatedSteps };
        if (!force && oldGoal && !isGoalChanged(oldGoal, goal)) {
            annotatedGoal = {
                ...annotatedGoal,
                sourcePromptIds: oldGoal.sourcePromptIds,
                sourceLines: oldGoal.sourceLines,
                evidence: oldGoal.evidence,
            };
        }
        annotatedGoals.push(annotatedGoal);
    }
    return { ...newTree, goals: annotatedGoals };
}
//# sourceMappingURL=tree-diff.js.map