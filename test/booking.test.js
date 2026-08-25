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

describe('Public Booking Page', () => {
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

  describe('GET /book/:slug', () => {
    it('renders the booking page for an active profile', async () => {
      await app.db.run("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5)", [adminId, 'test-profile', 'Test Profile', true, '2026-01-01T00:00:00Z']);
      const response = await app.inject({ method: 'GET', url: '/book/test-profile' });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('Test Profile'));
      await app.db.run("DELETE FROM booking_profiles WHERE slug = $1", ['test-profile']);
    });

    it('shows not accepting message for inactive profile', async () => {
      await app.db.run("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5)", [adminId, 'inactive', 'Inactive', false, '2026-01-01T00:00:00Z']);
      const response = await app.inject({ method: 'GET', url: '/book/inactive' });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('not currently accepting bookings'));
      await app.db.run("DELETE FROM booking_profiles WHERE slug = $1", ['inactive']);
    });

    it('returns 404 for non-existent slug', async () => {
      const response = await app.inject({ method: 'GET', url: '/book/nonexistent' });
      assert.equal(response.statusCode, 404);
    });
  });
});

describe('Availability Slots API', () => {
  let app, adminId;

  before(async () => {
    app = await createTestApp({
      fetchFn: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ calendars: { primary: { busy: [] } } }) }),
    });
    await cleanDatabase(app);
    const hash = await bcrypt.hash('test-pass', 10);
    const result = await app.db.query('INSERT INTO admin (email, username, password_hash, timezone) VALUES ($1, $2, $3, $4) RETURNING id', ['admin@test.com', 'admin', hash, 'UTC']);
    adminId = result.rows[0].id;
  });

  after(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  describe('GET /api/book/:slug/slots', () => {
    it('returns 404 for non-existent slug', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/book/nonexistent/slots?date=2026-07-01&duration=30',
      });
      assert.equal(response.statusCode, 404);
    });

    it('returns 400 if date or duration missing', async () => {
      await app.db.run("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5)", [adminId, 'slots-test', 'Slots Test', true, '2026-01-01T00:00:00Z']);
      const response = await app.inject({
        method: 'GET',
        url: '/api/book/slots-test/slots',
      });
      assert.equal(response.statusCode, 400);
      await app.db.run("DELETE FROM booking_profiles WHERE slug = $1", ['slots-test']);
    });

    it('returns slots from schedule template', async () => {
      const result = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'template-slots', 'Template Slots', true, '2026-01-01T00:00:00Z']);
      const profileId = result.rows[0].id;
      // Monday = day_of_week 1
      await app.db.run("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)", [profileId, 1, '09:00', '12:00']);

      const monday = getNextMonday();
      const response = await app.inject({
        method: 'GET',
        url: `/api/book/template-slots/slots?date=${monday}&duration=30&timezone=UTC`,
      });
      assert.equal(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.ok(Array.isArray(data.slots));
      assert.ok(data.slots.length > 0);
      assert.equal(data.slots.length, 6);
      assert.equal(data.slots[0].start, `${monday}T09:00:00.000Z`);

      await app.db.run("DELETE FROM schedule_templates WHERE profile_id = $1", [profileId]);
      await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
    });

    it('returns empty slots when no template for that day', async () => {
      const result = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'no-template', 'No Template', true, '2026-01-01T00:00:00Z']);
      const profileId = result.rows[0].id;
      // Tuesday = day 2, but we'll query Monday
      await app.db.run("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)", [profileId, 2, '09:00', '12:00']);

      const response = await app.inject({
        method: 'GET',
        url: `/api/book/no-template/slots?date=${getNextMonday()}&duration=30&timezone=UTC`,
      });
      assert.equal(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.equal(data.slots.length, 0);

      await app.db.run("DELETE FROM schedule_templates WHERE profile_id = $1", [profileId]);
      await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
    });

    it('applies blocked override to remove all slots', async () => {
      const result = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'blocked-day', 'Blocked Day', true, '2026-01-01T00:00:00Z']);
      const profileId = result.rows[0].id;
      await app.db.run("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)", [profileId, 1, '09:00', '12:00']);
      const monday = getNextMonday();
      await app.db.run("INSERT INTO schedule_overrides (profile_id, date, is_blocked) VALUES ($1, $2, $3)", [profileId, monday, 1]);

      const response = await app.inject({
        method: 'GET',
        url: `/api/book/blocked-day/slots?date=${monday}&duration=30&timezone=UTC`,
      });
      assert.equal(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.equal(data.slots.length, 0);

      await app.db.run("DELETE FROM schedule_overrides WHERE profile_id = $1", [profileId]);
      await app.db.run("DELETE FROM schedule_templates WHERE profile_id = $1", [profileId]);
      await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
    });

    it('removes slots conflicting with existing bookings', async () => {
      const result = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'booking-conflict', 'Booking Conflict', true, '2026-01-01T00:00:00Z']);
      const profileId = result.rows[0].id;
      await app.db.run("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)", [profileId, 1, '09:00', '12:00']);
      const monday = getNextMonday();
      await app.db.run(
        "INSERT INTO bookings (profile_id, booker_name, booker_email, title, start_time, end_time, duration_minutes, cancellation_token, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [profileId, 'Test Booker', 'booker@test.com', 'Test', `${monday}T09:00:00.000Z`, `${monday}T09:30:00.000Z`, 30, `cancel-${Date.now()}`, 'confirmed', new Date().toISOString()]
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/book/booking-conflict/slots?date=${monday}&duration=30&timezone=UTC`,
      });
      assert.equal(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.equal(data.slots.length, 5);
      assert.equal(data.slots[0].start, `${monday}T09:30:00.000Z`);

      await app.db.run("DELETE FROM bookings WHERE profile_id = $1", [profileId]);
      await app.db.run("DELETE FROM schedule_templates WHERE profile_id = $1", [profileId]);
      await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
    });
  });
});
