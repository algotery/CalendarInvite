const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createTestApp, cleanDatabase } = require('./helpers/setup');
const { encrypt, decrypt } = require('../src/encryption');

const ENCRYPTION_KEY = 'a'.repeat(64);

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

describe('Zoho Calendar Connection', () => {
  let app, sessionCookies, adminId;

  before(async () => {
    app = await createTestApp({
      zohoClientId: 'test-client-id',
      zohoClientSecret: 'test-client-secret',
      zohoRedirectUri: 'http://localhost:3000/admin/calendars/zoho/callback',
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
    it('shows Calendar Connections page with Connect Zoho button', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/calendars',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('Connect Zoho Calendar'));
      assert.ok(response.body.includes('Calendar Connections'));
    });

    it('requires authentication', async () => {
      const response = await app.inject({ method: 'GET', url: '/admin/calendars' });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/login');
    });
  });

  describe('GET /admin/calendars/connect/zoho', () => {
    it('redirects to Zoho OAuth2 consent screen with correct scopes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/calendars/connect/zoho',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      assert.equal(response.statusCode, 302);
      const location = response.headers.location;
      assert.ok(location.startsWith('https://accounts.zoho.com/oauth/v2/auth'));
      assert.ok(location.includes('client_id=test-client-id'));
      assert.ok(location.includes('scope='));
      assert.ok(location.includes('ZohoCalendar'));
      assert.ok(location.includes('response_type=code'));
      assert.ok(location.includes('access_type=offline'));
    });
  });

  describe('POST /admin/calendars/:id/disconnect', () => {
    it('removes a calendar connection', async () => {
      const connResult = await app.db.query(
        'INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [adminId, 'zoho', encrypt('tok', ENCRYPTION_KEY), encrypt('ref', ENCRYPTION_KEY), '2099-01-01T00:00:00Z', 'admin@zoho.com', 'connected']
      );
      const connId = connResult.rows[0].id;

      const calPage = await app.inject({
        method: 'GET',
        url: '/admin/calendars',
        headers: { cookie: Array.isArray(sessionCookies) ? sessionCookies.join('; ') : sessionCookies },
      });
      const csrf = calPage.body.match(/name="_csrf" value="([^"]+)"/)[1];
      const pageCookies = calPage.headers['set-cookie'] || sessionCookies;

      const response = await app.inject({
        method: 'POST',
        url: `/admin/calendars/${connId}/disconnect`,
        headers: { cookie: Array.isArray(pageCookies) ? pageCookies.join('; ') : pageCookies },
        payload: { _csrf: csrf },
      });

      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/calendars');

      const deleted = await app.db.getOne('SELECT * FROM calendar_connections WHERE id = $1', [connId]);
      assert.equal(deleted, null);
    });
  });
});

describe('Zoho Calendar Utilities', () => {
  let app, connectionId, adminId;

  before(async () => {
    app = await createTestApp({
      zohoClientId: 'test-client-id',
      zohoClientSecret: 'test-client-secret',
      zohoRedirectUri: 'http://localhost:3000/admin/calendars/zoho/callback',
    });
    await cleanDatabase(app);

    const hash = await bcrypt.hash('correct-password', 10);
    const result = await app.db.query('INSERT INTO admin (email, username, password_hash, timezone) VALUES ($1, $2, $3, $4) RETURNING id', ['admin@test.com', 'admin', hash, 'UTC']);
    adminId = result.rows[0].id;

    const futureExpiry = new Date(Date.now() + 3600000).toISOString();
    const connResult = await app.db.query(
      'INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [adminId, 'zoho', encrypt('valid-access-token', ENCRYPTION_KEY), encrypt('valid-refresh-token', ENCRYPTION_KEY), futureExpiry, 'util-test@zoho.com', 'connected']
    );
    connectionId = connResult.rows[0].id;
  });

  after(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  describe('getZohoBusySlots', () => {
    it('returns busy time ranges from Zoho Calendar', async () => {
      const { getZohoClient } = require('../src/zoho');

      const mockFetch = mock.fn(async (url, opts) => {
        if (url.includes('freebusy')) {
          return {
            ok: true,
            json: async () => ({
              fb_data: [
                { fbtype: 'busy', s_datetime: '20260701T090000+0000', e_datetime: '20260701T100000+0000' },
                { fbtype: 'busy', s_datetime: '20260701T140000+0000', e_datetime: '20260701T150000+0000' },
              ],
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      const client = getZohoClient({
        db: app.db,
        encryptionKey: ENCRYPTION_KEY,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        fetchFn: mockFetch,
      });

      const busySlots = await client.getBusySlots(connectionId, '2026-07-01T00:00:00Z', '2026-07-01T23:59:59Z');

      assert.equal(busySlots.length, 2);
      assert.ok(busySlots[0].start);
      assert.ok(busySlots[0].end);
    });
  });
});
