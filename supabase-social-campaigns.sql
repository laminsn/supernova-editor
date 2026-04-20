-- ============================================================
-- SUPERNOVA EDITOR — Social connections + Email campaigns + Subscriber lists
-- Run in Supabase SQL Editor (idempotent).
-- ============================================================

-- social_connections: one OAuth connection per (user_id, platform)
CREATE TABLE IF NOT EXISTS social_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id),
  workspace_id uuid,
  platform text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  username text,
  avatar_url text,
  metadata jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  connected_at timestamptz DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (user_id, platform)
);
CREATE INDEX IF NOT EXISTS social_connections_user_idx ON social_connections(user_id);

-- social_posts: log of every post attempt across platforms
CREATE TABLE IF NOT EXISTS social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  workspace_id uuid,
  campaign_id uuid,
  platform text NOT NULL,
  caption text,
  title text,
  media_url text,
  status text NOT NULL DEFAULT 'pending',
  external_id text,
  external_url text,
  error text,
  posted_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_posts_user_idx ON social_posts(user_id, posted_at DESC);

-- email_campaigns: campaign drafts + sent records (separate from welcome_sequence)
CREATE TABLE IF NOT EXISTS email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  name text NOT NULL,
  subject text NOT NULL,
  preview_text text,
  html_body text NOT NULL,
  text_body text,
  template text,
  audience_filter jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  scheduled_for timestamptz,
  sent_at timestamptz,
  sent_count int DEFAULT 0,
  failed_count int DEFAULT 0,
  open_count int DEFAULT 0,
  click_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_campaigns_workspace_idx ON email_campaigns(workspace_id, created_at DESC);

-- campaign_recipients: per-recipient delivery tracking
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES email_campaigns(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  recipient_name text,
  status text NOT NULL DEFAULT 'pending',
  resend_id text,
  error text,
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz
);
CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_idx ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_recipients_status_idx ON campaign_recipients(campaign_id, status);

-- subscribers: people who opted into your list (lead magnet captures, etc.)
CREATE TABLE IF NOT EXISTS subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  email text NOT NULL,
  name text,
  source text,
  tags text[] DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'subscribed',
  subscribed_at timestamptz DEFAULT now(),
  unsubscribed_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  UNIQUE (workspace_id, email)
);
CREATE INDEX IF NOT EXISTS subscribers_workspace_idx ON subscribers(workspace_id, status);

-- ============================================================
-- Permissive demo policies (matches existing pattern)
-- ============================================================
ALTER TABLE social_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS social_connections_all ON social_connections;
CREATE POLICY social_connections_all ON social_connections FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS social_posts_all ON social_posts;
CREATE POLICY social_posts_all ON social_posts FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_campaigns_all ON email_campaigns;
CREATE POLICY email_campaigns_all ON email_campaigns FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_recipients_all ON campaign_recipients;
CREATE POLICY campaign_recipients_all ON campaign_recipients FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscribers_all ON subscribers;
CREATE POLICY subscribers_all ON subscribers FOR ALL USING (true) WITH CHECK (true);
