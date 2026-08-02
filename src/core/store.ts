 import fs from 'node:fs';
 import os from 'node:os';
 import path from 'node:path';
 import type { ProgressStore, ProgressTree } from './types.js';

 export interface ProgressStoreOptions {
   snapshotDir?: string;
 }

 const DEFAULT_SNAPSHOT_DIR = path.join(
   os.homedir(),
   '.claude-code-ui',
   'plugins',
   'progress-plugin',
   '.snapshots',
 );

 function snapshotPath(snapshotDir: string, sessionId: string): string {
   return path.join(snapshotDir, `${sessionId}.json`);
 }

 export class ProgressStoreImpl implements ProgressStore {
   private state: ProgressTree = { version: 0, goals: [] };
   private listeners: ((tree: ProgressTree) => void)[] = [];
   private snapshotDir: string;

   constructor(options?: ProgressStoreOptions) {
     this.snapshotDir = options?.snapshotDir ?? DEFAULT_SNAPSHOT_DIR;
   }

   getState(): ProgressTree {
     return this.state;
   }

   setState(tree: ProgressTree): void {
     this.state = tree;
     this.listeners.forEach((cb) => cb(tree));
   }

   subscribe(callback: (tree: ProgressTree) => void): () => void {
     this.listeners.push(callback);
     return () => {
       const idx = this.listeners.indexOf(callback);
       if (idx !== -1) {
         this.listeners.splice(idx, 1);
       }
     };
   }

   loadSnapshot(sessionId: string): boolean {
     const file = snapshotPath(this.snapshotDir, sessionId);
     try {
       const raw = fs.readFileSync(file, 'utf-8');
       const parsed = JSON.parse(raw) as ProgressTree;
       this.state = parsed;
       return true;
     } catch {
       return false;
     }
   }

   saveSnapshot(sessionId: string): void {
     const file = snapshotPath(this.snapshotDir, sessionId);
     fs.mkdirSync(this.snapshotDir, { recursive: true });
     fs.writeFileSync(file, JSON.stringify(this.state, null, 2), 'utf-8');
   }
 }
