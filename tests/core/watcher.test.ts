 import { describe, expect, it } from 'vitest';
 import fs from 'node:fs';
 import path from 'node:path';
import { FileLogWatcher } from '../../src/core/watcher.js';
import type { LogEntry } from '../../src/core/types.js';
import { appendJsonl, createTempDir, wait, writeJsonl } from '../utils.js';
import { resolveLogPath } from '../../src/core/paths.js';

function logPath(tmp: string, sessionId: string): string {
  return resolveLogPath(tmp, sessionId, path.join(tmp, 'projects'));
}

 describe('FileLogWatcher', () => {
   it('reads existing lines on start', async () => {
     const tmp = createTempDir();
     const sessionId = 'sess-1';
     const file = logPath(tmp.path, sessionId);
     fs.mkdirSync(path.dirname(file), { recursive: true });
     writeJsonl(file, [
       { type: 'assistant', uuid: 'u1', content: [{ type: 'text', text: 'hi' }] },
     ]);

     const watcher = new FileLogWatcher({
       watchImpl: 'watchFile',
       pollInterval: 100,
       projectsDir: path.join(tmp.path, 'projects'),
     });
     const lines: LogEntry[] = [];
     watcher.onLine((e) => lines.push(e));
     await watcher.start(tmp.path, sessionId);
     await wait(300);
     expect(lines.length).toBe(1);
     expect(lines[0].type).toBe('assistant');
     watcher.stop();
     tmp.cleanup();
   });

   it('emits new lines appended after start', async () => {
     const tmp = createTempDir();
     const sessionId = 'sess-2';
     const file = logPath(tmp.path, sessionId);
     fs.mkdirSync(path.dirname(file), { recursive: true });
     writeJsonl(file, [{ type: 'system', uuid: 'u0' }]);

     const watcher = new FileLogWatcher({
       watchImpl: 'watchFile',
       pollInterval: 100,
       projectsDir: path.join(tmp.path, 'projects'),
     });
     const lines: LogEntry[] = [];
     watcher.onLine((e) => lines.push(e));
     await watcher.start(tmp.path, sessionId);
     await wait(300);
    lines.length = 0;

    appendJsonl(file, [{ type: 'user', uuid: 'u2', content: [{ type: 'text', text: 'hello' }] }]);
    await wait(500);
    expect(lines.length).toBe(1);
     expect(lines[0].type).toBe('user');
     watcher.stop();
     tmp.cleanup();
   });

   it('handles file replacement', async () => {
     const tmp = createTempDir();
     const sessionId = 'sess-3';
     const file = logPath(tmp.path, sessionId);
     fs.mkdirSync(path.dirname(file), { recursive: true });
     writeJsonl(file, [
       { type: 'assistant', uuid: 'old1' },
       { type: 'assistant', uuid: 'old2' },
     ]);

     const watcher = new FileLogWatcher({
       watchImpl: 'watchFile',
       pollInterval: 100,
       projectsDir: path.join(tmp.path, 'projects'),
     });
     const lines: LogEntry[] = [];
     watcher.onLine((e) => lines.push(e));
     await watcher.start(tmp.path, sessionId);
     await wait(300);
     lines.length = 0;

     fs.writeFileSync(file, JSON.stringify({ type: 'mode', uuid: 'new1' }) + '\n', 'utf-8');
     await wait(400);
     expect(lines.length).toBe(1);
     expect(lines[0].type).toBe('mode');
     watcher.stop();
     tmp.cleanup();
   });

   it('stops emitting after stop is called', async () => {
     const tmp = createTempDir();
     const sessionId = 'sess-4';
     const file = logPath(tmp.path, sessionId);
     fs.mkdirSync(path.dirname(file), { recursive: true });
     writeJsonl(file, [{ type: 'system', uuid: 'u0' }]);

     const watcher = new FileLogWatcher({
       watchImpl: 'watchFile',
       pollInterval: 100,
       projectsDir: path.join(tmp.path, 'projects'),
     });
     const lines: LogEntry[] = [];
     watcher.onLine((e) => lines.push(e));
     await watcher.start(tmp.path, sessionId);
     await wait(300);
     watcher.stop();
     lines.length = 0;

     writeJsonl(file, [{ type: 'user', uuid: 'u5' }]);
     await wait(400);
     expect(lines.length).toBe(0);
     tmp.cleanup();
   });

   it('reports cursor position', async () => {
     const tmp = createTempDir();
     const sessionId = 'sess-5';
     const file = logPath(tmp.path, sessionId);
     fs.mkdirSync(path.dirname(file), { recursive: true });
     const entries = [
       { type: 'assistant', uuid: 'a1' },
       { type: 'assistant', uuid: 'a2' },
     ];
     writeJsonl(file, entries);

     const watcher = new FileLogWatcher({
       watchImpl: 'watchFile',
       pollInterval: 100,
       projectsDir: path.join(tmp.path, 'projects'),
     });
     watcher.onLine(() => {});
     await watcher.start(tmp.path, sessionId);
     await wait(300);
     const cursor = watcher.getCursor();
     expect(cursor.lastLine).toBe(2);
     expect(cursor.bytesRead).toBe(fs.statSync(file).size);
     watcher.stop();
     tmp.cleanup();
   });
 });
