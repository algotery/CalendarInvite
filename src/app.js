const path = require('node:path');
const fastify = require('fastify');
const formbody = require('@fastify/formbody');
const cookie = require('@fastify/cookie');
const session = require('@fastify/session');
const csrf = require('@fastify/csrf-protection');
const fastifyStatic = require('@fastify/static');
const multipart = require('@fastify/multipart');
const { createDatabase } = require('./db');
const { registerProfileRoutes } = require('./profiles');
const { registerBookingRoutes, registerSlotsApi, registerBusynessApi, registerBookingSubmitApi, registerCancellationPage, registerCancellationApi, registerRateLimitHook } = require('./booking');
const { requireAuth } = require('./middleware/auth');
const { registerHealthRoutes } = require('./routes/health');
const { registerOnboardingRoutes } = require('./routes/onboarding');
const { registerAuthRoutes } = require('./routes/admin/auth');
const { registerSettingsRoutes } = require('./routes/admin/settings');
const { registerDashboardRoutes } = require('./routes/admin/dashboard');
const { registerBookingsRoutes } = require('./routes/admin/bookings');
const { registerCalendarsRoutes } = require('./routes/admin/calendars');
const { BASE_LAYOUT } = require('./views/layout');
const { landingPage } = require('./views/landing');
const { createSessionStore } = require('./session-store');




async function buildApp(opts = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const app = fastify({
    logger: opts.logger || false,
    trustProxy: isProduction,
  });

  const connectionString = opts.connectionString || process.env.DATABASE_URL;
  const db = await createDatabase(connectionString);
  const encryptionKey = opts.encryptionKey || process.env.TOKEN_ENCRYPTION_KEY;
  const googleClientId = opts.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = opts.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const googleRedirectUri = opts.googleRedirectUri || process.env.GOOGLE_REDIRECT_URI;
  const zohoClientId = opts.zohoClientId || process.env.ZOHO_CLIENT_ID;
  const zohoClientSecret = opts.zohoClientSecret || process.env.ZOHO_CLIENT_SECRET;
  const zohoRedirectUri = opts.zohoRedirectUri || process.env.ZOHO_REDIRECT_URI;
  const zohoAccountsServer = opts.zohoAccountsServer || process.env.ZOHO_ACCOUNTS_SERVER || 'https://accounts.zoho.com';

  app.decorate('db', db);
  app.decorate('fetchFn', opts.fetchFn || globalThis.fetch);
  app.decorate('zohoFetch', null);

  if (!isProduction || process.env.SERVE_STATIC === '1') {
    app.register(fastifyStatic, {
      root: path.join(__dirname, '..', 'public'),
      prefix: '/',
      maxAge: '7d',
    });
  }

  app.register(formbody);
  app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  app.register(cookie);
  const sessionSecret = opts.sessionSecret || process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is required');
  }
  if (!encryptionKey) {
    throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required');
  }

  const redisUrl = opts.redisUrl || process.env.REDIS_URL;
  const { store: sessionStore, redisClient } = await createSessionStore(redisUrl);
  if (redisClient) {
    app.decorate('redisClient', redisClient);
  }

  app.register(session, {
    secret: sessionSecret,
    store: sessionStore || undefined,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    },
  });
  app.register(csrf, { sessionPlugin: '@fastify/session' });

  registerHealthRoutes(app);

  app.get('/', async (request, reply) => {
    reply.redirect('/home');
  });

  app.get('/home', async (request, reply) => {
    reply.type('text/html').send(landingPage());
  });

  app.register(async function adminRoutes(app) {
    app.setErrorHandler(async (error, request, reply) => {
      if (reply.sent) return;
      if ((error.code === 'FST_CSRF_MISSING_SECRET' || error.code === 'FST_CSRF_INVALID_TOKEN') && request.url === '/admin/login') {
        return reply.redirect('/admin/login');
      }
      if (error.code === 'FST_ERR_REP_ALREADY_SENT') return;
      reply.code(error.statusCode || 500).send({ statusCode: error.statusCode || 500, error: error.name, message: error.message });
    });

    registerAuthRoutes(app);

    app.addHook('preHandler', requireAuth);

    registerOnboardingRoutes(app, opts);
    registerDashboardRoutes(app);
    registerBookingsRoutes(app, { encryptionKey });
    registerCalendarsRoutes(app, { ...opts, encryptionKey, googleClientId, googleClientSecret, googleRedirectUri, zohoClientId, zohoClientSecret, zohoRedirectUri, zohoAccountsServer });
    registerProfileRoutes(app);
    registerSettingsRoutes(app);
  }, { prefix: '/admin' });


  app.register(async function publicRoutes(app) {
    registerBookingRoutes(app, { encryptionKey, baseLayout: BASE_LAYOUT });
  }, { prefix: '/book' });

  app.register(async function publicApi(app) {
    registerRateLimitHook(app);
    registerSlotsApi(app, { encryptionKey });
    registerBusynessApi(app, { encryptionKey });
    registerBookingSubmitApi(app, { encryptionKey });
  }, { prefix: '/api/book' });

  app.register(async function cancelPage(app) {
    registerCancellationPage(app, { encryptionKey, baseLayout: BASE_LAYOUT });
  }, { prefix: '/cancel' });

  app.register(async function cancelApi(app) {
    registerCancellationApi(app, { encryptionKey });
  }, { prefix: '/api/cancel' });

  app.addHook('onClose', async () => {
    await app.db.close();
  });

  return app;
}

module.exports = { buildApp, BASE_LAYOUT };
