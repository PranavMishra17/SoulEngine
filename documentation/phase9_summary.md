# Phase 9: Web Test UI - File Summary

## Server Entry Point

| File | Role |
|------|------|
| `src/index.ts` | HTTP server (Hono + Node adapter), static file serving, WebSocket setup |

## Web Frontend

### Core

| File | Role |
|------|------|
| `web/index.html` | SPA shell with `<template>` elements for each page |
| `web/js/app.js` | Entry point, router init, theme toggle, global error handlers |
| `web/js/router.js` | Hash-free client-side router with param extraction |
| `web/js/api.js` | REST API client + `VoiceClient` WebSocket class |
| `web/js/components.js` | Shared UI: `toast`, `modal`, `dropdown`, `tabs` |

### Pages

| File | Role |
|------|------|
| `web/js/pages/landing.js` | Marketing/hero page |
| `web/js/pages/projects.js` | Project CRUD list |
| `web/js/pages/dashboard.js` | Project overview with NPC/knowledge counts |
| `web/js/pages/npc-editor.js` | NPC list + full definition editor (Five Pillars preview) |
| `web/js/pages/knowledge.js` | Category/document editor with depth tiers |
| `web/js/pages/playground.js` | Text/voice chat, session management, X-ray panel |

### Styles

| File | Role |
|------|------|
| `web/css/design-system.css` | CSS variables, dark/light themes, base typography |
| `web/css/components.css` | Button, card, form, modal styles |
| `web/css/pages.css` | Page-specific layouts |

## Data Flow

```
Browser                    Server (port 3000)           WebSocket (port 3001)
   │                              │                            │
   ├─ GET /api/projects ─────────►│                            │
   │◄──────── JSON ───────────────┤                            │
   │                              │                            │
   ├─ POST /api/session/start ───►│                            │
   │◄──────── session_id ─────────┤                            │
   │                              │                            │
   ├─ ws://host:3001/ws/voice ───────────────────────────────►│
   │◄─────────── ready ───────────────────────────────────────┤
   │──────────── audio (base64) ─────────────────────────────►│
   │◄─────────── transcript/audio_chunk ─────────────────────┤
```

## Key Patterns

- **Template-based rendering**: Each page clones from `<template id="*-template">`
- **Event delegation**: Containers handle clicks via `data-action` attributes
- **State in closure**: Page modules use local variables, no global state
- **WebSocket reconnect**: `VoiceClient` auto-reconnects on disconnect

## Environment Variables

```bash
GEMINI_API_KEY      # Required for LLM/conversation
DEEPGRAM_API_KEY    # Required for voice STT
CARTESIA_API_KEY    # Required for voice TTS
ELEVENLABS_API_KEY  # Alternative TTS provider
```

Without these, the server starts but returns 503 for session/voice endpoints.
