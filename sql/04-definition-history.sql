-- ============================================
-- NPC Definition Version History
-- Run this after 01-schema.sql + 02-rls-policies.sql
-- ============================================

-- Add version tracking to npc_definitions
ALTER TABLE public.npc_definitions
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

-- ============================================
-- NPC DEFINITION HISTORY (full snapshot on each save)
-- ============================================
CREATE TABLE IF NOT EXISTS public.npc_definition_history (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  definition_id TEXT REFERENCES public.npc_definitions(id) ON DELETE CASCADE NOT NULL,
  version       INTEGER NOT NULL,
  snapshot      JSONB NOT NULL,           -- Full NPCDefinition at this version
  changed_fields TEXT[] DEFAULT '{}',     -- Field names that changed vs previous version
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_definition_history_definition
  ON public.npc_definition_history(definition_id);

CREATE INDEX IF NOT EXISTS idx_definition_history_version
  ON public.npc_definition_history(definition_id, version);

-- ============================================
-- RLS POLICIES FOR npc_definition_history
-- ============================================
ALTER TABLE public.npc_definition_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own definition history"
  ON public.npc_definition_history FOR SELECT
  USING (
    definition_id IN (
      SELECT id FROM public.npc_definitions
      WHERE project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
    )
  );

-- History is insert-only via server (no client updates/deletes)
CREATE POLICY "System can insert definition history"
  ON public.npc_definition_history FOR INSERT
  WITH CHECK (
    definition_id IN (
      SELECT id FROM public.npc_definitions
      WHERE project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
    )
  );
