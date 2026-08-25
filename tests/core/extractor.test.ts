import { describe, expect, it, vi } from 'vitest';
import { LLMExtractionEngineImpl } from '../../src/core/extractor.js';
import type { Anthropic } from '../../src/core/extractor.js';
import type { ExtractionTraceContext, ExtractionTraceEvent } from '../../src/core/trace.js';
import type {
  ConversationTurn,
  LLMConfig,
  ProgressGoal,
  ProgressTree,
  ProgressTreePatch,
} from '../../src/core/types.js';

function mockConfig(): LLMConfig {
  return {
    apiKey: 'test-key',
    baseUrl: 'https://test.example',
    model: 'test-model',
    extractionMode: 'progress-tree',
  };
}

function mockClient(response: { text: string; inputTokens?: number; outputTokens?: number }) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: response.text }],
        usage: {
          input_tokens: response.inputTokens ?? 10,
          output_tokens: response.outputTokens ?? 5,
        },
      }),
    },
  } as unknown as Anthropic;
}

function patchResponse(
  version: number,
  goals: ProgressGoal[],
  extras: Partial<ProgressTreePatch> = {},
): string {
  return JSON.stringify({
    version,
    upsertGoals: goals,
    deleteGoalIds: [],
    deleteStepIds: [],
    ...extras,
  } satisfies ProgressTreePatch);
}

function turn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    promptId: 'p1',
    lineStart: 1,
    lineEnd: 2,
    userText: 'question',
    assistantText: 'reply',
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('LLMExtractionEngineImpl patch extraction', () => {
  it('merges affected goals and preserves omitted nodes', async () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'Topic',
          status: 'in_progress',
          steps: [
            { id: 's1', subject: 'Old step', status: 'pending', promptId: 'p1' },
          ],
        },
        {
          id: 'g2',
          subject: 'Keep me',
          status: 'pending',
        },
      ],
    };
    const client = mockClient({
      text: patchResponse(2, [
        {
          id: 'g1',
          subject: 'Topic',
          status: 'completed',
          steps: [
            { id: 's2', subject: 'New step', status: 'completed', promptId: 'p2' },
          ],
        },
      ]),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, [turn({ promptId: 'p2' })]);

    expect(result.version).toBe(2);
    expect(result.goals.map((goal) => goal.id)).toEqual(['g1', 'g2']);
    expect(result.goals[0].status).toBe('completed');
    expect(result.goals[0].steps?.map((step) => step.id)).toEqual(['s1', 's2']);
    expect(result.goals[1].subject).toBe('Keep me');
  });

  it('replaces existing steps by id and deletes nodes', async () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'Topic',
          status: 'in_progress',
          steps: [
            { id: 's1', subject: 'Old step', status: 'pending', promptId: 'p1' },
            { id: 's2', subject: 'Remove', status: 'pending', promptId: 'p2' },
          ],
        },
        {
          id: 'g2',
          subject: 'Remove goal',
          status: 'pending',
        },
      ],
    };
    const client = mockClient({
      text: patchResponse(2, [
        {
          id: 'g1',
          subject: 'Updated',
          status: 'completed',
          steps: [
            { id: 's1', subject: 'Updated step', status: 'completed', promptId: 'p1' },
          ],
        },
      ], {
        deleteGoalIds: ['g2'],
        deleteStepIds: ['s2'],
      }),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, [turn()]);

    expect(result.goals.map((goal) => goal.id)).toEqual(['g1']);
    expect(result.goals[0].steps?.map((step) => step.id)).toEqual(['s1']);
    expect(result.goals[0].steps?.[0].subject).toBe('Updated step');
  });

  it('accepts a full tree response during full refresh', async () => {
    const fullTree: ProgressTree = {
      version: 2,
      goals: [
        {
          id: 'g1',
          subject: 'Rebuilt',
          status: 'completed',
          steps: [
            { id: 's1', subject: 'Done', status: 'completed', promptId: 'p1' },
          ],
        },
      ],
    };
    const client = mockClient({ text: JSON.stringify(fullTree) });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(
      { version: 1, goals: [] },
      [turn()],
      undefined,
      {
        requestId: 'full-request',
        sessionId: 'sess-1',
        provider: 'codex',
        mode: 'full',
      },
    );
    expect(result).toEqual(fullTree);
  });

  it('includes userText and assistant summary but excludes raw thinking and tool text', async () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'Existing',
          description: 'history description should not be sent',
          status: 'pending',
        },
      ],
    };
    const client = mockClient({
      text: patchResponse(2, [
        {
          id: 'g1',
          subject: 'Existing',
          status: 'completed',
          steps: [
            { id: 's1', subject: 'Done', status: 'completed', promptId: 'p1' },
          ],
        },
      ]),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const longReply = 'a'.repeat(2000);
    await engine.extract(tree, [
      turn({
        thinkingText: 'private thinking',
        toolText: 'private tool',
        assistantText: longReply,
      }),
    ]);

    const prompt = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .messages[0].content as string;
    expect(prompt).toContain('question');
    expect(prompt).toContain('a'.repeat(500));
    expect(prompt).toContain('[truncated]');
    expect(prompt).not.toContain('private thinking');
    expect(prompt).not.toContain('private tool');
    expect(prompt).not.toContain('history description should not be sent');
    expect(prompt).not.toContain(longReply);
  });

  it('emits conversation, prompt, usage, and response traces', async () => {
    const tree: ProgressTree = { version: 0, goals: [] };
    const client = mockClient({
      text: patchResponse(1, [
        {
          id: 'g1',
          subject: 'New',
          status: 'completed',
          steps: [
            { id: 's1', subject: 'Done', status: 'completed', promptId: 'p1' },
          ],
        },
      ]),
      inputTokens: 321,
      outputTokens: 123,
    });
    const trace = vi.fn<(event: ExtractionTraceEvent) => void>();
    const engine = new LLMExtractionEngineImpl({
      config: mockConfig(),
      client,
      trace,
    });
    const context: ExtractionTraceContext = {
      requestId: 'req-1',
      sessionId: 'codex-session',
      provider: 'codex',
      mode: 'incremental',
      parseScope: 'full_file',
    };

    await engine.extract(tree, [turn()], undefined, context);

    const events = trace.mock.calls.map(([event]) => event);
    expect(events.map((event) => event.type)).toEqual([
      'conversation',
      'prompt',
      'usage',
      'response',
    ]);
    const response = events.find(
      (event): event is Extract<ExtractionTraceEvent, { type: 'response' }> =>
        event.type === 'response',
    );
    expect(response).toBeDefined();
    expect(response!.outputTokens).toBe(123);
    expect(response!.rawOutput).toContain('"upsertGoals"');
    expect(response!.contentBlocks?.[0]).toMatchObject({ type: 'text' });
    expect(response!.outputCharacters).toBeGreaterThanOrEqual(response!.parsedCharacters);
  });

  it('logs raw output and error when patch parsing fails', async () => {
    const client = mockClient({
      text: '{"version":2',
      outputTokens: 80,
    });
    const trace = vi.fn<(event: ExtractionTraceEvent) => void>();
    const engine = new LLMExtractionEngineImpl({
      config: mockConfig(),
      client,
      trace,
    });
    const context: ExtractionTraceContext = {
      requestId: 'req-2',
      sessionId: 'codex-session',
      provider: 'codex',
      mode: 'incremental',
      parseScope: 'full_file',
    };

    await expect(
      engine.extract({ version: 0, goals: [] }, [turn()], undefined, context),
    ).rejects.toThrow();

    const events = trace.mock.calls.map(([event]) => event);
    const response = events.find(
      (event): event is Extract<ExtractionTraceEvent, { type: 'response' }> =>
        event.type === 'response',
    );
    expect(response).toBeDefined();
    expect(response!.rawOutput).toBe('{"version":2');
    expect(response!.parsedCharacters).toBe(0);
    expect(response!.error).toBeTruthy();
  });

  it('processes turns in 5-turn chunks and merges each patch', async () => {
    const tree: ProgressTree = { version: 0, goals: [] };
    const turns = Array.from({ length: 6 }, (_, i) =>
      turn({ promptId: `p${i + 1}`, lineStart: i + 1, lineEnd: i + 1 }),
    );
    const client = {
      messages: {
        create: vi
          .fn()
          .mockResolvedValueOnce({
            content: [
              {
                type: 'text',
                text: patchResponse(1, [
                  {
                    id: 'g1',
                    subject: 'First',
                    status: 'completed',
                    steps: Array.from({ length: 5 }, (_, i) => ({
                      id: `s${i + 1}`,
                      subject: `Step ${i + 1}`,
                      status: 'completed' as const,
                      promptId: `p${i + 1}`,
                    })),
                  },
                ]),
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          })
          .mockResolvedValueOnce({
            content: [
              {
                type: 'text',
                text: patchResponse(2, [
                  {
                    id: 'g2',
                    subject: 'Second',
                    status: 'completed',
                    steps: [
                      { id: 's6', subject: 'Step 6', status: 'completed', promptId: 'p6' },
                    ],
                  },
                ]),
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      },
    } as unknown as Anthropic;
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });

    const result = await engine.extract(tree, turns);

    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.version).toBe(2);
    expect(result.goals.map((goal) => goal.id)).toEqual(['g1', 'g2']);
    const firstPrompt = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .messages[0].content as string;
    const secondPrompt = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[1][0]
      .messages[0].content as string;
    expect(firstPrompt).toContain('"promptId": "p1"');
    expect(firstPrompt).not.toContain('"promptId": "p6"');
    expect(secondPrompt).toContain('"promptId": "p6"');
  });

  it('does not retry after an invalid patch', async () => {
    const client = mockClient({ text: 'not json' });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    await expect(engine.extract({ version: 0, goals: [] }, [turn()])).rejects.toThrow();
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it('caps output tokens at 8192', async () => {
    const client = mockClient({
      text: patchResponse(1, [
        {
          id: 'g1',
          subject: 'New',
          status: 'completed',
          steps: [
            { id: 's1', subject: 'Done', status: 'completed', promptId: 'p1' },
          ],
        },
      ]),
    });
    const engine = new LLMExtractionEngineImpl({
      config: { ...mockConfig(), maxTokens: 16384 },
      client,
    });
    await engine.extract({ version: 0, goals: [] }, [turn()]);
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 8192 }),
    );
  });

  it('repairs missing patch ids from previous nodes', async () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'Existing',
          status: 'in_progress',
          steps: [
            { id: 's1', subject: 'Existing step', status: 'pending', promptId: 'p1' },
          ],
        },
      ],
    };
    const client = mockClient({
      text: patchResponse(2, [
        {
          id: '',
          subject: 'Existing',
          status: 'completed',
          steps: [
            { id: '', subject: 'Updated', status: 'completed', promptId: 'p1' },
          ],
        },
      ]),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, [turn()]);
    expect(result.goals[0].id).toBe('g1');
    expect(result.goals[0].steps?.[0].id).toBe('s1');
  });

  it('fills omitted patch fields from existing nodes', async () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'Existing subject',
          description: 'Existing description',
          status: 'in_progress',
          steps: [
            {
              id: 's1',
              subject: 'Existing step subject',
              description: 'Existing step description',
              status: 'pending',
              promptId: 'p1',
            },
          ],
        },
      ],
    };
    const client = mockClient({
      text: patchResponse(2, [
        {
          id: 'g1',
          subject: '',
          status: '' as ProgressGoal['status'],
          steps: [
            {
              id: 's1',
              subject: '',
              status: '' as ProgressStep['status'],
              promptId: 'p1',
            },
          ],
        },
      ]),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, [turn()]);
    expect(result.goals[0].subject).toBe('Existing subject');
    expect(result.goals[0].status).toBe('in_progress');
    expect(result.goals[0].steps?.[0].subject).toBe('Existing step subject');
    expect(result.goals[0].steps?.[0].status).toBe('pending');
  });
});
