import { describe, expect, it, vi } from 'vitest';
import { LLMExtractionEngineImpl, summarizeTurns } from '../../src/core/extractor.js';
import type { Anthropic } from '../../src/core/extractor.js';
import type { ConversationTurn, LLMConfig, ProgressTree } from '../../src/core/types.js';

function mockConfig(): LLMConfig {
  return {
    apiKey: 'test-key',
    baseUrl: 'https://test.example',
    model: 'test-model',
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

function mockPollingConfig(): LLMConfig {
  return {
    apiKey: 'test-key',
    baseUrl: 'https://test.example',
    model: 'test-model',
    usePolling: true,
  };
}
describe('LLMExtractionEngineImpl', () => {
  it('extracts progress tree from API response', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const client = mockClient({
      text: JSON.stringify({
        version: 2,
        goals: [
          {
            id: 'g1',
            subject: 'Implement auth',
            status: 'in_progress',
            steps: [{ id: 's1', subject: 'Setup bcrypt', status: 'completed', promptId: 'p1' }],
          },
        ],
      }),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, []);
    expect(result.version).toBe(2);
    expect(result.goals.length).toBe(1);
    expect(result.goals[0].subject).toBe('Implement auth');
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it('strips markdown fences from the response', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const client = mockClient({
      text: '```json\n{"version":2,"goals":[]}\n```',
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, []);
    expect(result).toEqual({ version: 2, goals: [] });
  });

  it('retries once when the first response is invalid JSON', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const client = mockClient({ text: 'not json' });
    client.messages.create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'not json' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ version: 2, goals: [] }) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, []);
    expect(result).toEqual({ version: 2, goals: [] });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it('throws when both attempts return invalid JSON', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const client = mockClient({ text: 'not json' });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    await expect(engine.extract(tree, [])).rejects.toThrow();
  });

  it('throws when the API call fails', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('network down')),
      },
    } as unknown as Anthropic;
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    await expect(engine.extract(tree, [])).rejects.toThrow('network down');
  });

  it('emits token usage after extraction', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const client = mockClient({
      text: JSON.stringify({ version: 2, goals: [] }),
      inputTokens: 123,
      outputTokens: 45,
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const usages: { inputTokens: number; outputTokens: number }[] = [];
    engine.onUsage((u) => usages.push(u));
    await engine.extract(tree, []);
    expect(usages.length).toBe(1);
    expect(usages[0]).toEqual({ inputTokens: 123, outputTokens: 45 });
  });

  it('validates schema and throws for invalid tree', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const client = mockClient({
      text: JSON.stringify({
        version: 2,
        goals: [{ id: 'g1', subject: 'Valid subject', status: 'unknown' }],
      }),
    });
    client.messages.create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            version: 2,
            goals: [{ id: 'g1', subject: 'Valid subject', status: 'unknown' }],
          }),
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    await expect(engine.extract(tree, [])).rejects.toThrow(/status/);
  });

  it('rejects a step without promptId', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const client = mockClient({
      text: JSON.stringify({
        version: 2,
        goals: [
          {
            id: 'g1',
            subject: 'x',
            status: 'pending',
            steps: [{ id: 's1', subject: 'y', status: 'pending' }],
          },
        ],
      }),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    await expect(engine.extract(tree, [])).rejects.toThrow(/promptId/);
  });

  it('passes conversation turns to the prompt', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const client = mockClient({
      text: JSON.stringify({ version: 2, goals: [] }),
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const turns: ConversationTurn[] = [
      { promptId: 'p1', lineStart: 1, lineEnd: 2, userText: 'hello', assistantText: 'hi', timestamp: '2026-01-01T00:00:00Z' },
    ];
    await engine.extract(tree, turns);
    const prompt = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('p1');
    expect(prompt).toContain('hello');
  });
  it('summarizeTurns truncates long text fields', () => {
    const longText = 'a'.repeat(5000);
    const turns: ConversationTurn[] = [
      { promptId: 'p1', lineStart: 1, lineEnd: 2, userText: longText, timestamp: '2026-01-01T00:00:00Z' },
    ];
    const summarized = summarizeTurns(turns, 20, 2000);
    expect(summarized[0].userText).toHaveLength(2000 + '\n...[truncated]'.length);
    expect(summarized[0].userText).toContain('\n...[truncated]');
  });
  it('retries with only the last 5 turns when JSON parsing fails', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const turns: ConversationTurn[] = Array.from({ length: 10 }, (_, i) => ({
      promptId: `p${i + 1}`,
      lineStart: i * 2 + 1,
      lineEnd: i * 2 + 2,
      userText: `turn ${i + 1}`,
      timestamp: '2026-01-01T00:00:00Z',
    }));
    const client = {
      messages: {
        create: vi
          .fn()
          .mockRejectedValueOnce(new Error('No JSON object found in response'))
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: JSON.stringify({ version: 2, goals: [] }) }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      },
    } as unknown as Anthropic;
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, turns);
    expect(result).toEqual({ version: 2, goals: [] });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    const secondPrompt = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[1][0].messages[0].content;
    expect(secondPrompt).toContain('"promptId": "p6"');
    expect(secondPrompt).toContain('"promptId": "p10"');
    expect(secondPrompt).not.toContain('"promptId": "p1"');
    expect(secondPrompt).not.toContain('"promptId": "p5"');
  });

  it('uses polling mode to extract in 5-turn chunks incrementally', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const turns: ConversationTurn[] = Array.from({ length: 6 }, (_, i) => ({
      promptId: `p${i + 1}`,
      lineStart: i * 2 + 1,
      lineEnd: i * 2 + 2,
      userText: `turn ${i + 1}`,
      timestamp: '2026-01-01T00:00:00Z',
    }));
    const treeAfterFirstChunk: ProgressTree = {
      version: 2,
      goals: [
        {
          id: 'g1',
          subject: 'Topic A',
          status: 'in_progress',
          steps: Array.from({ length: 5 }, (_, i) => ({
            id: `s${i + 1}`,
            subject: `Step ${i + 1}`,
            status: 'completed',
            promptId: `p${i + 1}`,
          })),
        },
      ],
    };
    const finalTree: ProgressTree = {
      version: 3,
      goals: [
        {
          id: 'g1',
          subject: 'Topic A',
          status: 'in_progress',
          steps: Array.from({ length: 5 }, (_, i) => ({
            id: `s${i + 1}`,
            subject: `Step ${i + 1}`,
            status: 'completed',
            promptId: `p${i + 1}`,
          })),
        },
        {
          id: 'g2',
          subject: 'Topic B',
          status: 'pending',
          steps: [{ id: 's6', subject: 'Step 6', status: 'pending', promptId: 'p6' }],
        },
      ],
    };
    const client = {
      messages: {
        create: vi
          .fn()
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: JSON.stringify(treeAfterFirstChunk) }],
            usage: { input_tokens: 10, output_tokens: 5 },
          })
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: JSON.stringify(finalTree) }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      },
    } as unknown as Anthropic;
    const engine = new LLMExtractionEngineImpl({ config: mockPollingConfig(), client });
    const result = await engine.extract(tree, turns);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result).toEqual(finalTree);
    const secondPrompt = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[1][0].messages[0].content;
    expect(secondPrompt).toContain('Topic A');
    expect(secondPrompt).toContain('"promptId": "p6"');
  });

  it('extracts the outermost JSON object when the response contains trailing text', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const client = mockClient({
      text: 'Here is the result:\n{"version":2,"goals":[]}\nHope this helps!',
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, []);
    expect(result).toEqual({ version: 2, goals: [] });
  });
  it('retries with the last 5 turns when the response contains malformed JSON', async () => {
    const tree: ProgressTree = { version: 1, goals: [] };
    const turns: ConversationTurn[] = Array.from({ length: 10 }, (_, i) => ({
      promptId: `p${i + 1}`,
      lineStart: i * 2 + 1,
      lineEnd: i * 2 + 2,
      userText: `turn ${i + 1}`,
      timestamp: '2026-01-01T00:00:00Z',
    }));
    const client = {
      messages: {
        create: vi
          .fn()
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: '{"version":2,"goals":[' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          })
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: JSON.stringify({ version: 2, goals: [] }) }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      },
    } as unknown as Anthropic;
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    const result = await engine.extract(tree, turns);
    expect(result).toEqual({ version: 2, goals: [] });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    const secondPrompt = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[1][0].messages[0].content;
    expect(secondPrompt).toContain('"promptId": "p6"');
    expect(secondPrompt).not.toContain('"promptId": "p1"');
  });
});
