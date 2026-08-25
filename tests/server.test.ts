import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { ProgressServer } from '../src/server.js';
import { encodeProjectPath } from '../src/core/paths.js';
import type { LLMExtractionEngine } from '../src/core/types.js';
import { createTempDir, wait, writeJsonl } from './utils.js';

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

describe('ProgressServer', () => {
  let server: ProgressServer;
  let port: number;
  let tmp: ReturnType<typeof createTempDir>;
  let mockExtractor: LLMExtractionEngine;

  beforeAll(async () => {
    tmp = createTempDir();
    mockExtractor = {
      extract: vi.fn().mockResolvedValue({ version: 1, goals: [] }),
      onUsage: vi.fn().mockReturnValue(() => {}),
    } as unknown as LLMExtractionEngine;
    server = new ProgressServer({
      config: makeConfig(),
      projectsDir: path.join(tmp.path, 'projects'),
      snapshotDir: path.join(tmp.path, 'snapshots'),
      extractor: mockExtractor,
    });
    const result = await server.start();
    port = result.port;
  });

  afterAll(async () => {
    await server.stop();
    tmp.cleanup();
  });

  it('returns health status', async () => {
    const { status, data } = await fetchJson(port, 'GET', '/health');
    expect(status).toBe(200);
    expect((data as Record<string, string>).status).toBe('ok');
    expect((data as Record<string, string>).model).toBe('test-model');
  });

  it('rejects invalid watch requests', async () => {
    const { status } = await fetchJson(port, 'POST', '/watch', { bad: true });
    expect(status).toBe(400);
  });

  it('watches a session and returns progress', async () => {
    const sessionId = 'sess-1';
    const projectPath = tmp.path;
    const logFile = path.join(tmp.path, 'projects', encodeProjectPath(tmp.path), `${sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    writeJsonl(logFile, [{ type: 'system', uuid: 's1' }]);

    const { status, data } = await fetchJson(port, 'POST', '/watch', { projectPath, sessionId });
    expect(status).toBe(200);
    const response = data as { tree: { goals: unknown[] }; status: string };
    expect(response.status).toBe('idle');
    expect(response.tree.goals).toEqual([]);
  });

  it('broadcasts progress updates over WebSocket', async () => {
    const sessionId = 'sess-2';
    const projectPath = tmp.path;
    const encoded = encodeProjectPath(tmp.path);
    const logFile = path.join(tmp.path, 'projects', encoded, `${sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    writeJsonl(logFile, [{ type: 'system', uuid: 's0' }]);

    await fetchJson(port, 'POST', '/watch', { projectPath, sessionId });
    await wait(300);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const messages = collectMessages(ws);
    ws.send(JSON.stringify({ type: 'subscribe', projectPath, sessionId }));
    await wait(500);

    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect((messages[0] as { type: string }).type).toBe('progress');
    expect((messages[1] as { type: string }).type).toBe('status');
    ws.close();
  });

  it('refresh endpoint returns current progress', async () => {
    const sessionId = 'sess-3';
    const projectPath = tmp.path;
    const encoded = encodeProjectPath(tmp.path);
    const logFile = path.join(tmp.path, 'projects', encoded, `${sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    writeJsonl(logFile, [{ type: 'system', uuid: 's0' }]);

    await fetchJson(port, 'POST', '/watch', { projectPath, sessionId });
    const { status, data } = await fetchJson(port, 'POST', '/refresh', { sessionId });
    expect(status).toBe(200);
    expect((data as { status: string }).status).toBe('idle');
  });

  it('turn endpoint returns conversation turn by promptId', async () => {
    const sessionId = 'sess-turn';
    const projectPath = tmp.path;
    const encoded = encodeProjectPath(tmp.path);
    const logFile = path.join(tmp.path, 'projects', encoded, `${sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    writeJsonl(logFile, [
      {
        type: 'user',
        uuid: 'u1',
        promptId: 'p-turn-1',
        timestamp: '2026-08-01T10:00:00Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        promptId: 'p-turn-1',
        timestamp: '2026-08-01T10:00:01Z',
        content: [{ type: 'text', text: 'World' }],
      },
    ]);

    await fetchJson(port, 'POST', '/watch', { projectPath, sessionId });
    const { status, data } = await fetchJson(
      port,
      'GET',
      `/turn?sessionId=${sessionId}&promptId=p-turn-1`,
    );
    expect(status).toBe(200);
    const turn = data as { promptId: string; userText: string; assistantText: string };
    expect(turn.promptId).toBe('p-turn-1');
    expect(turn.userText).toBe('Hello');
    expect(turn.assistantText).toBe('World');
  });
});

describe('ProgressServer without API key', () => {
  let server: ProgressServer;
  let port: number;
  let tmp: ReturnType<typeof createTempDir>;

  beforeAll(async () => {
    tmp = createTempDir();
    server = new ProgressServer({
      config: { apiKey: '', model: 'unknown' },
      projectsDir: path.join(tmp.path, 'projects'),
      snapshotDir: path.join(tmp.path, 'snapshots'),
    });
    const result = await server.start();
    port = result.port;
  });

  afterAll(async () => {
    await server.stop();
    tmp.cleanup();
  });

  it('watch endpoint works in default mode without an API key', async () => {
    const projectPath = tmp.path;
    const sessionId = 'sess-no-key';
    const logFile = path.join(
      tmp.path,
      'projects',
      encodeProjectPath(tmp.path),
      `${sessionId}.jsonl`,
    );
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    writeJsonl(logFile, [{ type: 'system', uuid: 's0' }]);

    const { status, data } = await fetchJson(port, 'POST', '/watch', {
      projectPath,
      sessionId,
    });
    expect(status).toBe(200);
    const response = data as {
      status: string;
      extractionMode?: string;
      error?: string;
    };
    expect(response.status).toBe('idle');
    expect(response.extractionMode).toBe('default');
    expect(response.error).toBeUndefined();
    expect(
      fs.existsSync(path.join(tmp.path, 'snapshots', `${sessionId}.json`)),
    ).toBe(false);
  });

  it('reports a missing API key when switching to progress-tree mode', async () => {
    const watch = await fetchJson(port, 'POST', '/watch', {
      projectPath: '/tmp',
      sessionId: 'sess-no-key-progress',
    });
    expect(watch.status).toBe(200);

    const { status, data } = await fetchJson(port, 'POST', '/mode', {
      sessionId: 'sess-no-key-progress',
      mode: 'progress-tree',
    });
    expect(status).toBe(200);
    const response = data as { status: string; error?: string };
    expect(response.status).toBe('error');
    expect(response.error).toMatch(/Missing API key/);
  });
});

describe('ProgressServer debug endpoint', () => {
  let server: ProgressServer;
  let port: number;
  let tmp: ReturnType<typeof createTempDir>;

  beforeAll(async () => {
    tmp = createTempDir();
    server = new ProgressServer({
      config: makeConfig(),
      projectsDir: path.join(tmp.path, 'projects'),
      snapshotDir: path.join(tmp.path, 'snapshots'),
    });
    const result = await server.start();
    port = result.port;
  });

  afterAll(async () => {
    await server.stop();
    tmp.cleanup();
  });

  it('returns diagnostic info', async () => {
    const projectPath = tmp.path;
    const sessionId = 'debug-sess';
    const encoded = encodeProjectPath(tmp.path);
    const logFile = path.join(tmp.path, 'projects', encoded, `${sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    writeJsonl(logFile, [{ type: 'system', uuid: 's0' }]);

    await fetchJson(port, 'POST', '/watch', { projectPath, sessionId });
    const { status, data } = await fetchJson(port, 'GET', '/debug');
    expect(status).toBe(200);
    const debug = data as Record<string, unknown>;
    expect(debug.projectPath).toBe(projectPath);
    expect(debug.sessionId).toBe(sessionId);
    expect(debug.apiKeyConfigured).toBe(true);
    expect(debug.logExists).toBe(true);
  });

  it('reports missing log file', async () => {
    const { status, data } = await fetchJson(port, 'POST', '/watch', {
      projectPath: '/nonexistent/project',
      sessionId: 'missing-log',
    });
    expect(status).toBe(200);
    const response = data as { status: string; error?: string };
    expect(response.status).toBe('error');
    expect(response.error).toMatch(/Session log not found/);
  });
});
