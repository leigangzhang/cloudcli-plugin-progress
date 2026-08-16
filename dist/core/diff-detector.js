import { isCodexProgressEntry } from './codex/parser.js';
export class DiffDetectorImpl {
    constructor(buffer, options = {}) {
        this.listeners = [];
        this.debounceTimer = null;
        this.lastTriggerTime = 0;
        this.buffer = buffer;
        this.provider = options.provider ?? 'claude';
        this.options = {
            debounceMs: options.debounceMs ?? 3000,
            minIntervalMs: options.minIntervalMs ?? 3000,
            segmentLimit: options.segmentLimit ?? 10,
            provider: this.provider,
        };
    }
    ingest(entry) {
        if (this.provider === 'claude') {
            this.buffer.push(entry);
        }
        if (this.isRelevant(entry)) {
            this.scheduleTrigger();
        }
    }
    onTrigger(callback) {
        this.listeners.push(callback);
        return () => {
            const idx = this.listeners.indexOf(callback);
            if (idx !== -1) {
                this.listeners.splice(idx, 1);
            }
        };
    }
    flush() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.fire();
    }
    isRelevant(entry) {
        if (this.provider === 'codex') {
            return isCodexProgressEntry(entry);
        }
        const claudeEntry = entry;
        if (claudeEntry.type === 'assistant') {
            if (claudeEntry.stopReason === 'end_turn') {
                return true;
            }
            const blocks = claudeEntry.content ?? [];
            return blocks.some((b) => b.type === 'thinking' || b.type === 'tool_use');
        }
        return claudeEntry.type === 'user';
    }
    scheduleTrigger() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.fire();
        }, this.options.debounceMs);
    }
    fire() {
        const now = Date.now();
        const elapsed = now - this.lastTriggerTime;
        if (elapsed < this.options.minIntervalMs) {
            const delay = this.options.minIntervalMs - elapsed;
            this.debounceTimer = setTimeout(() => {
                this.debounceTimer = null;
                this.fire();
            }, delay);
            return;
        }
        this.lastTriggerTime = now;
        const segments = this.provider === 'claude'
            ? this.buffer.getSegments(this.options.segmentLimit)
            : [];
        if (this.provider === 'codex' || segments.length > 0) {
            this.listeners.forEach((cb) => cb(segments));
        }
    }
}
//# sourceMappingURL=diff-detector.js.map