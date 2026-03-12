-- Unity waitlist table
CREATE TABLE IF NOT EXISTS unity_waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Unique constraint on email (prevents duplicates, also used for race-condition handling)
CREATE UNIQUE INDEX IF NOT EXISTS unity_waitlist_email_unique ON unity_waitlist (email);

-- Enable RLS (but allow service role to bypass)
ALTER TABLE unity_waitlist ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed — only the service role (backend) writes to this table.
-- The API endpoint uses getSupabaseAdmin() which bypasses RLS.
