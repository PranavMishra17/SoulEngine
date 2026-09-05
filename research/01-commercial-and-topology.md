# 01 — Commercial model and runtime topology

**Pass A.** Run 2026-09-05. 107 agents, 5 search angles, 3-vote adversarial verification.
**12 findings survived.**

Covers [`../PRODUCT.md`](../PRODUCT.md) §5 Q1-Q7.

**Same reading rule as Pass B:** *refuted* means "not established by this pass," not "the opposite is
true."

---

## The headline

> **No verified shipping product embeds the game developer's own model-provider API keys in a
> distributed build.** Every model provider examined forbids it in first-party documentation. The
> nearest peer vendor tried it, documented that it is unsafe, and engineered against it.

This directly contradicts the topology in `PRODUCT.md` §3.3 Option A — the one the C# code implements
today and the one closest to the stated preference.

---

## Q1 — Topology: what actually ships

**Finding 1 — `high`, 3-0.** Two topologies ship in AI-NPC middleware, and the proposed model matches
neither:

| Topology | Who holds provider keys | Examples |
|---|---|---|
| **Cloud-authoritative thin client** | the middleware vendor | Charisma.ai; Convai's recommended production path |
| **On-device inference, vendor-distributed weights** | *nobody* — no provider key exists in the build | NVIDIA ACE |

Charisma's SDKs expose only `storyId`/`version`/`apiKey`/`startGraphReferenceId` with **no base-URL
override** for the core conversation API — the config surface itself forecloses self-hosting. Pricing
is metered per experience-minute, which is only coherent if the vendor runs inference.

NVIDIA ACE is real, not aspirational: **PUBG Ally runs Mistral-NeMo-Minitron-8B locally**, plus inZOI
"Smart Zoi" and NARAKA: BLADEPOINT's AI teammate. Critically, this path **sidesteps the key problem
rather than solving it** — the weights are NVIDIA's, so no provider API key is in the build at all.

### The one place SoulEngine is genuinely differentiated

**Finding 2 — `high`, 3-0.** In the cloud-authoritative model the vendor holds not just inference keys
but **the NPC's cognitive state**. Charisma's server-side `playthrough` object owns character emotions,
memories, and chat history:

> "A playthrough represents a particular instance of playing a story. It's a wrapper around all the data
> that is local to each playthrough, such as the characters' emotions, memories, and chat history."

The customer cannot run the character stack offline or self-host it. **This is the axis on which the
in-engine C# memory/personality stack is genuinely differentiated — and it is independent of the key
question.** Worth separating in the pitch: "your NPCs' minds live in your build, not our cloud" is
defensible; "and you bring your own keys" is the part that does not survive.

## Q2 — Key handling: the model is prohibited, and there is a standard alternative

**Finding 4 — `high`, 3-0.** The nearest peer vendor has publicly admitted this model is unsafe.
Convai's docs, verified two independent ways (raw file in the official repo and the rendered page):

> "Do not treat obfuscation as security. If you ship an API Key mode build to an audience you do not
> fully control, the account key can be recovered from that build. Ship in Auth Token mode for any build
> that leaves your own machine."

That is a self-incriminating disclosure against vendor interest, not marketing. **Scope note carried
from verification:** Convai's key authorizes billable *vendor-side* inference, so the analogy is not
one-to-one with a SoulEngine auth-only project key — but SoulEngine's model *also* puts the customer's
own LLM/TTS/STT keys in the build, which **is** exactly the high-value billable-key case Convai
documents as unsafe.

**Finding 5 — `high`, 3-0.** Providers prohibit it categorically:

- **OpenAI:** *"Never deploy your key in client-side environments like browsers or mobile apps"* — plus
  the affirmative mandate *"Requests should always be routed through your own backend server."* Backed
  contractually: Terms of Use, *"you are responsible for all activities that occur under your account"*;
  Business Terms §3.1/§3.3(g) restrict credential sharing and key transfer.
- **ElevenLabs:** *"Do not share it with others or expose it in any client-side code (browsers, apps)."*
  **Correction carried from verification:** this is first-party security *guidance*, not an enforceable
  ToS term — no API-key clause exists in their Terms, and no evidence of account bans over embedded keys
  was found.

A game binary is the same class of untrusted environment as a browser — arguably worse, lacking OS
keystore, app sandbox, and store code-signing, and Unity managed assemblies decompile trivially.

**Finding 6 — `high`, 3-0.** There **is** a standard pattern, documented first-party by three
independent vendors with converging mechanics: **token vending.** A developer-controlled server holds
the long-lived key and mints a short-lived scoped credential the untrusted client uses to talk to the
provider directly.

- **OpenAI Realtime:** `POST /v1/realtime/client_secrets` mints ephemeral keys; *"only use standard
  OpenAI API keys on the server, not in the browser."*
- **ElevenLabs:** server-minted signed URLs expiring in 15 minutes, plus hostname allowlists,
  per-endpoint scoping, per-key credit quotas, IP allowlisting, single-use tokens.
- **Convai:** developer-configured self-hosted HTTPS token endpoint; credential resolved fresh for every
  connection, never cached.

> **Limit, stated by the verifiers:** this mitigates key *exfiltration*, not *abuse*. A scraped ephemeral
> token still authorizes real spend for its session lifetime.

### The catch that matters most

**Finding 7 — `medium`, analyst inference (flagged as such).** Adopting the standard pattern **does not
remove the server dependency — it relocates it onto every customer.** Each game developer must stand up,
operate, secure and pay for a token-minting endpoint for the lifetime of their shipped game.

That is in direct tension with the "nothing but auth touches my servers" pitch. The realistic options
reduce to: **(a)** vendor-operated broker — reintroduces vendor-side runtime cost; **(b)**
customer-operated broker — sharp adoption friction for a solo Asset Store buyer; **(c)** on-device
weights, ACE-style — removes provider keys entirely but changes the product.

### What a leaked key actually costs

- **Finding 8 — `medium`, 3-0.** *Leaky Apps*, ACM CCS 2025 **Distinguished Paper**: 10,331 Android/iOS
  apps → 10,164 candidate credentials → **416 confirmed functional** across 65 services by live
  validation. OpenAI credentials rose from 3 (2023) to 11 (2024). 95 credentials removed in the 2024
  build were **never revoked and still valid**. *Framing corrections carried:* 4.09% is a fraction of
  candidate credential strings, not of apps (11 of 10,331 ≈ 0.1%); and the paper treats these as defects
  to revoke, not as an architecture.
- **Finding 9 — `high`, 3-0.** Same paper: *"Applying code obfuscation might make discovering secrets
  more difficult, but it does not prevent manual analysis."* Its leading harm class is *"API tokens with
  usage-based billing"* — the exact billing shape of inference keys. *Note:* "never rely **solely** on
  obfuscation" permits it as defense-in-depth; it does not say obfuscation is worthless.
- **Finding 10 — `high`, 3-0.** A **tooled resale economy** exists specifically for harvested AI
  credentials. Attackers validate stolen keys against AI21, Anthropic, AWS Bedrock, Azure, **ElevenLabs**,
  MakerSuite, Mistral, OpenAI, OpenRouter and Vertex AI, then front them with reverse proxies to rent
  access. Documented damage: **>$100,000/day** exposure on Claude 3 Opus (Sysdig, 2024-09); a storefront
  selling 30-day proxy access for $30 against **$49,596** of inference charges in 4.5 days (Sysdig
  DeepSeek, 2025-02); Microsoft DCU's Storm-2139 action over a proxy with 3,500+ users. **A leaked key's
  exposure is not bounded by one attacker's own appetite.**
- **Finding 11 — `high`, 3-0.** The bill lands on **the account holder** — in a BYO-key model, the game
  developer. *Softening carried:* discretionary goodwill credits reportedly happen case-by-case, but no
  published reimbursement policy was found; and GitHub secret-scanning auto-revocation covers public
  repos only, not a key baked into a game binary.

---

## Q3-Q7 — NOT ANSWERED

**Zero claims survived** on: multi-engine shared-core architecture (Q3), marketplace rules — Unity
Verify Invoice / Fab / Godot (Q4), pricing models (Q5), and licence-enforcement practice (Q7).

The sole pricing datapoint (**Finding 12, `low`, unvoted**) is Charisma's: metered credits at roughly
**$5 per 50,000 credits ≈ 200 experience-minutes**, plus a fixed-monthly Enterprise tier. **No
bring-your-own-key, self-hosted, or offline tier exists anywhere on their pricing page.** Treat as one
anecdote.

This matters more than a normal gap:

- **Q4 could veto a design.** If Unity's Provider Agreement restricts assets that require an external
  paid service, that constrains the entire commercial model — and it is unanswered.
- **`D3` (signed offline licence) has no external validation.** It was decided on reasoning, and this
  pass found no evidence that signed offline licences are established practice in game middleware, nor
  evidence against. It stands as a judgement call, not a researched conclusion.

---

## What this changes

| PRODUCT.md | Effect |
|---|---|
| §3.3 **Option A** (fat client, direct to providers) | **Contraindicated.** Prohibited by OpenAI in writing and by ElevenLabs in guidance; the nearest peer vendor documents it as unsafe and engineered against it; peer-reviewed work shows such keys are extracted and never revoked; a resale market means unbounded exposure — landing on your *customer's* account. This is no longer a live option. |
| §3.3 **Option B** (fat client + broker) | **Validated as the industry-standard pattern**, with a cost the doc understated: the broker is a permanent operational burden on every customer. |
| §3.3 **Option C** (thin client + dev-run server) | Neither validated nor refuted. Note it has the *same* customer-operated-server cost as B, while also giving one runtime. |
| §3.3 — **new Option D** | **On-device weights, ACE-style.** Removes provider keys from the equation entirely and is demonstrably shipping in real titles. Changes the product (you distribute weights, require a capable GPU, accept a quality ceiling) but is the only path that makes the key problem *disappear* rather than move. Must be added and evaluated. |
| §3.2 studio-is-the-moat | **Strengthened, and sharpened.** Charisma proves the differentiator: competitors hold the NPC's cognitive state server-side. "Your NPCs' minds live in your build, not our cloud" is defensible and unique. Keep that claim; drop "and you bring your own keys into the build." |
| `D2` topology | **Research complete. Decision now needed** — A is out; B, C, D remain. |
| `D3` signed offline licence | **Unvalidated** — judgement call, not researched. |
| `D5` entitlement source | Still deferred, and now also **unresearched** (Q4 returned nothing). |

## Recommended follow-up (Pass C)

Q3-Q7 need re-running with narrower, more targeted framing — marketplace terms and licence enforcement
are documentation-retrieval problems, not open research questions, and likely failed because they were
searched as though they were the latter.

## Sources that survived verification

- Convai — ship-a-secure-build: https://docs.convai.com/api-docs/plugins-and-integrations/convai-unity-sdk/authentication/ship-a-secure-build
- OpenAI — API key safety: https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety · Realtime WebRTC: https://developers.openai.com/api/docs/guides/realtime-webrtc
- ElevenLabs — authentication: https://elevenlabs.io/docs/eleven-agents/customization/authentication
- Charisma.ai — core concepts: https://docs.charisma.ai/sdk-integration/core-concepts · pricing: https://charisma.ai/pricing
- NVIDIA ACE for games: https://developer.nvidia.com/ace-for-games
- Schmidt, Schrittwieser, Weippl — *Leaky Apps*, ACM CCS 2025: https://dl.acm.org/doi/10.1145/3719027.3765033
- Sysdig — LLMjacking: https://www.sysdig.com/blog/llmjacking-stolen-cloud-credentials-used-in-new-ai-attack · https://www.sysdig.com/blog/growing-dangers-of-llmjacking · https://www.sysdig.com/blog/llmjacking-targets-deepseek
- Microsoft DCU — Storm-2139: https://blogs.microsoft.com/on-the-issues/2025/02/27/disrupting-cybercrime-abusing-gen-ai/
