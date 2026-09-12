# Disposition, annoyance and patience: NPCs that get angry, refuse, or walk out

Research pass 09-D, 2026-09-12. Claim ledger with every raw candidate and its fate:
[`raw/d-disposition-and-patience.md`](raw/d-disposition-and-patience.md). Provenance labels follow
[`../README.md`](../README.md): demonstrated / marketing / research-only / community. Confidence is the
adversarial tally: high = 3-0, medium = 2-1.

## The headline

Shipped games that let an NPC walk out use one authored scalar, a staged warning ladder, and an
irreversible floor: Baldur's Gate 3 approval runs -50 to 100, warns at -20 and -40, and the companion
leaves at -50. Dwarf Fortress supplies the continuous half: a stress scalar with bands far inside its
range, per-character traits that independently set accumulation rate, breaking point and decay rate,
and passive decay toward neutral. The LLM-era evidence is thin but pointed: the only measured study of
models choosing to leave (BailBench, Sept 2025) finds refusing and leaving are separate behaviours that
jailbreaks push in opposite directions, so an exit cannot be a side effect of abuse detection; and the
one widely deployed exit trigger (Bing Chat, 2023) fired too often because it was a controversy valve.
Today's runtime has none of this: mood moves only on a moderation hit
(`src/conversation/turn.ts:427-435`), the moderator is stateless keyword matching
(`src/security/moderator.ts:47-77`), and `exit_convo` is a binary decision made after the Speaker has
spoken (`turn.ts:329, 345-351`). Nothing survived for the other named games or vendors.

## 1. Disposition meters in shipped games

**Finding 1.1 - high (3-0), community.** BG3 companion approval is a single scalar from -50 to 100.
It gates dialogue options and modifies the persuasion Difficulty Class; choices move it in discrete
deltas (+1/-1 for minor lines, +8/+10 for substantial outcomes); the companion warns at -20 and -40 and
permanently leaves at -50 or below (https://bg3.wiki/wiki/Approval;
https://bg3.wiki/wiki/Act_One/Approval). Fan wiki, scripted CRPG, no LLM: the pattern transfers, the
constants do not.

*Code today does the opposite:* `RelationshipState{trust, familiarity, sentiment}`
(`src/types/npc.ts:119-123`) is rendered every turn (`src/core/context.ts:154-166`) but moves only in
the Persona Shift cycle (`src/core/cycles.ts:403-419`), never from what the player just said, and
gates nothing.

**No evidence survived** for Oblivion, Morrowind, Fallout, Mass Effect, Dragon Age, Disco Elysium,
Hades or Stardew (UESP and Stardew wiki pages were unreadable; see Coverage gaps).

## 2. Conversation exit mechanics

**Finding 2.1 - high (3-0), community.** BG3's exit is the bottom rung of the ladder: two in-dialogue
warnings, then permanent departure. The player learns the state from the character's lines, not a
meter (https://bg3.wiki/wiki/Approval).

*Code today does the opposite:* `exit_convo` is decided after `await mindPromise`
(`src/conversation/turn.ts:329, 345-351`), so the Speaker's committed line (`turn.ts:327`) cannot carry
a warning or goodbye; the voice path is the same (`src/voice/pipeline.ts:1013-1035`, after the TTS
flush). The Mind's instructions have no state between NO_ACTION and exit (`src/core/mind.ts:115-119`).

**Finding 2.2 - medium (2-1), demonstrated.** Valve's Left 4 Dead response rules have no explicit
interruption state: each follow-up line is re-queried against live world facts when it is about to be
spoken, and when a criterion such as IsNotInDanger goes false the conversation finds no match and
ends: "You don't need any kind of explicit interruption mechanism"
(https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf). The dissent
stands: this gates selection of pre-authored barks, not cutting a generated utterance, and this repo
removed barge-in for exactly that class of problem (`src/voice/pipeline.ts:463-465`,
`src/ws/handler.ts:386-391`). The ledger's extra Valve quote against "already said" bookkeeping (raw
claim 8) could not be located by one verifier; do not lean on it. Late revalidation is already adopted
in `PRODUCT.md` section 3.7 item 4.

**Finding 2.3 - high (3-0), demonstrated.** Bing Chat's 2023 system prompt told the model to "stop
responding and end the conversation" under "confrontation, stress, or tension with the user"; users
complained it fired too often, "likely because it was primarily used to avoid controversial model
outputs" (relayed with citations in https://arxiv.org/pdf/2509.04781, page 3; the paper cites Microsoft
forum and press sources, it does not measure this). An exit tuned for the vendor's comfort reads as a
broken character. The Mind prompt already learned this locally: `src/core/mind.ts:119` forbids
`exit_convo` on in-game threats, profanity and repeated questions, after over-triggering became a
recurring problem (`PRODUCT.md` section 3.7 item 4).

**No evidence survived** for Bethesda goodbye topics, Gothic, or The Sims social rejection.

## 3. Escalation ladders: the numeric shape of a patience variable

**Finding 3.1 - medium (2-1), community.** Dwarf Fortress stress is one scalar from -1,000,000 to
+1,000,000 with negative effects starting at +10,000 (symptoms), +25,000 (breakdowns) and +50,000
(insanity risk). Three personality facets independently set accumulation rate, breaking point and
dissipation rate; stress decays passively toward neutral; the value is driven by weighted accumulated
memories, long-term ones weighing more (https://dwarffortresswiki.org/index.php/DF2014:Stress). The
dissent: this is the DF2014-era page, the Steam-era emotion layer may differ, and only the range and
thresholds are verbatim; treat the per-facet mechanics as plausible community description.

**Finding 3.2 - high (3-0), community.** BG3 (Finding 1.1) is the discrete-event counterpart: fixed
integer deltas per authored event, two warning thresholds, one irreversible floor, no decay at all.

**Cross-reference, already settled.** RimWorld's mental-break ladder (minor/major/extreme at fixed
4/7 and 1/7 ratios of one stat clamped to [0.01, 0.50]) was verified in Pass D2 and is adopted as
`PRODUCT.md` section 3.4 rule 2, "one authored knob should drive a whole ladder"
([`../06-bounded-evolution-and-memory-pruning.md`](../06-bounded-evolution-and-memory-pruning.md)).
The RimWorld wiki pages were unreadable in this pass, so nothing new was added.

Together: one scalar, bands as thresholds on it, per-character rise and fall parameters rather than
per-band constants, and an explicit decay decision (DF and RimWorld decay; BG3 does not, because
departure is narrative). Hysteresis appears as staged warnings that fire once each, not a dead band.

*Code today does the opposite:* `MoodVector` (`src/types/npc.ts:17-21`) is the only live affect
variable; it moves by a fixed blend only on a moderation `warn` or `exit` (`turn.ts:427-435`) and
decays 10% toward neutral at session end (`src/session/manager.ts:388-390`) and in the daily pulse
(`src/core/cycles.ts:108-119`). No per-NPC rate, threshold or decay parameter exists; annoyance,
patience and irritation do not appear in `src/`.

## 4. LLM-era mood and relationship

**Finding 4.1 - high (3-0), research-only.** In "The LLM Has Left The Chat" (Ensign, Sleight, Fish,
arXiv preprint, Sept 2025), jailbreaks lower refusal rate but raise the rate at which the model chooses
to leave: "up to 34% of cases where it 1) does not refuse, yet 2) chooses to bail" on Qwen-2.5-7B and
Qwen-3-8B, and removing refusal training entirely (abliteration) shows a similar decoupling for some
methods and models (https://arxiv.org/pdf/2509.04781). Refusal and wanting out are separate behaviours.

**Finding 4.2 - medium (2-1), research-only.** On continuations of real WildChat and ShareGPT
conversations, models bail "around 0.28-32% of the time (depending on the model and bail method)";
the authors' false-positive correction lowers that to roughly 0.06-7%
(https://arxiv.org/pdf/2509.04781). The dissent stands: general assistants, not persona-conditioned
NPCs; single-turn; no roleplay or abusive users. Carry the variance, not the rate: the latent tendency
to leave differs by model family and by how you ask, so it must be designed explicitly.

**No evidence survived** on Inworld, Convai, Character.AI or Replika, nor on prompt patterns for
graceful in-character exits. Whether an LLM can refuse or walk out while staying in character is
unmeasured by anything this pass retrieved.

## 5. Player abuse and moderation

Finding 4.1 is the operative result: if jailbreak pressure independently raises the tendency to
leave, hardening refusal does not control exits, and vice versa. Separate detection, thresholds and
evaluation are needed.

*Code today couples them partially.* A moderator `exit` sets `securityContext.exitRequested`, which
force-adds `exit_convo` to the Mind's tools (`src/core/tools.ts:112-119, 415-418`) and marks the
result `forcedByModeration` (`src/mcp/exit-handler.ts:61`); a voluntary exit uses the same tool and
handler with the flag false. Only the moderation path has a cooldown (300 s, `exit-handler.ts:37,
82-83`) and only it has coverage: the one fixture asserts `exit_convo` is not called
(`tests/unit/fixture-validation.test.ts:50`); nothing exercises an in-character exit. Finding 2.3 is
the failure mode of letting the safety valve double as the character's patience.

## 6. Designer-facing controls and auditability

**From Finding 3.1 (medium, community):** temperament as three per-character facets (accumulation,
breaking point, dissipation) is the designer surface, matching `PRODUCT.md` section 3.4 rule 2.
**From Finding 1.1 (high, community):** BG3's staged warnings are the audit trail; the player hears
why before the exit. Section 3.4 already warns that Dwarf Fortress never prints its number and its
modal band renders as silence.

*Code today:* the per-turn session log records `exitConvo` as a boolean and `moderationAction`
(`src/conversation/turn.ts:462-463`) but not the reason, which reaches only the process logger
(`src/mcp/exit-handler.ts:64-76`). A designer replaying a session cannot see why the NPC left. No
temperament, patience or trigger field exists on `NPCDefinition` (`src/types/npc.ts:70-109`).

## Did not survive verification

- **"Claude Opus 4 ships an end-conversation tool gated by warning, confirmation and a self-harm
  exclusion" (1-2).** The tool text appears in arXiv 2509.04781 only via a footnote citing a tweet;
  the paper is not a primary source, and the feature is a consumer-chat valve for a model no longer
  current. The four-part gate is a reasonable idea but unevidenced here; retrieve the Claude Opus 4
  system card before citing it as shipped precedent.

## Coverage gaps

- **Sub-question 1, almost entirely.** Oblivion (UESP unreadable), Morrowind, Fallout, Mass Effect,
  Dragon Age, Disco Elysium, Hades, Stardew (wiki unreadable). Next: fetch UESP, the Stardew wiki, the
  Dragon Age Wiki approval pages and the Hades wiki "Affinity" page in a rendered browser, as done for
  [`../07-pricing-and-comparables.md`](../07-pricing-and-comparables.md).
- **Sub-question 2.** Bethesda goodbye topics, Gothic, The Sims social rejection. Next: Creation Kit
  wiki "Goodbye" topic docs; Sims 2 modding docs on social interaction outcome trees.
- **Sub-question 3.** RimWorld wiki pages unreadable; already settled by Pass D2.
- **Sub-question 4.** Inworld, Convai, Character.AI, Replika: nothing retrieved; no evidence on
  persona-conditioned refusal or exit. Next: Inworld "Emotions" and "Relationships" docs; BailBench
  follow-ups.
- **Sub-question 6.** No vendor designer-console evidence for temperament or exit audit trails.

## What this changes

1. **Add a per-turn patience scalar, separate from `MoodVector`.** On `NPCInstance`
   (`src/types/npc.ts:136-149`, schema `src/schema/index.ts:150-163`), driven by per-turn events, with
   three per-NPC parameters on `NPCDefinition`: accumulation rate, decay rate, breaking point (Finding
   3.1). Decay is a parameter: BG3 has none, DF does. Add it as a fifth toggled row in the `PRODUCT.md`
   section 3.4 subsystem table.
2. **Make the exit a ladder, not a bit.** Two warning thresholds and one exit threshold, each firing
   once (Finding 1.1). Warnings must land in the spoken line, impossible today because the Mind decides
   after the Speaker commits (`turn.ts:327-351`). This is a `CognitionRuntime` requirement for
   `PRODUCT.md` section 3.6: the disposition band must exist before speech generation.
3. **Split the exit paths.** Keep moderation-forced exit as a safety valve; give in-character exit its
   own threshold and evaluation (Finding 4.1). `handleExitConvo` (`src/mcp/exit-handler.ts:55-89`)
   already carries `forcedByModeration`; extend `src/schema/eval.ts:29-35` so a fixture can assert a
   disposition-reason exit, and add one fixture under `tests/fixtures/conversations/` that walks the
   ladder.
4. **Log why the NPC left.** Add exit reason and patience value to the per-turn session log
   (`src/conversation/turn.ts:440-477`) so `src/eval/replay.ts` and `src/harness/diagnostics.ts:141-221`
   can show the causal chain.
5. **Keep the safety valve out of the patience system** (Finding 2.3). The negative-example list at
   `src/core/mind.ts:119` stays; the patience ladder, not `exit_convo` heuristics, handles in-game
   insults.
6. **Playground harness:** the JSON-lines CLI in [`diagnosis/eval-harness.md`](diagnosis/eval-harness.md)
   should emit patience value and band per turn as a state delta, and scenario files need a way to
   script an abusive or repetitive player so the ladder can be observed end to end.

## Infra candidates

| Name | What it is | Verdict | Why |
|---|---|---|---|
| BG3 approval ladder | Scalar -50..100, warnings at -20/-40, exit at -50 | pattern-only | Shipped shape for staged warnings before an irreversible exit; copy the shape, not the constants |
| Dwarf Fortress stress model | Oversized scalar, bands far inside range, per-character rate/threshold/decay facets, passive decay | pattern-only | The per-character parameterisation is the designer surface we want |
| RimWorld mental-break ratios | One stat drives a fixed 4/7, 1/7 tier ladder | pattern-only | Already adopted, `PRODUCT.md` section 3.4 rule 2 |
| Valve late revalidation | Re-query preconditions as the next line fires | pattern-only | Already adopted, section 3.7 item 4; bark selection, not cutting a generated utterance |
| BailBench (arXiv 2509.04781) | Three bail-measurement methods for LLM exit tendency | pattern-only | Measure exit rate separately from refusal rate in our own eval; do not adopt the dataset |
| Bing Chat exit-on-tension prompt | Deployed system-prompt exit instruction | reject | Documented over-firing; conflated safety with character |
| Claude Opus 4 end-conversation gate | Warning, confirmation, crisis exclusion | reject (unverified) | Refuted on provenance; retrieve the system card first |

## Sources

- https://bg3.wiki/wiki/Approval - community
- https://bg3.wiki/wiki/Act_One/Approval - community
- https://dwarffortresswiki.org/index.php/DF2014:Stress - community
- https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf - demonstrated (2012; older than the preferred window)
- https://arxiv.org/pdf/2509.04781 - research-only for its own measurements (Findings 4.1, 4.2); demonstrated for the relayed Bing Chat history (Finding 2.3), which it cites from Microsoft forum and press sources
