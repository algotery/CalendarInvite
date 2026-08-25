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

async function getCsrf(app, url, cookies) {
  const page = await app.inject({
    method: 'GET',
    url,
    headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
  });
  const token = page.body.match(/name="_csrf" value="([^"]+)"/)[1];
  const newCookies = page.headers['set-cookie'] || cookies;
  return { token, cookies: newCookies, body: page.body, statusCode: page.statusCode };
}

describe('Booking Profile CRUD', () => {
  let app;
  let sessionCookies;
  let adminId;

  before(async () => {
    app = await createTestApp();
    await cleanDatabase(app);

    const hash = await bcrypt.hash('test-pass', 10);
    const result = await app.db.query('INSERT INTO admin (email, username, password_hash, timezone) VALUES ($1, $2, $3, $4) RETURNING id', ['admin@test.com', 'admin', hash, 'UTC']);
    adminId = result.rows[0].id;

    sessionCookies = await login(app);
  });

  after(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  describe('GET /admin/profiles', () => {
    it('lists all booking profiles', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/profiles',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('Profiles'));
    });

    it('shows created profiles with slug, name and status', async () => {
      await app.db.run("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5)", [adminId, 'test-profile', 'Test Profile', true, new Date().toISOString()]);

      const response = await app.inject({
        method: 'GET',
        url: '/admin/profiles',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('test-profile'));
      assert.ok(response.body.includes('Test Profile'));

      await app.db.run("DELETE FROM booking_profiles WHERE slug = $1", ['test-profile']);
    });
  });

  describe('GET /admin/profiles/new', () => {
    it('renders a creation form', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/profiles/new',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('name="slug"'));
      assert.ok(response.body.includes('name="name"'));
    });
  });

  describe('POST /admin/profiles', () => {
    it('creates a new profile with valid data', async () => {
      const { token, cookies } = await getCsrf(app, '/admin/profiles/new', sessionCookies);

      const response = await app.inject({
        method: 'POST',
        url: '/admin/profiles',
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: {
          slug: 'my-meeting',
          name: 'My Meeting',
          meeting_link_url: 'https://meet.google.com/abc',
          meeting_tool: 'meet',
          _csrf: token,
        },
      });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/profiles');

      const profile = await app.db.getOne("SELECT * FROM booking_profiles WHERE slug = $1", ['my-meeting']);
      assert.ok(profile);
      assert.equal(profile.name, 'My Meeting');
      assert.equal(profile.meeting_link_url, 'https://meet.google.com/abc');
      assert.equal(profile.meeting_tool, 'meet');
      assert.equal(profile.is_active, true);

      await app.db.run("DELETE FROM booking_profiles WHERE slug = $1", ['my-meeting']);
    });

    it('rejects duplicate slugs', async () => {
      await app.db.run("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5)", [adminId, 'existing-slug', 'Existing', true, new Date().toISOString()]);

      const { token, cookies } = await getCsrf(app, '/admin/profiles/new', sessionCookies);

      const response = await app.inject({
        method: 'POST',
        url: '/admin/profiles',
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: {
          slug: 'existing-slug',
          name: 'Duplicate',
          _csrf: token,
        },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('slug already exists'));

      await app.db.run("DELETE FROM booking_profiles WHERE slug = $1", ['existing-slug']);
    });

    it('rejects invalid slugs', async () => {
      const { token, cookies } = await getCsrf(app, '/admin/profiles/new', sessionCookies);

      const response = await app.inject({
        method: 'POST',
        url: '/admin/profiles',
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: {
          slug: 'INVALID Slug!',
          name: 'Test',
          _csrf: token,
        },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('lowercase alphanumeric'));
    });
  });

  describe('GET /admin/profiles/:id/edit', () => {
    it('renders an edit form pre-filled with current values', async () => {
      const result = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, meeting_link_url, meeting_tool, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id", [adminId, 'edit-me', 'Edit Me', true, 'https://meet.google.com/xyz', 'meet', new Date().toISOString()]);
      const profileId = result.rows[0].id;

      const response = await app.inject({
        method: 'GET',
        url: `/admin/profiles/${profileId}/edit`,
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('edit-me'));
      assert.ok(response.body.includes('Edit Me'));
      assert.ok(response.body.includes('https://meet.google.com/xyz'));

      await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
    });

    it('returns 404 for non-existent profile', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/profiles/99999/edit',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 404);
    });
  });

  describe('POST /admin/profiles/:id', () => {
    it('updates the profile', async () => {
      const result = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'update-me', 'Old Name', true, new Date().toISOString()]);
      const profileId = result.rows[0].id;

      const { token, cookies } = await getCsrf(app, `/admin/profiles/${profileId}/edit`, sessionCookies);

      const response = await app.inject({
        method: 'POST',
        url: `/admin/profiles/${profileId}`,
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: {
          slug: 'updated-slug',
          name: 'New Name',
          meeting_link_url: 'https://teams.microsoft.com/new',
          meeting_tool: 'teams',
          _csrf: token,
        },
      });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/profiles');

      const updated = await app.db.getOne("SELECT * FROM booking_profiles WHERE id = $1", [profileId]);
      assert.equal(updated.slug, 'updated-slug');
      assert.equal(updated.name, 'New Name');
      assert.equal(updated.meeting_tool, 'teams');

      await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
    });
  });

  describe('POST /admin/profiles/:id/delete', () => {
    it('deletes the profile and associated data', async () => {
      const result = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'delete-me', 'Delete Me', true, new Date().toISOString()]);
      const profileId = result.rows[0].id;

      await app.db.run("INSERT INTO default_attendees (profile_id, email) VALUES ($1, $2)", [profileId, 'x@test.com']);
      await app.db.run("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)", [profileId, 1, '09:00', '17:00']);

      const { token, cookies } = await getCsrf(app, `/admin/profiles/${profileId}/edit`, sessionCookies);

      const response = await app.inject({
        method: 'POST',
        url: `/admin/profiles/${profileId}/delete`,
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: { _csrf: token },
      });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/profiles');

      const profile = await app.db.getOne("SELECT * FROM booking_profiles WHERE id = $1", [profileId]);
      assert.equal(profile, null);
    });
  });

  describe('POST /admin/profiles/:id/toggle', () => {
    it('toggles active to inactive', async () => {
      const result = await app.db.query("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [adminId, 'toggle-me', 'Toggle', true, new Date().toISOString()]);
      const profileId = result.rows[0].id;

      const { token, cookies } = await getCsrf(app, `/admin/profiles/${profileId}/edit`, sessionCookies);

      const response = await app.inject({
        method: 'POST',
        url: `/admin/profiles/${profileId}/toggle`,
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: { _csrf: token },
      });
      assert.equal(response.statusCode, 302);

      const profile = await app.db.getOne("SELECT * FROM booking_profiles WHERE id = $1", [profileId]);
      assert.equal(profile.is_active, false);

      await app.db.run("DELETE FROM booking_profiles WHERE id = $1", [profileId]);
    });
  });
});
