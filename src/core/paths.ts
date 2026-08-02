 import os from 'node:os';
 import path from 'node:path';

export function encodeProjectPath(projectPath: string): string {
  if (projectPath === '/') return '-';
  const trimmed = projectPath.replace(/\/$/, '');
  if (trimmed === '') return '';
  return trimmed.replace(/^\//, '-').replace(/\//g, '-');
}

 export function resolveLogPath(
   projectPath: string,
   sessionId: string,
   projectsDir = path.join(os.homedir(), '.claude', 'projects'),
 ): string {
   const encoded = encodeProjectPath(projectPath);
   return path.join(projectsDir, encoded, `${sessionId}.jsonl`);
 }
