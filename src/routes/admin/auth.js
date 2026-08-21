const bcrypt = require('bcrypt');
const { escapeHtml } = require('../../utils/html');
const { BASE_LAYOUT } = require('../../views/layout');

const STATIC_URL = process.env.STATIC_ASSETS_URL || '';

function registerAuthRoutes(app) {
  app.get('/login', async (request, reply) => {
    const token = reply.generateCsrf();
    const next = request.query.next || '';
    const nextInput = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : '';
    reply.type('text/html').send(BASE_LAYOUT('Login', `
      <div class="login-card">
        <article>
          <a href="/home" class="login-logo"><img src="${STATIC_URL}/img/icon.svg" alt="" style="height: 48px;"></a>
          <a href="/home" class="login-title"><img src="${STATIC_URL}/img/wordmark.svg" alt="Logo" style="height: 24px;"></a>
          <div class="login-subtitle">Welcome back! Sign in to your account.</div>
          <form method="POST" action="/admin/login">
            <input type="hidden" name="_csrf" value="${token}">
            ${nextInput}
            <div class="float-field">
              <input type="email" name="email" id="login-email" placeholder=" " required autofocus>
              <label for="login-email">Email</label>
            </div>
            <div class="float-field">
              <input type="password" name="password" id="login-password" placeholder=" " required>
              <label for="login-password">Password</label>
            </div>
            <button type="submit" style="width: 100%;">Sign In →</button>
          </form>
          <p style="text-align: center; margin-top: 1rem; font-size: 0.875rem; color: var(--text-secondary);">
            Don't have an account? <a href="/admin/register">Create one</a>
          </p>
        </article>
      </div>
    `));
  });

  app.post('/login', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { email, password } = request.body || {};
    const isAjax = request.headers['x-requested-with'] === 'XMLHttpRequest';

    const admin = await app.db.getOne('SELECT * FROM admin WHERE email = $1', [email]);
    if (!admin || !(await bcrypt.compare(password || '', admin.password_hash))) {
      if (isAjax) {
        return reply.code(401).send({ error: 'Invalid email or password. Please try again.' });
      }
      const token = reply.generateCsrf();
      return reply.type('text/html').send(BASE_LAYOUT('Login', `
        <div class="login-card">
          <article>
            <a href="/home" class="login-logo"><img src="${STATIC_URL}/img/icon.svg" alt="" style="height: 48px;"></a>
            <a href="/home" class="login-title"><img src="${STATIC_URL}/img/wordmark.svg" alt="Logo" style="height: 24px;"></a>
            <div class="login-subtitle">Welcome back! Sign in to your account.</div>
            <div role="alert" class="error">
              Invalid email or password. Please try again.
            </div>
            <form method="POST" action="/admin/login">
              <input type="hidden" name="_csrf" value="${token}">
              <div class="float-field">
                <input type="email" name="email" id="login-email" placeholder=" " value="${escapeHtml(email || '')}" required autofocus>
                <label for="login-email">Email</label>
              </div>
              <div class="float-field">
                <input type="password" name="password" id="login-password" placeholder=" " required>
                <label for="login-password">Password</label>
              </div>
              <button type="submit" style="width: 100%;">Sign In →</button>
            </form>
            <p style="text-align: center; margin-top: 1rem; font-size: 0.875rem; color: var(--text-secondary);">
              Don't have an account? <a href="/admin/register">Create one</a>
            </p>
          </article>
        </div>
      `));
    }

    request.session.set('adminId', admin.id);
    const nextUrl = request.body?.next || request.query?.next;
    let dest;
    if (nextUrl && nextUrl.startsWith('/admin/')) {
      dest = nextUrl;
    } else {
      const onboardingCheck = await app.db.getOne('SELECT onboarding_completed_at, email FROM admin WHERE id = $1', [admin.id]);
      const forceOnboarding = onboardingCheck && onboardingCheck.email === 'onboarding@test.com';
      dest = forceOnboarding || !(onboardingCheck && onboardingCheck.onboarding_completed_at) ? '/admin/onboarding' : '/admin/dashboard';
    }
    if (isAjax) {
      return reply.send({ redirect: dest, theme: admin.theme || 'system' });
    }
    return reply.redirect(dest);
  });

  app.get('/register', async (request, reply) => {
    const token = reply.generateCsrf();
    reply.type('text/html').send(BASE_LAYOUT('Register', `
      <div class="login-card">
        <article>
          <a href="/home" class="login-logo"><img src="${STATIC_URL}/img/icon.svg" alt="" style="height: 48px;"></a>
          <a href="/home" class="login-title"><img src="${STATIC_URL}/img/wordmark.svg" alt="Logo" style="height: 24px;"></a>
          <div class="login-subtitle">Create your account to get started.</div>
          <form method="POST" action="/admin/register">
            <input type="hidden" name="_csrf" value="${token}">
            <div class="float-field">
              <input type="email" name="email" id="reg-email" placeholder=" " required autofocus>
              <label for="reg-email">Email</label>
            </div>
            <div class="float-field">
              <input type="text" name="username" id="reg-username" placeholder=" " required>
              <label for="reg-username">Username</label>
            </div>
            <div class="float-field">
              <input type="password" name="password" id="reg-password" placeholder=" " required minlength="6">
              <label for="reg-password">Password</label>
            </div>
            <div class="float-field">
              <input type="password" name="confirm_password" id="reg-confirm" placeholder=" " required>
              <label for="reg-confirm">Confirm Password</label>
            </div>
            <button type="submit" style="width: 100%;">Create Account →</button>
          </form>
          <p style="text-align: center; margin-top: 1rem; font-size: 0.875rem; color: var(--text-secondary);">
            Already have an account? <a href="/admin/login">Sign in</a>
          </p>
        </article>
      </div>
    `));
  });

  app.post('/register', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { email, username, password, confirm_password } = request.body || {};
    const isAjax = request.headers['x-requested-with'] === 'XMLHttpRequest';
    const token = reply.generateCsrf();

    const renderError = (msg) => {
      if (isAjax) return reply.code(400).send({ error: msg });
      return reply.type('text/html').send(BASE_LAYOUT('Register', `
      <div class="login-card">
        <article>
          <a href="/home" class="login-logo"><img src="${STATIC_URL}/img/icon.svg" alt="" style="height: 48px;"></a>
          <a href="/home" class="login-title"><img src="${STATIC_URL}/img/wordmark.svg" alt="Logo" style="height: 24px;"></a>
          <div class="login-subtitle">Create your account to get started.</div>
          <div role="alert" class="error">${escapeHtml(msg)}</div>
          <form method="POST" action="/admin/register">
            <input type="hidden" name="_csrf" value="${token}">
            <label>
              Email
              <input type="email" name="email" placeholder="Enter your email" value="${escapeHtml(email || '')}" required autofocus>
            </label>
            <label>
              Username
              <input type="text" name="username" placeholder="Choose a username" value="${escapeHtml(username || '')}" required>
            </label>
            <label>
              Password
              <input type="password" name="password" placeholder="Create a password" required minlength="6">
            </label>
            <label>
              Confirm Password
              <input type="password" name="confirm_password" placeholder="Confirm your password" required>
            </label>
            <button type="submit" style="width: 100%;">Create Account →</button>
          </form>
          <p style="text-align: center; margin-top: 1rem; font-size: 0.875rem; color: var(--text-secondary);">
            Already have an account? <a href="/admin/login">Sign in</a>
          </p>
        </article>
      </div>
    `));
    };

    if (!email || !username || !password) return renderError('All fields are required.');
    if (password !== confirm_password) return renderError('Passwords do not match.');
    if (password.length < 6) return renderError('Password must be at least 6 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return renderError('Invalid email address.');

    const existingEmail = await app.db.getOne('SELECT id FROM admin WHERE email = $1', [email]);
    if (existingEmail) return renderError('An account with this email already exists.');

    const existingUsername = await app.db.getOne('SELECT id FROM admin WHERE username = $1', [username]);
    if (existingUsername) return renderError('This username is already taken.');

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await app.db.query('INSERT INTO admin (email, username, password_hash, timezone, notification_email) VALUES ($1, $2, $3, $4, $5) RETURNING id', [email, username.trim(), passwordHash, 'UTC', email]);

    request.session.set('adminId', result.rows[0].id);
    if (isAjax) return reply.send({ redirect: '/admin/onboarding' });
    return reply.redirect('/admin/onboarding');
  });

  app.post('/logout', { preHandler: app.csrfProtection }, async (request, reply) => {
    await request.session.destroy();
    return reply.redirect('/admin/login');
  });

  app.get('/logout', async (request, reply) => {
    await request.session.destroy();
    return reply.redirect('/admin/login');
  });
}

module.exports = { registerAuthRoutes };
