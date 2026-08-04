import type { ProgressTree } from './types.js';
declare const VALID_STATUSES: readonly ["pending", "in_progress", "completed", "deleted"];
export declare function isProgressStatus(value: unknown): value is (typeof VALID_STATUSES)[number];
export declare function validateProgressTree(tree: ProgressTree): string[];
export {};
//# sourceMappingURL=schema.d.ts.map