import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { LogProvider } from './types.js';

const require = createRequire(import.meta.url);

function databaseSync(): typeof import('node:sqlite').DatabaseSync {
  return require('node:sqlite').DatabaseSync;
}

export function encodeProjectPath(projectPath: string): string {
  if (projectPath === '/') return '-';
  const trimmed = projectPath.replace(/\/$/, '');
  if (trimmed === '') return '';
  return trimmed.replace(/^\//, '-').replace(/\//g, '-');
}

export interface ResolvedLogPath {
  logPath: string;
  realSessionId: string;
  provider: LogProvider;
}

export function resolveLogPath(
  projectPath: string,
  sessionId: string,
  projectsDir = path.join(os.homedir(), '.claude', 'projects'),
): string {
  const encoded = encodeProjectPath(projectPath);
  return path.join(projectsDir, encoded, `${sessionId}.jsonl`);
}

function projectDir(projectPath: string, projectsDir: string): string {
  return path.join(projectsDir, encodeProjectPath(projectPath));
}

function findLatestJsonl(projectPath: string, projectsDir: string): string | undefined {
  const dir = projectDir(projectPath, projectsDir);
  try {
    const entries = fs.readdirSync(dir);
    const files = entries
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => {
        const fullPath = path.join(dir, name);
        return { name, fullPath, mtime: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.fullPath;
  } catch {
    return undefined;
  }
}

interface SessionMetadata {
  pid: number;
  sessionId: string;
  cwd: string;
  updatedAt?: number;
  status?: string;
}

function readSessionMetadata(filePath: string): SessionMetadata | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as SessionMetadata;
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.cwd === 'string'
    ) {
      return parsed;
    }
  } catch {
    // ignore malformed files
  }
  return undefined;
}

function findActiveSessionForProject(
  projectPath: string,
  sessionsDir = path.join(os.homedir(), '.claude', 'sessions'),
): string | undefined {
  try {
    const entries = fs.readdirSync(sessionsDir);
    const matches: SessionMetadata[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const meta = readSessionMetadata(path.join(sessionsDir, name));
      if (meta && meta.cwd === projectPath) {
        matches.push(meta);
      }
    }
    if (matches.length === 0) return undefined;
    const activeStatuses = new Set(['idle', 'waiting', 'running', 'active']);
    matches.sort((a, b) => {
      const aActive = activeStatuses.has(a.status ?? '') ? 1 : 0;
      const bActive = activeStatuses.has(b.status ?? '') ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
    return matches[0]?.sessionId;
  } catch {
    return undefined;
  }
}

interface CloudCliSessionRow {
  provider?: string;
  provider_session_id?: string;
  jsonl_path?: string;
}

async function resolveFromCloudCliDatabase(
  cloudcliSessionId: string,
  dbPath = process.env.DATABASE_PATH ?? path.join(os.homedir(), '.cloudcli', 'auth.db'),
): Promise<CloudCliSessionRow | undefined> {
  try {
    const DatabaseSync = databaseSync();
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const stmt = db.prepare(
        'SELECT provider, provider_session_id, jsonl_path FROM sessions WHERE session_id = ? LIMIT 1',
      );
      const row = stmt.get(cloudcliSessionId) as
        | {
            provider?: string | null;
            provider_session_id?: string | null;
            jsonl_path?: string | null;
          }
        | undefined;
      if (!row) return undefined;
      return {
        provider: row.provider ?? undefined,
        provider_session_id: row.provider_session_id ?? undefined,
        jsonl_path: row.jsonl_path ?? undefined,
      };
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

function findFiles(dir: string): string[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? findFiles(fullPath) : [fullPath];
    });
  } catch {
    return [];
  }
}

function findCodexRollout(
  sessionId: string,
  codexHome = path.join(os.homedir(), '.codex'),
): string | undefined {
  for (const dir of [
    path.join(codexHome, 'sessions'),
    path.join(codexHome, 'archived_sessions'),
  ]) {
    const match = findFiles(dir).find((file) => file.endsWith(`${sessionId}.jsonl`));
    if (match && fs.existsSync(match)) return match;
  }
  return undefined;
}

async function resolveCodexFromStateDb(
  sessionId: string,
  codexHome = path.join(os.homedir(), '.codex'),
): Promise<string | undefined> {
  try {
    const DatabaseSync = databaseSync();
    const db = new DatabaseSync(path.join(codexHome, 'state_5.sqlite'), { readOnly: true });
    try {
      const row = db
        .prepare('SELECT rollout_path FROM threads WHERE id = ? LIMIT 1')
        .get(sessionId) as { rollout_path?: string | null } | undefined;
      const rolloutPath = row?.rollout_path;
      return rolloutPath && fs.existsSync(rolloutPath) ? rolloutPath : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

async function resolveCodexSessionLogPath(
  sessionId: string,
): Promise<ResolvedLogPath | undefined> {
  const logPath =
    (await resolveCodexFromStateDb(sessionId)) ?? findCodexRollout(sessionId);
  if (!logPath) return undefined;
  return { logPath, realSessionId: sessionId, provider: 'codex' };
}

export async function resolveSessionLogPath(
  projectPath: string,
  cloudcliSessionId: string,
  projectsDir = path.join(os.homedir(), '.claude', 'projects'),
): Promise<ResolvedLogPath> {
  const exactPath = resolveLogPath(projectPath, cloudcliSessionId, projectsDir);
  if (fs.existsSync(exactPath)) {
    return { logPath: exactPath, realSessionId: cloudcliSessionId, provider: 'claude' };
  }

  // CloudCLI maintains a SQLite mapping from app-facing session_id to
  // provider-native session_id and jsonl_path. Use it when available.
  const dbRow = await resolveFromCloudCliDatabase(cloudcliSessionId);
  if (dbRow?.provider_session_id) {
    const realSessionId = dbRow.provider_session_id;
    const provider: LogProvider = dbRow.provider === 'codex' ? 'codex' : 'claude';
    const logPath: string | undefined =
      dbRow.jsonl_path && fs.existsSync(dbRow.jsonl_path)
        ? dbRow.jsonl_path
        : provider === 'codex'
          ? (await resolveCodexSessionLogPath(realSessionId))?.logPath
          : resolveLogPath(projectPath, realSessionId, projectsDir);
    if (logPath && fs.existsSync(logPath)) {
      return { logPath, realSessionId, provider };
    }
  }

  const codexResolved = await resolveCodexSessionLogPath(cloudcliSessionId);
  if (codexResolved) return codexResolved;

  // Fallback: scan Claude Code CLI PID metadata to find an active session for
  // the same project.
  const activeSessionId = findActiveSessionForProject(projectPath);
  if (activeSessionId) {
    const activePath = resolveLogPath(projectPath, activeSessionId, projectsDir);
    if (fs.existsSync(activePath)) {
      return { logPath: activePath, realSessionId: activeSessionId, provider: 'claude' };
    }
  }

  // Last resort: use the most recently modified jsonl in the project dir.
  const latestPath = findLatestJsonl(projectPath, projectsDir);
  if (latestPath) {
    return {
      logPath: latestPath,
      realSessionId: path.basename(latestPath, '.jsonl'),
      provider: 'claude',
    };
  }

  return { logPath: exactPath, realSessionId: cloudcliSessionId, provider: 'claude' };
}
