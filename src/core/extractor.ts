 import Anthropic from '@anthropic-ai/sdk';
 import type {
   ConversationSegment,
   LLMConfig,
   LLMExtractionEngine,
   ProgressTree,
 } from './types.js';
 import { validateProgressTree } from './schema.js';

 export type { Anthropic };

 export interface LLMExtractionEngineOptions {
   config: LLMConfig;
   client?: Anthropic;
 }

 const SYSTEM_PROMPT = `You are a session progress extractor. Your job is to analyze new conversation segments and update the progress tree accordingly.

 Rules:
 1. Keep existing IDs stable. Only add, update, or mark nodes as completed based on the new segments.
 2. Add new goals when a new high-level objective is identified.
 3. Add steps under a goal when concrete actions are taken.
 4. Mark a goal or step as completed only when the segment clearly indicates completion.
 5. Each subject must be <= 60 characters. Each description must be <= 120 characters.
 6. Use concise, action-oriented language.
 7. Output ONLY valid JSON matching the ProgressTree schema. Do not wrap it in markdown.`;

 function buildPrompt(tree: ProgressTree, segments: ConversationSegment[], strict = false): string {
   const base = `Current Progress Tree:
 ${JSON.stringify(tree, null, 2)}

 New Conversation Segments:
 ${JSON.stringify(segments.slice(-10), null, 2)}`;
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

   async extract(tree: ProgressTree, segments: ConversationSegment[]): Promise<ProgressTree> {
     try {
       return await this.doExtract(tree, segments, false);
     } catch (err) {
       // Retry once with a stricter prompt before giving up.
       return await this.doExtract(tree, segments, true);
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
     segments: ConversationSegment[],
     strict: boolean,
   ): Promise<ProgressTree> {
     const response = await this.client.messages.create({
       model: this.config.model,
       max_tokens: 4096,
       system: SYSTEM_PROMPT,
       messages: [{ role: 'user', content: buildPrompt(tree, segments, strict) }],
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
