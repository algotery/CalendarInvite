const { Pool } = require('pg');

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS admin (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    notification_email TEXT DEFAULT '',
    theme TEXT NOT NULL DEFAULT 'system'
  );

  CREATE TABLE IF NOT EXISTS calendar_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider IN ('google', 'microsoft', 'zoho')),
    encrypted_access_token TEXT,
    encrypted_refresh_token TEXT,
    token_expiry TEXT,
    email TEXT,
    status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN ('connected', 'expired'))
  );

  CREATE TABLE IF NOT EXISTS booking_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    write_calendar_id INTEGER REFERENCES calendar_connections(id),
    meeting_link_url TEXT,
    meeting_tool TEXT CHECK(meeting_tool IN ('teams', 'meet')),
    buffer_time_minutes INTEGER NOT NULL DEFAULT 0,
    allowed_durations TEXT NOT NULL DEFAULT '[30,45,60]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile_read_calendars (
    profile_id INTEGER NOT NULL REFERENCES booking_profiles(id) ON DELETE CASCADE,
    calendar_connection_id INTEGER NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
    PRIMARY KEY (profile_id, calendar_connection_id)
  );

  CREATE TABLE IF NOT EXISTS profile_write_calendars (
    profile_id INTEGER NOT NULL REFERENCES booking_profiles(id) ON DELETE CASCADE,
    calendar_connection_id INTEGER NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
    PRIMARY KEY (profile_id, calendar_connection_id)
  );

  CREATE TABLE IF NOT EXISTS default_attendees (
    id SERIAL PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES booking_profiles(id) ON DELETE CASCADE,
    email TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedule_templates (
    id SERIAL PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES booking_profiles(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS default_schedule_templates (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedule_overrides (
    id SERIAL PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES booking_profiles(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    is_blocked INTEGER NOT NULL DEFAULT 0,
    custom_ranges TEXT,
    UNIQUE(profile_id, date)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES booking_profiles(id) ON DELETE CASCADE,
    booker_name TEXT NOT NULL,
    booker_email TEXT NOT NULL,
    additional_attendees TEXT,
    title TEXT NOT NULL,
    description TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    cancellation_token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled')),
    calendar_event_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('ip', 'email')),
    endpoint TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rate_limits_key_type ON rate_limits(key, type);
  CREATE INDEX IF NOT EXISTS idx_rate_limits_timestamp ON rate_limits(timestamp);
  CREATE INDEX IF NOT EXISTS idx_bookings_profile_status ON bookings(profile_id, status);
  CREATE INDEX IF NOT EXISTS idx_bookings_start_time ON bookings(start_time);
  CREATE INDEX IF NOT EXISTS idx_bookings_profile_start ON bookings(profile_id, start_time);
  CREATE INDEX IF NOT EXISTS idx_bookings_cancellation_token ON bookings(cancellation_token);
  CREATE INDEX IF NOT EXISTS idx_profiles_slug ON booking_profiles(slug);
  CREATE INDEX IF NOT EXISTS idx_profiles_active ON booking_profiles(is_active);
  CREATE INDEX IF NOT EXISTS idx_schedule_templates_profile_day ON schedule_templates(profile_id, day_of_week);
  CREATE INDEX IF NOT EXISTS idx_schedule_overrides_profile_date ON schedule_overrides(profile_id, date);
`;

async function createDatabase(connectionString) {
  const pool = new Pool({ connectionString });

  await pool.query(SCHEMA_SQL);

  await pool.query(`ALTER TABLE admin ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'system'`).catch(() => {});
  await pool.query(`ALTER TABLE admin ADD COLUMN IF NOT EXISTS time_format TEXT NOT NULL DEFAULT '12h'`).catch(() => {});
  await pool.query(`ALTER TABLE admin ADD COLUMN IF NOT EXISTS onboarding_completed_at TEXT`).catch(() => {});
  await pool.query(`UPDATE admin SET onboarding_completed_at = NOW()::TEXT WHERE onboarding_completed_at IS NULL AND id IN (SELECT DISTINCT user_id FROM booking_profiles)`).catch(() => {});
  await pool.query(`ALTER TABLE booking_profiles ADD COLUMN IF NOT EXISTS allowed_durations TEXT NOT NULL DEFAULT '[30,45,60]'`).catch(() => {});
  await pool.query(`ALTER TABLE booking_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT`).catch(() => {});

  return {
    async query(text, params) {
      const result = await pool.query(text, params);
      return result;
    },
    async getOne(text, params) {
      const result = await pool.query(text, params);
      return result.rows[0] || null;
    },
    async getAll(text, params) {
      const result = await pool.query(text, params);
      return result.rows;
    },
    async run(text, params) {
      const result = await pool.query(text, params);
      return result;
    },
    async close() {
      await pool.end();
    },
    pool,
  };
}

module.exports = { createDatabase };
