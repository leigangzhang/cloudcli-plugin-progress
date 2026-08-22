import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateProgressTree } from './schema.js';
export function defaultSnapshotDir(home = os.homedir()) {
    return path.join(home, '.claude-code-ui', 'plugins', 'cloudcli-plugin-progress', '.snapshots');
}
const DEFAULT_SNAPSHOT_DIR = defaultSnapshotDir();
const SNAPSHOT_SCHEMA_VERSION = 2;
function snapshotPath(snapshotDir, sessionId) {
    return path.join(snapshotDir, `${sessionId}.json`);
}
export class ProgressStoreImpl {
    constructor(options) {
        this.state = { version: 0, goals: [] };
        this.listeners = [];
        this.snapshotDir = options?.snapshotDir ?? DEFAULT_SNAPSHOT_DIR;
        this.extractionMode = options?.extractionMode ?? 'default';
    }
    getState() {
        return this.state;
    }
    getExtractionMode() {
        return this.extractionMode;
    }
    setState(tree) {
        this.state = tree;
        this.listeners.forEach((cb) => cb(tree));
    }
    setExtractionMode(mode) {
        this.extractionMode = mode;
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
            if (typeof parsed === 'object' &&
                parsed !== null &&
                parsed.schemaVersion === SNAPSHOT_SCHEMA_VERSION) {
                const snapshot = parsed;
                if (validateProgressTree(snapshot.tree).length > 0) {
                    return false;
                }
                this.state = snapshot.tree;
                this.extractionMode =
                    snapshot.extractionMode === 'progress-tree' ? 'progress-tree' : 'default';
                return true;
            }
            const legacyTree = parsed;
            if (validateProgressTree(legacyTree).length > 0) {
                return false;
            }
            this.state = legacyTree;
            this.extractionMode = 'progress-tree';
            return true;
        }
        catch {
            return false;
        }
    }
    saveSnapshot(sessionId) {
        const file = snapshotPath(this.snapshotDir, sessionId);
        fs.mkdirSync(this.snapshotDir, { recursive: true });
        const snapshot = {
            sessionId,
            tree: this.state,
            extractionMode: this.extractionMode,
            cursor: { bytesRead: 0, lastLine: 0 },
            updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(file, JSON.stringify({
            schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            ...snapshot,
        }, null, 2), 'utf-8');
    }
}
//# sourceMappingURL=store.js.map