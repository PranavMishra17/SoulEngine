/**
 * Zod schemas for conversation replay fixtures and evaluation harness.
 *
 * These schemas validate offline test fixtures for measuring NPC cognition
 * behavior without real API calls.
 */

import { z } from 'zod';
import { NPCDefinitionSchema, NPCInstanceSchema, KnowledgeBaseSchema, PlayerInfoSchema } from './index.js';

/**
 * A scripted LLM response for the stub provider.
 */
export const StubResponseSchema = z.object({
  /** Text content to return */
  text: z.string().optional(),
  /** Tool calls to return */
  toolCalls: z.array(z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.any()),
  })).optional(),
  /** Artificial latency in milliseconds (overrides default) */
  latencyMs: z.number().min(0).optional(),
});

/**
 * Expectations for a single turn in a conversation fixture.
 */
export const TurnExpectationsSchema = z.object({
  /** Facts that SHOULD appear in the reply or prompt */
  recallFacts: z.array(z.string()).optional(),
  /** Tool names that SHOULD be called */
  toolsCalled: z.array(z.string()).optional(),
  /** Tool names that SHOULD NOT be called */
  toolsNotCalled: z.array(z.string()).optional(),
});

/**
 * A single turn in a conversation fixture.
 */
export const FixtureTurnSchema = z.object({
  /** Player's input text */
  playerInput: z.string(),
  /** Scripted responses for Mind agent (in order) */
  mindResponses: z.array(StubResponseSchema),
  /** Scripted responses for Speaker (in order) */
  speakerResponses: z.array(StubResponseSchema),
  /** Optional expectations for this turn */
  expectations: TurnExpectationsSchema.optional(),
});

/**
 * A complete conversation fixture for replay testing.
 */
export const ConversationFixtureSchema = z.object({
  /** Human-readable fixture name */
  name: z.string().min(1),
  /** Description of what this fixture tests */
  description: z.string().min(1),
  /** NPC setup */
  npc: z.object({
    definition: NPCDefinitionSchema,
    instance: NPCInstanceSchema,
    knowledgeBase: KnowledgeBaseSchema.optional(),
  }),
  /** Optional player info */
  playerInfo: PlayerInfoSchema.optional().nullable(),
  /** Conversation turns */
  turns: z.array(FixtureTurnSchema),
});

/**
 * Re-export inferred types
 */
export type StubResponse = z.infer<typeof StubResponseSchema>;
export type TurnExpectations = z.infer<typeof TurnExpectationsSchema>;
export type FixtureTurn = z.infer<typeof FixtureTurnSchema>;
export type ConversationFixture = z.infer<typeof ConversationFixtureSchema>;
