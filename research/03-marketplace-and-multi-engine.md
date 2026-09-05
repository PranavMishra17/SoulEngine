# 03 — Marketplace rules, entitlement, pricing, licence enforcement

**Pass C1.** Run 2026-09-05. 103 agents, 3-vote adversarial verification. **14 findings survived.**

Covers [`../PRODUCT.md`](../PRODUCT.md) §5 Q3-Q7 (the re-run, reframed as documentation retrieval).

---

## The headline

> **Unity's store rules do not merely permit Option B — §1.5.b independently requires it.** A package
> may not store third-party API keys in a way that puts them in the build. The buyer-operated key
> broker is the compliant answer to a rule that already exists.

The design chosen in [`../PRODUCT.md`](../PRODUCT.md) §3.3 was picked on security grounds. It turns out
to also be the only shape that passes Unity submission.

---

## Q4 — Unity Asset Store rules

All quotes verbatim from the **Submission Guidelines, "Last Updated May 20, 2026"**, extracted from raw
page HTML by independent verifiers and corroborated against the Unity China mirror.

### §1.4.a — vendor accounts and subscriptions are allowed `high, 3-0`

> "Submissions do not include any functionality that restricts users from using content or features to
> their full extent, including digital rights management (DRM), time restrictions, registration, or
> paying extra costs (such as subscription-based payments). **Notwithstanding the foregoing, an exception
> is made for SaaS-connected SDKs, which are permitted to require account registration (i.e., login
> walls) and subscription-based payments. First-party API based solutions may use the Publisher's Invoice
> API to authorize users**, and may have functionally necessary or third-party limitations (e.g., API
> throttling), all of which must be transparently disclosed in the description and documentation of the
> package."

The default rule is prohibition; these are narrow exceptions. **Requiring a SoulEngine account is
permissible**, conditional on disclosure.

### §1.5.b — the rule that mandates the broker `high, 3-0`

> "Packages that include functionality using third-party APIs clearly describe how the API keys are
> stored within the package. **Third-party API keys are not stored in ways that would incorporate the key
> into project builds** (for example, inside any script or GameObject that would be included in a scene)."

This is exactly what `SoulEngineConfig.asset` does today — a `ScriptableObject` carrying `LlmApiKey`,
`TtsApiKey`, `SttApiKey` that ships in the build. **The current Unity SDK would fail submission on this
clause.**

### §1.5.c — cost disclosure has a mandated *position* `high, 3-0`

> "Packages that interact with third-party APIs must have Terms of API usage and additional costs, if
> applicable, clearly and transparently portrayed **at the top of the listing's description** and in the
> documentation."

OpenAI / ElevenLabs / Deepgram metered costs must be front-loaded on the listing, not buried. The "if
applicable" qualifier attaches to cost disclosure and does not rescue a package whose runtime
necessarily incurs metered charges.

### §1.5.a — the executables ban, and a real risk to how the broker ships `high, 3-0 on the rule`

> "Until further notice, the Asset Store is not accepting any submissions that include executables (for
> example, .exe, .apk, or other executables), **embedded inside the package or as separate dependencies
> located on other websites**."

Present in near-identical wording since July 2023. No waiver process exists anywhere on the page.

**Two precision corrections the verifiers insisted on:**
1. This is *not* a DLL ban. The guidelines never mention DLLs, native plugins or precompiled assemblies,
   and the store hosts thousands of DLL-shipping assets (Odin Inspector, DOTween Pro). The stated
   examples are `.exe`/`.apk`.
2. Applying it to a *server-side* binary is a literal and defensible reading of "separate dependencies
   located on other websites", but **no enforcement precedent was found**, and the obvious remedy — ship
   the broker as source or as a documented external deployment — appears in no retrievable document.

> **Action:** ship the broker as **source** plus a documented deploy, never as a downloadable prebuilt
> binary referenced from the package.

### §1.5.d — Unity points this exact category at Verified Solutions `medium`

> "If you are an online service such as a monetization service, ad-network, back-end hosting service,
> analytics system, decentralization solution (including Web3 technology), **a SaaS platform (including
> SaaS-connected SDKs utilizing login walls or metered usage)**, or other service where a variable amount
> of money changes hands after the user downloads your SDK or plugin, **consider joining our Verified
> Solutions program**."

The verb is "consider", so on the face of the document this is not a gate. Whether Unity treats it as
one in practice is untested.

### The Provider Agreement is UNRESOLVED `low, both readings refuted 3-0`

Two opposing claims were submitted — one that §5.4.3 prohibits distributing an SDK that "enables the
delivery of services", one that no relevant clause exists — and **both were refuted unanimously**.
Retrieval was unreliable: `unity.com/legal/as-provider-agreement` returned 404 for one verifier while
`unity.com/legal/provider` returned 200 for others.

The only clause confirmed verbatim, twice, is **§4.3** (revenue share, below).

> **Action:** read the Provider Agreement end-to-end by hand before relying on any claim about it.
> Treat the Submission Guidelines as the operative rulebook in the meantime.

---

## Q4b — Entitlement verification: three platforms, three different answers

| Platform | Seller-facing entitlement API | Consequence |
|---|---|---|
| **Unity** | **Yes, sanctioned by name** — the Invoice API is named in §1.4.a as a permitted way to authorize users | Usable, but see gap below |
| **Fab (Epic)** | **None. Verified rigorously.** | All gating must be vendor-run |
| **Godot** | **None, and cannot exist** | All gating must be vendor-run |

**Unity — sanctioned, but undocumented in this pass `high, 3-0 on the permission`.** The guidelines
authorize the Invoice API's *use*. This pass retrieved **no primary documentation of the API itself** —
no endpoint, no auth requirements, no response shape, no statement of support or deprecation status. The
verifier was explicit that sanction is not evidence the endpoint is operational. **Unfilled gap, not a
negative finding.**

**Fab — none, and the absence was proved rather than assumed `high, 3-0`.** Epic's only documented
ownership-verification web API is EOS Ecom, which is (a) gated behind completing Epic Games Store
distribution onboarding and (b) scoped to a title checking a player's ownership inside the developer's
*own* EOS namespace. Verification method worth noting: `grep -i fab` over the full 487,415-byte raw page
returned **zero matches**; Epic's Web API index enumerates exactly 8 APIs and Ecom is the only
ownership-related one. **A Fab seller cannot verify that a developer bought their asset.**

**Godot — the store cannot sell anything yet `high, 3-0`.** From the 22 May 2026 launch announcement,
commerce is roadmap: "many more features are coming in the near future including the ability to buy and
sell assets." Verified still current as of 2026-09-05 by enumerating every blog post through 26 Aug.
The live store shows FREE labels, no prices, no cart, no checkout, and still says "The Asset Store is
being developed and is currently in beta." Submission docs require a FOSS licence file (GPL/MIT/BSD/
Boost-class), which is structurally inconsistent with a paid marketplace.

---

## Q5 — Revenue splits (the only pricing question answered)

| Platform | Split | Source |
|---|---|---|
| **Fab** | **88%** | Distribution Agreement §5(a), "Last updated: February 23rd, 2026" |
| **Unity** | **70%** | Provider Agreement §4.3 |

Unity §4.3 verbatim: *"…Unity will pay you seventy (70) percent of the sales price (less any refunds,
bank fees related to the transfer to you, and any applicable taxes)…"* — and Unity reserves the right to
vary this unilaterally.

A regex over the entire Fab agreement found **exactly one percentage** — no tiering, no volume
thresholds, no carve-outs. **Bases differ:** Fab's 88% applies to a figure already net of payment
processing and discounts, so the 18-point headline gap is not a straight comparison.

**Fab has no subscription or metering construct at all `medium, 2-1, corroborated by two Epic docs`.**
Licensing is a fixed two-tier one-time purchase (Personal / Professional), sold off a preset price ladder
capped at $1,500 without contacting support. A grep of the licensing page for
`subscription|recurring|metered|usage|SaaS|perpetual|service|server` returned **zero hits**. Tier is
buyer-determined by their own revenue, so a seller cannot invent one.

> **Consequence:** a service-dependent asset **cannot be monetised as a subscription inside Fab**. Any
> recurring revenue must run through your own billing, off-platform.

## Q7 — Licence enforcement

**Unity gives you nothing off-platform `high, 3-0`.** Their own support article (Last Updated 2025-08-06):

> "Unity Technologies cannot remove assets that have infringed copyright law unless the asset is being
> distributed on a Unity-owned website (the Asset Store, Forums, Answers, etc)."

You are directed to file your own DMCA takedowns, at your own cost. Unity acts off-platform only as
rights-holder of its *own* content.

**Ed25519 offline licences are productized, but not evidenced in games `high, 3-0 on the narrow claim`.**
Keygen ships `ED25519_SIGN` as an enumerated configuration and defaults to Ed25519 when no scheme is set,
calling it *"our recommended signing scheme, due to its smaller signature size and higher security level
when compared to 2048-bit RSA."* Three limits, stated by the verifiers:

1. Single-vendor evidence — proves the pattern is *purchasable*, not that it is *prevalent*.
2. **Zero** game, game-engine, or game-middleware guidance on that page.
3. **A companion claim that Keygen's examples embed the account public key client-side — the exact
   `D3` topology — was refuted 3-0.** The "no network call at validation time, public key in the client"
   detail is **not established by this pass.**

Nothing was retrieved about what defeats signed offline licences in practice.

---

## COVERAGE FAILURE — and its mechanical cause `finding 14`

Three sub-questions are **substantially un-researched**:

- **Q3 multi-engine architecture** — only Firebase surfaced (below), and its drift-control half was
  refuted. Nothing on Photon, PlayFab, RevenueCat, Wwise, FMOD, Steamworks.
- **Q5 comparable pricing** — nothing on what Convai, Inworld, or any Asset Store AI dialogue tool
  charges; no publisher post-mortems or revenue reports.
- **Q7 middleware practice** — nothing on what Wwise, FMOD, Havok, SpeedTree or Umbra actually enforce;
  no piracy-rate or support-cost data.

**Cause identified:** four separate verifiers independently reported *"the session's web search budget
(200/200) was exhausted"* before the vendor-survey queries ran. The pass converged on documentation
retrieval where direct URLs were known and never reached the survey questions.

> **Treat this as un-researched, not as absence of evidence.** Unlike the Fab and Godot absence findings
> above, nobody looked and failed here — the looking did not happen. Needs a **Pass D** with a fresh
> budget, targeting public repos (`photonengine`, PlayFab SDKs, `RevenueCat/purchases-unity`,
> AudioKinetic and FMOD integration layers, `Steamworks.NET`) and vendor pricing pages **by direct URL
> rather than by search**.

### The one Q3 datapoint that did survive

**Firebase Unity is SWIG-generated C# bindings over the shared C++ SDK `medium, 2-1`** — the Unity
build's `CMakeLists.txt` literally compiles the C++ SDK tree into itself (`add_subdirectory(${FIREBASE_CPP_SDK_DIR})`),
requires "Swig, version 4 or newer", and carries `swig_post_process.py` and friends at the repo root.
**But the newest module, `firebaseai`, is 28 pure `.cs` files with zero SWIG and zero C++ — an
independent managed implementation.** So the shared-core pattern is not universal, and the recent trend
runs the other way. Two details of the original claim were corrected: `/proxy` is assembly-metadata
templating, not marshalling (do not cite it), and the drift-control half was refuted.

---

## What this changes

| PRODUCT.md | Effect |
|---|---|
| §3.3 **Option B** | **Independently mandated by Unity §1.5.b**, not merely permitted. The decision is now over-determined: security *and* store compliance point the same way. |
| §1.4 blocker table | **New blocker.** `SoulEngineConfig.asset` shipping `LlmApiKey`/`TtsApiKey`/`SttApiKey` in the build violates §1.5.b. This is a submission-blocking defect, not just a design smell. |
| §4 **W2b** (build the broker) | **Add a constraint:** ship as source + documented deploy, never a prebuilt binary referenced from the package (§1.5.a risk). |
| §4 — new listing requirements | §1.5.c forces third-party API terms and costs to the **top** of the store listing; §1.4.a requires account/subscription disclosure in description *and* documentation. |
| `D5` entitlement source | **Partly answered.** Unity's Invoice API is sanctioned by name but undocumented here. Fab and Godot have **no** seller entitlement API — vendor-run gating is the only option there. Fab additionally cannot host a subscription at all. |
| `D3` signed offline licence | **Still unvalidated for games.** Productized commercially (Keygen), but zero game-middleware evidence, and the client-embedded-public-key detail was specifically refuted. |
| Revenue planning | Fab 88% vs Unity 70%, different bases. Fab cannot carry recurring revenue — that must be your own billing. |
| New action | Read the Unity Provider Agreement end-to-end by hand; this pass could not resolve it. |
| New action | **Pass D** for the three un-researched sub-questions, by direct URL rather than search. |

## Primary sources

- Unity Submission Guidelines (2026-05-20): https://assetstore.unity.com/publishing/submission-guidelines · mirror: https://docs.unity.cn/cn/tuanjiemanual/Manual/SubmissionGuidelinesEn.html
- Unity Provider Agreement §4.3: https://unity.com/legal/provider
- Unity piracy support article: https://support.unity.com/hc/en-us/articles/209995806-My-asset-is-being-pirated-how-can-I-get-the-download-removed-
- Fab Distribution Agreement §5(a) (2026-02-23): https://www.fab.com/distribution-agreement
- Fab licensing and pricing: https://dev.epicgames.com/documentation/en-us/fab/licenses-and-pricing-in-fab
- EOS Ecom Web API: https://dev.epicgames.com/docs/web-api-ref/ecom-web-apis
- Godot Asset Store launch: https://godotengine.org/article/introducing-the-godot-asset-store/
- Keygen offline licences: https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/
- Firebase Unity SDK: https://github.com/firebase/firebase-unity-sdk
