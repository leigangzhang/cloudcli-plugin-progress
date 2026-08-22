import type { ClientMessage, ExtractionMode, ModeRequest, ProgressResponse, RefreshRequest, ServerMessage, SessionLogEntry, WatchRequest } from './types.js';
export declare function isExtractionMode(value: unknown): value is ExtractionMode;
export declare function isLogEntry(value: unknown): value is SessionLogEntry;
export declare function isWatchRequest(value: unknown): value is WatchRequest;
export declare function isRefreshRequest(value: unknown): value is RefreshRequest;
export declare function isModeRequest(value: unknown): value is ModeRequest;
export declare function isProgressResponse(value: unknown): value is ProgressResponse;
export declare function isServerMessage(value: unknown): value is ServerMessage;
export declare function isClientMessage(value: unknown): value is ClientMessage;
export declare function parseJsonLine(line: string): unknown;
//# sourceMappingURL=protocol.d.ts.map