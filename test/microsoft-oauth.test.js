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

describe('Microsoft OAuth2 Calendar Connection', () => {
  let app, sessionCookies, adminId;

  before(async () => {
    app = await createTestApp({
      microsoftClientId: 'test-client-id',
      microsoftClientSecret: 'test-client-secret',
      microsoftRedirectUri: 'http://localhost:3000/admin/calendars/callback/microsoft',
      microsoftTenantId: 'test-tenant-id',
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
    it('shows a Connect Office 365 button', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/calendars',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('Connect Office 365'));
    });
  });

  describe('GET /admin/calendars/connect/microsoft', () => {
    it('redirects to Microsoft OAuth2 consent with Calendars.ReadWrite scope', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/calendars/connect/microsoft',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 302);
      const location = response.headers.location;
      assert.ok(location.startsWith('https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/authorize'));
      const url = new URL(location);
      assert.equal(url.searchParams.get('client_id'), 'test-client-id');
      assert.equal(url.searchParams.get('response_type'), 'code');
      assert.ok(url.searchParams.get('scope').includes('Calendars.ReadWrite'));
    });
  });

  describe('POST /admin/calendars/:id/disconnect', () => {
    it('removes the calendar connection and redirects to calendars page', async () => {
      const connResult = await app.db.query(
        'INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [adminId, 'microsoft', encrypt('tok', TEST_ENCRYPTION_KEY), encrypt('ref', TEST_ENCRYPTION_KEY), '2099-01-01T00:00:00Z', 'disconnect@outlook.com', 'connected']
      );
      const connId = connResult.rows[0].id;

      const calPage = await app.inject({
        method: 'GET',
        url: '/admin/calendars',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      const csrfToken = calPage.body.match(/name="_csrf" value="([^"]+)"/)[1];
      const pageCookies = calPage.headers['set-cookie'] || sessionCookies;

      const response = await app.inject({
        method: 'POST',
        url: `/admin/calendars/${connId}/disconnect`,
        headers: { cookie: Array.isArray(pageCookies) ? pageCookies.join('; ') : pageCookies },
        payload: { _csrf: csrfToken },
      });

      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/calendars');

      const connection = await app.db.getOne('SELECT * FROM calendar_connections WHERE id = $1', [connId]);
      assert.equal(connection, null);
    });
  });
});
