# 07 — What comparable products actually charge

**Fetched by hand, 2026-09-05**, in a rendered browser session. Not a research-harness pass.

Three harness attempts (C1, D1) returned nothing here, and D1 confirmed no pricing page was ever
fetched. The cause was mechanical: every one of these is a JavaScript shell that returns an empty
document to an automated fetch. Rendering them in a real browser took one pass.

Covers [`../PRODUCT.md`](../PRODUCT.md) §5 Q5 and informs `D5`.

---

## The headline

> **The one AI-NPC product on the Unity Asset Store with real traction gives the asset away free and
> monetizes the service.** Convai's "NPC AI Engine" is **Free**, rated **4.8 from 154 reviews**, and
> carries Unity's **Verified Solution** badge — the programme §1.5.d of the Submission Guidelines points
> SaaS-connected SDKs toward.
>
> Every paid AI-NPC asset in the category shows "Not enough ratings."

## Direct competitors

### Convai — subscription, metered on interactions, hard-capped on monthly active users

| Plan | Monthly | Yearly | Interactions/mo | **Monthly Active End Users** | Session concurrency |
|---|---|---|---|---|---|
| Free | $0 | — | 100 | **1** | 1 |
| Indie Dev | $29 | $22 | 3,000 | **75** | 1 |
| Professional | $99 | $69 | 10,000 | **250** | 3 |
| Scale | $499 | $299 | 50,000 | **1,250** | 15 |
| Business | $1,199 | $499 *(limited offer)* | 125,000 | **2,500** | 30 |
| Enterprise | custom | — | custom | custom | custom |

Flagship-LLM interactions are separately capped (50 / 1,500 / 5,000 / 25,000 / 50,000). Long-term
memory and character versioning start at Indie Dev. **On-prem deployment exists only at Enterprise.**

> **The MAU cap is the thing to notice.** $1,199/month buys **2,500 monthly active players**. A modestly
> successful indie game blows through the top published tier and lands in "contact sales". For a game
> developer, per-player pricing on a product they ship once is a structurally uncomfortable shape — and
> it is the strongest argument for the BYOK model, where their cost scales with their own provider
> account and nobody else's price list.

### Inworld — has pivoted out of the character-platform business

This is the most strategically significant finding. Inworld no longer prices NPCs at all. It now sells
**TTS, STT and an LLM router**, metered per unit:

| | On-Demand | Creator $25/mo | Builder $100/mo | Developer $300/mo | Growth $1,500/mo | Enterprise |
|---|---|---|---|---|---|---|
| TTS-2 | $25/1M chars | $20 | $17.50 | $15 | $12.50 | as low as $5 |
| TTS-2 Flash | $15/1M chars | $10 | $9 | $8 | $7 | sub-$5 |
| STT | $0.15/hr | $0.10 | $0.10 | $0.10 | $0.10 | custom |
| **LLMs** | **at cost** | at cost | at cost | at cost | at cost | custom |

Subscription price is granted back as dollar-denominated credits, so the tiers buy *rate discounts*, not
capacity. "220+ LLM models via Router." Commercial licence included from the free tier.

> **Read this as competitive intelligence.** The best-funded company in this exact category concluded
> the durable business was **metered inference infrastructure**, not authored characters. Two readings,
> and they point opposite ways: either the character-platform layer does not sustain a company, or it
> was abandoned and the space is now open. Worth deciding which you believe before betting on the
> authoring studio as the moat (`D4`).

### Charisma.ai — pure usage metering, no self-host

**$5 per 50,000 credits ≈ 200 experience-minutes** (~$0.025/minute) on a pay-as-you-go PRO plan.
Enterprise is a one-off development fee plus a fixed monthly platform fee. **No BYOK tier, no
self-hosted tier, no offline mode** — consistent with Pass A's finding that Charisma holds the NPC's
cognitive state server-side.

## The backend-service comparable

### Photon — free through launch, then priced on *concurrent* users

> "Start building today, launch your project for free, and only pay once your game scales beyond our
> free tier."

100 CCU free for 12 months (one app); then roughly $95 / 500 CCU, $125 / 1,000 CCU, $250 / 2,000 CCU per
month. Premium Cloud is **$0.50 per CCU** up to 50,000, billed on monthly usage, with burst tolerance
and a 48-hour window to upgrade rather than a hard cut-off.

> **CCU, not MAU.** Concurrency tracks the cost the vendor actually incurs and is far kinder to a game
> with a large but not-simultaneously-online audience. Photon has been the default game backend for
> years on this model; Convai's MAU caps are the outlier.

## Unity Asset Store — what the category actually charges

| Asset | Publisher | Price | Ratings |
|---|---|---|---|
| **NPC AI Engine — Convai** *(Verified Solution)* | Convai | **Free** | **4.8 (154)** |
| Dialogue System for Unity | Pixel Crushers | **$95** | **4.9 (848)** |
| Behavior Designer | Opsive | $95 | 4.8 (762) |
| Adventure Creator | ICEBOX Studios | $80 | 4.9 (740) |
| Quest Machine | Pixel Crushers | $65 | 5 (73) |
| Dialogue System AI add-on (OpenAI, ElevenLabs) | Pixel Crushers | $45 | 5 (10) |
| Love/Hate | Pixel Crushers | $35 | 4.9 (82) |
| AI Toolbox (ChatGPT, DALL·E, Whisper, Gemini) | Dustyroom | $29.90 | 4.6 (69) |
| Smart NPCs | RaafOritme | $108 | none |
| AI NPC Dialogue System + World Knowledge | MetaMix3D | $99 | none |
| Local On-Device LLM for NPCs — GladeCore | Glade Studio | $49.99 | none |
| DialogueCraft AI | CraftWorks | $45 | none |
| AI DevKit PRO — Local AI, RAG, Tools | Glitch9 | $39.99 | 4.6 (9) |
| Motive Engine — Explainable AI for NPCs | PrettyNerdee | $24.99 | none |
| NPCAI Behavior Suite | Obeder's Team | $20 | none |
| AI NPC Builder SDK | NPC Builder | Free | none |

**Three patterns:**

1. **Established paid tools cluster at $65–$95** and carry 700–850 ratings. That is the price band a
   serious, proven Unity tool commands — and none of them is AI-powered.
2. **Every paid AI-NPC asset has "Not enough ratings."** The category is crowded and unproven; a dozen
   entrants, no winners. Price is not what is failing them.
3. **The only AI-NPC asset with traction is free**, and it belongs to a company selling a subscription
   behind it.

---

## What this changes

| PRODUCT.md | Effect |
|---|---|
| `D5` entitlement / pricing | **Answered enough to act.** The market's proven shape in this exact category is **free asset, paid service, Verified Solution badge** — which is what Convai does and the only thing with traction. A paid asset puts you in the "Not enough ratings" cohort. |
| §3.2 studio-is-the-moat | **Supported by Convai's shape, complicated by Inworld's pivot.** Convai monetizes exactly the layer §3.2 identifies. But Inworld — better funded, same category — walked away from that layer to sell metered inference. Decide which signal you weight. |
| BYOK positioning | **Sharpened into a concrete pitch.** Convai charges $1,199/mo for 2,500 monthly active users. Under BYOK the developer's cost scales with their own provider account and has no per-player ceiling set by you. "No MAU cap" is a real, checkable differentiator against the category leader. |
| Metering unit, if you ever meter | **Use concurrency, not monthly actives.** Photon has run on CCU for years; Convai's MAU caps are the outlier and the harshest number on any page fetched here. |
| §1.5.d Verified Solutions | **Worth pursuing, not just considering.** The category leader carries the badge on a free listing. |
| Unresolved | Licence enforcement in game middleware (Q7) is still un-fetched — Wwise, FMOD, Havok, SpeedTree, Umbra. That is a separate manual pass, and `D3` stays unvalidated until then. |

## Sources (fetched in a rendered browser, 2026-09-05)

- Convai pricing: https://convai.com/pricing
- Inworld pricing: https://inworld.ai/pricing
- Charisma pricing: https://charisma.ai/pricing
- Photon Fusion pricing: https://www.photonengine.com/fusion/pricing
- Unity Asset Store, query "AI NPC dialogue" (153 results): https://assetstore.unity.com/?q=AI%20NPC%20dialogue
