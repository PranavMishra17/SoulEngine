# E - Role-play agent practice: persona consistency, character brains, lorebooks, prompt caching

Pass 09, angle E. Run 2026-09-12. 49 claims extracted, top 8 put through a 3-lens adversarial
check, 6 survived (5 unanimous, 1 at 2-1). Full ledger: [`raw/e-roleplay-persona.md`](raw/e-roleplay-persona.md).
Provenance labels follow [`../README.md`](../README.md): demonstrated / marketing / research-only /
community. Ledger items that were **not** put through verification are marked "ledger, unverified"
and must not be designed against without a follow-up check.

## The headline

The only part of this angle that produced hard, verified evidence is prompt caching. Both Anthropic
and OpenAI document the same rule: a byte-stable persona-plus-knowledge prefix first, everything that
changes per turn last, with the cache breakpoint on the stable part. Our slim prompt does the reverse
(`src/core/context.ts:610-654` puts mood, relationship, memories and the daily-pulse takeaway *before*
the fixed boilerplate) and the one provider that caches at all wraps the whole string in a single
block (`src/providers/llm/anthropic.ts:141-150`), so any turn-to-turn change discards the entire cache.
On speech style, the one verified fact is that ElevenLabs v3 audio tags and SSML are mutually
exclusive, which means the TTS-direction vocabulary is a per-provider choice, not a universal layer.
Persona-card field structure, long-session drift mitigations, the RP evaluation benchmarks, RP memory
products and small-model quality evidence all came back either community-grade and unverified, or
empty. Those are the gaps to close before the persona prompt is redesigned.

## 1. Persona prompt structure

**No claim in this sub-question survived verification.** The one selected (post_history_instructions
carrying "much stronger weight" than the system prompt) was refuted; see below.

What the ledger holds, all **community, unverified** (Character Card V2 spec,
https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md, ledger #12, #33,
#35, #36): a `system_prompt` field that replaces the frontend's default; `creator_notes` that MUST NOT
enter the prompt; `alternate_greetings` as multiple authored openers; a per-character `character_book`
that stacks with a world book and takes precedence on conflict. The transferable idea is separating
*author-facing* metadata from *model-facing* text, and layering per-character lore over shared world
lore - close to our tiered `knowledge_access` (`src/core/knowledge.ts:38-62`), but nothing here
validates it.

Character.AI definitions, Inworld character-brain fields and Convai backstory were **not retrieved**.

## 2. Consistency over long sessions

**No verified evidence.** Nothing on persona drift rates, assistant leakage, author-note or periodic
reinforcement, or RP fine-tunes survived or was even selected. PersonaGym, CharacterEval, RoleLLM
and Character-LLM were not retrieved in this batch.

One ledger caution (**demonstrated per SillyTavern docs, unverified**,
https://docs.sillytavern.app/extensions/summarize/, ledger #22): the Summarize docs warn that
LLM-generated summaries "may lose some important details or contain hallucinations" and expect manual
review. Our `summarizeConversation` (`src/core/summarizer.ts:136`, called once at session end from
`src/session/manager.ts:354-356`) has no review step, so a hallucinated summary silently becomes
long-term memory.

What the code already does, so nobody re-invents it: a role block ("You are NOT a chatbot, assistant,
or AI", `src/core/context.ts:597-601`), behavioral guidance with BAD/GOOD exposition examples
(`src/core/context.ts:71-94`), a task block forbidding narration (`src/core/context.ts:540-556`), and a
post-hoc `stripNarration` filter (`src/conversation/turn.ts:132-143`). None is measured; no drift
metric exists in `tests/`.

## 3. Speech style for voice

**Finding (medium, 2-1, marketing).** Eleven v3 "doesn't support SSML break tags or the rest of the
SSML tag set" (https://elevenlabs.io/blog/v3-audiotags). Two verifiers confirmed the sentence
verbatim; the dissent downgraded the label to marketing because it is a first-party capability
statement with no test shown. Either way: bracketed audio tags *replace* SSML on that model. Any tag
vocabulary we emit must be selected per TTS provider and model.

Ledger, **marketing, unverified** (same URL, #44, #45, #47, #49): tags are bracketed cues like
`[laughs]` or `[whispers]`, stackable, spanning emotion / delivery / reaction / accent / sound-effect
categories, and they fail when the voice's natural character mismatches the request. Hume was not
retrieved.

Where the code stands: text mode strips `(...)` and `*...*` (`src/conversation/turn.ts:132-143`) and
the task block forbids both (`src/core/context.ts:544-548`); voice mode adds only "Short sentences,
natural rhythm. No written formatting." (`src/core/context.ts:551-553`). Two gaps: the voice pipeline
never calls `stripNarration` (no reference in `src/voice/` or `src/ws/`), so a parenthetical stage
direction reaches `synthesizeSentence` (`src/voice/pipeline.ts:1230-1245`) and is spoken; and
square-bracket tags are neither forbidden nor stripped, so `[sighs]` would be read literally by the
default TTS (Cartesia `sonic-2`, `src/providers/tts/cartesia.ts:15`).

## 4. Prompt caching

This is the well-evidenced section. All five findings are **high confidence, 3-0, demonstrated**
(first-party API documentation, re-fetched live on 2026-09-12 by the verifiers).

- **Stable first, dynamic last.** OpenAI: "Put stable developer instructions and shared reference
  material first. If developer instructions or shared material contain timestamps, user-specific
  content, or other dynamic content, place those at the end rather than the beginning."
  (https://developers.openai.com/api/docs/guides/prompt-caching). **Our code does the opposite:**
  `assembleSlimSystemPrompt` orders role, core anchor, personality, *mood, relationship, player
  identity, known NPCs, memories, daily pulse*, then the fixed behavioral / security / injection /
  task boilerplate (`src/core/context.ts:597-654`), and the deferred `[MIND CONTEXT]` block is
  appended after that (`src/conversation/turn.ts:277-286`, `src/core/context.ts:769-775`).
- **Breakpoint placement decides whether anything hits.** Anthropic: the lookback window is 20
  blocks; a breakpoint on content that changes every request never matches a prior write even when
  stable content sits behind it (https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
  **Our code puts the single `cache_control` on the whole system string**
  (`src/providers/llm/anthropic.ts:141-150`), so a different memory selection or an appended MIND
  CONTEXT block misses every time.
- **Invalidation triggers.** OpenAI: changing "model, tools, parallel_tool_calls, output schemas,
  reasoning.effort, text.verbosity, or context_management" breaks reuse, as does editing an existing
  message in place rather than appending (same URL). Relevant to us because the Mind's tool list is
  not constant: `exit_convo` is force-added when `securityContext.exitRequested` flips
  (`src/core/tools.ts:112-119, 415-418`), and PRODUCT.md §3.4 evolution would rewrite persona text
  mid-session if applied naively.
- **Caches are machine-local.** OpenAI recommends a stable `prompt_cache_key` per shared prefix and
  about 15 requests per minute per key to keep routing sticky (same URL); one verifier notes the key
  becomes optional for routing on GPT-5.6 and later. A single few-and-deep session will rarely sustain
  15 requests/min, so key on the *NPC definition* (shared across players), not the session.
  `src/providers/llm/openai.ts` sends no `prompt_cache_key` today (grep: no match).
- **Pricing and TTL.** Anthropic: 5-minute default TTL; writes at 1.25x (5-min) or 2.0x (1-hour),
  reads at 0.1x base input price (same Anthropic URL). Turns 1-2s apart sit inside the 5-minute TTL;
  the 1-hour tier is for the gap between *visits* and costs double to write.

Ledger, **demonstrated per vendor docs, unverified** (#2, #13, #15, #5): minimum cacheable prefix is
model-dependent (1024 or 4096 tokens on Anthropic; 1024 on GPT-5.6+), below which nothing is cached
and no error is raised; OpenAI TTL is 30 minutes on GPT-5.6+; Anthropic allows a `max_tokens: 0`
pre-warm. The minimum matters: the diagnosis estimates our slim prompt at 1000-2500 tokens with no
measured baseline (`diagnosis/turn-latency-path.md`), so caching may be silently doing nothing.

Also outside any cache today: the Mind prompt embeds the last 5 messages inside the system text
(`src/core/mind.ts:82-95`), and the default provider is Gemini with no caching path
(`src/providers/llm/factory.ts:44-46`).

## 5. Small fast models for role-play

**Coverage gap.** No usable claim in the 49. Nothing on Haiku-class, 4o-mini-class, Gemini Flash or
open RP fine-tunes, for either latency or quality. See "Coverage gaps".

## 6. Memory in RP tools

**No verified evidence.** Ledger only, unverified:

- SillyTavern Summarize (**demonstrated per docs**, https://docs.sillytavern.app/extensions/summarize/,
  #19-#21): a running summary regenerated every N messages or words, injected via a `{{summary}}`
  macro at a configurable position, blocking or non-blocking; the auxiliary BART summarizer has about a
  1024-token context.
- SillyTavern World Info (**demonstrated per docs**, https://docs.sillytavern.app/usage/core-concepts/worldinfo/,
  #38-#43): keyword-triggered lore, recursive activation with a depth cap, a per-turn token budget
  with constant entries loaded first, six insertion positions, and inclusion groups so only one
  competing entry fires.
- Vector memory (**community**, https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems,
  #29-#31): semantic retrieval with the live chat as query, and one shared injection abstraction for
  lore, author's note and summaries.

Kindroid, Replika and Inworld memory were **not retrieved**; no per-turn cost figures were found.

Contrast with our runtime: 8 memories under a 1500-token budget, recency-first
(`src/core/context.ts:16, 19, 207-228`), session-end-only summarization, and `recall_*` results always
one turn late (`src/conversation/turn.ts:366-370`). World Info's budget-plus-priority insertion is the
closest published analogue to §3.4's ThoughtDef retrieval weighting, but unverified here.

## Did not survive verification

- **"Changing tool definitions invalidates tools, system and messages caches; toggling `tool_choice`
  invalidates tools and system but not messages"** (Anthropic caching doc), 1-2. Two verifiers read the
  live invalidation table and found `tool_choice` **backwards**: it invalidates only Messages and leaves
  Tools and System valid. Do not cite this claim; re-derive from the table directly if needed.
- **"`post_history_instructions` is the jailbreak/UJB field, injected after chat history, which
  carries much stronger weight than the system prompt, and frontends must use it that way"**
  (Character Card V2 spec), 1-2. The MUST-replace-ujb sentence is verbatim, but the "much stronger
  weight" assertion appears nowhere in the source; the spec is a community convention with no
  compliance mechanism, and the frame does not transfer to a voice quest-giver runtime.

## Coverage gaps

- **Sub-question 5 (small fast models)**: empty. Next: vendor model cards and pricing pages for
  Haiku, GPT-4o-mini / GPT-5-mini class and Gemini Flash (time-to-first-token if published);
  independent latency leaderboards such as Artificial Analysis; the PersonaGym, CharacterEval,
  RoleLLM and Character-LLM papers for small-model role-play scores; SillyTavern community model
  threads for open RP fine-tunes (community label).
- **Sub-question 2 (drift, leakage, benchmarks)**: the four benchmarks were not fetched. Next: their
  arXiv pages and GitHub repos, plus Character.AI's character-definition guidance.
- **Sub-questions 1 and 6 (vendor brains and memory)**: Inworld page unreadable; Convai, Character.AI,
  Kindroid and Replika not retrieved. Next: a rendered browser session, the fix that worked in pass 07.
- **Sub-question 3**: Hume delivery tags and Cartesia's own emotion/speed controls not researched.
- Unreadable: https://openai.com/index/api-prompt-caching/, https://docs.inworld.ai/docs/tutorial-basics/core-description/.

## What this changes

1. **Reorder `assembleSlimSystemPrompt` (`src/core/context.ts:597-654`)** into a stable prefix (role,
   core anchor, personality baseline, behavioral guidance, security, injection resistance, task) and a
   dynamic suffix (mood, relationship, player identity, known NPCs, memories, daily pulse, MIND
   CONTEXT), returned as two halves so a provider can put a breakpoint between them. Affects
   `LLMRequest.systemPrompt` and the callers at `src/conversation/turn.ts:225` and
   `src/voice/pipeline.ts:880-887`.
2. **Split the Anthropic system block (`src/providers/llm/anthropic.ts:141-150`)** into two blocks with
   `cache_control` on the stable one only. **Add `prompt_cache_key` to `src/providers/llm/openai.ts`**,
   keyed on NPC definition id plus version, not session id. Measure; if the prefix is under the
   (unverified) minimum, padding with the omitted world-knowledge section (`src/core/context.ts:626`)
   may be what makes it cacheable.
3. **Keep the Mind's tool list constant within a session.** The `exitRequested` force-add
   (`src/core/tools.ts:112-119, 415-418`) changes the tool set per turn, which breaks the OpenAI cache.
   Offer `exit_convo` always (it cannot be denied anyway, `src/core/tools.ts:141-145`) and gate it in
   the executor - PRODUCT.md §3.7 rule 6, one legality predicate.
4. **PRODUCT.md §3.4 evolution must not rewrite the stable prefix mid-session.** Trait drift and
   relationship changes belong in the dynamic suffix; authored persona text is frozen for the session,
   which §3.4 rule 1 (immutability line at creation) already implies.
5. **Voice output hygiene (`src/voice/pipeline.ts:961-968`)**: run `stripNarration` (or a streaming
   equivalent in `SentenceDetector`) before TTS, and give `TTSProvider`
   (`src/providers/tts/interface.ts`) a declared tag dialect - `none`, `ssml` or `bracket-tags` -
   since they are mutually exclusive per the v3 finding. Cartesia today is `none`.
6. **Playground harness**: record `cache_read_input_tokens` / `cached_tokens` per call and add a
   `cacheHitRatio` next to `TurnTimings` (`src/conversation/turn.ts:90-99`); cost accounting must price
   cached and uncached input separately (0.1x / 1.25x / 2.0x on Anthropic). Add a unit test asserting
   the stable prefix is byte-identical across two turns - the cheapest guard for item 1.
7. **Add a review seam** before `summarizeConversation` output becomes long-term memory
   (`src/session/manager.ts:354-356`), consistent with §3.4's "no hidden memory store" rule.

## Infra candidates

| Name | What it is | Verdict | Why |
|---|---|---|---|
| Anthropic prompt caching (`cache_control`) | Provider API feature: explicit breakpoints, 5-min/1-h TTL, 0.1x reads | adopt (API feature, not a dependency) | Already half-wired at `anthropic.ts:141-150`; needs the two-block split |
| OpenAI prompt caching + `prompt_cache_key` | Provider API feature: automatic prefix cache, machine-local routing | adopt (API feature) | Zero code today in `openai.ts`; one header-level field |
| Character Card V2/V3 spec | Community JSON schema for persona fields and embedded lorebook | pattern-only | Author-vs-model field separation and lore precedence are ideas to copy; the format and jailbreak fields are not ours |
| SillyTavern World Info | Keyword-triggered lore with token budget, priority, insertion groups | pattern-only | Budget-first, priority-ordered lore insertion is a useful template for §3.4 retrieval weighting; unverified here |
| SillyTavern Summarize / vector memory | Running summary macro plus embedding retrieval | pattern-only | Confirms cadence-based summarization and the hallucination caveat; we already have a summarizer |
| ElevenLabs v3 audio tags | Bracketed delivery cues, no SSML | pattern-only | Vendor-specific dialect; informs the tag-dialect field on `TTSProvider`, not an adoption |
| SSML | W3C markup for pauses/prosody | pattern-only | Mutually exclusive with v3 tags; support only if the selected TTS accepts it |
| Inworld / Convai / Character.AI character brains | Vendor persona schemas | no verdict | Not retrieved this pass |

## Sources

- https://platform.claude.com/docs/en/build-with-claude/prompt-caching - demonstrated (first-party API docs; c1, c8; refuted tool_choice claim)
- https://developers.openai.com/api/docs/guides/prompt-caching - demonstrated (first-party API docs; c2, c4, c5)
- https://elevenlabs.io/blog/v3-audiotags - marketing (vendor blog; c7 at 2-1, plus unverified ledger #44-#49)
- https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md - community (unofficial spec; refuted c6, unverified ledger #12, #33, #35, #36)
- https://docs.sillytavern.app/extensions/summarize/ - demonstrated per project docs, unverified in this pass (ledger #19-#22)
- https://docs.sillytavern.app/usage/core-concepts/worldinfo/ - demonstrated per project docs, unverified in this pass (ledger #38-#43)
- https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems - community (auto-generated wiki), unverified (ledger #29-#31)
- Unreadable: https://openai.com/index/api-prompt-caching/, https://docs.inworld.ai/docs/tutorial-basics/core-description/
