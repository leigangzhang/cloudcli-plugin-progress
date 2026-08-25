import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ProgressServer } from '../src/server.js';
import type { LLMExtractionEngine, ProgressTree } from '../src/core/types.js';
import { appendJsonl, createTempDir, wait, writeJsonl } from './utils.js';

const require = createRequire(import.meta.url);

async function fetchJson(port: number, method: string, route: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

describe('ProgressServer Codex sessions', () => {
  let server: ProgressServer;
  let port: number;
  let tmp: ReturnType<typeof createTempDir>;
  let mockExtractor: LLMExtractionEngine;

  beforeAll(async () => {
    tmp = createTempDir();
    const dbPath = path.join(tmp.path, 'auth.db');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_session_id TEXT,
        jsonl_path TEXT
      );
    `);
    const rolloutPath = path.join(tmp.path, 'rollout.jsonl');
    db.prepare(
      'INSERT INTO sessions(session_id, provider, provider_session_id, jsonl_path) VALUES (?, ?, ?, ?)',
    ).run('codex-cloud', 'codex', 'codex-thread', rolloutPath);
    db.close();

    writeJsonl(rolloutPath, [
      { type: 'session_meta', payload: { id: 'codex-thread', cwd: tmp.path } },
      { type: 'turn_context', payload: { turn_id: 'turn-1' } },
      {
        type: 'event_msg',
        timestamp: '2026-08-16T00:00:00Z',
        payload: { type: 'user_message', message: 'First Codex request' },
      },
      {
        type: 'response_item',
        timestamp: '2026-08-16T00:00:01Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'First Codex response' }],
        },
      },
      {
        type: 'event_msg',
        payload: { type: 'task_complete', turn_id: 'turn-1' },
      },
    ]);

    vi.stubEnv('HOME', tmp.path);
    vi.stubEnv('DATABASE_PATH', dbPath);
    mockExtractor = {
      extract: vi.fn().mockResolvedValue({
        version: 1,
        goals: [
          {
            id: 'codex-goal',
            subject: 'Codex goal',
            status: 'in_progress',
            steps: [
              {
                id: 'codex-step',
                subject: 'Codex step',
                status: 'pending',
                promptId: 'turn-1',
              },
            ],
          },
        ] satisfies ProgressTree,
      }),
      onUsage: vi.fn().mockReturnValue(() => {}),
    } as unknown as LLMExtractionEngine;

    server = new ProgressServer({
      config: {
        apiKey: 'test-key',
        baseUrl: 'https://test.example',
        model: 'test-model',
      },
      projectsDir: path.join(tmp.path, 'claude-projects'),
      snapshotDir: path.join(tmp.path, 'snapshots'),
      extractor: mockExtractor,
      detectorOptions: { debounceMs: 100, minIntervalMs: 100 },
    });
    const result = await server.start();
    port = result.port;
  });

  afterAll(async () => {
    await server.stop();
    vi.unstubAllEnvs();
    tmp.cleanup();
  });

  it('watches a Codex rollout and parses its turn', async () => {
    const watch = await fetchJson(port, 'POST', '/watch', {
      projectPath: tmp.path,
      sessionId: 'codex-cloud',
    });
    expect(watch.status).toBe(200);
    expect(watch.data.extractionMode).toBe('default');
    await wait(400);

    const turn = await fetchJson(
      port,
      'GET',
      '/turn?sessionId=codex-cloud&promptId=turn-1',
    );
    expect(turn.status).toBe(200);
    expect(turn.data.userText).toBe('First Codex request');
    expect(turn.data.assistantText).toBe('First Codex response');
  });

  it('extracts again when a new Codex turn is appended', async () => {
    const before = (mockExtractor.extract as ReturnType<typeof vi.fn>).mock.calls.length;
    const rolloutPath = path.join(tmp.path, 'rollout.jsonl');
    appendJsonl(rolloutPath, [
      { type: 'turn_context', payload: { turn_id: 'turn-2' } },
      {
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Second Codex request' },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Second Codex response' }],
        },
      },
      {
        type: 'event_msg',
        payload: { type: 'task_complete', turn_id: 'turn-2' },
      },
    ]);
    await wait(500);

    expect(mockExtractor.extract).toHaveBeenCalledTimes(before + 1);
    const incrementalCall = (mockExtractor.extract as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(incrementalCall[3]).toMatchObject({
      provider: 'codex',
      mode: 'incremental',
      parseScope: 'full_file',
    });
    expect(
      (incrementalCall[1] as { promptId: string }[]).map((turn) => turn.promptId),
    ).toEqual(['turn-2']);
    const turn = await fetchJson(
      port,
      'GET',
      '/turn?sessionId=codex-cloud&promptId=turn-2',
    );
    expect(turn.status).toBe(200);
    expect(turn.data.userText).toBe('Second Codex request');
  });

  it('reports codex in debug and refreshes from the rollout file', async () => {
    const debug = await fetchJson(port, 'GET', '/debug?sessionId=codex-cloud');
    expect(debug.status).toBe(200);
    expect(debug.data.provider).toBe('codex');
    expect(debug.data.logTurnCount).toBe(2);

    const mode = await fetchJson(port, 'POST', '/mode', {
      sessionId: 'codex-cloud',
      mode: 'progress-tree',
    });
    expect(mode.status).toBe(200);
    const refresh = await fetchJson(port, 'POST', '/refresh', {
      sessionId: 'codex-cloud',
    });
    expect(refresh.status).toBe(200);
    const tree = refresh.data.tree as ProgressTree;
    expect(tree.goals[0].id).toBe('codex-goal');
    const fullCall = (mockExtractor.extract as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(fullCall[0]).toEqual({ version: 0, goals: [] });
    expect(fullCall[3]).toMatchObject({
      provider: 'codex',
      mode: 'full',
      parseScope: 'full_file',
    });
  });

  it('switches and reports extraction mode', async () => {
    const initial = await fetchJson(port, 'POST', '/mode', {
      sessionId: 'codex-cloud',
      mode: 'default',
    });
    expect(initial.status).toBe(200);
    expect(initial.data.tree).toEqual({ version: 0, goals: [] });

    const changed = await fetchJson(port, 'POST', '/mode', {
      sessionId: 'codex-cloud',
      mode: 'progress-tree',
    });
    expect(changed.status).toBe(200);
    expect(changed.data.extractionMode).toBe('progress-tree');
    expect(changed.data.tree).toEqual({ version: 0, goals: [] });

    const reverted = await fetchJson(port, 'POST', '/mode', {
      sessionId: 'codex-cloud',
      mode: 'default',
    });
    expect(reverted.status).toBe(200);
    expect(reverted.data.extractionMode).toBe('default');
    expect(reverted.data.tree).toEqual({ version: 0, goals: [] });
  });
});
