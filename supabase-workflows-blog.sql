-- ============================================================
-- SUPERNOVA EDITOR — Workflows + Blog Builder schema
-- Run in Supabase SQL Editor (one-shot, idempotent)
-- ============================================================

-- workflow_runs: each invocation of a Workflow template
CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  template_id text NOT NULL,
  template_name text,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  output jsonb,
  error text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS workflow_runs_workspace_idx ON workflow_runs(workspace_id, created_at DESC);

-- blog_posts: long-form blog generations
CREATE TABLE IF NOT EXISTS blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  strategy_id uuid,
  title text NOT NULL,
  slug text NOT NULL,
  html text NOT NULL,
  markdown text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_to jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blog_posts_workspace_idx ON blog_posts(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS blog_posts_strategy_idx ON blog_posts(strategy_id);

-- workspace_settings: blog connections + voice profile + misc
CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id uuid PRIMARY KEY,
  blog_connections jsonb DEFAULT '{}'::jsonb,
  voice_profile jsonb,
  preferences jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- email_queue: scheduled welcome / lifecycle emails (cron worker drains)
CREATE TABLE IF NOT EXISTS email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  recipient text NOT NULL,
  recipient_name text,
  sequence text NOT NULL,
  step int NOT NULL,
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  resend_id text,
  error text,
  consent_recorded_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_queue_due_idx ON email_queue(status, send_at);
CREATE INDEX IF NOT EXISTS email_queue_recipient_idx ON email_queue(recipient);

-- consent_log: audit trail for A2P / CAN-SPAM / GDPR (immutable)
CREATE TABLE IF NOT EXISTS consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  identifier text NOT NULL,
  channel text NOT NULL,
  action text NOT NULL,
  source text,
  ip_address inet,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  recorded_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_log_identifier_idx ON consent_log(identifier, channel, recorded_at DESC);

-- campaigns: top-level project that aggregates strategy + thumbnails + recordings + posts.
-- Each "video" or "recording" the user works on is a campaign.
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  name text NOT NULL,
  topic text,
  format text NOT NULL DEFAULT 'short',
  platforms text[] DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'planning',
  strategy_id uuid,
  blog_post_id uuid,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_workspace_idx ON campaigns(workspace_id, updated_at DESC);

-- Add campaign_id to existing content table so any piece can be tagged to a campaign.
ALTER TABLE content ADD COLUMN IF NOT EXISTS campaign_id uuid;
CREATE INDEX IF NOT EXISTS content_campaign_idx ON content(campaign_id);

-- ============================================================
-- Permissive demo policies (matches existing supabase-rls-demo.sql pattern).
-- Tighten before opening to multi-tenant production traffic.
-- ============================================================
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_runs_all ON workflow_runs;
CREATE POLICY workflow_runs_all ON workflow_runs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blog_posts_all ON blog_posts;
CREATE POLICY blog_posts_all ON blog_posts FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_settings_all ON workspace_settings;
CREATE POLICY workspace_settings_all ON workspace_settings FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE email_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_queue_all ON email_queue;
CREATE POLICY email_queue_all ON email_queue FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE consent_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consent_log_all ON consent_log;
CREATE POLICY consent_log_all ON consent_log FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaigns_all ON campaigns;
CREATE POLICY campaigns_all ON campaigns FOR ALL USING (true) WITH CHECK (true);
