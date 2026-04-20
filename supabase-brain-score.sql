-- SUPERNOVA BRAIN SCORE — predictions + engagement tracking
-- Run after supabase-schema.sql

-- ============================================================
-- BRAIN PREDICTIONS — every score we generate
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_predictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  -- Inputs scored
  topic TEXT,
  caption TEXT,
  hook TEXT,
  script TEXT,
  platform TEXT,
  duration_seconds INT,
  hashtag_count INT,
  -- Score outputs (0-100)
  overall_score INT NOT NULL,
  hook_score INT,
  retention_score INT,
  reward_score INT,
  algorithm_fit_score INT,
  -- Per-region brain activation (rule-based for v0)
  prefrontal_score INT,
  amygdala_score INT,
  hippocampus_score INT,
  temporal_score INT,
  occipital_score INT,
  motor_score INT,
  -- Reasoning + version tracking
  rationale JSONB,
  model_version TEXT DEFAULT 'v0-heuristic',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brain_pred_workspace ON brain_predictions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_brain_pred_content ON brain_predictions(content_id);
CREATE INDEX IF NOT EXISTS idx_brain_pred_score ON brain_predictions(overall_score DESC);

-- ============================================================
-- ENGAGEMENT DATA — actual outcomes to train on
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  content_id UUID REFERENCES content(id) ON DELETE CASCADE,
  prediction_id UUID REFERENCES brain_predictions(id) ON DELETE SET NULL,
  collaborator_id UUID REFERENCES collaborators(id) ON DELETE SET NULL,
  package_id UUID REFERENCES packages(id) ON DELETE SET NULL,
  -- Where it was posted
  platform TEXT NOT NULL,
  post_url TEXT,
  posted_at TIMESTAMPTZ,
  -- Engagement metrics (snapshots over time)
  views INT DEFAULT 0,
  likes INT DEFAULT 0,
  saves INT DEFAULT 0,
  shares INT DEFAULT 0,
  comments INT DEFAULT 0,
  reach INT DEFAULT 0,
  impressions INT DEFAULT 0,
  watch_time_seconds NUMERIC(10,2),
  completion_rate NUMERIC(5,4),
  click_through_rate NUMERIC(5,4),
  -- Derived virality bucket
  is_viral BOOLEAN GENERATED ALWAYS AS (saves > 1000 OR shares > 500 OR views > 100000) STORED,
  -- Source
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual','api','utm','collaborator_report','scrape')),
  raw_data JSONB,
  measured_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_engagement_workspace ON engagement_data(workspace_id);
CREATE INDEX IF NOT EXISTS idx_engagement_content ON engagement_data(content_id);
CREATE INDEX IF NOT EXISTS idx_engagement_prediction ON engagement_data(prediction_id);
CREATE INDEX IF NOT EXISTS idx_engagement_viral ON engagement_data(is_viral) WHERE is_viral = TRUE;

-- ============================================================
-- TRAINING PAIRS VIEW — for future ML model retraining
-- Joins predictions to outcomes for supervised learning
-- ============================================================
CREATE OR REPLACE VIEW training_pairs AS
SELECT
  bp.id AS prediction_id,
  bp.topic, bp.caption, bp.hook, bp.script, bp.platform, bp.duration_seconds, bp.hashtag_count,
  bp.overall_score AS predicted_score,
  bp.hook_score AS predicted_hook,
  bp.retention_score AS predicted_retention,
  bp.reward_score AS predicted_reward,
  e.views, e.likes, e.saves, e.shares, e.comments,
  e.completion_rate, e.click_through_rate, e.is_viral,
  -- Compute "ground truth" engagement score 0-100
  LEAST(100,
    GREATEST(0,
      (LOG(GREATEST(e.views, 1)) * 8)::INT +
      (LEAST(e.saves, 5000) / 100)::INT +
      (LEAST(e.shares, 1000) / 20)::INT
    )
  ) AS actual_score,
  e.measured_at,
  bp.created_at AS predicted_at,
  bp.model_version
FROM brain_predictions bp
LEFT JOIN engagement_data e ON e.prediction_id = bp.id
WHERE e.id IS NOT NULL;

-- ============================================================
-- RLS — public read+write in demo mode (matches existing pattern)
-- ============================================================
ALTER TABLE brain_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read brain_predictions" ON brain_predictions;
CREATE POLICY "Public read brain_predictions" ON brain_predictions FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public write brain_predictions" ON brain_predictions;
CREATE POLICY "Public write brain_predictions" ON brain_predictions FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public read engagement_data" ON engagement_data;
CREATE POLICY "Public read engagement_data" ON engagement_data FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public write engagement_data" ON engagement_data;
CREATE POLICY "Public write engagement_data" ON engagement_data FOR ALL USING (true) WITH CHECK (true);
