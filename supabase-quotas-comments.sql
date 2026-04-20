-- ============================================================
-- SUPERNOVA EDITOR — Usage metering + Comment Monitor schema
-- Run in Supabase SQL Editor (idempotent).
-- ============================================================

-- ============================================================
-- USAGE METRICS — per workspace × metric × month bucket
-- ============================================================
CREATE TABLE IF NOT EXISTS usage_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  metric text NOT NULL,        -- strategy|blog|workflow|image|voiceover|transcribe
  period text NOT NULL,        -- YYYY-MM (UTC)
  count int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (workspace_id, metric, period)
);
CREATE INDEX IF NOT EXISTS usage_metrics_lookup ON usage_metrics(workspace_id, period, metric);

-- Atomic increment helper. Returns the new count after the increment.
CREATE OR REPLACE FUNCTION increment_usage(ws uuid, m text, p text) RETURNS int AS $$
DECLARE new_count int;
BEGIN
  INSERT INTO usage_metrics (workspace_id, metric, period, count)
  VALUES (ws, m, p, 1)
  ON CONFLICT (workspace_id, metric, period)
  DO UPDATE SET count = usage_metrics.count + 1, updated_at = now()
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_metrics_all ON usage_metrics;
CREATE POLICY usage_metrics_all ON usage_metrics FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- COMMENTS — cached fetch from connected social platforms
-- ============================================================
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  user_id uuid,
  platform text NOT NULL,           -- facebook|instagram|youtube|linkedin|tiktok|twitter
  external_id text,                 -- platform comment id (idempotency)
  post_external_id text,
  author text,
  author_handle text,
  text text,
  posted_at timestamptz,
  sentiment text,                   -- positive|neutral|negative|spam
  intent text,                      -- question|complaint|praise|sale|spam|other
  matched_rule_id uuid,
  action_taken text,                -- hidden|deleted|replied|flagged|none
  action_external_id text,
  raw jsonb,
  fetched_at timestamptz DEFAULT now(),
  UNIQUE (platform, external_id)
);
CREATE INDEX IF NOT EXISTS comments_workspace_idx  ON comments(workspace_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS comments_user_idx       ON comments(user_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS comments_platform_idx   ON comments(platform, posted_at DESC);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comments_all ON comments;
CREATE POLICY comments_all ON comments FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- COMMENT RULES — user-defined automation
-- ============================================================
CREATE TABLE IF NOT EXISTS comment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  user_id uuid,
  name text NOT NULL,
  match_type text NOT NULL,         -- keyword|regex|sentiment|intent
  match_value text NOT NULL,
  action text NOT NULL,             -- hide|delete|reply|flag
  reply_template text,
  enabled bool DEFAULT true,
  priority int DEFAULT 0,
  applied_count int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comment_rules_workspace_idx ON comment_rules(workspace_id, priority DESC, created_at DESC);

ALTER TABLE comment_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comment_rules_all ON comment_rules;
CREATE POLICY comment_rules_all ON comment_rules FOR ALL USING (true) WITH CHECK (true);
