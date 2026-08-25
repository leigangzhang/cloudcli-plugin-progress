import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConversationTurn, LogProvider } from './types.js';

export type ExtractionMode = 'incremental' | 'full';

export interface ExtractionTraceContext {
  requestId: string;
  sessionId: string;
  cloudcliSessionId?: string;
  projectPath?: string;
  provider: LogProvider;
  logPath?: string;
  mode: ExtractionMode;
  parseScope?: 'full_file' | 'buffer';
  chunkIndex?: number;
  chunkTotal?: number;
}

export interface ConversationTraceMetrics {
  characters: number;
  userCharacters: number;
  assistantCharacters: number;
  thinkingCharacters: number;
  toolCharacters: number;
  estimatedTokens: number;
}

export interface ExtractionUsageTrace {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export type ExtractionTraceEvent =
  | {
      type: 'conversation';
      context: ExtractionTraceContext;
      turnCount: number;
      turnIds: string[];
      turns: ConversationTurn[];
      metrics: ConversationTraceMetrics;
    }
  | {
      type: 'prompt';
      context: ExtractionTraceContext;
      attempt: number;
      strict: boolean;
      turnWindow: number;
      promptCharacters: number;
      estimatedPromptTokens: number;
      prompt: string;
    }
  | {
      type: 'usage';
      context: ExtractionTraceContext;
      attempt: number;
      usage: ExtractionUsageTrace;
      error?: string;
      prompt?: string;
    }
  | {
      type: 'response';
      context: ExtractionTraceContext;
      attempt: number;
      rawOutput: string;
      outputCharacters: number;
      parsedCharacters: number;
      outputTokens: number;
      error?: string;
      rawResponse?: string;
      contentBlocks?: Array<{
        type: string;
        characters?: number;
        text?: string;
      }>;
    };

export function estimateTokens(text: string | undefined): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

export function measureConversationTurns(turns: ConversationTurn[]): ConversationTraceMetrics {
  let userCharacters = 0;
  let assistantCharacters = 0;
  let thinkingCharacters = 0;
  let toolCharacters = 0;

  for (const turn of turns) {
    userCharacters += turn.userText?.length ?? 0;
    assistantCharacters += turn.assistantText?.length ?? 0;
    thinkingCharacters += turn.thinkingText?.length ?? 0;
    toolCharacters += turn.toolText?.length ?? 0;
  }

  const characters =
    userCharacters + assistantCharacters + thinkingCharacters + toolCharacters;
  return {
    characters,
    userCharacters,
    assistantCharacters,
    thinkingCharacters,
    toolCharacters,
    estimatedTokens: estimateTokens(JSON.stringify(turns)),
  };
}

export function createTraceRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function extractionTraceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.PROGRESS_TRACE_EXTRACTIONS;
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function resolveExtractionTraceEnabled(
  configuredTrace: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (configuredTrace !== undefined) return configuredTrace;
  return extractionTraceEnabled(env);
}

export function getExtractionTraceLogPath(
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string {
  const dir =
    env.PROGRESS_TRACE_LOG_DIR ??
    path.join(home, '.claude-code-ui', 'plugins', 'cloudcli-plugin-progress');
  const filename = env.PROGRESS_TRACE_LOG_FILE ?? 'progress-plugin.log';
  return path.join(dir, filename);
}

export function writeExtractionTrace(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): void {
  const filePath = getExtractionTraceLogPath(env, home);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf-8');
  } catch (err) {
    console.error('Failed to write extraction trace log:', (err as Error).message);
  }
}
