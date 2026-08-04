import fs from 'node:fs';
import { isLogEntry, parseJsonLine } from './protocol.js';
import type { ConversationTurn, LogEntry } from './types.js';

export interface LogEntryWithLine {
  entry: LogEntry;
  lineNumber: number;
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) return String((item as { text?: unknown }).text ?? '');
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function findRootPromptId(entry: LogEntry, uuidMap: Map<string, LogEntryWithLine>): string | undefined {
  const visited = new Set<string>();
  let current: LogEntry | undefined = entry;
  while (current) {
    if (current.type === 'user' && current.promptId) return current.promptId;
    if (!current.parentUuid) return undefined;
    if (current.uuid && visited.has(current.uuid)) return undefined;
    if (current.uuid) visited.add(current.uuid);
    current = uuidMap.get(current.parentUuid)?.entry;
  }
  return undefined;
}

function buildTurn(items: LogEntryWithLine[]): ConversationTurn {
  const userTexts: string[] = [];
  const thinkingTexts: string[] = [];
  const assistantTexts: string[] = [];
  let timestamp = '';

  for (const { entry } of items) {
    if (entry.timestamp && entry.timestamp > timestamp) timestamp = entry.timestamp;
    const blocks = entry.content ?? entry.message?.content ?? [];
    if (entry.type === 'user') {
      for (const block of blocks) {
        if (block.type === 'text') userTexts.push(block.text);
        else if (block.type === 'tool_result') userTexts.push(extractText(block.content));
      }
    } else if (entry.type === 'assistant') {
      for (const block of blocks) {
        if (block.type === 'thinking') thinkingTexts.push(block.thinking);
        else if (block.type === 'text') assistantTexts.push(block.text);
      }
    }
  }

  return {
    promptId: items[0].entry.promptId ?? 'unknown',
    lineStart: items[0].lineNumber,
    lineEnd: items[items.length - 1].lineNumber,
    userText: userTexts.join('\n').trim() || undefined,
    thinkingText: thinkingTexts.join('\n').trim() || undefined,
    assistantText: assistantTexts.join('\n').trim() || undefined,
    timestamp,
  };
}

export function buildTurns(entries: LogEntryWithLine[]): ConversationTurn[] {
  const uuidMap = new Map<string, LogEntryWithLine>();
  for (const item of entries) {
    if (item.entry.uuid) uuidMap.set(item.entry.uuid, item);
  }

  const rootMap = new Map<LogEntry, string>();
  for (const item of entries) {
    const root = findRootPromptId(item.entry, uuidMap);
    if (root) rootMap.set(item.entry, root);
  }

  const turns: ConversationTurn[] = [];
  const seen = new Set<string>();
  let current: LogEntryWithLine[] | null = null;
  let currentPromptId: string | null = null;

  for (const item of entries) {
    const entry = item.entry;
    const root = rootMap.get(entry);

    if (entry.type === 'user' && entry.promptId && !seen.has(entry.promptId)) {
      if (current) turns.push(buildTurn(current));
      current = [item];
      currentPromptId = entry.promptId;
      seen.add(entry.promptId);
    } else if (current && currentPromptId && root === currentPromptId) {
      current.push(item);
    }
  }

  if (current) turns.push(buildTurn(current));
  return turns;
}

export function buildTurnsFromLog(logPath: string): ConversationTurn[] {
  if (!logPath || !fs.existsSync(logPath)) return [];
  const entries: LogEntryWithLine[] = [];
  const raw = fs.readFileSync(logPath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parsed = parseJsonLine(line);
    if (isLogEntry(parsed)) {
      entries.push({ entry: parsed, lineNumber: i + 1 });
    }
  }
  return buildTurns(entries);
}
