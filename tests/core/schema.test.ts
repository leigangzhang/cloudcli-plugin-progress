import { describe, expect, it } from 'vitest';
import { validateProgressTree } from '../../src/core/schema.js';
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
            { id: 's1', subject: 'Setup bcrypt', status: 'completed', promptId: 'p1' },
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

  it('rejects a step without promptId', () => {
    const tree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'x',
          status: 'pending',
          steps: [{ id: 's1', subject: 'y', status: 'pending' }],
        },
      ],
    } as unknown as ProgressTree;
    const errors = validateProgressTree(tree);
    expect(errors.some((e) => e.includes('promptId'))).toBe(true);
  });

  it('accepts a long single-sentence subject', () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'a'.repeat(250),
          status: 'pending',
        },
      ],
    };
    expect(validateProgressTree(tree)).toEqual([]);
  });

  it('accepts a long single-sentence description', () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'x',
          description: 'b'.repeat(550),
          status: 'pending',
        },
      ],
    };
    expect(validateProgressTree(tree)).toEqual([]);
  });

  it('accepts a long single-sentence step subject', () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'x',
          status: 'pending',
          steps: [{ id: 's1', subject: 'c'.repeat(250), status: 'pending', promptId: 'p1' }],
        },
      ],
    };
    expect(validateProgressTree(tree)).toEqual([]);
  });
});
