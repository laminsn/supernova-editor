-- Demo-mode RLS: allow anon read+write
-- Replaces strict workspace-scoped policies with permissive demo policies
-- For production with real auth, run supabase-schema.sql instead

DROP POLICY IF EXISTS "Members read content" ON content;
DROP POLICY IF EXISTS "Editors write content" ON content;
DROP POLICY IF EXISTS "Members read collaborators" ON collaborators;
DROP POLICY IF EXISTS "Editors manage collaborators" ON collaborators;
DROP POLICY IF EXISTS "Members read campaigns" ON campaigns;
DROP POLICY IF EXISTS "Editors manage campaigns" ON campaigns;
DROP POLICY IF EXISTS "Members read packages" ON packages;
DROP POLICY IF EXISTS "Editors manage packages" ON packages;
DROP POLICY IF EXISTS "Members read activity" ON activity_log;
DROP POLICY IF EXISTS "Members log activity" ON activity_log;
DROP POLICY IF EXISTS "Members see workspace" ON workspaces;

CREATE POLICY "Public read workspaces" ON workspaces FOR SELECT USING (true);
CREATE POLICY "Public read collaborators" ON collaborators FOR SELECT USING (true);
CREATE POLICY "Public write collaborators" ON collaborators FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read campaigns" ON campaigns FOR SELECT USING (true);
CREATE POLICY "Public write campaigns" ON campaigns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read packages" ON packages FOR SELECT USING (true);
CREATE POLICY "Public write packages" ON packages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read content" ON content FOR SELECT USING (true);
CREATE POLICY "Public write content" ON content FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read activity" ON activity_log FOR SELECT USING (true);
CREATE POLICY "Public write activity" ON activity_log FOR INSERT WITH CHECK (true);
