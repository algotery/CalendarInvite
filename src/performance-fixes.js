let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function shouldCleanup() {
  const now = Date.now();
  if (now - lastCleanup > CLEANUP_INTERVAL) {
    lastCleanup = now;
    return true;
  }
  return false;
}

async function optimizedCleanupOldRateLimits(db) {
  if (shouldCleanup()) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db.run("DELETE FROM rate_limits WHERE timestamp < $1", [cutoff]);
  }
}

async function getBatchedBookings(db, adminTz, filters = {}) {
  const { status, profile_id, user_id, limit = 100, offset = 0, timeMin, timeMax } = filters;

  let where = [];
  let params = [];
  let paramIdx = 1;

  if (user_id) {
    where.push(`bp.user_id = $${paramIdx++}`);
    params.push(user_id);
  }
  if (status && (status === 'confirmed' || status === 'cancelled')) {
    where.push(`b.status = $${paramIdx++}`);
    params.push(status);
  }
  if (profile_id) {
    where.push(`b.profile_id = $${paramIdx++}`);
    params.push(parseInt(profile_id, 10));
  }
  if (timeMin) {
    where.push(`b.start_time >= $${paramIdx++}`);
    params.push(timeMin);
  }
  if (timeMax) {
    where.push(`b.start_time < $${paramIdx++}`);
    params.push(timeMax);
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  const bookings = await db.getAll(`
    SELECT
      b.*,
      bp.name as profile_name,
      bp.buffer_time_minutes
    FROM bookings b
    JOIN booking_profiles bp ON b.profile_id = bp.id
    ${whereClause}
    ORDER BY b.start_time ASC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `, [...params, limit, offset]);

  return bookings;
}

module.exports = {
  optimizedCleanupOldRateLimits,
  getBatchedBookings,
};
