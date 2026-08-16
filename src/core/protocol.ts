 // Type guards and safe parsing for frontend/backend messages.

 import type {
   ClientMessage,
   LogEntry,
   ProgressResponse,
   RefreshRequest,
   ServerMessage,
   SessionLogEntry,
   WatchRequest,
 } from './types.js';

 export function isLogEntry(value: unknown): value is SessionLogEntry {
   return (
     typeof value === 'object' &&
     value !== null &&
     typeof (value as Record<string, unknown>).type === 'string'
   );
 }

 export function isWatchRequest(value: unknown): value is WatchRequest {
   const v = value as Record<string, unknown> | undefined;
   return (
     typeof v === 'object' &&
     v !== null &&
     typeof v.projectPath === 'string' &&
     typeof v.sessionId === 'string'
   );
 }

 export function isRefreshRequest(value: unknown): value is RefreshRequest {
   const v = value as Record<string, unknown> | undefined;
   return typeof v === 'object' && v !== null && typeof v.sessionId === 'string';
 }

 export function isProgressResponse(value: unknown): value is ProgressResponse {
   const v = value as Record<string, unknown> | undefined;
   return (
     typeof v === 'object' &&
     v !== null &&
     typeof v.tree === 'object' &&
     typeof v.status === 'string' &&
     ['idle', 'syncing', 'error', 'paused'].includes(v.status as string)
   );
 }

 export function isServerMessage(value: unknown): value is ServerMessage {
   const v = value as Record<string, unknown> | undefined;
   if (typeof v !== 'object' || v === null || typeof v.type !== 'string') {
     return false;
   }
   if (v.type === 'progress') {
     return typeof v.tree === 'object' && v.tree !== null;
   }
   if (v.type === 'status') {
     return (
       typeof v.status === 'string' &&
       ['idle', 'syncing', 'error', 'paused'].includes(v.status as string)
     );
   }
   return false;
 }

 export function isClientMessage(value: unknown): value is ClientMessage {
   const v = value as Record<string, unknown> | undefined;
   if (typeof v !== 'object' || v === null || typeof v.type !== 'string') {
     return false;
   }
   if (v.type === 'subscribe') {
     return typeof v.projectPath === 'string' && typeof v.sessionId === 'string';
   }
   if (v.type === 'refresh') {
     return true;
   }
   return false;
 }

 export function parseJsonLine(line: string): unknown {
   try {
     return JSON.parse(line);
   } catch {
     return undefined;
   }
 }
