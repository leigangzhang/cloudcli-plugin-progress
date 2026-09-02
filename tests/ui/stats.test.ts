import { describe, expect, it } from 'vitest';
import type { ProgressTree } from '../../src/core/types.js';
import { themeColors } from '../../src/ui/theme.js';
import { renderStatsPanel } from '../../src/ui/stats.js';

describe('renderStatsPanel', () => {
  it('summarizes goals, steps, and progress', () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'Goal 1',
          status: 'completed',
          steps: [
            { id: 's1', subject: 'Step 1', status: 'completed', promptId: 'p1' },
            { id: 's2', subject: 'Step 2', status: 'in_progress', promptId: 'p2' },
          ],
        },
        {
          id: 'g2',
          subject: 'Goal 2',
          status: 'pending',
          steps: [{ id: 's3', subject: 'Step 3', status: 'pending', promptId: 'p3' }],
        },
      ],
    };

    const html = renderStatsPanel(tree, themeColors(true));

    expect(html).toContain('Goals');
    expect(html).toContain('Steps');
    expect(html).toContain('In Progress');
    expect(html).toContain('Progress');
    expect(html).toContain('33%');
    expect(html).toContain('1/3 steps');
  });
});
