import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn, LLMConfig, LLMExtractionEngine, ProgressTree } from './types.js';
import { validateProgressTree } from './schema.js';

export type { Anthropic };

export interface LLMExtractionEngineOptions {
  config: LLMConfig;
  client?: Anthropic;
}

const SYSTEM_PROMPT = `You are a session progress extractor. Your job is to analyze conversation turns and produce a two-level progress tree.

Rules:
1. Top-level nodes (goals) are high-level discussion topics or objectives identified across the conversation.
2. Every second-level node (step) must represent exactly one conversation turn. Use the turn's promptId as the step's promptId.
3. Do not merge multiple turns into a single step. If the same topic is discussed across multiple turns, create a separate step for each turn under the same goal.
4. Keep existing goal/step IDs stable when they still match the conversation. Only add new goals/steps, update status, or mark nodes completed based on the turns.
5. Mark a goal or step as completed only when the turn clearly indicates completion.
6. Use one clear sentence for each subject and one clear sentence for each description. Do not enforce character limits; focus on clarity and usefulness.
7. Detect the dominant language used by the user across the turns and generate the progress tree in that same language. Prefer the user's language over the assistant's.
8. Output ONLY valid JSON matching the ProgressTree schema. Do not wrap it in markdown.`;

function buildPrompt(tree: ProgressTree, turns: ConversationTurn[], strict = false): string {
  const base = `Current Progress Tree:
${JSON.stringify(tree, null, 2)}

Conversation Turns:
${JSON.stringify(turns.slice(-20), null, 2)}`;
  if (strict) {
    return (
      base +
      '\n\nIMPORTANT: Your previous output was invalid. This time output only raw JSON. No markdown, no explanation.'
    );
  }
  return base;
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in response');
  }
  return text.slice(start, end + 1);
}

export class LLMExtractionEngineImpl implements LLMExtractionEngine {
  private client: Anthropic;
  private config: LLMConfig;
  private usageListeners: ((usage: { inputTokens: number; outputTokens: number }) => void)[] = [];

  constructor(options: LLMExtractionEngineOptions) {
    this.config = options.config;
    this.client =
      options.client ??
      new Anthropic({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
        maxRetries: this.config.maxRetries ?? 3,
        timeout: this.config.requestTimeoutMs ?? 60_000,
      });
  }

  async extract(tree: ProgressTree, turns: ConversationTurn[]): Promise<ProgressTree> {
    try {
      return await this.doExtract(tree, turns, false);
    } catch (err) {
      // Retry once with a stricter prompt before giving up.
      return await this.doExtract(tree, turns, true);
    }
  }

  onUsage(callback: (usage: { inputTokens: number; outputTokens: number }) => void): () => void {
    this.usageListeners.push(callback);
    return () => {
      const idx = this.usageListeners.indexOf(callback);
      if (idx !== -1) {
        this.usageListeners.splice(idx, 1);
      }
    };
  }

  private async doExtract(
    tree: ProgressTree,
    turns: ConversationTurn[],
    strict: boolean,
  ): Promise<ProgressTree> {
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(tree, turns, strict) }],
    });

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    const jsonText = extractJsonObject(text);
    const parsed = JSON.parse(jsonText) as ProgressTree;

    const errors = validateProgressTree(parsed);
    if (errors.length > 0) {
      throw new Error('Schema validation failed: ' + errors.join('; '));
    }

    const usage = response.usage;
    this.usageListeners.forEach((cb) =>
      cb({
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
      }),
    );

    return parsed;
  }
}
