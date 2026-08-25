const config = require('./config');

async function start() {
  const { entryMode } = config;

  if (entryMode === 'worker') {
    const { startWorker } = require('./worker');
    await startWorker();
    return;
  }

  const { buildApp } = require('./app');
  const app = await buildApp({ logger: true });

  app.listen({ port: config.port, host: config.host }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });

  if (entryMode === 'all') {
    const { startWorker } = require('./worker');
    await startWorker();
  }

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start();
