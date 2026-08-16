import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
function databaseSync() {
    return require('node:sqlite').DatabaseSync;
}
export function encodeProjectPath(projectPath) {
    if (projectPath === '/')
        return '-';
    const trimmed = projectPath.replace(/\/$/, '');
    if (trimmed === '')
        return '';
    return trimmed.replace(/^\//, '-').replace(/\//g, '-');
}
export function resolveLogPath(projectPath, sessionId, projectsDir = path.join(os.homedir(), '.claude', 'projects')) {
    const encoded = encodeProjectPath(projectPath);
    return path.join(projectsDir, encoded, `${sessionId}.jsonl`);
}
function projectDir(projectPath, projectsDir) {
    return path.join(projectsDir, encodeProjectPath(projectPath));
}
function findLatestJsonl(projectPath, projectsDir) {
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
    }
    catch {
        return undefined;
    }
}
function readSessionMetadata(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.pid === 'number' &&
            typeof parsed.sessionId === 'string' &&
            typeof parsed.cwd === 'string') {
            return parsed;
        }
    }
    catch {
        // ignore malformed files
    }
    return undefined;
}
function findActiveSessionForProject(projectPath, sessionsDir = path.join(os.homedir(), '.claude', 'sessions')) {
    try {
        const entries = fs.readdirSync(sessionsDir);
        const matches = [];
        for (const name of entries) {
            if (!name.endsWith('.json'))
                continue;
            const meta = readSessionMetadata(path.join(sessionsDir, name));
            if (meta && meta.cwd === projectPath) {
                matches.push(meta);
            }
        }
        if (matches.length === 0)
            return undefined;
        const activeStatuses = new Set(['idle', 'waiting', 'running', 'active']);
        matches.sort((a, b) => {
            const aActive = activeStatuses.has(a.status ?? '') ? 1 : 0;
            const bActive = activeStatuses.has(b.status ?? '') ? 1 : 0;
            if (aActive !== bActive)
                return bActive - aActive;
            return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        });
        return matches[0]?.sessionId;
    }
    catch {
        return undefined;
    }
}
async function resolveFromCloudCliDatabase(cloudcliSessionId, dbPath = process.env.DATABASE_PATH ?? path.join(os.homedir(), '.cloudcli', 'auth.db')) {
    try {
        const DatabaseSync = databaseSync();
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
            const stmt = db.prepare('SELECT provider, provider_session_id, jsonl_path FROM sessions WHERE session_id = ? LIMIT 1');
            const row = stmt.get(cloudcliSessionId);
            if (!row)
                return undefined;
            return {
                provider: row.provider ?? undefined,
                provider_session_id: row.provider_session_id ?? undefined,
                jsonl_path: row.jsonl_path ?? undefined,
            };
        }
        finally {
            db.close();
        }
    }
    catch {
        return undefined;
    }
}
function findFiles(dir) {
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries.flatMap((entry) => {
            const fullPath = path.join(dir, entry.name);
            return entry.isDirectory() ? findFiles(fullPath) : [fullPath];
        });
    }
    catch {
        return [];
    }
}
function findCodexRollout(sessionId, codexHome = path.join(os.homedir(), '.codex')) {
    for (const dir of [
        path.join(codexHome, 'sessions'),
        path.join(codexHome, 'archived_sessions'),
    ]) {
        const match = findFiles(dir).find((file) => file.endsWith(`${sessionId}.jsonl`));
        if (match && fs.existsSync(match))
            return match;
    }
    return undefined;
}
async function resolveCodexFromStateDb(sessionId, codexHome = path.join(os.homedir(), '.codex')) {
    try {
        const DatabaseSync = databaseSync();
        const db = new DatabaseSync(path.join(codexHome, 'state_5.sqlite'), { readOnly: true });
        try {
            const row = db
                .prepare('SELECT rollout_path FROM threads WHERE id = ? LIMIT 1')
                .get(sessionId);
            const rolloutPath = row?.rollout_path;
            return rolloutPath && fs.existsSync(rolloutPath) ? rolloutPath : undefined;
        }
        finally {
            db.close();
        }
    }
    catch {
        return undefined;
    }
}
async function resolveCodexSessionLogPath(sessionId) {
    const logPath = (await resolveCodexFromStateDb(sessionId)) ?? findCodexRollout(sessionId);
    if (!logPath)
        return undefined;
    return { logPath, realSessionId: sessionId, provider: 'codex' };
}
export async function resolveSessionLogPath(projectPath, cloudcliSessionId, projectsDir = path.join(os.homedir(), '.claude', 'projects')) {
    const exactPath = resolveLogPath(projectPath, cloudcliSessionId, projectsDir);
    if (fs.existsSync(exactPath)) {
        return { logPath: exactPath, realSessionId: cloudcliSessionId, provider: 'claude' };
    }
    // CloudCLI maintains a SQLite mapping from app-facing session_id to
    // provider-native session_id and jsonl_path. Use it when available.
    const dbRow = await resolveFromCloudCliDatabase(cloudcliSessionId);
    if (dbRow?.provider_session_id) {
        const realSessionId = dbRow.provider_session_id;
        const provider = dbRow.provider === 'codex' ? 'codex' : 'claude';
        const logPath = dbRow.jsonl_path && fs.existsSync(dbRow.jsonl_path)
            ? dbRow.jsonl_path
            : provider === 'codex'
                ? (await resolveCodexSessionLogPath(realSessionId))?.logPath
                : resolveLogPath(projectPath, realSessionId, projectsDir);
        if (logPath && fs.existsSync(logPath)) {
            return { logPath, realSessionId, provider };
        }
    }
    const codexResolved = await resolveCodexSessionLogPath(cloudcliSessionId);
    if (codexResolved)
        return codexResolved;
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
//# sourceMappingURL=paths.js.map