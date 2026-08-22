import { describe, expect, it } from 'vitest';
import {
  isExtractionMode,
  isModeRequest,
} from '../../src/core/protocol.js';

describe('extraction mode protocol', () => {
  it('recognizes supported extraction modes', () => {
    expect(isExtractionMode('default')).toBe(true);
    expect(isExtractionMode('progress-tree')).toBe(true);
    expect(isExtractionMode('llm')).toBe(false);
  });

  it('validates mode requests', () => {
    expect(
      isModeRequest({ sessionId: 's1', mode: 'progress-tree' }),
    ).toBe(true);
    expect(isModeRequest({ sessionId: 's1', mode: 'unknown' })).toBe(false);
    expect(isModeRequest({ mode: 'default' })).toBe(false);
  });
});
