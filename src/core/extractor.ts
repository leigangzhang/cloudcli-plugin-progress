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
  similaritySplitting?: boolean;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const ASSISTANT_SUMMARY_LIMIT = 1000;
const USER_TEXT_LIMIT = 1000;
const MAX_STEPS_PER_GOAL = 12;
const MAX_GOAL_CHARS = 4000;
const SIMILARITY_THRESHOLD = 0.55;

const SYSTEM_PROMPT = `You are a progress-tree updater. Given the latest conversation turns, update the latest goal and return only a ProgressTreePatch JSON object.

Return shape:
{
  "version": <next integer version>,
  "upsertGoals": [
    {
      "id": "<goal id>",
      "subject": "<goal subject>",
      "description": "<goal description>",
      "status": "<pending | in_progress | completed | deleted>",
      "steps": [
        {
          "id": "<step id>",
          "promptId": "<conversation turn promptId>",
          "subject": "<step subject>",
          "description": "<step description>",
          "status": "<pending | in_progress | completed | deleted>"
        }
      ]
    }
  ],
  "deleteGoalIds": [],
  "deleteStepIds": []
}

Rules:
1. Only update the latest goal. Never modify or reopen previous goals.
2. Place relevant conversation turns as steps under the latest goal. Every returned goal must contain at least one step.
3. Prefer continuing the latest goal; only start a new goal when the user clearly changes to a different, unrelated topic. Use semantic similarity to decide whether a turn belongs to the latest goal, not just keyword overlap. Do not merge when it would make the latest goal exceed 12 steps or 4000 characters. For example, multiple markdown feature improvements belong to one goal.
4. Keep steps at conversational granularity: one user turn normally maps to one step. Do not split one turn into multiple steps or merge unrelated turns.
5. Preserve IDs from the tree digest for existing nodes. Generate stable IDs only for new nodes.
6. Infer subject, description, and status only from user text and assistant summary. Never use reasoning or tool output.
7. Status meaning: "pending" = not started, "in_progress" = active, "completed" = done, "deleted" = removed.
8. Return goals and steps in the same order as the conversation turns.
9. Use the user's dominant language for every subject and description.
10. Keep each subject under 640 characters and each description under 960 characters. Summarize, do not restate the turn.
11. Do not analyze completed history or explain decisions.
12. Output only valid JSON that starts with "{" and ends with "}". No markdown fences, comments, reasoning, or extra text.`;

const SIMILARITY_SYSTEM_PROMPT = `You are comparing consecutive conversation steps to decide whether they belong to the same goal.

Consider whether the two steps:
- operate on the same module, object, or system;
- continue, refine, or fix the same task;
- clearly switch to a different task or topic.

Return only JSON:
{
  "scores": [
    {
      "left_prompt_id": "<left promptId>",
      "right_prompt_id": "<right promptId>",
      "similarity": 0.85,
      "same_goal": true,
      "reason": "<short reason>"
    }
  ]
}

"similarity" must be a number from 0.0 to 1.0. Set "same_goal" to false only for a clear topic change.`;

interface TreeDigestGoal {
  id: string;
  subject: string;
  description?: string;
  status: ProgressGoal['status'];
  steps: Array<{
    id: string;
    promptId: string;
    subject: string;
    description?: string;
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
  return value.slice(0, maxLength);
}

function buildTreeDigest(tree: ProgressTree): TreeDigestGoal[] {
  const latestGoal = tree.goals[tree.goals.length - 1];
  if (!latestGoal) return [];
  const steps = latestGoal.steps ?? [];
  return [{
    id: latestGoal.id,
    subject: latestGoal.subject,
    description: latestGoal.description,
    status: latestGoal.status,
    steps: steps.map((step) => ({
      id: step.id,
      promptId: step.promptId,
      subject: step.subject,
      description: step.description,
      status: step.status,
    })),
  }];
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

function repairPatchIds(patch: ProgressTreePatch): ProgressTreePatch {
  const usedGoalIds = new Set<string>();
  const usedStepIds = new Set<string>();

  const upsertGoals = patch.upsertGoals.map((goal) => {
    const suppliedGoalId = nonEmptyString(goal.id);
    const goalId = uniqueId(
      suppliedGoalId ?? `goal-${stableHash(goal.subject ?? 'unknown-goal')}`,
      usedGoalIds,
    );

    const steps = goal.steps?.map((step, index) => {
      const suppliedStepId = nonEmptyString(step.id);
      const stepId = uniqueId(
        suppliedStepId ?? `step-${stableHash(step.promptId || `${goalId}:${index}`)}`,
        usedStepIds,
      );
      return {
        ...step,
        id: stepId,
      };
    });

    return {
      ...goal,
      id: goalId,
      ...(steps ? { steps } : {}),
    };
  });

  return { ...patch, upsertGoals };
}

function orderPatchByConversation(
  patch: ProgressTreePatch,
  turns: PatchTurnInput[],
): ProgressTreePatch {
  const turnOrder = new Map(turns.map((turn, index) => [turn.promptId, index]));
  const firstTurnIndex = (goal: ProgressGoal): number | undefined => {
    const steps = goal.steps ?? [];
    for (const step of steps) {
      const index = turnOrder.get(step.promptId);
      if (index !== undefined) return index;
    }
    return undefined;
  };

  const upsertGoals = patch.upsertGoals
    .map((goal) => ({
      ...goal,
      steps: goal.steps
        ? [...goal.steps].sort((a, b) => {
            const aIndex = turnOrder.get(a.promptId);
            const bIndex = turnOrder.get(b.promptId);
            if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
            if (aIndex !== undefined) return -1;
            if (bIndex !== undefined) return 1;
            return 0;
          })
        : goal.steps,
    }))
    .sort((a, b) => {
      const aIndex = firstTurnIndex(a);
      const bIndex = firstTurnIndex(b);
      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
      if (aIndex !== undefined) return -1;
      if (bIndex !== undefined) return 1;
      return 0;
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

  for (let i = 0; i < patch.upsertGoals.length; i++) {
    const goal = patch.upsertGoals[i];
    if (typeof goal.description !== 'string') {
      errors.push(`patch.upsertGoals[${i}].description must be a string`);
    }
    if (!Array.isArray(goal.steps) || goal.steps.length === 0) {
      errors.push(`patch.upsertGoals[${i}].steps must be a non-empty array`);
    }
    for (let j = 0; j < (goal.steps?.length ?? 0); j++) {
      const step = goal.steps?.[j];
      if (step && typeof step.description !== 'string') {
        errors.push(`patch.upsertGoals[${i}].steps[${j}].description must be a string`);
      }
    }
  }

  const treeErrors = validateProgressTree({
    version: patch.version,
    goals: patch.upsertGoals,
  });
  if (treeErrors.length > 0) {
    errors.push(...treeErrors.map((error) => `patch: ${error}`));
  }
  return errors;
}

function normalizeGoalStatus(goal: ProgressGoal): ProgressGoal {
  const steps = goal.steps;
  if (!steps || steps.length === 0) return goal;
  const activeSteps = steps.filter((step) => step.status !== 'deleted');
  if (activeSteps.length === 0) return goal;
  if (activeSteps.every((step) => step.status === 'completed')) {
    return { ...goal, status: 'completed' };
  }
  return goal;
}

function goalCharacterSize(goal: ProgressGoal): number {
  const base = goal.subject.length + (goal.description?.length ?? 0);
  const steps = goal.steps ?? [];
  return steps.reduce(
    (total, step) =>
      total + step.subject.length + (step.description?.length ?? 0),
    base,
  );
}

function splitGoal(goal: ProgressGoal): ProgressGoal[] {
  const steps = goal.steps ?? [];
  if (
    steps.length <= MAX_STEPS_PER_GOAL &&
    goalCharacterSize(goal) <= MAX_GOAL_CHARS
  ) {
    return [normalizeGoalStatus(goal)];
  }

  const baseChars = goal.subject.length + (goal.description?.length ?? 0);
  const groups: ProgressStep[][] = [];
  let current: ProgressStep[] = [];
  let currentChars = 0;

  for (const step of steps) {
    const stepChars = step.subject.length + (step.description?.length ?? 0);
    const shouldStartNewGroup =
      current.length >= MAX_STEPS_PER_GOAL ||
      (current.length > 0 && currentChars + stepChars > MAX_GOAL_CHARS - baseChars);
    if (shouldStartNewGroup) {
      groups.push(current);
      current = [step];
      currentChars = stepChars;
    } else {
      current.push(step);
      currentChars += stepChars;
    }
  }
  if (current.length > 0) groups.push(current);

  return groups.map((group, index) => {
    const baseGoal = index === 0
      ? { ...goal, steps: group }
      : {
          ...goal,
          id: `${goal.id}-part-${index + 1}`,
          subject: `${goal.subject} (${index + 1})`,
          steps: group,
        };
    return normalizeGoalStatus(baseGoal);
  });
}

function normalizeGoalSizes(tree: ProgressTree): ProgressTree {
  return {
    ...tree,
    goals: tree.goals.flatMap(splitGoal),
  };
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
  return normalizeGoalSizes({
    version,
    goals: Array.from(goals.values()).map(normalizeGoalStatus),
  });
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
  private similaritySplitting: boolean;

  constructor(options: LLMExtractionEngineOptions) {
    this.config = options.config;
    this.trace = options.trace;
    this.similaritySplitting = options.similaritySplitting ?? false;
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

  private async splitPatchBySimilarity(
    patch: ProgressTreePatch,
  ): Promise<ProgressTreePatch> {
    if (!this.similaritySplitting) return patch;
    const upsertGoals: ProgressGoal[] = [];
    for (const goal of patch.upsertGoals) {
      upsertGoals.push(...(await this.splitGoalBySimilarity(goal)));
    }
    return { ...patch, upsertGoals };
  }

  private async splitGoalBySimilarity(goal: ProgressGoal): Promise<ProgressGoal[]> {
    const steps = goal.steps ?? [];
    if (steps.length < 2) return [goal];

    const stepPairs = steps.slice(0, -1).map((step, index) => ({
      left: {
        promptId: step.promptId,
        subject: step.subject,
        description: step.description ?? '',
      },
      right: {
        promptId: steps[index + 1].promptId,
        subject: steps[index + 1].subject,
        description: steps[index + 1].description ?? '',
      },
    }));

    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: Math.min(this.config.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
        temperature: 0,
        system: SIMILARITY_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              goal: {
                subject: goal.subject,
                description: goal.description ?? '',
              },
              step_pairs: stepPairs,
            }),
          },
        ],
      } as Anthropic.MessageCreateParamsNonStreaming);

      const rawOutput = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      const jsonText = extractJsonObject(rawOutput);
      const parsed = JSON.parse(jsonText) as { scores?: Array<{ similarity?: number }> };
      const scores = Array.isArray(parsed.scores) ? parsed.scores : [];

      const groups: ProgressStep[][] = [[steps[0]]];
      for (let i = 1; i < steps.length; i++) {
        const similarity = scores[i - 1]?.similarity;
        if (typeof similarity === 'number' && similarity < SIMILARITY_THRESHOLD) {
          groups.push([]);
        }
        groups[groups.length - 1].push(steps[i]);
      }

      return groups.map((group, index) => {
        if (index === 0) {
          return normalizeGoalStatus({ ...goal, steps: group });
        }
        return normalizeGoalStatus({
          ...goal,
          id: `${goal.id}-part-${index + 1}`,
          subject: `${goal.subject} (${index + 1})`,
          steps: group,
        });
      });
    } catch {
      return [goal];
    }
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
    let rawResponse = '';
    let responseBlocks: Array<{
      type: string;
      characters?: number;
      preview?: string;
    }> = [];
    try {
      const requestParams = {
        model: this.config.model,
        max_tokens: maxTokens,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        response_format: { type: 'json_object' },
      };
      const response = await this.client.messages.create(
        requestParams as Anthropic.MessageCreateParamsNonStreaming,
      );
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

      responseBlocks = response.content.map((block) =>
        block.type === 'text'
          ? {
              type: block.type,
              preview: block.text.slice(0, 200),
              characters: block.text.length,
            }
          : {
              type: block.type,
              preview: JSON.stringify(block).slice(0, 200),
              characters: JSON.stringify(block).length,
            },
      );
      rawResponse = JSON.stringify(response);
      console.log(
        JSON.stringify({
          source: 'progress-plugin',
          level: 'response',
          timestamp: new Date().toISOString(),
          requestId: traceContext?.requestId,
          mode: traceContext?.mode,
          chunkIndex: traceContext?.chunkIndex,
          rawResponse,
        }),
      );
      rawOutput = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      const jsonText = extractJsonObject(rawOutput);
      const parsedResponse = JSON.parse(jsonText) as unknown;
      if (isObject(parsedResponse) && Array.isArray(parsedResponse.goals)) {
        if (traceContext?.mode !== 'full') {
          throw new Error('Incremental extraction requires a patch response');
        }
        const fullTree = parsedResponse as unknown as ProgressTree;
        const fullTreeErrors = validateProgressTree(fullTree);
        if (fullTreeErrors.length > 0) {
          throw new Error(`Schema validation failed: ${fullTreeErrors.join('; ')}`);
        }
        const normalizedFullTree = normalizeGoalSizes(fullTree);
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
        return normalizedFullTree;
      }

      const parsedPatch = parsedResponse as ProgressTreePatch;
      if (!isObject(parsedPatch) || !Array.isArray(parsedPatch.upsertGoals)) {
        throw new Error('Model response must contain patch.upsertGoals');
      }
      const repairedPatch = repairPatchIds(parsedPatch);
      const orderedPatch = orderPatchByConversation(repairedPatch, turns);
      const patch = await this.splitPatchBySimilarity(orderedPatch);
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
          rawResponse,
          contentBlocks: responseBlocks,
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
          rawResponse,
          contentBlocks: responseBlocks,
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
