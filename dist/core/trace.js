import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function estimateTokens(text) {
    return Math.ceil((text?.length ?? 0) / 4);
}
export function measureConversationTurns(turns) {
    let userCharacters = 0;
    let assistantCharacters = 0;
    let thinkingCharacters = 0;
    let toolCharacters = 0;
    for (const turn of turns) {
        userCharacters += turn.userText?.length ?? 0;
        assistantCharacters += turn.assistantText?.length ?? 0;
        thinkingCharacters += turn.thinkingText?.length ?? 0;
        toolCharacters += turn.toolText?.length ?? 0;
    }
    const characters = userCharacters + assistantCharacters + thinkingCharacters + toolCharacters;
    return {
        characters,
        userCharacters,
        assistantCharacters,
        thinkingCharacters,
        toolCharacters,
        estimatedTokens: estimateTokens(JSON.stringify(turns)),
    };
}
export function createTraceRequestId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
export function extractionTraceEnabled(env = process.env) {
    const value = env.PROGRESS_TRACE_EXTRACTIONS;
    if (!value)
        return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
export function resolveExtractionTraceEnabled(configuredTrace, env = process.env) {
    if (configuredTrace !== undefined)
        return configuredTrace;
    return extractionTraceEnabled(env);
}
export function getExtractionTraceLogPath(env = process.env, home = os.homedir()) {
    const dir = env.PROGRESS_TRACE_LOG_DIR ??
        path.join(home, '.claude-code-ui', 'plugins', 'cloudcli-plugin-progress');
    const filename = env.PROGRESS_TRACE_LOG_FILE ?? 'progress-plugin.log';
    return path.join(dir, filename);
}
export function writeExtractionTrace(value, env = process.env, home = os.homedir()) {
    const filePath = getExtractionTraceLogPath(env, home);
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf-8');
    }
    catch (err) {
        console.error('Failed to write extraction trace log:', err.message);
    }
}
//# sourceMappingURL=trace.js.map