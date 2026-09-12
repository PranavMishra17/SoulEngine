import type { NPCDefinition, NPCInstance } from '../types/npc.js';
import type { KnowledgeBase } from '../types/knowledge.js';
import type { Tool, ToolCall } from '../types/mcp.js';
import type { MindResult, MindToolResult } from '../types/mind.js';
import type { SecurityContext } from '../types/security.js';
import type { LLMProvider, LLMMessage } from '../providers/llm/interface.js';
import type { TurnTimings } from '../conversation/turn.js';
import type { MCPToolRegistry } from '../mcp/registry.js';
import { ParallelRuntime } from './runtime/parallel.js';

/**
 * Input to a cognition runtime for a single conversation turn.
 */
export interface CognitionInput {
  /** System prompt split into stable (cacheable) and dynamic parts */
  prompt: { stable: string; dynamic: string };
  /** Conversation history (LLM message format) */
  history: LLMMessage[];
  /** Player's sanitized input for this turn */
  playerInput: string;
  /** Tools available to the NPC this turn (project-level MCP tools) */
  tools: Record<string, Tool>;
  /** Tool registry for executing MCP tools */
  toolRegistry: MCPToolRegistry;
  /** LLM providers for mind and speaker */
  providers: { speaker: LLMProvider; mind: LLMProvider };
  /** Cache key for provider-level prompt caching */
  cacheKey: string;
  /** Abort signal for timeout control */
  signal: AbortSignal;
  /** Session and NPC context */
  context: {
    definition: NPCDefinition;
    instance: NPCInstance;
    knowledgeBase: KnowledgeBase | null;
    projectId: string;
    sessionId: string;
    securityContext: SecurityContext;
    userId?: string | null;
  };
}

/**
 * Events yielded by a cognition runtime during turn generation.
 */
export type CognitionEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; result: MindToolResult }
  | { type: 'follow_up'; delta: string }
  | { type: 'done'; summary: CognitionSummary };

/**
 * Summary of a completed cognition turn.
 */
export interface CognitionSummary {
  /** Complete speech text */
  speech: string;
  /** Follow-up speech after MCP actions, or null */
  followUp: string | null;
  /** Tool calls made by the Mind */
  toolCalls: ToolCall[];
  /** Results of executed tools */
  toolResults: MindToolResult[];
  /** Exit conversation result, if requested */
  exit: { requested: boolean; reason: string | null } | null;
  /** Recall context deferred to the next turn (parallel runtime only) */
  deferredForNextTurn: string | null;
  /** Timing measurements */
  timings: TurnTimings;
  /** Token usage per leg */
  usage: {
    speaker?: { input_tokens: number; output_tokens: number; cached_input_tokens?: number };
    mind?: { input_tokens: number; output_tokens: number };
    followUp?: { input_tokens: number; output_tokens: number; cached_input_tokens?: number };
  };
  /** True when speaker usage is estimated rather than provider-reported */
  usageEstimated: boolean;
  /** Full Mind result for session log (parallel runtime only) */
  mindResult: MindResult | null;
}

/**
 * A cognition runtime implements the NPC's decision-making and speech generation
 * for a single conversation turn.
 */
export interface CognitionRuntime {
  /** Runtime identifier */
  readonly name: 'parallel' | 'single';
  /** Generate a turn, yielding events as they occur */
  generate(input: CognitionInput): AsyncIterable<CognitionEvent>;
}

/**
 * Select a cognition runtime by name.
 * @throws Error if the runtime name is unknown
 */
export function selectRuntime(name: 'parallel' | 'single'): CognitionRuntime {
  if (name === 'parallel') {
    return new ParallelRuntime();
  }

  throw new Error(`Unknown cognition runtime: ${name}`);
}
