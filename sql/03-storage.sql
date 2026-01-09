-- ============================================
-- SoulEngine Storage Bucket Setup
-- Run this after 02-rls-policies.sql
-- ============================================

-- Create bucket for NPC profile images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'npc-images', 
  'npc-images', 
  true,  -- Public bucket (images are viewable by anyone)
  5242880,  -- 5MB max file size
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
);

-- ============================================
-- STORAGE POLICIES
-- ============================================

-- Policy: Users can upload images to their project folders
-- Path format: {project_id}/{npc_id}_{filename}
CREATE POLICY "Users can upload NPC images" 
  ON storage.objects FOR INSERT 
  WITH CHECK (
    bucket_id = 'npc-images' AND
    (storage.foldername(name))[1] IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  );

-- Policy: Anyone can view images (public bucket)
CREATE POLICY "Public can view NPC images" 
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'npc-images');

-- Policy: Users can update their images
CREATE POLICY "Users can update NPC images" 
  ON storage.objects FOR UPDATE 
  USING (
    bucket_id = 'npc-images' AND
    (storage.foldername(name))[1] IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can delete their images
CREATE POLICY "Users can delete NPC images" 
  ON storage.objects FOR DELETE 
  USING (
    bucket_id = 'npc-images' AND
    (storage.foldername(name))[1] IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  );
