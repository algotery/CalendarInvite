const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createTestApp, cleanDatabase } = require('./helpers/setup');

describe('Admin Auth', () => {
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

  describe('GET /admin/login', () => {
    it('renders a login form with username and password fields', async () => {
      const response = await app.inject({ method: 'GET', url: '/admin/login' });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('name="email"') || response.body.includes('name="username"'));
      assert.ok(response.body.includes('name="password"'));
    });
  });

  describe('POST /admin/login', () => {
    it('redirects to /admin/dashboard on valid credentials', async () => {
      const loginPage = await app.inject({ method: 'GET', url: '/admin/login' });
      const csrfToken = loginPage.body.match(/name="_csrf" value="([^"]+)"/)[1];
      const cookies = loginPage.headers['set-cookie'];

      const response = await app.inject({
        method: 'POST',
        url: '/admin/login',
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: { email: 'admin@test.com', password: 'correct-password', _csrf: csrfToken },
      });
      assert.equal(response.statusCode, 302);
    });

    it('re-renders login with error on wrong credentials', async () => {
      const loginPage = await app.inject({ method: 'GET', url: '/admin/login' });
      const csrfToken = loginPage.body.match(/name="_csrf" value="([^"]+)"/)[1];
      const cookies = loginPage.headers['set-cookie'];

      const response = await app.inject({
        method: 'POST',
        url: '/admin/login',
        headers: { cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies },
        payload: { email: 'admin@test.com', password: 'wrong-password', _csrf: csrfToken },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes('Invalid'));
    });
  });

  describe('Protected routes', () => {
    it('redirects to login when accessing /admin/dashboard without session', async () => {
      const response = await app.inject({ method: 'GET', url: '/admin/dashboard' });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/admin/login');
    });
  });
});
