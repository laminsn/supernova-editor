-- ============================================================
-- SUPERNOVA EDITOR — Calendar booking + Newsletter signup schema
-- Replaces GHL + Calendly with native primitives.
-- Run in Supabase SQL Editor (idempotent).
-- ============================================================

-- ============================================================
-- CALENDARS — one user can host many (sales call, intro, demo, ...)
-- Each calendar is publicly bookable at /?book=<slug>
-- ============================================================
CREATE TABLE IF NOT EXISTS calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  user_id uuid,
  slug text UNIQUE NOT NULL,            -- public URL: /?book=lamin-discovery
  name text NOT NULL,
  description text,
  duration_minutes int NOT NULL DEFAULT 30,
  buffer_before_minutes int NOT NULL DEFAULT 0,
  buffer_after_minutes int NOT NULL DEFAULT 15,
  min_notice_hours int NOT NULL DEFAULT 4,         -- can't book within X hours of now
  max_advance_days int NOT NULL DEFAULT 60,        -- can't book more than X days ahead
  timezone text NOT NULL DEFAULT 'America/New_York',
  color text DEFAULT '#FFD60A',
  meeting_provider text DEFAULT 'manual',          -- manual | zoom | meet | phone
  meeting_link text,                                -- static link (Zoom/Meet) OR generated per-booking
  redirect_url text,                                -- post-booking thank-you redirect (optional)
  ask_for_phone boolean DEFAULT false,
  custom_questions jsonb DEFAULT '[]'::jsonb,      -- [{label, type:'text|textarea|select', required, options}]
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendars_slug_idx ON calendars(slug);
CREATE INDEX IF NOT EXISTS calendars_user_idx ON calendars(user_id);

-- ============================================================
-- AVAILABILITY RULES — recurring weekly availability per calendar
-- 0=Sunday, 6=Saturday. Times are HH:MM in calendar's timezone.
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid REFERENCES calendars(id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time text NOT NULL,             -- '09:00'
  end_time text NOT NULL                -- '17:00'
);
CREATE INDEX IF NOT EXISTS calendar_availability_cal_idx ON calendar_availability(calendar_id, day_of_week);

-- ============================================================
-- OVERRIDES — block specific dates (vacation) or add one-off slots
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid REFERENCES calendars(id) ON DELETE CASCADE,
  date date NOT NULL,
  type text NOT NULL,                   -- 'block' | 'add'
  start_time text,                      -- only for 'add'
  end_time text,                        -- only for 'add'
  note text
);
CREATE INDEX IF NOT EXISTS calendar_overrides_cal_idx ON calendar_overrides(calendar_id, date);

-- ============================================================
-- BOOKINGS — confirmed appointments
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid REFERENCES calendars(id) ON DELETE CASCADE,
  workspace_id uuid,
  attendee_name text NOT NULL,
  attendee_email text NOT NULL,
  attendee_phone text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  duration_minutes int NOT NULL,
  timezone text,
  status text NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled | rescheduled | no_show | completed
  meeting_link text,
  cancellation_token text UNIQUE,            -- emailed; lets attendee cancel without auth
  reschedule_token text UNIQUE,
  custom_answers jsonb DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz DEFAULT now(),
  cancelled_at timestamptz,
  reminder_sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS bookings_calendar_idx ON bookings(calendar_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_attendee_idx ON bookings(attendee_email, starts_at);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings(status, starts_at);
CREATE INDEX IF NOT EXISTS bookings_cancellation_token_idx ON bookings(cancellation_token);

-- ============================================================
-- NEWSLETTER LISTS — multiple lists per workspace
-- (subscribers table already exists from earlier migration)
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  user_id uuid,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  double_opt_in boolean DEFAULT true,
  welcome_email_subject text,
  welcome_email_html text,
  redirect_url text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS newsletter_lists_slug_idx ON newsletter_lists(slug);

-- Add list_id to subscribers (nullable, defaults to workspace's default list)
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS list_id uuid;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS confirmation_token text UNIQUE;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
CREATE INDEX IF NOT EXISTS subscribers_list_idx ON subscribers(list_id, status);

-- ============================================================
-- Permissive demo policies (matches existing pattern)
-- ============================================================
ALTER TABLE calendars               ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendars_all               ON calendars;
CREATE POLICY calendars_all               ON calendars               FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE calendar_availability   ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_availability_all   ON calendar_availability;
CREATE POLICY calendar_availability_all   ON calendar_availability   FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE calendar_overrides      ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_overrides_all      ON calendar_overrides;
CREATE POLICY calendar_overrides_all      ON calendar_overrides      FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE bookings                ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bookings_all                ON bookings;
CREATE POLICY bookings_all                ON bookings                FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE newsletter_lists        ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS newsletter_lists_all        ON newsletter_lists;
CREATE POLICY newsletter_lists_all        ON newsletter_lists        FOR ALL USING (true) WITH CHECK (true);
