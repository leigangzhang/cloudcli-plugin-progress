 import { describe, expect, it } from 'vitest';
 import type { ProgressTree } from '../../src/core/types.js';
 import { themeColors } from '../../src/ui/theme.js';
 import { renderProgressTree } from '../../src/ui/tree.js';

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
           { id: 's1', subject: 'Setup bcrypt', status: 'completed' },
           { id: 's2', subject: 'Add login route', status: 'pending' },
         ],
       },
     ],
   };

   it('renders goal subject and status', () => {
     const html = renderProgressTree(tree, { theme: 'dark', expanded: new Set(), onToggle: () => {} }, themeColors(true));
     expect(html).toContain('Implement auth');
     expect(html).toContain('In Progress');
   });

   it('hides steps when goal is collapsed', () => {
     const html = renderProgressTree(tree, { theme: 'dark', expanded: new Set(), onToggle: () => {} }, themeColors(true));
     expect(html).not.toContain('Setup bcrypt');
     expect(html).not.toContain('Add login route');
   });

   it('shows steps when goal is expanded', () => {
     const html = renderProgressTree(tree, { theme: 'dark', expanded: new Set(['g1']), onToggle: () => {} }, themeColors(true));
     expect(html).toContain('Setup bcrypt');
     expect(html).toContain('Add login route');
   });

   it('renders empty message when no goals', () => {
     const html = renderProgressTree({ version: 1, goals: [] }, { theme: 'dark', expanded: new Set(), onToggle: () => {} }, themeColors(true));
     expect(html).toContain('No goals tracked');
   });
 });
