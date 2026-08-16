import type { ConversationTurn, SessionLogEntry } from '../types.js';

export type CodexLogEntryType =
  | 'session_meta'
  | 'turn_context'
  | 'world_state'
  | 'event_msg'
  | 'response_item';

export interface CodexEntryWithLine {
  entry: SessionLogEntry;
  lineNumber: number;
}

export interface CodexTurnBuilderOutput extends ConversationTurn {
  entryCount: number;
}
