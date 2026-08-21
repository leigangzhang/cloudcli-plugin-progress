 import { describe, expect, it } from 'vitest';
 import fs from 'node:fs';
 import path from 'node:path';
 import { defaultSnapshotDir, ProgressStoreImpl } from '../../src/core/store.js';
 import type { ProgressTree } from '../../src/core/types.js';
 import { createTempDir } from '../utils.js';

 describe('ProgressStoreImpl', () => {
   it('uses the CloudCLI plugin snapshot directory by default', () => {
     expect(defaultSnapshotDir('/home/ray')).toBe(
       path.join(
         '/home/ray',
         '.claude-code-ui',
         'plugins',
         'cloudcli-plugin-progress',
         '.snapshots',
       ),
     );
   });

   it('returns the current state', () => {
     const store = new ProgressStoreImpl();
     expect(store.getState()).toEqual({ version: 0, goals: [] });
   });

   it('notifies subscribers on state change', () => {
     const store = new ProgressStoreImpl();
     const updates: ProgressTree[] = [];
     const unsubscribe = store.subscribe((tree) => updates.push(tree));
     const tree: ProgressTree = { version: 1, goals: [{ id: 'g1', subject: 'x', status: 'pending' }] };
     store.setState(tree);
     expect(updates.length).toBe(1);
     expect(updates[0]).toEqual(tree);
     unsubscribe();
   });

   it('does not notify after unsubscribe', () => {
     const store = new ProgressStoreImpl();
     const updates: ProgressTree[] = [];
     const unsubscribe = store.subscribe((tree) => updates.push(tree));
     unsubscribe();
     store.setState({ version: 1, goals: [] });
     expect(updates.length).toBe(0);
   });

   it('saves and loads snapshots', () => {
     const tmp = createTempDir();
     const store = new ProgressStoreImpl({ snapshotDir: tmp.path });
     const tree: ProgressTree = { version: 2, goals: [{ id: 'g1', subject: 'y', status: 'completed' }] };
     store.setState(tree);
     store.saveSnapshot('sess-1');

     const other = new ProgressStoreImpl({ snapshotDir: tmp.path });
     const loaded = other.loadSnapshot('sess-1');
     expect(loaded).toBe(true);
     expect(other.getState()).toEqual(tree);
     tmp.cleanup();
   });

   it('returns false when snapshot does not exist', () => {
     const tmp = createTempDir();
     const store = new ProgressStoreImpl({ snapshotDir: tmp.path });
     const loaded = store.loadSnapshot('missing');
     expect(loaded).toBe(false);
     tmp.cleanup();
   });

   it('creates the snapshot directory if missing', () => {
     const tmp = createTempDir();
     const snapshotDir = path.join(tmp.path, 'nested', 'snapshots');
     const store = new ProgressStoreImpl({ snapshotDir });
     store.setState({ version: 1, goals: [] });
     store.saveSnapshot('sess-2');
     expect(fs.existsSync(path.join(snapshotDir, 'sess-2.json'))).toBe(true);
     tmp.cleanup();
   });
 });
