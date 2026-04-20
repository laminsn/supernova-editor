-- ============================================================
-- SUPERNOVA EDITOR — Storage buckets for recordings + assets + thumbnails.
-- Run in Supabase SQL Editor.
-- ============================================================

-- Helper used by the storage policies. Permissive while strict-RLS isn't on
-- yet; supabase-rls-strict.sql replaces this with the real workspace check.
CREATE OR REPLACE FUNCTION current_user_in_workspace(ws uuid) RETURNS boolean AS $$
  SELECT true;
$$ LANGUAGE sql STABLE;

-- 1. Buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('recordings', 'recordings', false, 524288000, ARRAY['video/webm','video/mp4','video/quicktime','audio/webm','audio/mp4','audio/mpeg']::text[])
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('thumbnails', 'thumbnails', true, 10485760, ARRAY['image/png','image/jpeg','image/webp']::text[])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('assets', 'assets', true, 26214400, ARRAY['image/png','image/jpeg','image/webp','image/gif','audio/mpeg','audio/wav']::text[])
ON CONFLICT (id) DO NOTHING;

-- 2. Storage policies
-- Recordings: owner-only via path prefix `<workspace_id>/...`
DROP POLICY IF EXISTS "recordings_workspace_read" ON storage.objects;
CREATE POLICY "recordings_workspace_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'recordings'
    AND current_user_in_workspace((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "recordings_workspace_insert" ON storage.objects;
CREATE POLICY "recordings_workspace_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'recordings'
    AND current_user_in_workspace((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "recordings_workspace_delete" ON storage.objects;
CREATE POLICY "recordings_workspace_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'recordings'
    AND current_user_in_workspace((storage.foldername(name))[1]::uuid)
  );

-- Thumbnails + assets: public read, workspace write
DROP POLICY IF EXISTS "thumbnails_public_read" ON storage.objects;
CREATE POLICY "thumbnails_public_read" ON storage.objects
  FOR SELECT USING (bucket_id IN ('thumbnails','assets'));

DROP POLICY IF EXISTS "thumbnails_workspace_insert" ON storage.objects;
CREATE POLICY "thumbnails_workspace_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id IN ('thumbnails','assets')
    AND current_user_in_workspace((storage.foldername(name))[1]::uuid)
  );

-- 3. Track recordings in a metadata table for transcription / Brain Score linkage
CREATE TABLE IF NOT EXISTS recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  campaign_id uuid,
  storage_path text NOT NULL,
  duration_seconds numeric,
  size_bytes bigint,
  mime text,
  width int,
  height int,
  transcript text,
  transcript_provider text,
  captions_vtt text,
  uploaded_by uuid,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recordings_workspace_idx ON recordings(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recordings_campaign_idx ON recordings(campaign_id);

ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recordings_workspace_read   ON recordings;
DROP POLICY IF EXISTS recordings_workspace_write  ON recordings;
DROP POLICY IF EXISTS recordings_workspace_insert ON recordings;
CREATE POLICY recordings_workspace_read   ON recordings FOR SELECT USING (current_user_in_workspace(workspace_id));
CREATE POLICY recordings_workspace_insert ON recordings FOR INSERT WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY recordings_workspace_write  ON recordings FOR UPDATE USING (current_user_in_workspace(workspace_id)) WITH CHECK (current_user_in_workspace(workspace_id));

-- Permissive fallback for demo/anon (drop these once strict-RLS is everywhere)
DROP POLICY IF EXISTS recordings_anon_all ON recordings;
CREATE POLICY recordings_anon_all ON recordings FOR ALL USING (true) WITH CHECK (true);
