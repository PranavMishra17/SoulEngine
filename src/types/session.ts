import { NPCInstance } from './npc.js';
import type { ConversationMode } from './voice.js';

export type SessionID = string;

/**
 * Player information for session initialization
 */
export interface PlayerInfo {
  /** Player's character name (for NPC to address them) */
  name: string;
  /** Brief description visible to NPC */
  description?: string;
  /** Player's role/title if relevant */
  role?: string;
  /** Custom context for this conversation */
  context?: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface SessionState {
  session_id: SessionID;
  project_id: string;
  definition_id: string;
  instance: NPCInstance;
  conversation_history: Message[];
  created_at: string;
  last_activity: string;
  player_id: string;
  /** Player info passed at session start (if any) */
  player_info: PlayerInfo | null;
  /** Conversation mode for this session */
  mode: ConversationMode;
}

export interface SessionInitRequest {
  project_id: string;
  npc_id: string;
  player_id: string;
  /** If provided and NPC has can_know_player=true, NPC will know the player */
  player_info?: PlayerInfo;
  /** Conversation mode - defaults to text-text */
  mode?: ConversationMode;
}

export interface SessionEndResponse {
  success: boolean;
  version: string;
}

