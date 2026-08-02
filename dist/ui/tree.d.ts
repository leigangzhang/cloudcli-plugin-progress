import type { ProgressTree } from '../core/types.js';
import type { ThemeColors } from './theme.js';
export interface TreeRenderOptions {
    theme: 'dark' | 'light';
    expanded: Set<string>;
    onToggle: (id: string) => void;
}
export declare function renderProgressTree(tree: ProgressTree, _options: TreeRenderOptions, colors: ThemeColors): string;
//# sourceMappingURL=tree.d.ts.map