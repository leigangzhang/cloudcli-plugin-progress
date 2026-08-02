 import { describe, expect, it } from 'vitest';
 import { ConversationBuffer } from '../../src/core/buffer.js';
 import type { LogEntry } from '../../src/core/types.js';

 describe('ConversationBuffer', () => {
   it('builds a segment from an assistant thinking message', () => {
     const buffer = new ConversationBuffer();
     buffer.push({
       type: 'assistant',
       uuid: 'a1',
       promptId: 'p1',
       timestamp: '2026-08-01T10:00:00Z',
       content: [{ type: 'thinking', thinking: 'I need to implement auth' }],
     } as LogEntry);

     const segments = buffer.getSegments();
     expect(segments.length).toBe(1);
     expect(segments[0].role).toBe('assistant');
     expect(segments[0].thinkingExcerpt).toContain('implement auth');
     expect(segments[0].promptId).toBe('p1');
   });

   it('captures tool_use and tool_result', () => {
     const buffer = new ConversationBuffer();
     buffer.push({
       type: 'assistant',
       uuid: 'a1',
       promptId: 'p1',
       timestamp: '2026-08-01T10:00:00Z',
       content: [
         {
           type: 'tool_use',
           id: 'tu1',
           name: 'Bash',
           input: { command: 'ls -la' },
         },
       ],
     } as LogEntry);
     buffer.push({
       type: 'user',
       uuid: 'u1',
       promptId: 'p1',
       timestamp: '2026-08-01T10:00:01Z',
       content: [
         {
           type: 'tool_result',
           tool_use_id: 'tu1',
           content: 'total 42',
           is_error: false,
         },
       ],
     } as LogEntry);

     const segments = buffer.getSegments();
     expect(segments[0].toolUses.length).toBe(1);
     expect(segments[0].toolUses[0].name).toBe('Bash');
     expect(segments[0].toolResults.length).toBe(1);
     expect(segments[0].toolResults[0].toolUseId).toBe('tu1');
   });

   it('groups entries by promptId', () => {
     const buffer = new ConversationBuffer();
     buffer.push({
       type: 'assistant',
       uuid: 'a1',
       promptId: 'p1',
       timestamp: '2026-08-01T10:00:00Z',
     } as LogEntry);
     buffer.push({
       type: 'assistant',
       uuid: 'a2',
       promptId: 'p2',
       timestamp: '2026-08-01T10:01:00Z',
     } as LogEntry);

     const segments = buffer.getSegments();
     expect(segments.length).toBe(2);
   });

   it('limits the number of returned segments', () => {
     const buffer = new ConversationBuffer();
     for (let i = 0; i < 5; i++) {
       buffer.push({
         type: 'assistant',
         uuid: `a${i}`,
         promptId: `p${i}`,
         timestamp: `2026-08-01T10:0${i}:00Z`,
       } as LogEntry);
     }

     const segments = buffer.getSegments(2);
     expect(segments.length).toBe(2);
   });

   it('uses assistant role when mixed with user in the same promptId', () => {
     const buffer = new ConversationBuffer();
     buffer.push({
       type: 'user',
       uuid: 'u1',
       promptId: 'p1',
       timestamp: '2026-08-01T10:00:00Z',
     } as LogEntry);
     buffer.push({
       type: 'assistant',
       uuid: 'a1',
       promptId: 'p1',
       timestamp: '2026-08-01T10:00:01Z',
     } as LogEntry);

     const segments = buffer.getSegments();
     expect(segments[0].role).toBe('assistant');
   });
 });
