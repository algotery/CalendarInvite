const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');

const TEST_CONNECTION_STRING = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/calendar_invite_test';

describe('Database schema', () => {
  let db;

  before(async () => {
    db = await createDatabase(TEST_CONNECTION_STRING);
  });

  after(async () => {
    await db.close();
  });

  it('creates the admin table', async () => {
    const result = await db.getAll(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'admin'"
    );
    const columns = result.map(col => col.column_name);
    assert.ok(columns.includes('id'));
    assert.ok(columns.includes('username'));
    assert.ok(columns.includes('password_hash'));
    assert.ok(columns.includes('timezone'));
  });

  it('creates the calendar_connections table', async () => {
    const result = await db.getAll(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'calendar_connections'"
    );
    const columns = result.map(col => col.column_name);
    assert.ok(columns.includes('id'));
    assert.ok(columns.includes('provider'));
    assert.ok(columns.includes('encrypted_access_token'));
    assert.ok(columns.includes('encrypted_refresh_token'));
    assert.ok(columns.includes('token_expiry'));
  });

  it('creates the booking_profiles table', async () => {
    const result = await db.getAll(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'booking_profiles'"
    );
    const columns = result.map(col => col.column_name);
    assert.ok(columns.includes('id'));
    assert.ok(columns.includes('slug'));
    assert.ok(columns.includes('name'));
    assert.ok(columns.includes('is_active'));
  });

  it('creates the bookings table', async () => {
    const result = await db.getAll(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'bookings'"
    );
    const columns = result.map(col => col.column_name);
    assert.ok(columns.includes('id'));
    assert.ok(columns.includes('profile_id'));
    assert.ok(columns.includes('booker_name'));
    assert.ok(columns.includes('booker_email'));
    assert.ok(columns.includes('start_time'));
    assert.ok(columns.includes('end_time'));
    assert.ok(columns.includes('cancellation_token'));
    assert.ok(columns.includes('status'));
  });

  it('creates the schedule_templates table', async () => {
    const result = await db.getAll(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'schedule_templates'"
    );
    const columns = result.map(col => col.column_name);
    assert.ok(columns.includes('id'));
    assert.ok(columns.includes('profile_id'));
    assert.ok(columns.includes('day_of_week'));
    assert.ok(columns.includes('start_time'));
    assert.ok(columns.includes('end_time'));
  });
});
