const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'deleted'];
export function isProgressStatus(value) {
    return typeof value === 'string' && VALID_STATUSES.includes(value);
}
function validateStep(step, path) {
    const errors = [];
    if (!step || typeof step !== 'object') {
        return [`${path} is not a valid step object`];
    }
    if (typeof step.id !== 'string' || step.id === '') {
        errors.push(`${path}.id must be a non-empty string`);
    }
    if (typeof step.subject !== 'string' || step.subject === '') {
        errors.push(`${path}.subject must be a non-empty string`);
    }
    if (typeof step.promptId !== 'string' || step.promptId === '') {
        errors.push(`${path}.promptId must be a non-empty string`);
    }
    if (!isProgressStatus(step.status)) {
        errors.push(`${path}.status must be one of ${VALID_STATUSES.join(', ')}`);
    }
    return errors;
}
function validateGoal(goal, path) {
    const errors = [];
    if (!goal || typeof goal !== 'object') {
        return [`${path} is not a valid goal object`];
    }
    if (typeof goal.id !== 'string' || goal.id === '') {
        errors.push(`${path}.id must be a non-empty string`);
    }
    if (typeof goal.subject !== 'string' || goal.subject === '') {
        errors.push(`${path}.subject must be a non-empty string`);
    }
    if (!isProgressStatus(goal.status)) {
        errors.push(`${path}.status must be one of ${VALID_STATUSES.join(', ')}`);
    }
    if (goal.steps) {
        if (!Array.isArray(goal.steps)) {
            errors.push(`${path}.steps must be an array`);
        }
        else {
            for (let i = 0; i < goal.steps.length; i++) {
                errors.push(...validateStep(goal.steps[i], `${path}.steps[${i}]`));
            }
        }
    }
    return errors;
}
export function validateProgressTree(tree) {
    const errors = [];
    if (!tree || typeof tree !== 'object') {
        return ['ProgressTree must be an object'];
    }
    if (typeof tree.version !== 'number') {
        errors.push('ProgressTree.version must be a number');
    }
    if (!Array.isArray(tree.goals)) {
        errors.push('ProgressTree.goals must be an array');
    }
    else {
        for (let i = 0; i < tree.goals.length; i++) {
            errors.push(...validateGoal(tree.goals[i], `goals[${i}]`));
        }
    }
    return errors;
}
//# sourceMappingURL=schema.js.map