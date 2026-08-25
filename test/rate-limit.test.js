const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createTestApp, cleanDatabase } = require('./helpers/setup');

function getNextMonday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const daysUntilMonday = ((8 - d.getUTCDay()) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  return d.toISOString().split('T')[0];
}

describe('Rate Limiting - POST /api/book/:slug', () => {
  let app, adminId;

  before(async () => {
    const mockFetch = (url) => {
      if (typeof url === 'string' && url.includes('freeBusy')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ calendars: { primary: { busy: [] } } }) });
      }
      if (typeof url === 'string' && url.includes('/calendars/primary/events')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'event-' + Date.now() }) });
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

  it('6th booking from same email in 24h returns 429', async () => {
    const profileResult = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'rate-email-test', 'Rate Email Test', true, '2026-01-01T00:00:00Z']);
    const profileId = profileResult.rows[0].id;
    await app.db.run("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)", [profileId, 1, '09:00', '17:00']);

    for (let i = 0; i < 5; i++) {
      const hour = String(9 + i).padStart(2, '0');
      const response = await app.inject({
        method: 'POST',
        url: '/api/book/rate-email-test',
        headers: { 'content-type': 'application/json' },
        payload: {
          name: 'Rate Test',
          email: 'ratelimit@example.com',
          start_time: `${getNextMonday()}T${hour}:00:00.000Z`,
          duration: 30,
          timezone: 'UTC',
        },
      });
      assert.equal(response.statusCode, 200, `Booking ${i + 1} should succeed`);
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/book/rate-email-test',
      headers: { 'content-type': 'application/json' },
      payload: {
        name: 'Rate Test',
        email: 'ratelimit@example.com',
        start_time: `${getNextMonday()}T14:00:00.000Z`,
        duration: 30,
        timezone: 'UTC',
      },
    });

    assert.equal(response.statusCode, 429);
    const data = JSON.parse(response.body);
    assert.ok(data.error.toLowerCase().includes('too many'));

    await app.db.run("DELETE FROM rate_limits");
    await app.db.run("DELETE FROM bookings WHERE profile_id = $1", [profileId]);
    await app.db.run("DELETE FROM schedule_templates WHERE profile_id = $1", [profileId]);
    await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
  });

  it('different emails are rate limited independently', async () => {
    const profileResult = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'rate-indep-test', 'Rate Indep Test', true, '2026-01-01T00:00:00Z']);
    const profileId = profileResult.rows[0].id;
    await app.db.run("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)", [profileId, 1, '09:00', '17:00']);

    for (let i = 0; i < 5; i++) {
      const hour = String(9 + i).padStart(2, '0');
      await app.inject({
        method: 'POST',
        url: '/api/book/rate-indep-test',
        headers: { 'content-type': 'application/json' },
        payload: {
          name: 'User A',
          email: 'usera@example.com',
          start_time: `${getNextMonday()}T${hour}:00:00.000Z`,
          duration: 30,
          timezone: 'UTC',
        },
      });
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/book/rate-indep-test',
      headers: { 'content-type': 'application/json' },
      payload: {
        name: 'User B',
        email: 'userb@example.com',
        start_time: `${getNextMonday()}T14:00:00.000Z`,
        duration: 30,
        timezone: 'UTC',
      },
    });

    assert.equal(response.statusCode, 200);

    await app.db.run("DELETE FROM rate_limits");
    await app.db.run("DELETE FROM bookings WHERE profile_id = $1", [profileId]);
    await app.db.run("DELETE FROM schedule_templates WHERE profile_id = $1", [profileId]);
    await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
  });
});
