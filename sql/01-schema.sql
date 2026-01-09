-- ============================================
-- SoulEngine Database Schema
-- Run this first in Supabase SQL Editor
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE (extends Supabase auth.users)
-- ============================================
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- PROJECTS TABLE
-- ============================================
CREATE TABLE public.projects (
  id TEXT PRIMARY KEY DEFAULT 'proj_' || substr(md5(random()::text), 1, 12),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Settings (JSONB for flexibility)
  settings JSONB DEFAULT '{
    "llm_provider": "gemini",
    "stt_provider": "deepgram", 
    "tts_provider": "cartesia",
    "default_voice_id": "",
    "timeouts": {"session": 1800000, "llm": 30000, "stt": 10000, "tts": 10000}
  }'::jsonb,
  
  -- Limits
  limits JSONB DEFAULT '{
    "max_npcs": 10,
    "max_categories": 20,
    "max_concurrent_sessions": 100
  }'::jsonb
);

-- ============================================
-- PROJECT SECRETS (Encrypted API Keys)
-- ============================================
CREATE TABLE public.project_secrets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id TEXT REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  
  -- Encrypted key storage (app-level encryption recommended)
  gemini_key_encrypted TEXT,
  openai_key_encrypted TEXT,
  anthropic_key_encrypted TEXT,
  grok_key_encrypted TEXT,
  deepgram_key_encrypted TEXT,
  cartesia_key_encrypted TEXT,
  elevenlabs_key_encrypted TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(project_id)
);

-- ============================================
-- NPC DEFINITIONS
-- ============================================
CREATE TABLE public.npc_definitions (
  id TEXT PRIMARY KEY DEFAULT 'npc_' || substr(md5(random()::text), 1, 12),
  project_id TEXT REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  
  -- Core data (JSONB)
  core_anchor JSONB NOT NULL,
  personality_baseline JSONB NOT NULL,
  voice JSONB NOT NULL,
  schedule JSONB DEFAULT '[]'::jsonb,
  mcp_permissions JSONB DEFAULT '{"conversation_tools": [], "game_event_tools": [], "denied": []}'::jsonb,
  knowledge_access JSONB DEFAULT '{}'::jsonb,
  network JSONB DEFAULT '[]'::jsonb,
  player_recognition JSONB DEFAULT '{"can_know_player": true, "reveal_player_identity": true}'::jsonb,
  
  -- Memory retention (0.0 = remembers everything, 1.0 = forgets everything)
  salience_threshold FLOAT DEFAULT 0.7,
  
  -- Profile image (filename in storage bucket)
  profile_image TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- NPC INSTANCES (Runtime State)
-- ============================================
CREATE TABLE public.npc_instances (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  definition_id TEXT REFERENCES public.npc_definitions(id) ON DELETE CASCADE NOT NULL,
  player_id TEXT NOT NULL,
  
  -- Current state (JSONB - full NPCInstance)
  state JSONB NOT NULL,
  
  -- Version tracking for sync conflict resolution
  version INTEGER DEFAULT 1,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(definition_id, player_id)
);

-- ============================================
-- NPC INSTANCE HISTORY (for rollback/debugging)
-- ============================================
CREATE TABLE public.npc_instance_history (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  instance_id TEXT REFERENCES public.npc_instances(id) ON DELETE CASCADE NOT NULL,
  version INTEGER NOT NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- KNOWLEDGE CATEGORIES
-- ============================================
CREATE TABLE public.knowledge_categories (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id TEXT REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  
  name TEXT NOT NULL,
  entries JSONB DEFAULT '[]'::jsonb,  -- Array of {depth, content}
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(project_id, name)
);

-- ============================================
-- MCP TOOLS
-- ============================================
CREATE TABLE public.mcp_tools (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id TEXT REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  
  tool_id TEXT NOT NULL,
  tool_type TEXT NOT NULL CHECK (tool_type IN ('conversation', 'game_event')),
  name TEXT NOT NULL,
  description TEXT,
  parameters JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(project_id, tool_id)
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_projects_user_id ON public.projects(user_id);
CREATE INDEX idx_npc_definitions_project_id ON public.npc_definitions(project_id);
CREATE INDEX idx_npc_instances_project_id ON public.npc_instances(project_id);
CREATE INDEX idx_npc_instances_definition_id ON public.npc_instances(definition_id);
CREATE INDEX idx_npc_instances_player ON public.npc_instances(definition_id, player_id);
CREATE INDEX idx_knowledge_categories_project_id ON public.knowledge_categories(project_id);
CREATE INDEX idx_mcp_tools_project_id ON public.mcp_tools(project_id);
CREATE INDEX idx_instance_history_instance ON public.npc_instance_history(instance_id);

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at 
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_projects_updated_at 
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_project_secrets_updated_at 
  BEFORE UPDATE ON public.project_secrets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_npc_definitions_updated_at 
  BEFORE UPDATE ON public.npc_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_npc_instances_updated_at 
  BEFORE UPDATE ON public.npc_instances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_knowledge_categories_updated_at 
  BEFORE UPDATE ON public.knowledge_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_mcp_tools_updated_at 
  BEFORE UPDATE ON public.mcp_tools
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
