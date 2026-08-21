async function registerHealthRoutes(app) {
  app.get('/health/live', async (request, reply) => {
    return reply.send({ status: 'ok' });
  });

  app.get('/health', async (request, reply) => {
    const checks = {};

    try {
      await app.db.getOne('SELECT 1 AS ok');
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    if (app.redisClient) {
      try {
        await app.redisClient.ping();
        checks.redis = 'ok';
      } catch {
        checks.redis = 'error';
      }
    }

    const allOk = Object.values(checks).every(v => v === 'ok');
    return reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });
}

module.exports = { registerHealthRoutes };
