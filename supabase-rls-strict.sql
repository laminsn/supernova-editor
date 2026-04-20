-- ============================================================
-- SUPERNOVA EDITOR — STRICT RLS (per-workspace + per-user isolation)
-- Replaces the permissive demo policies with auth.uid()-based rules.
-- Run AFTER auth + workspaces are populated.
--
-- Pattern:
--   * profiles  → owner (auth.uid() = id)
--   * workspace-scoped tables → user must be a member of profile.workspace_id
--   * referrals → only the referrer can read their own row; anyone can insert
--   * subscriptions → owner-only
-- ============================================================

-- ------------------------------------------------------------
-- Helper: is the current user a member of the given workspace?
-- For now "membership" = profile.workspace_id matches. Tighten to a
-- workspace_members table when you ship multi-seat plans.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_in_workspace(ws uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND workspace_id = ws
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- profiles — own row only
-- ============================================================
DROP POLICY IF EXISTS profiles_self_read   ON profiles;
DROP POLICY IF EXISTS profiles_self_update ON profiles;
DROP POLICY IF EXISTS profiles_insert      ON profiles;
DROP POLICY IF EXISTS profiles_owner_read  ON profiles;
DROP POLICY IF EXISTS profiles_owner_write ON profiles;
DROP POLICY IF EXISTS profiles_owner_insert ON profiles;
DROP POLICY IF EXISTS profiles_self_insert ON profiles;
CREATE POLICY profiles_owner_read   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_owner_write  ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
-- Self-insert: lets the client `upsertProfile` fall back when the on-auth trigger
-- didn't fire (e.g., signup happened before the auth-referrals migration ran).
-- Constraint guarantees the inserted row id matches the caller's auth.uid().
CREATE POLICY profiles_self_insert  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================================
-- referrals — referrer can see their own; public can insert (sign-up form)
-- ============================================================
DROP POLICY IF EXISTS referrals_all          ON referrals;
DROP POLICY IF EXISTS referrals_owner_read   ON referrals;
DROP POLICY IF EXISTS referrals_public_insert ON referrals;
CREATE POLICY referrals_owner_read   ON referrals FOR SELECT USING (
  referrer_id = auth.uid() OR referred_user_id = auth.uid()
);
CREATE POLICY referrals_public_insert ON referrals FOR INSERT WITH CHECK (true);
CREATE POLICY referrals_owner_update  ON referrals FOR UPDATE USING (referrer_id = auth.uid()) WITH CHECK (referrer_id = auth.uid());

-- ============================================================
-- subscriptions / plan_events — owner-only
-- ============================================================
DROP POLICY IF EXISTS subscriptions_all      ON subscriptions;
DROP POLICY IF EXISTS subscriptions_owner    ON subscriptions;
CREATE POLICY subscriptions_owner ON subscriptions FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS plan_events_all   ON plan_events;
DROP POLICY IF EXISTS plan_events_owner ON plan_events;
CREATE POLICY plan_events_owner ON plan_events FOR SELECT USING (profile_id = auth.uid());

-- ============================================================
-- Workspace-scoped tables. Use a single helper for each.
-- ============================================================
DO $$
DECLARE
  t text;
  workspace_tables text[] := ARRAY[
    'content','campaigns','blog_posts','workflow_runs','workspace_settings',
    'brain_predictions','engagement_data','generated_images','script_edits',
    'collaborators','content_packages','email_queue','consent_log'
  ];
BEGIN
  FOREACH t IN ARRAY workspace_tables LOOP
    -- skip tables that don't exist yet
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN CONTINUE; END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I_all ON %I;',                    t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_workspace_read ON %I;',         t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_workspace_write ON %I;',        t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_workspace_insert ON %I;',       t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_workspace_delete ON %I;',       t, t);

    EXECUTE format('CREATE POLICY %I_workspace_read   ON %I FOR SELECT USING (current_user_in_workspace(workspace_id));', t, t);
    EXECUTE format('CREATE POLICY %I_workspace_insert ON %I FOR INSERT WITH CHECK (current_user_in_workspace(workspace_id));', t, t);
    EXECUTE format('CREATE POLICY %I_workspace_write  ON %I FOR UPDATE USING (current_user_in_workspace(workspace_id)) WITH CHECK (current_user_in_workspace(workspace_id));', t, t);
    EXECUTE format('CREATE POLICY %I_workspace_delete ON %I FOR DELETE USING (current_user_in_workspace(workspace_id));', t, t);
  END LOOP;
END $$;

-- ============================================================
-- workspaces table (owner has full access). Create the table if it didn't
-- exist in the original schema; safe-additive.
-- ============================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspaces_all          ON workspaces;
DROP POLICY IF EXISTS workspaces_owner_select ON workspaces;
DROP POLICY IF EXISTS workspaces_owner_write  ON workspaces;
DROP POLICY IF EXISTS workspaces_owner_insert ON workspaces;
CREATE POLICY workspaces_owner_select ON workspaces FOR SELECT USING (
  owner_id = auth.uid() OR id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY workspaces_owner_write  ON workspaces FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY workspaces_owner_insert ON workspaces FOR INSERT WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- Auto-provision a workspace per new profile (called from auth trigger).
-- ============================================================
CREATE OR REPLACE FUNCTION ensure_workspace_for_profile() RETURNS trigger AS $$
DECLARE
  ws_id uuid;
BEGIN
  IF new.workspace_id IS NULL THEN
    INSERT INTO workspaces (name, owner_id)
    VALUES (coalesce(new.first_name, split_part(new.email,'@',1), 'Workspace') || '''s Workspace', new.id)
    RETURNING id INTO ws_id;
    new.workspace_id := ws_id;
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS profiles_ensure_workspace ON profiles;
CREATE TRIGGER profiles_ensure_workspace
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION ensure_workspace_for_profile();
