/**
 * Token and usage tracking types for SoulEngine conversations.
 */

/**
 * Token/character usage for a single conversation session.
 * All numeric fields start at 0 and are accumulated throughout the session.
 */
export interface SessionTokenUsage {
    /** LLM input tokens estimated for text turns (system prompt + history + user message) */
    text_input_tokens: number;
    /** LLM output tokens estimated for text turns (NPC response) */
    text_output_tokens: number;
    /** Characters transcribed by STT (voice input proxy) */
    voice_input_chars: number;
    /** Characters synthesized by TTS (voice output proxy) */
    voice_output_chars: number;
}

/** Project-level accumulated usage totals across all conversations */
export interface ProjectUsageTotals {
    total_conversations: number;
    text_input_tokens: number;
    text_output_tokens: number;
    voice_input_chars: number;
    voice_output_chars: number;
    updated_at: string;
}

/** A single saved conversation transcript with full message history */
export interface ConversationTranscript {
    id: string;
    project_id: string;
    npc_id: string;
    player_id: string;
    session_id: string;
    started_at: string;
    ended_at: string;
    /** e.g. "text-text", "voice-voice", "text-voice" */
    mode: string;
    messages: Array<{ role: string; content: string }>;
    token_usage: SessionTokenUsage;
}

/** Summary of a transcript (for listing — no full messages, just count) */
export interface ConversationTranscriptSummary {
    id: string;
    project_id: string;
    npc_id: string;
    player_id: string;
    session_id: string;
    started_at: string;
    ended_at: string;
    mode: string;
    message_count: number;
    token_usage: SessionTokenUsage;
}

/** Create an empty token usage object */
export function emptyTokenUsage(): SessionTokenUsage {
    return {
        text_input_tokens: 0,
        text_output_tokens: 0,
        voice_input_chars: 0,
        voice_output_chars: 0,
    };
}
