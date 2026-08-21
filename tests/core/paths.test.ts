 import { afterEach, describe, expect, it, vi } from 'vitest';
 import fs from 'node:fs';
 import { createRequire } from 'node:module';
 import path from 'node:path';
import {
  encodeProjectPath,
  resolveClaudeSessionLogPath,
  resolveCodexSessionLogPath,
  resolveLogPath,
  resolveSessionLogPath,
} from '../../src/core/paths.js';
 import os from 'node:os';
 import { createTempDir } from '../utils.js';

 const require = createRequire(import.meta.url);

 afterEach(() => {
   vi.unstubAllEnvs();
 });

 describe('encodeProjectPath', () => {
   it('encodes a typical macOS project path', () => {
     expect(encodeProjectPath('/Users/ray/Workspace/claude-plugin-progress')).toBe(
       '-Users-ray-Workspace-claude-plugin-progress',
     );
   });

   it('strips a trailing slash', () => {
     expect(encodeProjectPath('/Users/ray/project/')).toBe('-Users-ray-project');
   });

   it('encodes the root path', () => {
     expect(encodeProjectPath('/')).toBe('-');
   });
 });

 describe('resolveLogPath', () => {
   it('resolves the log file for a project and session', () => {
     const logPath = resolveLogPath(
       '/Users/ray/Workspace/claude-plugin-progress',
       'dd8bf863-5418-431e-b636-78b1e97e512f',
     );
     expect(logPath).toBe(
       pathJoin(os.homedir(), '.claude/projects/-Users-ray-Workspace-claude-plugin-progress/dd8bf863-5418-431e-b636-78b1e97e512f.jsonl'),
     );
   });
 });

 describe('resolveSessionLogPath', () => {
   it('returns the claude provider for an exact Claude log path', async () => {
     const tmp = createTempDir();
     const projectsDir = path.join(tmp.path, 'projects');
     const logPath = resolveLogPath('/project', 'claude-session', projectsDir);
     fs.mkdirSync(path.dirname(logPath), { recursive: true });
     fs.writeFileSync(logPath, '{}\n', 'utf-8');

     const resolved = await resolveSessionLogPath(
       '/project',
       'claude-session',
       projectsDir,
     );
     expect(resolved).toEqual({
       logPath,
       realSessionId: 'claude-session',
       provider: 'claude',
     });
     tmp.cleanup();
   });

  it('uses the CloudCLI codex mapping and returns a rollout path', async () => {
     const tmp = createTempDir();
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
     fs.writeFileSync(rolloutPath, '{}\n', 'utf-8');
     db.prepare(
       'INSERT INTO sessions(session_id, provider, provider_session_id, jsonl_path) VALUES (?, ?, ?, ?)',
     ).run('cloud-session', 'codex', 'codex-thread', rolloutPath);
     db.close();
     vi.stubEnv('DATABASE_PATH', dbPath);

     const resolved = await resolveSessionLogPath(
       '/project',
       'cloud-session',
       path.join(tmp.path, 'claude-projects'),
     );
    expect(resolved).toEqual({
      logPath: rolloutPath,
      realSessionId: 'codex-thread',
      provider: 'codex',
    });
    tmp.cleanup();
  });

  it('keeps the CloudCLI codex mapping authoritative over a same-named Claude log', async () => {
    const tmp = createTempDir();
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
    const claudeProjectsDir = path.join(tmp.path, 'claude-projects');
    const claudeLogPath = resolveLogPath('/project', 'cloud-session', claudeProjectsDir);
    fs.mkdirSync(path.dirname(claudeLogPath), { recursive: true });
    fs.writeFileSync(claudeLogPath, '{}\n', 'utf-8');

    const rolloutPath = path.join(tmp.path, 'codex', 'rollout.jsonl');
    fs.mkdirSync(path.dirname(rolloutPath), { recursive: true });
    fs.writeFileSync(rolloutPath, '{}\n', 'utf-8');
    db.prepare(
      'INSERT INTO sessions(session_id, provider, provider_session_id, jsonl_path) VALUES (?, ?, ?, ?)',
    ).run('cloud-session', 'codex', 'codex-thread', rolloutPath);
    db.close();
    vi.stubEnv('DATABASE_PATH', dbPath);

    const resolved = await resolveSessionLogPath(
      '/project',
      'cloud-session',
      claudeProjectsDir,
    );
    expect(resolved).toEqual({
      logPath: rolloutPath,
      realSessionId: 'codex-thread',
      provider: 'codex',
    });
    tmp.cleanup();
  });

  it('routes a CloudCLI claude mapping through the Claude resolver', async () => {
    const tmp = createTempDir();
    const projectsDir = path.join(tmp.path, 'claude-projects');
    const realSessionId = 'real-claude-session';
    const logPath = resolveLogPath('/project', realSessionId, projectsDir);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, '{}\n', 'utf-8');

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
    db.prepare(
      'INSERT INTO sessions(session_id, provider, provider_session_id, jsonl_path) VALUES (?, ?, ?, ?)',
    ).run('cloud-session', 'claude', realSessionId, null);
    db.close();
    vi.stubEnv('DATABASE_PATH', dbPath);

    const resolved = await resolveSessionLogPath(
      '/project',
      'cloud-session',
      projectsDir,
    );
    expect(resolved).toEqual({
      logPath,
      realSessionId,
      provider: 'claude',
    });
    tmp.cleanup();
  });
});

describe('provider-specific log resolvers', () => {
  it('resolves Codex through the Codex state database', async () => {
    const tmp = createTempDir();
    const codexHome = path.join(tmp.path, 'codex');
    const rolloutPath = path.join(tmp.path, 'rollouts', 'codex-thread.jsonl');
    fs.mkdirSync(path.dirname(rolloutPath), { recursive: true });
    fs.writeFileSync(rolloutPath, '{}\n', 'utf-8');
    fs.mkdirSync(codexHome, { recursive: true });

    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(codexHome, 'state_5.sqlite'));
    db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)');
    db.prepare('INSERT INTO threads(id, rollout_path) VALUES (?, ?)').run(
      'codex-thread',
      rolloutPath,
    );
    db.close();

    const resolved = await resolveCodexSessionLogPath('codex-thread', { codexHome });
    expect(resolved).toEqual({
      logPath: rolloutPath,
      realSessionId: 'codex-thread',
      provider: 'codex',
    });
    tmp.cleanup();
  });

  it('does not let the Codex resolver fall back to Claude project logs', async () => {
    const tmp = createTempDir();
    const codexHome = path.join(tmp.path, 'codex');
    fs.mkdirSync(codexHome, { recursive: true });
    const projectsDir = path.join(tmp.path, 'claude-projects');
    const claudeLog = resolveLogPath('/project', 'codex-thread', projectsDir);
    fs.mkdirSync(path.dirname(claudeLog), { recursive: true });
    fs.writeFileSync(claudeLog, '{}\n', 'utf-8');

    await expect(
      resolveCodexSessionLogPath('codex-thread', { codexHome }),
    ).resolves.toBeUndefined();
    expect(resolveClaudeSessionLogPath('/project', 'codex-thread', { projectsDir })).toEqual({
      logPath: claudeLog,
      realSessionId: 'codex-thread',
      provider: 'claude',
    });
    tmp.cleanup();
  });
});

 function osPath(...segments: string[]): string {
   // Use POSIX separators for expectations; implementation should also use POSIX separators.
   return segments.join('/');
 }

 function pathJoin(a: string, b: string): string {
   return a.replace(/\/$/, '') + '/' + b;
 }
