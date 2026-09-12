# Conditional tool visibility and quest-state gating

Research pass 09-C, 2026-09-12. Claim ledger with every raw candidate and its fate:
[`raw/c-tool-gating-and-quests.md`](raw/c-tool-gating-and-quests.md). Provenance labels follow
[`../README.md`](../README.md): demonstrated / marketing / research-only / community.

## The headline

The API-level mechanisms to gate an NPC tool on game state are shipped and documented: per-turn
`tool_choice` (auto / any / tool / none), `strict` schema validation, and `allowed_callers`. None
replaces server-side authority: the vendor's own cookbook says the model is "over-eager" to call
tools and will call a forced tool even when irrelevant, so game state, not the model, decides whether
`reward_player` is legal. Deferred, searchable tool lists are real but built for 50+ tool libraries
and add a round-trip; for a quest-giver with under ten tools they solve nothing and cost budget.
Evidence on shipped quest machines and on Inworld/Convai/Charisma did not arrive; what we have there
is already decided in `PRODUCT.md` section 3.7. Today's runtime does none of this: visibility is
static permission filtering (`src/core/tools.ts:338-430`), every provider hard-codes `auto`, no tool
uses strict, and no quest-state field exists in the schema.

## 1. Quest stage machines and dialogue conditions in shipped games

**No new evidence survived.** The single Skyrim/Papyrus claim was refuted (see "Did not survive
verification"); the three Creation Kit wiki pages were unreadable (see "Coverage gaps").

What is settled lives in `PRODUCT.md` section 3.7, from
[`../04-game-prior-art-actions-and-evolution.md`](../04-game-prior-art-actions-and-evolution.md):
item 6 (The Sims' Check Tree is one legality predicate removing an unavailable interaction from both
the player's menu and the AI's candidate set) and item 4 (Valve's response rules re-query
preconditions when the next line begins). That is the game-side pattern this pass would have
recommended anyway: one predicate, evaluated before commitment, re-evaluated late.

## 2. LLM agent tool gating

**Finding 2.1 - high (3-0), demonstrated.** `tool_choice` has four modes. `auto` lets the model
decide, `any` requires some tool, `tool` forces a named tool, `none` forbids tools
(https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools). Three caveats matter for a
per-turn gate: forced modes are unsupported on some models/settings and cannot target a client
toolset; forcing a tool suppresses the natural-language preamble; and changing `tool_choice` between
turns invalidates cached message blocks (tool definitions and system prompt stay cached)
(https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference). The cache caveat is
load-bearing for a 1-2 s budget: flipping `tool_choice` per turn re-processes message content.

*Code today does the opposite:* no provider exposes `tool_choice` at all. OpenAI and Grok hard-code
`'auto'` (`src/providers/llm/openai.ts:162`, `src/providers/llm/grok.ts:161`), Gemini hard-codes
`FunctionCallingMode.AUTO` (`src/providers/llm/gemini.ts:196`), and the Anthropic provider sends
tools with no `tool_choice` at all (`src/providers/llm/anthropic.ts:152-154`), which defaults to auto.

**Finding 2.2 - high (3-0), demonstrated.** `strict: true` guarantees schema validation on tool
names and inputs for all tools except `mcp_toolset` and the computer/browser toolsets; combined with
`tool_choice: any` this guarantees both that some tool is called and that its input conforms.
`allowed_callers` can restrict a tool so it is only invocable from a specific caller context, for
example code execution and not a direct model call
(https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference). The
`any`+`strict` composition is our synthesis of two independently documented guarantees, not a
sentence in the docs.

*Code today:* no tool definition sets `strict` (grep across `src/providers/llm/*.ts` and
`src/core/mind.ts` finds no occurrence). Argument checking is a home-grown pass in
`src/mcp/validator.ts:19-60` that checks required keys and `typeof` against the declared type, which
is weaker than provider-side schema enforcement and runs after the model has already produced a
malformed call.

**Finding 2.3 - medium (2-1), demonstrated mechanism, refuted on scope.** Tools marked
`defer_loading: true` stay out of context until a tool-search step surfaces them, and this preserves
prompt caching because deferred tools never enter the cached prefix
(https://anthropic.com/engineering/advanced-tool-use). The dissent stands: this is built for large
tool libraries in non-realtime workflows, adds a search round-trip, and a quest-giver with a handful
of tools has no context-bloat problem. Pattern noted; do not adopt.

**Finding 2.4 - marketing, importance low.** Anthropic reports worked input examples raised
correct-parameter accuracy "from 72% to 90% on complex parameter handling" and advises 1-5 examples
per tool (https://anthropic.com/engineering/advanced-tool-use). The figure is undisclosed vendor
internal testing, so marketing, not demonstrated. Per-example token-cost figures attached to this
claim could not be agreed on by the verifiers and are omitted. *Code today:* no tool in `src/mcp/registry.ts` or
`src/core/tools.ts` carries examples.

## 3. Server-side authority

**Finding 3.1 - high (3-0), demonstrated.** Anthropic's own cookbook states "Often, Claude can be
over-eager to call tools", shows a forced tool firing on an unrelated prompt, and says that even with
`tool_choice` forcing a call, basic prompt engineering is still recommended rather than relying on the
constraint alone (https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/tool_choice.ipynb).
For us: a tool call is a *proposal*, never a *fact*. If `reward_player` is exposed the model will
sometimes call it before the quest is complete; if forced, it will call it regardless. Completion is
read from game state by the executor, never inferred from the call.

*Code today does the opposite in two ways.* First, the Mind prompt tells the model "These are YOUR
tools - use them proactively when appropriate" (`src/core/mind.ts:103`), which is the opposite
nudge from what the cookbook recommends for an over-eager model. Second, there is no precondition
check at execution: `update_quest` is a bare tool definition with a free-text `action` field
(`src/mcp/registry.ts:293-315`) and nothing durable receives it, because neither `NPCInstance` nor
`SessionState` has a quest-state slot (`src/types/npc.ts:136-149`, `src/schema/index.ts:150-163`).
Whatever the model says about the quest is the only record.

**Vendor NPC platforms (Inworld goals/triggers, Convai narrative design, Charisma conditions): no
usable evidence retrieved this pass.** See "Coverage gaps".

## 4. Authoring gates

**No evidence retrieved** on DSL vs JSON predicate vs code, or on ink / Yarn / articy / Twine
workflows. Finding 2.4 addresses how the *model* reads a tool, not how a *designer* writes a gate.
`PRODUCT.md` section 3.7 items 1 and 6 already commit us to a typed, registry-listed command surface
with one legality predicate; the predicate language is undecided and unresearched.

## 5. Directing players to quests

**No evidence retrieved** on quest-giver patterns, hint ladders, objective reveal, or stopping the
model inventing quests or rewards. One inference from finding 3.1, unsourced: a model over-eager to
call a tool is also over-eager to *narrate* its effect, so a refused `reward_player` must be written
back into the next prompt as a fact or the NPC will have promised what the game did not deliver.

## 6. Anti-patterns and mitigations

**Over-triggering.** Finding 3.1: negative examples and "when in doubt, do nothing" are
recommended even with the API constraint in place. *Code today partly agrees:* the Mind prompt has a
NEVER list and "When in doubt: NO_ACTION" for `exit_convo` (`src/core/mind.ts:115-119`), the right
shape. Project action tools get the opposite, "use them proactively" (`src/core/mind.ts:103`).

**Tool-call hallucination.** Finding 2.2: `strict` removes malformed names and inputs at the
provider. It does nothing about a well-formed call whose *precondition* is false; that is the
executor's job (finding 3.1).

**Late revalidation.** Decided in `PRODUCT.md` section 3.7 item 4. Why it bites here: the Speaker
commits its reply (`src/conversation/turn.ts:327`) before `mindPromise` resolves (`turn.ts:329`) and
actions execute in a serial follow-up (`turn.ts:372-397`), so the state a tool was chosen against can
be a full Speaker generation old at execution. Any gate evaluated at prompt assembly must be
re-evaluated at execution.

## Did not survive verification

Do not design against these.

1. **"Exposing all tools up front degrades accuracy at scale (Opus 4: 49% to 74%, Opus 4.5: 79.5%
   to 88.1% with Tool Search; RAG-MCP 43.13% vs 13.62%)"** - 1-2. Numbers are verbatim from
   https://anthropic.com/engineering/advanced-tool-use and https://arxiv.org/abs/2505.03275, but both
   concern 50+ tool libraries, Anthropic's figures are undisclosed "internal testing", and a search
   round-trip eats a 1-2 s turn. Does not transfer to a small fixed tool set; do not use it to justify
   conditional visibility on accuracy grounds.
2. **"Skyrim quest-stage done flags are non-monotonic and can be set before the stage's effects
   finish"** - 1-2. The only source
   (https://papyrus.bellcube.dev/skyrimse/script/quest/function/getstagedone/) is community, not
   first-party or measured; the second half of the claim is not on the page; and Papyrus scripting is
   not a pattern for live gating in a streaming voice turn.
3. **"Anthropic's top tool-design recommendation is to consolidate operations into one tool with a
   discriminator parameter"** - 1-2. Verbatim on
   https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools, but that page ranks
   detailed descriptions first, "by far the most important factor"; consolidation is third and
   unbenchmarked. `update_quest` with its free-text `action` (`src/mcp/registry.ts:293-315`) is already
   discriminator-shaped; do not cite this to keep it.

## Coverage gaps

- **Sub-question 1** (shipped quest machines): only Papyrus reached, and refuted. Unreadable to the
  fetcher: https://ck.uesp.net/wiki/Condition_Functions, https://ck.uesp.net/wiki/Quest_Data_Tab,
  https://skyrimck.uesp.net/w/index.php?title=Quest_Stages_Tab. Fetch by hand, as Pass D did for
  pricing. Next targets: Yarn Spinner docs on `<<declare>>`/`<<if>>`; ink docs on conditional choices
  and visit counts; Valve Developer Community "Response System" (criteria, concepts); Witcher 3 REDkit
  quest-graph docs; Pixel Crushers Dialogue System "Conditions"; Maxis GDC material on Check Trees.
- **Sub-question 3** (Inworld goals/triggers, Convai narrative design, Charisma conditions): nothing
  retrieved. Documentation-retrieval targets: Inworld "Goals and Actions", Convai "Narrative Design",
  Charisma conditions docs. These vendors' pages were JS shells in Pass D; go manual.
- **Sub-question 4** (predicate authoring): nothing. Targets: articy:draft "Conditions and
  Instructions", Twine SugarCube `<<if>>`, ink logic docs, Yarn Spinner "Logic and Variables".
- **Sub-question 5** (quest-giver patterns, hint ladders, invented rewards): nothing. Targets: GDC
  quest-design talks (Bungie, CD Projekt, Obsidian); any Inworld/Convai post-mortem on NPCs promising
  undeliverable rewards.

## What this changes

1. **Add a `gameState` input to `CognitionRuntime.turn(input, state)`** (`PRODUCT.md` section 3.6)
   and thread it into `getMindAvailableTools` (`src/core/tools.ts:338-430`) so visibility is computed
   from live state, not only static `mcp_permissions` (change 4 in
   [`diagnosis/memory-knowledge-tools.md`](diagnosis/memory-knowledge-tools.md)). Visibility is a
   *filter on the tool list*, not a `tool_choice` flip, because flips invalidate cached messages
   (finding 2.1).
2. **Make the executor the authority.** Each tool in `src/mcp/registry.ts` gets an optional
   `precondition(gameState)` evaluated twice: at tool-list assembly and again immediately before
   execution in `src/conversation/turn.ts:372-397` and `src/voice/pipeline.ts:1074-1130`. A false
   precondition at execution refuses the call and writes the refusal back as a fact for the next
   prompt (finding 3.1; `PRODUCT.md` section 3.7 items 4, 6, 7). Same predicate in both places.
3. **Add a durable quest-state slot** (`quest_state: Record<string, string>` on `NPCInstance`,
   `src/schema/index.ts:150-163`) and make `update_quest`'s `action` an enum
   (`src/mcp/registry.ts:293-315`). Without a slot a precondition has nothing to read.
4. **Expose `tool_choice` and `strict` through the provider interface** (`src/providers/llm/*.ts`;
   all four hard-code auto, none set strict). Use `none` when the game says no action is legal, and
   `strict: true` on every Anthropic tool (finding 2.2). Do not force game actions with `any`/`tool`:
   forced tools fire on irrelevant input (finding 3.1).
5. **Rewrite the Mind's action-tool instruction** (`src/core/mind.ts:103`): replace "use them
   proactively" with the NEVER-list plus "when in doubt: NO_ACTION" shape `exit_convo` already has
   (`src/core/mind.ts:115-119`). Required even with API constraints (finding 3.1).
6. **Do not adopt deferred/searchable tool loading** (finding 2.3, refuted claim 1). Revisit only if
   a project registers dozens of tools.
7. **Playground harness** ([`diagnosis/eval-harness.md`](diagnosis/eval-harness.md)): the live
   scenario format needs a per-turn `gameState` block and expected-visible-tools list, so a fixture
   can assert `reward_player` was *not offered* on turn 3, *was offered* on turn 5, and that a call
   against a false precondition was refused. That produces our own over-triggering numbers, which the
   literature does not supply.

## Infra candidates

| Name | What it is | Verdict | Why |
|---|---|---|---|
| Anthropic `tool_choice` (auto/any/tool/none) | Per-request API parameter constraining tool use | pattern-only | Vendor-specific; we need the same four modes across four providers, exposed through our own provider interface. Use `none` for gating, avoid forced modes (findings 2.1, 3.1). |
| Anthropic `strict: true` | Provider-side schema enforcement on tool name and input | adopt (as a flag on our Tool type, mapped per provider) | Pure request flag with no dependency; removes a whole class of malformed calls before our validator sees them (finding 2.2). |
| Anthropic `allowed_callers` | Restricts which caller context may invoke a tool | pattern-only | Interesting shape for "executor-only" tools but tied to Anthropic code execution; our equivalent is a precondition on the registry entry. |
| Anthropic Tool Search / `defer_loading` | Tools hidden until a search step surfaces them | reject | Built for 50+ tool libraries; adds a round-trip inside a 1-2 s budget; refuted for our scope (finding 2.3). |
| Tool `input_examples` | Worked examples inside a tool definition | pattern-only | Cheap to add to our registry schema; accuracy figure is marketing, so measure in the harness before relying on it (finding 2.4). |
| RAG-MCP (arXiv 2505.03275) | Retrieval-based tool filtering | reject | research-only, and only relevant at tool-library scale we do not have. |

## Sources

- https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools - demonstrated (first-party API docs)
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference - demonstrated (first-party API docs)
- https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use - demonstrated (first-party API docs, corroborating)
- https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/tool_choice.ipynb - demonstrated (first-party notebook with executed output)
- https://anthropic.com/engineering/advanced-tool-use - demonstrated for the `defer_loading` mechanism; marketing for the 72%-to-90%, 49%-to-74%, and 79.5%-to-88.1% figures (undisclosed internal testing)
- https://arxiv.org/abs/2505.03275 (RAG-MCP) - research-only; cited only as a refuted-for-scope claim
- https://papyrus.bellcube.dev/skyrimse/script/quest/function/getstagedone/ - community; refuted claim only
- `PRODUCT.md` section 3.7 and `research/04-game-prior-art-actions-and-evolution.md` - prior settled decisions referenced, not re-verified here
