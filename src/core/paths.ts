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

export interface SessionLogResolutionOptions {
  projectsDir?: string;
  cloudcliDbPath?: string;
  codexHome?: string;
  claudeSessionsDir?: string;
}

export interface ClaudeLogResolutionOptions {
  projectsDir?: string;
  sessionsDir?: string;
  knownLogPath?: string;
}

export interface CodexLogResolutionOptions {
  codexHome?: string;
  knownLogPath?: string;
}

interface NormalizedResolutionOptions {
  projectsDir: string;
  cloudcliDbPath: string;
  codexHome: string;
  claudeSessionsDir: string;
}

export function resolveLogPath(
  projectPath: string,
  sessionId: string,
  projectsDir = path.join(os.homedir(), '.claude', 'projects'),
): string {
  const encoded = encodeProjectPath(projectPath);
  return path.join(projectsDir, encoded, `${sessionId}.jsonl`);
}

function normalizeOptions(
  options: string | SessionLogResolutionOptions = {},
): NormalizedResolutionOptions {
  if (typeof options === 'string') {
    return normalizeOptions({ projectsDir: options });
  }
  const home = os.homedir();
  return {
    projectsDir: options.projectsDir ?? path.join(home, '.claude', 'projects'),
    cloudcliDbPath:
      options.cloudcliDbPath ??
      process.env.DATABASE_PATH ??
      path.join(home, '.cloudcli', 'auth.db'),
    codexHome: options.codexHome ?? path.join(home, '.codex'),
    claudeSessionsDir:
      options.claudeSessionsDir ?? path.join(home, '.claude', 'sessions'),
  };
}

function projectDir(projectPath: string, projectsDir: string): string {
  return path.join(projectsDir, encodeProjectPath(projectPath));
}

function existingLogPath(logPath: string | undefined): string | undefined {
  return logPath && fs.existsSync(logPath) ? logPath : undefined;
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
    // Ignore malformed metadata files.
  }
  return undefined;
}

function findActiveSessionForProject(
  projectPath: string,
  sessionsDir: string,
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

interface CloudCliSessionMapping {
  provider: LogProvider;
  providerSessionId: string;
  jsonlPath?: string;
}

async function resolveFromCloudCliDatabase(
  cloudcliSessionId: string,
  dbPath: string,
): Promise<CloudCliSessionMapping | undefined> {
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
      if (!row?.provider_session_id) return undefined;
      return {
        provider: row.provider === 'codex' ? 'codex' : 'claude',
        providerSessionId: row.provider_session_id,
        jsonlPath: row.jsonl_path ?? undefined,
      };
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

function findCodexRollout(
  sessionId: string,
  codexHome: string,
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
  codexHome: string,
): Promise<string | undefined> {
  try {
    const DatabaseSync = databaseSync();
    const db = new DatabaseSync(path.join(codexHome, 'state_5.sqlite'), { readOnly: true });
    try {
      const row = db
        .prepare('SELECT rollout_path FROM threads WHERE id = ? LIMIT 1')
        .get(sessionId) as { rollout_path?: string | null } | undefined;
      return existingLogPath(row?.rollout_path ?? undefined);
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

export async function resolveCodexSessionLogPath(
  sessionId: string,
  options: CodexLogResolutionOptions = {},
): Promise<ResolvedLogPath | undefined> {
  const codexHome =
    options.codexHome ?? path.join(os.homedir(), '.codex');
  const logPath =
    existingLogPath(options.knownLogPath) ??
    (await resolveCodexFromStateDb(sessionId, codexHome)) ??
    findCodexRollout(sessionId, codexHome);
  if (!logPath) return undefined;
  return { logPath, realSessionId: sessionId, provider: 'codex' };
}

function resolveExactClaudeLogPath(
  projectPath: string,
  sessionId: string,
  projectsDir: string,
): ResolvedLogPath | undefined {
  const exactPath = existingLogPath(resolveLogPath(projectPath, sessionId, projectsDir));
  if (!exactPath) return undefined;
  return { logPath: exactPath, realSessionId: sessionId, provider: 'claude' };
}

export function resolveClaudeSessionLogPath(
  projectPath: string,
  sessionId: string,
  options: ClaudeLogResolutionOptions = {},
): ResolvedLogPath | undefined {
  const projectsDir =
    options.projectsDir ?? path.join(os.homedir(), '.claude', 'projects');
  const sessionsDir =
    options.sessionsDir ?? path.join(os.homedir(), '.claude', 'sessions');

  const knownPath = existingLogPath(options.knownLogPath);
  if (knownPath) {
    return { logPath: knownPath, realSessionId: sessionId, provider: 'claude' };
  }

  const exact = resolveExactClaudeLogPath(projectPath, sessionId, projectsDir);
  if (exact) return exact;

  const activeSessionId = findActiveSessionForProject(projectPath, sessionsDir);
  if (activeSessionId) {
    const activePath = existingLogPath(
      resolveLogPath(projectPath, activeSessionId, projectsDir),
    );
    if (activePath) {
      return {
        logPath: activePath,
        realSessionId: activeSessionId,
        provider: 'claude',
      };
    }
  }

  const latestPath = findLatestJsonl(projectPath, projectsDir);
  if (latestPath) {
    return {
      logPath: latestPath,
      realSessionId: path.basename(latestPath, '.jsonl'),
      provider: 'claude',
    };
  }

  return undefined;
}

export async function resolveSessionLogPath(
  projectPath: string,
  cloudcliSessionId: string,
  options: string | SessionLogResolutionOptions = {},
): Promise<ResolvedLogPath> {
  const opts = normalizeOptions(options);
  const mapping = await resolveFromCloudCliDatabase(
    cloudcliSessionId,
    opts.cloudcliDbPath,
  );

  if (mapping) {
    if (mapping.provider === 'codex') {
      const resolved = await resolveCodexSessionLogPath(
        mapping.providerSessionId,
        {
          codexHome: opts.codexHome,
          knownLogPath: mapping.jsonlPath,
        },
      );
      return (
        resolved ?? {
          logPath: mapping.jsonlPath ?? '',
          realSessionId: mapping.providerSessionId,
          provider: 'codex',
        }
      );
    }

    const resolved = resolveClaudeSessionLogPath(
      projectPath,
      mapping.providerSessionId,
      {
        projectsDir: opts.projectsDir,
        sessionsDir: opts.claudeSessionsDir,
        knownLogPath: mapping.jsonlPath,
      },
    );
    return (
      resolved ?? {
        logPath:
          mapping.jsonlPath ??
          resolveLogPath(projectPath, mapping.providerSessionId, opts.projectsDir),
        realSessionId: mapping.providerSessionId,
        provider: 'claude',
      }
    );
  }

  const exactClaude = resolveExactClaudeLogPath(
    projectPath,
    cloudcliSessionId,
    opts.projectsDir,
  );
  if (exactClaude) return exactClaude;

  // Preserve direct Codex IDs for callers that bypass the CloudCLI mapping.
  const directCodex = await resolveCodexSessionLogPath(cloudcliSessionId, {
    codexHome: opts.codexHome,
  });
  if (directCodex) return directCodex;

  return (
    resolveClaudeSessionLogPath(projectPath, cloudcliSessionId, {
      projectsDir: opts.projectsDir,
      sessionsDir: opts.claudeSessionsDir,
    }) ?? {
      logPath: resolveLogPath(projectPath, cloudcliSessionId, opts.projectsDir),
      realSessionId: cloudcliSessionId,
      provider: 'claude',
    }
  );
}
