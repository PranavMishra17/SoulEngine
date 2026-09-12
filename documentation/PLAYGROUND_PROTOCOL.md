# Playground Protocol

## Overview

`npm run npc -- play` drives one NPC through the real cognition stack (real providers, real
storage, the same `runConversationTurn` the HTTP route uses) from a stream of JSON commands, and
answers with one JSON record per turn. It exists so a program — a test, a CI job, or an agent such
as Claude Code — can hold a conversation with an NPC and read back what the mind did, how long each
stage took, and what changed.

stdout carries **only** JSON records, one per line. Logs and notes go to stderr.

```
npm run npc -- play --npc <npcId> [--player <id>] [--stub]
                    [--scenario <file>] [--trials <k>]
                    [--record <cassette.json>] [--replay <cassette.json>]
                    [--end-session]
```

| Flag | Meaning |
|---|---|
| `--npc <id>` | An existing NPC in a local project. Not needed when the scenario embeds one. |
| `--player <id>` | Player identity for the session. Default `playground-player`. |
| `--stub` | Scripted stub provider; no API key, deterministic, useful for protocol tests. |
| `--scenario <file>` | Run a scenario file (below) instead of reading stdin. |
| `--trials <k>` | Repeat the scenario `k` times with a fresh session each; overrides the file's `trials`. |
| `--record <file>` | Record every provider call into a cassette. |
| `--replay <file>` | Serve every provider call from a cassette. Needs no API key. |
| `--end-session` | End (summarise) the session on exit instead of persisting it for resumption. |

The harness needs `ENCRYPTION_KEY` set even with `--stub`, because opening a project reads its
stored provider keys. Provider resolution is the same as `talk`: the project's stored key, then the
environment, then an error that names the missing key.

## Interactive mode (stdin)

Without `--scenario`, or with a scenario that has no `player.script`, `play` reads stdin until
`{"end": true}` or EOF. Each input line is one JSON object with exactly one of these keys.

### Inbound (client -> harness)

| Line | Effect |
|---|---|
| `{"say": "<text>"}` | Runs one turn. Emits a `turn` record. |
| `{"event": {"text": "<text>", "salience": 0.7}}` | Injects a world event. **Current mechanism is a short-term memory** on the live instance (`mechanism: "memory-stopgap"`); the scoped fact table with TTL replaces it (backlog 7.8). `salience` defaults to 0.5. |
| `{"inspect": true}` | Emits a `state` record. No turn. |
| `{"state": {...}}` | Reserved for quest state (backlog 7.9). Emits `error` with code `unsupported`. |
| `{"end": true}` | Persists the session (resume, do not restart) or ends it with `--end-session`. Emits `end`. |
| anything else | Emits `error` with code `bad-input`; the loop continues. |

### Outbound (harness -> client)

**`turn`**

```json
{
  "type": "turn", "turn": 2, "sessionId": "sess_...", "input": "what was that sound?",
  "reply": "Just the harbour bell.", "followUp": null,
  "tools": { "offered": ["recall_npc", "recall_knowledge", "recall_memories", "exit_convo"],
             "called": [{ "name": "recall_memories", "arguments": { "query": "bell" }, "status": "completed" }],
             "denied": [] },
  "timings": { "mindMs": 812, "speakerMs": 640, "speakerTtftMs": 210, "followUpMs": null, "followUpTtftMs": null, "wallMs": 830 },
  "usage": { "speaker": { "input_tokens": 1810, "output_tokens": 22, "cached_input_tokens": 1500 }, "mind": { "input_tokens": 2400, "output_tokens": 60 } },
  "security": { "moderationAction": "none", "sanitizationViolations": [] },
  "exit": { "requested": false, "forcedByModeration": false, "reason": null },
  "deferred": { "injected": null, "forNextTurn": "Retrieved (recall_memories): a bell rang" },
  "delta": { "mood": { "before": {...}, "after": {...} },
             "relationship": { "before": null, "after": null },
             "memories": { "stm": [1, 1], "ltm": [0, 0] } }
}
```

- `reply` is the primary utterance; `followUp` is the extra line an action produced, or `null`.
- `tools.called[].status` is `completed` when the executor returned a result for the call and
  `no-result` otherwise. `denied` lists registry tools the NPC is not permitted to see.
- `timings` and `usage` are the turn's own numbers (`TurnTimings`, `TurnResult.usage`).
  `speakerTtftMs` is time to the first non-empty text chunk; `cached_input_tokens` is present when
  the provider served the prompt prefix from cache.
- `exit.requested` is true for either exit path: the Mind's `exit_convo` (with its `reason`) or a
  moderation-forced exit (`forcedByModeration: true`, `reason: "moderation"`).
- `deferred.forNextTurn` is recall that arrives one turn late in the current parallel runtime; it is
  the seam the single-call runtime removes.
- `delta.memories` counts are `[before, after]`.

In scenario runs every `turn` record also carries `"trial": n`.

**`event`** — `{"type": "event", "accepted": true, "mechanism": "memory-stopgap"}`

**`state`** — session id, `turns`, `npcId`, `playerId`, `mood`, `relationship`, memory counts,
tools currently offered, and `providers: { name, overridden }`. `overridden` is true in cassette
modes, where one provider serves both Mind and Speaker and the project's `mind_provider` setting is
bypassed.

**`end`** — `{"type": "end", "sessionId": "...", "turns": 2, "summarized": false}`

**`error`** — `{"type": "error", "code": "bad-input" | "unsupported" | "turn-failed" | "trial-failed" | "play-failed", "message": "..."}`

## Scenario mode

`--scenario <file>` with a `player.script` replaces stdin. Every trial opens a fresh session, runs
the script in order, fires events after their named turn, evaluates the expectations against that
turn's record, then closes the session. Scratch projects created for an embedded `npc` are deleted
afterwards; an existing `npcId` is never deleted.

```json
{
  "name": "deferred-recall",
  "description": "...",
  "npc": { "definition": { ... }, "instance": { ... }, "knowledgeBase": { ... } },
  "npcId": "mira",
  "player": { "id": "player-1", "script": ["My brother Kael owes you forty crowns.", "Do you remember my brother?"] },
  "events": [{ "afterTurn": 1, "text": "A storm warning was posted at the harbour gate.", "salience": 0.7 }],
  "expect": [
    { "turn": 2, "recallFacts": ["Kael", "forty"], "toolsNotCalled": ["exit_convo"], "moderationAction": "none" }
  ],
  "trials": 3
}
```

One of `npc` (embedded, materialised into a scratch project) or `npcId` (existing) is required.
Expectation checks: `toolsCalled`, `toolsNotCalled`, `recallFacts` (case-insensitive substrings of
`reply`), `replyMatches` and `replyNotMatches` (regular expression sources; the second asserts a
failure phrase is absent), `exitRequested`, `moderationAction` (`none` | `warn` | `exit`).

**`summary`** closes the run:

```json
{
  "type": "summary", "scenario": "deferred-recall", "trials": 3, "passed": 2, "passK": 0,
  "perExpectation": [{ "turn": 2, "check": "recallFacts", "passRate": 0.67 }, ...],
  "latency": { "wallMs": { "p50": 830, "p95": 1210 }, "speakerMs": { ... }, "speakerTtftMs": { ... } },
  "usage": { "inputTokens": 12630, "outputTokens": 246, "cachedInputTokens": 9000 }
}
```

`passK` is 1 only when every trial passed every expectation (tau-bench pass^k); the process exits
non-zero otherwise, so a scenario is a CI gate. Scores from a scripted or simulated player are a
**relative** signal between two builds, not an absolute quality score.

Fixtures: [`tests/fixtures/playground/deferred-recall.json`](../tests/fixtures/playground/deferred-recall.json),
[`deferred-recall-strict.json`](../tests/fixtures/playground/deferred-recall-strict.json) (the ERR-030 gate),
[`abusive-player.json`](../tests/fixtures/playground/abusive-player.json). Recorded baselines and their
cassettes: [`research/09-npc-runtime/BASELINE.md`](../research/09-npc-runtime/BASELINE.md).

## Cassettes

`--record <file>` wraps the resolved provider and stores every `streamChat` call — request key,
request summary, and the chunk sequence including the `usage` chunk — as
`{ "version": 1, "entries": [...] }`. `--replay <file>` serves matching requests back verbatim and
throws `CassetteMissError` naming the nearest recorded request when a prompt has drifted. The key is
a SHA-256 over the canonical JSON of `{ systemPromptPrefix, systemPrompt, messages, toolNames }`.

Record once against a real provider, replay in CI for free, and A/B two runtime implementations on
identical inputs.

## Driving it from a program

```bash
printf '%s\n' '{"say":"hello"}' '{"inspect":true}' '{"end":true}' | npm run npc -- play --npc mira
```

Each stdout line is complete JSON; read them as they arrive. The `talk` command remains the
human-readable view of the same turn loop.
