import { describe, expect, it } from 'vitest';
import type { ProgressTree, TurnResponse } from '../../src/core/types.js';
import { themeColors } from '../../src/ui/theme.js';
import { renderProgressTree } from '../../src/ui/tree.js';

function baseOptions() {
  return {
    theme: 'dark' as const,
    expanded: new Set<string>(),
    turnExpanded: new Set<string>(),
    turnRecords: new Map<string, TurnResponse>(),
  };
}

describe('renderProgressTree', () => {
  const tree: ProgressTree = {
    version: 1,
    goals: [
      {
        id: 'g1',
        subject: 'Implement auth',
        description: 'Add auth middleware',
        status: 'in_progress',
        steps: [
          { id: 's1', subject: 'Setup bcrypt', status: 'completed', promptId: 'p1' },
          { id: 's2', subject: 'Add login route', status: 'pending', promptId: 'p2' },
        ],
      },
    ],
  };

  it('renders goal subject and status', () => {
    const html = renderProgressTree(tree, baseOptions(), themeColors(true));
    expect(html).toContain('Implement auth');
    expect(html).toContain('In Progress');
  });

  it('hides steps when goal is collapsed', () => {
    const html = renderProgressTree(tree, baseOptions(), themeColors(true));
    expect(html).not.toContain('Setup bcrypt');
    expect(html).not.toContain('Add login route');
  });

  it('shows steps when goal is expanded', () => {
    const options = baseOptions();
    options.expanded.add('g1');
    const html = renderProgressTree(tree, options, themeColors(true));
    expect(html).toContain('Setup bcrypt');
    expect(html).toContain('Add login route');
  });

  it('renders empty message when no goals', () => {
    const html = renderProgressTree(
      { version: 1, goals: [] },
      baseOptions(),
      themeColors(true),
    );
    expect(html).toContain('No goals tracked');
  });

  it('shows turn panel when step is expanded', () => {
    const options = baseOptions();
    options.expanded.add('g1');
    options.turnExpanded.add('s1');
    options.turnRecords.set('p1', {
      promptId: 'p1',
      lineStart: 1,
      lineEnd: 3,
      userText: 'Set up bcrypt',
      assistantText: 'Done',
      timestamp: '2026-01-01T00:00:00Z',
    });
    const html = renderProgressTree(tree, options, themeColors(true));
    expect(html).toContain('User question');
    expect(html).toContain('Set up bcrypt');
    expect(html).toContain('Assistant reply');
    expect(html).toContain('Done');
  });
});
