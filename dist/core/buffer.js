const DEFAULT_MAX_ENTRIES = 200;
const EXCERPT_LIMIT = 2000;
function summarize(value) {
    try {
        return JSON.stringify(value).slice(0, EXCERPT_LIMIT);
    }
    catch {
        return '';
    }
}
function latestTimestamp(entries) {
    return entries.reduce((max, e) => {
        if (!e.timestamp)
            return max;
        return e.timestamp > max ? e.timestamp : max;
    }, '');
}
export class ConversationBuffer {
    constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
        this.entries = [];
        this.maxEntries = maxEntries;
    }
    push(entry) {
        this.entries.push(entry);
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }
    }
    getSegments(limit = 10) {
        const groups = new Map();
        for (const entry of this.entries) {
            const key = entry.promptId ?? entry.uuid ?? 'unknown';
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(entry);
        }
        const sorted = Array.from(groups.values()).sort((a, b) => latestTimestamp(a).localeCompare(latestTimestamp(b)));
        return sorted.slice(-limit).map((entries) => this.buildSegment(entries));
    }
    buildSegment(entries) {
        const thinkingParts = [];
        const textParts = [];
        const toolUses = [];
        const toolResults = [];
        let role = 'system';
        let stopReason;
        for (const entry of entries) {
            if (entry.type === 'assistant') {
                role = 'assistant';
                stopReason = entry.stopReason ?? stopReason;
                for (const block of entry.content ?? []) {
                    this.processAssistantBlock(block, thinkingParts, textParts, toolUses);
                }
            }
            else if (entry.type === 'user') {
                if (role !== 'assistant') {
                    role = 'user';
                }
                for (const block of entry.content ?? []) {
                    this.processUserBlock(block, textParts, toolResults);
                }
            }
        }
        return {
            promptId: entries[0]?.promptId,
            role,
            thinkingExcerpt: thinkingParts.join('\n').slice(0, EXCERPT_LIMIT) || undefined,
            textExcerpt: textParts.join('\n').slice(0, EXCERPT_LIMIT) || undefined,
            toolUses,
            toolResults,
            stopReason,
            timestamp: latestTimestamp(entries),
        };
    }
    processAssistantBlock(block, thinkingParts, textParts, toolUses) {
        if (block.type === 'thinking') {
            thinkingParts.push(block.thinking);
        }
        else if (block.type === 'text') {
            textParts.push(block.text);
        }
        else if (block.type === 'tool_use') {
            toolUses.push({
                id: block.id,
                name: block.name,
                inputSummary: summarize(block.input),
            });
        }
    }
    processUserBlock(block, textParts, toolResults) {
        if (block.type === 'text') {
            textParts.push(block.text);
        }
        else if (block.type === 'tool_result') {
            toolResults.push({
                toolUseId: block.tool_use_id,
                isError: block.is_error,
                summary: summarize(block.content),
            });
        }
    }
}
//# sourceMappingURL=buffer.js.map