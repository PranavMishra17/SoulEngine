# 04 — Game-industry prior art: actions during dialogue, and character evolution

**Pass C2.** Run 2026-09-05. 106 agents, 3-vote adversarial verification. **13 findings survived.**

Covers [`../PRODUCT.md`](../PRODUCT.md) §5 Q10-Q11 (the re-run, aimed at game-industry sources).

---

## The headline

> **The industry solved this before LLMs existed, and three independently-built toolchains converged on
> the same architecture:** a named, argument-carrying call travels on a channel *separate from the
> prose*, and whether it blocks speech is decided **structurally** — not by a flag in the schema.

That is a direct answer to "show anger while talking, then throw the wallet, then hand over the key."

---

## Q10a — How actions attach to dialogue `high, 3-0`

Three shipped systems, same shape:

| System | Channel | Typed? |
|---|---|---|
| **Yarn Spinner** | `<<command_name args>>` bound to a C# method via `[YarnCommand("name")]` | **Yes** — typed params (string, int, float, bool, GameObject, Component), optional params, and an inspectable registry (`Window > Yarn Spinner > Commands`) listing every callable command and its signature |
| **ink** | `# hashtags` riding alongside a line — *"These don't show up in the main text flow, but can be read off by the game"*, read via `story.currentTags` | **No** — free-form strings, no schema, no validation |
| **Valve Source** | `.vcd` choreography bundles facial expression, lip-sync, gesture, actor position *"and any map triggers that need to be fired during the scene"* on one timeline | Timeline events |

**Three corrections the verifiers insisted on:**
1. Yarn commands are separate `<<...>>` statements *between* lines, not metadata on a line. **ink** is the system where the directive genuinely attaches to a line.
2. A Source choreo event only fires an **output**; the world effect is executed by the Hammer entity I/O graph elsewhere. *"That split — declare the side-effect at a timestamp on the line, dispatch it to the world subsystem — is arguably the better lesson for SoulEngine."*
3. ink is prior art for **the channel**, not for a typed call signature. **Yarn's typed, registry-listed commands are the closer analogue to a tool schema.**

## Q10b — Blocking vs composing is a property of the executor, not the schema `high, 3-0`

**This is the most directly useful finding in the pass.**

Yarn Spinner expresses blocking-vs-non-blocking **through the bound method's return type**, with *no
per-command "blocking" flag anywhere in the API*:

- Handler returns `void` → *"the Dialogue Runner will continue running your code as soon as the delegate returns"* → **composes with speech**.
- Handler returns `IEnumerator`, `Coroutine`, or an awaitable (`YarnTask`, `Task`, `UniTask`, Unity `Awaitable`) → *"Yarn Spinner will pause execution of your dialogue when the command is called"* → **blocks**.

A verifier specifically searched for a blocking flag or parameter and **found none**. Behaviour is
consistent across Yarn v1, v2 and v3.

> **Direct implication:** the compose-vs-terminate distinction **does not need to be a field in your tool
> schema.** It can be a property of how each tool's executor is written. `show_anger` returns void and
> composes; `walk_away` returns an awaitable and gates the next line.

**One important limit:** Yarn awaits the returned *task*, not the *action*. The engine cannot observe an
animation finishing — task completion equals action completion only because the programmer wires it that
way. A `void` command that fires an Animator trigger consumes world-time and gates nothing.

## Q10c — Termination: two opposite designs, both shipped `high, 3-0`

**(A) Explicit declared token — ink.** `-> END` is *"a marker for both the writer and the compiler"*,
lowered to a dedicated bytecode control command, with a compile-time loose-ends check:
*"WARNING: Apparent loose end exists where the flow runs out."* Termination is declared and
statically checkable, never inferred from a line's content. (Verified at compiler source level in
`Divert.cs` and `FlowBase.cs`. Caveats: it's a warning not an error; the check is heuristic and skipped
for functions; `-> DONE` ends a thread while `-> END` ends the whole flow.)

**(B) Implicit via late revalidation — Valve.** There is **no dedicated interruption mechanism**. Each
follow-up line is re-queried against world state *at the moment the next speaker begins*:

> "Query the followup line when the callback happens, not when the first character starts to speak. The
> situation may have changed during the time it took the first line to be said."

> "The conversation self-terminates because the criteria for its existence are no longer true. **You
> don't need any kind of explicit interruption mechanism.**"

Ruskin names the payoff: *"That gets you out of having to build explicit conversation entities and glue
down both characters while they're speaking and have a means of handling interruptions."*

**Critical caveat:** termination can only occur at a **line boundary**, so Valve pairs it with an
authoring convention about line length.

## Q10d — The deadlock warning `high, 3-0`

Bethesda's Creation Kit schedules scene actions in discrete **Phases**, blocking by default —
*"a scene will not progress until all the actions in a phase are complete"* — with **no engine-level
timeout**:

> "There are some package types (like Follow) that technically never complete, so be careful that your
> scenes don't get stuck forever!"

> "Actions with packages that have no Done state can never be completed — phases with these kinds of
> actions need to use Completion Conditions in order to end."

*(Verified against Wayback snapshots of the original Bethesda-authored creationkit.com page, not just
the UESP mirror, so "Bethesda explicitly warns" is defensible attribution.)*

> **Lesson:** a shipped AAA dialogue scheduler chose to **deadlock rather than time out**, and pushed
> "is this action completable?" onto the action-type author. **Any SoulEngine tool that blocks the next
> line needs either a guaranteed completion signal or an explicit designer-set completion condition.**

## Q10e — Arbitration: three shipped models

**Layered priority, validation delegated to the designer — Bethesda `medium, 2-1`.**
*"Scene packages sitting on top of alias packages sitting on top of base packages… the scene packages will
always take precedence (assuming they are valid)."* The game runs the **first valid** package top-down;
legality is a precondition on stack position, not a separate arbiter. And bluntly: *"the game makes no
precautions and relies on designers to do the right thing, so be careful with your package conditions!"*
*(Scoping note: that warning is about an unconditioned scene package leaking into a normal stack — not a
blanket claim that the engine validates nothing.)*

**Object-carried affordances with one gating predicate — The Sims `high, 3-0`.** Source strength is
unusual: the paper is co-authored by **Will Wright**, so this is a developer statement, not community
reverse engineering.

> "The set of behaviors consist of a procedure that implements it, a procedure that checks to see whether
> or not it is possible, and a set of advertisements…"

Autonomous selection is a global argmax over *"all of the possible behaviors in all of the objects."*
Legality is a per-interaction **Check Tree** evaluated before commitment, and its false return removes
the interaction from **both** paths: *"If this code exits false then that behavior will not appear on the
pie menu and also will not be available for autonomous selection."*

*Wording fix carried:* autonomy stacks further filters on top (audience flags, distance attenuation,
motive min/max, personality scaling), so phrase it as **"a shared precondition gating both player-issued
and autonomously-selected actions, with autonomy subject to further filters."**

**HTN precondition backtracking — Guerrilla's Decima `high, 3-0`.** Live production technology behind
Killzone, Horizon Zero Dawn, Death Stranding and Horizon Forbidden West; *"performs backtracking (similar
to Prolog) over preconditions"*, compiles decompositions to generated C++, ships with in-game
decomposition debugging. Two first-party talks 19 months apart, the later dated **June 2026**.

## Q10f — Results flowing back into dialogue `high, 3-0`

Valve's response-rules system makes NPC memory **writer-authored data, not an engine heuristic.** A
matched rule's `then` clause writes named key-value facts into a persistent store, and that store is
concatenated into every subsequent query the character makes:

> "Take all of these sources of data, concatenate them all into one big associative array, and that's
> your query."

Ruskin lists write-back as one of five requirements and credits it with Turing-completeness: *"With
conditional branches and stored state, you can do actual logic and computation in the system."*

**Three qualifications:**
1. Per-fact expiration exists — *"you can have automatic expiration times on a particular fact, if you
   want to prevent two successive bits of a running gag from being played too close together"* — but this
   is a **hard TTL for anti-repetition pacing**, NOT memory decay or salience. **Do not cite this as
   evidence of authored decay curves.**
2. The store is written *"either by code or by writer-generated rules"* — writer-authored is the
   emphasis, not the exclusive channel.
3. In shipped L4D2 script the write-back keyword is `applycontext`, separate from the `then <character>
   <concept>` follow-up dispatch.

## Q10g — One dispatch bus for speech and actions alike `high, 3-0`

> "A rule has an associated response which is simply the thing that happens when a rule matches, such as
> a voice file or **an animation**" … "your response could be code, or executable script, or anything
> really."

A response can dispatch a follow-up concept to a named character or **broadcast**: *"you can send one to
all nearby characters within earshot simultaneously, to see if any of them have a reply; and of those
which have the best reply."* Arbitration is by **specificity**: *"The scoring function that worked best
for us was the simplest one imaginable — the number of criteria in a rule."*

The verifier's assessment: **this is the closest shipped precedent for SoulEngine's design where one
registry dispatches both an utterance and a world action.**

*(Caveat: every worked example in the deck is a voice line, so the deck documents the mechanism's
generality rather than a shipped non-speech arbitration case — though "animation" appears in the
definitional slide from the developer's own mouth.)*

## Q12 — Budgets (partial)

| Metric | Figure | Source |
|---|---|---|
| GOAP planning rate | *"less than one plan per second per NPC on average"* | Jacopin, Game AI Pro 2 ch.13 |
| GOAP plan depth | *"at most four actions"* — load-bearing, sized against F.E.A.R. in a real data structure | same |
| GOAP per-invocation | *"at most several milliseconds"* (multi-minute figures in the literature are explicitly synthetic tests) | same |
| AI LOD scheduler | **57 µs/frame = 0.17% of frame time**, 500 kB transition data, **48 bytes per entity** | Sunshine-Hill, Game AI Pro 1 ch.14 |

*Attribution corrections:* Jacopin's numbers are **descriptive** ("characterises the typical operating
point as"), not prescriptive; the <1 plan/sec rate is his uncited experience while the 4-action depth has
an explicit F.E.A.R. citation. Sunshine-Hill's system is **author-implemented in an unnamed free-roaming
game**, not a named shipped title — say "Sunshine-Hill reports". The 57 µs is the cost of the
**arbiter itself**, not per-NPC AI cost; the only true per-NPC figure is 48 bytes, and the
hardware-portable number is the 0.17% ratio, not the microseconds (2013 hardware).

> **The gap that matters:** nothing in the verified corpus addresses per-NPC cost budgets for **deep
> conversational NPCs** — the tier SoulEngine most needs. `D11` stays open.

## A useful negative result `medium, 2-1`

The Sims 1 shipped with **no tool-result-to-belief loop**: *"Objects advertise, to be sure, but currently
Sims have no way of knowing whether or not the experience was worth it."* Forbus and Wright propose it as
a build-it-yourself exercise ("Skeptical Sims").

*Scope correction:* outcomes plainly feed back into a Sim's **state** (motives increment/decrement on exit,
and advertisement appeal is modulated by current motives). What is absent is a **learned model** of whether
an object delivered what it promised. Scoped strictly to The Sims 1; The Sims 2 added explicit memory.

> **So SoulEngine's returning of tool results into the next turn's context has no shipped prior art to
> copy — only a stated design intent from the people who built the canonical system.**

---

## COVERAGE GAP — Q11 has now failed TWICE

**Zero surviving claims on bounded, designer-controlled character evolution.** Nothing on Sims
traits/aspirations/moodlets, Crusader Kings traits and stress, RimWorld mood and mental breaks, the
Nemesis system, Dwarf Fortress personality, Persona/Fire Emblem social links, or OCEAN/PAD/OCC.

On memory controls, only Valve's per-fact TTL survived — **nothing** on The Sims' memory system and its
rework, Nemesis memory, Radiant AI, grudge tracking, relationship decay curves, salience weights,
capacity caps, or tiered memory.

**The meta-finding diagnoses it as a SOURCING failure, not absence of evidence.** Of 19 surviving claims,
13 came from four source families (Yarn docs, ink docs+compiler, the Valve deck, the CK wiki). Not one
cites a GDC talk on Sims 4 emotions, Paradox's CK3 systems, Ludeon's RimWorld writing, Monolith's Nemesis
talks, or any affective-computing model in games — **all of which are heavily documented.**

> **Consequence: [`../PRODUCT.md`](../PRODUCT.md) §3.4 (per-subsystem evolution toggles) currently has no
> verified prior art behind it.** A follow-up must target those named sources directly — Monolith's GDC
> Nemesis talks, Tynan Sylvester's RimWorld writing and *Designing Games*, Paradox dev diaries, the Sims 4
> emotion GDC material, and the "AI and Games" essays on Nemesis and Radiant AI — rather than searching
> generally. Community wikis and video essays should be explicitly permitted and labelled as such, since
> these systems are documented there far more thoroughly than in first-party engineering sources.

**Also unevidenced:** the LLM-specific half of Q10 — constrained decoding, grammar-constrained sampling,
post-hoc stripping, fine-tuning to stop a model narrating actions. The corpus supports only the
**architectural** answer (separate structured and prose channels). As the meta-finding puts it: nothing
here tells SoulEngine **how to stop a model narrating, only where the action should have gone instead.**
Your existing `stripNarration()` remains the state of the art in this corpus, which is not a compliment.

---

## What this changes

| PRODUCT.md | Effect |
|---|---|
| **Action layer design** | Now has a concrete, shipped-precedent shape — see §3.7. Structured channel separate from prose; blocking decided by the executor's return type, not a schema flag; explicit terminator plus late revalidation; write-back of authored facts into the next query. |
| §3.4 per-subsystem evolution toggles | **Still no verified prior art, after two attempts.** Diagnosed as a sourcing failure with named targets. |
| §3.6 swappable cognition interface | **Supported.** Valve's single dispatch bus handling voice, animation and code responses is the closest shipped precedent for one registry emitting both utterance and world action. |
| `D11` deployment shape | **Partially informed.** Ambient and real-time tiers have real numbers; the deep-conversational tier has none. |
| Blocking-tool safety | **New requirement:** any tool that gates the next line needs a guaranteed completion signal or a designer-set completion condition. Bethesda shipped deadlock-over-timeout and warned about it. |
| New action | **Pass D (evolution half)** against the named game-design sources, with community documentation explicitly permitted. |

## Primary sources

- Yarn Spinner commands: https://docs.yarnspinner.dev/yarn-spinner-for-unity/creating-commands-functions · async: https://docs.yarnspinner.dev/components/asynchronous-programming
- ink: https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md · compiler `Divert.cs`, `FlowBase.cs`
- Ruskin (Valve), *AI-driven Dynamic Dialog through Fuzzy Pattern Matching*, GDC 2012: https://cdn.fastly.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
- Valve Faceposer / Choreography: https://developer.valvesoftware.com/wiki/Faceposer_reference
- Bethesda Creation Kit Scenes (Wayback of original): https://web.archive.org/web/20201111233136/https://www.creationkit.com/index.php?title=Bethesda_Tutorial_Scenes
- Forbus & **Wright**, *Some notes on programming objects in The Sims*: https://qrg.northwestern.edu/papers/Files/Programming_Objects_in_The_Sims.pdf
- Guerrilla, *HTN Planning in Decima*: https://www.guerrilla-games.com/read/htn-planning-in-decima
- Jacopin, *Optimizing Practical Planning for Game AI*, Game AI Pro 2 ch.13: https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter13_Optimizing_Practical_Planning_for_Game_AI.pdf
- Sunshine-Hill, *LOD Trader*, Game AI Pro 1 ch.14: http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter14_Phenomenal_AI_Level-of-Detail_Control_with_the_LOD_Trader.pdf
