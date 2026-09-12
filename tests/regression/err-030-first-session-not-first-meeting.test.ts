/**
 * ERR-030: with no relationship record and no revealed player identity, the
 * Speaker prompt used to say "This is your first interaction with this person"
 * and "Treat them as a stranger". Models obeyed that over the conversation
 * history and denied what the player had said two turns earlier (4 of 5 trials
 * on both Gemini and OpenAI, research/09-npc-runtime/BASELINE.md).
 *
 * The sections must describe a first *session*, not a first *utterance*: no
 * shared past before this conversation, and everything said in it still counts.
 * The live gate is tests/fixtures/playground/deferred-recall-strict.json.
 */
import { describe, it, expect } from 'vitest';
import { assembleSlimSystemPromptParts } from '../../src/core/context.js';
import type { NPCDefinition, NPCInstance } from '../../src/types/npc.js';
import type { SecurityContext } from '../../src/types/security.js';

const definition = {
  id: 'npc-030',
  project_id: 'proj-030',
  name: 'Mira',
  description: 'A harbourmaster.',
  personality_baseline: { openness: 0.5, conscientiousness: 0.6, extraversion: 0.4, agreeableness: 0.5, neuroticism: 0.3 },
  core_anchor: { backstory: 'Twenty years at the harbour office.', principles: ['honesty'], trauma_flags: [] },
  network: [],
  schedule: [],
  player_recognition: { reveal_player_identity: false },
} as unknown as NPCDefinition;

/** A player in their first session: no relationship record yet. */
const firstSessionInstance = {
  id: 'inst-030',
  npc_id: 'npc-030',
  player_id: 'player-1',
  current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
  relationships: {},
  short_term_memory: [],
  long_term_memory: [],
  trait_modifiers: {},
  daily_pulse: null,
} as unknown as NPCInstance;

const security = {
  sanitized: true,
  moderated: true,
  rateLimited: false,
  exitRequested: false,
  moderationFlags: [],
  inputViolations: [],
} as unknown as SecurityContext;

/** The player has a name in the game but this NPC is not told it. */
const unrevealedPlayer = { id: 'player-1', name: 'Traveller' } as never;

const FIRST_MEETING_PHRASES = /first interaction with this person|treat them as a stranger|don't know who this person is/i;

describe('ERR-030: a first session is not a first meeting mid-conversation', () => {
  it('no longer tells the Speaker it is meeting the player for the first time on every turn', async () => {
    const { dynamic } = await assembleSlimSystemPromptParts(
      definition,
      firstSessionInstance,
      security,
      {},
      unrevealedPlayer,
      null
    );

    expect(dynamic).toContain('[RELATIONSHIP TO PLAYER]');
    expect(dynamic).toContain("[THE PERSON YOU'RE TALKING TO]");
    expect(dynamic).not.toMatch(FIRST_MEETING_PHRASES);
  });

  it('scopes the missing history to the time before this conversation and keeps in-conversation statements binding', async () => {
    const { dynamic } = await assembleSlimSystemPromptParts(
      definition,
      firstSessionInstance,
      security,
      {},
      unrevealedPlayer,
      null
    );

    expect(dynamic).toMatch(/before this conversation/i);
    expect(dynamic).toMatch(/said earlier in this conversation still happened|told you during this conversation/i);
  });

  it('leaves the known-relationship rendering unchanged', async () => {
    const known = {
      ...firstSessionInstance,
      relationships: { 'player-1': { trust: 0.8, familiarity: 0.9, sentiment: 0.7 } },
    } as unknown as NPCInstance;
    const { dynamic } = await assembleSlimSystemPromptParts(definition, known, security, {}, null, null);

    expect(dynamic).toMatch(/Trust level: very high/);
    expect(dynamic).toMatch(/Familiarity: very high/);
  });
});
