const Redis = require('ioredis');

class RedisSessionStore {
  constructor(client, opts = {}) {
    this.client = client;
    this.prefix = opts.prefix || 'sess:';
    this.ttl = opts.ttl || 86400;
  }

  set(sessionId, session, callback) {
    try {
      const key = this.prefix + sessionId;
      const plain = {};
      for (const k of Object.keys(session)) {
        plain[k] = session[k];
      }
      const data = JSON.stringify(plain);
      this.client.set(key, data, 'EX', this.ttl)
        .then(() => callback())
        .catch((err) => callback(err));
    } catch (err) {
      callback(err);
    }
  }

  get(sessionId, callback) {
    const key = this.prefix + sessionId;
    this.client.get(key)
      .then((data) => callback(null, data ? JSON.parse(data) : null))
      .catch((err) => callback(err));
  }

  destroy(sessionId, callback) {
    const key = this.prefix + sessionId;
    this.client.del(key)
      .then(() => callback())
      .catch((err) => callback(err));
  }
}

async function createSessionStore(redisUrl) {
  if (!redisUrl) return { store: undefined, redisClient: null };

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });

  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
  });

  const store = new RedisSessionStore(client, {
    prefix: 'sess:',
    ttl: 86400,
  });

  return { store, redisClient: client };
}

module.exports = { createSessionStore };
