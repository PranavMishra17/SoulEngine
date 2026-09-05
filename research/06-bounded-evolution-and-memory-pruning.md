# 06 — Bounded character evolution and memory pruning in shipped games

**Pass D2.** Run 2026-09-05. 103 agents, 3-vote adversarial verification. **12 findings survived.**

Covers [`../PRODUCT.md`](../PRODUCT.md) §5 Q11 — the question that failed in Pass B and again in Pass C2.

**What fixed it:** permitting community wikis, modding documentation and game-data dumps as primary
evidence, with each claim provenance-labelled. The two earlier passes demanded first-party developer
sources and found nothing, because these systems are barely documented that way. Every finding below
carries its provenance; almost none is developer-stated.

---

## The headline, in two halves

> **No shipped first-party game exposes a per-subsystem evolution toggle.** Your §3.4 design is genuinely
> novel — it is not validated by prior art because nobody ships it.
>
> **But every mechanism you need to build it well is documented**, and shipped games solve bounding in a
> way that is the opposite of the current implementation: change is made **discrete, slot-limited and
> threshold-gated**, not clamped as a drifting float.

---

## Q11a — Where the immutability line gets drawn

**RimWorld: at character generation.** `high, 3-0` *(community wiki / reverse-engineered from defs)*

> "Only humans have traits. Most humans have 1-3 traits… **Adults cannot gain new traits, and there is no
> way to remove traits.**"

Only mood drifts during play. Trait assignment is bounded at generation by an age-derived slot cap
(0 traits under 7; 1 at 7–9; 1–2 at 10–12; 1–3 at 13+) plus a hard exclusion filter: nothing conflicting
with an existing trait, nothing prohibited by pawn kind or backstory, nothing disabling a required work
type, and **nothing that would push the pawn's minor break threshold above 50%**.
*Caveat: Biotech `forcedTraits` genes can add or strip a trait on an adult — a designer-authored
override, not emergent drift.*

**CK3: a soft slot budget plus mutual exclusion, with drift behind a discrete gate.** `high, 3-0`
*(Paradox-hosted but community-written wiki)*

> "Characters tend not to have more than 3 personality traits." … "A character cannot have two opposing
> traits, or three mutually exclusive traits."

~16 opposed pairs (Brave/Craven, Calm/Wrathful, Diligent/Lazy…) plus at least one three-way group
(Compassionate/Callous/Sadistic). Enforcement is **layered, not a hard array**: 3 is a generation
tendency; exceeding **five** triggers repeated events to lose one at random until back to five; the
character creator bypasses the cap entirely.

Drift is threshold-gated: *"personality traits can change… this most often occurs as the result of a
mental break at Stress Level 2 or higher."* Stress runs 0–400, breaks fire on first crossing 100/200/300,
and a break that changes personality **removes one previous trait — a swap, not an accumulation.** The
only other sanctioned path is childhood, at fixed ages 9, 11 and 13.

## Q11b — What bounds the change

**One clamped stat drives an entire escalation ladder.** `high, 3-0` RimWorld's `MentalBreakThreshold`
StatDef: base **0.35**, **min 0.01, max 0.50** — a hard floor and ceiling on how far any accumulated
modifier can push it. The tiers are fixed *ratios* of that one stat:

> "The threshold for a Major mental break is always **4/7** of the pawn's Mental Break Threshold stat.
> The threshold for an Extreme mental break is always **1/7**."

(4/7 × 35 = 20; 1/7 × 35 = 5, matching the player-facing 35% / 20% / 5% lines.) **One tunable value
determines the whole ladder.** The stat is also marked `scenario randomizable = true`.

**Mutually exclusive tiered spectrums — one rung per behavioural axis.** `high, 3-0`

> "A colonist can only have one trait from any single related spectrum."

This is a property of the data model, not a convention: each spectrum is **one** TraitDef with multiple
`degreeDatas`, and a pawn carries a single degree. Verified values — Nerves: iron-willed −0.18,
steadfast −0.09, nervous +0.08, volatile +0.15 on break threshold. NaturalMood: +12/+6/−6/−12.

> **Architecturally important, and directly applicable:** the mood numbers are **not on the TraitDef**.
> They live in `Thoughts_Situation_TraitsPerm.xml` as always-active ThoughtDefs gated on `requiredTraits`
> + `requiredTraitsDegree`. **Personality trait and its mood effect are separate defs.** That is
> subsystem separation expressed as data separation — the shape §3.4 wants.

**Dwarf Fortress: the one verified case where memory feeds personality.** `high, 3-0`
*(community-documented; Tarn Adams not cited for any of it)*

> "When a dwarf thinks about a long-term memory, it has a **1:3 chance** of being promoted to core memory
> and causing one or more personality changes."

So the pipeline is **long-term memory → ~1:3 core-memory promotion → facet change** — a bounded
probabilistic gate, not continuous accumulation. Population bounds are authored per species via the
`PERSONALITY:<FACET>:<LOW>:<MEDIAN>:<HIGH>` creature token: dwarves have a greed median of 55; goblin
altruism has a median of 25 and "is capped at 50". *Caveats: the 1:3 figure is version-approximate, and
there is no evidence whether species caps re-clamp post-creation drift.*

This is the closest template for the **opinions and beliefs** subsystem in §3.4.

## Q11c — Auditability, with a caution

**Dwarf Fortress bands facets into seven fixed tiers** over 0–100 with rarity weights: 91–100 (0.4%),
76–90 (2%), 61–75 (8.5%), **40–60 Neutral (78%)**, 25–39 (8.5%), 10–24 (2%), 0–9 (0.4%). `high, 2-1`

> **Correction carried from verification:** the game never prints the band label or the integer. It prints
> tier-specific prose, and **the modal 40–60 band produces no report at all — the most common case renders
> as silence.** Discrete tiering does not automatically buy auditability.
>
> *(A claim that DF models exactly 54 facets was refuted 0-3. Do not cite a facet count.)*

## Q12 — Memory pruning as a designer control

**RimWorld is the strongest example, and it is four authored numbers per memory.** `medium, 2-1`

Every memory is a `ThoughtDef` carrying a **mood offset**, a **`durationDays` expiry**, a **`stackLimit`**,
and a **`stackedEffectMultiplier`**. Documented examples: *"My proposal was rejected"* (−18 mood, 25 days,
stack limit 5, multiplier 0.5); *"Got some lovin'"* (+8, 3 days, limit 10, 0.6); Nuzzled (+6, 0.75, 4).

**Two qualifications the verifiers required:**
1. Accumulation is **geometric, not linear** — `value × (1 − multi^stack) / (1 − multi)`, so the *n*th
   stack contributes `value × multi^(n−1)`.
2. Expiry is the outer bound, **not always a hard delete** — a ThoughtDef may carry `lerpMoodToZero`,
   fading the offset linearly across the duration.
3. Specific per-thought numbers are **version-sensitive** (two sibling numeric claims were refuted 1-2).
   Copy the *schema*, not the constants.

**Event-memory vs situation-thought is a file-level split.** `high, 3-0` Memory thoughts are
event-triggered and carry `<durationDays>`; situation thoughts carry a `<workerClass>` re-evaluated
continuously against current state, with **no duration** (expiration column reads N/A).

> **But read the limit:** both categories sum into the **same single mood value** through the same
> `ThoughtHandler`, and **a vanilla designer cannot switch off memory thoughts** via a game rule or
> scenario setting. Strong evidence for pruning controls; weaker than it looks for subsystem separation.

**The Sims 2 models exactly what you asked for — decay of influence, not of existence.** `high, 3-0`

> "Recent memories are likely to be the conversation topic, and will eventually **weaken to the point of
> not being a topic any more**."

The record itself persists in the Simology panel. Modder file inspection shows memories carry an
**initial-strength / minimum-strength / decay-rate** triple — and the minimum-strength field means some
memories keep a **nonzero floor** rather than fading to nothing. *(The same source documents Maxis data
errors: private-school memories with "a ridiculously high initial strength that takes forever to decay",
and University memories shipped with strength 0. Authored numbers need validation tooling.)*

**And the cautionary tale.** `medium, 3-0`

> "Sims accumulate gossip memories which **do not appear in the memories panel**, but which can be viewed
> with SimPE… Since invisible gossip memories can accumulate to the point of causing problems, the FFS Lot
> Debugger from MATY has options to remove them."

A hidden second memory store, not player-visible and not prunable in-game, requiring a **third-party
tool** to purge. *(Wording softened in verification: TS2 did cap visible memories per Sim — the failure
was in the hidden store, not a total absence of caps. A claim that Sims 3 shipped a player-facing memory
toggle was refuted 1-2.)*

> **Lesson: every memory the system retains must be visible and prunable in the authoring UI.** A hidden
> store becomes a support burden and, eventually, someone else's debugging tool.

## Q11d — Subsystem toggles: the crux, answered honestly

**No shipped first-party game exposes one.** The only concrete evidence is the mod layer. `medium, 2-1`

RimWorld's **No Breaks** mod (v1.0.0, RimWorld 1.6, updated Feb 2026) ships **two independent Mod Settings
switches**, each default on, effective without restart: *"Disable mental breaks"* and *"Disable social
fights"*. Sibling mods (Configurable Mental Breaks, No Social Fights, Easier Breaks) independently confirm
the two are separately patchable code paths, and that the same subsystem admits both an off-switch and a
threshold knob.

> **The implementation detail is the most directly actionable finding in this pass.** Changelog,
> 10 Feb 2026: *"Fixed FPS drops by switching to **Prefix** patches. Mod now **prevents mental break
> calculations from running instead of discarding results after computation**."*
>
> A disabled subsystem must be **skipped at the evaluation entry point**, not computed and then thrown
> away. They shipped the naive version first and it cost measurable frame time.

**A scoping axis worth stealing.** `medium, 3-0` RimWorld's vanilla scenario editor has a "Forced trait"
part that *"can be configured to apply to all pawns in the game, only the player's starting pawns, or only
non-player pawns; it can also be configured to have a chance to trigger per pawn between 0-100%."*
Backed by `ScenPart_ForcedTrait`. It is creation-time assignment, **not** a subsystem switch — but
*all NPCs / player-adjacent NPCs / other NPCs* is a scoping axis worth copying for evolution settings.

---

## What this changes

| PRODUCT.md | Effect |
|---|---|
| §3.4 per-subsystem toggles | **Novel, not validated — and now buildable.** No shipped first-party game does this, so there is no precedent to copy for the *feature*; but every *mechanism* is documented. |
| §3.4 — **implementation requirement** | A disabled subsystem must be **skipped at the entry point**, never computed-then-discarded. RimWorld's mod authors shipped the naive version and had to fix measurable frame-time loss. |
| §3.4 — **the bounding model to adopt** | Make change **discrete, slot-limited and threshold-gated**, not a clamped drifting float. Draw the immutability line at NPC creation (RimWorld), cap concurrent traits with mutual-exclusion groups (CK3), and gate any drift behind a discrete threshold crossing that **swaps** rather than accumulates. |
| §3.4 — **one knob, whole ladder** | RimWorld derives Major/Extreme break points as fixed 4/7 and 1/7 ratios of a single stat clamped to [0.01, 0.50]. One authored value, entire escalation curve. Far better than per-tier constants. |
| §3.4 — **separate the trait from its effect** | RimWorld keeps trait definitions and their mood consequences in *different def files*, joined by `requiredTraits`. Subsystem separation as data separation. |
| Memory pruning (replaces `salience_threshold`) | Adopt the ThoughtDef schema: per-memory-type **mood offset, duration, stack limit, diminishing-returns multiplier**, with geometric stacking and an optional linear fade instead of a hard delete. Copy the schema, not RimWorld's constants — those are version-sensitive. |
| Memory model | The Sims 2's **initial-strength / minimum-strength / decay-rate** triple is exactly "durable record, decaying retrieval weight, nonzero floor". |
| **New hard requirement** | **No hidden memory store.** Everything retained must be visible and prunable in the authoring UI, or it becomes The Sims 2's gossip-memory problem. |
| Scoping | Offer evolution settings scoped to *all NPCs / a named subset / everything else*, per RimWorld's scenario-part precedent. |
| Auditability caution | Discrete tiers do not buy auditability by themselves — DF's most common band renders as silence. Show the causal chain explicitly. |

## Primary sources (provenance-labelled)

*Community-documented / reverse-engineered unless noted. None of the below is developer-stated.*

- RimWorld Wiki — Traits, Mood, Mental Break Threshold, Thoughts, Module:Thought: https://rimworldwiki.com/wiki/Traits · https://rimworldwiki.com/wiki/Mental_Break_Threshold · https://rimworldwiki.com/wiki/Thoughts
- RimWorld Core defs — `Traits_Spectrum.xml`, `Thoughts_Situation_TraitsPerm.xml`: https://github.com/RimWorld-zh/RimWorld-Core
- Ludeon localization repo (confirms the memory/situation file split): https://github.com/Ludeon/RimWorld-ru/issues/948
- No Breaks (mod-author-stated): https://www.nexusmods.com/rimworld/mods/624 · Easier Breaks: https://www.nexusmods.com/rimworld/mods/630
- CK3 Wiki — Traits, Attributes: https://ck3.paradoxwikis.com/Traits
- Dwarf Fortress Wiki — Personality facet, Memory (thought), Personality: https://dwarffortresswiki.org/index.php/DF2014:Personality_facet · https://dwarffortresswiki.org/index.php/DF2014:Memory_(thought)
- The Sims Wiki — Memories: https://sims.fandom.com/wiki/Memories · ModTheSims memory-file analysis: https://modthesims.info/d/626847/memory-mod.html
