async function registerHealthRoutes(app) {
  app.get('/health', async (request, reply) => {
    try {
      await app.db.getOne('SELECT 1 AS ok');
      return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (err) {
      return reply.code(503).send({ status: 'error', message: 'database unreachable' });
    }
  });
}

module.exports = { registerHealthRoutes };
