 import fs from 'node:fs';
 import os from 'node:os';
 import path from 'node:path';

 export interface TempDir {
   path: string;
   cleanup: () => void;
 }

 export function createTempDir(prefix = 'progress-test-'): TempDir {
   const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
   return {
     path: dir,
     cleanup: () => {
       try {
         fs.rmSync(dir, { recursive: true, force: true });
       } catch {
         // ignore cleanup failures
       }
     },
   };
 }

 export function writeJsonl(filePath: string, entries: unknown[]): void {
   const lines = entries.map((e) => JSON.stringify(e)).join('\n');
   fs.writeFileSync(filePath, lines + (entries.length ? '\n' : ''), 'utf-8');
 }

 export function appendJsonl(filePath: string, entries: unknown[]): void {
   const lines = entries.map((e) => JSON.stringify(e)).join('\n');
   fs.appendFileSync(filePath, (entries.length ? '\n' : '') + lines + '\n', 'utf-8');
 }

 export function createSettingsJson(env: Record<string, string>): string {
   const tmp = createTempDir();
   const settingsPath = path.join(tmp.path, 'settings.json');
   fs.writeFileSync(settingsPath, JSON.stringify({ env }), 'utf-8');
   return settingsPath;
 }

 export function wait(ms: number): Promise<void> {
   return new Promise((resolve) => setTimeout(resolve, ms));
 }
