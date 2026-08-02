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
    // Prefer sessions with recent activity; idle/waiting are active, completed/stopped are not.
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

export function resolveSessionLogPath(
  projectPath: string,
  cloudcliSessionId: string,
  projectsDir = path.join(os.homedir(), '.claude', 'projects'),
): ResolvedLogPath {
  const exactPath = resolveLogPath(projectPath, cloudcliSessionId, projectsDir);
  if (fs.existsSync(exactPath)) {
    return { logPath: exactPath, realSessionId: cloudcliSessionId };
  }

  // CloudCLI may present a stale session ID. Find the actually active Claude Code
  // session for this project via ~/.claude/sessions/*.json metadata.
  const activeSessionId = findActiveSessionForProject(projectPath);
  if (activeSessionId) {
    const activePath = resolveLogPath(projectPath, activeSessionId, projectsDir);
    if (fs.existsSync(activePath)) {
      return { logPath: activePath, realSessionId: activeSessionId };
    }
  }

  const latestPath = findLatestJsonl(projectPath, projectsDir);
  if (latestPath) {
    return {
      logPath: latestPath,
      realSessionId: path.basename(latestPath, '.jsonl'),
    };
  }

  return { logPath: exactPath, realSessionId: cloudcliSessionId };
}
