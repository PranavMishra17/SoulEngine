import { NPCInstance } from './npc.js';

export type SessionID = string;

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
}

export interface SessionInitRequest {
  project_id: string;
  npc_id: string;
  player_id: string;
}

export interface SessionEndResponse {
  success: boolean;
  version: string;
}

