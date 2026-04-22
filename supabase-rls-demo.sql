-- ============================================================
-- ⛔  DO NOT APPLY TO PRODUCTION  ⛔
-- ============================================================
-- This file installs permissive `USING (true)` RLS policies that
-- allow any authenticated (and sometimes anon) caller to read and
-- write every other user's data. It was intended for a single-user
-- dev demo and was removed from the migration runner on 2026-04-21
-- after the audit confirmed it was the root cause of:
--   • social_connections OAuth-token leak to every anon caller
--   • subscriptions + plan_events plan-tier bypass
--   • profiles PII leak (email, phone, social handles)
-- Production uses supabase-rls-strict.sql + supabase-lockdown-2026-04-21.sql
-- instead. This file is kept for reference only; re-introducing it to
-- the migration chain will regress the entire security posture.
-- ============================================================
-- Demo-mode RLS: allow anon read+write (legacy scaffolding)

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

DROP POLICY IF EXISTS "Public read workspaces" ON workspaces;
CREATE POLICY "Public read workspaces" ON workspaces FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public read collaborators" ON collaborators;
CREATE POLICY "Public read collaborators" ON collaborators FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public write collaborators" ON collaborators;
CREATE POLICY "Public write collaborators" ON collaborators FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public read campaigns" ON campaigns;
CREATE POLICY "Public read campaigns" ON campaigns FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public write campaigns" ON campaigns;
CREATE POLICY "Public write campaigns" ON campaigns FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public read packages" ON packages;
CREATE POLICY "Public read packages" ON packages FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public write packages" ON packages;
CREATE POLICY "Public write packages" ON packages FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public read content" ON content;
CREATE POLICY "Public read content" ON content FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public write content" ON content;
CREATE POLICY "Public write content" ON content FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public read activity" ON activity_log;
CREATE POLICY "Public read activity" ON activity_log FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public write activity" ON activity_log;
CREATE POLICY "Public write activity" ON activity_log FOR INSERT WITH CHECK (true);
