 import { describe, expect, it } from 'vitest';
 import { themeColors } from '../../src/ui/theme.js';

 describe('themeColors', () => {
  it('returns dark palette', () => {
    const colors = themeColors(true);
    expect(colors.bg).toBe('#17171a');
    expect(colors.text).toBe('#f5f6f7');
    expect(colors.accent).toBe('#4c88ff');
    expect(colors.accentHover).toBe('#6ba1ff');
    expect(colors.deepBlue).toBe('#8ab4f8');
    expect(colors.turnPanel).toBe('#2a2826');
  });

  it('returns light palette', () => {
    const colors = themeColors(false);
    expect(colors.bg).toBe('#f5f6f7');
    expect(colors.text).toBe('#1f2329');
    expect(colors.accent).toBe('#3370ff');
    expect(colors.accentHover).toBe('#2e5bd7');
    expect(colors.deepBlue).toBe('#1f4e79');
    expect(colors.turnPanel).toBe('#f6f4f1');
  });
});
