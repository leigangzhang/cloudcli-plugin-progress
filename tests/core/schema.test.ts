 import { describe, expect, it } from 'vitest';
 import {
   truncateSubject,
   truncateDescription,
   validateProgressTree,
 } from '../../src/core/schema.js';
 import type { ProgressTree } from '../../src/core/types.js';

 describe('validateProgressTree', () => {
   it('accepts a valid tree', () => {
     const tree: ProgressTree = {
       version: 1,
       goals: [
         {
           id: 'g1',
           subject: 'Implement auth',
           description: 'Add middleware for authentication',
           status: 'in_progress',
           steps: [
             { id: 's1', subject: 'Setup bcrypt', status: 'completed' },
           ],
         },
       ],
     };
     expect(validateProgressTree(tree)).toEqual([]);
   });

   it('rejects an invalid status', () => {
     const tree = {
       version: 1,
       goals: [{ id: 'g1', subject: 'x', status: 'unknown' }],
     } as unknown as ProgressTree;
     const errors = validateProgressTree(tree);
     expect(errors.length).toBeGreaterThan(0);
     expect(errors.some((e) => e.includes('status'))).toBe(true);
   });

   it('rejects a subject longer than 100 chars', () => {
     const tree: ProgressTree = {
       version: 1,
       goals: [
         {
           id: 'g1',
           subject: 'a'.repeat(101),
           status: 'pending',
         },
       ],
     };
     const errors = validateProgressTree(tree);
     expect(errors.some((e) => e.includes('subject') && e.includes('100'))).toBe(true);
   });

   it('rejects a description longer than 200 chars', () => {
     const tree: ProgressTree = {
       version: 1,
       goals: [
         {
           id: 'g1',
           subject: 'x',
           description: 'b'.repeat(201),
           status: 'pending',
         },
       ],
     };
     const errors = validateProgressTree(tree);
     expect(errors.some((e) => e.includes('description') && e.includes('200'))).toBe(true);
   });

   it('rejects a step subject longer than 100 chars', () => {
     const tree: ProgressTree = {
       version: 1,
       goals: [
         {
           id: 'g1',
           subject: 'x',
           status: 'pending',
           steps: [{ id: 's1', subject: 'c'.repeat(101), status: 'pending' }],
         },
       ],
     };
     const errors = validateProgressTree(tree);
     expect(errors.some((e) => e.includes('step') && e.includes('100'))).toBe(true);
   });
 });

 describe('truncate helpers', () => {
   it('truncates subject to 100 chars', () => {
     expect(truncateSubject('a'.repeat(150))).toBe('a'.repeat(100));
   });

   it('truncates description to 200 chars', () => {
     expect(truncateDescription('b'.repeat(300))).toBe('b'.repeat(200));
   });

   it('keeps short strings unchanged', () => {
     expect(truncateSubject('short')).toBe('short');
     expect(truncateDescription('short')).toBe('short');
   });
 });
