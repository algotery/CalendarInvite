// Performance optimization fixes for CalendarInvite

// 1. Rate Limit Cleanup - Only run periodically, not on every request
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

function shouldCleanup() {
  const now = Date.now();
  if (now - lastCleanup > CLEANUP_INTERVAL) {
    lastCleanup = now;
    return true;
  }
  return false;
}

function optimizedCleanupOldRateLimits(db) {
  if (shouldCleanup()) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.prepare("DELETE FROM rate_limits WHERE timestamp < ?").run(cutoff);
  }
}

// 2. Database indexes for better query performance
function addPerformanceIndexes(db) {
  try {
    // Bookings table indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_bookings_profile_status ON bookings(profile_id, status);
      CREATE INDEX IF NOT EXISTS idx_bookings_start_time ON bookings(start_time);
      CREATE INDEX IF NOT EXISTS idx_bookings_profile_start ON bookings(profile_id, start_time);
      CREATE INDEX IF NOT EXISTS idx_bookings_cancellation_token ON bookings(cancellation_token);
    `);

    // Profile indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_profiles_slug ON booking_profiles(slug);
      CREATE INDEX IF NOT EXISTS idx_profiles_active ON booking_profiles(is_active);
    `);

    // Schedule indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_schedule_templates_profile_day ON schedule_templates(profile_id, day_of_week);
      CREATE INDEX IF NOT EXISTS idx_schedule_overrides_profile_date ON schedule_overrides(profile_id, date);
    `);

    console.log('✅ Performance indexes created successfully');
  } catch (err) {
    console.error('⚠️ Error creating indexes:', err.message);
  }
}

// 3. Token cache to avoid repeated decryption
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedToken(connectionId) {
  const cached = tokenCache.get(connectionId);
  if (cached && Date.now() < cached.expiry) {
    return cached.token;
  }
  return null;
}

function setCachedToken(connectionId, token, expiryDate) {
  const expiry = Math.min(
    new Date(expiryDate).getTime(),
    Date.now() + TOKEN_CACHE_TTL
  );
  tokenCache.set(connectionId, { token, expiry });
}

function clearTokenCache(connectionId) {
  if (connectionId) {
    tokenCache.delete(connectionId);
  } else {
    tokenCache.clear();
  }
}

// 4. Query optimization - batch queries
function getBatchedBookings(db, adminTz, filters = {}) {
  const { status, profile_id, limit = 100, offset = 0, timeMin, timeMax } = filters;

  let where = [];
  let params = [];

  if (status && (status === 'confirmed' || status === 'cancelled')) {
    where.push('b.status = ?');
    params.push(status);
  }
  if (profile_id) {
    where.push('b.profile_id = ?');
    params.push(parseInt(profile_id, 10));
  }
  if (timeMin) {
    where.push('b.start_time >= ?');
    params.push(timeMin);
  }
  if (timeMax) {
    where.push('b.start_time < ?');
    params.push(timeMax);
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  // Single optimized query with all needed data
  const bookings = db.prepare(`
    SELECT
      b.*,
      bp.name as profile_name,
      bp.buffer_time_minutes
    FROM bookings b
    JOIN booking_profiles bp ON b.profile_id = bp.id
    ${whereClause}
    ORDER BY b.start_time ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return bookings;
}

// 5. Memory leak prevention - Clear old caches
function cleanupCaches() {
  const now = Date.now();
  for (const [key, value] of tokenCache.entries()) {
    if (now > value.expiry) {
      tokenCache.delete(key);
    }
  }
}

// Run cache cleanup every 10 minutes
setInterval(cleanupCaches, 10 * 60 * 1000);

module.exports = {
  optimizedCleanupOldRateLimits,
  addPerformanceIndexes,
  getCachedToken,
  setCachedToken,
  clearTokenCache,
  getBatchedBookings,
  cleanupCaches
};
