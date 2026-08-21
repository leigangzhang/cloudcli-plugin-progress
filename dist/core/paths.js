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
function normalizeOptions(options = {}) {
    if (typeof options === 'string') {
        return normalizeOptions({ projectsDir: options });
    }
    const home = os.homedir();
    return {
        projectsDir: options.projectsDir ?? path.join(home, '.claude', 'projects'),
        cloudcliDbPath: options.cloudcliDbPath ??
            process.env.DATABASE_PATH ??
            path.join(home, '.cloudcli', 'auth.db'),
        codexHome: options.codexHome ?? path.join(home, '.codex'),
        claudeSessionsDir: options.claudeSessionsDir ?? path.join(home, '.claude', 'sessions'),
    };
}
function projectDir(projectPath, projectsDir) {
    return path.join(projectsDir, encodeProjectPath(projectPath));
}
function existingLogPath(logPath) {
    return logPath && fs.existsSync(logPath) ? logPath : undefined;
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
        // Ignore malformed metadata files.
    }
    return undefined;
}
function findActiveSessionForProject(projectPath, sessionsDir) {
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
async function resolveFromCloudCliDatabase(cloudcliSessionId, dbPath) {
    try {
        const DatabaseSync = databaseSync();
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
            const stmt = db.prepare('SELECT provider, provider_session_id, jsonl_path FROM sessions WHERE session_id = ? LIMIT 1');
            const row = stmt.get(cloudcliSessionId);
            if (!row?.provider_session_id)
                return undefined;
            return {
                provider: row.provider === 'codex' ? 'codex' : 'claude',
                providerSessionId: row.provider_session_id,
                jsonlPath: row.jsonl_path ?? undefined,
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
function findCodexRollout(sessionId, codexHome) {
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
async function resolveCodexFromStateDb(sessionId, codexHome) {
    try {
        const DatabaseSync = databaseSync();
        const db = new DatabaseSync(path.join(codexHome, 'state_5.sqlite'), { readOnly: true });
        try {
            const row = db
                .prepare('SELECT rollout_path FROM threads WHERE id = ? LIMIT 1')
                .get(sessionId);
            return existingLogPath(row?.rollout_path ?? undefined);
        }
        finally {
            db.close();
        }
    }
    catch {
        return undefined;
    }
}
export async function resolveCodexSessionLogPath(sessionId, options = {}) {
    const codexHome = options.codexHome ?? path.join(os.homedir(), '.codex');
    const logPath = existingLogPath(options.knownLogPath) ??
        (await resolveCodexFromStateDb(sessionId, codexHome)) ??
        findCodexRollout(sessionId, codexHome);
    if (!logPath)
        return undefined;
    return { logPath, realSessionId: sessionId, provider: 'codex' };
}
function resolveExactClaudeLogPath(projectPath, sessionId, projectsDir) {
    const exactPath = existingLogPath(resolveLogPath(projectPath, sessionId, projectsDir));
    if (!exactPath)
        return undefined;
    return { logPath: exactPath, realSessionId: sessionId, provider: 'claude' };
}
export function resolveClaudeSessionLogPath(projectPath, sessionId, options = {}) {
    const projectsDir = options.projectsDir ?? path.join(os.homedir(), '.claude', 'projects');
    const sessionsDir = options.sessionsDir ?? path.join(os.homedir(), '.claude', 'sessions');
    const knownPath = existingLogPath(options.knownLogPath);
    if (knownPath) {
        return { logPath: knownPath, realSessionId: sessionId, provider: 'claude' };
    }
    const exact = resolveExactClaudeLogPath(projectPath, sessionId, projectsDir);
    if (exact)
        return exact;
    const activeSessionId = findActiveSessionForProject(projectPath, sessionsDir);
    if (activeSessionId) {
        const activePath = existingLogPath(resolveLogPath(projectPath, activeSessionId, projectsDir));
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
export async function resolveSessionLogPath(projectPath, cloudcliSessionId, options = {}) {
    const opts = normalizeOptions(options);
    const mapping = await resolveFromCloudCliDatabase(cloudcliSessionId, opts.cloudcliDbPath);
    if (mapping) {
        if (mapping.provider === 'codex') {
            const resolved = await resolveCodexSessionLogPath(mapping.providerSessionId, {
                codexHome: opts.codexHome,
                knownLogPath: mapping.jsonlPath,
            });
            return (resolved ?? {
                logPath: mapping.jsonlPath ?? '',
                realSessionId: mapping.providerSessionId,
                provider: 'codex',
            });
        }
        const resolved = resolveClaudeSessionLogPath(projectPath, mapping.providerSessionId, {
            projectsDir: opts.projectsDir,
            sessionsDir: opts.claudeSessionsDir,
            knownLogPath: mapping.jsonlPath,
        });
        return (resolved ?? {
            logPath: mapping.jsonlPath ??
                resolveLogPath(projectPath, mapping.providerSessionId, opts.projectsDir),
            realSessionId: mapping.providerSessionId,
            provider: 'claude',
        });
    }
    const exactClaude = resolveExactClaudeLogPath(projectPath, cloudcliSessionId, opts.projectsDir);
    if (exactClaude)
        return exactClaude;
    // Preserve direct Codex IDs for callers that bypass the CloudCLI mapping.
    const directCodex = await resolveCodexSessionLogPath(cloudcliSessionId, {
        codexHome: opts.codexHome,
    });
    if (directCodex)
        return directCodex;
    return (resolveClaudeSessionLogPath(projectPath, cloudcliSessionId, {
        projectsDir: opts.projectsDir,
        sessionsDir: opts.claudeSessionsDir,
    }) ?? {
        logPath: resolveLogPath(projectPath, cloudcliSessionId, opts.projectsDir),
        realSessionId: cloudcliSessionId,
        provider: 'claude',
    });
}
//# sourceMappingURL=paths.js.map