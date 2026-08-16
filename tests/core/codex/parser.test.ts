import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCodexTurns,
  buildCodexTurnsFromLog,
  isCodexProgressEntry,
} from '../../../src/core/codex/parser.js';
import type { SessionLogEntry } from '../../../src/core/types.js';
import { createTempDir, writeJsonl } from '../../utils.js';

function entry(lineNumber: number, value: SessionLogEntry) {
  return { entry: value, lineNumber };
}

describe('buildCodexTurns', () => {
  it('groups response items by turn_id', () => {
    const turns = buildCodexTurns([
      entry(1, { type: 'session_meta', payload: { id: 'thread-1' } }),
      entry(2, { type: 'turn_context', payload: { turn_id: 'turn-1' } }),
      entry(3, {
        type: 'event_msg',
        timestamp: '2026-08-16T00:00:00Z',
        payload: { type: 'user_message', message: 'Build a plan' },
      }),
      entry(4, {
        type: 'response_item',
        timestamp: '2026-08-16T00:00:01Z',
        payload: {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Think through the plan.' }],
        },
      }),
      entry(5, {
        type: 'response_item',
        timestamp: '2026-08-16T00:00:02Z',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: '{"cmd":"ls"}',
        },
      }),
      entry(6, {
        type: 'response_item',
        timestamp: '2026-08-16T00:00:03Z',
        payload: {
          type: 'function_call_output',
          output: 'file.txt',
        },
      }),
      entry(7, {
        type: 'response_item',
        timestamp: '2026-08-16T00:00:04Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Plan ready.' }],
        },
      }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].promptId).toBe('turn-1');
    expect(turns[0].lineStart).toBe(2);
    expect(turns[0].lineEnd).toBe(7);
    expect(turns[0].userText).toBe('Build a plan');
    expect(turns[0].thinkingText).toBe('Think through the plan.');
    expect(turns[0].assistantText).toBe('Plan ready.');
    expect(turns[0].toolText).toContain('[tool:exec_command]');
    expect(turns[0].toolText).toContain('file.txt');
    expect(turns[0].timestamp).toBe('2026-08-16T00:00:04Z');
  });

  it('keeps an active turn without task_complete', () => {
    const turns = buildCodexTurns([
      entry(1, { type: 'turn_context', payload: { turn_id: 'turn-1' } }),
      entry(2, {
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'turn-1' },
      }),
      entry(3, {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Still working.' }],
        },
      }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].assistantText).toBe('Still working.');
  });

  it('falls back to task_started when turn_context is missing', () => {
    const turns = buildCodexTurns([
      entry(1, {
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'turn-2' },
      }),
      entry(2, {
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Fallback turn' },
      }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].promptId).toBe('turn-2');
    expect(turns[0].userText).toBe('Fallback turn');
  });

  it('does not duplicate assistant text from event and response items', () => {
    const turns = buildCodexTurns([
      entry(1, { type: 'turn_context', payload: { turn_id: 'turn-dup' } }),
      entry(2, {
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'Only response item should win' },
      }),
      entry(3, {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Only response item should win' }],
        },
      }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].assistantText).toBe('Only response item should win');
  });

  it('ignores world_state and developer context', () => {
    const turns = buildCodexTurns([
      entry(1, { type: 'world_state', payload: { some: 'metadata' } }),
      entry(2, { type: 'turn_context', payload: { turn_id: 'turn-3' } }),
      entry(3, {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: '<skills_instructions>hidden</skills_instructions>' }],
        },
      }),
      entry(4, {
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Visible request' },
      }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].userText).toBe('Visible request');
    expect(turns[0].assistantText).toBeUndefined();
  });

  it('ignores unknown outer events', () => {
    const turns = buildCodexTurns([
      entry(1, { type: 'future_event', payload: { turn_id: 'turn-4' } }),
      entry(2, { type: 'turn_context', payload: { turn_id: 'turn-4' } }),
      entry(3, {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok' }],
        },
      }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].assistantText).toBe('ok');
  });
});

describe('buildCodexTurnsFromLog', () => {
  it('reads a rollout file and returns normalized turns', () => {
    const tmp = createTempDir();
    const file = path.join(tmp.path, 'rollout.jsonl');
    writeJsonl(file, [
      { type: 'session_meta', payload: { id: 'thread-1' } },
      { type: 'turn_context', payload: { turn_id: 'turn-1' } },
      {
        type: 'event_msg',
        timestamp: '2026-08-16T00:00:00Z',
        payload: { type: 'user_message', message: 'Hello' },
      },
      {
        type: 'response_item',
        timestamp: '2026-08-16T00:00:01Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hi' }],
        },
      },
    ]);

    const turns = buildCodexTurnsFromLog(file);
    expect(turns).toHaveLength(1);
    expect(turns[0].promptId).toBe('turn-1');
    expect(turns[0].userText).toBe('Hello');
    expect(turns[0].assistantText).toBe('Hi');
    expect(fs.existsSync(file)).toBe(true);
    tmp.cleanup();
  });
});

describe('isCodexProgressEntry', () => {
  it.each([
    [{ type: 'event_msg', payload: { type: 'task_complete' } }],
    [{ type: 'event_msg', payload: { type: 'agent_message', message: 'done' } }],
    [{ type: 'event_msg', payload: { type: 'user_message', message: 'hello' } }],
    [
      {
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [] },
      },
    ],
  ])('accepts relevant entries: %j', (value) => {
    expect(isCodexProgressEntry(value as SessionLogEntry)).toBe(true);
  });

  it('does not trigger for tool events', () => {
    expect(
      isCodexProgressEntry({
        type: 'response_item',
        payload: { type: 'function_call', name: 'exec_command' },
      }),
    ).toBe(false);
    expect(
      isCodexProgressEntry({
        type: 'event_msg',
        payload: { type: 'agent_reasoning' },
      }),
    ).toBe(false);
  });
});
