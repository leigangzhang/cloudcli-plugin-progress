 import { describe, expect, it, vi } from 'vitest';
 import { LLMExtractionEngineImpl } from '../../src/core/extractor.js';
 import type { Anthropic } from '../../src/core/extractor.js';
 import type { LLMConfig, ProgressTree } from '../../src/core/types.js';

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
             steps: [{ id: 's1', subject: 'Setup bcrypt', status: 'completed' }],
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
      content: [{ type: 'text', text: JSON.stringify({ version: 2, goals: [{ id: 'g1', subject: 'Valid subject', status: 'unknown' }] }) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const engine = new LLMExtractionEngineImpl({ config: mockConfig(), client });
    await expect(engine.extract(tree, [])).rejects.toThrow(/status/);
  });
 });
