-- ============================================================
-- SUPERNOVA EDITOR — Supabase Schema
-- Run this in Supabase SQL Editor after creating your project
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- WORKSPACES (multi-tenancy support)
-- ============================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  default_role TEXT DEFAULT 'contributor',
  brand_primary TEXT DEFAULT '#FFD60A',
  brand_accent TEXT DEFAULT '#4169E1',
  brand_bg TEXT DEFAULT '#050508',
  craft_context TEXT,
  craft_role TEXT,
  craft_tone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- USER PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  handle TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'contributor' CHECK (role IN ('owner','admin','editor','contributor','viewer')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active','invited','deactivated')),
  industry TEXT,
  bio TEXT,
  phone TEXT,
  website TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  goals TEXT[],
  social_ig TEXT,
  social_tt TEXT,
  social_yt TEXT,
  social_li TEXT,
  social_x TEXT,
  social_fb TEXT,
  notify_email BOOLEAN DEFAULT TRUE,
  notify_telegram BOOLEAN DEFAULT TRUE,
  notify_slack BOOLEAN DEFAULT FALSE,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONTENT PIECES
-- ============================================================
CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id),
  title TEXT NOT NULL,
  topic TEXT,
  topic_slug TEXT,
  type TEXT DEFAULT 'short' CHECK (type IN ('short','long','both')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','review','approved','scheduled','published','archived')),
  platforms TEXT[],
  brief JSONB,
  script TEXT,
  thumbnail_url TEXT,
  selected_outputs TEXT[],
  views INT DEFAULT 0,
  saves INT DEFAULT 0,
  shares INT DEFAULT 0,
  comments INT DEFAULT 0,
  engagement_rate NUMERIC(5,2),
  neural_score INT,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_content_workspace ON content(workspace_id);
CREATE INDEX idx_content_status ON content(status);

-- ============================================================
-- COLLABORATORS (external creators)
-- ============================================================
CREATE TABLE IF NOT EXISTS collaborators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  handle TEXT,
  email TEXT,
  platform TEXT,
  timezone TEXT,
  tier TEXT CHECK (tier IN ('Bronze','Silver','Gold','Platinum')),
  level TEXT CHECK (level IN ('Influencer','Ambassador','Partner','Affiliate')),
  followers TEXT,
  engagement NUMERIC(4,2),
  posts_completed INT DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','invited','paused','removed')),
  tags TEXT[],
  notes TEXT,
  last_active TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_collaborators_workspace ON collaborators(workspace_id);

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','completed','archived')),
  start_date DATE,
  end_date DATE,
  content_ids UUID[],
  collaborator_ids UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- COLLABORATION PACKAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  collaborator_id UUID REFERENCES collaborators(id) ON DELETE CASCADE,
  content_id UUID REFERENCES content(id),
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent','viewed','scheduled','posted','confirmed','failed')),
  caption TEXT,
  hashtags TEXT[],
  mentions TEXT[],
  scheduled_for TIMESTAMPTZ,
  utm_link TEXT,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
);

-- ============================================================
-- TEAM ACTIVITY LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  type TEXT CHECK (type IN ('publish','edit','create','approve','collab','team','schedule','settings')),
  target_type TEXT,
  target_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_activity_workspace ON activity_log(workspace_id);
CREATE INDEX idx_activity_created ON activity_log(created_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own profile
CREATE POLICY "Users see own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Workspace members can see workspace data
CREATE POLICY "Members see workspace" ON workspaces FOR SELECT
  USING (id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

-- Content: workspace members can read; editors+ can write
CREATE POLICY "Members read content" ON content FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Editors write content" ON content FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin','editor','contributor')));

-- Same pattern for other tables
CREATE POLICY "Members read collaborators" ON collaborators FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Editors manage collaborators" ON collaborators FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin','editor')));

CREATE POLICY "Members read campaigns" ON campaigns FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Editors manage campaigns" ON campaigns FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin','editor')));

CREATE POLICY "Members read packages" ON packages FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Editors manage packages" ON packages FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin','editor')));

CREATE POLICY "Members read activity" ON activity_log FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Members log activity" ON activity_log FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_updated_at BEFORE UPDATE ON content FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER workspace_updated_at BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile when user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, name, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)), 'owner');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- DONE!
-- Next: Get your Project URL + anon key from Settings → API
-- Paste them into Supernova Editor → Settings → Integrations
-- ============================================================
