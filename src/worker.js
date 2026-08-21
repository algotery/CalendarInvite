const { Worker } = require('bullmq');
const { getRedisConnection } = require('./queue');
const { createDatabase } = require('./db');
const { processEmailJob } = require('./jobs/email-job');
const { processCalendarJob } = require('./jobs/calendar-job');

async function startWorker() {
  const redisConnection = getRedisConnection();
  if (!redisConnection) {
    console.log('REDIS_URL not set, worker cannot start');
    return;
  }

  const db = await createDatabase(process.env.DATABASE_URL);
  const fetchFn = globalThis.fetch;

  const emailWorker = new Worker(
    'email',
    (job) => processEmailJob(job),
    { connection: redisConnection, concurrency: 5 }
  );

  const calendarWorker = new Worker(
    'calendar',
    (job) => processCalendarJob(job, db, fetchFn),
    { connection: redisConnection, concurrency: 3 }
  );

  emailWorker.on('completed', (job) => {
    console.log(`[email] Job ${job.id} completed`);
  });

  emailWorker.on('failed', (job, err) => {
    console.error(`[email] Job ${job.id} failed: ${err.message}`);
  });

  calendarWorker.on('completed', (job) => {
    console.log(`[calendar] Job ${job.id} completed`);
  });

  calendarWorker.on('failed', (job, err) => {
    console.error(`[calendar] Job ${job.id} failed: ${err.message}`);
  });

  console.log('Worker started — listening for email and calendar jobs');

  const shutdown = async () => {
    console.log('Worker shutting down...');
    await emailWorker.close();
    await calendarWorker.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { startWorker };
