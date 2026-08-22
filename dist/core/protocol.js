// Type guards and safe parsing for frontend/backend messages.
export function isExtractionMode(value) {
    return value === 'default' || value === 'progress-tree';
}
export function isLogEntry(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.type === 'string');
}
export function isWatchRequest(value) {
    const v = value;
    return (typeof v === 'object' &&
        v !== null &&
        typeof v.projectPath === 'string' &&
        typeof v.sessionId === 'string');
}
export function isRefreshRequest(value) {
    const v = value;
    return typeof v === 'object' && v !== null && typeof v.sessionId === 'string';
}
export function isModeRequest(value) {
    const v = value;
    return (typeof v === 'object' &&
        v !== null &&
        typeof v.sessionId === 'string' &&
        isExtractionMode(v.mode));
}
export function isProgressResponse(value) {
    const v = value;
    return (typeof v === 'object' &&
        v !== null &&
        typeof v.tree === 'object' &&
        typeof v.status === 'string' &&
        ['idle', 'syncing', 'error', 'paused'].includes(v.status));
}
export function isServerMessage(value) {
    const v = value;
    if (typeof v !== 'object' || v === null || typeof v.type !== 'string') {
        return false;
    }
    if (v.type === 'progress') {
        return typeof v.tree === 'object' && v.tree !== null;
    }
    if (v.type === 'status') {
        return (typeof v.status === 'string' &&
            ['idle', 'syncing', 'error', 'paused'].includes(v.status));
    }
    return false;
}
export function isClientMessage(value) {
    const v = value;
    if (typeof v !== 'object' || v === null || typeof v.type !== 'string') {
        return false;
    }
    if (v.type === 'subscribe') {
        return typeof v.projectPath === 'string' && typeof v.sessionId === 'string';
    }
    if (v.type === 'refresh') {
        return true;
    }
    return false;
}
export function parseJsonLine(line) {
    try {
        return JSON.parse(line);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=protocol.js.map