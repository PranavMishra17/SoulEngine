# Tier 3 — Frontend / UX Rewrite: the SoulEngine Authoring Studio

> Status: **PLAN — awaiting goahead** (do not build yet). Grounded in [`../UI-AUDIT.md`](../UI-AUDIT.md) (live audit + workflow map). Verdict from the code audit stands: **rewrite the JS/UX layer, keep the design tokens.**

---

## 1. Design direction — "The Instrument Panel"

The app authors *living minds*. The existing identity already leans the right way: a near-black canvas, warm off-white ink, a single ember accent, monospace for data, and a geometric-glyph motif. We formalize this into one committed aesthetic: **a calm, high-contrast control room for cognition** — instrument-panel, not dashboard-template; precise, dark, typographic, with the ember accent reserved for *state and action*, not decoration.

- **Keep & systematize the tokens** (already good): `--color-bg #0d0d0d`, surfaces, warm ink `#f5f0eb`, ember accent, **DM Sans** (UI) + **JetBrains Mono** (ids, numbers, state) + a distinctive **display face for screen titles** (e.g. a characterful grotesk/serif — pick one, not Inter/Space Grotesk). Add the missing `--accent-primary-rgb` and kill the phantom tokens (already fixed in Tier 0).
- **One glyph language.** Replace the lone `🔊`/`⚙`/`🔑` emojis with the geometric set (or a single line-icon set). No emoji in the product UI (CLAUDE.md).
- **Accent discipline.** Ember = the live/active/destructive signal (recording, unsaved, mood, danger). Everything else is ink-on-graphite. Dominant neutral + sharp accent beats evenly-distributed color.
- **Motion with restraint.** One orchestrated screen-load stagger; state transitions (mood, recording, thinking) animated; everything behind `prefers-reduced-motion`. Retire the always-on landing canvas loop inside the app.

Avoid the generic: no Inter/Roboto, no purple-on-white, no card-grid-template sameness. The memorable thing is the **"NPC as a living instrument you tune and talk to,"** not another CRUD dashboard.

---

## 2. Keep / Rebuild / Kill

| Keep (harden) | Rebuild (new IA + components) | Kill |
|---|---|---|
| `design-system.css` tokens + `components.css` primitives | The 9-tab NPC editor → guided 3-stage creation + advanced drawer | The reused marketing header inside the app |
| The API client contract (`api.js`) + `VoiceClient` WS protocol (the SDK-facing surface) | The 8-panel playground → one chat column + one drawer | `{ }Edit JSON` as a primary newcomer surface (move to "Advanced") |
| Dark/ember identity, type pairing | Knowledge + MCP Tools → one shared "Collection" component | Duplicated per-page CRUD chrome |
| Versioning/diff/rollback feature | Dashboard → real app shell + focused project home | `href="#"` buttons-as-links; DOM-as-state patterns |

---

## 3. New information architecture

**App shell (persistent):** left rail or top bar with **project switcher**, the project name (resolved once — kills the "Project" breadcrumb bug), and section nav: **Home · NPCs · Knowledge · Tools · Playground · Settings**. Versioning is a top-bar action, not a tab. Marketing nav (GitHub/Sponsor) lives only on `/` (logged-out/landing).

**Screens:**
- **Project Home** — focused: "Talk to an NPC" primary, NPC roster, a setup checklist (keys, first NPC), recent conversations. Usage/version metadata demoted to a collapsible "Project details".
- **NPC Studio** (replaces the 9-tab editor) — guided, see §4.
- **Collections** (Knowledge, Tools) — one shared component; raw JSON behind "Advanced".
- **Playground** — one chat column + one right drawer (see §5).
- **Settings** — provider status that degrades gracefully (fixes L1).

---

## 4. NPC Studio — guided creation (the core of the rewrite)

Collapse 9 tabs / ~91 controls into **3 stages + an Advanced drawer**, mapping the old tabs:

| Stage | Absorbs | First-run default |
|---|---|---|
| **1. Identity** (only required step) | Basic Info + Core Anchor | Name + one-line concept + **"Generate personality & backstory with AI"** that fills Anchor *and* Big Five. |
| **2. Personality & Voice** | Personality + Voice | **8 archetype preset cards** set the 5 sliders; sliders behind "Fine-tune". Voice = one picker + Preview, **degrades gracefully** if no TTS key (fixes L2). "Memory Retention" shown as 3 named presets (Forgetful/Normal/Sharp), not a raw inverted slider. |
| **3. Knowledge & Behavior** | Knowledge Access + MCP Tools + Network | Empty by default; **create the dependency inline** (add a knowledge category / tool / relationship without leaving Studio — kills the W3 circular dependency). Sensible defaults: knows nothing special, only `exit_convo`, no relationships. |
| **Advanced drawer** (off) | Schedule & State, trauma flags, raw memory threshold, raw JSON | Hidden until asked. |
| **History** | (was tab 9) | Moves to a top-bar "Version history" action with reliable diff/revert (fixes ERR-015). |

**The 60-second path (W1 target):** New project → "Create NPC" → Identity → "Generate with AI" → land in a **Playground preview already talking**, with Personality/Voice/Knowledge as optional "customize" chips. The user talks to an NPC before ever seeing a slider.

---

## 5. Playground redesign

- **Default:** one **text** chat column. No 2×2 matrix up front — a single "mode" control; **Voice** unlocks VAD + pipeline trace on demand.
- **One right drawer**, one panel visible at a time: **NPC State · Memory Cycles · World Context · Mind**. Not 8 simultaneous panels.
- Pre-flight key check must not 500 (fixes L1); show a single clear "add a key" affordance if ungated.
- Use the published `audio_format` + `protocol_version` from the WS `ready` handshake (Tier 2.8) instead of hardcoding rates.

---

## 6. Foundations (apply across the rewrite)

- **One component each:** `Tabs` (real ARIA `tablist`/`tab`/`tabpanel` + arrow keys), `Collection` (cards + add/edit/delete + import/export/JSON-in-advanced), `Slider`, `Card`, `Modal` (focus trap), `Toast`, `Drawer`, `StatusPill`. Delete the 4 parallel tab systems and duplicated cards/chips.
- **Accessibility baseline:** component-level `:focus-visible` everywhere; ARIA tab pattern; lift `--color-text-tertiary/-muted` to ≥4.5:1; min 12px body text; `prefers-reduced-motion`; 44px targets.
- **Responsive:** an actual <1024px story (rail collapses to a top bar/drawer; Studio stages stack; Playground drawer becomes a sheet). Standardize to 3-4 named breakpoints.
- **State + data:** stop using the DOM as state. Introduce a tiny reactive layer (a ~50-line signal/store, or a small lib like Preact/Alpine — decision in 3.0), an API-client cache with invalidation, and a router with **teardown hooks** (fixes the landing animation/listener leaks). Tolerate the new `{items,pagination}` list shape everywhere (Tier 2.11 did projects; generalize).
- **Reuse, don't re-implement:** one `utils.js` (`escapeHtml`, `resolveAvatarUrl`, `downloadJson`, `importJsonFile`) — removes the 7×/5×/3× duplication the code audit found.

---

## 7. Tech approach

The code audit recommends rewriting the JS layer; the tokens/components CSS stays. Two viable paths — **decide in phase 3.0**:
- **(A) Minimal-deps reactive vanilla** — a tiny signals/store + a `renderList`/`renderState` helper + the existing ES-module setup. Keeps "no build step," lowest risk, matches current deploy.
- **(B) Lightweight framework** (Preact + Vite, or Alpine) — better ergonomics for the Studio's stateful forms, costs a build step.
Recommendation: **(A)** unless the Studio's form state proves too heavy in the 3.1 spike, then (B). Either way, the API client + WS protocol are preserved as the stable contract.

---

## 8. Iteration plan (phased — supersedes the old Tier 3 rows)

Each phase is independently shippable and testable; run as Sonnet feature agents under the usual SDD loop.

| Phase | Deliverable | Dep | Test |
|---|---|---|---|
| **3.0** | Decide tech (A/B) via a 1-screen spike; lock tokens; extract `utils.js`; add router teardown | — | unit |
| **3.1** | **App shell** (project switcher, section nav, resolved project name) + kill marketing header in-app | 3.0 | e2e + manual |
| **3.2** | Shared **components** (ARIA Tabs, Collection, Modal/focus-trap, Drawer, StatusPill, Slider) | 3.0 | unit + manual(a11y) |
| **3.3** | **Settings** rebuild with graceful key-status (fixes L1) + per-provider test/status | 3.2 | reg(e2e) |
| **3.4** | **Collections** (Knowledge + Tools on one component; JSON→Advanced) | 3.2 | e2e |
| **3.5** | **NPC Studio** — 3-stage guided creation + Advanced drawer + AI-seed + inline dependencies | 3.2, 3.4 | e2e + manual |
| **3.6** | **Playground** — one column + one drawer; voice on demand; uses WS `audio_format`; no 500 pre-flight (L2 graceful) | 3.2, 3.3 | e2e + manual |
| **3.7** | **Project Home** + first-run checklist + 60-second path; **Version history** as top-bar action (fixes ERR-015) | 3.1, 3.5 | e2e |
| **3.8** | **Accessibility + responsive** pass across the studio; `prefers-reduced-motion`; <1024px | 3.1-3.7 | manual(a11y) |

Note: **L1/L2 graceful-degradation** (the two 500s) should be hot-fixed in the backend *before or alongside* 3.3/3.6 — they're small and break core pages today; file them as immediate items (candidates for Tier 2.x or a quick fix batch).

---

## 9. Round-2 validation

When the phases land, **re-run the exact workflow map** in [`../UI-AUDIT.md`](../UI-AUDIT.md) (W1-W6) against the live app and confirm each friction point is resolved, plus:
- W1 reaches a talking NPC in <60s.
- No page issues a 500 in local mode (Settings/Playground/Voice load with or without keys).
- Breadcrumb/app-shell always shows the real project name; no emoji in UI; one tab system with ARIA; component focus-visible present; text contrast ≥4.5:1; works at 375px and 1024px.
- The same audit probes (control counts, panel counts) show the Studio ≤ ~3 stages and the Playground ≤ 1 visible panel + drawer.

---

## Open questions (for goahead)
1. Tech path A (minimal vanilla) vs B (Preact/Vite) — OK to decide at the 3.0 spike?
2. Is the "Instrument Panel" dark/ember direction the one to commit to, or do you want to explore an alternative aesthetic first?
3. Should L1/L2 (the two 500s) be hot-fixed now as a tiny backend batch, or folded into 3.3/3.6?
