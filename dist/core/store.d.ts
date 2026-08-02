import type { ProgressStore, ProgressTree } from './types.js';
export interface ProgressStoreOptions {
    snapshotDir?: string;
}
export declare class ProgressStoreImpl implements ProgressStore {
    private state;
    private listeners;
    private snapshotDir;
    constructor(options?: ProgressStoreOptions);
    getState(): ProgressTree;
    setState(tree: ProgressTree): void;
    subscribe(callback: (tree: ProgressTree) => void): () => void;
    loadSnapshot(sessionId: string): boolean;
    saveSnapshot(sessionId: string): void;
}
//# sourceMappingURL=store.d.ts.map