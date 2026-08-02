 import { describe, expect, it } from 'vitest';
 import { encodeProjectPath, resolveLogPath } from '../../src/core/paths.js';
 import os from 'node:os';

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

 function osPath(...segments: string[]): string {
   // Use POSIX separators for expectations; implementation should also use POSIX separators.
   return segments.join('/');
 }

 function pathJoin(a: string, b: string): string {
   return a.replace(/\/$/, '') + '/' + b;
 }
