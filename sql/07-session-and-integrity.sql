-- ============================================
-- Migration: Session persistence + schema integrity constraints
-- Run this after 06-waitlist.sql
-- All statements are additive and idempotent.
-- ============================================

-- ============================================
-- SESSIONS TABLE
-- Stores persisted NPC conversation sessions so they can be resumed
-- after disconnection. session_id is supplied by the application
-- (format: sess_<timestamp>_<random>) and acts as the primary key.
-- ============================================
CREATE TABLE IF NOT EXISTS public.sessions (
  session_id   TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  state        JSONB NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_project_id
  ON public.sessions(project_id);

-- Apply updated_at trigger (reuse the existing update_updated_at function)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_sessions_updated_at'
      AND tgrelid = 'public.sessions'::regclass
  ) THEN
    CREATE TRIGGER update_sessions_updated_at
      BEFORE UPDATE ON public.sessions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END;
$$;

-- ============================================
-- RLS POLICIES FOR sessions
-- ============================================
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sessions' AND policyname = 'Users can manage own sessions'
  ) THEN
    CREATE POLICY "Users can manage own sessions"
      ON public.sessions FOR ALL
      USING (
        project_id IN (
          SELECT id FROM public.projects WHERE user_id = auth.uid()
        )
      )
      WITH CHECK (
        project_id IN (
          SELECT id FROM public.projects WHERE user_id = auth.uid()
        )
      );
  END IF;
END;
$$;

-- ============================================
-- npc_instance_history: UNIQUE (instance_id, version)
-- The optimistic-locking code in instances.ts inserts a history row
-- keyed on (instance_id, version) and treats a unique-constraint
-- violation (pg error 23505) as a signal that a concurrent save already
-- archived that version, allowing a clean conflict error rather than
-- silent duplicate rows.
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'npc_instance_history_instance_id_version_key'
      AND conrelid = 'public.npc_instance_history'::regclass
  ) THEN
    ALTER TABLE public.npc_instance_history
      ADD CONSTRAINT npc_instance_history_instance_id_version_key
      UNIQUE (instance_id, version) NOT VALID;

    -- Validate the constraint in a non-blocking way
    ALTER TABLE public.npc_instance_history
      VALIDATE CONSTRAINT npc_instance_history_instance_id_version_key;
  END IF;
END;
$$;

-- ============================================
-- knowledge_categories: description column
-- The KnowledgeCategory type carries a description field that the local
-- backend persists. Adding it to the cloud schema so round-trips through
-- Supabase preserve category descriptions rather than silently dropping them.
-- ============================================
ALTER TABLE public.knowledge_categories
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
