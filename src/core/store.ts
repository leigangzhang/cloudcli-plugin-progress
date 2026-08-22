import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateProgressTree } from './schema.js';
import type {
  ExtractionMode,
  ProgressStore,
  ProgressSnapshot,
  ProgressTree,
} from './types.js';

export interface ProgressStoreOptions {
  snapshotDir?: string;
  extractionMode?: ExtractionMode;
}

export function defaultSnapshotDir(home = os.homedir()): string {
  return path.join(
    home,
    '.claude-code-ui',
    'plugins',
    'cloudcli-plugin-progress',
    '.snapshots',
  );
}

const DEFAULT_SNAPSHOT_DIR = defaultSnapshotDir();
const SNAPSHOT_SCHEMA_VERSION = 2;

function snapshotPath(snapshotDir: string, sessionId: string): string {
  return path.join(snapshotDir, `${sessionId}.json`);
}

export class ProgressStoreImpl implements ProgressStore {
  private state: ProgressTree = { version: 0, goals: [] };
  private extractionMode: ExtractionMode;
  private listeners: ((tree: ProgressTree) => void)[] = [];
  private snapshotDir: string;

  constructor(options?: ProgressStoreOptions) {
    this.snapshotDir = options?.snapshotDir ?? DEFAULT_SNAPSHOT_DIR;
    this.extractionMode = options?.extractionMode ?? 'default';
  }

  getState(): ProgressTree {
    return this.state;
  }

  getExtractionMode(): ExtractionMode {
    return this.extractionMode;
  }

  setState(tree: ProgressTree): void {
    this.state = tree;
    this.listeners.forEach((cb) => cb(tree));
  }

  setExtractionMode(mode: ExtractionMode): void {
    this.extractionMode = mode;
  }

  subscribe(callback: (tree: ProgressTree) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx !== -1) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  loadSnapshot(sessionId: string): boolean {
    const file = snapshotPath(this.snapshotDir, sessionId);
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as { schemaVersion?: unknown }).schemaVersion === SNAPSHOT_SCHEMA_VERSION
      ) {
        const snapshot = parsed as ProgressSnapshot;
        if (validateProgressTree(snapshot.tree).length > 0) {
          return false;
        }
        this.state = snapshot.tree;
        this.extractionMode =
          snapshot.extractionMode === 'progress-tree' ? 'progress-tree' : 'default';
        return true;
      }

      const legacyTree = parsed as ProgressTree;
      if (validateProgressTree(legacyTree).length > 0) {
        return false;
      }
      this.state = legacyTree;
      this.extractionMode = 'progress-tree';
      return true;
    } catch {
      return false;
    }
  }

  saveSnapshot(sessionId: string): void {
    const file = snapshotPath(this.snapshotDir, sessionId);
    fs.mkdirSync(this.snapshotDir, { recursive: true });
    const snapshot: ProgressSnapshot = {
      sessionId,
      tree: this.state,
      extractionMode: this.extractionMode,
      cursor: { bytesRead: 0, lastLine: 0 },
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          ...snapshot,
        },
        null,
        2,
      ),
      'utf-8',
    );
  }
}
