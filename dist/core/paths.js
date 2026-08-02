import os from 'node:os';
import path from 'node:path';
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
//# sourceMappingURL=paths.js.map