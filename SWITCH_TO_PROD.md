# SoulEngine: Production Deployment Guide

Migration plan from local file storage to **Render + Supabase** production deployment.

> **Why Render?** Unlike Vercel's serverless functions (30-second timeout), Render runs persistent Node.js servers with **no WebSocket time limits** - perfect for voice conversations.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PRODUCTION                                      │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         RENDER                                       │   │
│   │              (Persistent Node.js Server)                            │   │
│   │                                                                     │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │                  Your Hono Server                           │   │   │
│   │   │                                                             │   │   │
│   │   │   REST API ────────── /api/projects, /api/npcs, etc.       │   │   │
│   │   │   WebSocket ───────── /ws/voice (NO TIME LIMIT!)           │   │   │
│   │   │   Static Files ────── /web/*                               │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    │ PostgreSQL + Storage                   │
│                                    ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         SUPABASE                                    │   │
│   │                                                                     │   │
│   │   Database ──────── Projects, NPCs, Instances, Knowledge, Tools    │   │
│   │   Auth ──────────── Google OAuth, JWT tokens                       │   │
│   │   Storage ───────── NPC profile images                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites Checklist

Complete these before starting implementation:

### 1. Supabase Setup
- [ ] Create Supabase project at [supabase.com](https://supabase.com)
- [ ] Note down: **Project URL**, **Anon Key**, **Service Role Key**
- [ ] Keep SQL Editor open for running migrations

### 2. Google Cloud Setup (OAuth)
- [ ] Create Google Cloud project at [console.cloud.google.com](https://console.cloud.google.com)
- [ ] Go to **APIs & Services → Credentials**
- [ ] Create **OAuth 2.0 Client ID** (Web application)
- [ ] Add authorized redirect URI:
  ```
  https://<your-supabase-project>.supabase.co/auth/v1/callback
  ```
- [ ] Note down: **Client ID**, **Client Secret**

### 3. Supabase Auth Configuration
- [ ] Go to Supabase Dashboard → **Authentication → Providers**
- [ ] Enable **Google** provider
- [ ] Enter Google Client ID and Client Secret
- [ ] Go to **Authentication → URL Configuration**
- [ ] Set **Site URL** to your Render domain (e.g., `https://soulengine.onrender.com`)

### 4. Render Setup
- [ ] Create account at [render.com](https://render.com)
- [ ] Connect GitHub repository
- [ ] Have environment variables ready (see below)

### 5. Local Development
- [ ] Install dependencies: `npm install @supabase/supabase-js`

---

## Database Schema

Run these SQL files in order in **Supabase SQL Editor**:

### Step 1: Create Tables

📄 **[sql/01-schema.sql](sql/01-schema.sql)**

Creates all tables:
- `profiles` - User profiles (extends Supabase auth)
- `projects` - User projects with settings
- `project_secrets` - Encrypted API keys
- `npc_definitions` - NPC static data
- `npc_instances` - NPC runtime state
- `npc_instance_history` - State versioning
- `knowledge_categories` - World knowledge
- `mcp_tools` - Tool definitions

### Step 2: Enable Row Level Security

📄 **[sql/02-rls-policies.sql](sql/02-rls-policies.sql)**

Adds RLS policies ensuring users can only access their own data.

### Step 3: Setup Storage Bucket

📄 **[sql/03-storage.sql](sql/03-storage.sql)**

Creates `npc-images` bucket for profile pictures.

---

## Environment Variables

### Render Environment Variables

Set these in Render Dashboard → Your Service → Environment:

```bash
# ============================================
# SUPABASE
# ============================================
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ============================================
# LLM PROVIDERS (Fallback/default keys)
# ============================================
GEMINI_API_KEY=AIza...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROK_API_KEY=xai-...

# ============================================
# VOICE PROVIDERS
# ============================================
DEEPGRAM_API_KEY=...
CARTESIA_API_KEY=...
ELEVENLABS_API_KEY=...

# ============================================
# APP CONFIG
# ============================================
DEFAULT_LLM_PROVIDER=gemini
NODE_ENV=production
PORT=10000
```

> **Note:** Render uses port 10000 by default. Your app should read `process.env.PORT`.

---

## Storage Layer Refactor

### New Directory Structure

```
src/storage/
├── interface.ts              # Existing - no changes
├── supabase/
│   ├── client.ts             # Supabase client initialization
│   ├── projects.ts           # Projects CRUD
│   ├── definitions.ts        # NPC definitions CRUD
│   ├── instances.ts          # NPC instances CRUD
│   ├── knowledge.ts          # Knowledge categories CRUD
│   ├── mcp-tools.ts          # MCP tools CRUD
│   ├── secrets.ts            # Encrypted API keys
│   └── images.ts             # Storage bucket operations
├── local/                    # Move existing files here
│   ├── projects.ts
│   ├── definitions.ts
│   ├── instances.ts
│   └── ...
└── index.ts                  # Export based on NODE_ENV
```

### Supabase Client (`src/storage/supabase/client.ts`)

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-side client with service role (bypasses RLS)
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

// For operations that should respect RLS (pass user's JWT)
export function createUserClient(accessToken: string) {
  return createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}
```

### Storage Switcher (`src/storage/index.ts`)

```typescript
const isProduction = process.env.NODE_ENV === 'production';

// Dynamic imports based on environment
export const storage = isProduction
  ? await import('./supabase/index.js')
  : await import('./local/index.js');
```

---

## Authentication Middleware

### Auth Middleware (`src/middleware/auth.ts`)

```typescript
import { Context, Next } from 'hono';
import { supabase } from '../storage/supabase/client.js';

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const token = authHeader.substring(7);
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return c.json({ error: 'Invalid token' }, 401);
  }
  
  // Attach user to context
  c.set('user', user);
  c.set('userId', user.id);
  
  await next();
}
```

### Apply to Routes (`src/index.ts`)

```typescript
import { authMiddleware } from './middleware/auth.js';

// Protected routes (production only)
if (process.env.NODE_ENV === 'production') {
  app.use('/api/projects/*', authMiddleware);
  app.use('/api/session/*', authMiddleware);
}
```

---

## Render Configuration

### Option A: render.yaml (Infrastructure as Code)

Create `render.yaml` in project root:

```yaml
services:
  - type: web
    name: soulengine
    runtime: node
    region: oregon  # or your preferred region
    plan: starter   # $7/month, or 'free' for testing
    
    buildCommand: npm ci && npm run build
    startCommand: npm start
    
    healthCheckPath: /api/health
    
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
      - key: SUPABASE_URL
        sync: false  # Set manually in dashboard
      - key: SUPABASE_ANON_KEY
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: GEMINI_API_KEY
        sync: false
      - key: DEEPGRAM_API_KEY
        sync: false
      - key: CARTESIA_API_KEY
        sync: false
```

### Option B: Manual Setup via Dashboard

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Name:** soulengine
   - **Runtime:** Node
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `npm start`
5. Add environment variables
6. Click **Create Web Service**

---

## GitHub Actions CI/CD

### `.github/workflows/deploy.yml`

```yaml
name: Deploy to Render

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Type check
        run: npx tsc --noEmit
      
      - name: Lint
        run: npm run lint --if-present

  deploy:
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Render Deploy
        run: |
          curl -X POST "${{ secrets.RENDER_DEPLOY_HOOK_URL }}"
```

### Get Render Deploy Hook

1. Go to Render Dashboard → Your Service → Settings
2. Scroll to **Deploy Hook**
3. Copy the URL
4. Add to GitHub Secrets as `RENDER_DEPLOY_HOOK_URL`

---

## Frontend Auth Updates

### Add Login UI (`web/js/auth.js`)

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
  if (error) console.error('Login error:', error);
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = '/';
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token;
}
```

### Update API Calls

```javascript
// web/js/api.js
async function apiCall(endpoint, options = {}) {
  const token = await getAccessToken();
  
  return fetch(endpoint, {
    ...options,
    headers: {
      ...options.headers,
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    }
  });
}
```

---

## Migration Checklist

### Phase 1: Setup (Day 1)
- [ ] Complete all prerequisites
- [ ] Run `sql/01-schema.sql` in Supabase
- [ ] Run `sql/02-rls-policies.sql` in Supabase
- [ ] Run `sql/03-storage.sql` in Supabase
- [ ] Test Google OAuth in Supabase dashboard

### Phase 2: Code Changes (Day 2-3) ✅ COMPLETED
- [x] Install `@supabase/supabase-js` (already in package.json)
- [x] Create `src/storage/supabase/` modules
- [x] Implement auth middleware
- [ ] Add login/logout UI components (deferred - optional for backend-only deployment)
- [x] Update `src/storage/index.ts` for env switching
- [x] Add health check endpoint (`/api/health`)

### Phase 3: Testing (Day 4)
- [ ] Test locally with `NODE_ENV=production`
- [ ] Test auth flow (Google OAuth)
- [ ] Test project CRUD
- [ ] Test NPC creation/editing
- [ ] Test playground conversations
- [ ] Test all voice modes (text-text, voice-voice, etc.)

### Phase 4: Deployment (Day 5)
- [x] Create `render.yaml` for infrastructure-as-code deployment
- [ ] Create Render service
- [ ] Set environment variables
- [ ] Deploy and verify
- [ ] Set up custom domain (optional)
- [ ] Configure GitHub Actions

### Phase 5: Data Migration (if needed)
- [ ] Export existing local data
- [ ] Run migration script
- [ ] Verify data integrity

---

## Data Migration Script

If you have existing local data to migrate:

```typescript
// scripts/migrate-to-supabase.ts
import { supabase } from '../src/storage/supabase/client.js';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import * as path from 'path';

async function migrateProjects(userId: string) {
  const projectsDir = './data/projects';
  
  try {
    const projectFolders = await fs.readdir(projectsDir);
    
    for (const projectId of projectFolders) {
      const projectPath = path.join(projectsDir, projectId);
      const stat = await fs.stat(projectPath);
      
      if (!stat.isDirectory()) continue;
      
      // Load project config
      const configPath = path.join(projectPath, 'project.yaml');
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = yaml.load(configContent) as any;
      
      // Insert project
      const { error: projectError } = await supabase.from('projects').insert({
        id: projectId,
        user_id: userId,
        name: config.name,
        settings: config.settings,
        limits: config.limits,
      });
      
      if (projectError) {
        console.error(`Failed to migrate project ${projectId}:`, projectError);
        continue;
      }
      
      console.log(`✓ Migrated project: ${config.name}`);
      
      // Migrate NPCs
      await migrateNpcs(projectId, projectPath);
      
      // Migrate knowledge
      await migrateKnowledge(projectId, projectPath);
    }
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

async function migrateNpcs(projectId: string, projectPath: string) {
  const npcsDir = path.join(projectPath, 'npcs');
  
  try {
    const npcFiles = await fs.readdir(npcsDir);
    
    for (const file of npcFiles) {
      if (!file.endsWith('.yaml')) continue;
      
      const npcPath = path.join(npcsDir, file);
      const content = await fs.readFile(npcPath, 'utf-8');
      const npc = yaml.load(content) as any;
      
      const { error } = await supabase.from('npc_definitions').insert({
        id: npc.id,
        project_id: projectId,
        name: npc.name,
        description: npc.description || '',
        core_anchor: npc.core_anchor,
        personality_baseline: npc.personality_baseline,
        voice: npc.voice,
        schedule: npc.schedule || [],
        mcp_permissions: npc.mcp_permissions,
        knowledge_access: npc.knowledge_access || {},
        network: npc.network || [],
        player_recognition: npc.player_recognition,
        salience_threshold: npc.salience_threshold || 0.7,
      });
      
      if (error) {
        console.error(`Failed to migrate NPC ${npc.name}:`, error);
      } else {
        console.log(`  ✓ Migrated NPC: ${npc.name}`);
      }
    }
  } catch (error) {
    // No NPCs directory
  }
}

async function migrateKnowledge(projectId: string, projectPath: string) {
  const knowledgePath = path.join(projectPath, 'knowledge.yaml');
  
  try {
    const content = await fs.readFile(knowledgePath, 'utf-8');
    const knowledge = yaml.load(content) as any;
    
    for (const [name, entries] of Object.entries(knowledge.categories || {})) {
      const { error } = await supabase.from('knowledge_categories').insert({
        project_id: projectId,
        name,
        entries,
      });
      
      if (error) {
        console.error(`Failed to migrate knowledge ${name}:`, error);
      } else {
        console.log(`  ✓ Migrated knowledge: ${name}`);
      }
    }
  } catch (error) {
    // No knowledge file
  }
}

// Run migration
// Usage: npx tsx scripts/migrate-to-supabase.ts <user-uuid>
const userId = process.argv[2];
if (!userId) {
  console.error('Usage: npx tsx scripts/migrate-to-supabase.ts <user-uuid>');
  process.exit(1);
}

migrateProjects(userId);
```

---

## Monitoring & Logging

### Render Logs

View logs in Render Dashboard → Your Service → Logs

### Add Structured Logging

Your existing `createLogger` works. For production, consider adding:

```typescript
// src/logger.ts - add production format
if (process.env.NODE_ENV === 'production') {
  // JSON format for log aggregation
  logger.level = 'info';  // Reduce verbosity
}
```

### Health Check Endpoint

```typescript
// src/routes/health.ts
import { Hono } from 'hono';

export const healthRoutes = new Hono();

healthRoutes.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});
```

---

## Cost Estimates

| Service | Plan | Cost |
|---------|------|------|
| **Render** | Starter | $7/month |
| **Supabase** | Free tier | $0 (500MB DB, 1GB storage) |
| **Supabase** | Pro (if needed) | $25/month |
| **Domain** (optional) | - | ~$12/year |

**Total: ~$7-32/month**

---

## Troubleshooting

### Common Issues

**1. WebSocket not connecting**
- Check Render logs for errors
- Ensure `PORT` env var is set to `10000`
- Verify WebSocket URL uses `wss://` not `ws://`

**2. Auth not working**
- Verify Google OAuth redirect URI matches exactly
- Check Supabase Site URL setting
- Ensure CORS is configured

**3. Database queries failing**
- Check RLS policies are applied
- Verify service role key is correct
- Check Supabase logs for errors

**4. Voice cutting out**
- This shouldn't happen on Render (no timeout)
- Check Deepgram/Cartesia API keys
- Monitor memory usage in Render dashboard

---

## Implementation Status (Phase 2 Completed)

### What Was Implemented

The following changes were made to enable Supabase-based storage:

#### 1. Storage Layer Architecture

Created a dual-backend storage system that switches between local (development) and Supabase (production):

```
src/storage/
├── interface.ts              # Error types and interfaces (unchanged)
├── index.ts                  # ✅ NEW: Dynamic switcher based on NODE_ENV
├── supabase/
│   ├── client.ts             # ✅ NEW: Supabase client initialization
│   ├── projects.ts           # ✅ NEW: Projects CRUD with Supabase
│   ├── definitions.ts        # ✅ NEW: NPC definitions CRUD
│   ├── instances.ts          # ✅ NEW: NPC instances with history
│   ├── knowledge.ts          # ✅ NEW: Knowledge categories CRUD
│   ├── mcp-tools.ts          # ✅ NEW: MCP tools CRUD
│   ├── secrets.ts            # ✅ NEW: Encrypted API keys in DB
│   ├── images.ts             # ✅ NEW: Supabase Storage bucket operations
│   └── index.ts              # ✅ NEW: Re-exports all supabase functions
└── local/
    ├── projects.ts           # ✅ MOVED: Original local storage
    ├── definitions.ts        # ✅ MOVED: Original local storage
    ├── instances.ts          # ✅ MOVED: Original local storage
    ├── knowledge.ts          # ✅ MOVED: Original local storage
    ├── mcp-tools.ts          # ✅ MOVED: Original local storage
    ├── secrets.ts            # ✅ MOVED: Original local storage
    └── index.ts              # ✅ NEW: Re-exports + stub functions
```

#### 2. Authentication Middleware

Created `src/middleware/auth.ts` with:
- `authMiddleware` - Validates JWT tokens from Authorization header
- `optionalAuthMiddleware` - Allows unauthenticated access while extracting user if present
- `isAuthEnabled()` - Check if auth is enabled (production + Supabase)

**Behavior:**
- Development mode: Auth is skipped, all requests allowed
- Production mode (with Supabase): JWT validation required for protected routes

#### 3. Configuration Updates

Updated `src/config.ts` to include Supabase configuration:
```typescript
supabase: {
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
}
```

#### 4. Health Check Endpoints

Added `/api/health` endpoint that returns:
```json
{
  "status": "ok",
  "timestamp": "2025-01-11T...",
  "version": "2.0.0",
  "storage": "local" | "supabase",
  "auth": "enabled" | "disabled"
}
```

#### 5. Route Updates

All routes updated to use unified storage imports from `src/storage/index.js`:
- `src/routes/projects.ts`
- `src/routes/npcs.ts`
- `src/routes/knowledge.ts`
- `src/routes/cycles.ts`
- `src/routes/session.ts`
- `src/routes/history.ts`
- `src/routes/mcp-tools.ts`
- `src/session/manager.ts`
- `src/core/context.ts`

#### 6. Render Deployment Configuration

Created `render.yaml` with:
- Web service configuration
- Build/start commands
- Health check path
- Environment variable placeholders

### How It Works

**Storage Mode Selection:**
```typescript
const isProduction = process.env.NODE_ENV === 'production';
const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const useSupabase = isProduction && hasSupabase;
```

**Auth Protection (Production Only):**
```typescript
if (isAuthEnabled()) {
  app.use('/api/projects/*', authMiddleware);
  app.use('/api/session/*', authMiddleware);
  app.use('/api/instances/*', authMiddleware);
}
```

### Environment Variables Required for Production

```bash
# Supabase (required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# Encryption (required for API key storage)
ENCRYPTION_KEY=your-32-character-encryption-key

# App Config
NODE_ENV=production
PORT=10000

# Provider Keys (at least one LLM required)
GEMINI_API_KEY=...
DEEPGRAM_API_KEY=...
CARTESIA_API_KEY=...
```

### What Was NOT Changed

- Frontend auth UI (login/logout buttons) - can be added later
- Local storage functionality remains fully intact
- All existing APIs work the same way
- No breaking changes to existing integrations

### Testing the Implementation

**Local Development (unchanged):**
```bash
npm run dev
# Uses local file storage, no auth required
```

**Production Mode Locally:**
```bash
NODE_ENV=production \
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
ENCRYPTION_KEY=... \
npm start
```

### Next Steps

1. Run SQL migrations in Supabase (Phase 1)
2. Create Render service and set env vars (Phase 4)
3. Deploy and test
4. (Optional) Add frontend auth UI components
