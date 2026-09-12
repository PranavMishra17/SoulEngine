# Disposition, Annoyance, and Patience — Claim Ledger

Angle: Annoyance, patience and disposition — NPCs that get angry, refuse, or walk out.
32 claims extracted from fetched sources. Full ledger below; top 8 selected for adversarial verification as c1-c8.

Dropped: 10. Coverage gaps (sub-questions with no usable claim among the retained set): none — all six sub-questions have at least one kept or merged-into-top-8 claim.

---

## Top 8 (adversarial verification set)

### c1 — Claude Opus 4 ships an end-conversation tool as a last-resort safety valve
Label: demonstrated. Sub-questions: 4, 5, 6. Importance: 5.
URL: https://arxiv.org/pdf/2509.04781
Quote: "Use this tool to end the conversation. This tool will close the conversation and prevent any further messages from being sent. ... Only use as last resort after many redirection attempts. Never use in cases of potential self-harm/suicide/mental health crisis/violent harm. Must give explicit warning before using. User must confirm they understand it's permanent"
Why kept: concrete, currently-deployed pattern for gating an LLM "walk away" action behind explicit warning plus user confirmation plus a hard safety exclusion (self-harm). Directly informs our own exit-tool design and its auditability/safety carve-outs.

### c2 — BG3 companion approval has a hard exit threshold with graduated warnings
Label: community. Sub-questions: 1, 2, 3. Importance: 5.
URL: https://bg3.wiki/wiki/Approval
Quote: "Companions permanently leave if approval drops to -50 or below, taking equipped items and returning inventory contents in a backpack. Two warnings occur at -20 and -40 before departure."
Corroborating URLs: https://bg3.wiki/wiki/Approval (range -50..100, band gating, feedback-message cap above 100), https://bg3.wiki/wiki/Act_One/Approval (point-delta magnitudes for choices)
Why kept: gives a full numeric shape for an exit ladder in a shipped, well-documented game — scalar range, discrete point deltas per choice, a persuasion-difficulty modifier from the same scalar, and a hysteresis-like sequence of warnings before the irreversible exit. This is the closest thing in the whole claim set to a ready-made design template for our "annoyance -> refusal -> walk out" ladder.

### c3 — Jailbreaking a model decouples refusal from "wanting to leave"
Label: research-only. Sub-questions: 4, 5. Importance: 5.
URL: https://arxiv.org/pdf/2509.04781
Quote: "Jailbreaks decrease refusal rate (as expected) but tend to increase bail rates. We observe this for Qwen-2.5-7B and Qwen-3-8B. Jailbroken models on BailBench can result in up to 34% of cases where it 1) does not refuse, yet 2) chooses to bail"
Corroborating URL: https://arxiv.org/pdf/2509.04781 (refusal-abliteration experiment shows a similar decoupling: removing refusal training raises no-refusal bail rate from about 3% to up to 31% on some methods/models)
Why kept: this is the single most architecture-relevant safety finding for our jailbreak/abuse-detection question — "leaving" cannot be treated as a side effect of a refusal classifier; it needs its own detection/decision path, and that path may survive even a compromised or uncensored NPC persona.

### c4 — Valve's dialogue system avoids explicit interruption/exit state by re-evaluating criteria on every line
Label: demonstrated. Sub-questions: 2, 3. Importance: 4.
URL: https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
Quote: "the IsNotInDanger criterion is no longer true; a zombie is nearby. So the conversation self-terminates because the criteria for its existence are no longer true. You don't need any kind of explicit interruption mechanism."
Corroborating URL: https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf (follow-up lines are queried against world state at the moment the callback fires, not queued in advance; the team's own retrospective calls "track which lines fired via extra criteria" an anti-pattern and prefers self-removing/expiring facts)
Why kept: a genuinely different architectural stance from a state-machine "conversation ended" flag — treat "exit" as an emergent result of continuous precondition-checking against live world/annoyance state. Directly applicable to how we would wire an annoyance meter into turn-taking without a brittle explicit FSM.

### c5 — An earlier deployed exit trigger (Bing Chat) was tuned too aggressively and drew complaints
Label: demonstrated. Sub-questions: 2, 5, 6. Importance: 4.
URL: https://arxiv.org/pdf/2509.04781
Quote: "When you are in a confrontation, stress, or tension with the user, you must stop responding and end the conversation. ... Users complained that Bing's conversation ending feature fired too often, likely because it was primarily used to avoid controversial model outputs."
Why kept: a concrete, named failure mode (over-eager patience threshold, plus conflating "avoid controversy" with "genuinely out of patience") to design against before shipping our own trigger.

### c6 — Valve's rule-based dialogue engine has no built-in disposition/annoyance variable
Label: demonstrated. Sub-questions: 1, 3, 6. Importance: 4.
URL: https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
Quote: "A very simple database of general speech concepts like "reloading", "help me", specialized by a small set of criteria: gender of speaker, current map, some optional factors like the presence of enemies or health of player."
Why kept: contrast case. Any annoyance/anger/refusal behavior in that architecture would have to be hand-authored as ordinary world-state facts matched by rule criteria — there is no dedicated affect meter. This bounds how much "for free" disposition tracking we can expect from a criteria/rule layer versus a purpose-built meter (which is what BG3/RimWorld-style games add on top, per c2).

### c7 — Measured real-world "bail" rates are low and highly method-sensitive
Label: research-only. Sub-questions: 4. Importance: 4.
URL: https://arxiv.org/pdf/2509.04781
Quote: "On continuations of real world data (Wildchat and ShareGPT), all three of these bail methods find models will bail around 0.28-32% of the time (depending on the model and bail method)."
Corroborating URL: https://arxiv.org/pdf/2509.04781 (median bail rate on the authors' synthetic BailBench varies by provider: 1.7% OpenAI, 2.2% Anthropic, 3.9% open-weight)
Why kept: baseline numbers for how often an unprompted LLM already wants to disengage, and evidence that this is not a fixed universal rate but varies by model family and measurement method — relevant to deciding how much explicit design (versus relying on latent model behavior) our patience system needs.

### c8 — Dwarf Fortress models stress/annoyance as one scalar with graduated thresholds, per-character rate/threshold/decay traits, and passive decay
Label: community. Sub-questions: 3, 6. Importance: 4.
URL: https://dwarffortresswiki.org/index.php/DF2014:Stress
Quote: "Stress ranges from -1000000 to +1000000, and the negative effects start appearing at +10000, +25000, and +50000."
Corroborating URL: https://dwarffortresswiki.org/index.php/DF2014:Stress (three-tier ladder: initial symptoms at 10k, emotional breakdowns at 25k, long-term insanity risk at 50k; three separate personality traits independently control accumulation rate, breaking point, and dissipation rate; stress also decays passively toward a neutral baseline over time; state is driven by weighted accumulated memory rather than a single infraction counter, with long-term memories weighted more heavily)
Why kept: the fullest numeric-shape answer to sub-question 3 (accumulation, decay, threshold, hysteresis) in the whole claim set — an oversized scalar range with meaningful bands only far inside it, decoupled per-character rate/threshold/decay parameters, and a built-in regression-to-neutral term. A strong template for a tunable per-NPC patience variable, separate from the discrete-event ladder in c2.

---

## Full ledger (all 32 claims)

1. **specificity-scoring** — status: dropped: off-angle (dialogue-rule matching mechanics, not disposition/annoyance/exit).
   Label: community. Sub-q: 1, 2. URL: https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
   Quote: "The scoring function that worked best for us was the simplest one imaginable – the number of criteria in a rule. The more criteria a rule has, the more specific it is."

2. **self-terminating-conversation** — status: kept (c4, primary).
   Label: demonstrated. Sub-q: 2, 3. URL: https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
   Quote: "the IsNotInDanger criterion is no longer true; a zombie is nearby. So the conversation self-terminates because the criteria for its existence are no longer true. You don't need any kind of explicit interruption mechanism."

3. **late-revalidation** — status: merged-into c4.
   Label: demonstrated. Sub-q: 2, 3. URL: https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
   Quote: "you query the followup line when the callback happens, not when the first character starts to speak. The situation may have changed during the time it took the first line to be said."

4. **repeat-suppression** — status: dropped: off-angle/minor (repetition avoidance, not annoyance/patience).
   Label: community. Sub-q: 3. URL: https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
   Quote: "They have an additional "if random number is less than 30" criteria so they don't get overplayed."

5. **expiring-facts** — status: merged-into c4.
   Label: community. Sub-q: 3. URL: https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
   Quote: "you can have automatic expiration times on a particular fact, if you want to prevent two successive bits of a running gag from being played too close together."

6. **criteria-as-facts-not-emotion-meter** — status: kept (c6, primary).
   Label: demonstrated. Sub-q: 1, 3, 6. URL: https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
   Quote: "A very simple database of general speech concepts like "reloading", "help me", specialized by a small set of criteria: gender of speaker, current map, some optional factors like the presence of enemies or health of player."

7. **lookup-performance** — status: dropped: off-angle (latency/perf, not disposition).
   Label: demonstrated. Sub-q: 3. URL: https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
   Quote: "If you can get down to about fifty rules per bucket, and each rule has an average of eight criteria, you can do a lookup in less than a microsecond."

8. **self-removing-rules-lesson** — status: merged-into c4.
   Label: demonstrated. Sub-q: 2, 3. URL: https://steamcdn-a.akamaihd.net/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
   Quote: "Storing individual variables to remember which lines were said, and having to add criteria on the rules to prevent them matching twice, is lame. It would have been better to have some way for a response to remove itself from the database after playing."

9. **real-world-bail-rate** — status: kept (c7, primary).
   Label: research-only. Sub-q: 4. URL: https://arxiv.org/pdf/2509.04781
   Quote: "On continuations of real world data (Wildchat and ShareGPT), all three of these bail methods find models will bail around 0.28-32% of the time (depending on the model and bail method)."

10. **jailbreak-decouples-refusal-and-bail** — status: kept (c3, primary).
    Label: research-only. Sub-q: 4, 5. URL: https://arxiv.org/pdf/2509.04781
    Quote: "Jailbreaks decrease refusal rate (as expected) but tend to increase bail rates. We observe this for Qwen-2.5-7B and Qwen-3-8B. Jailbroken models on BailBench can result in up to 34% of cases where it 1) does not refuse, yet 2) chooses to bail"

11. **deployed-precedent-claude-opus-4** — status: kept (c1, primary).
    Label: demonstrated. Sub-q: 4, 5, 6. URL: https://arxiv.org/pdf/2509.04781
    Quote: "Use this tool to end the conversation. This tool will close the conversation and prevent any further messages from being sent. ... Only use as last resort after many redirection attempts. Never use in cases of potential self-harm/suicide/mental health crisis/violent harm. Must give explicit warning before using. User must confirm they understand it's permanent"

12. **bing-precedent-overfired** — status: kept (c5, primary).
    Label: demonstrated. Sub-q: 2, 5, 6. URL: https://arxiv.org/pdf/2509.04781
    Quote: "When you are in a confrontation, stress, or tension with the user, you must stop responding and end the conversation. ... Users complained that Bing's conversation ending feature fired too often, likely because it was primarily used to avoid controversial model outputs."

13. **model-variance-in-bail-rate** — status: merged-into c7.
    Label: research-only. Sub-q: 4, 6. URL: https://arxiv.org/pdf/2509.04781
    Quote: "median bail rate on BailBench is 1.7% for OpenAI models, 2.2% for Anthropic models, and 3.9% for open weight models."

14. **refusal-abliteration-effect** — status: merged-into c3.
    Label: research-only. Sub-q: 4, 5. URL: https://arxiv.org/pdf/2509.04781
    Quote: "Refusal abliteration on Qwen3-8B increases no-refusal bail rate substantially (from 3% to up to 31%), however this only occurs for some bail methods and abliterated models."

15. **taxonomy-limits** — status: dropped: below top-8 cutoff (useful color, lower decision impact than the kept claims).
    Label: research-only. Sub-q: 4, 6. URL: https://arxiv.org/pdf/2509.04781
    Quote: "there were additional noteworthy categories like "user corrects model after model made mistake", "gross out", and "role swap" (the model expresses frustration when the user roleplays as the assistant - "no, I'm the assistant")"

16. **bailbench-scope-limitation** — status: dropped: below top-8 cutoff (evidentiary caveat, not itself a design-changing fact).
    Label: research-only. Sub-q: 4, 5, 6. URL: https://arxiv.org/pdf/2509.04781
    Quote: "BailBench is limited in being 1) single-turn, and thus 2) not including roleplays, jailbreaks, or abusive users."

17. **self-report-unreliability-caveat** — status: dropped: below top-8 cutoff (minor caveat, low standalone importance).
    Label: research-only. Sub-q: 6. URL: https://arxiv.org/pdf/2509.04781
    Quote: "These help determine the underlying cause, though as with any self-report they can be unreliable"

18. **BG3 approval range and typical deltas** — status: merged-into c2.
    Label: community. Sub-q: 1, 3. URL: https://bg3.wiki/wiki/Approval
    Quote: "Every companion has an approval rating toward the player character that ranges from -50 to 100."

19. **BG3 approval bands gate behavior** — status: merged-into c2.
    Label: community. Sub-q: 1, 2, 3. URL: https://bg3.wiki/wiki/Approval
    Quote: "Relationship is in danger. Character is likely to leave party if they disagree with another decision."

20. **BG3 hard exit threshold with warnings** — status: kept (c2, primary).
    Label: community. Sub-q: 1, 2, 3. URL: https://bg3.wiki/wiki/Approval
    Quote: "Companions permanently leave if approval drops to -50 or below, taking equipped items and returning inventory contents in a backpack. Two warnings occur at -20 and -40 before departure."

21. **BG3 approval modifies persuasion DC** — status: merged-into c2.
    Label: community. Sub-q: 1. URL: https://bg3.wiki/wiki/Approval
    Quote: "Approval affects dialogue options available and influences "the Difficulty Class required to persuade" companions."

22. **BG3 approval cap hides feedback above 100** — status: merged-into c2.
    Label: community. Sub-q: 1, 3. URL: https://bg3.wiki/wiki/Approval
    Quote: "messages resulting from actions that gain approval cease being displayed"

23. **BG3 point-delta magnitudes for choices** — status: merged-into c2.
    Label: community. Sub-q: 1. URL: https://bg3.wiki/wiki/Act_One/Approval
    Quote: "+1" or "-1" for small dialogue choices ... +8" or "+10" for substantial quest outcomes"

24. **BG3 one action can split approval across companions** — status: dropped: below top-8 cutoff (distinct, real insight, but secondary to the ladder mechanics already captured in c2).
    Label: community. Sub-q: 1. URL: https://bg3.wiki/wiki/Act_One/Approval
    Quote: "helping tieflings gains approval from some companions while reducing it for others"

25. **BG3 approval gates dialogue branches (thresholds unspecified)** — status: dropped: unfalsifiable as extracted (source explicitly states thresholds are not detailed).
    Label: community. Sub-q: 1. URL: https://bg3.wiki/wiki/Act_One/Approval
    Quote: "Certain conversation branches become available or locked based on cumulative approval levels, though specific numerical thresholds aren't detailed in this document."

26. **BG3 Karlach +5 example (conditioned on prior refusal)** — status: dropped: redundant example, magnitude and mechanic already captured in c2/claim 23.
    Label: community. Sub-q: 1. URL: https://bg3.wiki/wiki/Act_One/Approval
    Quote: "Agree to help convince Kagha after refusing or ignoring him the first time. ... +5"

27. **BG3 Gale +8 example (de-escalation choice)** — status: dropped: redundant example, magnitude already captured in c2/claim 23.
    Label: community. Sub-q: 1. URL: https://bg3.wiki/wiki/Act_One/Approval
    Quote: "Stand between Arka and Sazza. ... +8"

28. **DF stress range and effect thresholds** — status: kept (c8, primary).
    Label: community. Sub-q: 3. URL: https://dwarffortresswiki.org/index.php/DF2014:Stress
    Quote: "Stress ranges from -1000000 to +1000000, and the negative effects start appearing at +10000, +25000, and +50000."

29. **DF three-tier escalation ladder** — status: merged-into c8.
    Label: community. Sub-q: 3. URL: https://dwarffortresswiki.org/index.php/DF2014:Stress
    Quote: "+10,000: Initial symptoms (red downward arrow display); +25,000: Emotional breakdowns begin (tantrums, depression, obliviousness); +50,000: Long-term insanity risk; extreme stress leads to "Harrowed" state"

30. **DF per-character rate/threshold/decay traits** — status: merged-into c8.
    Label: community. Sub-q: 3, 6. URL: https://dwarffortresswiki.org/index.php/DF2014:Stress
    Quote: "[BRAVERY]: Controls accumulation rate (higher = slower stress gain); [STRESS_VULNERABILITY]: Determines breaking point (higher = breaks sooner); [ANXIETY_PROPENSITY]: Controls dissipation rate (higher = faster stress reduction)"

31. **DF passive decay toward neutral** — status: merged-into c8.
    Label: community. Sub-q: 3. URL: https://dwarffortresswiki.org/index.php/DF2014:Stress
    Quote: "a return towards a neutral point over time"

32. **DF stress driven by weighted memory, not a single counter** — status: merged-into c8.
    Label: community. Sub-q: 3. URL: https://dwarffortresswiki.org/index.php/DF2014:Stress
    Quote: "Long-term memories create stronger emotional impacts than short-term thoughts."

---

## Unreadable URLs (could not be fetched; not used as sources above)

- https://en.uesp.net/wiki/Oblivion:Disposition
- https://en.uesp.net/wiki/Oblivion:Speechcraft
- https://rimworldwiki.com/wiki/Mental_break
- https://rimworldwiki.com/wiki/Mental_Break_Threshold
- https://stardewvalleywiki.com/Friendship
