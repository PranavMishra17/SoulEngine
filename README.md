# SoulEngine

Memory-driven NPCs for games. Stateless NPC intelligence with layered memory cycles, personality evolution, voice interaction, and MCP-based agency.

## Core Concept

NPCs are JSON files that become intelligent when queried against an LLM. No persistent processes, no complex databases. Characters remember interactions, evolve personalities, speak with their own voices, and take actions in the game world via MCP tools.

### The Five Pillars

| Pillar | Purpose |
|--------|---------|
| **Core Anchor** | Immutable psychological DNA - backstory, principles, trauma flags |
| **Daily Pulse** | Short-term emotional state and daily takeaway |
| **Weekly Whisper** | Cyclic memory pruning, retains only salient events |
| **Persona Shift** | Periodic personality recalibration within bounded limits |
| **MCP Actions** | Tool invocation for world actions (call_police, refuse_service, flee, etc.) |

## Project Structure

```
src/
├── index.ts              # Server entry point
├── config.ts             # Environment configuration
├── logger.ts             # Pino logger setup
├── types/                # TypeScript interfaces
├── security/             # Sanitizer, moderator, rate limiter, anchor guard
├── providers/
│   ├── llm/              # Gemini LLM provider
│   ├── stt/              # Deepgram speech-to-text
│   └── tts/              # Cartesia/ElevenLabs text-to-speech
├── storage/              # File-based YAML storage (projects, NPCs, knowledge, instances)
├── core/                 # NPC cognition (memory, personality, cycles, context assembly)
├── session/              # In-memory session store and lifecycle
├── mcp/                  # Tool registry, validator, exit handler
├── voice/                # Audio pipeline, sentence detection, interruption handling
├── routes/               # REST API endpoints
└── ws/                   # WebSocket voice handler

web/                      # Test UI (vanilla JS SPA)
├── index.html            # SPA shell with templates
├── css/                  # Design system, components, pages
└── js/                   # Router, API client, page modules

data/                     # Runtime storage (gitignored)
└── projects/             # Project folders with NPCs, knowledge, instances
```

## Quick Start

```bash
# Install dependencies
npm install

# Set API keys
export GEMINI_API_KEY=your-key
export DEEPGRAM_API_KEY=your-key      # For voice
export CARTESIA_API_KEY=your-key      # For voice

# Run dev server
npm run dev
```

Open http://localhost:3000

## API Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects` | GET/POST | List/create projects |
| `/api/projects/:id` | GET/PUT/DELETE | Project CRUD |
| `/api/projects/:id/npcs` | GET/POST | List/create NPC definitions |
| `/api/projects/:id/npcs/:npcId` | GET/PUT/DELETE | NPC definition CRUD |
| `/api/projects/:id/knowledge` | GET/POST | List/create knowledge categories |
| `/api/session/start` | POST | Start conversation session |
| `/api/session/:id/message` | POST | Send message (streaming response) |
| `/api/session/:id/end` | POST | End session, persist state |
| `/api/instances/:id/daily` | POST | Run Daily Pulse cycle |
| `/api/instances/:id/weekly` | POST | Run Weekly Whisper cycle |
| `/api/instances/:id/persona` | POST | Run Persona Shift cycle |

WebSocket: `ws://localhost:3001/ws/voice?session_id=xxx`

## Documentation

- [System Design](Evolve_NPC_System_Design.md) - Full architecture and design choices
- [SDK Used](SDK_REFERENCE.md) - Technical reference for 3rd party SDKs

## Tech Stack

- **Runtime**: Node.js + tsx
- **HTTP**: Hono
- **LLM**: Google Gemini
- **STT**: Deepgram
- **TTS**: Cartesia / ElevenLabs
- **Storage**: YAML files
- **Frontend**: Vanilla JS SPA

## License

ISC
