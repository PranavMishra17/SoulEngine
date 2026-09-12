# Raw claim ledger: knowledge tiers, world-event propagation, social web, immediate needs

Angle: How NPCs know things: knowledge tiers, world-event propagation, the social web, and immediate needs.

32 claims extracted from fetched sources were triaged: semantic duplicates merged (best-quoted instance kept, other URLs listed as corroborating), background/unfalsifiable/off-angle claims dropped, remainder ranked by decision impact for our own runtime design. 8 claims were kept for adversarial verification (c1-c8). 18 were dropped outright, 6 were merged into one of the 8 kept claims. Total accounted for: 8 kept + 6 merged + 18 dropped = 32.

Coverage check against the six sub-questions: all six have at least one usable claim among c1-c8 (1: c1, c6, c7, c8; 2: c2, c4, c6, c8; 3: c2, c3, c4; 4: c3, c7; 5: c5; 6: c1, c2, c3, c4, c5, c7). No coverage gaps.

## Kept claims (top 8, ranked)

### c1 (importance 5, demonstrated, subq 1,6)
Valve's Left 4 Dead 2 response-rules system scopes and reveals NPC knowledge with a flat associative "query" of key:value facts matched against "rules" -- tuples of ANDed criteria that must all be true, rejecting outright if a criterion references a fact absent from the query. When multiple rules match, the shipped scoring function simply counts matched criteria (illustrated by a worked example scoring 2,0,0,3,3,3,4 across seven candidate rules), so the most specific matching rule wins with no per-criterion weighting.

Quote: "A rule is a a tuple of criteria that all have to be true. If one is false, or one mentions a fact not in the query, then the rule is considered to reject."
URL: https://cdn.akamai.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
Merged in: claim 2 ("scoring function ... simplest one imaginable -- the number of criteria in a rule"), claim 3 (worked example with scores 2,0,0,3,3,3,4).

### c2 (importance 5, demonstrated, subq 2,3,6)
Conversation and interruption in Valve's system has no dedicated "conversation" or "cutscene" object gluing two speakers together. A line's response can dispatch a "then character concept" followup to one character, or "then any concept" broadcast to everyone in earshot (resolved by the same highest-score rule); the followup's criteria are re-evaluated fresh at the moment the reply is due, so a conversation self-terminates the instant the world state (e.g. a zombie attack mid-conversation) makes a participant's criteria false, with no explicit interrupt logic required.

Quote: "Because Coach sends a message to Ellis at the end of Coach's line, Ellis does a lookup for a reply based on the context at exactly the moment he begins speaking... the conversation self-terminates because the criteria for its existence are no longer true. You don't need any kind of explicit interruption mechanism."
URL: https://cdn.akamai.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf

### c3 (importance 5, demonstrated, subq 1,3,4,6)
Generative Agents (Stanford/Google, "Generative Agents: Interactive Simulacra of Human Behavior") retrieve memories each turn using a weighted-sum score of three normalized components -- recency, importance, relevance -- all weighted equally (alpha=1 for each). Recency is an exponential decay (factor 0.99) over sandbox game-hours since a memory was last retrieved/accessed; relevance is the cosine similarity between an LLM-generated embedding of the memory's text and an embedding of the current query/situation; importance is a 1-10 poignancy score the LLM itself assigns at memory-creation time (1 for brushing teeth, 10 for a breakup). Only the top-scoring memories that fit the LLM's context window are injected into the prompt -- this is the concrete per-turn retrieval-and-cost mechanism.

Quote: "The retrieval function scores all memories as a weighted combination of the three elements: score = a_recency . recency + a_importance . importance + a_relevance . relevance. In our implementation, all a's are set to 1."
URL: https://arxiv.org/pdf/2304.03442v1
Merged in: claim 8 (recency decay factor 0.99), claim 9 (importance as LLM-assigned 1-10 poignancy score), claim 10 (relevance as cosine similarity of embeddings).

### c4 (importance 5, demonstrated, subq 2,3,6)
World-event propagation between Generative Agents happens purely through simulated proximity-triggered natural-language conversation, with no broadcast channel: agents perceive others nearby, converse, and information spreads agent-to-agent. Measured concretely, knowledge of a mayoral candidacy spread from 1 agent (4%) to 8 agents (32%), and knowledge of a Valentine's Day party spread from 1 agent (4%) to 12 of 25 agents (48%), over two simulated days, entirely without user intervention.

Quote: "the agents who knew about Sam's mayoral candidacy increased from one (4%) to eight (32%), and the agents who knew about Isabella's party increased from one (4%) to twelve (48%), completely without user intervention."
URL: https://arxiv.org/pdf/2304.03442v1

### c5 (importance 5, demonstrated, subq 5,6)
PIANO's architecture uses a single "Cognitive Controller" module as a serialized bottleneck that reconciles all concurrent module outputs (perception, memory, social, action) into one coherent decision, then broadcasts that decision back out to the other modules. This is a concrete concurrency pattern for keeping one NPC's speech and actions consistent despite parallel subsystems running independently.

Quote: "The Cognitive Controller synthesizes information across the Agent State through a bottleneck"
URL: https://arxiv.org/pdf/2411.00114

### c6 (importance 5, demonstrated, subq 1,2)
In Dwarf Fortress, rumor knowledge reaches a location only through specific carrier NPCs -- an outpost liaison arriving annually with the caravan, diplomats, or tavern visitors served by an assigned tavern keeper (three named acquisition vectors) -- rather than through ambient world-wide simulation reaching the player automatically. New NPCs otherwise start as a blank slate until they encounter such a vector or the event itself.

Quote: "the outpost liaison, who will arrive with the caravan once each year, by diplomats, or by visitors in the tavern when served a drink by an assigned tavern keeper."
URL: https://dwarffortresswiki.org/index.php/Rumor
Corroborating URL: https://dwarffortresswiki.org/index.php/Civilization_and_World_Info
Merged in: claim 29 ("3 named acquisition vectors (liaison, visitor, tavern)").

### c7 (importance 4, demonstrated, subq 1,4,6)
Valve's rule engine can write facts back into a persistent per-character or per-world memory table ("remember"/ApplyFacts), including facts with an automatic expiration time. This is how the shipped system implements running-gag memory and prevents two lines of the same gag from playing too close together, without any bespoke state machine -- a direct precedent for injecting decaying "recently learned" facts into a dialogue-selection query.

Quote: "The latter is an example to show that you can have automatic expiration times on a particular fact, if you want to prevent two successive bits of a running gag from being played too close together."
URL: https://cdn.akamai.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf

### c8 (importance 4, demonstrated, subq 1,2)
Dwarf Fortress models knowledge decay on two independent tiers: detailed rumor knowledge fades over weeks-to-years timescales, while a longer-lasting reputation effect persists independently of whether the specific rumor is still known. This separates "what an NPC can currently recall in detail" from "how an NPC feels about you," which is a useful precedent for a two-layer (ephemeral fact vs. persistent disposition) knowledge model.

Quote: "The knowledge fades over the course of weeks and years, while maintaining longer-term reputation effects."
URL: https://dwarffortresswiki.org/index.php/Rumor

## Full ledger (all 32 claims)

| # | Claim (short) | Label | Subq | URL | Status |
|---|---|---|---|---|---|
| 1 | Valve: query/criteria/rule data model | demonstrated | 1,6 | GDC2012_Ruskin_Elan_DynamicDialog.pdf | kept (c1) |
| 2 | Valve: scoring = count of matched criteria | demonstrated | 1,6 | GDC2012_Ruskin_Elan_DynamicDialog.pdf | merged-into c1 |
| 3 | Valve: worked scoring example (scores 2,0,0,3,3,3,4) | demonstrated | 1,6 | GDC2012_Ruskin_Elan_DynamicDialog.pdf | merged-into c1 |
| 4 | Valve: remember/ApplyFacts with expiration for running gags | demonstrated | 1,4,6 | GDC2012_Ruskin_Elan_DynamicDialog.pdf | kept (c7) |
| 5 | Valve: conversation self-terminates via re-evaluated criteria, no interrupt mechanism | demonstrated | 2,3,6 | GDC2012_Ruskin_Elan_DynamicDialog.pdf | kept (c2) |
| 6 | L4D2 shipped ~10,000 dialog lines via this one rule system | demonstrated | 6 | GDC2012_Ruskin_Elan_DynamicDialog.pdf | dropped: production-scale color, not an architectural mechanism in itself |
| 7 | Generative Agents: retrieval = weighted sum of recency+importance+relevance (alpha=1) | demonstrated | 3,4,6 | arxiv.org/pdf/2304.03442v1 | kept (c3) |
| 8 | Generative Agents: recency = exponential decay, factor 0.99/game-hour | demonstrated | 6 | arxiv.org/pdf/2304.03442v1 | merged-into c3 |
| 9 | Generative Agents: importance = LLM-assigned 1-10 poignancy score | demonstrated | 1,6 | arxiv.org/pdf/2304.03442v1 | merged-into c3 |
| 10 | Generative Agents: relevance = cosine similarity of embeddings | demonstrated | 1,6 | arxiv.org/pdf/2304.03442v1 | merged-into c3 |
| 11 | Generative Agents: reflections triggered by importance-sum threshold, ~2-3x/day, over last 100 records | demonstrated | 4,6 | arxiv.org/pdf/2304.03442v1 | dropped: below cutoff; sub-q4/6 already covered by kept claims |
| 12 | Generative Agents: mayoral-candidacy/party knowledge spread numbers via proximity conversation | demonstrated | 2,3,6 | arxiv.org/pdf/2304.03442v1 | kept (c4) |
| 13 | Generative Agents: social network density rose 0.167 -> 0.74 over 2 days | demonstrated | 3 | arxiv.org/pdf/2304.03442v1 | dropped: same underlying phenomenon as c4, adds a metric but no new mechanism |
| 14 | Generative Agents: recursive day -> hour -> 5-15min plan decomposition feeds the memory stream | demonstrated | 4 | arxiv.org/pdf/2304.03442v1 | dropped: below cutoff, importance 3, not decision-critical vs. kept claims |
| 15 | Generative Agents: full-architecture ablation study, d=8.16 vs. no-memory/reflection/plan baseline | demonstrated | 4,6 | arxiv.org/pdf/2304.03442v1 | dropped: strong evidence but redundant with c3/c4's demonstrated mechanism; cut for space at the 8-claim cap |
| 16 | Generative Agents: 1.3% (6/453) hallucinated awareness-of-other-agents responses | demonstrated | 6 | arxiv.org/pdf/2304.03442v1 | dropped: useful caveat but not an architecture-changing number |
| 17 | Dwarf Fortress: new NPCs are a blank slate until they encounter world events | demonstrated | 1,2 | dwarffortresswiki.org/index.php/Rumor | dropped: background/expected default, subsumed by c6 |
| 18 | Dwarf Fortress: rumor spreads proximity/social-hop outward from village to village | demonstrated | 1,2 | dwarffortresswiki.org/index.php/Rumor | dropped: overlaps with c6's more specific/actionable carrier-NPC mechanism |
| 19 | Dwarf Fortress: rumors carried by outpost liaison, diplomats, tavern visitors | demonstrated | 1,2 | dwarffortresswiki.org/index.php/Rumor | kept (c6) |
| 20 | Dwarf Fortress: two-tier decay (rumor detail fades weeks/years; reputation persists longer) | demonstrated | 1,2 | dwarffortresswiki.org/index.php/Rumor | kept (c8) |
| 21 | Dwarf Fortress: propagation latency is stochastic, ~a day to a week | community | 1,2 | dwarffortresswiki.org/index.php/Rumor | dropped: community-sourced, vague ("can vary quite a bit"), unfalsifiable |
| 22 | PIANO: simulations scaled to 1000+ concurrent LLM agents | demonstrated | 2,5,6 | arxiv.org/pdf/2411.00114 | dropped: sizing/scale stat, not directly about knowledge-scoping mechanism; below cutoff |
| 23 | PIANO: infrastructure bottlenecked at largest scale, agents intermittently unresponsive | demonstrated | 2,6 | arxiv.org/pdf/2411.00114 | dropped: pairs with claim 22, same reasoning |
| 24 | PIANO: knowledge/reputation spreads via agent-to-agent conversation, agents infer likeability | demonstrated | 2,3,6 | arxiv.org/pdf/2411.00114 | dropped: same pattern as c4 (Generative Agents) with no comparable numbers |
| 25 | PIANO: explicit working/short-term/long-term memory tiers, no token-cost figures given | demonstrated | 5,6 | arxiv.org/pdf/2411.00114 | dropped: vague by the claim's own admission (no cost numbers) |
| 26 | PIANO: social/conversational goals regenerated every 5-10 seconds | demonstrated | 4,6 | arxiv.org/pdf/2411.00114 | dropped: below cutoff; sub-q4 already covered by c3/c7 |
| 27 | PIANO: single Cognitive Controller bottleneck reconciles and broadcasts module outputs | demonstrated | 5,6 | arxiv.org/pdf/2411.00114 | kept (c5) |
| 28 | PIANO: agents lack innate drives (survival, curiosity, community) and spatial/visual grounding | research-only | 4,6 | arxiv.org/pdf/2411.00114 | dropped: stated limitation/caveat, not a positive design pattern |
| 29 | Dwarf Fortress: 3 named rumor-acquisition vectors (liaison, visitor, tavern) | demonstrated | 1,2 | dwarffortresswiki.org/index.php/Civilization_and_World_Info | merged-into c6 |
| 30 | Dwarf Fortress: per-site colored-letter rumor markers on the world map | demonstrated | 1,2 | dwarffortresswiki.org/index.php/Civilization_and_World_Info | dropped: UI/presentation detail, not a scoping/propagation mechanism |
| 31 | Dwarf Fortress: fixed taxonomy of rumor categories with letter codes | demonstrated | 1,5 | dwarffortresswiki.org/index.php/Civilization_and_World_Info | dropped: below cutoff; typed-knowledge idea already implicit in c6/c8 |
| 32 | Dwarf Fortress: army-movement rumors get animated-line visualization vs. static markers | demonstrated | 1,2 | dwarffortresswiki.org/index.php/Civilization_and_World_Info | dropped: UI/presentation detail, lowest architectural relevance |

Totals: 8 kept, 6 merged into a kept claim, 18 dropped. 8 + 6 + 18 = 32.

## Unreadable URLs (could not be fetched/retrieved; not represented in the claims above)

- https://www.gdcvault.com/play/1025150/Helping-Players-Hate-(or-Love)
- https://steamcommunity.com/games/1158310/announcements/detail/1716364455374240581
- https://docs.inworld.ai/docs/tutorial-basics/facts-knowledge/
- https://www.gdcvault.com/play/1018040/Architecture-Tricks-Managing-Behaviors-in
- https://docs.inworld.ai/docs/tutorial-integrations/unreal-engine/playground/goals/
