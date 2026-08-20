const { optimizedCleanupOldRateLimits } = require('../performance-fixes');

const IP_RATE_LIMIT = 20;
const IP_RATE_WINDOW_MS = 60 * 1000;
const EMAIL_RATE_LIMIT = 5;
const EMAIL_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

async function checkIpRateLimit(db, ip) {
  const windowStart = new Date(Date.now() - IP_RATE_WINDOW_MS).toISOString();
  const row = await db.getOne(
    "SELECT COUNT(*) as cnt FROM rate_limits WHERE key = $1 AND type = 'ip' AND timestamp > $2",
    [ip, windowStart]
  );
  return parseInt(row.cnt) >= IP_RATE_LIMIT;
}

async function recordIpRequest(db, ip, endpoint) {
  await db.run(
    "INSERT INTO rate_limits (key, type, endpoint, timestamp) VALUES ($1, 'ip', $2, $3)",
    [ip, endpoint, new Date().toISOString()]
  );
}

async function checkEmailRateLimit(db, email) {
  const windowStart = new Date(Date.now() - EMAIL_RATE_WINDOW_MS).toISOString();
  const row = await db.getOne(
    "SELECT COUNT(*) as cnt FROM rate_limits WHERE key = $1 AND type = 'email' AND timestamp > $2",
    [email, windowStart]
  );
  return parseInt(row.cnt) >= EMAIL_RATE_LIMIT;
}

async function recordEmailBooking(db, email, endpoint) {
  await db.run(
    "INSERT INTO rate_limits (key, type, endpoint, timestamp) VALUES ($1, 'email', $2, $3)",
    [email, endpoint, new Date().toISOString()]
  );
}

function getClientIp(request) {
  return request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip || '127.0.0.1';
}

function registerRateLimitHook(app) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST') return;
    await optimizedCleanupOldRateLimits(app.db);
    const ip = getClientIp(request);
    if (await checkIpRateLimit(app.db, ip)) {
      return reply.code(429).send({ error: 'Too many requests, please try again later' });
    }
    await recordIpRequest(app.db, ip, request.url);
  });
}

module.exports = {
  checkIpRateLimit,
  recordIpRequest,
  checkEmailRateLimit,
  recordEmailBooking,
  getClientIp,
  registerRateLimitHook,
  IP_RATE_LIMIT,
  IP_RATE_WINDOW_MS,
  EMAIL_RATE_LIMIT,
  EMAIL_RATE_WINDOW_MS,
};
