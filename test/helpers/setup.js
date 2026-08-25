const { buildApp } = require('../../src/app');

const TEST_CONNECTION_STRING = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/calendar_invite_test';

const TEST_DEFAULTS = {
  sessionSecret: 'test-secret-that-is-at-least-32-characters-long',
  encryptionKey: 'a'.repeat(64),
};

async function createTestApp(opts = {}) {
  const app = await buildApp({
    connectionString: TEST_CONNECTION_STRING,
    ...TEST_DEFAULTS,
    ...opts,
  });
  await app.ready();
  return app;
}

async function cleanDatabase(app) {
  await app.db.run('DELETE FROM rate_limits');
  await app.db.run('DELETE FROM bookings');
  await app.db.run('DELETE FROM default_attendees');
  await app.db.run('DELETE FROM profile_write_calendars');
  await app.db.run('DELETE FROM profile_read_calendars');
  await app.db.run('DELETE FROM schedule_overrides');
  await app.db.run('DELETE FROM schedule_templates');
  await app.db.run('DELETE FROM default_schedule_templates');
  await app.db.run('DELETE FROM booking_profiles');
  await app.db.run('DELETE FROM calendar_connections');
  await app.db.run('DELETE FROM admin');
}

module.exports = { createTestApp, cleanDatabase, TEST_DEFAULTS, TEST_CONNECTION_STRING };
