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

describe('Booking Cancellation - GET /cancel/:token', () => {
  let app, adminId;

  before(async () => {
    app = await createTestApp();
    await cleanDatabase(app);
    const hash = await bcrypt.hash('test-pass', 10);
    const result = await app.db.query('INSERT INTO admin (email, username, password_hash, timezone) VALUES ($1, $2, $3, $4) RETURNING id', ['admin@test.com', 'admin', hash, 'UTC']);
    adminId = result.rows[0].id;
  });

  after(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  it('renders cancellation confirmation page with booking details', async () => {
    const profileResult = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'cancel-page', 'Cancel Page', true, '2026-01-01T00:00:00Z']);
    const profileId = profileResult.rows[0].id;
    const monday = getNextMonday();

    await app.db.run(
      "INSERT INTO bookings (profile_id, booker_name, booker_email, additional_attendees, title, description, start_time, end_time, duration_minutes, cancellation_token, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
      [profileId, 'Jane Smith', 'jane@example.com', JSON.stringify(['bob@example.com']), 'Project Review', null, `${monday}T14:00:00.000Z`, `${monday}T14:30:00.000Z`, 30, 'valid-token-1', 'confirmed', '2026-01-01T00:00:00Z']
    );

    const response = await app.inject({
      method: 'GET',
      url: '/cancel/valid-token-1',
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.body.includes('Project Review'));
    assert.ok(response.body.includes('jane@example.com'));

    await app.db.run("DELETE FROM bookings WHERE profile_id = $1", [profileId]);
    await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
  });

  it('returns 404 for invalid token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/cancel/nonexistent-token',
    });
    assert.equal(response.statusCode, 404);
  });

  it('shows already-cancelled message for cancelled booking', async () => {
    const profileResult = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'cancel-already', 'Cancel Already', true, '2026-01-01T00:00:00Z']);
    const profileId = profileResult.rows[0].id;
    const monday = getNextMonday();

    await app.db.run(
      "INSERT INTO bookings (profile_id, booker_name, booker_email, title, start_time, end_time, duration_minutes, cancellation_token, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [profileId, 'Test', 'test@test.com', 'Test', `${monday}T09:00:00.000Z`, `${monday}T09:30:00.000Z`, 30, 'already-cancelled-token', 'cancelled', '2026-01-01T00:00:00Z']
    );

    const response = await app.inject({
      method: 'GET',
      url: '/cancel/already-cancelled-token',
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.body.includes('already been cancelled'));

    await app.db.run("DELETE FROM bookings WHERE profile_id = $1", [profileId]);
    await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
  });
});

describe('Booking Cancellation - POST /api/cancel/:token', () => {
  let app, adminId;
  let deleteEventCalled;

  before(async () => {
    deleteEventCalled = false;

    const mockFetch = (url, opts) => {
      if (opts && opts.method === 'DELETE') {
        deleteEventCalled = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
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

  it('cancels a booking and updates status in DB', async () => {
    const connResult = await app.db.query(
      "INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [adminId, 'google', encrypt('fake-token', ENCRYPTION_KEY), '', '2030-01-01T00:00:00Z', 'cal@test.com', 'connected']
    );
    const connId = connResult.rows[0].id;

    const profileResult = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, write_calendar_id, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", [adminId, 'cancel-api', 'Cancel API', true, connId, '2026-01-01T00:00:00Z']);
    const profileId = profileResult.rows[0].id;
    const monday = getNextMonday();

    await app.db.run(
      "INSERT INTO bookings (profile_id, booker_name, booker_email, title, start_time, end_time, duration_minutes, cancellation_token, status, calendar_event_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      [profileId, 'John', 'john@test.com', 'Meeting', `${monday}T09:00:00.000Z`, `${monday}T09:30:00.000Z`, 30, 'cancel-me-token', 'confirmed', 'google-event-to-delete', '2026-01-01T00:00:00Z']
    );

    deleteEventCalled = false;

    const response = await app.inject({
      method: 'POST',
      url: '/api/cancel/cancel-me-token',
    });

    // API now redirects to the cancellation page after processing
    assert.equal(response.statusCode, 302);
    assert.ok(response.headers.location.includes('/cancel/cancel-me-token'));

    const booking = await app.db.getOne("SELECT * FROM bookings WHERE cancellation_token = $1", ['cancel-me-token']);
    assert.equal(booking.status, 'cancelled');

    await app.db.run("DELETE FROM bookings WHERE profile_id = $1", [profileId]);
    await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
    await app.db.run("DELETE FROM calendar_connections WHERE id = $1", [connId]);
  });

  it('returns 404 for invalid token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/cancel/nonexistent-token',
    });

    assert.equal(response.statusCode, 404);
    const data = JSON.parse(response.body);
    assert.ok(data.error.includes('not found'));
  });

  it('redirects for already-cancelled booking', async () => {
    const profileResult = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'cancel-twice', 'Cancel Twice', true, '2026-01-01T00:00:00Z']);
    const profileId = profileResult.rows[0].id;
    const monday = getNextMonday();

    await app.db.run(
      "INSERT INTO bookings (profile_id, booker_name, booker_email, title, start_time, end_time, duration_minutes, cancellation_token, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [profileId, 'Test', 'test@test.com', 'Test', `${monday}T09:00:00.000Z`, `${monday}T09:30:00.000Z`, 30, 'already-done-token', 'cancelled', '2026-01-01T00:00:00Z']
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/cancel/already-done-token',
    });

    // Already cancelled bookings also redirect to the cancel page which shows the "already cancelled" message
    assert.ok(response.statusCode === 302 || response.statusCode === 400);

    await app.db.run("DELETE FROM bookings WHERE profile_id = $1", [profileId]);
    await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
  });
});
