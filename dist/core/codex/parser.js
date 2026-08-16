import fs from 'node:fs';
import { parseJsonLine } from '../protocol.js';
function asRecord(value) {
    return typeof value === 'object' && value !== null
        ? value
        : undefined;
}
function entryType(entry) {
    return typeof entry.type === 'string' ? entry.type : undefined;
}
function payloadOf(entry) {
    return asRecord(entry.payload);
}
function stringValue(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function turnIdOf(entry) {
    const payload = payloadOf(entry);
    if (!payload)
        return undefined;
    const direct = stringValue(payload.turn_id);
    if (direct)
        return direct;
    const passthrough = asRecord(payload.internal_chat_message_metadata_passthrough);
    return passthrough ? stringValue(passthrough.turn_id) : undefined;
}
function contentText(content, allowedTypes = new Set(['text', 'input_text', 'output_text'])) {
    const parts = [];
    if (typeof content === 'string') {
        parts.push(content);
        return parts;
    }
    if (!Array.isArray(content))
        return parts;
    for (const item of content) {
        const record = asRecord(item);
        if (!record)
            continue;
        const type = stringValue(record.type);
        if (!type || !allowedTypes.has(type))
            continue;
        const text = stringValue(record.text ?? record.input_text ?? record.output_text);
        if (text)
            parts.push(text);
    }
    return parts;
}
function reasoningText(payload) {
    const summary = payload.summary;
    if (typeof summary === 'string')
        return summary;
    if (!Array.isArray(summary))
        return '';
    return summary
        .map((item) => {
        const record = asRecord(item);
        return record ? stringValue(record.text) ?? '' : '';
    })
        .filter(Boolean)
        .join('\n');
}
function summarizeFunctionArguments(value) {
    if (typeof value === 'string')
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return '';
    }
}
function latestTimestamp(values) {
    return values.reduce((latest, value) => (value > latest ? value : latest), '');
}
function groupEntries(entries) {
    const groups = new Map();
    let currentTurnId;
    for (const item of entries) {
        const type = entryType(item.entry);
        const payload = payloadOf(item.entry);
        if (type === 'turn_context' || payload?.type === 'task_started') {
            const declared = turnIdOf(item.entry);
            if (declared)
                currentTurnId = declared;
        }
        const turnId = turnIdOf(item.entry) ?? currentTurnId;
        if (!turnId)
            continue;
        let group = groups.get(turnId);
        if (!group) {
            group = { turnId, entries: [] };
            groups.set(turnId, group);
        }
        group.entries.push(item);
    }
    return Array.from(groups.values());
}
function buildTurn(group) {
    const userTexts = [];
    const eventAssistantTexts = [];
    const assistantTexts = [];
    const thinkingTexts = [];
    const toolTexts = [];
    const timestamps = [];
    for (const { entry } of group.entries) {
        const type = entryType(entry);
        const payload = payloadOf(entry);
        if (!type || !payload)
            continue;
        const timestamp = stringValue(entry.timestamp);
        if (timestamp)
            timestamps.push(timestamp);
        if (type === 'event_msg') {
            if (payload.type === 'user_message') {
                const message = stringValue(payload.message);
                if (message)
                    userTexts.push(message);
            }
            else if (payload.type === 'agent_message') {
                const message = stringValue(payload.message);
                if (message)
                    eventAssistantTexts.push(message);
            }
            continue;
        }
        if (type !== 'response_item')
            continue;
        if (payload.type === 'message') {
            if (payload.role === 'assistant') {
                assistantTexts.push(...contentText(payload.content));
            }
            else if (payload.role === 'user' &&
                userTexts.length === 0 &&
                payload.content) {
                const parts = contentText(payload.content);
                const userText = parts.find((part) => !part.startsWith('<environment_context>'));
                if (userText)
                    userTexts.push(userText);
            }
        }
        else if (payload.type === 'reasoning') {
            const summary = reasoningText(payload);
            if (summary)
                thinkingTexts.push(summary);
        }
        else if (payload.type === 'function_call') {
            const name = stringValue(payload.name) ?? 'unknown_tool';
            const args = summarizeFunctionArguments(payload.arguments);
            toolTexts.push(`[tool:${name}]\n${args}`.trim());
        }
        else if (payload.type === 'function_call_output') {
            const output = payload.output;
            const text = typeof output === 'string'
                ? output
                : summarizeFunctionArguments(output);
            toolTexts.push(`[tool_result]\n${text}`.trim());
        }
        else if (payload.type === 'custom_tool_call') {
            const name = stringValue(payload.name) ?? 'unknown_custom_tool';
            toolTexts.push(`[custom_tool:${name}]\n${summarizeFunctionArguments(payload.input)}`.trim());
        }
        else if (payload.type === 'custom_tool_call_output') {
            toolTexts.push(`[custom_tool_result]\n${summarizeFunctionArguments(payload.output)}`.trim());
        }
    }
    return {
        promptId: group.turnId,
        lineStart: group.entries[0].lineNumber,
        lineEnd: group.entries[group.entries.length - 1].lineNumber,
        userText: userTexts.join('\n').trim() || undefined,
        thinkingText: thinkingTexts.join('\n').trim() || undefined,
        assistantText: assistantTexts.join('\n').trim() ||
            eventAssistantTexts.join('\n').trim() ||
            undefined,
        toolText: toolTexts.join('\n').trim() || undefined,
        timestamp: latestTimestamp(timestamps),
        entryCount: group.entries.length,
    };
}
export function buildCodexTurns(entries) {
    return groupEntries(entries).map((group) => {
        const turn = buildTurn(group);
        return {
            promptId: turn.promptId,
            lineStart: turn.lineStart,
            lineEnd: turn.lineEnd,
            userText: turn.userText,
            thinkingText: turn.thinkingText,
            assistantText: turn.assistantText,
            toolText: turn.toolText,
            timestamp: turn.timestamp,
        };
    });
}
export function buildCodexTurnsFromLog(logPath) {
    if (!logPath || !fs.existsSync(logPath))
        return [];
    const entries = [];
    const raw = fs.readFileSync(logPath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim())
            continue;
        const parsed = parseJsonLine(line);
        const record = asRecord(parsed);
        if (!record || !stringValue(record.type))
            continue;
        entries.push({ entry: record, lineNumber: i + 1 });
    }
    return buildCodexTurns(entries);
}
export function isCodexProgressEntry(entry) {
    const type = entryType(entry);
    const payload = payloadOf(entry);
    if (!type || !payload)
        return false;
    if (type === 'event_msg') {
        return (payload.type === 'task_complete' ||
            payload.type === 'agent_message' ||
            payload.type === 'user_message');
    }
    return type === 'response_item' && payload.type === 'message' && payload.role === 'assistant';
}
//# sourceMappingURL=parser.js.map