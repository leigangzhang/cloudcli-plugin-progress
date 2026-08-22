import type { ExtractionMode, ProgressStore, ProgressTree } from './types.js';
export interface ProgressStoreOptions {
    snapshotDir?: string;
    extractionMode?: ExtractionMode;
}
export declare function defaultSnapshotDir(home?: string): string;
export declare class ProgressStoreImpl implements ProgressStore {
    private state;
    private extractionMode;
    private listeners;
    private snapshotDir;
    constructor(options?: ProgressStoreOptions);
    getState(): ProgressTree;
    getExtractionMode(): ExtractionMode;
    setState(tree: ProgressTree): void;
    setExtractionMode(mode: ExtractionMode): void;
    subscribe(callback: (tree: ProgressTree) => void): () => void;
    loadSnapshot(sessionId: string): boolean;
    saveSnapshot(sessionId: string): void;
}
//# sourceMappingURL=store.d.ts.map