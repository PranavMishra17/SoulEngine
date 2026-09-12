# Text-Mode Turn: Latency and Coherence Path

Traced from `src/routes/conversation.ts:49` through `src/conversation/turn.ts`,
`src/core/mind.ts`, `src/core/context.ts`, `src/core/summarizer.ts`, and
`src/providers/llm/*.ts`. Describes current code, not a proposal.

## Flow

```
POST /:sessionId/message                    (routes/conversation.ts:49)
 -> session lookup, auth, rate limit         (routes/conversation.ts:64-108)
 -> runConversationTurn()                    (turn.ts:188)
      sanitize()                             (turn.ts:200)
      await moderate()  [keyword match, no LLM]        (turn.ts:208; security/moderator.ts:47)
      await getSessionContext()  [storage I/O]          (turn.ts:220; session/manager.ts:515-529)
      await assembleSlimSystemPrompt()                  (turn.ts:225; context.ts:575)
      assembleConversationHistory(..., 20)              (turn.ts:237; context.ts:670)
      inject deferred_mind_context if present           (turn.ts:277-286; context.ts:769)
      start mindTimeout/AbortController                 (turn.ts:288-289)

      +-- mindPromise (background) --+   +-- Speaker stream (awaited) --+
      | runMindAgentLoop()            |   | activeProvider.streamChat()  |
      | (mind.ts:287)                 |   | (turn.ts:317-323)            |
      +--------------------------------+  +-------------------------------+
                                                stripNarration(); save reply (turn.ts:326-327)
      await mindPromise (turn.ts:329)   <-- Speaker has ALREADY replied
      partitionMindToolResults() (turn.ts:360, 155)
        recall -> state.deferred_mind_context, NEXT turn (turn.ts:366-370)
        MCP action -> buildFollowUpPrompt() -> 2nd Speaker call (turn.ts:372-397)
      accounting, mood update, appendSessionLog (turn.ts:401-477)
```

## LLM calls, order and awaiting

Up to three model calls, on up to two independently configured providers
(`turn.ts:259-269`): (1) **Mind call** — `runMindAgentLoop`'s single `streamChat` with the
Mind prompt and tool list, empty `messages: []` (`mind.ts:341-346`), launched via
`mindPromise` and not awaited before the Speaker starts (`turn.ts:291-310`). (2) **Speaker
call** — `activeProvider.streamChat` with the slim prompt and last 20 history messages
(`turn.ts:317-323`); this is the only call whose first token is "the reply," and it does not
wait on the Mind — `mindPromise` is awaited only afterward, at `turn.ts:329`. (3)
**Follow-up call** — only if an MCP (non-recall) tool ran; built by `buildFollowUpPrompt` and
run strictly after the main reply is produced and stored (`turn.ts:372-397`).

Calls 1 and 2 overlap; call 3, when present, is pure addition after both, not part of the
overlap the `TurnTimings.wallMs` comment describes ("Mind and Speaker overlap, so this is not
their sum," `turn.ts:97-98`). On the critical path to the Speaker's first token: session
lookup, `sanitize` (sync), `moderate` (sync keyword match, no network call,
`security/moderator.ts:47-77`), `getSessionContext` (`storage.getProject`/`getDefinition`/
`getKnowledgeBase`/`loadApiKeysOrEmpty` via `Promise.all`, plus a conditional MCP-tools load —
`session/manager.ts:524-555`), and `assembleSlimSystemPrompt` (mostly string building, but
`formatKnownNpcsTier1Only` does one `storage.getDefinition` per network entry,
`context.ts:508-534`). Only the Mind call and tool execution are off that path.

## Deferred recall to the next turn

`runMindAgentLoop` never speaks; it returns `tool_context`/`tools_called` (`mind.ts:451-464`).
`partitionMindToolResults` (`turn.ts:155-180`) splits results by `isRecallTool`: recall
results (`recall_npc`, `recall_knowledge`, `recall_memories`) are joined and stored as
`state.deferred_mind_context` (`turn.ts:366-370`) — an empty recall is dropped rather than
deferred (`mind.ts:247-252`, ERR-022) — while MCP action results feed the same turn's
follow-up call (`turn.ts:372-397`). At the *start* of the *next* turn,
`augmentPromptWithMindContext` splices the deferred text into that turn's Speaker prompt as a
`[MIND CONTEXT]` block, then clears it (`turn.ts:279-286, 285`; `context.ts:769-775`). Recall
is one full turn late by construction.

## Say-A-do-B coherence hazard

1. **Speaker replies before Mind's recall lands** (`turn.ts:291-329`): the Speaker generates
   with zero knowledge of what the Mind concurrently retrieves; a "do you remember me"
   question can get a "no" that the next turn's `[MIND CONTEXT]` then contradicts.
2. **Speaker replies before Mind's action executes** (`turn.ts:291-397`): the main reply is
   generated and saved (`turn.ts:327`) *before* `mindPromise` is awaited, so if the Mind
   calls an action tool (`request_credentials`, `call_guards`) the already-spoken line can't
   reference it. The forced follow-up ("Briefly address it," `turn.ts:374-397`;
   `context.ts:782-784`) is a second, separately-prompted call bolted on after, not a
   correction of the first.
3. **Mind timeout races independent of outcome** (`turn.ts:272, 288-310`): on abort
   (`mindTimeoutMs`, default 15000, `turn.ts:272`) `mindPromise` resolves `null`; the Speaker
   has already committed with no tool context and no signal that a decision was cut off.
4. **`exit_convo` known only after the Speaker spoke** (`turn.ts:345-351`): the exit is
   enacted after `await mindPromise`, never folded into what was already said.

## System prompt assembly

`assembleSlimSystemPrompt` (`context.ts:575`, called at `turn.ts:225`) — the unused sibling
`assembleSystemPrompt` (`context.ts:413`) includes world knowledge and full-tier NPC detail
that the live loop never calls. Slim sections in order: role (`context.ts:597-601`), core
anchor (`context.ts:49-66`), personality (`context.ts:99-107`), mood (`context.ts:112-115`),
relationship (`context.ts:154-167`), player identity if known (`context.ts:120-149`),
network flattened to Tier 1 (`context.ts:508-534`), up to 8 memories under a 1500-token
budget (`SLIM_PROMPT_MAX_MEMORIES=8` `context.ts:19`; `MEMORY_SECTION_TOKEN_BUDGET=1500`
`context.ts:16`; `context.ts:207-228`), daily-pulse takeaway (`context.ts:638-642`), fixed
behavioral/security/injection boilerplate (`context.ts:71-94, 233-250, 255-264`), and task
instructions (`context.ts:540-556`). No world knowledge or tools ever enter this prompt
(`context.ts:626`; `harness/diagnostics.ts:8-10`).

Rough size: fixed boilerplate is ~400-500 words (~600-700 tokens by the codebase's own
4-chars/token `estimateTokenCount`, `context.ts:703-705`); per-NPC identity/mood/relationship
sections are small; memory is capped at 1500 tokens. A modest NPC's slim prompt is plausibly
1000-2500 tokens, dominated by boilerplate plus whatever memories are selected — no test or
doc measures a real prompt's size; `checkContextBounds`'s 8000-token ceiling
(`context.ts:738`) is an unused warning, not an enforced limit.

**Stable vs. dynamic, and caching.** Boilerplate sections are byte-identical across turns.
Mood rarely changes (only on a moderation action, `turn.ts:428-435`), but the memory section
and the appended `[MIND CONTEXT]` block (present only when a recall was deferred) vary turn
to turn. Prompt caching exists **only** in the Anthropic provider: the whole `systemPrompt`
is sent as one `system` block with `cache_control: { type: 'ephemeral' }`
(`anthropic.ts:141-150`, `prompt-caching-2024-07-31` header at `anthropic.ts:164`). Because
it is a single block, any change anywhere in the string — including the trailing
`[MIND CONTEXT]` text or a different memory selection — invalidates the whole cached prefix;
there is no split into a stable prefix block and a separate dynamic suffix. OpenAI, Gemini,
and Grok providers have no cache-control equivalent (`openai.ts`, `gemini.ts`, `grok.ts`), and
the factory's default provider is Gemini (`factory.ts:44-46`), so caching is opt-in,
provider-specific, and not exercised by default. The Mind's own prompt
(`mind.ts:30-129`) embeds the last 5 messages verbatim (`mind.ts:82-95`) and so gets
essentially no cache benefit on any provider.

## Tool results: same turn or next

Recall results: next turn only, via `state.deferred_mind_context` (`turn.ts:366-370`;
`context.ts:769-775`). MCP action results: same turn, via the follow-up call
(`turn.ts:372-397`), after the main reply already exists. The Mind never sees its own tool
results — its `streamChat` call is single-shot; `tool_context` is only ever consumed by later
Speaker calls (`mind.ts:337-464`, comment at `mind.ts:284`: "no LLM call 2").

## Hard-coded thresholds and magic numbers

| Value | Meaning | Location |
|---|---|---|
| `15000` ms | Default Mind timeout before abort | `turn.ts:272` |
| `20` | History messages kept for Speaker/Mind | `turn.ts:237` |
| `1500` | `MEMORY_SECTION_TOKEN_BUDGET` | `context.ts:16` |
| `8` | `SLIM_PROMPT_MAX_MEMORIES` | `context.ts:19` |
| `10` | `DEFAULT_OPTIONS.maxMemories` (unused full prompt only) | `context.ts:38` |
| `20` | `DEFAULT_OPTIONS.maxHistoryMessages` | `context.ts:39` |
| `8000` | `checkContextBounds` warning ceiling (unenforced) | `context.ts:738` |
| `4` chars/token | `estimateTokenCount` heuristic | `context.ts:704` |
| `5` | Recent-history window in Mind's own prompt | `mind.ts:82` |
| `5` | Result cap, `matchMemoriesByQuery` in `recall_memories` | `mind.ts:245` |
| `5` | Result cap, `formatMemoriesForPrompt` in `recall_memories` | `mind.ts:255` |
| `4096` | `DEFAULT_MAX_TOKENS`, per provider | `anthropic.ts:14`, `openai.ts:14`, `gemini.ts:22`, `grok.ts:14` |
| `0.7` | `DEFAULT_TEMPERATURE`, per provider | `anthropic.ts:15`, `openai.ts:15`, `gemini.ts:23`, `grok.ts:15` |
| `2000` chars | Max player input length | `routes/conversation.ts:22` |

## TurnTimings and baseline numbers

`TurnTimings` (`turn.ts:90-99`) has four fields, all populated in `runConversationTurn` and
logged via `appendSessionLog` (`turn.ts:469-474`): `mindMs` (measured inside
`runMindAgentLoop`, `mind.ts:301`), `speakerMs` (around the Speaker stream, `turn.ts:313-324`),
`followUpMs` (around the optional follow-up, `null` if none, `turn.ts:382-390`), and `wallMs`
(`Date.now() - wallStart`, `turn.ts:190, 473`).

These surface in two places, neither a pass/fail latency gate: `harness/diagnostics.ts:214-216`
is a display formatter, and `tests/unit/deferred-recall-baseline.test.ts` runs `runReplay` and
`console.log`s Mind/Speaker/wall durations and "overlap savings" per turn, but its `expect()`
calls check recall/tool correctness (hit rate, tool accuracy), never a millisecond bound.
`tests/unit/voice-latency.test.ts` tests a separate voice-pipeline `LatencyTracker`
structurally (stages recorded, offsets non-negative), also with no ms threshold. No baseline
performance number is codified as a test assertion anywhere in the repo today.

## Not in the per-turn hot path

`src/core/summarizer.ts`'s `summarizeConversation` is called only from `endSession`
(`session/manager.ts:354-356`) — once per session close, never per turn.
