 import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
 import { ConversationBuffer } from '../../src/core/buffer.js';
 import { DiffDetectorImpl } from '../../src/core/diff-detector.js';
import type { ConversationSegment, LogEntry, SessionLogEntry } from '../../src/core/types.js';

 describe('DiffDetectorImpl', () => {
   beforeEach(() => {
     vi.useFakeTimers();
   });

   afterEach(() => {
     vi.useRealTimers();
   });

   it('does not trigger for irrelevant system messages', () => {
     const buffer = new ConversationBuffer();
     const detector = new DiffDetectorImpl(buffer, { debounceMs: 300, minIntervalMs: 300 });
     const triggers: ConversationSegment[][] = [];
     detector.onTrigger((segments) => triggers.push(segments));
     detector.ingest({ type: 'system', uuid: 's1' } as LogEntry);
     vi.advanceTimersByTime(500);
     expect(triggers.length).toBe(0);
   });

   it('triggers after debounce for assistant thinking', () => {
     const buffer = new ConversationBuffer();
     const detector = new DiffDetectorImpl(buffer, { debounceMs: 300, minIntervalMs: 300 });
     const triggers: ConversationSegment[][] = [];
     detector.onTrigger((segments) => triggers.push(segments));
     detector.ingest({
       type: 'assistant',
       uuid: 'a1',
       promptId: 'p1',
       content: [{ type: 'thinking', thinking: 'planning' }],
     } as LogEntry);
     vi.advanceTimersByTime(400);
     expect(triggers.length).toBe(1);
     expect(triggers[0][0].promptId).toBe('p1');
   });

   it('triggers for assistant tool_use', () => {
     const buffer = new ConversationBuffer();
     const detector = new DiffDetectorImpl(buffer, { debounceMs: 300, minIntervalMs: 300 });
     const triggers: ConversationSegment[][] = [];
     detector.onTrigger((segments) => triggers.push(segments));
     detector.ingest({
       type: 'assistant',
       uuid: 'a1',
       content: [{ type: 'tool_use', id: 'tu1', name: 'Bash' }],
     } as LogEntry);
     vi.advanceTimersByTime(400);
     expect(triggers.length).toBe(1);
   });

   it('triggers for stop_reason end_turn', () => {
     const buffer = new ConversationBuffer();
     const detector = new DiffDetectorImpl(buffer, { debounceMs: 300, minIntervalMs: 300 });
     const triggers: ConversationSegment[][] = [];
     detector.onTrigger((segments) => triggers.push(segments));
     detector.ingest({
       type: 'assistant',
       uuid: 'a1',
       stopReason: 'end_turn',
     } as LogEntry);
     vi.advanceTimersByTime(400);
     expect(triggers.length).toBe(1);
   });

   it('coalesces burst entries into one trigger', () => {
     const buffer = new ConversationBuffer();
     const detector = new DiffDetectorImpl(buffer, { debounceMs: 300, minIntervalMs: 300 });
     const triggers: ConversationSegment[][] = [];
     detector.onTrigger((segments) => triggers.push(segments));

     detector.ingest({
       type: 'assistant',
       uuid: 'a1',
       promptId: 'p1',
       content: [{ type: 'thinking', thinking: 'step 1' }],
     } as LogEntry);
     vi.advanceTimersByTime(100);
     detector.ingest({
       type: 'user',
       uuid: 'u1',
       promptId: 'p1',
     } as LogEntry);
     vi.advanceTimersByTime(400);
     expect(triggers.length).toBe(1);
   });

   it('respects minimum interval between triggers', () => {
     const buffer = new ConversationBuffer();
     const detector = new DiffDetectorImpl(buffer, { debounceMs: 100, minIntervalMs: 500 });
     const triggers: ConversationSegment[][] = [];
     detector.onTrigger((segments) => triggers.push(segments));

     detector.ingest({
       type: 'assistant',
       uuid: 'a1',
       promptId: 'p1',
       content: [{ type: 'thinking', thinking: 'first' }],
     } as LogEntry);
     vi.advanceTimersByTime(200);
     expect(triggers.length).toBe(1);

     detector.ingest({
       type: 'assistant',
       uuid: 'a2',
       promptId: 'p2',
       content: [{ type: 'thinking', thinking: 'second' }],
     } as LogEntry);
     vi.advanceTimersByTime(200);
     expect(triggers.length).toBe(1);

     vi.advanceTimersByTime(400);
     expect(triggers.length).toBe(2);
   });

   it('flush forces an immediate trigger', () => {
     const buffer = new ConversationBuffer();
     const detector = new DiffDetectorImpl(buffer, { debounceMs: 300, minIntervalMs: 300 });
     const triggers: ConversationSegment[][] = [];
     detector.onTrigger((segments) => triggers.push(segments));
     detector.ingest({
       type: 'assistant',
       uuid: 'a1',
       content: [{ type: 'thinking', thinking: 'now' }],
     } as LogEntry);
     detector.flush();
     expect(triggers.length).toBe(1);
   });

   it('triggers Codex mode without storing raw events in the Claude buffer', () => {
     const buffer = new ConversationBuffer();
     const detector = new DiffDetectorImpl(buffer, {
       debounceMs: 300,
       minIntervalMs: 300,
       provider: 'codex',
     });
     const triggers: ConversationSegment[][] = [];
     detector.onTrigger((segments) => triggers.push(segments));

     detector.ingest({
       type: 'response_item',
       payload: { type: 'function_call', name: 'exec_command' },
     });
     detector.ingest({
       type: 'event_msg',
       payload: { type: 'task_complete', turn_id: 'turn-1' },
     });
     vi.advanceTimersByTime(400);

     expect(triggers.length).toBe(1);
     expect(triggers[0]).toEqual([]);
     expect(buffer.getTurns()).toEqual([]);
   });

   it('triggers Codex mode for assistant output text', () => {
     const buffer = new ConversationBuffer();
     const detector = new DiffDetectorImpl(buffer, {
       debounceMs: 300,
       minIntervalMs: 300,
       provider: 'codex',
     });
     const triggers: ConversationSegment[][] = [];
     detector.onTrigger((segments) => triggers.push(segments));
     detector.ingest({
       type: 'response_item',
       payload: {
         type: 'message',
         role: 'assistant',
         content: [{ type: 'output_text', text: 'progress update' }],
       },
     } as SessionLogEntry);
     vi.advanceTimersByTime(400);
     expect(triggers.length).toBe(1);
   });
 });
