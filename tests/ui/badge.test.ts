 import { describe, expect, it } from 'vitest';
 import { statusBadge } from '../../src/ui/badge.js';
 import { themeColors } from '../../src/ui/theme.js';

 describe('statusBadge', () => {
  it('renders completed badge', () => {
    const html = statusBadge('completed', themeColors(true));
    expect(html).toContain('Done');
    expect(html).toContain('#34c724');
  });

  it('renders in_progress badge with accent color', () => {
    const html = statusBadge('in_progress', themeColors(true));
    expect(html).toContain('In Progress');
    expect(html).toContain('#4c88ff');
  });
});
