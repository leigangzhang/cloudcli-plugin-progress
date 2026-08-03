 import type {
   ConversationSegment,
   ContentBlock,
   LogEntry,
   ToolResultSummary,
   ToolUseSummary,
 } from './types.js';

 const DEFAULT_MAX_ENTRIES = 200;
 const EXCERPT_LIMIT = 2000;

 function summarize(value: unknown): string {
   try {
     return JSON.stringify(value).slice(0, EXCERPT_LIMIT);
   } catch {
     return '';
   }
 }

 function latestTimestamp(entries: LogEntry[]): string {
   return entries.reduce((max, e) => {
     if (!e.timestamp) return max;
     return e.timestamp > max ? e.timestamp : max;
   }, '');
 }

 export class ConversationBuffer {
   private entries: LogEntry[] = [];
   private maxEntries: number;

   constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
     this.maxEntries = maxEntries;
   }

   push(entry: LogEntry): void {
     this.entries.push(entry);
     if (this.entries.length > this.maxEntries) {
       this.entries.shift();
     }
   }

   getSegments(limit = 10): ConversationSegment[] {
     const groups = new Map<string, LogEntry[]>();
     for (const entry of this.entries) {
       const key = entry.promptId ?? entry.uuid ?? 'unknown';
       if (!groups.has(key)) {
         groups.set(key, []);
       }
       groups.get(key)!.push(entry);
     }

     const sorted = Array.from(groups.values()).sort((a, b) =>
       latestTimestamp(a).localeCompare(latestTimestamp(b)),
     );
     return sorted.slice(-limit).map((entries) => this.buildSegment(entries));
   }

   private buildSegment(entries: LogEntry[]): ConversationSegment {
     const thinkingParts: string[] = [];
     const textParts: string[] = [];
     const toolUses: ToolUseSummary[] = [];
     const toolResults: ToolResultSummary[] = [];
     let role: ConversationSegment['role'] = 'system';
     let stopReason: string | undefined;

     for (const entry of entries) {
       if (entry.type === 'assistant') {
         role = 'assistant';
         stopReason = (entry.stopReason ?? entry.message?.stop_reason) || stopReason;
         const blocks = entry.content ?? entry.message?.content ?? [];
         for (const block of blocks) {
           this.processAssistantBlock(block, thinkingParts, textParts, toolUses);
         }
       } else if (entry.type === 'user') {
         if (role !== 'assistant') {
           role = 'user';
         }
         const blocks = entry.content ?? entry.message?.content ?? [];
         for (const block of blocks) {
           this.processUserBlock(block, textParts, toolResults);
         }
       }
     }

     return {
       promptId: entries[0]?.promptId,
       role,
       thinkingExcerpt: thinkingParts.join('\n').slice(0, EXCERPT_LIMIT) || undefined,
       textExcerpt: textParts.join('\n').slice(0, EXCERPT_LIMIT) || undefined,
       toolUses,
       toolResults,
       stopReason,
       timestamp: latestTimestamp(entries),
     };
   }

   private processAssistantBlock(
     block: ContentBlock,
     thinkingParts: string[],
     textParts: string[],
     toolUses: ToolUseSummary[],
   ): void {
     if (block.type === 'thinking') {
       thinkingParts.push(block.thinking);
     } else if (block.type === 'text') {
       textParts.push(block.text);
     } else if (block.type === 'tool_use') {
       toolUses.push({
         id: block.id,
         name: block.name,
         inputSummary: summarize(block.input),
       });
     }
   }

   private processUserBlock(
     block: ContentBlock,
     textParts: string[],
     toolResults: ToolResultSummary[],
   ): void {
     if (block.type === 'text') {
       textParts.push(block.text);
     } else if (block.type === 'tool_result') {
       toolResults.push({
         toolUseId: block.tool_use_id,
         isError: block.is_error,
         summary: summarize(block.content),
       });
     }
   }
 }
