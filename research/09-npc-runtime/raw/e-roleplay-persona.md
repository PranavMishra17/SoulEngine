# Angle E — Role-play agent practice: persona consistency, character brains, lorebooks, prompt caching

Full ledger of the 49 extracted claims. Status is one of: kept (still a valid, distinct claim, not selected for adversarial verification), kept (cN) (selected as one of the top 8 for adversarial verification), merged-into [target] (a semantic duplicate absorbed into another claim's quote/URL), or dropped: reason.

Top 8 selected for adversarial verification: c1-c8, listed first with full detail, then the remaining 41 in original order.

---

## c1-c8 (selected for adversarial verification)

**c1** (importance 5, subq 4, demonstrated) - Anthropic prompt caching: cache lookback only checks up to 20 blocks backward from a breakpoint for a prior matching write, so a breakpoint placed on content that changes every request will never hit, even if stable content sits behind it.
Quote: "If no match is found within 20 blocks, checking stops... If you place the breakpoint on content that changes every request... the prefix hash never matches prior writes."
URL: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
Status: kept (c1)

**c2** (importance 5, subq 4, demonstrated) - OpenAI explicitly recommends structuring prompts with stable developer instructions and shared reference material first (cacheable), and dynamic user-specific content, timestamps, and current queries last.
Quote: "Put stable developer instructions and shared reference material first. If developer instructions or shared material contain timestamps, user-specific content, or other dynamic content, place those at the end rather than the beginning."
URL: https://developers.openai.com/api/docs/guides/prompt-caching
Status: kept (c2)

**c3** (importance 4, subq 4, demonstrated) - Anthropic: changing tool definitions invalidates the tools, system, and messages caches all at once, while toggling tool_choice only invalidates tools and system, not messages - meaning stable persona/knowledge content should be isolated from anything that toggles per-turn tool settings.
Quote: "Tool definitions [change invalidates] Tools Cache, System Cache, Messages Cache [all]... tool_choice parameter [invalidates] Tools, System [but not Messages]"
URL: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
Status: kept (c3)

**c4** (importance 3, subq 4, demonstrated) - OpenAI: cache reuse breaks if the model, tools, parallel_tool_calls, output schemas, reasoning effort, verbosity, or context_management change, or if existing messages are edited in place rather than appended.
Quote: "Changing model, tools, parallel_tool_calls, output schemas, reasoning.effort, text.verbosity, or context_management"
URL: https://developers.openai.com/api/docs/guides/prompt-caching
Status: kept (c4)

**c5** (importance 5, subq 4, demonstrated) - OpenAI caches are machine-local (not shared org-wide), so a stable, deterministic prompt_cache_key per user/session and at least 15 requests per minute per key are recommended to keep routing consistent enough for cache hits - a real constraint for low-traffic NPC deployments.
Quote: "Routing requests to the right machine is therefore important for cache reuse"
URL: https://developers.openai.com/api/docs/guides/prompt-caching
Status: kept (c5)

**c6** (importance 4, subq 1/2, demonstrated) - post_history_instructions is the character-card spec's formal name for what users call the jailbreak/UJB field, injected after chat history (which carries much stronger weight with current LLMs than the system prompt), and frontends are required to use it that way, overriding the user's own jailbreak settings by default.
Quote: "Frontends' default behavior MUST be to replace what users understand to be the 'ujb/jailbreak' setting with the value inside this field."
URL: https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md
Corroborating URL: https://github.com/malfoyslastname/character-card-spec-v2
Status: kept (c6)

**c7** (importance 4, subq 3, demonstrated) - Eleven v3 explicitly does not support SSML break tags or the rest of the SSML tag set, meaning tag-based direction (bracketed audio tags) replaces SSML rather than layering on top of it.
Quote: "Eleven v3 doesn't support SSML break tags or the rest of the SSML tag set."
URL: https://elevenlabs.io/blog/v3-audiotags
Status: kept (c7)

**c8** (importance 3, subq 4, demonstrated) - Anthropic cache entries default to a 5-minute TTL, can be extended to a 1-hour TTL at double the write price, and cache reads are far cheaper than fresh input tokens.
Quote: "5-minute cache writes: 1.25x base input token price... 1-hour cache writes: 2.0x base input token price... Cache reads: 0.1x base input price"
URL: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
Status: kept (c8)

---

## Full ledger (all 49, original order)

1. [demonstrated, subq 4] Prompt caching hashes a cumulative prefix in a fixed order (tools, then system, then messages), and a cache is written only at the developer-placed breakpoint, not at every position. Quote: "Cache writes happen only at your breakpoint... it writes one cache entry: a hash of the entire prefix ending at that block." URL: https://platform.claude.com/docs/en/build-with-claude/prompt-caching. Status: kept.

2. [demonstrated, subq 4] Minimum cacheable prefix length varies by model, commonly 1024 or 4096 tokens depending on model class; below the minimum nothing is cached and no error is raised. Quote: "Shorter prompts cannot be cached; no error is returned." URL: https://platform.claude.com/docs/en/build-with-claude/prompt-caching. Status: kept.

3. [demonstrated, subq 4] Cache entries default to a 5-minute TTL and can optionally be extended to a 1-hour TTL at double the write price; cache reads are far cheaper than fresh input tokens. Quote: "5-minute cache writes: 1.25x base input token price... 1-hour cache writes: 2.0x base input token price... Cache reads: 0.1x base input price" URL: https://platform.claude.com/docs/en/build-with-claude/prompt-caching. Status: kept (c8).

4. [demonstrated, subq 4] Cache lookback only checks up to 20 blocks backward from a breakpoint for a prior matching write, so a breakpoint placed on content that changes every request will never hit, even if stable content sits behind it. Quote: "If no match is found within 20 blocks, checking stops... the prefix hash never matches prior writes." URL: https://platform.claude.com/docs/en/build-with-claude/prompt-caching. Status: kept (c1).

5. [demonstrated, subq 4] The cache can be pre-warmed with a zero-output-token request (max_tokens: 0) that still incurs a cache-write charge if the prefix wasn't already cached, useful for priming a persona+lorebook prefix before the user speaks. Quote: "Returns empty content array, stop_reason: 'max_tokens', zero output tokens billed, but incurs a cache write charge if prefix isn't already cached." URL: https://platform.claude.com/docs/en/build-with-claude/prompt-caching. Status: kept.

6. [demonstrated, subq 4] Changing tool definitions invalidates the tools, system, and messages caches all at once, while toggling tool_choice only invalidates tools and system, not messages. Quote: "Tool definitions [change invalidates] Tools Cache, System Cache, Messages Cache [all]... tool_choice parameter [invalidates] Tools, System [but not Messages]" URL: https://platform.claude.com/docs/en/build-with-claude/prompt-caching. Status: kept (c3).

7. [community, subq 1] V2 cards wrap every field inside a nested 'data' object with a top-level spec marker specifically so V1-only editors cannot silently corrupt V2-only fields. Quote: "V2 wraps all fields (old and new) in a data object, with spec: \"chara_card_v2\" at the root level. This prevents V1-only editors from silently destroying V2-specific content." URL: https://github.com/malfoyslastname/character-card-spec-v2. Status: dropped: background file-format/interop detail, not a persona-content field decision relevant to our runtime design.

8. [community, subq 1/2] The system_prompt field is meant to fully replace the frontend/user's own system prompt (when non-empty), giving the character-card author control over top-level instruction framing. Quote: "system_prompt - \"Meant to completely replace the system prompt set by the user\" unless empty" URL: https://github.com/malfoyslastname/character-card-spec-v2. Status: merged-into #33 (spec_v2.md primary, same field, more authoritative MUST-level wording).

9. [community, subq 2] The spec adds post_history_instructions because instructions placed after the conversation history carry much stronger weight with current LLMs than the system prompt does, defaulting to overriding the user's own jailbreak settings. Quote: "post_history_instructions - Addresses the discovery that post-history instructions have \"much stronger weight\" than system prompts on current models" URL: https://github.com/malfoyslastname/character-card-spec-v2. Status: merged-into c6.

10. [community, subq 1/6] character_book is an embedded per-character lorebook that stacks additively with any separate world/lorebook rather than replacing it, and is meant to be prioritized over the general world book. Quote: "character_book - Embedded lorebook that \"stacks with world books, not replaces them\"" URL: https://github.com/malfoyslastname/character-card-spec-v2. Status: merged-into #36 (spec_v2.md primary, adds explicit precedence rule).

11. [community, subq 1] alternate_greetings stores an array of alternative opening messages so the UI can let the user swipe between different scenario starts. Quote: "alternate_greetings - Array allowing multiple opening scenarios with \"swiping\" UX similar to existing message swipe mechanisms" URL: https://github.com/malfoyslastname/character-card-spec-v2. Status: merged-into #35 (spec_v2.md primary, MUST-level requirement).

12. [community, subq 1] Two fields are explicitly excluded from ever being injected into the LLM prompt: creator_notes (author-facing usage guidance) and tags (categorization metadata) - both are for tooling/discovery only. Quote: "creator_notes - Information \"never included in prompts\"... tags - \"Should not appear in prompt\"" URL: https://github.com/malfoyslastname/character-card-spec-v2. Status: kept (primary; absorbs #32).

13. [demonstrated, subq 4] Prompt caching requires a minimum prefix length of 1,024 visible input tokens on GPT-5.6+ (hidden system content excluded); shorter prompts cannot cache. Quote: "Tokens in the OpenAI-provided hidden system content do not count toward this minimum." URL: https://developers.openai.com/api/docs/guides/prompt-caching. Status: kept.

14. [demonstrated, subq 4] Cached input tokens are billed at roughly a 90% discount versus uncached tokens on GPT-5.6+, while writing a cache costs 1.25x normal input rate; a write-then-full-reuse cycle costs 1.35x normal versus 2x uncached. Quote: "cache writes at 1.25x the standard, uncached input-token rate\" and reads at 0.1x that rate" URL: https://developers.openai.com/api/docs/guides/prompt-caching. Status: kept.

15. [demonstrated, subq 4] Cache TTL defaults to 30 minutes on GPT-5.6+ from the most recent write or reuse; on earlier models, in-memory caches persist 5-10 minutes idle (up to 1 hour) or up to 24 hours with the 24h option. Quote: "A cached prefix remains eligible for reuse for 30 minutes after its most recent write or reuse" URL: https://developers.openai.com/api/docs/guides/prompt-caching. Status: kept.

16. [demonstrated, subq 4] OpenAI explicitly recommends structuring prompts with stable developer instructions and shared reference material first, and dynamic user-specific content, timestamps, and current queries last. Quote: "Put stable developer instructions and shared reference material first... place those at the end rather than the beginning." URL: https://developers.openai.com/api/docs/guides/prompt-caching. Status: kept (c2).

17. [demonstrated, subq 4] Cache reuse breaks if the model, tools, parallel_tool_calls, output schemas, reasoning effort, verbosity, or context_management change, or if existing messages are edited in place rather than appended. Quote: "Changing model, tools, parallel_tool_calls, output schemas, reasoning.effort, text.verbosity, or context_management" URL: https://developers.openai.com/api/docs/guides/prompt-caching. Status: kept (c4).

18. [demonstrated, subq 4] Caches are machine-local, so OpenAI recommends a stable, deterministic prompt_cache_key per user/session and at least 15 requests per minute per key to keep routing consistent enough for cache hits. Quote: "Routing requests to the right machine is therefore important for cache reuse" URL: https://developers.openai.com/api/docs/guides/prompt-caching. Status: kept (c5).

19. [demonstrated, subq 6/2] SillyTavern's Summarize extension auto-generates a running summary of chat history on a configurable cadence (every N messages or every N words), storing it in chat metadata. Quote: "Update every X messages" URL: https://docs.sillytavern.app/extensions/summarize/. Status: kept.

20. [demonstrated, subq 6/2] The summary is injected via a {{summary}} macro at a configurable position, and can run in a mode that blocks chat generation or one that does not. Quote: "Injection location options include before/after main prompt or in-chat at specified depth, using the {{summary}} macro for placement." URL: https://docs.sillytavern.app/extensions/summarize/. Status: kept (primary; absorbs #27, #28).

21. [demonstrated, subq 6] When using the auxiliary Extras API (a BART model) instead of the main LLM backend for summarization, the summarizer's own context window is limited to about 1024 tokens. Quote: "very small context size (~1024 tokens), so its ability to handle large summaries is quite limited" URL: https://docs.sillytavern.app/extensions/summarize/. Status: kept.

22. [demonstrated, subq 6/2] SillyTavern's own docs warn that LLM-generated summaries may lose important details or hallucinate content, so manual review/editing is expected. Quote: "may lose some important details or contain hallucinations" URL: https://docs.sillytavern.app/extensions/summarize/. Status: kept.

23. [community, subq 1/6] World Info (lorebook) entries are injected only when trigger keywords appear in chat or character text. Quote: "keyword-activated lore injection. When specific keywords appear in the chat or character descriptions, corresponding entries are inserted" URL: https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems. Status: merged-into #38 (official docs primary, more precise).

24. [community, subq 1/6] World Info supports boolean-style multi-key trigger logic beyond simple keyword match. Quote: "AND_ANY\", \"NOT_ALL\", \"NOT_ANY\", and \"AND_ALL" URL: https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems. Status: kept.

25. [community, subq 1/6] Lorebook injection has an explicit token budget so lore entries cannot unboundedly consume the context window. Quote: "Constrained by `world_info_budget` and `world_info_budget_cap` parameters" URL: https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems. Status: merged-into #41 (official docs primary).

26. [community, subq 1/6] Where a lorebook entry is placed in the prompt is configurable via an insertion-strategy setting. Quote: "System uses `world_info_insertion_strategy` to determine placement" URL: https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems. Status: merged-into #42 (official docs primary, enumerates six positions).

27. [community, subq 6] Chat summarization runs as a dedicated extension that periodically compresses conversation history and injects it back via a generic prompt-extension slot. Quote: "periodically generates summaries of the conversation" URL: https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems. Status: merged-into #20.

28. [community, subq 6] Summarization can be produced by the same LLM driving the roleplay or offloaded to a separate inference backend, and supports blocking vs non-blocking generation. Quote: "use the main LLM, Extras, or WebLLM for summarization" URL: https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems. Status: merged-into #20.

29. [community, subq 6] Vector memory (RAG) retrieval is semantic, using the live chat context as the query against stored embeddings, and can index user-supplied documents in addition to chat history. Quote: "semantic queries using the current chat context to find relevant chunks of text" URL: https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems. Status: kept.

30. [community, subq 6] Vector embeddings can be produced by multiple interchangeable providers, including local (non-API) options. Quote: "Supports \"OpenAI, Ollama, Cohere, and local Transformers\"" URL: https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems. Status: kept.

31. [community, subq 1/2/6] All dynamic context sources (world info, author's note, summaries) share one injection abstraction that places content at configurable positions in the assembled prompt. Quote: "the extension prompt mechanism\" providing \"a unified interface for adding context at specific positions in the prompt" URL: https://deepwiki.com/SillyTavern/SillyTavern/6-context-and-memory-systems. Status: kept.

32. [demonstrated, subq 1] creator_notes must never be injected into the LLM prompt, only shown to users as UI metadata. Quote: "The value for this field MUST NOT be used inside prompts" URL: https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md. Status: merged-into #12.

33. [demonstrated, subq 1] system_prompt field overrides the frontend's default system prompt and supports a placeholder to splice in the frontend's own base prompt. Quote: "Replaces the frontend's default system prompt. Supports {{original}} placeholder to reference the user's base system prompt." URL: https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md. Status: kept (primary; absorbs #8).

34. [demonstrated, subq 1/2] post_history_instructions is the spec's formal name for what users call the jailbreak/UJB field, injected after chat history, and frontends are required to use it that way. Quote: "Frontends' default behavior MUST be to replace what users understand to be the 'ujb/jailbreak' setting with the value inside this field." URL: https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md. Status: kept (c6).

35. [demonstrated, subq 1/2] alternate_greetings is a required multi-swipe mechanism for the first message, giving multiple pre-authored openers rather than one fixed greeting. Quote: "Frontends MUST offer 'swipes' on character first messages, each string inside this array being an additional 'swipe'." URL: https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md. Status: kept (primary; absorbs #11).

36. [demonstrated, subq 1] character_book is a per-character lorebook that is meant to stack with a separate user/world lorebook but take precedence over it when they conflict. Quote: "Character lorebook SHOULD stack with user world book...Character book SHOULD take full precedence over world book." URL: https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md. Status: kept (primary; absorbs #10).

37. [demonstrated, subq 1] extensions is a namespaced arbitrary key-value bag explicitly designed so unknown vendor fields survive round-tripping between different frontends. Quote: "MUST NOT destroy unknown key-value pairs when importing and exporting character cards." URL: https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md. Status: dropped: background interop/tooling detail, not a persona-consistency or content-field decision.

38. [demonstrated, subq 1/2] World Info keyword scanning only injects an entry's text into the prompt when its trigger keyword actually appears in recent message text. Quote: "It functions like a dynamic dictionary that only inserts relevant information from World Info entries when keywords associated with the entries are present in the message text." URL: https://docs.sillytavern.app/usage/core-concepts/worldinfo/. Status: kept (primary; absorbs #23).

39. [demonstrated, subq 1/2] Entries can chain-trigger other entries by containing each other's keywords, creating recursive activation cappable by a max recursion depth setting. Quote: "Entries can activate other entries by mentioning their keywords in the content text." URL: https://docs.sillytavern.app/usage/core-concepts/worldinfo/. Status: kept.

40. [demonstrated, subq 1/2] Scan depth controls how many prior chat messages are searched for keywords, with 0 meaning only recursed entries and the Author's Note are scanned, and 1 meaning only the last message. Quote: "0: Only recursed entries and Author's Note; 1: Last message only" URL: https://docs.sillytavern.app/usage/core-concepts/worldinfo/. Status: kept.

41. [demonstrated, subq 4] A token budget caps total tokens spent on World Info entries per turn, with constant entries and higher-order entries loaded first until the budget is exhausted. Quote: "Defines how many tokens could be used by World Info entries at once." URL: https://docs.sillytavern.app/usage/core-concepts/worldinfo/. Status: kept (primary; absorbs #25).

42. [demonstrated, subq 1/2] World Info entries can be inserted at six distinct prompt positions, giving fine control over where lore text lands relative to the persona block. Quote: "Before/After Character Definitions, Before/After Example Messages, Top/Bottom of Author's Note, at specific chat Depth, or via custom Outlet macro placement." URL: https://docs.sillytavern.app/usage/core-concepts/worldinfo/. Status: kept (primary; absorbs #26).

43. [demonstrated, subq 1/2] When multiple entries in the same inclusion group would trigger, only one is chosen (by group weight or highest order), preventing redundant lore stacking. Quote: "Multiple triggered entries sharing a group label-only one activates, selected by Group Weight (default 100) or Prioritize Inclusion (highest Order wins)." URL: https://docs.sillytavern.app/usage/core-concepts/worldinfo/. Status: kept.

44. [marketing, subq 3] Audio tags are bracketed natural-language cues (e.g. [laughs], [gasps], [excited], [worried]) that the model interprets as performance direction rather than vocalizing literally. Quote: "Audio tags are bracketed, natural-language cues, such as [laughs], [gasps], [excited], and [worried]" URL: https://elevenlabs.io/blog/v3-audiotags. Status: kept.

45. [marketing, subq 3] Multiple audio tags can be stacked in a single sentence to layer delivery. Quote: "You can also use more than one tag in a single sentence and can combine tags for a more layered performance." URL: https://elevenlabs.io/blog/v3-audiotags. Status: kept.

46. [marketing, subq 3] Eleven v3's architecture reads context more deeply than earlier ElevenLabs models, presented as the mechanism enabling it to follow emotional cues from tags. Quote: "The architecture behind Eleven v3 allows the model to read context at a deeper level than earlier models, letting it to follow emotional cues." URL: https://elevenlabs.io/blog/v3-audiotags. Status: dropped: unfalsifiable marketing assertion with no mechanism or evidence given.

47. [marketing, subq 3] Named tag categories include emotions, delivery/pacing, human reactions, accents, and sound effects. Quote: "[sad], [angry], [happily], [sorrowful] ... [whispers], [shouts], [softly] ... [laughs], [clears throat], [sighs] ... [French accent], [British accent], [pirate voice] ... [gunshot], [explosion], [clapping]" URL: https://elevenlabs.io/blog/v3-audiotags. Status: kept.

48. [demonstrated, subq 3] Eleven v3 explicitly does not support SSML break tags or the rest of the SSML tag set. Quote: "Eleven v3 doesn't support SSML break tags or the rest of the SSML tag set." URL: https://elevenlabs.io/blog/v3-audiotags. Status: kept (c7).

49. [demonstrated, subq 3] Tag-driven delivery can fail when the chosen voice's natural character mismatches the requested performance. Quote: "This typically occurs when the selected voice doesn't match the requested delivery, such as a naturally soft-spoken voice being asked to perform several [shouts]." URL: https://elevenlabs.io/blog/v3-audiotags. Status: kept.

---

## Dropped total: 3
(#7 V2 data-object wrapper format detail; #37 extensions namespaced kv bag interop detail; #46 ElevenLabs "reads context more deeply" unfalsifiable marketing claim)

## Coverage gap
Sub-question 5 (small fast models for role-play - Claude Haiku class, GPT-4o-mini class, Gemini Flash, open RP fine-tunes: latency/quality evidence) has no usable claim in this batch of 49.

## Unreadable URLs (could not be fetched, excluded from claims)
- https://openai.com/index/api-prompt-caching/
- https://docs.inworld.ai/docs/tutorial-basics/core-description/
