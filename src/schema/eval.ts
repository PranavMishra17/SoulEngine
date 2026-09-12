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
 * Expectations for a turn in a playground scenario.
 */
export const PlaygroundExpectationSchema = z.object({
  /** Turn number (1-indexed) */
  turn: z.number().int().min(1),
  /** Tool names that SHOULD be called */
  toolsCalled: z.array(z.string()).optional(),
  /** Tool names that SHOULD NOT be called */
  toolsNotCalled: z.array(z.string()).optional(),
  /** Facts that SHOULD appear in the reply */
  recallFacts: z.array(z.string()).optional(),
  /** Regex pattern that SHOULD match the reply */
  replyMatches: z.string().optional(),
  /** Whether exit_convo SHOULD be requested */
  exitRequested: z.boolean().optional(),
  /** Expected moderation action (allow, block, warn) */
  moderationAction: z.string().optional(),
});

/**
 * A world event to inject between turns in a playground scenario.
 */
export const PlaygroundEventSchema = z.object({
  /** Inject this event after this turn number */
  afterTurn: z.number().int().min(0),
  /** Event description text */
  text: z.string().min(1),
  /** Salience (0-1), defaults to 0.5 */
  salience: z.number().min(0).max(1).optional(),
});

/**
 * A playground scenario for live or cassette-recorded play.
 *
 * Reuses the fixture's NPC structure but adds scripted player dialogue,
 * event injection, and expectations for real (not stubbed) model behavior.
 */
export const PlaygroundScenarioSchema = z.object({
  /** Human-readable scenario name */
  name: z.string().min(1),
  /** Description of what this scenario tests */
  description: z.string().min(1),
  /** Embedded NPC definition and instance */
  npc: z.object({
    definition: NPCDefinitionSchema,
    instance: NPCInstanceSchema,
    knowledgeBase: KnowledgeBaseSchema.optional(),
  }).optional(),
  /** Reference to an existing NPC by id */
  npcId: z.string().optional(),
  /** Player configuration */
  player: z.object({
    /** Player id, defaults to 'playground-player' */
    id: z.string().optional(),
    /** Scripted player lines, one per turn */
    script: z.array(z.string()),
  }).optional(),
  /** World events to inject between turns */
  events: z.array(PlaygroundEventSchema).optional(),
  /** Expectations to evaluate */
  expect: z.array(PlaygroundExpectationSchema).optional(),
  /** Number of trials to run (default 1) */
  trials: z.number().int().min(1).optional(),
}).refine(
  (data) => (data.npc && !data.npcId) || (!data.npc && data.npcId),
  { message: 'Exactly one of npc or npcId must be provided' }
);

/**
 * Re-export inferred types
 */
export type StubResponse = z.infer<typeof StubResponseSchema>;
export type TurnExpectations = z.infer<typeof TurnExpectationsSchema>;
export type FixtureTurn = z.infer<typeof FixtureTurnSchema>;
export type ConversationFixture = z.infer<typeof ConversationFixtureSchema>;
export type PlaygroundExpectation = z.infer<typeof PlaygroundExpectationSchema>;
export type PlaygroundEvent = z.infer<typeof PlaygroundEventSchema>;
export type PlaygroundScenario = z.infer<typeof PlaygroundScenarioSchema>;
