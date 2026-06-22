# SoulEngine — Hard UI/UX Audit (Web Authoring App)

> Date: 2026-06-21 · Method: the app was run locally (`npm run dev`, local-mode, no Supabase) and **every page was driven in a headless browser** (Preview MCP). Findings are grounded in the **live DOM, computed styles, accessibility tree, console, and network** of the running app — not static code reading.
>
> **Screenshot note:** the sandbox's headless renderer could not produce image captures (every `screenshot` call timed out at 30s while DOM/eval/inspect/network all worked). The audit therefore uses live DOM + computed-style + a11y-tree inspection, which is *higher fidelity than screenshots for color/spacing/typography/state* (and is what this skill recommends). If you want pixel captures, run `npm run dev` and open the routes listed below; the findings will match.

---

## Summary

**Pages reviewed:** 8 (landing, projects, dashboard, NPC editor, playground, knowledge, MCP tools, settings) · **Live bugs found:** 4 (2 are HTTP 500s) · **Overall UX score:** **42/100**

The visual *foundation* is genuinely good — a committed dark theme (`#0d0d0d` bg, warm off-white `#f5f0eb` text), a distinctive type pairing (**DM Sans** body / **JetBrains Mono** accents), and a geometric-glyph motif (◇ ◈ ◔ ◑ ◗ ⬣ ⬢ ◉). What drags the score down is **information architecture and workflow**: there is no app shell, the marketing header is reused inside the app, a single NPC is authored across **9 tabs and ~91 controls**, the playground shows **8 panels at once**, two endpoints **500 and break whole pages**, and accessibility (focus, ARIA tabs, contrast) is largely absent. The instinct to rewrite the authoring flow (Tier 3) is correct; the design system underneath is worth keeping.

| Dimension | Score | Note |
|---|---|---|
| Visual identity / theme | 7/10 | Strong dark theme, good type pairing, consistent accent |
| Information architecture | 3/10 | 9-tab editor, 8-panel playground, no app shell, dashboard is a dumping ground |
| Workflow / friction | 3/10 | Circular dependencies, no guided path, raw JSON surfaced to newcomers |
| Robustness (live) | 3/10 | 2× 500s break Settings/Playground/Voice; errors not handled gracefully |
| Accessibility | 2/10 | No ARIA tabs, no component focus states, contrast + emoji-in-UI issues |
| Consistency / polish | 4/10 | Breadcrumb resolves project name on some pages but not others; emoji mixed with glyph system; raw ids shown |

---

## Live runtime bugs (found by driving the app)

| # | Severity | Bug | Evidence | Fix |
|---|---|---|---|---|
| L1 | **P0** | `GET /api/projects/:id/keys` returns **500** → Settings page and Playground pre-flight both break | server log: `secrets-storage … Decryption failed: authentication tag mismatch`; console: `Failed to get API keys status` (×4) | Key-status read must **degrade gracefully**: on decrypt failure return a recoverable state (`{ configured: true, readable: false, reason: "encryption_key_changed" }`) and have the UI prompt "re-enter keys", never 500. (Decrypt failure happens whenever `ENCRYPTION_KEY` differs from what sealed the data — exactly the ERR-006 family on the read path.) |
| L2 | **P1** | `GET /api/projects/:id/voices?provider=cartesia` returns **500** → NPC editor **Voice tab** breaks | server log: `routes-projects … Failed to fetch voices … Decryption failed` | Voice listing must degrade: with no/unreadable provider key, return an empty list + a "configure a TTS key" prompt, not 500. |
| L3 | **P2** | Header shows **"Sign In" and "Sign Out" + a user avatar simultaneously** in local mode | projects page button scan: `["Sign In","U…","Sign Out", …]` | Auth controls must reflect a single coherent state; in local/no-auth mode, hide auth entirely or show one clear state. |
| L4 | **P2** | Breadcrumb middle crumb is **inconsistent**: "Projects / **BLAST** / Settings" on Settings, but "Projects / **Project** / Knowledge Base" on Knowledge/MCP/Playground | live breadcrumb text per page | Resolve the project name once (app shell) and reuse; never render the literal word "Project". |

*L1/L2 were triggered in this run by a key mismatch on pre-existing data, but the **graceful-degradation gap is real**: a fresh project with no TTS key still 500s `/voices`, and any `ENCRYPTION_KEY` change bricks Settings + Playground.*

---

## Cross-cutting UI/UX findings

- **[P1] No app shell / in-app navigation.** Inside the app the **marketing header is reused** (`SoulEngine · GitHub · Sponsor Me · My Projects`) — there is no project switcher, no section nav, and GitHub/Sponsor links sit in the authoring context. Every section is reached by going back to the dashboard hub. A real product needs a persistent app chrome (project context + section nav).
- **[P1] The dashboard is a dumping ground.** One screen stacks **8+ sections**: NPCs, World Knowledge, MCP Tools, Starter Packs, Usage & Transcripts, Recent Conversations, Project Structure, Version Details. No hierarchy of importance; the primary action ("talk to an NPC") competes with version metadata.
- **[P1] NPC editor density.** A single NPC is authored across **9 tabs** and **~91 controls** (33 inputs, 15 range sliders, 5 selects, 2 textareas, 36 buttons). The tabs carry no ARIA semantics (`.editor-nav-item`, not `role=tab`/`tablist` — confirmed `role_tablist: 0`).
- **[P1] Playground over-paneling.** At idle, before a session even starts, the playground renders **NPC Info, NPC State, Memory Cycles, World Context, Project, NPC Roster, Knowledge Tiers, MCP Tools** simultaneously (15 headings, 5+ panels), plus a 2×2 input/output mode matrix. Cognitive overload for "send one message."
- **[P1] Circular authoring dependencies (workflow).** To set an NPC's Knowledge Access you must first leave the editor and create categories on the Knowledge page; same for MCP Tools and Network (other NPCs must exist). The editor assumes the rest of the project is already built; there is no "create the dependency inline" path.
- **[P2] Power-user surfaces shown to newcomers.** `{ } Edit JSON` (raw JSON editing) sits in the primary toolbar of Knowledge, MCP Tools, and the editor — first-time users see raw JSON next to "Add New".
- **[P2] Duplicated CRUD chrome.** Knowledge and MCP Tools are structurally near-identical (`Edit JSON / Template / Import / Export / + Add New` + row cards with ✎/✕) — the same pattern re-implemented per page rather than one shared collection component.
- **[P2] Emoji in the UI, mixed with the glyph system.** Tabs use geometric glyphs (◇◈◔◑◗⬣⬢◉) **except** `🔊 Voice` (emoji); Settings tabs use `⚙`/`🔑` emojis. This is visually inconsistent and violates the project's own "no emojis in UI" rule (CLAUDE.md).
- **[P2] Raw identifiers leak into the UI.** The projects list shows the full `proj_mjxnqpq3_njvz3n` on the card; the dashboard masks it to `proj_mjx****`. Pick one (masked + copy button) and be consistent.
- **[P2] Accessibility gaps (confirmed live).** No `role=tablist`/`tab`/`aria-selected` on any of the 4 tab systems; inputs/sliders rely on visual labels only; no component-level `:focus-visible` (single global outline); `--color-text-tertiary` (#6b6560) on `#0d0d0d` ≈ 3.6:1 (fails WCAG AA for normal text); 9-10px labels exist. No `prefers-reduced-motion` despite the animated landing canvas.
- **[P3] `href="#"` buttons-as-links** on the dashboard (NPCs / World Knowledge / MCP Tools / Open Playground are `<a href="#">` acting as buttons) — keyboard/semantics smell.
- **[P3] Landing page animation cost.** The landing brain canvas + particle field run continuous `requestAnimationFrame` loops (heavy enough to stall a headless renderer); needs a reduced-motion guard and lifecycle cleanup on navigation.

---

## Per-page notes

- **Landing (`/`)** — Strong hero identity (DM Sans, ember accent, brain canvas). Heavy continuous animation; CTAs lead into an app that has no shell. Marketing and app share one header.
- **Projects (`/projects`)** — Clean card grid; but full raw project id on the card, Sign In/Sign Out coexist, no empty-state guidance for a first-time user.
- **Dashboard (`/projects/:id`)** — The real hub, but overloaded (8+ sections). API-key gating works ("Add at least one LLM key … before testing"). Buttons-as-`#`-links.
- **NPC editor (`/projects/:id/npcs/:id`)** — 9 tabs, ~91 controls, no ARIA tabs, emoji in one tab. Voice tab 500s with no readable TTS key (L2). History tab carries the diff-modal binding bug from the code audit (ERR-015).
- **Playground (`/projects/:id/playground`)** — 8 panels at idle + 2×2 mode matrix; "Project" breadcrumb bug; key-status pre-flight 500 (L1).
- **Knowledge (`/projects/:id/knowledge`)** — `Edit JSON/Template/Import/Export` toolbar; category cards with ✕; raw JSON prominent.
- **MCP Tools (`/projects/:id/mcp-tools`)** — Structurally identical to Knowledge (24 visible controls); same toolbar duplication.
- **Settings (`/projects/:id/settings`)** — 2 tabs (Project / API Keys) with emoji icons; provider selects; key-status 500 (L1) prevents showing what's configured.

---

## Authoring Workflow Map (reusable — re-run this exact script for the round-2 re-audit)

These are the core jobs-to-be-done. Each step lists the **friction** observed. After the Tier 3 fixes land, walk these same steps again and confirm the friction is gone.

### W1 — First-time: "I have nothing; get me an NPC I can talk to"
1. Land on `/` → click a CTA. **Friction:** CTA drops into an app with no shell; unclear where "create" is.
2. `/projects` → "+ New Project". **Friction:** no template/starter prompt at creation; blank project.
3. Dashboard → find "NPCs" → create NPC. **Friction:** lands in a blank 9-tab, ~91-control editor with no guidance; no "generate with AI" first step surfaced.
4. Try to talk → Playground. **Friction:** blocked by "no API keys"; must detour to Settings; Settings page itself 500s on key-status (L1).
**Target:** project → talking NPC in **under 60s** with sensible defaults + AI seeding.

### W2 — "Author an NPC's personality & voice"
1. Editor → Personality (6 sliders + preset) → Voice. **Friction:** Voice tab 500s without a readable TTS key (L2); raw Big-Five sliders with no archetype-first path; "Memory Retention" slider hides an inverted salience value.
**Target:** preset-card first, sliders behind "fine-tune"; voice picker degrades gracefully and previews.

### W3 — "Give the NPC knowledge + tools + relationships"
1. Editor → Knowledge Access (depth tiers). **Friction:** meaningless until categories exist on the **Knowledge page** — must leave the editor (circular dependency).
2. Editor → MCP Tools. **Friction:** must first define tools on the **MCP Tools page**.
3. Editor → Network. **Friction:** needs other NPCs to exist first.
**Target:** create-the-dependency **inline** from the editor; no cross-page round-trips.

### W4 — "Test a conversation"
1. Playground → pick NPC → choose mode (2×2) → Player Identity → Start. **Friction:** 8 panels compete with the chat; mode matrix is four buttons for one concept; pre-flight 500 (L1).
**Target:** one chat column by default; state/cycles/world-context in a single collapsible drawer; voice unlocked on demand.

### W5 — "Configure providers / API keys"
1. Settings → API Keys. **Friction:** key-status 500 (L1) means you can't see what's set; emoji tab icons; no per-provider "test key" affordance.
**Target:** clear per-provider status (set/unset/unreadable), test button, graceful decrypt-failure recovery.

### W6 — "Iterate / roll back an NPC"
1. Editor → History (definition + mind-state snapshots, diff, revert). **Friction:** diff-modal buttons not bound (ERR-015); history is a 10th concern bolted onto the editor.
**Target:** versioning as a top-bar action with a reliable diff/revert, not an editor tab.

---

## Priority actions (before the full rewrite)

1. **Fix the two 500s (L1, L2)** — graceful degradation for unreadable secrets and missing provider keys. These break core pages today.
2. **Fix breadcrumb name resolution + auth-state coherence (L3, L4)** — cheap, high-visibility polish.
3. **Commit to the Tier 3 rewrite** of the authoring flow (see [`specs/tier-3-authoring-studio.md`](specs/tier-3-authoring-studio.md)) — app shell, guided NPC creation, collapsed playground, inline dependencies — on top of the existing (good) design tokens.
