-- ============================================================
-- SoulEngine: Usage Tracking Migration
-- Run in Supabase SQL Editor AFTER 01-schema.sql
-- ============================================================

-- ============================================================
-- TABLE: project_usage
-- One row per project, accumulates token/char totals
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_usage (
  project_id        TEXT REFERENCES public.projects(id) ON DELETE CASCADE PRIMARY KEY,
  total_conversations INTEGER NOT NULL DEFAULT 0,
  text_input_tokens  BIGINT NOT NULL DEFAULT 0,
  text_output_tokens BIGINT NOT NULL DEFAULT 0,
  voice_input_chars  BIGINT NOT NULL DEFAULT 0,
  voice_output_chars BIGINT NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: conversation_transcripts
-- One row per session (saved when session ends)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.conversation_transcripts (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  npc_id      TEXT NOT NULL,
  player_id   TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'text-text',
  messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_usage JSONB NOT NULL DEFAULT '{"text_input_tokens":0,"text_output_tokens":0,"voice_input_chars":0,"voice_output_chars":0}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_project_usage_project
  ON public.project_usage(project_id);

CREATE INDEX IF NOT EXISTS idx_transcripts_project_id
  ON public.conversation_transcripts(project_id);

CREATE INDEX IF NOT EXISTS idx_transcripts_started_at
  ON public.conversation_transcripts(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_transcripts_project_started
  ON public.conversation_transcripts(project_id, started_at DESC);

-- ============================================================
-- TRIGGER: auto-update updated_at on project_usage
-- (reuses the update_updated_at() function from schema 01)
-- ============================================================
CREATE TRIGGER update_project_usage_updated_at
  BEFORE UPDATE ON public.project_usage
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- FUNCTION: increment_project_usage (atomic upsert)
-- Called by the backend to safely accumulate usage.
-- SECURITY DEFINER so it bypasses RLS from the API server.
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_project_usage(
  p_project_id        TEXT,
  p_text_input        BIGINT DEFAULT 0,
  p_text_output       BIGINT DEFAULT 0,
  p_voice_input_chars BIGINT DEFAULT 0,
  p_voice_output_chars BIGINT DEFAULT 0
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.project_usage (
    project_id,
    total_conversations,
    text_input_tokens,
    text_output_tokens,
    voice_input_chars,
    voice_output_chars
  ) VALUES (
    p_project_id,
    1,
    p_text_input,
    p_text_output,
    p_voice_input_chars,
    p_voice_output_chars
  )
  ON CONFLICT (project_id) DO UPDATE SET
    total_conversations = project_usage.total_conversations + 1,
    text_input_tokens   = project_usage.text_input_tokens + p_text_input,
    text_output_tokens  = project_usage.text_output_tokens + p_text_output,
    voice_input_chars   = project_usage.voice_input_chars + p_voice_input_chars,
    voice_output_chars  = project_usage.voice_output_chars + p_voice_output_chars,
    updated_at          = NOW();
END;
$$;

-- ============================================================
-- RLS: project_usage
-- ============================================================
ALTER TABLE public.project_usage ENABLE ROW LEVEL SECURITY;

-- Project owners can read their own usage
CREATE POLICY "project_usage_owner_read" ON public.project_usage
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  );

-- Service role (API server) has full access
CREATE POLICY "project_usage_service_role_all" ON public.project_usage
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- RLS: conversation_transcripts
-- ============================================================
ALTER TABLE public.conversation_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transcripts_owner_read" ON public.conversation_transcripts
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "transcripts_service_role_all" ON public.conversation_transcripts
  FOR ALL USING (auth.role() = 'service_role');
