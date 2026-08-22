import { describe, expect, it, vi } from 'vitest';
import { RuleBasedExtractionEngine } from '../../src/core/rule-extractor.js';
import type { ConversationTurn, ProgressTree } from '../../src/core/types.js';

function turn(overrides: Partial<ConversationTurn>): ConversationTurn {
  return {
    promptId: 'p1',
    lineStart: 1,
    lineEnd: 2,
    userText: 'hello',
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('RuleBasedExtractionEngine', () => {
  it('appends user queries without calling an LLM', async () => {
    const engine = new RuleBasedExtractionEngine();
    const result = await engine.extract(
      { version: 0, goals: [] },
      [turn({ promptId: 'p1', userText: 'first' }), turn({ promptId: 'p2', userText: 'second' })],
    );

    expect(result.version).toBe(1);
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0].id).toBe('user-queries');
    expect(result.goals[0].steps?.map((step) => step.promptId)).toEqual(['p1', 'p2']);
  });

  it('uses assistant presence as the completion signal', async () => {
    const engine = new RuleBasedExtractionEngine();
    const result = await engine.extract(
      { version: 0, goals: [] },
      [
        turn({ promptId: 'done', assistantText: 'reply' }),
        turn({ promptId: 'pending', assistantText: undefined }),
      ],
    );
    expect(result.goals[0].steps?.[0].status).toBe('completed');
    expect(result.goals[0].steps?.[1].status).toBe('pending');
  });

  it('preserves other goals in incremental mode', async () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        { id: 'legacy', subject: 'Legacy progress', status: 'completed' },
      ],
    };
    const engine = new RuleBasedExtractionEngine();
    const result = await engine.extract(tree, [turn({ promptId: 'p1' })]);
    expect(result.goals.map((goal) => goal.id)).toEqual(['legacy', 'user-queries']);
  });

  it('rebuilds only the query goal on full refresh', async () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        { id: 'legacy', subject: 'Legacy progress', status: 'completed' },
      ],
    };
    const engine = new RuleBasedExtractionEngine();
    const result = await engine.extract(
      tree,
      [turn({ promptId: 'p1', userText: 'current' })],
      undefined,
      {
        requestId: 'req-1',
        sessionId: 'sess-1',
        provider: 'codex',
        mode: 'full',
      },
    );
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0].id).toBe('user-queries');
  });

  it('never invokes an API client', async () => {
    const engine = new RuleBasedExtractionEngine();
    const usage = vi.fn();
    engine.onUsage(usage);
    await engine.extract({ version: 0, goals: [] }, [turn()]);
    expect(usage).not.toHaveBeenCalled();
  });
});
