const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createTestApp, cleanDatabase } = require('./helpers/setup');

async function login(app) {
  const loginPage = await app.inject({ method: 'GET', url: '/admin/login' });
  const csrfToken = loginPage.body.match(/name="_csrf" value="([^"]+)"/)[1];
  const cookies = loginPage.headers['set-cookie'];

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
    payload: { email: 'admin@test.com', password: 'test-pass', _csrf: csrfToken },
  });

  return loginResponse.headers['set-cookie'];
}

async function getCsrfAndCookies(app, url, sessionCookies) {
  const page = await app.inject({
    method: 'GET',
    url,
    headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
  });
  const csrf = page.body.match(/name="_csrf" value="([^"]+)"/)[1];
  const cookies = page.headers['set-cookie'] || sessionCookies;
  return { csrf, cookies, body: page.body, statusCode: page.statusCode };
}

describe('Admin Dashboard - GET /admin/dashboard', () => {
  let app, sessionCookies, adminId;

  before(async () => {
    app = await createTestApp();
    await cleanDatabase(app);
    const hash = await bcrypt.hash('test-pass', 10);
    const result = await app.db.query('INSERT INTO admin (email, username, password_hash, timezone, onboarding_completed_at) VALUES ($1, $2, $3, $4, $5) RETURNING id', ['admin@test.com', 'admin', hash, 'America/New_York', new Date().toISOString()]);
    adminId = result.rows[0].id;
    sessionCookies = await login(app);
  });

  after(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  it('shows number of active profiles', async () => {
    await app.db.run("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5)", [adminId, 'active-1', 'Active One', true, '2026-01-01T00:00:00Z']);
    await app.db.run("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5)", [adminId, 'inactive-1', 'Inactive One', false, '2026-01-01T00:00:00Z']);

    const response = await app.inject({
      method: 'GET',
      url: '/admin/dashboard',
      headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.body.includes('1'));
    assert.ok(response.body.includes('Active Profiles'));

    await app.db.run("DELETE FROM booking_profiles");
  });

  it('shows number of upcoming bookings', async () => {
    const profileResult = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'dash-profile', 'Dash Profile', true, '2026-01-01T00:00:00Z']);
    const profileId = profileResult.rows[0].id;

    await app.db.run(
      "INSERT INTO bookings (profile_id, booker_name, booker_email, title, start_time, end_time, duration_minutes, cancellation_token, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [profileId, 'Booker', 'b@t.com', 'Meeting', '2099-07-10T10:00:00.000Z', '2099-07-10T10:30:00.000Z', 30, 'cancel-1', 'confirmed', '2026-06-01T00:00:00Z']
    );
    await app.db.run(
      "INSERT INTO bookings (profile_id, booker_name, booker_email, title, start_time, end_time, duration_minutes, cancellation_token, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [profileId, 'Booker2', 'b2@t.com', 'Meeting2', '2099-07-11T10:00:00.000Z', '2099-07-11T10:30:00.000Z', 30, 'cancel-2', 'confirmed', '2026-06-01T00:00:00Z']
    );
    await app.db.run(
      "INSERT INTO bookings (profile_id, booker_name, booker_email, title, start_time, end_time, duration_minutes, cancellation_token, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [profileId, 'Booker3', 'b3@t.com', 'Meeting3', '2099-07-12T10:00:00.000Z', '2099-07-12T10:30:00.000Z', 30, 'cancel-3', 'cancelled', '2026-06-01T00:00:00Z']
    );

    const response = await app.inject({
      method: 'GET',
      url: '/admin/dashboard',
      headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.body.includes('Upcoming Bookings'));
    assert.ok(response.body.includes('2'));

    await app.db.run("DELETE FROM bookings");
    await app.db.run("DELETE FROM booking_profiles");
  });
});

describe('Admin Bookings List - GET /admin/bookings', () => {
  let app, sessionCookies, adminId;

  before(async () => {
    app = await createTestApp();
    await cleanDatabase(app);
    const hash = await bcrypt.hash('test-pass', 10);
    const result = await app.db.query('INSERT INTO admin (email, username, password_hash, timezone, onboarding_completed_at) VALUES ($1, $2, $3, $4, $5) RETURNING id', ['admin@test.com', 'admin', hash, 'UTC', new Date().toISOString()]);
    adminId = result.rows[0].id;
    sessionCookies = await login(app);
  });

  after(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  it('shows paginated list of all bookings', async () => {
    const profileResult = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'list-profile', 'List Profile', true, '2026-01-01T00:00:00Z']);
    const profileId = profileResult.rows[0].id;

    await app.db.run(
      "INSERT INTO bookings (profile_id, booker_name, booker_email, title, start_time, end_time, duration_minutes, cancellation_token, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [profileId, 'Future Booker', 'f@t.com', 'Future', '2099-12-01T10:00:00.000Z', '2099-12-01T10:30:00.000Z', 30, 'cancel-future', 'confirmed', '2026-06-01T00:00:00Z']
    );
    await app.db.run(
      "INSERT INTO bookings (profile_id, booker_name, booker_email, title, start_time, end_time, duration_minutes, cancellation_token, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [profileId, 'Past Booker', 'p@t.com', 'Past', '2020-01-01T10:00:00.000Z', '2020-01-01T10:30:00.000Z', 30, 'cancel-past', 'confirmed', '2020-01-01T00:00:00Z']
    );

    const response = await app.inject({
      method: 'GET',
      url: '/admin/bookings?filter=all',
      headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.body.includes('Future Booker'));
    assert.ok(response.body.includes('Past Booker'));

    await app.db.run("DELETE FROM bookings");
    await app.db.run("DELETE FROM booking_profiles");
  });
});

describe('Admin Booking Cancellation - POST /admin/bookings/:id/cancel', () => {
  let app, sessionCookies, adminId;

  before(async () => {
    app = await createTestApp({
      fetchFn: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    });
    await cleanDatabase(app);
    const hash = await bcrypt.hash('test-pass', 10);
    const result = await app.db.query('INSERT INTO admin (email, username, password_hash, timezone, onboarding_completed_at) VALUES ($1, $2, $3, $4, $5) RETURNING id', ['admin@test.com', 'admin', hash, 'UTC', new Date().toISOString()]);
    adminId = result.rows[0].id;
    sessionCookies = await login(app);
  });

  after(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  it('cancels a confirmed booking and updates status', async () => {
    const profileResult = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'cancel-admin', 'Cancel Admin', true, '2026-01-01T00:00:00Z']);
    const profileId = profileResult.rows[0].id;

    const bookingResult = await app.db.query(
      "INSERT INTO bookings (profile_id, booker_name, booker_email, title, start_time, end_time, duration_minutes, cancellation_token, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id",
      [profileId, 'Booker', 'b@t.com', 'Meeting', '2099-07-10T10:00:00.000Z', '2099-07-10T10:30:00.000Z', 30, 'cancel-admin-token', 'confirmed', '2026-06-01T00:00:00Z']
    );
    const bookingId = bookingResult.rows[0].id;

    const { csrf, cookies } = await getCsrfAndCookies(app, '/admin/bookings?filter=all', sessionCookies);

    const response = await app.inject({
      method: 'POST',
      url: `/admin/bookings/${bookingId}/cancel`,
      headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
      payload: { _csrf: csrf },
    });

    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, '/admin/bookings');

    const booking = await app.db.getOne("SELECT * FROM bookings WHERE id = $1", [bookingId]);
    assert.equal(booking.status, 'cancelled');

    await app.db.run("DELETE FROM bookings");
    await app.db.run("DELETE FROM booking_profiles");
  });

  it('returns 404 for non-existent booking', async () => {
    const { csrf, cookies } = await getCsrfAndCookies(app, '/admin/dashboard', sessionCookies);

    const response = await app.inject({
      method: 'POST',
      url: '/admin/bookings/99999/cancel',
      headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
      payload: { _csrf: csrf },
    });

    assert.equal(response.statusCode, 404);
  });
});
