// Core data structures shared across the progress plugin.

import type { ExtractionTraceContext } from './trace.js';

export type LogEntryType =
  | 'assistant'
  | 'user'
  | 'system'
  | 'attachment'
  | 'mode'
  | 'permission-mode'
  | 'last-prompt';

export interface LogEntry {
  type: LogEntryType;
  uuid?: string;
  parentUuid?: string | null;
  promptId?: string;
  sessionId?: string;
  timestamp?: string;
  subtype?: string;
  level?: string;
  content?: ContentBlock[];
  stopReason?: string;
  message?: {
    role?: string;
    content?: ContentBlock[];
    stop_reason?: string;
  };
  // Preserve unknown fields for forward compatibility.
  [key: string]: unknown;
}

export type LogProvider = 'claude' | 'codex';

export type SessionLogEntry =
  | LogEntry
  | (Record<string, unknown> & { type?: string });

export type ContentBlock =
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean };

export interface ToolUseSummary {
  id: string;
  name: string;
  inputSummary?: string;
}

export interface ToolResultSummary {
  toolUseId: string;
  isError?: boolean;
  summary?: string;
}

export interface ConversationSegment {
  promptId?: string;
  role: 'assistant' | 'user' | 'system';
  thinkingExcerpt?: string;
  textExcerpt?: string;
  toolUses: ToolUseSummary[];
  toolResults: ToolResultSummary[];
  stopReason?: string;
  timestamp: string;
}

export interface ConversationTurn {
  promptId: string;
  lineStart: number;
  lineEnd: number;
  userText?: string;
  thinkingText?: string;
  assistantText?: string;
  toolText?: string;
  timestamp: string;
}

export interface TurnResponse extends ConversationTurn {
  records?: LogEntry[];
}

export type ProgressStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';

export interface ProgressStep {
  id: string;
  subject: string;
  description?: string;
  status: ProgressStatus;
  toolUse?: string;
  completedAt?: string;
  promptId: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface ProgressGoal {
  id: string;
  subject: string;
  description?: string;
  status: ProgressStatus;
  steps?: ProgressStep[];
  startedAt?: string;
  completedAt?: string;
}

export interface ProgressTree {
  version: number;
  goals: ProgressGoal[];
}

export interface ProgressSnapshot {
  sessionId: string;
  tree: ProgressTree;
  cursor: { bytesRead: number; lastLine: number };
  updatedAt: string;
}

export interface WatchRequest {
  projectPath: string;
  sessionId: string;
}

export interface RefreshRequest {
  sessionId: string;
}

export interface ProgressResponse {
  tree: ProgressTree;
  status: 'idle' | 'syncing' | 'error' | 'paused';
  error?: string;
  sessionId?: string;
}

export type ServerMessage =
  | { type: 'progress'; tree: ProgressTree }
  | { type: 'status'; status: ProgressResponse['status']; error?: string };

export type ClientMessage =
  | { type: 'subscribe'; projectPath: string; sessionId: string }
  | { type: 'refresh' };

export interface LLMConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxRetries?: number;
  requestTimeoutMs?: number;
  maxTokens?: number;
  usePolling?: boolean;
}

export interface SessionLogWatcher {
  start(projectPath: string, sessionId: string): Promise<void>;
  startWithPath(filePath: string): Promise<void>;
  stop(): void;
  onLine(callback: (entry: SessionLogEntry) => void): () => void;
  getCursor(): { bytesRead: number; lastLine: number };
  getFilePath(): string;
}

export interface DiffDetector {
  ingest(entry: SessionLogEntry): void;
  onTrigger(callback: (segments: ConversationSegment[]) => void): () => void;
  flush(): void;
}

export interface LLMExtractionEngine {
  extract(
    tree: ProgressTree,
    turns: ConversationTurn[],
    onProgress?: (tree: ProgressTree) => void,
    traceContext?: ExtractionTraceContext,
  ): Promise<ProgressTree>;
  onUsage(callback: (usage: { inputTokens: number; outputTokens: number }) => void): () => void;
}

export interface ProgressStore {
  getState(): ProgressTree;
  setState(tree: ProgressTree): void;
  subscribe(callback: (tree: ProgressTree) => void): () => void;
  loadSnapshot(sessionId: string): boolean;
  saveSnapshot(sessionId: string): void;
}
