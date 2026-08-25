const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createTestApp, cleanDatabase } = require('./helpers/setup');

async function loginAndGetSession(app) {
  const loginPage = await app.inject({ method: 'GET', url: '/admin/login' });
  const csrfToken = loginPage.body.match(/name="_csrf" value="([^"]+)"/)[1];
  const cookies = loginPage.headers['set-cookie'];

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
    payload: { email: 'admin@test.com', password: 'correct-password', _csrf: csrfToken },
  });
  return loginResponse.headers['set-cookie'];
}

async function getCsrfFromPage(app, url, sessionCookies) {
  const page = await app.inject({
    method: 'GET',
    url,
    headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
  });
  const csrf = page.body.match(/name="_csrf" value="([^"]+)"/)[1];
  const updatedCookies = page.headers['set-cookie'] || sessionCookies;
  return { csrf, cookies: updatedCookies, body: page.body, statusCode: page.statusCode };
}

describe('Admin Settings', () => {
  let app;

  before(async () => {
    app = await createTestApp();
    await cleanDatabase(app);

    const hash = await bcrypt.hash('correct-password', 10);
    await app.db.run('INSERT INTO admin (email, username, password_hash, timezone) VALUES ($1, $2, $3, $4)', ['admin@test.com', 'admin', hash, 'UTC']);
  });

  after(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  describe('GET /admin/settings', () => {
    it('requires authentication', async () => {
      const response = await app.inject({ method: 'GET', url: '/admin/settings' });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/login');
    });

    it('renders settings form with timezone dropdown and password fields', async () => {
      const sessionCookies = await loginAndGetSession(app);
      const response = await app.inject({
        method: 'GET',
        url: '/admin/settings',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('name="timezone"'));
      assert.ok(response.body.includes('America/New_York'));
      assert.ok(response.body.includes('name="current_password"'));
      assert.ok(response.body.includes('name="new_password"'));
      assert.ok(response.body.includes('name="confirm_password"'));
    });

    it('shows current timezone as selected', async () => {
      const sessionCookies = await loginAndGetSession(app);
      const response = await app.inject({
        method: 'GET',
        url: '/admin/settings',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.ok(response.body.includes('UTC'));
    });
  });

  describe('POST /admin/settings/timezone', () => {
    it('updates timezone in the database', async () => {
      const sessionCookies = await loginAndGetSession(app);
      const { csrf, cookies } = await getCsrfFromPage(app, '/admin/settings', sessionCookies);

      const response = await app.inject({
        method: 'POST',
        url: '/admin/settings/timezone',
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: { timezone: 'America/New_York', _csrf: csrf },
      });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/settings');

      const admin = await app.db.getOne("SELECT timezone FROM admin WHERE email = $1", ['admin@test.com']);
      assert.equal(admin.timezone, 'America/New_York');

      // Reset
      await app.db.run("UPDATE admin SET timezone = 'UTC' WHERE email = $1", ['admin@test.com']);
    });

    it('requires CSRF token', async () => {
      const sessionCookies = await loginAndGetSession(app);
      const response = await app.inject({
        method: 'POST',
        url: '/admin/settings/timezone',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
        payload: { timezone: 'America/New_York' },
      });
      assert.equal(response.statusCode, 403);
    });
  });

  describe('POST /admin/settings/password', () => {
    it('changes password with correct current password', async () => {
      const sessionCookies = await loginAndGetSession(app);
      const { csrf, cookies } = await getCsrfFromPage(app, '/admin/settings', sessionCookies);

      const response = await app.inject({
        method: 'POST',
        url: '/admin/settings/password',
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: {
          current_password: 'correct-password',
          new_password: 'new-secure-password',
          confirm_password: 'new-secure-password',
          _csrf: csrf,
        },
      });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/settings');

      const admin = await app.db.getOne("SELECT password_hash FROM admin WHERE email = $1", ['admin@test.com']);
      const matches = await bcrypt.compare('new-secure-password', admin.password_hash);
      assert.ok(matches);

      // Reset password for other tests
      const resetHash = await bcrypt.hash('correct-password', 10);
      await app.db.run('UPDATE admin SET password_hash = $1 WHERE email = $2', [resetHash, 'admin@test.com']);
    });

    it('rejects when current password is wrong', async () => {
      const sessionCookies = await loginAndGetSession(app);
      const { csrf, cookies } = await getCsrfFromPage(app, '/admin/settings', sessionCookies);

      const response = await app.inject({
        method: 'POST',
        url: '/admin/settings/password',
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: {
          current_password: 'wrong-password',
          new_password: 'new-secure-password',
          confirm_password: 'new-secure-password',
          _csrf: csrf,
        },
      });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/settings');

      const admin = await app.db.getOne("SELECT password_hash FROM admin WHERE email = $1", ['admin@test.com']);
      const matches = await bcrypt.compare('correct-password', admin.password_hash);
      assert.ok(matches);
    });

    it('rejects when new password and confirmation do not match', async () => {
      const sessionCookies = await loginAndGetSession(app);
      const { csrf, cookies } = await getCsrfFromPage(app, '/admin/settings', sessionCookies);

      const response = await app.inject({
        method: 'POST',
        url: '/admin/settings/password',
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: {
          current_password: 'correct-password',
          new_password: 'new-password',
          confirm_password: 'different-password',
          _csrf: csrf,
        },
      });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/settings');

      const admin = await app.db.getOne("SELECT password_hash FROM admin WHERE email = $1", ['admin@test.com']);
      const matches = await bcrypt.compare('correct-password', admin.password_hash);
      assert.ok(matches);
    });

    it('requires CSRF token', async () => {
      const sessionCookies = await loginAndGetSession(app);
      const response = await app.inject({
        method: 'POST',
        url: '/admin/settings/password',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
        payload: {
          current_password: 'correct-password',
          new_password: 'new-password',
          confirm_password: 'new-password',
        },
      });
      assert.equal(response.statusCode, 403);
    });
  });
});
