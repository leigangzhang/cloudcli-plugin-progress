import Anthropic from '@anthropic-ai/sdk';
import { validateProgressTree } from './schema.js';
import {
  estimateTokens,
  measureConversationTurns,
  type ExtractionTraceContext,
  type ExtractionTraceEvent,
  type ExtractionUsageTrace,
} from './trace.js';
import type {
  ConversationTurn,
  LLMConfig,
  LLMExtractionEngine,
  ProgressGoal,
  ProgressStep,
  ProgressTree,
  ProgressTreePatch,
} from './types.js';

export type { Anthropic };

export interface LLMExtractionEngineOptions {
  config: LLMConfig;
  client?: Anthropic;
  trace?: (event: ExtractionTraceEvent) => void;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const ASSISTANT_SUMMARY_LIMIT = 500;
const USER_TEXT_LIMIT = 2000;

const SYSTEM_PROMPT = `You are a session progress updater. Your job is to apply new conversation turns to an existing progress tree.

Return a ProgressTreePatch object only:
{
  "version": <next integer version>,
  "upsertGoals": [only affected goal objects],
  "deleteGoalIds": [],
  "deleteStepIds": []
}

Rules:
1. Do not return the full progress tree. Return only goals and steps affected by the supplied turns.
2. Each upsert goal must contain its stable "id". Include affected steps only; unchanged steps may be omitted.
3. Every new or updated step must contain a non-empty "id", exact "promptId", "subject", "description", and "status".
4. Preserve IDs from the tree digest whenever a node is affected. Create stable new IDs only for new nodes.
5. Infer subjects, descriptions, and completion status from the user question and assistant summary. Do not infer from reasoning or tool output.
6. Use one short, clear sentence for each subject and description. Do not restate the turn text.
7. Detect the dominant language used by the user and generate subjects and descriptions in that same language.
8. Your response must start with the character "{". Output ONLY valid JSON. Do not output reasoning, explanations, markdown fences, or text before or after the JSON.`;

interface TreeDigestGoal {
  id: string;
  subject: string;
  status: ProgressGoal['status'];
  steps: Array<{
    id: string;
    promptId: string;
    status: ProgressStep['status'];
  }>;
}

interface PatchTurnInput {
  promptId: string;
  lineStart: number;
  lineEnd: number;
  timestamp: string;
  userText?: string;
  assistantSummary?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  used.add(candidate);
  return candidate;
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n...[truncated]`;
}

function buildTreeDigest(tree: ProgressTree): TreeDigestGoal[] {
  return tree.goals.map((goal) => ({
    id: goal.id,
    subject: truncateText(goal.subject, 120) ?? goal.subject,
    status: goal.status,
    steps: (goal.steps ?? []).map((step) => ({
      id: step.id,
      promptId: step.promptId,
      status: step.status,
    })),
  }));
}

function buildTurnInput(turn: ConversationTurn): PatchTurnInput {
  return {
    promptId: turn.promptId,
    lineStart: turn.lineStart,
    lineEnd: turn.lineEnd,
    timestamp: turn.timestamp,
    userText: truncateText(turn.userText, USER_TEXT_LIMIT),
    assistantSummary: truncateText(turn.assistantText, ASSISTANT_SUMMARY_LIMIT),
  };
}

function buildPrompt(tree: ProgressTree, turns: PatchTurnInput[]): string {
  return `Current Tree Digest:
${JSON.stringify(buildTreeDigest(tree), null, 2)}

Conversation Turns:
${JSON.stringify(turns, null, 2)}`;
}

function chunkTurns<T>(turns: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < turns.length; i += size) {
    chunks.push(turns.slice(i, i + size));
  }
  return chunks;
}

function usageTrace(
  usage: Record<string, number | undefined> | undefined,
): ExtractionUsageTrace {
  const trace: ExtractionUsageTrace = {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
  if (usage?.cache_creation_input_tokens !== undefined) {
    trace.cacheCreationInputTokens = usage.cache_creation_input_tokens;
  }
  if (usage?.cache_read_input_tokens !== undefined) {
    trace.cacheReadInputTokens = usage.cache_read_input_tokens;
  }
  return trace;
}

function previousGoalForCandidate(
  goal: ProgressGoal,
  previous: ProgressTree,
): ProgressGoal | undefined {
  const stepPromptIds = new Set<string>();
  if (Array.isArray(goal.steps)) {
    for (const step of goal.steps) {
      if (!isObject(step)) continue;
      const promptId = nonEmptyString(step.promptId);
      if (promptId) stepPromptIds.add(promptId);
    }
  }

  if (stepPromptIds.size > 0) {
    let best: ProgressGoal | undefined;
    let bestMatches = 0;
    for (const oldGoal of previous.goals) {
      const matches = (oldGoal.steps ?? []).filter((step) =>
        stepPromptIds.has(step.promptId),
      ).length;
      if (matches > bestMatches) {
        best = oldGoal;
        bestMatches = matches;
      }
    }
    if (best && bestMatches > 0) return best;
  }

  const subject = nonEmptyString(goal.subject);
  if (!subject) return undefined;
  return previous.goals.find((oldGoal) => oldGoal.subject === subject);
}

function previousStepByPromptId(previous: ProgressTree): Map<string, ProgressStep> {
  const steps = new Map<string, ProgressStep>();
  for (const goal of previous.goals) {
    for (const step of goal.steps ?? []) {
      steps.set(step.promptId, step);
    }
  }
  return steps;
}

function repairPatchIds(patch: ProgressTreePatch, previous: ProgressTree): ProgressTreePatch {
  const previousGoalsById = new Map(previous.goals.map((goal) => [goal.id, goal]));
  const previousSteps = previousStepByPromptId(previous);
  const usedGoalIds = new Set<string>();
  const usedStepIds = new Set<string>();

  const upsertGoals = patch.upsertGoals.map((goal) => {
    const suppliedGoalId = nonEmptyString(goal.id);
    const previousGoal = suppliedGoalId
      ? previousGoalsById.get(suppliedGoalId)
      : previousGoalForCandidate(goal, previous);
    const goalId =
      suppliedGoalId && !usedGoalIds.has(suppliedGoalId)
        ? suppliedGoalId
        : uniqueId(
            previousGoal?.id ?? `goal-${stableHash(goal.subject ?? 'unknown-goal')}`,
            usedGoalIds,
          );
    if (suppliedGoalId && usedGoalIds.has(suppliedGoalId)) {
      usedGoalIds.add(goalId);
    } else {
      usedGoalIds.add(suppliedGoalId ?? goalId);
    }

    const steps = goal.steps?.map((step, index) => {
      const suppliedStepId = nonEmptyString(step.id);
      const previousStep = previousSteps.get(step.promptId);
      const stepId =
        suppliedStepId && !usedStepIds.has(suppliedStepId)
          ? suppliedStepId
          : uniqueId(
              previousStep?.id ?? `step-${stableHash(step.promptId || `${goalId}:${index}`)}`,
              usedStepIds,
            );
      usedStepIds.add(stepId);
      return { ...step, id: stepId };
    });

    return { ...goal, id: goalId, ...(steps ? { steps } : {}) };
  });

  return { ...patch, upsertGoals };
}

function validatePatch(patch: ProgressTreePatch): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(patch.version) || patch.version < 0) {
    errors.push('patch.version must be a non-negative integer');
  }
  if (!Array.isArray(patch.upsertGoals)) {
    errors.push('patch.upsertGoals must be an array');
  }
  if (!Array.isArray(patch.deleteGoalIds)) {
    errors.push('patch.deleteGoalIds must be an array');
  }
  if (!Array.isArray(patch.deleteStepIds)) {
    errors.push('patch.deleteStepIds must be an array');
  }
  if (errors.length > 0) return errors;

  const treeErrors = validateProgressTree({
    version: patch.version,
    goals: patch.upsertGoals,
  });
  if (treeErrors.length > 0) {
    errors.push(...treeErrors.map((error) => `patch: ${error}`));
  }
  return errors;
}

function mergePatch(previous: ProgressTree, patch: ProgressTreePatch): ProgressTree {
  const deletedGoalIds = new Set(patch.deleteGoalIds);
  const deletedStepIds = new Set(patch.deleteStepIds);
  const goals = new Map<string, ProgressGoal>();

  for (const goal of previous.goals) {
    if (!deletedGoalIds.has(goal.id)) {
      goals.set(goal.id, goal);
    }
  }

  for (const incoming of patch.upsertGoals) {
    const existing = goals.get(incoming.id);
    const existingSteps = existing?.steps ?? [];
    const mergedSteps =
      incoming.steps === undefined
        ? existingSteps
        : (() => {
            const stepMap = new Map<string, ProgressStep>();
            for (const step of existingSteps) {
              stepMap.set(step.id, step);
            }
            for (const step of incoming.steps) {
              stepMap.set(step.id, step);
            }
            for (const id of deletedStepIds) {
              stepMap.delete(id);
            }
            return Array.from(stepMap.values());
          })();

    goals.set(incoming.id, {
      ...existing,
      ...incoming,
      steps: mergedSteps,
    });
  }

  const version = patch.version > previous.version ? patch.version : previous.version + 1;
  return {
    version,
    goals: Array.from(goals.values()),
  };
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error('No JSON object found in response');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  const end = text.lastIndexOf('}');
  if (end === -1 || end < start) {
    throw new Error('No JSON object found in response');
  }
  return text.slice(start, end + 1);
}

export class LLMExtractionEngineImpl implements LLMExtractionEngine {
  private client: Anthropic;
  private config: LLMConfig;
  private usageListeners: ((usage: { inputTokens: number; outputTokens: number }) => void)[] = [];
  private trace: ((event: ExtractionTraceEvent) => void) | undefined;

  constructor(options: LLMExtractionEngineOptions) {
    this.config = options.config;
    this.trace = options.trace;
    this.client =
      options.client ??
      new Anthropic({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
        maxRetries: this.config.maxRetries ?? 3,
        timeout: this.config.requestTimeoutMs ?? 60_000,
      });
  }

  async extract(
    tree: ProgressTree,
    turns: ConversationTurn[],
    onProgress?: (tree: ProgressTree) => void,
    traceContext?: ExtractionTraceContext,
  ): Promise<ProgressTree> {
    if (traceContext && this.trace) {
      this.trace({
        type: 'conversation',
        context: traceContext,
        turnCount: turns.length,
        turnIds: turns.map((turn) => turn.promptId),
        turns,
        metrics: measureConversationTurns(turns),
      });
    }

    if (turns.length === 0) {
      return this.extractChunk(tree, [], traceContext);
    }

    const chunks = chunkTurns(turns, 5);
    let currentTree = tree;
    for (let index = 0; index < chunks.length; index++) {
      const chunkContext = traceContext
        ? {
            ...traceContext,
            chunkIndex: index + 1,
            chunkTotal: chunks.length,
          }
        : undefined;
      currentTree = await this.extractChunk(currentTree, chunks[index], chunkContext);
      onProgress?.(currentTree);
    }
    return currentTree;
  }

  private async extractChunk(
    tree: ProgressTree,
    turns: ConversationTurn[],
    traceContext?: ExtractionTraceContext,
  ): Promise<ProgressTree> {
    return this.doExtract(tree, turns.map(buildTurnInput), traceContext, 1);
  }

  onUsage(callback: (usage: { inputTokens: number; outputTokens: number }) => void): () => void {
    this.usageListeners.push(callback);
    return () => {
      const idx = this.usageListeners.indexOf(callback);
      if (idx !== -1) this.usageListeners.splice(idx, 1);
    };
  }

  private async doExtract(
    tree: ProgressTree,
    turns: PatchTurnInput[],
    traceContext?: ExtractionTraceContext,
    attempt = 1,
  ): Promise<ProgressTree> {
    const prompt = buildPrompt(tree, turns);
    if (traceContext && this.trace) {
      this.trace({
        type: 'prompt',
        context: traceContext,
        attempt,
        strict: false,
        turnWindow: turns.length,
        promptCharacters: prompt.length,
        estimatedPromptTokens: estimateTokens(prompt),
        prompt,
      });
    }

    const maxTokens = Math.min(
      this.config.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      DEFAULT_MAX_OUTPUT_TOKENS,
    );
    let rawOutput = '';
    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });
      const usage = response.usage;
      const outputTokens = usage?.output_tokens ?? 0;
      if (traceContext && this.trace) {
        this.trace({
          type: 'usage',
          context: traceContext,
          attempt,
          usage: usageTrace(usage as unknown as Record<string, number | undefined> | undefined),
        });
      }
      this.usageListeners.forEach((cb) =>
        cb({
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens,
        }),
      );

      rawOutput = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      const jsonText = extractJsonObject(rawOutput);
      const parsedPatch = JSON.parse(jsonText) as ProgressTreePatch;
      if (!isObject(parsedPatch) || !Array.isArray(parsedPatch.upsertGoals)) {
        throw new Error('Model response must contain patch.upsertGoals');
      }
      const patch = repairPatchIds(parsedPatch, tree);
      const errors = validatePatch(patch);
      if (errors.length > 0) {
        throw new Error(`Schema validation failed: ${errors.join('; ')}`);
      }

      if (traceContext && this.trace) {
        this.trace({
          type: 'response',
          context: traceContext,
          attempt,
          rawOutput,
          outputCharacters: rawOutput.length,
          parsedCharacters: jsonText.length,
          outputTokens,
        });
      }

      return mergePatch(tree, patch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (traceContext && this.trace) {
        this.trace({
          type: 'response',
          context: traceContext,
          attempt,
          rawOutput,
          outputCharacters: rawOutput.length,
          parsedCharacters: 0,
          outputTokens: 0,
          error: message,
        });
        this.trace({
          type: 'usage',
          context: traceContext,
          attempt,
          usage: { inputTokens: 0, outputTokens: 0 },
          error: message,
          prompt,
        });
      }
      throw err;
    }
  }
}
