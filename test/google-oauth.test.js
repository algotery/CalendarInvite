const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createTestApp, cleanDatabase } = require('./helpers/setup');
const { encrypt, decrypt } = require('../src/encryption');

const TEST_ENCRYPTION_KEY = 'a'.repeat(64);

async function loginAsAdmin(app) {
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

describe('Google OAuth2 Calendar Connection', () => {
  let app, sessionCookies, adminId;

  before(async () => {
    app = await createTestApp({
      googleClientId: 'test-client-id',
      googleClientSecret: 'test-client-secret',
      googleRedirectUri: 'http://localhost:3000/admin/calendars/callback/google',
    });
    await cleanDatabase(app);

    const hash = await bcrypt.hash('correct-password', 10);
    const result = await app.db.query('INSERT INTO admin (email, username, password_hash, timezone, onboarding_completed_at) VALUES ($1, $2, $3, $4, $5) RETURNING id', ['admin@test.com', 'admin', hash, 'UTC', new Date().toISOString()]);
    adminId = result.rows[0].id;

    sessionCookies = await loginAsAdmin(app);
  });

  after(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  describe('GET /admin/calendars', () => {
    it('shows Calendar Connections page with Connect Google Calendar button', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/calendars',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('Calendar Connections'));
      assert.ok(response.body.includes('Connect Google Calendar'));
    });

    it('redirects to login when not authenticated', async () => {
      const response = await app.inject({ method: 'GET', url: '/admin/calendars' });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/login');
    });
  });

  describe('GET /admin/calendars/connect/google', () => {
    it('redirects to Google OAuth2 consent URL with correct scopes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/calendars/connect/google',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 302);
      const location = response.headers.location;
      assert.ok(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
      assert.ok(location.includes('scope='));
      assert.ok(location.includes('client_id=test-client-id'));
      assert.ok(location.includes('response_type=code'));
      assert.ok(location.includes('access_type=offline'));
    });
  });

  describe('POST /admin/calendars/:id/disconnect', () => {
    it('deletes the calendar connection', async () => {
      const accessToken = encrypt('to-delete-access', TEST_ENCRYPTION_KEY);
      const refreshToken = encrypt('to-delete-refresh', TEST_ENCRYPTION_KEY);
      const connResult = await app.db.query(
        'INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [adminId, 'google', accessToken, refreshToken, '2099-01-01T00:00:00Z', 'delete-me@gmail.com', 'connected']
      );
      const connId = connResult.rows[0].id;

      const page = await app.inject({
        method: 'GET',
        url: '/admin/calendars',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      const csrfToken = page.body.match(/name="_csrf" value="([^"]+)"/)[1];
      const pageCookies = page.headers['set-cookie'] || sessionCookies;

      const response = await app.inject({
        method: 'POST',
        url: `/admin/calendars/${connId}/disconnect`,
        headers: { cookie: Array.isArray(pageCookies) ? pageCookies.join('; ') : pageCookies },
        payload: { _csrf: csrfToken },
      });

      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/calendars');

      const conn = await app.db.getOne('SELECT * FROM calendar_connections WHERE id = $1', [connId]);
      assert.equal(conn, null);
    });
  });
});
