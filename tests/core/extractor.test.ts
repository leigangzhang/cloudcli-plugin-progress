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
    upsertGoals: goals.map((goal) => ({
      ...goal,
      description: typeof goal.description === 'string' ? goal.description : '',
      steps: goal.steps?.map((step) => ({
        ...step,
        description: typeof step.description === 'string' ? step.description : '',
      })),
    })),
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

  it('includes first 1000 characters of user text and assistant summary but excludes raw thinking and tool text', async () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'Existing',
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
    expect(prompt).toContain('a'.repeat(1000));
    expect(prompt).not.toContain('a'.repeat(1001));
    expect(prompt).not.toContain('[truncated]');
    expect(prompt).not.toContain('private thinking');
    expect(prompt).not.toContain('private tool');
    expect(prompt).not.toContain(longReply);
  });

  it('sends the latest goal and all of its steps with full descriptions', async () => {
    const tree: ProgressTree = {
      version: 2,
      goals: [
        {
          id: 'old-goal',
          subject: 'Closed history',
          status: 'completed',
          steps: [
            { id: 'old-step', subject: 'Old', status: 'completed', promptId: 'old' },
          ],
        },
        {
          id: 'latest-goal',
          subject: 'Current work',
          description: 'Goal description',
          status: 'in_progress',
          steps: [
            {
              id: 'older-step',
              subject: 'Older',
              description: 'Older step description',
              status: 'completed',
              promptId: 'older',
            },
            {
              id: 'latest-step',
              subject: 'Current',
              description: 'Latest step description',
              status: 'pending',
              promptId: 'current',
            },
          ],
        },
      ],
    };
    const client = mockClient({
      text: patchResponse(3, [
        {
          id: 'latest-goal',
          subject: 'Current work',
          description: 'Goal description',
          status: 'completed',
          steps: [
            {
              id: 'latest-step',
              subject: 'Current',
              description: 'Latest step description',
              status: 'completed',
              promptId: 'current',
            },
          ],
        },
      ]),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    await engine.extract(tree, [turn()]);
    const prompt = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .messages[0].content as string;
    expect(prompt).toContain('latest-goal');
    expect(prompt).toContain('Goal description');
    expect(prompt).toContain('latest-step');
    expect(prompt).toContain('Latest step description');
    expect(prompt).toContain('older-step');
    expect(prompt).toContain('Older step description');
    expect(prompt).not.toContain('old-goal');
    expect(prompt).not.toContain('old-step');
    expect(prompt).not.toContain('Closed history');
    expect(prompt).not.toContain('[truncated]');
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
    expect(response!.rawResponse).toContain('"output_tokens"');
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
      expect.objectContaining({
        max_tokens: 8192,
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        response_format: { type: 'json_object' },
      }),
    );
  });

  it('instructs the model to use only supported status values', async () => {
    const client = mockClient({
      text: patchResponse(1, [
        {
          id: 'g1',
          subject: 'New',
          description: '',
          status: 'completed',
          steps: [
            {
              id: 's1',
              subject: 'Step',
              description: '',
              status: 'completed',
              promptId: 'p1',
            },
          ],
        },
      ]),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    await engine.extract({ version: 0, goals: [] }, [turn()]);

    const request = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemPrompt = request.system as string;
    expect(systemPrompt).toContain('pending');
    expect(systemPrompt).toContain('in_progress');
    expect(systemPrompt).toContain('completed');
    expect(systemPrompt).toContain('deleted');
  });

  it('instructs the model to aggregate related refinements into one goal', async () => {
    const client = mockClient({
      text: patchResponse(1, [
        {
          id: 'g1',
          subject: 'New',
          description: '',
          status: 'completed',
          steps: [
            {
              id: 's1',
              subject: 'Step',
              description: '',
              status: 'completed',
              promptId: 'p1',
            },
          ],
        },
      ]),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    await engine.extract({ version: 0, goals: [] }, [turn()]);

    const request = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemPrompt = request.system as string;
    expect(systemPrompt).toContain('only start a new goal');
    expect(systemPrompt).toContain('markdown feature improvements belong to one goal');
  });

  it('promotes a goal to completed when all of its steps are completed', async () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'Goal',
          status: 'in_progress',
          steps: [
            { id: 's1', subject: 'Step', status: 'pending', promptId: 'p1' },
          ],
        },
      ],
    };
    const client = mockClient({
      text: patchResponse(2, [
        {
          id: 'g1',
          subject: 'Goal',
          description: '',
          status: 'in_progress',
          steps: [
            {
              id: 's1',
              subject: 'Step',
              description: '',
              status: 'completed',
              promptId: 'p1',
            },
          ],
        },
      ]),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, [turn()]);

    expect(result.goals[0].status).toBe('completed');
  });

  it('orders patch steps to match the conversation turn order', async () => {
    const client = mockClient({
      text: patchResponse(1, [
        {
          id: 'g1',
          subject: 'Goal',
          description: '',
          status: 'in_progress',
          steps: [
            {
              id: 's3',
              subject: 'Third',
              description: '',
              status: 'completed',
              promptId: 'p3',
            },
            {
              id: 's1',
              subject: 'First',
              description: '',
              status: 'completed',
              promptId: 'p1',
            },
            {
              id: 's2',
              subject: 'Second',
              description: '',
              status: 'completed',
              promptId: 'p2',
            },
          ],
        },
      ]),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(
      { version: 0, goals: [] },
      [
        turn({ promptId: 'p1', lineStart: 1, lineEnd: 1 }),
        turn({ promptId: 'p2', lineStart: 2, lineEnd: 2 }),
        turn({ promptId: 'p3', lineStart: 3, lineEnd: 3 }),
      ],
    );

    expect(result.goals[0].steps?.map((step) => step.promptId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('generates stable ids for missing patch ids without reusing previous nodes', async () => {
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
          description: 'Goal description',
          status: 'completed',
          steps: [
            {
              id: '',
              subject: 'Updated',
              description: 'Step description',
              status: 'completed',
              promptId: 'p1',
            },
          ],
        },
      ]),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, [turn()]);
    expect(result.goals.map((goal) => goal.id)).toContain('g1');
    const newGoal = result.goals.find((goal) => goal.id !== 'g1');
    expect(newGoal).toBeDefined();
    expect(newGoal!.id).not.toBe('g1');
    expect(newGoal!.steps?.[0].id).not.toBe('s1');
    expect(newGoal!.steps?.[0].promptId).toBe('p1');
  });

  it('rejects affected nodes that omit required description fields', async () => {
    const tree: ProgressTree = {
      version: 1,
      goals: [
        {
          id: 'g1',
          subject: 'Existing',
          status: 'in_progress',
          steps: [
            {
              id: 's1',
              subject: 'Existing step',
              status: 'pending',
              promptId: 'p1',
            },
          ],
        },
      ],
    };
    const client = mockClient({
      text: JSON.stringify({
        version: 2,
        upsertGoals: [
          {
            id: 'g1',
            subject: 'Existing',
            status: 'completed',
            steps: [
              { id: 's1', subject: 'Done', status: 'completed', promptId: 'p1' },
            ],
          },
        ],
        deleteGoalIds: [],
        deleteStepIds: [],
      }),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    await expect(engine.extract(tree, [turn()])).rejects.toThrow(/description must be a string/);
  });

  it('rejects goals without steps', async () => {
    const client = mockClient({
      text: JSON.stringify({
        version: 2,
        upsertGoals: [
          {
            id: 'g1',
            subject: 'Existing',
            description: 'Goal description',
            status: 'completed',
          },
        ],
        deleteGoalIds: [],
        deleteStepIds: [],
      }),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });

    await expect(engine.extract({ version: 0, goals: [] }, [turn()])).rejects.toThrow(
      /steps must be a non-empty array/,
    );
  });
});
