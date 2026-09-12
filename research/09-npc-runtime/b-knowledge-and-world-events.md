# How NPCs know things: knowledge tiers, world events, the social web, immediate needs

Research pass 09-B, 2026-09-12. Claim ledger with every raw candidate and its fate:
[`raw/b-knowledge-and-world-events.md`](raw/b-knowledge-and-world-events.md) (32 claims, 8 verified,
4 survived). Provenance labels follow [`../README.md`](../README.md). Every surviving source is older
than 2025: a 2012 Valve GDC talk and Dwarf Fortress wiki pages. Nothing from the LLM-era platforms
was retrievable, so sub-question 5 is a coverage gap, not an answer.

## The headline

The only shipped, first-party-documented mechanism for scoping what an NPC knows is Valve's
response-rules system: knowledge is a flat table of key:value facts, content is gated by ANDed
criteria over that table, and a criterion referencing a fact the NPC does not have rejects outright.
That is a hard, pre-LLM filter for "never let the NPC know what it should not", the property we most
need and the one the current runtime lacks. The same system writes facts back into a persistent
per-character store with optional expiry, and re-evaluates every follow-up line's criteria at the
moment it is due, so a mid-conversation world event changes the next line with no interrupt logic.
Dwarf Fortress adds the one community-documented decay model: rumor detail fades over weeks to years
while the reputation it created persists. Every LLM-era claim we tested (Generative Agents scoring
and diffusion numbers, PIANO's Cognitive Controller) was refuted, mostly on provenance, and two
misquoted the paper's own numbers. Nobody we could verify has shipped a token budget, a retrieval
trigger, or a social-graph propagation model for an LLM NPC; those numbers must come from our harness.

## 1. Knowledge scoping precedents

**Finding 1.1 - high (3-0), demonstrated.** Valve's Left 4 Dead 2 dialogue system represents the
world as a flat associative "query" of key:value facts and selects content with "rules", each a tuple
of criteria that are ANDed. "If one is false, or one mentions a fact not in the query, then the rule is
considered to reject." When several rules match, the shipped scoring function counts matched criteria,
so the most specific rule wins with no per-criterion weighting
(https://cdn.akamai.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf). Three
verifiers found the quote and the counting rule verbatim in the PDF.

The transferable part is the rejection rule. A tier is a criterion: a faction-scoped fact requires
`faction:ironguard`, and an NPC whose table lacks that entry cannot match it. Scope is enforced by
absence, the cheapest possible check, and does not depend on the model obeying an instruction.

*Code today does something weaker.* Knowledge is a per-category numeric depth: `resolveCategoryKnowledge`
includes every depth `<= accessLevel` (`src/core/knowledge.ts:38-62`) and `recall_knowledge` picks a
category by case-insensitive substring match on its id or description (`src/core/mind.ts:192-232`). There
is no audience notion (common / faction / personal / secret), no criterion reading world or
relationship state, and the Speaker prompt omits world knowledge (`src/core/context.ts:626`), so
knowledge reaches the reply only through the one-turn-late `[MIND CONTEXT]` splice
(`src/conversation/turn.ts:277-286`). See [`diagnosis/memory-knowledge-tools.md`](diagnosis/memory-knowledge-tools.md).

**Finding 1.2 - medium (2-1), community.** Dwarf Fortress separates rumor detail from reputation:
"The knowledge fades over the course of weeks and years, while maintaining longer-term reputation
effects" (https://dwarffortresswiki.org/index.php/Rumor). The dissent was about the label, not the
mechanic; a fan wiki with no developer citation is community. This is the precedent for two layers: an
ephemeral fact ("the bridge fell last week") and a durable disposition ("the mayor is unreliable") that
outlives it, consistent with the Sims 2 decay triple adopted in `PRODUCT.md` section 3.4.

## 2. World-event propagation

**Finding 2.1 - high (3-0), demonstrated.** Valve's rules write facts back into a persistent
per-character or per-world memory table, including facts with automatic expiry: "you can have
automatic expiration times on a particular fact, if you want to prevent two successive bits of a
running gag from being played too close together"
(https://cdn.akamai.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf). The
API names "remember"/ApplyFacts do not appear in the deck; do not cite it for them.

This is the shipped shape for a world-event inbox: a fact with a scope tag and optional TTL, appended
to the NPC's table and concatenated into the next query. `PRODUCT.md` section 3.7 item 7 already notes
the TTL is pacing, not salience decay; with finding 1.2 that gives TTL on the fact, decay curve on the
disposition it produced.

*Code today has no inbound path.* The only event bus is outbound, "from pipeline callbacks to SSE
stream subscribers" (`src/session/event-bus.ts:1-9`), and `DayContext.events` (`src/core/cycles.ts:46-53`)
is consumed only by the manually triggered daily pulse.

**Finding 2.2 - medium (2-1), demonstrated.** A line's response can dispatch a follow-up to one
character or broadcast "then any concept" to everyone in earshot, and "Ellis does a lookup for a reply
based on the context at exactly the moment he begins speaking... the conversation self-terminates
because the criteria for its existence are no longer true"
(https://cdn.akamai.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf). The
dissent is about transfer, not truth: this is bark selection, not a streaming LLM turn. As a pattern
it says two things: a world event should be visible to the very next line, and proximity broadcast
("everyone in earshot") is the shipped scoping rule for NPC-to-NPC propagation.

*Code today does the opposite on timing.* The Speaker commits and saves its reply
(`src/conversation/turn.ts:327`) before `await mindPromise` (`turn.ts:329`); any fact the Mind retrieved
is spliced in one turn later (`turn.ts:366-370`; `src/core/context.ts:769-775`). In voice the same
ordering holds (`src/voice/pipeline.ts:912-931, 1069-1072`).

No claim about delay or hop latency survived (ledger item 21 was dropped as unfalsifiable);
Generative Agents' diffusion percentages were refuted (see below).

## 3. Social web

Only finding 2.2 speaks to this: NPC-to-NPC state reaches a line through the same fact table plus a
proximity-scoped broadcast. Nothing on Nemesis, CK3, Sims or Dwarf Fortress relationship graphs was
retrieved; the Nemesis GDC talk was unreadable (see gaps).

*Code today:* `NPCNetworkEntry` is a static authored graph with a 1-3 familiarity tier
(`src/types/npc.ts:55-68`); the slim prompt flattens it to Tier 1 name-plus-description
(`src/core/context.ts:508-534`) and does one storage read per entry on the critical path. Nothing
updates it from what happened.

## 4. Immediate needs and drives

**No evidence survived.** Utility AI, Sims needs, RimWorld mood and GOAP were not reached; the Dave
Mark GDC talk was unreadable. Finding 2.1 is the nearest thing: a need as a high-priority fact with a
TTL that rules requiring it score higher on, but no shipped source shows this steering dialogue.

*Code today:* no goal, need or agenda field exists on `NPCDefinition` or `NPCInstance`
(`src/types/npc.ts:70-150`), matching the "no" in `PRODUCT.md` section 3.4's table.

## 5. LLM-era platforms

**No evidence survived.** Both Inworld URLs were unreadable; Convai, NVIDIA ACE, NEO NPC and
SillyTavern World Info were not reached; Generative Agents and PIANO were refuted. This is "we
retrieved nothing", not "vendors do nothing".

## 6. Retrieval mechanics and cost

No token counts, triggers or leak measurements survived from any LLM system. The one demonstrated
mechanism (finding 1.1) is pre-LLM and costs zero tokens: selection happens before generation, and an
NPC is kept from knowing something by never putting it in the candidate set.

*Code today:* `recall_memories` is term-overlap plus salience over the whole memory list
(`src/core/memory.ts:167-189`), and the budgets are unmeasured constants:
`KNOWLEDGE_CATEGORY_TOKEN_BUDGET = 2000` (`src/core/knowledge.ts:11`) and
`MEMORY_SECTION_TOKEN_BUDGET = 1500` (`src/core/context.ts:16`). No test asserts a prompt size
([`diagnosis/turn-latency-path.md`](diagnosis/turn-latency-path.md)).

## Did not survive verification

Do not design against these.

1. **Generative Agents retrieval = recency + importance + relevance, alpha=1, decay 0.99** - 0-3.
   Formula is verbatim in https://arxiv.org/pdf/2304.03442v1 but the decay factor is 0.995, not 0.99;
   a 25-agent offline sandbox is research-only; per-turn scan-and-score is unvalidated under 1-2 s.
2. **Generative Agents diffusion: candidacy 4% to 32%, party 4% to 48%, no broadcast channel** -
   1-2. Two extractions give the party figure as thirteen agents (52%); the mechanism is accurate but
   measured across 25 idle agents over two unbounded sim-days with no player in the loop.
3. **PIANO Cognitive Controller as a serialized bottleneck that broadcasts decisions** - 1-2. Quote is
   accurate (https://arxiv.org/pdf/2411.00114) but it is a Minecraft prototype whose ablations never
   test the bottleneck. Already the Q8 verdict in
   [`../02-agent-architecture-and-actions.md`](../02-agent-architecture-and-actions.md).
4. **Dwarf Fortress rumors reach a site only through three carrier NPCs (liaison, diplomat, tavern
   visitor)** - 1-2. Verbatim on https://dwarffortresswiki.org/index.php/Rumor, but a fan wiki is
   community, not demonstrated, and an annual caravan is batch propagation. Inspiration for gated,
   carrier-based acquisition; not evidence.

## Coverage gaps

- **Sub-question 1** (Nemesis intel, CK3 secrets, RimWorld, Watch Dogs Legion, Kenshi): only Valve
  and Dwarf Fortress reached. Unreadable: https://www.gdcvault.com/play/1025150/Helping-Players-Hate-(or-Love)
  (Nemesis) and the Steam announcement https://steamcommunity.com/games/1158310/announcements/detail/1716364455374240581
  (CK3). Next: Paradox CK3 dev diaries on Secrets and Hooks, the CK3 wiki "Secrets" page, the Watch
  Dogs Legion GDC 2021 census talk, Kenshi's modding wiki. Permit labelled community wikis, as Pass D2 did.
- **Sub-question 3** (relationship graphs): nothing beyond finding 2.2. Next: Monolith's Nemesis GDC
  talks (both), Sims 4 relationship-bit modding docs, Dwarf Fortress wiki "Relationship".
- **Sub-question 4** (needs and drives): nothing. Unreadable:
  https://www.gdcvault.com/play/1018040/Architecture-Tricks-Managing-Behaviors-in (Dave Mark). Next:
  Mark's "Building a Better Centaur" via the GDC Vault free tier, RimWorld wiki "Mood" and "Thoughts",
  Sims 4 autonomy/commodity modding docs.
- **Sub-question 5** (LLM platforms): nothing. Unreadable:
  https://docs.inworld.ai/docs/tutorial-basics/facts-knowledge/ and
  https://docs.inworld.ai/docs/tutorial-integrations/unreal-engine/playground/goals/. Next: fetch
  both by hand in a browser (JS shells, as Pass D found), Convai "Knowledge Bank" and "Narrative
  Design" docs, SillyTavern World Info docs on keyword and recursive activation, NVIDIA ACE docs, the
  NEO NPC GDC 2024 talk.
- **Sub-question 6** (tokens per turn, triggers): no numbers anywhere. This is a harness question.

## What this changes

1. **Model knowledge as scoped facts, not category depths.** Replace the `depths: Record<number,string>`
   map (`src/types/knowledge.ts:1-5`; resolver `src/core/knowledge.ts:38-62`) with facts that each carry
   a scope criterion (common / faction:X / personal:playerId / secret) and let an NPC's own fact table
   decide eligibility by presence, per finding 1.1. `recall_knowledge` (`src/core/mind.ts:192-232`) then
   filters candidates before the model ever sees them instead of substring-matching a category name.
   Name this store in the "Opinions and beliefs" row of `PRODUCT.md` section 3.4.
2. **Add the world-event inbox as a fact table with TTL**, not as memories. Change 2 in
   [`diagnosis/memory-knowledge-tools.md`](diagnosis/memory-knowledge-tools.md) proposed appending a
   `Memory`; finding 2.1 says the shipped shape is a fact with expiry, and `PRODUCT.md` section 3.7 item
   7 already reserves TTL for pacing. Ingest via a route mirroring `src/routes/cycles.ts`, store on
   `NPCInstance` (`src/schema/index.ts:150-163`), concatenate into the query every turn.
3. **Keep disposition separate from the fact that caused it** (finding 1.2): a world event may expire
   from the fact table while its effect on `RelationshipState` (`src/types/npc.ts:119-123`) persists
   under the section 3.4 decay curve. Two stores, two clocks.
4. **Re-evaluate at turn start, before the Speaker commits.** Finding 2.2 requires the current fact
   table to be in the prompt for the very next line. Today the only turn-start injection is
   `deferred_mind_context` (`src/conversation/turn.ts:277-286`). Assemble the fact table inside
   `assembleSlimSystemPrompt` (`src/core/context.ts:575`) as a dynamic suffix so the stable prefix stays
   cacheable (the single-block `cache_control` at `src/providers/llm/anthropic.ts:141-150` invalidates on
   any change). It belongs to the `CognitionRuntime.turn(input, state)` input, `PRODUCT.md` section 3.6.
5. **Social web and needs stay unvalidated.** Keep the static `network` (`src/types/npc.ts:55-68`) and
   add the `goals` field from diagnosis change 1, marked as design intent without shipped precedent.
   NPC-to-NPC delivery maps to a proximity-scoped fact broadcast through the inbox in item 2.
6. **Playground harness** ([`diagnosis/eval-harness.md`](diagnosis/eval-harness.md)): the live
   scenario schema (successor to `ConversationFixtureSchema`, `src/schema/eval.ts:55-70`) needs (a) a
   per-turn `facts` block with scope and TTL, (b) a "world event arrives between turn N and N+1" step,
   (c) a leak assertion that a `secret`-scoped fact never appears in the Speaker prompt or reply, and
   (d) a per-turn count of knowledge tokens injected, so the unmeasured 2000/1500 budgets
   (`src/core/knowledge.ts:11`, `src/core/context.ts:16`) get real numbers. Sub-question 6 is answered
   here or nowhere.

## Infra candidates

| Name | What it is | Verdict | Why |
|---|---|---|---|
| Valve Response Rules (Source engine) | Fact query + ANDed criteria + persistent fact store with TTL + late re-evaluation | pattern-only | Shipped and first-party documented (findings 1.1, 2.1, 2.2); C++ inside Source, not a library. Copy the data model into `src/core/knowledge.ts`. |
| Dwarf Fortress rumor system | Two-tier decay: rumor detail fades, reputation persists | pattern-only | Community-documented only (finding 1.2); the shape maps onto our fact table plus `RelationshipState`. |
| Generative Agents retrieval scoring | recency x importance x relevance weighted sum | pattern-only, unmeasured | research-only; the decay constant was misquoted and a per-turn full scan is unvalidated under 1-2 s. Measure in the harness before adopting any of it. |
| PIANO Cognitive Controller | Serialized decision bottleneck across concurrent modules | pattern-only | research-only; already covered as a coherence hazard in `02-agent-architecture-and-actions.md`. |
| Inworld Facts/Knowledge, Convai Knowledge Bank, SillyTavern World Info | Vendor and community knowledge-injection features | pattern-only by policy, unverified | Not retrieved this pass; we build our own. Fetch by hand before drawing anything from them. |

## Sources

- https://cdn.akamai.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf - demonstrated (first-party GDC 2012 engineering talk on a shipped system; 2012, older than the preferred window)
- https://dwarffortresswiki.org/index.php/Rumor - community (fan wiki; findings 1.2 and refuted claim 4)
- https://arxiv.org/pdf/2304.03442v1 - research-only; cited only under refuted claims 1 and 2
- https://arxiv.org/pdf/2411.00114 - research-only; cited only under refuted claim 3
- `PRODUCT.md` sections 3.4, 3.6, 3.7 and `research/02-agent-architecture-and-actions.md` - prior settled decisions referenced, not re-verified here
