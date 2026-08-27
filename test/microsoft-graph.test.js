const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { encrypt } = require('../src/encryption');
const { createDatabase } = require('../src/db');

const TEST_ENCRYPTION_KEY = 'a'.repeat(64);
const TEST_CONNECTION_STRING = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/calendar_invite_test';

describe('Microsoft Graph Utilities', () => {
  let db;
  let connectionId;

  before(async () => {
    db = await createDatabase(TEST_CONNECTION_STRING);
    await db.run('DELETE FROM calendar_connections');
    await db.run('DELETE FROM admin');
    await db.run("INSERT INTO admin (email, username, password_hash, timezone) VALUES ($1, $2, $3, $4)", ['test@test.com', 'testuser', 'hash', 'UTC']);
    const admin = await db.getOne("SELECT id FROM admin WHERE email = 'test@test.com'");
    const result = await db.query(
      `INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [admin.id, 'microsoft', encrypt('valid-access-token', TEST_ENCRYPTION_KEY), encrypt('valid-refresh-token', TEST_ENCRYPTION_KEY), new Date(Date.now() + 3600000).toISOString(), 'user@outlook.com', 'connected']
    );
    connectionId = result.rows[0].id;
  });

  after(async () => {
    await db.run('DELETE FROM calendar_connections');
    await db.run('DELETE FROM admin');
    await db.close();
  });

  describe('token refresh', () => {
    it('refreshes expired token before making API calls', async () => {
      const { createMicrosoftClient } = require('../src/microsoft');

      await db.run('UPDATE calendar_connections SET token_expiry = $1 WHERE id = $2', [new Date(Date.now() - 60000).toISOString(), connectionId]);

      const mockFetch = mock.fn(async (url, options) => {
        if (url.includes('/oauth2/v2.0/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'new-access-token',
              refresh_token: 'new-refresh-token',
              expires_in: 3600,
            }),
          };
        }
        if (url.includes('/me/calendarView')) {
          return {
            ok: true,
            json: async () => ({ value: [] }),
          };
        }
      });

      const client = createMicrosoftClient({
        db,
        encryptionKey: TEST_ENCRYPTION_KEY,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        tenantId: 'test-tenant-id',
        fetchFn: mockFetch,
      });

      await client.getMicrosoftBusySlots(connectionId, '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z');

      const tokenCall = mockFetch.mock.calls.find(c => c.arguments[0].includes('/oauth2/v2.0/token'));
      assert.ok(tokenCall, 'Should have called token endpoint for refresh');

      const { decrypt } = require('../src/encryption');
      const conn = await db.getOne('SELECT * FROM calendar_connections WHERE id = $1', [connectionId]);
      assert.equal(decrypt(conn.encrypted_access_token, TEST_ENCRYPTION_KEY), 'new-access-token');
      assert.equal(decrypt(conn.encrypted_refresh_token, TEST_ENCRYPTION_KEY), 'new-refresh-token');

      // Restore for next tests
      await db.run('UPDATE calendar_connections SET token_expiry = $1, encrypted_access_token = $2, encrypted_refresh_token = $3 WHERE id = $4',
        [new Date(Date.now() + 3600000).toISOString(), encrypt('valid-access-token', TEST_ENCRYPTION_KEY), encrypt('valid-refresh-token', TEST_ENCRYPTION_KEY), connectionId]);
    });
  });

  describe('getMicrosoftBusySlots', () => {
    it('returns busy time ranges from Graph API calendarView', async () => {
      const { createMicrosoftClient } = require('../src/microsoft');

      const mockFetch = mock.fn(async (url, options) => {
        if (url.includes('/me/calendarView')) {
          return {
            ok: true,
            json: async () => ({
              value: [
                { showAs: 'busy', start: { dateTime: '2024-01-15T09:00:00', timeZone: 'UTC' }, end: { dateTime: '2024-01-15T10:00:00', timeZone: 'UTC' } },
                { showAs: 'tentative', start: { dateTime: '2024-01-15T14:00:00', timeZone: 'UTC' }, end: { dateTime: '2024-01-15T15:00:00', timeZone: 'UTC' } },
                { showAs: 'free', start: { dateTime: '2024-01-15T16:00:00', timeZone: 'UTC' }, end: { dateTime: '2024-01-15T17:00:00', timeZone: 'UTC' } },
              ],
            }),
          };
        }
      });

      const client = createMicrosoftClient({
        db,
        encryptionKey: TEST_ENCRYPTION_KEY,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        tenantId: 'test-tenant-id',
        fetchFn: mockFetch,
      });

      const slots = await client.getMicrosoftBusySlots(connectionId, '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z');

      assert.equal(slots.length, 2);
      assert.deepEqual(slots[0], { start: '2024-01-15T09:00:00', end: '2024-01-15T10:00:00' });
      assert.deepEqual(slots[1], { start: '2024-01-15T14:00:00', end: '2024-01-15T15:00:00' });
    });
  });

  describe('createMicrosoftEvent', () => {
    it('creates an event with attendees, meeting link, start/end time, and title', async () => {
      const { createMicrosoftClient } = require('../src/microsoft');

      const mockFetch = mock.fn(async (url, options) => {
        if (url.includes('/me/events')) {
          const body = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ id: 'event-id-123', ...body }),
          };
        }
      });

      const client = createMicrosoftClient({
        db,
        encryptionKey: TEST_ENCRYPTION_KEY,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        tenantId: 'test-tenant-id',
        fetchFn: mockFetch,
      });

      const eventData = {
        title: 'Team Meeting',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T11:00:00Z',
        attendees: ['alice@example.com', 'bob@example.com'],
        meetingLink: 'https://teams.microsoft.com/meet/123',
      };

      const eventId = await client.createMicrosoftEvent(connectionId, eventData);

      assert.equal(eventId, 'event-id-123');

      const call = mockFetch.mock.calls.find(c => c.arguments[0].includes('/me/events'));
      const requestBody = JSON.parse(call.arguments[1].body);
      assert.equal(requestBody.subject, 'Team Meeting');
      assert.deepEqual(requestBody.start, { dateTime: '2024-01-15T10:00:00Z', timeZone: 'UTC' });
      assert.deepEqual(requestBody.end, { dateTime: '2024-01-15T11:00:00Z', timeZone: 'UTC' });
      assert.equal(requestBody.attendees.length, 2);
      assert.equal(requestBody.attendees[0].emailAddress.address, 'alice@example.com');
      assert.ok(requestBody.body.content.includes('https://teams.microsoft.com/meet/123'));
    });
  });
});
