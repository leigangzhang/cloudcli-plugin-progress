 import { describe, expect, it } from 'vitest';
 import { themeColors } from '../../src/ui/theme.js';

 describe('themeColors', () => {
   it('returns dark palette', () => {
     const colors = themeColors(true);
     expect(colors.bg).toBe('#08080f');
     expect(colors.text).toBe('#e2e0f0');
     expect(colors.accent).toBe('#fbbf24');
   });

   it('returns light palette', () => {
     const colors = themeColors(false);
     expect(colors.bg).toBe('#fafaf9');
     expect(colors.text).toBe('#0f0e1a');
     expect(colors.accent).toBe('#d97706');
   });
 });
