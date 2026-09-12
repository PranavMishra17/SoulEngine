# Conditional Tool Visibility and Quest-State Gating — Claim Ledger

Angle: Conditional tool visibility and quest-state gating. 48 source claims processed: 8 kept as verification candidates (c1-c8), the rest merged into those 8 as corroboration or dropped. 21 dropped as duplicates/background/off-angle.

## Top 8 for adversarial verification

### c1 — Deferred/searchable tool loading (defer_loading) hides tools from context until search surfaces them
Importance: 5. This is the direct first-party mechanism for "don't show the model a tool it can't currently use" — the closest existing analog to gating an NPC's tool list by quest stage.
Quote: "aren't loaded initially. Claude searches for relevant tools on-demand, and matching tools get \"expanded into full definitions in Claude's context.\""
URL: https://anthropic.com/engineering/advanced-tool-use
Corroborating: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use ("Tools with defer_loading: true are stripped from the rendered tools section before the cache key is computed...This means defer_loading: true preserves your prompt cache."), https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference ("Exclude the tool from the initial system prompt; load it on demand when tool search returns a tool_reference for it"; also two named search algorithm variants, tool_search_tool_regex_20251119 and tool_search_tool_bm25_20251119, "Neither supersedes the other").
Label: demonstrated. Numbers: 85% token reduction, ~77K vs ~8.7K tokens, 95% context preserved (same source).

### c2 — Exposing all tools up front measurably degrades tool-selection accuracy; deferred/searchable loading recovers most of the loss
Importance: 5. Directly answers "how many tools before accuracy suffers" for sub-question 2 and justifies building a gating layer rather than dumping the full quest/tool catalog into every turn.
Quote: "Opus 4 improved from 49% to 74%, and Opus 4.5 improved from 79.5% to 88.1%"
URL: https://anthropic.com/engineering/advanced-tool-use
Corroborating: RAG-MCP paper (https://arxiv.org/abs/2505.03275), research-only, independent confirmation of the same failure mode with a different mechanism ("more than triples tool selection accuracy (43.13% vs 13.62% baseline)"; "cuts prompt tokens (e.g., by over 50%)").
Label: demonstrated (vendor's own benchmark; independently a research-only paper shows the same qualitative effect with different numbers).

### c3 — tool_choice has four modes (auto/any/tool/none) that can force, constrain, or forbid tool use per turn, with real limitations
Importance: 5. This is the mechanism a quest-state gate would actually call each turn (e.g. force a completion tool only when preconditions are met, force none when no action is legal).
Quote: "auto allows Claude to decide whether to call any provided tools or not... any tells Claude that it must use one of the provided tools... tool forces Claude to always use a particular tool... none prevents Claude from using any tools"
URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
Corroborating: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use (same four modes; also notes forced tool use is unsupported on some models/settings, naming "Claude Fable 5.1 and Claude Mythos 5.1", and that changing tool_choice between turns invalidates cached message content though tool defs/system prompt stay cached), https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/tool_choice.ipynb (walks all three explicit modes with worked examples), https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference (a tool_choice of type "tool" cannot target a client toolset like computer/browser use or its members — only auto/any/none work there). Also: forcing a tool call suppresses the model's natural-language preamble entirely ("the models will not emit a natural language response or explanation before tool_use content blocks") — relevant to voice UX expectations.
Label: demonstrated.

### c4 — Quest-stage "done" state is per-stage, non-monotonic, and can be set before the stage's own effects finish — the flag is not a reliable proxy for game state
Importance: 5. Concrete, load-bearing evidence for "never trust the model (or even the engine's own completion flag) about completion; the actual game state is the single source of truth" (sub-question 3), sourced from a shipped, heavily-used quest engine (Skyrim Creation Kit / Papyrus).
Quote: "if stages 0, 40, 20, and 60 are visited in sequence, only those four stages return true" and "returns true for the current quest stage, even while the quest fragment scripts for the current stage have not yet completed"
URL: https://papyrus.bellcube.dev/skyrimse/script/quest/function/getstagedone/
Corroborating: same page — GetStageDone/IsStageDone takes a stage number and returns whether that specific stage was visited, not whether the quest is complete ("obtains whether the specified quest stage is done or not"); GetStageDone is an alias for IsStageDone (trivial, not separately counted).
Label: demonstrated (documented, community-verified engine behavior; label is community/demonstrated — a wiki-style function reference for a shipped game engine, not a vendor claim).

### c5 — Anthropic's own guidance says auto-mode tool calling tends to be over-eager, and forcing a tool doesn't remove the need for prompt engineering
Importance: 4. Directly on-angle for sub-question 6 (over-triggering, e.g. an exit-like tool firing too often) — this is the vendor's own warning, not our inference.
Quote: "Often, Claude can be over-eager to call tools" and "we should still employ some basic prompt engineering"
URL: https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/tool_choice.ipynb
Corroborating: same notebook — forcing a specific tool overrides the model's own relevance judgment, e.g. it calls a forced sentiment tool even on a math-focused prompt ("Claude wants to call the `print_sentiment_scores` tool").
Label: demonstrated.

### c6 — strict:true guarantees schema-validated tool names and inputs, a direct mechanism against tool-call hallucination
Importance: 4. Relevant to sub-question 6 (tool-call hallucination) and to authoring gates (sub-question 4): a schema-enforced quest-action tool cannot be called with a malformed or invented payload.
Quote: "strict | Guarantee schema validation on tool names and inputs | All tools except mcp_toolset, computer_toolset_20260801, and browser_toolset_20260801"
URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference
Corroborating: same source — combining tool_choice:any with strict tool use guarantees both that some tool is called and that its input is schema-valid (from https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use: "combine tool_choice: {\"type\": \"any\"} with strict tool use to guarantee both that one of your tools is called and that the tool inputs strictly follow your schema"); allowed_callers can restrict a tool to only be invocable from within code execution, excluding direct model calls.
Label: demonstrated.

### c7 — Consolidate related actions into one tool with an action/discriminator parameter, rather than many single-purpose tools
Importance: 3. Directly informs how to shape a gated quest-tool surface (e.g. one quest_action tool with an action enum, rather than one tool per quest per verb) — fewer tools to gate, less selection ambiguity.
Quote: "Consolidate related operations into fewer tools. Rather than creating a separate tool for every action (create_pr, review_pr, merge_pr), group them into a single tool with an action parameter."
URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
Corroborating: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use (identical guidance, duplicate copy). Related, same cluster: namespacing tool names by service is called "especially important when using tool search" (both platform.claude.com and docs.anthropic.com copies); tool responses should return only stable identifiers and fields the model needs, not bloated payloads.
Label: marketing (vendor best-practice guidance, not a measured result).

### c8 — Worked input examples in a tool definition substantially raise correct-parameter accuracy, at a bounded token cost
Importance: 3. Evidence that authoring gates/predicate schemas benefit from worked examples too (sub-question 4), and a concrete cost/benefit trade a 1-2s voice budget must weigh.
Quote: "Tool use examples improved accuracy from 72% to 90% on complex parameter handling"
URL: https://anthropic.com/engineering/advanced-tool-use
Corroborating: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference (concrete token cost: "~20-50 tokens for simple examples, ~100-200 tokens for complex nested objects"); https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools and https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use (both: "Keep it concise: 1-5 examples per tool").
Label: demonstrated (the 72%->90% figure); the "1-5 examples" and token-cost figures are marketing/demonstrated respectively as noted.

Dropped: 21. Coverage gaps: sub-question 1 (only Skyrim Creation Kit/Papyrus is actually covered by a source claim; no claims retrieved for Witcher 3 quest graphs, Yarn Spinner, ink, Unity Dialogue System, The Sims Check Tree, or Valve response-rules criteria), sub-question 3 (no claims specific to Inworld goals/triggers, Convai narrative design, or Charisma conditions — only general LLM API mechanisms that are analogous, not vendor-specific evidence), sub-question 4 (no claims comparing DSL vs JSON predicates or covering ink/Yarn/articy/Twine authoring workflows — only Claude tool-definition authoring guidance, which is adjacent but not about narrative-design tooling), sub-question 5 (no claims on quest-giver dialogue patterns, hint ladders, objective reveal, or preventing invented quests/rewards).

## Full ledger

1. Claim: Tools can be marked defer_loading:true so they are not loaded into context initially; Claude searches for relevant tools on demand and matching tools are expanded into full definitions.
   Quote: "aren't loaded initially. Claude searches for relevant tools on-demand, and matching tools get \"expanded into full definitions in Claude's context.\""
   URL: https://anthropic.com/engineering/advanced-tool-use | Label: demonstrated | Subq: [2]
   Status: kept (c1)

2. Claim: Tool Search Tool cuts token usage by 85% while preserving access to the full tool library.
   Quote: "85% reduction in token usage while maintaining access to your full tool library"
   URL: https://anthropic.com/engineering/advanced-tool-use | Label: demonstrated | Subq: [2]
   Status: merged-into c1

3. Claim: Exposing all tool definitions up front measurably degrades tool-selection accuracy at scale; Tool Search Tool recovers much of that loss.
   Quote: "Opus 4 improved from 49% to 74%, and Opus 4.5 improved from 79.5% to 88.1%"
   URL: https://anthropic.com/engineering/advanced-tool-use | Label: demonstrated | Subq: [2]
   Status: kept (c2)

4. Claim: A large tool library costs a large fixed context tax; deferred loading collapses that to a small fraction.
   Quote: "Traditional approach uses ~77K tokens; Tool Search Tool uses ~8.7K tokens, \"preserving 95% of context window\""
   URL: https://anthropic.com/engineering/advanced-tool-use | Label: demonstrated | Subq: [2]
   Status: merged-into c1

5. Claim: Anthropic's own guidance for when to bother with deferred/searchable tool lists is a concrete size threshold.
   Quote: "Use it when: Tool definitions consuming >10K tokens\" or \"10+ tools available"
   URL: https://anthropic.com/engineering/advanced-tool-use | Label: marketing | Subq: [2]
   Status: dropped: minor vendor rule-of-thumb, low decision impact beyond c1/c2

6. Claim: Deferred tool search is not free: it adds a round-trip before the real tool call fires.
   Quote: "Adds \"a search step before tool invocation\""
   URL: https://anthropic.com/engineering/advanced-tool-use | Label: demonstrated | Subq: [2,6]
   Status: merged-into c1 (latency caveat noted there)

7. Claim: Programmatic Tool Calling lets the model write orchestration code so intermediate tool results never re-enter context, only final aggregates do.
   Quote: "Claude writes Python code that orchestrates tools in a sandboxed Code Execution environment. Tool results are processed by the script, not returned to Claude's context."
   URL: https://anthropic.com/engineering/advanced-tool-use | Label: demonstrated | Subq: [2,3]
   Status: dropped: not applicable to a real-time voice NPC turn loop (batch/code-exec pattern, off our latency profile)

8. Claim: Programmatic Tool Calling reduced token usage by 37% on complex multi-tool research tasks.
   URL: https://anthropic.com/engineering/advanced-tool-use | Label: demonstrated | Subq: [2]
   Status: dropped: same reason as #7

9. Claim: Programmatic Tool Calling also improved task accuracy on benchmarks.
   URL: https://anthropic.com/engineering/advanced-tool-use | Label: demonstrated | Subq: [2]
   Status: dropped: same reason as #7

10. Claim: Programmatic calling requires opting a tool in explicitly per-tool via an allowlist field.
    Quote: "Tools must have allowed_callers: [\"code_execution_20250825\"] to enable programmatic calling"
    URL: https://anthropic.com/engineering/advanced-tool-use | Label: demonstrated | Subq: [2,3]
    Status: dropped: mechanism only relevant to code-exec pattern we are not adopting; the general allowed_callers gating idea is separately covered (#33, merged into c6)

11. Claim: Anthropic's heuristic for when programmatic calling pays off is workflow shape (3+ dependent calls or bulk data).
    URL: https://anthropic.com/engineering/advanced-tool-use | Label: marketing | Subq: [2,3]
    Status: dropped: off-angle (programmatic calling not applicable, see #7)

12. Claim: Adding worked input examples to a tool definition substantially raises correct-parameter accuracy.
    Quote: "Tool use examples improved accuracy from 72% to 90% on complex parameter handling"
    URL: https://anthropic.com/engineering/advanced-tool-use | Label: demonstrated | Subq: [2,4]
    Status: kept (c8)

13. Claim: Anthropic recommends a small, bounded number of examples per tool.
    Quote: "Keep it concise: 1-5 examples per tool"
    URL: https://anthropic.com/engineering/advanced-tool-use | Label: marketing | Subq: [2,4]
    Status: merged-into c8

14. Claim: tool_choice has four modes (auto/any/tool/none).
    Quote: "auto allows Claude to decide whether to call any provided tools or not... any tells Claude that it must use one of the provided tools... tool forces Claude to always use a particular tool... none prevents Claude from using any tools"
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools | Label: demonstrated | Subq: [2,3]
    Status: kept (c3)

15. Claim: Forced tool use (any/tool) is unsupported on some models/settings and errors out.
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools | Label: demonstrated | Subq: [2]
    Status: merged-into c3

16. Claim: Forcing a tool call suppresses the model's natural-language preamble entirely.
    Quote: "the models will not emit a natural language response or explanation before tool_use content blocks"
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools | Label: demonstrated | Subq: [2,5]
    Status: merged-into c3

17. Claim: Anthropic's top tool-design recommendation is consolidating related operations into one tool with an action parameter.
    Quote: "Consolidate related operations into fewer tools. Rather than creating a separate tool for every action (create_pr, review_pr, merge_pr), group them into a single tool with an action parameter."
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools | Label: marketing | Subq: [2,4]
    Status: kept (c7)

18. Claim: Tool responses should return only stable, high-signal identifiers, not bloated data.
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools | Label: marketing | Subq: [3,4]
    Status: merged-into c7

19. Claim: Namespacing tool names by service/resource is important, especially with tool search.
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools | Label: marketing | Subq: [2,4]
    Status: merged-into c7

20. Claim: Tool descriptions are the single biggest lever on tool-use performance, with a minimum-length recommendation.
    Quote: "Provide extremely detailed descriptions. This is by far the most important factor in tool performance... Aim for at least 3-4 sentences for each tool description"
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools | Label: marketing | Subq: [2,4]
    Status: dropped: generic prompt-engineering advice, not specific to gating/quest-state design beyond what c7/c8 already cover

21. Claim: Consolidate multiple related actions into one tool with an action/discriminator parameter (duplicate copy).
    URL: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use | Label: demonstrated | Subq: [2,4]
    Status: merged-into c7

22. Claim: Namespace tool names by service/domain; especially important with tool search (duplicate copy).
    URL: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use | Label: demonstrated | Subq: [2,4]
    Status: merged-into c7

23. Claim: Tool description quality is the single biggest lever on tool-use performance (duplicate copy).
    URL: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use | Label: demonstrated | Subq: [2,4]
    Status: dropped: duplicate of #20, already dropped

24. Claim: defer_loading:true excludes a tool from the model's visible list until tool search surfaces it (duplicate/expanded copy, includes cache-preservation detail).
    Quote: "Tools with defer_loading: true are stripped from the rendered tools section before the cache key is computed...This means defer_loading: true preserves your prompt cache."
    URL: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use | Label: demonstrated | Subq: [2,3]
    Status: merged-into c1

25. Claim: tool_choice has four modes, forcing a tool suppresses preceding natural-language explanation (duplicate copy).
    URL: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use | Label: demonstrated | Subq: [2,6]
    Status: merged-into c3

26. Claim: Forcing tool use (any/tool) is unsupported on some models/settings, naming Claude Fable 5.1 and Claude Mythos 5.1 as examples where only auto/none work.
    Quote: "Not every model and setting supports forced tool use. Where it isn't supported, tool_choice: {\"type\": \"any\"} and tool_choice: {\"type\": \"tool\", \"name\": \"...\"} fail, while tool_choice: {\"type\": \"auto\"}...and tool_choice: {\"type\": \"none\"} still work"
    URL: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use | Label: demonstrated | Subq: [2,6]
    Status: merged-into c3

27. Claim: Changing tool_choice between turns invalidates cached message content, though tool definitions/system prompt stay cached.
    URL: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use | Label: demonstrated | Subq: [2,3]
    Status: merged-into c3

28. Claim: Combining tool_choice:any with strict tool use guarantees a tool is called and its input is schema-valid.
    Quote: "combine tool_choice: {\"type\": \"any\"} with strict tool use to guarantee both that one of your tools is called and that the tool inputs strictly follow your schema."
    URL: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use | Label: demonstrated | Subq: [2,6]
    Status: merged-into c6

29. Claim: A dedicated deferred-tool-loading system (defer_loading plus tool-search returning tool_reference) lets a large tool library stay hidden until surfaced.
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference | Label: demonstrated | Subq: [2,4]
    Status: merged-into c1

30. Claim: Two distinct tool-search algorithm variants exist (regex-based and BM25-based) as co-equal server tools.
    Quote: "tool_search_tool_regex_20251119 and tool_search_tool_bm25_20251119 are two search algorithms released together. Neither supersedes the other."
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference | Label: demonstrated | Subq: [2,4]
    Status: merged-into c1

31. Claim: A tool_choice of type "tool" cannot target a client toolset (e.g. computer/browser use) or its members — only auto/any/none allowed.
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference | Label: demonstrated | Subq: [2,6]
    Status: merged-into c3

32. Claim: strict:true guarantees schema validation on tool names and inputs for almost all tool types.
    Quote: "strict | Guarantee schema validation on tool names and inputs | All tools except mcp_toolset, computer_toolset_20260801, and browser_toolset_20260801"
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference | Label: demonstrated | Subq: [2,6]
    Status: kept (c6)

33. Claim: allowed_callers can restrict a tool to only be invocable from code execution, excluding direct model calls.
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference | Label: demonstrated | Subq: [2,3]
    Status: merged-into c6 (as a related caller-restriction mechanism)

34. Claim: input_examples add measurable token overhead.
    Quote: "Token cost - Examples add to prompt tokens: ~20-50 tokens for simple examples, ~100-200 tokens for complex nested objects"
    URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference | Label: demonstrated | Subq: [2,4]
    Status: merged-into c8

35. Claim: RAG-MCP uses semantic retrieval over an external index to select the most relevant tool(s) before invoking the LLM.
    URL: https://arxiv.org/abs/2505.03275 | Label: research-only | Subq: [2]
    Status: merged-into c2 (independent corroboration of the same failure mode)

36. Claim: Retrieval-based tool selection more than triples tool-selection accuracy versus exposing all tools directly.
    Quote: "more than triples tool selection accuracy (43.13% vs 13.62% baseline)"
    URL: https://arxiv.org/abs/2505.03275 | Label: research-only | Subq: [2]
    Status: merged-into c2

37. Claim: Filtering the tool list before prompting the LLM cuts prompt token count substantially (>50%).
    URL: https://arxiv.org/abs/2505.03275 | Label: research-only | Subq: [2]
    Status: merged-into c1/c2 (token-reduction corroboration)

38. Claim: The RAG-MCP paper frames the failure mode as prompt bloat and tool-selection complexity as more tools are exposed.
    Quote: "Mitigating Prompt Bloat in LLM Tool Selection via Retrieval-Augmented Generation"
    URL: https://arxiv.org/abs/2505.03275 | Label: research-only | Subq: [2]
    Status: dropped: paper title/framing, not a falsifiable data point beyond #35/#36

39. Claim: Claude's tool_choice supports 'auto' mode, the default, where the model decides whether to call any tool.
    URL: https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/tool_choice.ipynb | Label: demonstrated | Subq: [2]
    Status: merged-into c3

40. Claim: An 'any' mode forces Claude to invoke some tool without pinning which one.
    URL: https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/tool_choice.ipynb | Label: demonstrated | Subq: [2]
    Status: merged-into c3

41. Claim: A 'tool' mode pins Claude to a single named tool via an explicit type/name object.
    URL: https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/tool_choice.ipynb | Label: demonstrated | Subq: [2]
    Status: merged-into c3

42. Claim: Forcing a specific tool overrides Claude's own judgment about relevance (calls a sentiment tool even on a math prompt).
    Quote: "Claude wants to call the print_sentiment_scores tool"
    URL: https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/tool_choice.ipynb | Label: demonstrated | Subq: [2,6]
    Status: merged-into c5

43. Claim: Anthropic's own guidance warns that in auto mode Claude tends to over-trigger tool calls unless the prompt is carefully engineered.
    Quote: "Often, Claude can be over-eager to call tools"
    URL: https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/tool_choice.ipynb | Label: demonstrated | Subq: [2,6]
    Status: kept (c5)

44. Claim: Even with tool_choice forcing a tool, Anthropic recommends still applying prompt engineering rather than relying on the constraint alone.
    Quote: "we should still employ some basic prompt engineering"
    URL: https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/tool_choice.ipynb | Label: demonstrated | Subq: [2,6]
    Status: merged-into c5

45. Claim: GetStageDone/IsStageDone takes an integer stage number and returns whether that quest stage has been visited, not whether the quest as a whole is complete.
    Quote: "obtains whether the specified quest stage is done or not"
    URL: https://papyrus.bellcube.dev/skyrimse/script/quest/function/getstagedone/ | Label: demonstrated | Subq: [1,3]
    Status: merged-into c4

46. Claim: Quest stage completion is per-stage and non-monotonic: a stage is only 'done' if explicitly set, so jumping past a stage number does not retroactively mark skipped stages done.
    Quote: "if stages 0, 40, 20, and 60 are visited in sequence, only those four stages return true"
    URL: https://papyrus.bellcube.dev/skyrimse/script/quest/function/getstagedone/ | Label: demonstrated | Subq: [1,4]
    Status: kept (c4)

47. Claim: The done-flag can be set before the stage's own scripted side effects have actually finished running.
    Quote: "returns true for the current quest stage, even while the quest fragment scripts for the current stage have not yet completed"
    URL: https://papyrus.bellcube.dev/skyrimse/script/quest/function/getstagedone/ | Label: demonstrated | Subq: [1,3]
    Status: merged-into c4

48. Claim: GetStageDone and IsStageDone are the same function under two names.
    Quote: "GetStageDone is an alias for IsStageDone"
    URL: https://papyrus.bellcube.dev/skyrimse/script/quest/function/getstagedone/ | Label: demonstrated | Subq: [1]
    Status: dropped: trivial naming fact, no design impact

## Unreadable URLs (could not be fetched/retrieved for this angle)

- https://ck.uesp.net/wiki/Condition_Functions
- https://ck.uesp.net/wiki/Quest_Data_Tab
- https://skyrimck.uesp.net/w/index.php?title=Quest_Stages_Tab
