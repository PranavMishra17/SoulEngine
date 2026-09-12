# Diagnosis: memory, knowledge, tools, and evolution subsystems

Scope: TS runtime only (`src/core/*`, `src/mcp/*`, `src/schema/*`). Diagnosing what is
implemented today, not proposing a rewrite.

## Flow diagram (text)

```
NPCDefinition (authored, static)         NPCInstance (per player, mutable)
  core_anchor, personality_baseline        current_mood, trait_modifiers
  mcp_permissions, knowledge_access        relationships{playerId}
  network[] (other NPCs)                   short/long_term_memory[]
        |                                          |
        +--------------------+---------------------+
                             v
                 core/context.ts (assembleSystemPrompt /
                 assembleSlimSystemPrompt)
                             |
        +--------------------+---------------------+
        v                    v                     v
  core/knowledge.ts    core/memory.ts        core/personality.ts
  resolveKnowledge()   selectMemoriesFor      formatMoodForPrompt()
  (per-category         Prompt() / matchMem-  generatePersonality
   numeric depth)        oriesByQuery()        Description()
        |
        v
  Mind (core/mind.ts) gets getMindAvailableTools() -> one LLM call with
  the full offered tool set; Speaker gets no tools at all (slim prompt).
        |
        v
  cycles.ts: runDailyPulse / runWeeklyWhisper / runPersonaShift
  (invoked from routes/cycles.ts, unconditionally — no per-subsystem gate)
```

## Requested capabilities

**Tiered knowledge (common/faction/personal/secret).** Partial. A `KnowledgeCategory` is a
free-form id with a `depths: Record<number,string>` map (`src/types/knowledge.ts:1-5`), and
`resolveKnowledge` walks `access[categoryId]` and includes every depth `<= accessLevel`
(`src/core/knowledge.ts:38-62,74-127`). This gives numeric depth-gating per category, but there
is no built-in notion of audience tiers (common vs. faction vs. secret) — a project can name a
category `secrets`, but the resolver treats it identically to any other category, with no
distinct access model, leak protection, or NPC-to-NPC differentiation. `recall_knowledge`'s enum
is simply every category where `level > 0` (`src/core/tools.ts:347-349,368-383`).

**World events reaching NPCs.** Missing. The only event bus in the codebase,
`src/session/event-bus.ts:1-9`, is explicitly one-directional — "routes game events... from
pipeline callbacks to SSE stream subscribers," i.e., NPC-state-out to the client, not
world-state-in to the NPC. Nothing in `memory.ts`, `personality.ts`, or `cycles.ts` accepts an
external world-event payload; `DayContext` in `cycles.ts:46-53` (`events?: string[]`) is the
closest analog and it is only consumed by the manually-triggered daily-pulse route.

**NPC-to-NPC social web.** Partial. `NPCNetworkEntry` gives a static, authored graph — each NPC
lists up to ~20 others with a `familiarity_tier` (1-3), optional `mutual_awareness`, and
`reverse_context` (`src/types/npc.ts:55-68`). `formatKnownNpcs`/`formatKnownNpcsTier1Only`
render this into the prompt (`src/core/context.ts:508-534` and the parallel full-prompt
version), and `recall_npc`'s enum is constrained to these names (`src/core/tools.ts:319-329,
351-366`). What is missing is propagation: nothing updates this graph or feeds one NPC's
memories into another's based on what actually happened — it is a designer-authored map, not a
live social web.

**Immediate need or goal steering dialogue.** Missing. Neither `NPCDefinition` nor
`NPCInstance` has a goal/need/agenda field (`src/types/npc.ts:70-150`); nothing is rendered into
`assembleSystemPrompt` or `assembleSlimSystemPrompt` under that heading. This matches
`PRODUCT.md` §3.4's own table, which lists "Goals and agendas ... no (NEW-SPEC 2.2)."

**Relationship/sentiment toward the player.** Exists. `RelationshipState{trust, familiarity,
sentiment}` (`src/types/npc.ts:119-123`) lives per player in `instance.relationships`
(`src/types/npc.ts:146`), is rendered every turn via `formatRelationship`
(`src/core/context.ts:154-166`), and is nudged during Persona Shift based on trust/familiarity
thresholds (`src/core/cycles.ts:403-419`). It does not move on an ordinary turn from dialogue
content — only the periodic cycle touches it.

**Mood, annoyance, or patience.** Partial. `MoodVector{valence, arousal, dominance}`
(`src/types/npc.ts:17-21`) is real and is rendered every turn
(`src/core/personality.ts:112-163`, `src/core/context.ts:112-115`), but there is no distinct
annoyance or patience meter — dominance is the nearest proxy for "in control," not "running out
of patience." Per-turn mood movement is explicitly restricted to moderation events: "Mood drifts
only on moderation action; it does not move on an ordinary turn" (`src/conversation/turn.ts:427,
429-434`), and it also decays gently toward neutral at session end
(`src/session/manager.ts:388-390`) and during the daily-pulse cycle
(`src/core/cycles.ts:108-119`). So mood exists as a slow background variable, not a live reaction
to what the player just said.

**Conditional tool visibility (game-state gated).** Missing. Filtering is entirely static and
author-time: `getAvailableTools`/`getMindAvailableTools` intersect `mcp_permissions
.conversation_tools` minus `denied` (`src/core/tools.ts:49-64,81-132,338-430`). Nothing consults
live game state (door locked, quest active, item held) to add or remove a tool per turn — the
only per-call adjustment is populating `recall_npc`/`recall_knowledge` enums from the NPC's own
static network and knowledge-access maps (`src/core/tools.ts:346-383`), and force-adding
`exit_convo` when `securityContext.exitRequested` (`src/core/tools.ts:112-119,415-418`), which is
a moderation signal, not a game-state one.

**Quest state.** Partial/missing as a first-class concept. `update_quest` exists only as one of
six default game-event tool definitions a project can register
(`src/mcp/registry.ts:293-315`) — it is a tool the NPC (or game code) can *call*, not something
tracked in `NPCInstance`/`SessionState` that in turn steers what the NPC says. No quest-state
field exists in `src/types/npc.ts` or `src/schema/index.ts`, so quest progress cannot condition a
prompt section or a tool's availability.

## Tool exposure, cooldowns, exit handling

Tools are exposed **all at once, in one list, per LLM call** — never progressively filtered
mid-turn. `getMindAvailableTools` (`src/core/tools.ts:338-430`) is the only path actually wired
into the runtime (`src/core/mind.ts:332,344`, `src/harness/diagnostics.ts:77`); the plain
`getAvailableTools` (`src/core/tools.ts:81-132`) is defined but has no caller in `src/`, and the
Speaker gets no tools at all — `assembleSlimSystemPrompt`'s comment says it "omits world
knowledge and tools" (`src/core/context.ts:628-632`). The set offered to Mind is: three built-in
recall tools with enum-constrained parameters, plus the NPC's permitted conversation tools, plus
`exit_convo` always (`src/core/tools.ts:346-413`).

Cooldowns are pluggable-store-backed and scoped to moderation-triggered exits only.
`CooldownStore` is an interface with an in-memory default (`src/mcp/cooldown-store.ts:37-136`);
`CooldownTracker` keys on `projectId:principal:npcId` (`src/mcp/exit-handler.ts:118-189`), and a
cooldown is applied only when `exitResult.forcedByModeration` is true
(`src/mcp/exit-handler.ts:60-84,217-231`) — a voluntary, in-character `exit_convo` call carries no
cooldown. `exit_convo` itself cannot be denied (`src/core/tools.ts:141-145`) and is force-added
whenever `securityContext.exitRequested` is set, independent of NPC permissions
(`src/core/tools.ts:112-119,415-418`).

## Subsystem toggles

None exist at the runtime level. `ContextAssemblyOptions` only toggles two *prompt sections* —
`includeKnowledge` and `includeMemories` (`src/core/context.ts:24-43`) — not the underlying
subsystems. `runDailyPulse`, `runWeeklyWhisper`, and `runPersonaShift` execute unconditionally
whenever their routes are hit (`src/routes/cycles.ts:94,186,256`), with no per-NPC or
per-project flag gating personality drift or relationship movement. The only per-NPC dial is
`salience_threshold` (`src/types/npc.ts:85-91`, consumed at `src/core/cycles.ts:171-177,
202`), which tunes memory promotion, not an on/off switch, and memory itself has no toggle
(consistent with `PRODUCT.md` §3.4 treating memory as always-on). This confirms §3.4's own
"Exists today" column: personality-drift and relationship *mechanisms* exist, but no toggle
mechanism wraps any of them, and opinions/beliefs and goals/agendas do not exist at all.

## NPC definition data model

`NPCDefinition` (`src/types/npc.ts:70-109`, mirrored in `src/schema/index.ts:96-113`): id,
project_id, name, description, `core_anchor` (backstory/principles/trauma_flags, immutable),
`personality_baseline` (Big Five), `voice`, `schedule` (time-blocks), `mcp_permissions`
(conversation/game-event/denied lists), `knowledge_access` (category-id -> depth number),
`network` (up to ~20 `NPCNetworkEntry`), optional `player_recognition`, optional
`salience_threshold`, `profile_image`, `status`, `version`. `NPCInstance`
(`src/types/npc.ts:136-149`) carries the mutable side: `current_mood`, `trait_modifiers`,
short/long-term memory arrays, `relationships` keyed by player id, `daily_pulse`, and
`cycle_metadata` (last-run timestamps for the two heavier cycles). Both are versioned zod
schemas in `src/schema/index.ts:96-163`, which is the source of runtime validation. Nowhere in
either type is there a slot for opinions/beliefs, goals/agendas, quest state, or inbound world
events — the diagnosis above is a direct consequence of the data model, not just missing glue
code.

## Five smallest changes to unlock the missing capabilities

1. **Add a `goals: { text: string; priority: number }[]` field to `NPCInstance`**, rendered as a
   new `[CURRENT GOALS]` section in `src/core/context.ts` next to `formatRelationship` — closes
   the "immediate need/goal" gap with no new subsystem, just a field plus one formatter.
2. **Add an inbound event ingestion point**: a `POST` route (mirroring `src/routes/cycles.ts`'s
   pattern) that appends a `Memory` via `createMemory` (`src/core/memory.ts:17-33`) tagged as a
   world event, so at least memory-mediated world-event awareness exists before a dedicated bus
   is built.
3. **Add per-subsystem boolean flags to `NPCDefinition`** (e.g.
   `evolution: { personality_drift: boolean; relationship_drift: boolean }`) and check them at
   the top of `runPersonaShift` (`src/core/cycles.ts:305-311`) and the relationship-drift loop
   inside it (`src/core/cycles.ts:404-419`) — this alone satisfies §3.4's toggle requirement for
   the two subsystems that already exist.
4. **Wire a `gameState: Record<string, boolean>` parameter into `getMindAvailableTools`** and
   filter `conversationToolNames` against an optional `visible_when` map on each registered
   `Tool`, giving conditional tool visibility without touching the static-permission path used
   elsewhere.
5. **Add a `quest_state: Record<string, string>` field to `NPCInstance`** (schema-validated
   alongside `relationships` in `src/schema/index.ts:150-163`) and surface it as a prompt
   section the same way `formatRelationship` does, so `update_quest` calls
   (`src/mcp/registry.ts:293-313`) have somewhere durable to land and something for the prompt to
   read back from.
