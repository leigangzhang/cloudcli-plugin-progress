import fs from 'node:fs';
import { isLogEntry, parseJsonLine } from './protocol.js';
function extractText(value) {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value)) {
        return value
            .map((item) => {
            if (typeof item === 'string')
                return item;
            if (item && typeof item === 'object' && 'text' in item)
                return String(item.text ?? '');
            return '';
        })
            .filter(Boolean)
            .join('\n');
    }
    return '';
}
function toContentBlocks(value) {
    if (typeof value === 'string') {
        return value ? [{ type: 'text', text: value }] : [];
    }
    if (Array.isArray(value)) {
        return value.filter((item) => typeof item === 'object' && item !== null);
    }
    return [];
}
function findRootPromptId(entry, uuidMap) {
    const visited = new Set();
    let current = entry;
    while (current) {
        if (current.type === 'user' && current.promptId)
            return current.promptId;
        if (!current.parentUuid)
            return undefined;
        if (current.uuid && visited.has(current.uuid))
            return undefined;
        if (current.uuid)
            visited.add(current.uuid);
        current = uuidMap.get(current.parentUuid)?.entry;
    }
    return undefined;
}
function buildTurn(items) {
    const userTexts = [];
    const thinkingTexts = [];
    const assistantTexts = [];
    const toolTexts = [];
    let timestamp = '';
    let firstUserProcessed = false;
    for (const { entry } of items) {
        if (entry.timestamp && entry.timestamp > timestamp)
            timestamp = entry.timestamp;
        const blocks = toContentBlocks(entry.content ?? entry.message?.content);
        if (entry.type === 'user') {
            if (!firstUserProcessed) {
                for (const block of blocks) {
                    if (block.type === 'text' && typeof block.text === 'string') {
                        userTexts.push(block.text);
                    }
                }
                firstUserProcessed = true;
            }
            else {
                for (const block of blocks) {
                    if (block.type === 'tool_result') {
                        toolTexts.push(extractText(block.content));
                    }
                    else if (block.type === 'text' && typeof block.text === 'string') {
                        toolTexts.push(block.text);
                    }
                }
            }
        }
        else if (entry.type === 'assistant') {
            for (const block of blocks) {
                if (block.type === 'thinking' && typeof block.thinking === 'string') {
                    thinkingTexts.push(block.thinking);
                }
                else if (block.type === 'text' && typeof block.text === 'string') {
                    assistantTexts.push(block.text);
                }
            }
        }
    }
    return {
        promptId: items[0].entry.promptId ?? 'unknown',
        lineStart: items[0].lineNumber,
        lineEnd: items[items.length - 1].lineNumber,
        userText: userTexts.join('\n').trim() || undefined,
        thinkingText: thinkingTexts.join('\n').trim() || undefined,
        assistantText: assistantTexts.join('\n').trim() || undefined,
        toolText: toolTexts.join('\n').trim() || undefined,
        timestamp,
    };
}
export function buildTurns(entries) {
    const uuidMap = new Map();
    for (const item of entries) {
        if (item.entry.uuid)
            uuidMap.set(item.entry.uuid, item);
    }
    const rootMap = new Map();
    for (const item of entries) {
        const root = findRootPromptId(item.entry, uuidMap);
        if (root)
            rootMap.set(item.entry, root);
    }
    const turns = [];
    const seen = new Set();
    let current = null;
    let currentPromptId = null;
    for (const item of entries) {
        const entry = item.entry;
        const root = rootMap.get(entry);
        if (entry.type === 'user' && entry.promptId && !seen.has(entry.promptId)) {
            if (current)
                turns.push(buildTurn(current));
            current = [item];
            currentPromptId = entry.promptId;
            seen.add(entry.promptId);
        }
        else if (current && currentPromptId && root === currentPromptId) {
            current.push(item);
        }
    }
    if (current)
        turns.push(buildTurn(current));
    return turns;
}
export function buildTurnsFromLog(logPath) {
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
        if (isLogEntry(parsed)) {
            entries.push({ entry: parsed, lineNumber: i + 1 });
        }
    }
    return buildTurns(entries);
}
//# sourceMappingURL=turns.js.map