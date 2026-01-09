-- ============================================
-- SoulEngine Row Level Security (RLS) Policies
-- Run this after 01-schema.sql
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npc_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npc_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npc_instance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tools ENABLE ROW LEVEL SECURITY;

-- ============================================
-- PROFILES POLICIES
-- ============================================
CREATE POLICY "Users can view own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id);

-- ============================================
-- PROJECTS POLICIES
-- ============================================
CREATE POLICY "Users can view own projects" 
  ON public.projects FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create projects" 
  ON public.projects FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects" 
  ON public.projects FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects" 
  ON public.projects FOR DELETE 
  USING (auth.uid() = user_id);

-- ============================================
-- PROJECT SECRETS POLICIES
-- ============================================
CREATE POLICY "Users can view own project secrets" 
  ON public.project_secrets FOR SELECT 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create project secrets" 
  ON public.project_secrets FOR INSERT 
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own project secrets" 
  ON public.project_secrets FOR UPDATE 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own project secrets" 
  ON public.project_secrets FOR DELETE 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- ============================================
-- NPC DEFINITIONS POLICIES
-- ============================================
CREATE POLICY "Users can view own NPC definitions" 
  ON public.npc_definitions FOR SELECT 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create NPC definitions" 
  ON public.npc_definitions FOR INSERT 
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own NPC definitions" 
  ON public.npc_definitions FOR UPDATE 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own NPC definitions" 
  ON public.npc_definitions FOR DELETE 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- ============================================
-- NPC INSTANCES POLICIES
-- ============================================
CREATE POLICY "Users can view own NPC instances" 
  ON public.npc_instances FOR SELECT 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create NPC instances" 
  ON public.npc_instances FOR INSERT 
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own NPC instances" 
  ON public.npc_instances FOR UPDATE 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own NPC instances" 
  ON public.npc_instances FOR DELETE 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- ============================================
-- NPC INSTANCE HISTORY POLICIES (Read-only)
-- ============================================
CREATE POLICY "Users can view own instance history" 
  ON public.npc_instance_history FOR SELECT 
  USING (
    instance_id IN (
      SELECT id FROM public.npc_instances 
      WHERE project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
    )
  );

-- History is insert-only (no updates/deletes)
CREATE POLICY "System can insert instance history" 
  ON public.npc_instance_history FOR INSERT 
  WITH CHECK (
    instance_id IN (
      SELECT id FROM public.npc_instances 
      WHERE project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
    )
  );

-- ============================================
-- KNOWLEDGE CATEGORIES POLICIES
-- ============================================
CREATE POLICY "Users can view own knowledge" 
  ON public.knowledge_categories FOR SELECT 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create knowledge" 
  ON public.knowledge_categories FOR INSERT 
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own knowledge" 
  ON public.knowledge_categories FOR UPDATE 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own knowledge" 
  ON public.knowledge_categories FOR DELETE 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- ============================================
-- MCP TOOLS POLICIES
-- ============================================
CREATE POLICY "Users can view own MCP tools" 
  ON public.mcp_tools FOR SELECT 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create MCP tools" 
  ON public.mcp_tools FOR INSERT 
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own MCP tools" 
  ON public.mcp_tools FOR UPDATE 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own MCP tools" 
  ON public.mcp_tools FOR DELETE 
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );
