import fs from 'node:fs';
import { parseJsonLine } from '../protocol.js';
import type { ConversationTurn, SessionLogEntry } from '../types.js';
import type { CodexEntryWithLine, CodexTurnBuilderOutput } from './types.js';

const MAX_USER_CHARS = 20_000;
const MAX_ASSISTANT_CHARS = 20_000;
const MAX_THINKING_CHARS = 12_000;
const MAX_TOOL_CHARS = 30_000;
const MAX_TOOL_ITEM_CHARS = 10_000;
const SYSTEM_USER_TAGS = new Set([
  'app-context',
  'collaboration_mode',
  'environment_context',
  'permissions instructions',
  'plugins_instructions',
  'skills_instructions',
  'turn_aborted',
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function entryType(entry: SessionLogEntry): string | undefined {
  return typeof entry.type === 'string' ? entry.type : undefined;
}

function payloadOf(entry: SessionLogEntry): Record<string, unknown> | undefined {
  return asRecord(entry.payload);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function turnIdOf(entry: SessionLogEntry): string | undefined {
  const payload = payloadOf(entry);
  if (!payload) return undefined;
  const direct = stringValue(payload.turn_id);
  if (direct) return direct;
  const passthrough = asRecord(payload.internal_chat_message_metadata_passthrough);
  return passthrough ? stringValue(passthrough.turn_id) : undefined;
}

function contentText(
  content: unknown,
  allowedTypes = new Set(['text', 'input_text', 'output_text']),
): string[] {
  const parts: string[] = [];
  if (typeof content === 'string') {
    parts.push(content);
    return parts;
  }
  if (!Array.isArray(content)) return parts;

  for (const item of content) {
    const record = asRecord(item);
    if (!record) continue;
    const type = stringValue(record.type);
    if (!type || !allowedTypes.has(type)) continue;
    const text = stringValue(record.text ?? record.input_text ?? record.output_text);
    if (text) parts.push(text);
  }
  return parts;
}

function reasoningText(payload: Record<string, unknown>): string {
  const summary = payload.summary;
  if (typeof summary === 'string') return summary;
  if (!Array.isArray(summary)) return '';
  return summary
    .map((item) => {
      const record = asRecord(item);
      return record ? stringValue(record.text) ?? '' : '';
    })
    .filter(Boolean)
    .join('\n');
}

function summarizeFunctionArguments(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function latestTimestamp(values: string[]): string {
  return values.reduce((latest, value) => (value > latest ? value : latest), '');
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function uniqueTexts(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function isSystemUserText(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized.startsWith('<')) return false;
  const tag = normalized.match(/^<([a-zA-Z_ -]+)/)?.[1];
  return !!tag && SYSTEM_USER_TAGS.has(tag);
}

function truncateField(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const omitted = value.length - maxLength;
  return `${value.slice(0, maxLength)}\n\n...[truncated ${omitted} characters]`;
}

function joinField(
  values: string[],
  maxLength: number,
  separator = '\n\n',
): string | undefined {
  const text = uniqueTexts(values).join(separator).trim();
  return text ? truncateField(text, maxLength) : undefined;
}

interface TurnGroup {
  turnId: string;
  entries: CodexEntryWithLine[];
}

function groupEntries(entries: CodexEntryWithLine[]): TurnGroup[] {
  const groups = new Map<string, TurnGroup>();
  let currentTurnId: string | undefined;

  for (const item of entries) {
    const type = entryType(item.entry);
    const payload = payloadOf(item.entry);
    if (type === 'turn_context' || payload?.type === 'task_started') {
      const declared = turnIdOf(item.entry);
      if (declared) currentTurnId = declared;
    }

    const turnId = turnIdOf(item.entry) ?? currentTurnId;
    if (!turnId) continue;
    let group = groups.get(turnId);
    if (!group) {
      group = { turnId, entries: [] };
      groups.set(turnId, group);
    }
    group.entries.push(item);
  }

  return Array.from(groups.values());
}

function buildTurn(group: TurnGroup): CodexTurnBuilderOutput {
  const eventUserTexts: string[] = [];
  const responseUserTexts: string[] = [];
  const eventAssistantTexts: string[] = [];
  const assistantTexts: string[] = [];
  const thinkingTexts: string[] = [];
  const toolTexts: string[] = [];
  const timestamps: string[] = [];

  for (const { entry } of group.entries) {
    const type = entryType(entry);
    const payload = payloadOf(entry);
    if (!type || !payload) continue;
    const timestamp = stringValue(entry.timestamp);
    if (timestamp) timestamps.push(timestamp);

    if (type === 'event_msg') {
      if (payload.type === 'user_message') {
        const message = stringValue(payload.message);
        if (message) eventUserTexts.push(message);
      } else if (payload.type === 'agent_message') {
        const message = stringValue(payload.message);
        if (message) eventAssistantTexts.push(message);
      }
      continue;
    }

    if (type !== 'response_item') continue;
    if (payload.type === 'message') {
      if (payload.role === 'assistant') {
        assistantTexts.push(...contentText(payload.content));
      } else if (payload.role === 'user' && payload.content) {
        const parts = contentText(payload.content);
        responseUserTexts.push(...parts.filter((part) => !isSystemUserText(part)));
      }
    } else if (payload.type === 'reasoning') {
      const summary = reasoningText(payload);
      if (summary) thinkingTexts.push(summary);
    } else if (payload.type === 'function_call') {
      const name = stringValue(payload.name) ?? 'unknown_tool';
      const args = summarizeFunctionArguments(payload.arguments);
      toolTexts.push(truncateField(`[tool:${name}]\n${args}`.trim(), MAX_TOOL_ITEM_CHARS));
    } else if (payload.type === 'function_call_output') {
      const output = payload.output;
      const text =
        typeof output === 'string'
          ? output
          : summarizeFunctionArguments(output);
      toolTexts.push(truncateField(`[tool_result]\n${text}`.trim(), MAX_TOOL_ITEM_CHARS));
    } else if (payload.type === 'custom_tool_call') {
      const name = stringValue(payload.name) ?? 'unknown_custom_tool';
      toolTexts.push(
        truncateField(
          `[custom_tool:${name}]\n${summarizeFunctionArguments(payload.input)}`.trim(),
          MAX_TOOL_ITEM_CHARS,
        ),
      );
    } else if (payload.type === 'custom_tool_call_output') {
      toolTexts.push(
        truncateField(
          `[custom_tool_result]\n${summarizeFunctionArguments(payload.output)}`.trim(),
          MAX_TOOL_ITEM_CHARS,
        ),
      );
    }
  }

  const userText = joinField(
    eventUserTexts.length > 0 ? eventUserTexts : responseUserTexts,
    MAX_USER_CHARS,
  );

  return {
    promptId: group.turnId,
    lineStart: group.entries[0].lineNumber,
    lineEnd: group.entries[group.entries.length - 1].lineNumber,
    userText,
    thinkingText: joinField(thinkingTexts, MAX_THINKING_CHARS, '\n\n---\n\n'),
    assistantText: joinField(
      assistantTexts.length > 0 ? assistantTexts : eventAssistantTexts,
      MAX_ASSISTANT_CHARS,
    ),
    toolText: joinField(toolTexts, MAX_TOOL_CHARS, '\n\n---\n\n'),
    timestamp: latestTimestamp(timestamps),
    entryCount: group.entries.length,
  };
}

export function buildCodexTurns(entries: CodexEntryWithLine[]): ConversationTurn[] {
  return groupEntries(entries).map((group) => {
    const turn = buildTurn(group);
    return {
      promptId: turn.promptId,
      lineStart: turn.lineStart,
      lineEnd: turn.lineEnd,
      userText: turn.userText,
      thinkingText: turn.thinkingText,
      assistantText: turn.assistantText,
      toolText: turn.toolText,
      timestamp: turn.timestamp,
    };
  });
}

export function buildCodexTurnsFromLog(logPath: string): ConversationTurn[] {
  if (!logPath || !fs.existsSync(logPath)) return [];
  const entries: CodexEntryWithLine[] = [];
  const raw = fs.readFileSync(logPath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parsed = parseJsonLine(line);
    const record = asRecord(parsed);
    if (!record || !stringValue(record.type)) continue;
    entries.push({ entry: record as SessionLogEntry, lineNumber: i + 1 });
  }
  return buildCodexTurns(entries);
}

export function isCodexProgressEntry(entry: SessionLogEntry): boolean {
  const type = entryType(entry);
  const payload = payloadOf(entry);
  if (!type || !payload) return false;
  if (type === 'event_msg') {
    return (
      payload.type === 'task_complete' ||
      payload.type === 'agent_message' ||
      payload.type === 'user_message'
    );
  }
  return type === 'response_item' && payload.type === 'message' && payload.role === 'assistant';
}
