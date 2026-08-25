const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createTestApp, cleanDatabase } = require('./helpers/setup');
const { encrypt } = require('../src/encryption');

const ENCRYPTION_KEY = 'a'.repeat(64);

function getNextMonday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const daysUntilMonday = ((8 - d.getUTCDay()) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  return d.toISOString().split('T')[0];
}

describe('Booking Submission - POST /api/book/:slug', () => {
  let app, adminId;
  let calendarEventCreated;
  let lastEventPayload;

  before(async () => {
    calendarEventCreated = false;
    lastEventPayload = null;

    const mockFetch = (url, opts) => {
      if (typeof url === 'string' && url.includes('freeBusy')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ calendars: { primary: { busy: [] } } }),
        });
      }
      if (typeof url === 'string' && url.includes('/calendars/primary/events')) {
        calendarEventCreated = true;
        lastEventPayload = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'google-event-123' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    };

    app = await createTestApp({ fetchFn: mockFetch });
    await cleanDatabase(app);
    const hash = await bcrypt.hash('test-pass', 10);
    const result = await app.db.query('INSERT INTO admin (email, username, password_hash, timezone) VALUES ($1, $2, $3, $4) RETURNING id', ['admin@test.com', 'admin', hash, 'UTC']);
    adminId = result.rows[0].id;
  });

  after(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  it('successfully creates a booking and stores record', async () => {
    const connResult = await app.db.query(
      "INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [adminId, 'google', encrypt('fake-token', ENCRYPTION_KEY), '', '2030-01-01T00:00:00Z', 'cal@test.com', 'connected']
    );
    const connId = connResult.rows[0].id;

    const profileResult = await app.db.query(
      "INSERT INTO booking_profiles (user_id, slug, name, is_active, write_calendar_id, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [adminId, 'book-test', 'Book Test', true, connId, '2026-01-01T00:00:00Z']
    );
    const profileId = profileResult.rows[0].id;
    await app.db.run("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)", [profileId, 1, '09:00', '17:00']);
    await app.db.run("INSERT INTO profile_write_calendars (profile_id, calendar_connection_id) VALUES ($1, $2)", [profileId, connId]);

    calendarEventCreated = false;
    lastEventPayload = null;

    const monday = getNextMonday();
    const response = await app.inject({
      method: 'POST',
      url: '/api/book/book-test',
      headers: { 'content-type': 'application/json' },
      payload: {
        name: 'John Doe',
        email: 'john@example.com',
        start_time: `${monday}T09:00:00.000Z`,
        duration: 30,
        timezone: 'UTC',
      },
    });

    assert.equal(response.statusCode, 200);
    const data = JSON.parse(response.body);
    assert.ok(data.booking);
    assert.equal(data.booking.booker_name, 'John Doe');
    assert.equal(data.booking.booker_email, 'john@example.com');
    assert.equal(data.booking.duration_minutes, 30);
    assert.ok(data.booking.cancellation_token);

    const stored = await app.db.getOne("SELECT * FROM bookings WHERE profile_id = $1", [profileId]);
    assert.ok(stored);
    assert.equal(stored.status, 'confirmed');
    assert.equal(stored.booker_name, 'John Doe');

    await app.db.run("DELETE FROM bookings WHERE profile_id = $1", [profileId]);
    await app.db.run("DELETE FROM profile_write_calendars WHERE profile_id = $1", [profileId]);
    await app.db.run("DELETE FROM schedule_templates WHERE profile_id = $1", [profileId]);
    await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
    await app.db.run("DELETE FROM calendar_connections WHERE id = $1", [connId]);
  });

  it('rejects missing name', async () => {
    const profileResult = await app.db.query(
      "INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [adminId, 'validate-name', 'Validate Name', true, '2026-01-01T00:00:00Z']
    );
    const profileId = profileResult.rows[0].id;

    const response = await app.inject({
      method: 'POST',
      url: '/api/book/validate-name',
      headers: { 'content-type': 'application/json' },
      payload: {
        email: 'test@example.com',
        start_time: '2026-07-06T09:00:00.000Z',
        duration: 30,
        timezone: 'UTC',
      },
    });

    assert.equal(response.statusCode, 400);
    const data = JSON.parse(response.body);
    assert.ok(data.error.includes('name'));

    await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
  });

  it('rejects missing email', async () => {
    const profileResult = await app.db.query(
      "INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [adminId, 'validate-email', 'Validate Email', true, '2026-01-01T00:00:00Z']
    );
    const profileId = profileResult.rows[0].id;

    const response = await app.inject({
      method: 'POST',
      url: '/api/book/validate-email',
      headers: { 'content-type': 'application/json' },
      payload: {
        name: 'Test Person',
        start_time: '2026-07-06T09:00:00.000Z',
        duration: 30,
        timezone: 'UTC',
      },
    });

    assert.equal(response.statusCode, 400);
    const data = JSON.parse(response.body);
    assert.ok(data.error.includes('email'));

    await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
  });

  it('returns 404 for non-existent profile', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/book/nonexistent-slug',
      headers: { 'content-type': 'application/json' },
      payload: {
        name: 'Test',
        email: 'test@example.com',
        start_time: '2026-07-06T09:00:00.000Z',
        duration: 30,
        timezone: 'UTC',
      },
    });

    assert.equal(response.statusCode, 404);
  });
});
