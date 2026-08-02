import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function encodeProjectPath(projectPath: string): string {
  if (projectPath === '/') return '-';
  const trimmed = projectPath.replace(/\/$/, '');
  if (trimmed === '') return '';
  return trimmed.replace(/^\//, '-').replace(/\//g, '-');
}

export interface ResolvedLogPath {
  logPath: string;
  realSessionId: string;
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
  provider_session_id?: string;
  jsonl_path?: string;
}

async function resolveFromCloudCliDatabase(
  cloudcliSessionId: string,
  dbPath = process.env.DATABASE_PATH ?? path.join(os.homedir(), '.cloudcli', 'auth.db'),
): Promise<CloudCliSessionRow | undefined> {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const stmt = db.prepare(
        'SELECT provider_session_id, jsonl_path FROM sessions WHERE session_id = ? LIMIT 1',
      );
      const row = stmt.get(cloudcliSessionId) as
        | { provider_session_id?: string | null; jsonl_path?: string | null }
        | undefined;
      if (!row) return undefined;
      return {
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

export async function resolveSessionLogPath(
  projectPath: string,
  cloudcliSessionId: string,
  projectsDir = path.join(os.homedir(), '.claude', 'projects'),
): Promise<ResolvedLogPath> {
  const exactPath = resolveLogPath(projectPath, cloudcliSessionId, projectsDir);
  if (fs.existsSync(exactPath)) {
    return { logPath: exactPath, realSessionId: cloudcliSessionId };
  }

  // CloudCLI maintains a SQLite mapping from app-facing session_id to
  // provider-native session_id and jsonl_path. Use it when available.
  const dbRow = await resolveFromCloudCliDatabase(cloudcliSessionId);
  if (dbRow?.provider_session_id) {
    const realSessionId = dbRow.provider_session_id;
    const logPath = dbRow.jsonl_path ?? resolveLogPath(projectPath, realSessionId, projectsDir);
    if (fs.existsSync(logPath)) {
      return { logPath, realSessionId };
    }
  }

  // Fallback: scan Claude Code CLI PID metadata to find an active session for
  // the same project.
  const activeSessionId = findActiveSessionForProject(projectPath);
  if (activeSessionId) {
    const activePath = resolveLogPath(projectPath, activeSessionId, projectsDir);
    if (fs.existsSync(activePath)) {
      return { logPath: activePath, realSessionId: activeSessionId };
    }
  }

  // Last resort: use the most recently modified jsonl in the project dir.
  const latestPath = findLatestJsonl(projectPath, projectsDir);
  if (latestPath) {
    return {
      logPath: latestPath,
      realSessionId: path.basename(latestPath, '.jsonl'),
    };
  }

  return { logPath: exactPath, realSessionId: cloudcliSessionId };
}
