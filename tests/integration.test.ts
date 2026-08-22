import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { ProgressServer } from '../src/server.js';
import { encodeProjectPath } from '../src/core/paths.js';
import type { LLMExtractionEngine, ProgressTree } from '../src/core/types.js';
import { appendJsonl, createTempDir, wait, writeJsonl } from './utils.js';

function makeConfig() {
  return {
    apiKey: 'test-key',
    baseUrl: 'https://test.example',
    model: 'test-model',
  };
}

async function fetchJson(port: number, method: string, route: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as unknown };
}

function collectMessages(ws: WebSocket): unknown[] {
  const messages: unknown[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return messages;
}

function mockTree(): ProgressTree {
  return {
    version: 1,
    goals: [
      {
        id: 'g-integrated',
        subject: 'Integrated goal',
        status: 'in_progress',
        steps: [
          {
            id: 's-integrated',
            subject: 'Integrated step',
            status: 'completed',
            promptId: 'p-integrated',
          },
        ],
      },
    ],
  };
}

describe('ProgressServer end-to-end', () => {
  let server: ProgressServer;
  let port: number;
  let tmp: ReturnType<typeof createTempDir>;
  let mockExtractor: LLMExtractionEngine;

  beforeAll(async () => {
    tmp = createTempDir();
    mockExtractor = {
      extract: vi.fn().mockResolvedValue(mockTree()),
      onUsage: vi.fn().mockReturnValue(() => {}),
    } as unknown as LLMExtractionEngine;
    server = new ProgressServer({
      config: makeConfig(),
      projectsDir: path.join(tmp.path, 'projects'),
      snapshotDir: path.join(tmp.path, 'snapshots'),
      extractor: mockExtractor,
      detectorOptions: { debounceMs: 100, minIntervalMs: 100 },
    });
    const result = await server.start();
    port = result.port;
  });

  afterAll(async () => {
    await server.stop();
    tmp.cleanup();
  });

  it('watches a jsonl file and updates progress when assistant thinking arrives', async () => {
    const sessionId = 'integration-sess';
    const projectPath = tmp.path;
    const encoded = encodeProjectPath(tmp.path);
    const logFile = path.join(tmp.path, 'projects', encoded, `${sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });

    writeJsonl(logFile, [
      { type: 'system', uuid: 's0' },
      { type: 'user', uuid: 'u1', promptId: 'p1', content: [{ type: 'text', text: 'Hello' }] },
    ]);

    const { status, data } = await fetchJson(port, 'POST', '/watch', { projectPath, sessionId });
    expect(status).toBe(200);
    expect((data as { tree: { goals: unknown[] } }).tree.goals).toEqual([]);

    appendJsonl(logFile, [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        promptId: 'p1',
        content: [{ type: 'thinking', thinking: 'I need to plan the implementation.' }],
        stopReason: 'end_turn',
      },
    ]);

    await wait(400);
    expect(mockExtractor.extract).toHaveBeenCalled();

    const { data: progressData } = await fetchJson(
      port,
      'GET',
      `/progress?sessionId=${encodeURIComponent(sessionId)}`,
    );
    const progress = progressData as { tree: ProgressTree; status: string };
    expect(progress.status).toBe('idle');
    expect(progress.tree.goals).toHaveLength(1);
    expect(progress.tree.goals[0].subject).toBe('Integrated goal');
  });

  it('broadcasts progress updates over WebSocket after file changes', async () => {
    const sessionId = 'integration-ws';
    const projectPath = tmp.path;
    const encoded = encodeProjectPath(tmp.path);
    const logFile = path.join(tmp.path, 'projects', encoded, `${sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    writeJsonl(logFile, [{ type: 'system', uuid: 's0' }]);

    await fetchJson(port, 'POST', '/watch', { projectPath, sessionId });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const messages = collectMessages(ws);
    ws.send(JSON.stringify({ type: 'subscribe', projectPath, sessionId }));
    await wait(200);

    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect((messages[0] as { type: string }).type).toBe('progress');
    expect((messages[1] as { type: string }).type).toBe('status');

    messages.length = 0;
    appendJsonl(logFile, [
      {
        type: 'user',
        uuid: 'u2',
        promptId: 'p2',
        content: [{ type: 'text', text: 'Update progress' }],
      },
      {
        type: 'assistant',
        uuid: 'a2',
        parentUuid: 'u2',
        promptId: 'p2',
        content: [{ type: 'thinking', thinking: 'Plan updated.' }],
        stopReason: 'end_turn',
      },
    ]);

    await wait(400);

    const progressMessages = messages.filter((m) => (m as { type: string }).type === 'progress');
    expect(progressMessages.length).toBeGreaterThanOrEqual(1);
    const latest = progressMessages[progressMessages.length - 1] as { tree: ProgressTree };
    expect(latest.tree.goals[0].subject).toBe('Integrated goal');

    ws.close();
  });

  it('refresh endpoint forces extraction and returns updated progress', async () => {
    const sessionId = 'integration-refresh';
    const projectPath = tmp.path;
    const encoded = encodeProjectPath(tmp.path);
    const logFile = path.join(tmp.path, 'projects', encoded, `${sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    writeJsonl(logFile, [{ type: 'system', uuid: 's0' }]);

    await fetchJson(port, 'POST', '/watch', { projectPath, sessionId });
    const before = await fetchJson(
      port,
      'GET',
      `/progress?sessionId=${encodeURIComponent(sessionId)}`,
    );
    expect((before.data as { tree: { goals: unknown[] } }).tree.goals).toEqual([]);

    appendJsonl(logFile, [
      { type: 'user', uuid: 'u3', promptId: 'p3', content: [{ type: 'text', text: 'Do it' }] },
    ]);
    await wait(50);

    const after = await fetchJson(port, 'POST', '/refresh', { sessionId });
    expect(after.status).toBe(200);
    expect((after.data as { tree: { goals: unknown[] } }).tree.goals).toHaveLength(1);
  });
});
