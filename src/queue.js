const { Queue } = require('bullmq');

let connection = null;

function getRedisConnection() {
  if (connection) return connection;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  const url = new URL(redisUrl);
  connection = {
    host: url.hostname,
    port: parseInt(url.port, 10) || 6379,
  };
  if (url.password) connection.password = url.password;
  if (url.username && url.username !== 'default') connection.username = url.username;

  return connection;
}

let emailQueue = null;
let calendarQueue = null;

function getEmailQueue() {
  if (emailQueue) return emailQueue;
  const conn = getRedisConnection();
  if (!conn) return null;
  emailQueue = new Queue('email', { connection: conn });
  return emailQueue;
}

function getCalendarQueue() {
  if (calendarQueue) return calendarQueue;
  const conn = getRedisConnection();
  if (!conn) return null;
  calendarQueue = new Queue('calendar', { connection: conn });
  return calendarQueue;
}

module.exports = { getRedisConnection, getEmailQueue, getCalendarQueue };
