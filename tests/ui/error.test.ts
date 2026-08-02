 import { describe, expect, it } from 'vitest';
 import { renderEmpty, renderError, renderLoading } from '../../src/ui/error.js';
 import { themeColors } from '../../src/ui/theme.js';

 describe('error components', () => {
   it('renderLoading contains loading text', () => {
     const html = renderLoading(themeColors(true));
     expect(html).toContain('Loading progress');
   });

   it('renderError contains message', () => {
     const html = renderError(themeColors(true), 'Something broke');
     expect(html).toContain('Something broke');
     expect(html).toContain('Sync error');
   });

   it('renderEmpty contains message', () => {
     const html = renderEmpty(themeColors(true), 'No session');
     expect(html).toContain('No session');
   });
 });
