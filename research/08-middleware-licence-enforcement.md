# 08 — How game middleware actually enforces licences

**Fetched by hand, 2026-09-05**, in a rendered browser session. Not a research-harness pass.
Closes the last research gap; the harness returned nothing on this in Passes C1 and D1.

Covers [`../PRODUCT.md`](../PRODUCT.md) §5 Q7 and decides `D3`.

---

## The headline

> **Game middleware does not DRM the shipped runtime.** Not one vendor examined requires online
> activation, a licence key, or a signed licence file in the game a player runs. Licensing is per-title,
> tiered by the studio's budget, and enforced through **contract, registration and attribution**.
>
> Where technical enforcement exists at all, it is on the **authoring tool** — never on the runtime.

That is a direct hit on `D3`, and it points the same way as §3.2.

---

## Firelight — FMOD

Per-game fee, tiered by development budget. **No activation, no key, no licence file anywhere in the
flow.**

| Level | Dev budget | Fee per game |
|---|---|---|
| Indie | under $600k | **Free** or $2,000 |
| Basic | $600k – $1.8M | $6,000 |
| Premium | over $1.8M | $18,000 |

Free Indie applies under $200k revenue/year on a sub-$600k budget. **Distribution rights are lifetime at
every tier. All features, all platforms, at every tier.** No royalties, no recurring fees.

The enforcement mechanism is two things:

1. **Registration** — *"first make sure it is registered with us in your FMOD profile."* An honour-system
   declaration, not a technical gate.
2. **A required logo** — *"FMOD Logo: Required"* at **every** tier, with a **Logo Waiver sold separately
   at $6,000 (Basic) and $12,000 (Premium)**.

> Attribution is the enforcement, and removing it is itself a revenue line. That is a notably cheaper
> mechanism than DRM, and it monetizes the thing developers actually want to pay to remove.

## Audiokinetic — Wwise

Same shape. Budget-tiered, **Royalty Free (0%)**, unlimited assets and all engine features at every tier
including free. Site navigation carries a first-class **"Register My Project"** action.

| Plan | Production budget | Price |
|---|---|---|
| Indie | under $250K | **Free** |
| Pro | $250K – $2M | from $8,000 |
| Premium | over $2M | from $25,000 |
| Platinum | over $2M | from $45,000 |

Source-code access is gated behind a support package. **No activation, key, or licence-file mechanism is
described.**

## SpeedTree — the one that does enforce, and where

The exception proves the rule. SpeedTree (now Unity-owned) splits enforcement by **which artefact**:

| Plan | Revenue | Price | What is licensed |
|---|---|---|---|
| Indie | under $100k | $19/month | Modeler — **"Internet Access Required"** |
| Pro | under $1M | $899/year | Modeler — **"Internet Access Required"** |
| Library | under $1M | $999 | Asset library, 1-year subscription |
| Enterprise | over $1M | custom | Modeler **+ Runtime SDK**, **"Node-locked or Floating"** |

Two things to read off this:

1. **The authoring tool is gated** — by subscription, and explicitly by required internet access.
2. **The Runtime SDK is not sold below Enterprise at all**, and where it is licensed, it uses classic
   node-locked/floating seats — a *developer-workstation* mechanism, not something that runs on a
   player's machine.

> Nobody is validating a licence inside the shipped game. The gate is on the tool the developer uses.

## Microsoft — Simplygon

Per-title licensing (*"One per-title license, every integration"*). A build-time content-optimization
tool rather than a runtime, so less directly analogous, but consistent with the per-title pattern.

*(Simplygon's documentation host refused the automated navigation, and Havok's licensing is
enterprise-opaque with no public page. Neither is likely to overturn a pattern this consistent, but both
are unfetched — stated rather than inferred.)*

---

## Is signed offline licence verification an established pattern here?

**No.** Pass C1 found the pattern is *productized* by Keygen, a general software-licensing SaaS — but
that page contains zero game, game-engine, or game-middleware guidance, and C1 specifically **refuted
3-0** the claim that Keygen's examples embed the account public key client-side, which is the exact
topology `D3` proposed.

Nothing fetched in this pass shows any game middleware vendor shipping cryptographic licence
verification into a game binary. The category solves this commercially, not technically.

---

## What this changes

| PRODUCT.md | Effect |
|---|---|
| **`D3` signed offline licence** | **Downgrade from "build it" to "probably don't."** No game middleware vendor does this. Building Ed25519 licence infrastructure would put you alone in your category, spending engineering time on a mechanism your competitors concluded they did not need. The design was sound reasoning from first principles; the market says the problem is not worth solving that way. |
| **What to do instead** | Copy the pattern that is universal here: **per-title licence tiered by the buyer's budget or revenue, enforced by contract and registration, with attribution as the visible mechanism.** Note FMOD sells the *logo waiver* at $6,000–$12,000 — the enforcement artefact is itself a product. |
| §3.2 studio-is-the-moat | **Strongly confirmed by SpeedTree.** The only vendor doing real technical enforcement gates the **authoring tool** (subscription plus required internet), not the runtime. That is exactly §3.2, independently arrived at by a shipping vendor. You already have working auth on the studio — that *is* the enforcement layer. |
| Free-tier shape | Both audio vendors give the engine away free below a budget threshold ($600k FMOD, $250K Wwise) with **all features and lifetime rights**. Combined with [`07-pricing-and-comparables.md`](07-pricing-and-comparables.md) — where the only AI-NPC asset with traction is free — the case for a generous free tier is now supported from two independent directions. |
| Effort saved | W3 (§4) can drop the signing/verification work and keep only the entitlement schema. That is the cheapest finding in this whole research programme. |

## Sources (fetched in a rendered browser, 2026-09-05)

- FMOD licensing: https://www.fmod.com/licensing
- Audiokinetic Wwise pricing: https://www.audiokinetic.com/en/pricing/
- SpeedTree plans: https://store.speedtree.com/pricing/ (redirects to unity.com)
- Simplygon: https://simplygon.com/#pricing
- Keygen offline licences (from Pass C1, for contrast): https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/
