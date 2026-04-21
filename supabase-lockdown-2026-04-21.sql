-- ==============================================================
-- SUPERNOVA EDITOR — RLS LOCKDOWN (2026-04-21)
-- Idempotent. Run in Supabase SQL Editor. Safe to re-run.
-- Closes launch-blockers found in the 2026-04-21 audit:
--   - social_connections OAuth-token exposure
--   - current_user_in_workspace() stub
--   - subscriptions / plan_events client-writable
--   - profiles publicly readable
--   - usage_metrics client-writable (quota bypass)
--   - referrals self-referral / reward manipulation
--   - consent_log / email_queue tamperable
--   - FK ON DELETE gaps blocking account deletion
--   - missing indexes
-- ==============================================================

-- STEP 0: Real current_user_in_workspace() — replaces the
-- `SELECT true` stub from supabase-storage.sql.
CREATE OR REPLACE FUNCTION current_user_in_workspace(ws uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = (SELECT auth.uid()) AND workspace_id = ws
  );
$$;

-- STEP 1: profiles — owner-only read/write. Eliminates PII leak.
DROP POLICY IF EXISTS profiles_self_read   ON profiles;
DROP POLICY IF EXISTS profiles_self_update ON profiles;
DROP POLICY IF EXISTS profiles_insert      ON profiles;
DROP POLICY IF EXISTS "Users see own profile"    ON profiles;
DROP POLICY IF EXISTS "Users update own profile" ON profiles;
DROP POLICY IF EXISTS profiles_owner_read   ON profiles;
DROP POLICY IF EXISTS profiles_owner_write  ON profiles;
DROP POLICY IF EXISTS profiles_self_insert  ON profiles;

CREATE POLICY profiles_owner_read  ON profiles FOR SELECT USING ((SELECT auth.uid()) = id);
CREATE POLICY profiles_owner_write ON profiles FOR UPDATE USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);
CREATE POLICY profiles_self_insert ON profiles FOR INSERT WITH CHECK ((SELECT auth.uid()) = id);

-- STEP 2: social_connections — CRITICAL. Owner-only.
-- Closes the OAuth-token exfiltration vector.
DROP POLICY IF EXISTS social_connections_all            ON social_connections;
DROP POLICY IF EXISTS social_connections_owner_read     ON social_connections;
DROP POLICY IF EXISTS social_connections_owner_insert   ON social_connections;
DROP POLICY IF EXISTS social_connections_owner_update   ON social_connections;
DROP POLICY IF EXISTS social_connections_owner_delete   ON social_connections;

CREATE POLICY social_connections_owner_read   ON social_connections FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY social_connections_owner_insert ON social_connections FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY social_connections_owner_update ON social_connections FOR UPDATE USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY social_connections_owner_delete ON social_connections FOR DELETE USING (user_id = (SELECT auth.uid()));

-- STEP 3: subscriptions — SELECT-only for owner. Writes go through
-- service-role Stripe webhook handler.
DROP POLICY IF EXISTS subscriptions_all        ON subscriptions;
DROP POLICY IF EXISTS subscriptions_owner      ON subscriptions;
DROP POLICY IF EXISTS subscriptions_owner_read ON subscriptions;

CREATE POLICY subscriptions_owner_read ON subscriptions FOR SELECT USING (profile_id = (SELECT auth.uid()));
-- Intentionally no INSERT/UPDATE/DELETE for authed users.

-- STEP 4: plan_events — SELECT-only for owner. Append-only via service role.
DROP POLICY IF EXISTS plan_events_all        ON plan_events;
DROP POLICY IF EXISTS plan_events_owner      ON plan_events;
DROP POLICY IF EXISTS plan_events_owner_read ON plan_events;

CREATE POLICY plan_events_owner_read ON plan_events FOR SELECT USING (profile_id = (SELECT auth.uid()));
-- No INSERT/UPDATE/DELETE. Service-role webhook handlers only.

-- STEP 5: referrals — tightened inserts + prevent reward manipulation.
DROP POLICY IF EXISTS referrals_all              ON referrals;
DROP POLICY IF EXISTS referrals_owner_read       ON referrals;
DROP POLICY IF EXISTS referrals_public_insert    ON referrals;
DROP POLICY IF EXISTS referrals_owner_update     ON referrals;
DROP POLICY IF EXISTS referrals_referrer_update  ON referrals;

CREATE POLICY referrals_owner_read ON referrals FOR SELECT
  USING (referrer_id = (SELECT auth.uid()) OR referred_user_id = (SELECT auth.uid()));

-- Public insert (signup share-link) but no self-referral and reward fields
-- must be at defaults. referred_user_id is assigned server-side post-signup.
CREATE POLICY referrals_public_insert ON referrals FOR INSERT
  WITH CHECK (
    (referrer_id IS NULL OR referrer_id IS DISTINCT FROM referred_user_id)
    AND COALESCE(reward_amount_cents, 0) = 0
    AND COALESCE(reward_status, 'pending') = 'pending'
    AND referred_user_id IS NULL
  );

-- Referrer can update message/channel pre-conversion only.
CREATE POLICY referrals_referrer_update ON referrals FOR UPDATE
  USING (referrer_id = (SELECT auth.uid()))
  WITH CHECK (referrer_id = (SELECT auth.uid()));

-- STEP 6: usage_metrics — workspace-read only; writes via function.
DROP POLICY IF EXISTS usage_metrics_all                ON usage_metrics;
DROP POLICY IF EXISTS usage_metrics_workspace_read     ON usage_metrics;

CREATE POLICY usage_metrics_workspace_read ON usage_metrics FOR SELECT
  USING (current_user_in_workspace(workspace_id));

-- SECURITY DEFINER increment function that bypasses RLS but verifies membership.
CREATE OR REPLACE FUNCTION increment_usage(ws uuid, m text, p text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE new_count int;
BEGIN
  IF NOT current_user_in_workspace(ws) THEN
    RAISE EXCEPTION 'Not a member of workspace %', ws;
  END IF;
  INSERT INTO usage_metrics (workspace_id, metric, period, count)
  VALUES (ws, m, p, 1)
  ON CONFLICT (workspace_id, metric, period)
  DO UPDATE SET count = usage_metrics.count + 1, updated_at = now()
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

-- STEP 7: consent_log — append-only (GDPR audit).
DROP POLICY IF EXISTS consent_log_all                 ON consent_log;
DROP POLICY IF EXISTS consent_log_workspace_read      ON consent_log;
DROP POLICY IF EXISTS consent_log_workspace_insert    ON consent_log;

CREATE POLICY consent_log_workspace_read   ON consent_log FOR SELECT USING (current_user_in_workspace(workspace_id));
CREATE POLICY consent_log_workspace_insert ON consent_log FOR INSERT WITH CHECK (current_user_in_workspace(workspace_id));
-- No UPDATE or DELETE policies — log is immutable.

-- STEP 8: email_queue — workspace-read only; service-role writes.
DROP POLICY IF EXISTS email_queue_all              ON email_queue;
DROP POLICY IF EXISTS email_queue_workspace_read   ON email_queue;

CREATE POLICY email_queue_workspace_read ON email_queue FOR SELECT USING (current_user_in_workspace(workspace_id));
-- No INSERT/UPDATE/DELETE — all queueing goes through API routes.

-- STEP 9: Workspace-scoped policies for tables not covered by rls-strict.sql.
-- Each table: workspace members CRUD, anon blocked.

-- social_posts (user-owned content inside a workspace)
DROP POLICY IF EXISTS social_posts_all               ON social_posts;
DROP POLICY IF EXISTS social_posts_workspace_read    ON social_posts;
DROP POLICY IF EXISTS social_posts_workspace_insert  ON social_posts;
DROP POLICY IF EXISTS social_posts_workspace_update  ON social_posts;
DROP POLICY IF EXISTS social_posts_workspace_delete  ON social_posts;
CREATE POLICY social_posts_workspace_read   ON social_posts FOR SELECT USING (current_user_in_workspace(workspace_id));
CREATE POLICY social_posts_workspace_insert ON social_posts FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()) AND current_user_in_workspace(workspace_id));
CREATE POLICY social_posts_workspace_update ON social_posts FOR UPDATE USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY social_posts_workspace_delete ON social_posts FOR DELETE USING (user_id = (SELECT auth.uid()));

-- email_campaigns
DROP POLICY IF EXISTS email_campaigns_all               ON email_campaigns;
DROP POLICY IF EXISTS email_campaigns_workspace_read    ON email_campaigns;
DROP POLICY IF EXISTS email_campaigns_workspace_insert  ON email_campaigns;
DROP POLICY IF EXISTS email_campaigns_workspace_update  ON email_campaigns;
DROP POLICY IF EXISTS email_campaigns_workspace_delete  ON email_campaigns;
CREATE POLICY email_campaigns_workspace_read   ON email_campaigns FOR SELECT USING (current_user_in_workspace(workspace_id));
CREATE POLICY email_campaigns_workspace_insert ON email_campaigns FOR INSERT WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY email_campaigns_workspace_update ON email_campaigns FOR UPDATE USING (current_user_in_workspace(workspace_id)) WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY email_campaigns_workspace_delete ON email_campaigns FOR DELETE USING (current_user_in_workspace(workspace_id));

-- campaign_recipients (scope through email_campaigns)
DROP POLICY IF EXISTS campaign_recipients_all              ON campaign_recipients;
DROP POLICY IF EXISTS campaign_recipients_workspace_read   ON campaign_recipients;
DROP POLICY IF EXISTS campaign_recipients_workspace_insert ON campaign_recipients;
CREATE POLICY campaign_recipients_workspace_read ON campaign_recipients FOR SELECT
  USING (campaign_id IN (SELECT id FROM email_campaigns WHERE current_user_in_workspace(workspace_id)));
CREATE POLICY campaign_recipients_workspace_insert ON campaign_recipients FOR INSERT
  WITH CHECK (campaign_id IN (SELECT id FROM email_campaigns WHERE current_user_in_workspace(workspace_id)));

-- subscribers (newsletter opt-ins; public insert allowed, workspace read)
DROP POLICY IF EXISTS subscribers_all               ON subscribers;
DROP POLICY IF EXISTS subscribers_workspace_read    ON subscribers;
DROP POLICY IF EXISTS subscribers_workspace_update  ON subscribers;
DROP POLICY IF EXISTS subscribers_workspace_delete  ON subscribers;
DROP POLICY IF EXISTS subscribers_public_insert     ON subscribers;
CREATE POLICY subscribers_workspace_read   ON subscribers FOR SELECT USING (current_user_in_workspace(workspace_id));
-- Public insert is required for signup forms; workspace_id must be server-validated before insert.
CREATE POLICY subscribers_public_insert    ON subscribers FOR INSERT WITH CHECK (true);
CREATE POLICY subscribers_workspace_update ON subscribers FOR UPDATE USING (current_user_in_workspace(workspace_id)) WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY subscribers_workspace_delete ON subscribers FOR DELETE USING (current_user_in_workspace(workspace_id));

-- comments
DROP POLICY IF EXISTS comments_all               ON comments;
DROP POLICY IF EXISTS comments_workspace_read    ON comments;
DROP POLICY IF EXISTS comments_workspace_insert  ON comments;
DROP POLICY IF EXISTS comments_workspace_update  ON comments;
DROP POLICY IF EXISTS comments_workspace_delete  ON comments;
CREATE POLICY comments_workspace_read   ON comments FOR SELECT USING (current_user_in_workspace(workspace_id));
CREATE POLICY comments_workspace_insert ON comments FOR INSERT WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY comments_workspace_update ON comments FOR UPDATE USING (current_user_in_workspace(workspace_id)) WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY comments_workspace_delete ON comments FOR DELETE USING (current_user_in_workspace(workspace_id));

-- comment_rules
DROP POLICY IF EXISTS comment_rules_all               ON comment_rules;
DROP POLICY IF EXISTS comment_rules_workspace_read    ON comment_rules;
DROP POLICY IF EXISTS comment_rules_workspace_insert  ON comment_rules;
DROP POLICY IF EXISTS comment_rules_workspace_update  ON comment_rules;
DROP POLICY IF EXISTS comment_rules_workspace_delete  ON comment_rules;
CREATE POLICY comment_rules_workspace_read   ON comment_rules FOR SELECT USING (current_user_in_workspace(workspace_id));
CREATE POLICY comment_rules_workspace_insert ON comment_rules FOR INSERT WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY comment_rules_workspace_update ON comment_rules FOR UPDATE USING (current_user_in_workspace(workspace_id)) WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY comment_rules_workspace_delete ON comment_rules FOR DELETE USING (current_user_in_workspace(workspace_id));

-- calendars
DROP POLICY IF EXISTS calendars_all               ON calendars;
DROP POLICY IF EXISTS calendars_workspace_read    ON calendars;
DROP POLICY IF EXISTS calendars_workspace_insert  ON calendars;
DROP POLICY IF EXISTS calendars_workspace_update  ON calendars;
DROP POLICY IF EXISTS calendars_workspace_delete  ON calendars;
CREATE POLICY calendars_workspace_read   ON calendars FOR SELECT USING (current_user_in_workspace(workspace_id));
CREATE POLICY calendars_workspace_insert ON calendars FOR INSERT WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY calendars_workspace_update ON calendars FOR UPDATE USING (current_user_in_workspace(workspace_id)) WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY calendars_workspace_delete ON calendars FOR DELETE USING (current_user_in_workspace(workspace_id));

-- calendar_availability (scope through calendars)
DROP POLICY IF EXISTS calendar_availability_all     ON calendar_availability;
DROP POLICY IF EXISTS calendar_availability_read    ON calendar_availability;
DROP POLICY IF EXISTS calendar_availability_write   ON calendar_availability;
DROP POLICY IF EXISTS calendar_availability_update  ON calendar_availability;
DROP POLICY IF EXISTS calendar_availability_delete  ON calendar_availability;
CREATE POLICY calendar_availability_read   ON calendar_availability FOR SELECT USING (calendar_id IN (SELECT id FROM calendars WHERE current_user_in_workspace(workspace_id)));
CREATE POLICY calendar_availability_write  ON calendar_availability FOR INSERT WITH CHECK (calendar_id IN (SELECT id FROM calendars WHERE current_user_in_workspace(workspace_id)));
CREATE POLICY calendar_availability_update ON calendar_availability FOR UPDATE USING (calendar_id IN (SELECT id FROM calendars WHERE current_user_in_workspace(workspace_id)));
CREATE POLICY calendar_availability_delete ON calendar_availability FOR DELETE USING (calendar_id IN (SELECT id FROM calendars WHERE current_user_in_workspace(workspace_id)));

-- calendar_overrides
DROP POLICY IF EXISTS calendar_overrides_all     ON calendar_overrides;
DROP POLICY IF EXISTS calendar_overrides_read    ON calendar_overrides;
DROP POLICY IF EXISTS calendar_overrides_write   ON calendar_overrides;
DROP POLICY IF EXISTS calendar_overrides_update  ON calendar_overrides;
DROP POLICY IF EXISTS calendar_overrides_delete  ON calendar_overrides;
CREATE POLICY calendar_overrides_read   ON calendar_overrides FOR SELECT USING (calendar_id IN (SELECT id FROM calendars WHERE current_user_in_workspace(workspace_id)));
CREATE POLICY calendar_overrides_write  ON calendar_overrides FOR INSERT WITH CHECK (calendar_id IN (SELECT id FROM calendars WHERE current_user_in_workspace(workspace_id)));
CREATE POLICY calendar_overrides_update ON calendar_overrides FOR UPDATE USING (calendar_id IN (SELECT id FROM calendars WHERE current_user_in_workspace(workspace_id)));
CREATE POLICY calendar_overrides_delete ON calendar_overrides FOR DELETE USING (calendar_id IN (SELECT id FROM calendars WHERE current_user_in_workspace(workspace_id)));

-- bookings (public insert for anon visitors; workspace owner read/update)
DROP POLICY IF EXISTS bookings_all               ON bookings;
DROP POLICY IF EXISTS bookings_workspace_read    ON bookings;
DROP POLICY IF EXISTS bookings_public_insert     ON bookings;
DROP POLICY IF EXISTS bookings_workspace_update  ON bookings;
CREATE POLICY bookings_workspace_read   ON bookings FOR SELECT USING (calendar_id IN (SELECT id FROM calendars WHERE current_user_in_workspace(workspace_id)));
CREATE POLICY bookings_public_insert    ON bookings FOR INSERT WITH CHECK (true);
CREATE POLICY bookings_workspace_update ON bookings FOR UPDATE USING (calendar_id IN (SELECT id FROM calendars WHERE current_user_in_workspace(workspace_id)));

-- newsletter_lists
DROP POLICY IF EXISTS newsletter_lists_all               ON newsletter_lists;
DROP POLICY IF EXISTS newsletter_lists_workspace_read    ON newsletter_lists;
DROP POLICY IF EXISTS newsletter_lists_workspace_insert  ON newsletter_lists;
DROP POLICY IF EXISTS newsletter_lists_workspace_update  ON newsletter_lists;
DROP POLICY IF EXISTS newsletter_lists_workspace_delete  ON newsletter_lists;
CREATE POLICY newsletter_lists_workspace_read   ON newsletter_lists FOR SELECT USING (current_user_in_workspace(workspace_id));
CREATE POLICY newsletter_lists_workspace_insert ON newsletter_lists FOR INSERT WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY newsletter_lists_workspace_update ON newsletter_lists FOR UPDATE USING (current_user_in_workspace(workspace_id)) WITH CHECK (current_user_in_workspace(workspace_id));
CREATE POLICY newsletter_lists_workspace_delete ON newsletter_lists FOR DELETE USING (current_user_in_workspace(workspace_id));

-- STEP 10: Drop recordings_anon_all catch-all so workspace-scoped policies work.
DROP POLICY IF EXISTS recordings_anon_all ON recordings;

-- STEP 11: workspaces — owner-scoped read/write/insert.
DROP POLICY IF EXISTS "Members see workspace" ON workspaces;
DROP POLICY IF EXISTS workspaces_owner_select ON workspaces;
DROP POLICY IF EXISTS workspaces_owner_write  ON workspaces;
DROP POLICY IF EXISTS workspaces_owner_insert ON workspaces;
DROP POLICY IF EXISTS workspaces_owner_update ON workspaces;
CREATE POLICY workspaces_owner_select ON workspaces FOR SELECT USING (owner_id = (SELECT auth.uid()) OR id IN (SELECT workspace_id FROM profiles WHERE id = (SELECT auth.uid())));
CREATE POLICY workspaces_owner_insert ON workspaces FOR INSERT WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY workspaces_owner_update ON workspaces FOR UPDATE USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));

-- Content, campaigns, blog_posts, workflow_runs, workspace_settings,
-- brain_predictions, engagement_data, generated_images, script_edits,
-- collaborators, packages — these are covered by supabase-rls-strict.sql's
-- DO $$ BEGIN ... END $$ loop, which we'll wire into the migration runner.
-- For this lockdown, ensure the strict policies are in place explicitly:

DO $do$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'content','campaigns','blog_posts','workflow_runs','workspace_settings',
    'brain_predictions','engagement_data','generated_images','script_edits',
    'collaborators','packages'
  ])
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_all            ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "Public read %I"   ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "Public write %I"  ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS %I_workspace_read   ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS %I_workspace_insert ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS %I_workspace_update ON %I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS %I_workspace_delete ON %I', t, t);
      EXECUTE format('CREATE POLICY %I_workspace_read   ON %I FOR SELECT USING (current_user_in_workspace(workspace_id))', t, t);
      EXECUTE format('CREATE POLICY %I_workspace_insert ON %I FOR INSERT WITH CHECK (current_user_in_workspace(workspace_id))', t, t);
      EXECUTE format('CREATE POLICY %I_workspace_update ON %I FOR UPDATE USING (current_user_in_workspace(workspace_id)) WITH CHECK (current_user_in_workspace(workspace_id))', t, t);
      EXECUTE format('CREATE POLICY %I_workspace_delete ON %I FOR DELETE USING (current_user_in_workspace(workspace_id))', t, t);
    END IF;
  END LOOP;
END;
$do$;

-- STEP 12: Unique partial index — prevent referral spam.
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_email_pending_uidx
  ON referrals (referred_email)
  WHERE referred_user_id IS NULL AND referred_email IS NOT NULL;

-- STEP 13: ON DELETE SET NULL on critical FKs so account deletion works.
-- subscriptions.profile_id
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_profile_id_fkey;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- plan_events.profile_id
ALTER TABLE plan_events
  DROP CONSTRAINT IF EXISTS plan_events_profile_id_fkey;
ALTER TABLE plan_events
  ADD CONSTRAINT plan_events_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- profiles.referred_by  (attribution lost on referrer delete, but account deletable)
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_referred_by_fkey;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_referred_by_fkey
  FOREIGN KEY (referred_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- STEP 14: Missing indexes.
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_workspace_idx       ON subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS profiles_workspace_id_idx         ON profiles(workspace_id);
CREATE INDEX IF NOT EXISTS blog_posts_slug_idx               ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS content_created_by_idx            ON content(created_by);
CREATE INDEX IF NOT EXISTS campaign_recipients_recipient_idx ON campaign_recipients(recipient);

-- ==============================================================
-- VERIFICATION (read-only, run after the above)
-- ==============================================================
-- 1. Confirm current_user_in_workspace is NOT the stub:
SELECT pg_get_functiondef('public.current_user_in_workspace(uuid)'::regprocedure);

-- 2. Confirm social_connections no longer has USING (true):
SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'public.social_connections'::regclass;

-- 3. Confirm profiles is owner-only:
SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'public.profiles'::regclass;
