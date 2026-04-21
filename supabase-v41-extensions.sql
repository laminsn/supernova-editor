-- ============================================================
-- SUPERNOVA EDITOR — v4.1 Master Content Prompt extensions
-- Adds: 6 workspace-level v4.1 fields, cta_pages (Empire Agent),
--       kpi_snapshots (Output 22 System E dashboard).
-- Idempotent: safe to re-run. Run after supabase-schema.sql.
-- ============================================================

-- 1. Workspace-level v4.1 fields (Section A Fields 22-27 — they live at
--    workspace level so all content in the workspace inherits them).
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS blog_base_url TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS ghl_list_name TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS whatsapp_broadcast TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS telegram_channel TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS linkedin_dm_strategy JSONB;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS new_follower_flow JSONB;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS empire_agent_map JSONB;

COMMENT ON COLUMN workspaces.blog_base_url IS 'v4.1 Field 22 — Beehiiv/blog base URL where Empire Agent lands all gated CTA pages';
COMMENT ON COLUMN workspaces.ghl_list_name IS 'v4.1 Field 23 — GoHighLevel email subscriber list name(s) for this workspace';
COMMENT ON COLUMN workspaces.whatsapp_broadcast IS 'v4.1 Field 24a — WhatsApp Business broadcast list name';
COMMENT ON COLUMN workspaces.telegram_channel IS 'v4.1 Field 24b — Telegram channel @handle';
COMMENT ON COLUMN workspaces.linkedin_dm_strategy IS 'v4.1 Field 25 — {trigger, tone, primary_action, ask_question}';
COMMENT ON COLUMN workspaces.new_follower_flow IS 'v4.1 Field 26 — {lead_magnet, capture_fields, destination, day_3_plan}';
COMMENT ON COLUMN workspaces.empire_agent_map IS 'v4.1 Field 27 — array of {business, ghl_pipeline, blog_url}';

-- 2. cta_pages — every Empire Agent-created gated page lives here.
--    UNIQUE on (workspace_id, page_slug) is the database-level conflict
--    check that backs api/empire-agent-conflict-check.js (System D).
CREATE TABLE IF NOT EXISTS cta_pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  business TEXT NOT NULL,
  page_slug TEXT NOT NULL,
  page_title TEXT,
  meta_description TEXT,
  ghl_pipeline TEXT,
  ghl_tags TEXT[],
  email_campaign_trigger TEXT,
  whatsapp_campaign_trigger TEXT,
  consent_text TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','live','paused','archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, page_slug)
);
CREATE INDEX IF NOT EXISTS idx_cta_pages_workspace ON cta_pages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cta_pages_business ON cta_pages(workspace_id, business);
CREATE INDEX IF NOT EXISTS idx_cta_pages_content ON cta_pages(content_id);

ALTER TABLE cta_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read cta_pages" ON cta_pages;
CREATE POLICY "Members read cta_pages" ON cta_pages FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "Editors manage cta_pages" ON cta_pages;
CREATE POLICY "Editors manage cta_pages" ON cta_pages FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM profiles
    WHERE id = auth.uid() AND role IN ('owner','admin','editor','contributor')
  ));

CREATE TRIGGER cta_pages_updated_at BEFORE UPDATE ON cta_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. kpi_snapshots — daily/weekly metric rollups per business.
--    Powers Output 22 System E (KPI Monitoring Dashboard).
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  business TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  cadence TEXT DEFAULT 'weekly' CHECK (cadence IN ('daily','weekly','monthly','quarterly')),
  email_open_rate NUMERIC(5,2),
  email_click_rate NUMERIC(5,2),
  email_unsubscribe_rate NUMERIC(5,2),
  email_spam_rate NUMERIC(5,2),
  whatsapp_open_rate NUMERIC(5,2),
  whatsapp_optout_rate NUMERIC(5,2),
  gated_conversion_rate NUMERIC(5,2),
  linkedin_dm_response_rate NUMERIC(5,2),
  list_growth_count INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, business, snapshot_date, cadence)
);
CREATE INDEX IF NOT EXISTS idx_kpi_workspace ON kpi_snapshots(workspace_id);
CREATE INDEX IF NOT EXISTS idx_kpi_date ON kpi_snapshots(workspace_id, snapshot_date DESC);

ALTER TABLE kpi_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read kpi_snapshots" ON kpi_snapshots;
CREATE POLICY "Members read kpi_snapshots" ON kpi_snapshots FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "Editors manage kpi_snapshots" ON kpi_snapshots;
CREATE POLICY "Editors manage kpi_snapshots" ON kpi_snapshots FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM profiles
    WHERE id = auth.uid() AND role IN ('owner','admin','editor')
  ));

-- ============================================================
-- DONE. Run in Supabase SQL editor or via scripts/run-migrations-api.js.
-- ============================================================
