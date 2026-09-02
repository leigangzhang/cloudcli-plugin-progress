 import { describe, expect, it } from 'vitest';
 import { themeColors } from '../../src/ui/theme.js';

 describe('themeColors', () => {
  it('returns dark palette', () => {
    const colors = themeColors(true);
    expect(colors.bg).toBe('#17171a');
    expect(colors.text).toBe('#e5e6eb');
    expect(colors.accent).toBe('#4c88ff');
  });

  it('returns light palette', () => {
    const colors = themeColors(false);
    expect(colors.bg).toBe('#f5f6f7');
    expect(colors.text).toBe('#1f2329');
    expect(colors.accent).toBe('#3370ff');
  });
});
