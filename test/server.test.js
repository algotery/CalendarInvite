const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanDatabase } = require('./helpers/setup');

describe('Server', () => {
  let app;

  before(async () => {
    app = await createTestApp();
    await cleanDatabase(app);
  });

  after(async () => {
    await app.close();
  });

  it('serves a placeholder page at GET /', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    assert.equal(response.statusCode, 302);
  });

  it('registers admin route group', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/login' });
    assert.notEqual(response.statusCode, 404);
  });

  it('registers public booking route group', async () => {
    await app.db.run("INSERT INTO admin (email, username, password_hash, timezone) VALUES ($1, $2, $3, $4)", ['test@test.com', 'admin', 'hash', 'UTC']);
    const adminRow = await app.db.getOne("SELECT id FROM admin WHERE username = 'admin'");
    await app.db.run("INSERT INTO booking_profiles (user_id, slug, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5)", [adminRow.id, 'test-slug', 'Test', true, new Date().toISOString()]);
    const response = await app.inject({ method: 'GET', url: '/book/test-slug' });
    assert.notEqual(response.statusCode, 404);
    await cleanDatabase(app);
  });
});
