import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateProgressTree } from './schema.js';
const DEFAULT_SNAPSHOT_DIR = path.join(os.homedir(), '.claude-code-ui', 'plugins', 'progress-plugin', '.snapshots');
function snapshotPath(snapshotDir, sessionId) {
    return path.join(snapshotDir, `${sessionId}.json`);
}
export class ProgressStoreImpl {
    constructor(options) {
        this.state = { version: 0, goals: [] };
        this.listeners = [];
        this.snapshotDir = options?.snapshotDir ?? DEFAULT_SNAPSHOT_DIR;
    }
    getState() {
        return this.state;
    }
    setState(tree) {
        this.state = tree;
        this.listeners.forEach((cb) => cb(tree));
    }
    subscribe(callback) {
        this.listeners.push(callback);
        return () => {
            const idx = this.listeners.indexOf(callback);
            if (idx !== -1) {
                this.listeners.splice(idx, 1);
            }
        };
    }
    loadSnapshot(sessionId) {
        const file = snapshotPath(this.snapshotDir, sessionId);
        try {
            const raw = fs.readFileSync(file, 'utf-8');
            const parsed = JSON.parse(raw);
            if (validateProgressTree(parsed).length > 0) {
                return false;
            }
            this.state = parsed;
            return true;
        }
        catch {
            return false;
        }
    }
    saveSnapshot(sessionId) {
        const file = snapshotPath(this.snapshotDir, sessionId);
        fs.mkdirSync(this.snapshotDir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(this.state, null, 2), 'utf-8');
    }
}
//# sourceMappingURL=store.js.map