import { describe, expect, it } from 'vitest';
import { buildTurns, buildTurnsFromLog } from '../../src/core/turns.js';
import type { LogEntry } from '../../src/core/types.js';
import { createTempDir, writeJsonl } from '../utils.js';

describe('buildTurns', () => {
  it('groups entries into conversation turns by promptId', () => {
    const entries: LogEntry[] = [
      {
        type: 'user',
        uuid: 'u1',
        promptId: 'p1',
        timestamp: '2026-08-01T10:00:00Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Question one' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        promptId: 'p1',
        timestamp: '2026-08-01T10:00:05Z',
        content: [{ type: 'text', text: 'Answer one' }],
      },
      {
        type: 'user',
        uuid: 'u2',
        promptId: 'p2',
        timestamp: '2026-08-01T10:01:00Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Question two' }] },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        parentUuid: 'u2',
        promptId: 'p2',
        timestamp: '2026-08-01T10:01:05Z',
        content: [{ type: 'text', text: 'Answer two' }],
      },
    ];

    const turns = buildTurns(entries.map((entry, index) => ({ entry, lineNumber: index + 1 })));
    expect(turns.length).toBe(2);
    expect(turns[0].promptId).toBe('p1');
    expect(turns[0].userText).toBe('Question one');
    expect(turns[0].assistantText).toBe('Answer one');
    expect(turns[1].promptId).toBe('p2');
    expect(turns[1].userText).toBe('Question two');
    expect(turns[1].assistantText).toBe('Answer two');
  });

  it('puts tool results into toolText, not userText', () => {
    const entries: LogEntry[] = [
      {
        type: 'user',
        uuid: 'u1',
        promptId: 'p1',
        timestamp: '2026-08-01T10:00:00Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Run command' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        promptId: 'p1',
        timestamp: '2026-08-01T10:00:01Z',
        content: [{ type: 'tool_use', id: 't1', name: 'Bash' }],
      },
      {
        type: 'user',
        uuid: 'u2',
        parentUuid: 'a1',
        promptId: 'p1',
        timestamp: '2026-08-01T10:00:02Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'output' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        parentUuid: 'u2',
        promptId: 'p1',
        timestamp: '2026-08-01T10:00:03Z',
        content: [{ type: 'text', text: 'Final answer' }],
      },
    ];

    const turns = buildTurns(entries.map((entry, index) => ({ entry, lineNumber: index + 1 })));
    expect(turns.length).toBe(1);
    expect(turns[0].promptId).toBe('p1');
    expect(turns[0].userText).toBe('Run command');
    expect(turns[0].userText).not.toContain('output');
    expect(turns[0].toolText).toContain('output');
    expect(turns[0].assistantText).toBe('Final answer');
  });

  it('extracts thinking text', () => {
    const entries: LogEntry[] = [
      {
        type: 'user',
        uuid: 'u1',
        promptId: 'p1',
        timestamp: '2026-08-01T10:00:00Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Think' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        promptId: 'p1',
        timestamp: '2026-08-01T10:00:01Z',
        content: [{ type: 'thinking', thinking: 'Deep thought' }],
      },
      {
        type: 'assistant',
        uuid: 'a2',
        parentUuid: 'a1',
        promptId: 'p1',
        timestamp: '2026-08-01T10:00:02Z',
        content: [{ type: 'text', text: 'Answer' }],
      },
    ];

    const turns = buildTurns(entries.map((entry, index) => ({ entry, lineNumber: index + 1 })));
    expect(turns[0].thinkingText).toBe('Deep thought');
    expect(turns[0].assistantText).toBe('Answer');
  });
});

describe('buildTurnsFromLog', () => {
  it('reads turns from a jsonl file', () => {
    const tmp = createTempDir();
    const logFile = `${tmp.path}/session.jsonl`;
    writeJsonl(logFile, [
      { type: 'user', uuid: 'u1', promptId: 'p1', timestamp: '2026-08-01T10:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'Q' }] } },
      { type: 'assistant', uuid: 'a1', parentUuid: 'u1', promptId: 'p1', timestamp: '2026-08-01T10:00:01Z', content: [{ type: 'text', text: 'A' }] },
    ]);
    const turns = buildTurnsFromLog(logFile);
    expect(turns.length).toBe(1);
    expect(turns[0].promptId).toBe('p1');
    expect(turns[0].lineStart).toBe(1);
    expect(turns[0].lineEnd).toBe(2);
    tmp.cleanup();
  });
});
