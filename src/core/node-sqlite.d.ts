declare module 'node:sqlite' {
  export interface DatabaseSyncOptions {
    readOnly?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
    close(): void;
  }
}
