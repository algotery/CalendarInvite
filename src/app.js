const crypto = require('node:crypto');
const path = require('node:path');
const fastify = require('fastify');
const formbody = require('@fastify/formbody');
const cookie = require('@fastify/cookie');
const session = require('@fastify/session');
const csrf = require('@fastify/csrf-protection');
const fastifyStatic = require('@fastify/static');
const bcrypt = require('bcrypt');
const { createDatabase } = require('./db');
const { buildGoogleAuthUrl, exchangeCodeForTokens, getGoogleUserEmail } = require('./google');
const { encrypt, decrypt } = require('./encryption');
const { registerProfileRoutes } = require('./profiles');
const { registerBookingRoutes, registerSlotsApi, registerBusynessApi, registerBookingSubmitApi, registerCancellationPage, registerCancellationApi, registerRateLimitHook } = require('./booking');
const { getBatchedBookings } = require('./performance-fixes');
const { requireAuth } = require('./middleware/auth');
const { registerHealthRoutes } = require('./routes/health');
const { BASE_LAYOUT, escapeHtml, TIMEZONES } = require('./views/layout');




async function buildApp(opts = {}) {
  const app = fastify({ logger: opts.logger || false });

  const connectionString = opts.connectionString || process.env.DATABASE_URL;
  const db = await createDatabase(connectionString);
  const encryptionKey = opts.encryptionKey || process.env.TOKEN_ENCRYPTION_KEY;
  const googleClientId = opts.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = opts.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const googleRedirectUri = opts.googleRedirectUri || process.env.GOOGLE_REDIRECT_URI;
  const zohoClientId = opts.zohoClientId || process.env.ZOHO_CLIENT_ID;
  const zohoClientSecret = opts.zohoClientSecret || process.env.ZOHO_CLIENT_SECRET;
  const zohoRedirectUri = opts.zohoRedirectUri || process.env.ZOHO_REDIRECT_URI;

  app.decorate('db', db);
  app.decorate('fetchFn', opts.fetchFn || globalThis.fetch);
  app.decorate('zohoFetch', null);

  app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
    maxAge: '7d',
  });

  app.register(formbody);
  app.register(cookie);
  const sessionSecret = opts.sessionSecret || process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is required');
  }
  if (!encryptionKey) {
    throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required');
  }
  app.register(session, {
    secret: sessionSecret,
    cookie: { secure: false, httpOnly: true, sameSite: 'lax' },
  });
  app.register(csrf, { sessionPlugin: '@fastify/session' });

  registerHealthRoutes(app);

  app.get('/', async (request, reply) => {
    reply.type('text/html').send(BASE_LAYOUT('Home', `
      <div style="text-align: center; padding: 4rem 0;">
        <img src="/img/icon.svg" alt="" style="height: 64px; margin-bottom: 1rem;">
        <h1 style="font-size: 3rem; margin-bottom: 2rem;"><img src="/img/wordmark.svg" alt="Logo" style="height: 36px;"></h1>
        <a href="/admin/login" role="button" style="padding: 12px 32px; font-size: 1rem;">Admin Login →</a>
      </div>
    `));
  });

  app.register(async function adminRoutes(app) {
    app.setErrorHandler(async (error, request, reply) => {
      if ((error.code === 'FST_CSRF_MISSING_SECRET' || error.code === 'FST_CSRF_INVALID_TOKEN') && request.url === '/admin/login') {
        return reply.redirect('/admin/login');
      }
      reply.code(error.statusCode || 500).send({ statusCode: error.statusCode || 500, error: error.name, message: error.message });
    });

    app.get('/login', async (request, reply) => {
      const token = reply.generateCsrf();
      reply.type('text/html').send(BASE_LAYOUT('Login', `
        <div class="login-card">
          <article>
            <div class="login-logo"><img src="/img/icon.svg" alt="" style="height: 48px;"></div>
            <div class="login-title"><img src="/img/wordmark.svg" alt="Logo" style="height: 24px;"></div>
            <div class="login-subtitle">Welcome back! Sign in to your account.</div>
            <form method="POST" action="/admin/login">
              <input type="hidden" name="_csrf" value="${token}">
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
              <div class="login-logo"><img src="/img/icon.svg" alt="" style="height: 48px;"></div>
              <div class="login-title"><img src="/img/wordmark.svg" alt="Logo" style="height: 24px;"></div>
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
      if (isAjax) {
        return reply.send({ redirect: '/admin/dashboard' });
      }
      return reply.redirect('/admin/dashboard');
    });

    app.get('/register', async (request, reply) => {
      const token = reply.generateCsrf();
      reply.type('text/html').send(BASE_LAYOUT('Register', `
        <div class="login-card">
          <article>
            <div class="login-logo"><img src="/img/icon.svg" alt="" style="height: 48px;"></div>
            <div class="login-title"><img src="/img/wordmark.svg" alt="Logo" style="height: 24px;"></div>
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
            <div class="login-logo"><img src="/img/icon.svg" alt="" style="height: 48px;"></div>
            <div class="login-title"><img src="/img/wordmark.svg" alt="Logo" style="height: 24px;"></div>
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
      if (isAjax) return reply.send({ redirect: '/admin/dashboard' });
      return reply.redirect('/admin/dashboard');
    });

    app.addHook('preHandler', requireAuth);


    app.get('/dashboard', async (request, reply) => {
      const token = reply.generateCsrf();
      const adminId = request.session.get('adminId');
      const admin = await app.db.getOne('SELECT timezone FROM admin WHERE id = $1', [adminId]);
      const adminTz = admin ? admin.timezone : 'UTC';

      const activeProfiles = await app.db.getOne("SELECT COUNT(*) as count FROM booking_profiles WHERE is_active = true AND user_id = $1", [adminId]);
      const now = new Date().toISOString();
      const upcomingCount = await app.db.getOne("SELECT COUNT(*) as count FROM bookings b JOIN booking_profiles bp ON b.profile_id = bp.id WHERE b.status = 'confirmed' AND b.start_time > $1 AND bp.user_id = $2", [now, adminId]);
      const next5 = await app.db.getAll(
        "SELECT b.*, bp.name as profile_name FROM bookings b JOIN booking_profiles bp ON b.profile_id = bp.id WHERE b.status = 'confirmed' AND b.start_time > $1 AND bp.user_id = $2 ORDER BY b.start_time ASC LIMIT 5",
        [now, adminId]
      );

      const next5Cards = next5.map(b => {
        const start = new Date(b.start_time);
        const dateStr = start.toLocaleString('en-US', { timeZone: adminTz, dateStyle: 'medium' });
        const timeStr = start.toLocaleString('en-US', { timeZone: adminTz, timeStyle: 'short' });
        return `
          <div class="dashboard-booking-card">
            <div class="dashboard-booking-time">
              <span class="dashboard-booking-date">${escapeHtml(dateStr)}</span>
              <span class="dashboard-booking-hour">${escapeHtml(timeStr)}</span>
            </div>
            <div class="dashboard-booking-details">
              <span class="dashboard-booking-title">${escapeHtml(b.title)}</span>
              <span class="dashboard-booking-meta">${escapeHtml(b.booker_name)} &middot; ${escapeHtml(b.profile_name)}</span>
            </div>
          </div>`;
      }).join('');

      reply.type('text/html').send(BASE_LAYOUT('Dashboard', `
        <div class="dashboard-page">
          <div class="dashboard-header">
            <h1>Dashboard</h1>
          </div>
          <div class="dashboard-stats">
            <div class="dashboard-stat-card">
              <div class="dashboard-stat-icon"><i class="ph-duotone ph-users"></i></div>
              <div class="dashboard-stat-content">
                <span class="dashboard-stat-value">${activeProfiles.count}</span>
                <span class="dashboard-stat-label">Active Profiles</span>
              </div>
            </div>
            <div class="dashboard-stat-card">
              <div class="dashboard-stat-icon"><i class="ph-duotone ph-calendar-check"></i></div>
              <div class="dashboard-stat-content">
                <span class="dashboard-stat-value">${upcomingCount.count}</span>
                <span class="dashboard-stat-label">Upcoming Bookings</span>
              </div>
            </div>
          </div>
          ${next5.length ? `
            <div class="dashboard-upcoming-section">
              <span class="field-label" style="margin-bottom: 12px; display: block;">Upcoming</span>
              <div class="dashboard-bookings-list">
                ${next5Cards}
              </div>
            </div>
          ` : `
            <div class="calendars-empty">
              <div class="calendars-empty-icon">
                <i class="ph-duotone ph-calendar-check"></i>
              </div>
              <h3>No upcoming bookings</h3>
            </div>
          `}
          <div class="dashboard-actions">
            <a href="/admin/profiles/new" class="btn-primary profile-overlay-trigger" data-url="/admin/profiles/new?partial=1"><i class="ph-bold ph-plus"></i> New Profile</a>
            <a href="/admin/bookings" class="btn-secondary">View All Bookings</a>
            <form method="POST" action="/admin/logout" style="margin: 0; padding: 0; border: none; background: none; margin-left: auto;" onsubmit="event.preventDefault(); var f=this; AppModal.confirm('Are you sure you want to logout?', function(){f.submit()}, {title:'Logout', confirmText:'Logout', icon:'<i class=\\'ph-fill ph-sign-out\\' style=\\'font-size:32px;color:var(--primary)\\'></i>'}); return false;">
              <input type="hidden" name="_csrf" value="${token}">
              <button type="submit" class="btn-disconnect"><i class="ph-bold ph-sign-out"></i> Logout</button>
            </form>
          </div>
        </div>
      `, true, 'dashboard'));
    });

    app.get('/bookings', async (request, reply) => {
      const token = reply.generateCsrf();
      const adminId = request.session.get('adminId');
      const admin = await app.db.getOne('SELECT timezone FROM admin WHERE id = $1', [adminId]);
      const adminTz = admin ? admin.timezone : 'UTC';

      const { status, profile_id, filter, view } = request.query;
      const activeView = view || 'list';
      const activeFilter = filter || 'today';
      const hasExplicitFilter = !!filter;

      const now = new Date();
      let timeMin = null, timeMax = null;

      if (activeFilter === 'today') {
        const todayStart = new Date(now.toLocaleString('en-US', { timeZone: adminTz }));
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);
        timeMin = todayStart.toISOString();
        timeMax = todayEnd.toISOString();
      } else if (activeFilter === 'upcoming') {
        timeMin = now.toISOString();
        timeMax = null;
      } else if (activeFilter === 'all') {
        timeMin = null;
        timeMax = null;
      } else if (activeFilter === 'this_week') {
        const todayLocal = new Date(now.toLocaleString('en-US', { timeZone: adminTz }));
        const dayOfWeek = todayLocal.getDay();
        const monday = new Date(todayLocal);
        monday.setDate(todayLocal.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        monday.setHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 7);
        timeMin = monday.toISOString();
        timeMax = sunday.toISOString();
      } else if (activeFilter === 'last_week') {
        const todayLocal = new Date(now.toLocaleString('en-US', { timeZone: adminTz }));
        const dayOfWeek = todayLocal.getDay();
        const thisMonday = new Date(todayLocal);
        thisMonday.setDate(todayLocal.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        thisMonday.setHours(0, 0, 0, 0);
        const lastMonday = new Date(thisMonday);
        lastMonday.setDate(thisMonday.getDate() - 7);
        timeMin = lastMonday.toISOString();
        timeMax = thisMonday.toISOString();
      }

      const bookings = await getBatchedBookings(app.db, adminTz, {
        user_id: adminId,
        status,
        profile_id,
        timeMin,
        timeMax,
        limit: 100,
        offset: 0
      });

      const formatterDate = new Intl.DateTimeFormat('en-GB', { timeZone: adminTz, weekday: 'short', day: 'numeric', month: 'short' });
      const formatterTime = new Intl.DateTimeFormat('en-GB', { timeZone: adminTz, hour: '2-digit', minute: '2-digit', hour12: false });

      const grouped = {};
      const todayStr = formatterDate.format(now).replace(',', '');

      bookings.forEach(b => {
        const start = new Date(b.start_time);
        const dateKey = formatterDate.format(start).replace(',', '');
        if (!grouped[dateKey]) {
           grouped[dateKey] = { meetings: [], date: start };
        }
        grouped[dateKey].meetings.push(b);
      });

      let rowsHtml = '';
      const nowMs = now.getTime();
      const sortedDates = Object.entries(grouped).sort((a, b) => {
        const aFuture = a[1].date.getTime() >= nowMs;
        const bFuture = b[1].date.getTime() >= nowMs;
        if (aFuture && !bFuture) return -1;
        if (!aFuture && bFuture) return 1;
        if (aFuture && bFuture) return a[1].date - b[1].date;
        return b[1].date - a[1].date;
      });

      for (const [dateStr, group] of sortedDates) {
         const isToday = dateStr === todayStr;
         rowsHtml += `
           <div class="meeting-day-group">
             <div class="meeting-day-header">
               ${escapeHtml(dateStr)}${isToday ? ' <span class="today-badge">Today</span>' : ''}
             </div>
             ${isToday ? '<div class="current-time-line"></div>' : ''}
             <div class="meeting-list">
         `;
         group.meetings.forEach(b => {
            const start = new Date(b.start_time);
            const end = new Date(start.getTime() + b.duration_minutes * 60000);

            const startTimeStr = formatterTime.format(start);
            const endTimeStr = formatterTime.format(end);
            const fullDateStr = start.toLocaleDateString('en-GB', { timeZone: adminTz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

            const isPast = end < now;
            const dotClass = (b.status === 'cancelled' || isPast) ? 'meeting-dot dot-past' : 'meeting-dot dot-upcoming';

            const cancelBtn = b.status === 'confirmed'
              ? `<form method="POST" action="/admin/bookings/${b.id}/cancel" style="display:inline; margin:0;" onsubmit="event.preventDefault(); event.stopPropagation(); var f=this; AppModal.confirm('Are you sure you want to cancel this meeting?', function(){f.submit()}, {title:'Cancel Meeting', confirmText:'Cancel Meeting', danger:true, icon:'<i class=\\'ph-fill ph-calendar-x\\' style=\\'font-size:32px;color:var(--error)\\'></i>'}); return false;"><input type="hidden" name="_csrf" value="${token}"><button type="submit" class="icon-btn" title="Cancel Meeting" onclick="event.stopPropagation()"><i class="ph-bold ph-x"></i></button></form>`
              : `<span class="badge error">Cancelled</span>`;

            let attendeesArr = [b.booker_email];
            try { if (b.additional_attendees) attendeesArr.push(...JSON.parse(b.additional_attendees)); } catch {}

            rowsHtml += `
              <div class="meeting-row meeting-row-clickable" data-status="${escapeHtml(b.status)}"
                data-meeting-id="${b.id}"
                data-meeting-title="${escapeHtml(b.title || b.profile_name)}"
                data-meeting-booker="${escapeHtml(b.booker_name)}"
                data-meeting-email="${escapeHtml(b.booker_email)}"
                data-meeting-date="${escapeHtml(fullDateStr)}"
                data-meeting-time="${startTimeStr} - ${endTimeStr}"
                data-meeting-duration="${b.duration_minutes}"
                data-meeting-profile="${escapeHtml(b.profile_name)}"
                data-meeting-status="${escapeHtml(b.status)}"
                data-meeting-description="${escapeHtml(b.description || '')}"
                data-meeting-attendees="${escapeHtml(attendeesArr.join(', '))}"
>
                <div class="meeting-time">
                  ${startTimeStr} - ${endTimeStr}
                  <span class="meeting-duration">${b.duration_minutes} min</span>
                </div>
                <div class="meeting-details">
                  <div class="${dotClass}"></div>
                  <span class="meeting-title">${escapeHtml(b.title || b.profile_name)}</span>
                  <span class="meeting-booker">with ${escapeHtml(b.booker_name)}</span>
                  <span class="meeting-profile">${escapeHtml(b.profile_name)}</span>
                </div>
                <div class="meeting-actions">
                  <a href="mailto:${escapeHtml(b.booker_email)}" class="icon-btn" title="Email Booker" onclick="event.stopPropagation()"><i class="ph-bold ph-envelope-simple"></i></a>
                  ${cancelBtn}
                </div>
              </div>
            `;
         });
         rowsHtml += `
             </div>
           </div>
         `;
      }

      if (sortedDates.length === 0) {
        rowsHtml = `
          <div class="meetings-empty">
            <div class="meetings-empty-icon"><i class="ph-duotone ph-calendar-blank"></i></div>
            <h3>You're all caught up!</h3>
            <p>No meetings found for this filter.</p>
          </div>
        `;
      }

      const dateDisplay = now.toLocaleDateString('en-US', { timeZone: adminTz, weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
      const meetingCount = bookings.length;

      // Calendar view: build monthly grid
      let calendarHtml = '';
      if (activeView === 'calendar') {
        const calMonth = parseInt(request.query.month) || (now.getMonth() + 1);
        const calYear = parseInt(request.query.year) || now.getFullYear();
        const prevMonth = calMonth === 1 ? 12 : calMonth - 1;
        const prevYear = calMonth === 1 ? calYear - 1 : calYear;
        const nextMonth = calMonth === 12 ? 1 : calMonth + 1;
        const nextYear = calMonth === 12 ? calYear + 1 : calYear;

        const monthStart = new Date(calYear, calMonth - 1, 1);
        const monthEnd = new Date(calYear, calMonth, 0);
        const monthName = monthStart.toLocaleString('en-US', { month: 'long', year: 'numeric' });

        const allBookings = await getBatchedBookings(app.db, adminTz, {
          user_id: adminId,
          status: 'confirmed',
          timeMin: new Date(calYear, calMonth - 1, 1).toISOString(),
          timeMax: new Date(calYear, calMonth, 1).toISOString(),
          limit: 500,
          offset: 0
        });

        const bookingsByDay = {};
        allBookings.forEach(b => {
          const d = new Date(b.start_time);
          const localDate = new Date(d.toLocaleString('en-US', { timeZone: adminTz }));
          const day = localDate.getDate();
          if (!bookingsByDay[day]) bookingsByDay[day] = [];
          bookingsByDay[day].push(b);
        });

        const startDow = monthStart.getDay();
        const daysInMonth = monthEnd.getDate();
        const todayDate = new Date(now.toLocaleString('en-US', { timeZone: adminTz })).getDate();
        const todayMonth = new Date(now.toLocaleString('en-US', { timeZone: adminTz })).getMonth() + 1;
        const todayYear = new Date(now.toLocaleString('en-US', { timeZone: adminTz })).getFullYear();

        let cells = '';
        const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
        for (let i = 0; i < totalCells; i++) {
          const dayNum = i - startDow + 1;
          const isCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
          const isToday = isCurrentMonth && dayNum === todayDate && calMonth === todayMonth && calYear === todayYear;
          const dayBookings = isCurrentMonth ? (bookingsByDay[dayNum] || []) : [];

          let eventsHtml = '';
          dayBookings.slice(0, 3).forEach(b => {
            const bStart = new Date(b.start_time);
            const timeStr = formatterTime.format(bStart);
            eventsHtml += `<div class="cal-event"><span class="cal-event-time">${timeStr}</span> <span class="cal-event-title">${escapeHtml(b.title || b.profile_name)}</span></div>`;
          });
          if (dayBookings.length > 3) {
            eventsHtml += `<div class="cal-event cal-event-more">+${dayBookings.length - 3} more</div>`;
          }

          cells += `<div class="cal-cell${isCurrentMonth ? '' : ' cal-cell-outside'}${isToday ? ' cal-cell-today' : ''}">
            <span class="cal-day-num${isToday ? ' cal-today-num' : ''}">${isCurrentMonth ? dayNum : ''}</span>
            <div class="cal-events">${eventsHtml}</div>
          </div>`;
        }

        calendarHtml = `
          <div class="cal-header">
            <a href="/admin/bookings?view=calendar&month=${prevMonth}&year=${prevYear}" class="cal-nav-btn"><i class="ph-bold ph-caret-left"></i></a>
            <span class="cal-month-title">${escapeHtml(monthName)}</span>
            <a href="/admin/bookings?view=calendar&month=${nextMonth}&year=${nextYear}" class="cal-nav-btn"><i class="ph-bold ph-caret-right"></i></a>
          </div>
          <div class="cal-grid">
            <div class="cal-weekday">Sun</div><div class="cal-weekday">Mon</div><div class="cal-weekday">Tue</div><div class="cal-weekday">Wed</div><div class="cal-weekday">Thu</div><div class="cal-weekday">Fri</div><div class="cal-weekday">Sat</div>
            ${cells}
          </div>
        `;
      }

      reply.type('text/html').send(BASE_LAYOUT('Bookings', `
        <div class="page-header-top">
          <h1>Meetings</h1>
          <div class="view-toggle">
            <a href="/admin/bookings?filter=${activeFilter}&view=list" class="view-toggle-btn${activeView === 'list' ? ' active' : ''}" title="List view"><i class="ph-bold ph-list"></i></a>
            <a href="/admin/bookings?view=calendar" class="view-toggle-btn${activeView === 'calendar' ? ' active' : ''}" title="Calendar view"><i class="ph-bold ph-calendar-blank"></i></a>
          </div>
        </div>

        ${activeView === 'list' ? `
        <div class="meetings-filter-bar">
          <div class="meetings-filter-left">
            <span class="filter-date-label">${escapeHtml(dateDisplay)}</span>
            <div class="filter-divider"></div>
            <div class="filter-tabs">
              <a href="/admin/bookings?filter=today" class="filter-tab${activeFilter === 'today' ? ' active' : ''}"><i class="ph-bold ph-check"></i> Today</a>
              <a href="/admin/bookings?filter=upcoming" class="filter-tab${activeFilter === 'upcoming' ? ' active' : ''}"><i class="ph-bold ph-check"></i> Upcoming</a>
              <a href="/admin/bookings?filter=this_week" class="filter-tab${activeFilter === 'this_week' ? ' active' : ''}"><i class="ph-bold ph-check"></i> This week</a>
              <a href="/admin/bookings?filter=last_week" class="filter-tab${activeFilter === 'last_week' ? ' active' : ''}"><i class="ph-bold ph-check"></i> Last week</a>
              <a href="/admin/bookings?filter=all" class="filter-tab${activeFilter === 'all' ? ' active' : ''}"><i class="ph-bold ph-check"></i> All</a>
            </div>
          </div>
          <div class="meetings-filter-right">
            <span class="filter-count">Displaying ${meetingCount} meeting${meetingCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
        ${rowsHtml}
        ` : calendarHtml}

        <div class="meeting-detail-overlay" id="meetingDetailOverlay">
          <div class="meeting-detail-backdrop"></div>
          <div class="meeting-detail-modal">
            <div class="meeting-detail-header">
              <h2 id="meetingDetailTitle"></h2>
              <button class="meeting-detail-close" id="meetingDetailClose"><i class="ph-bold ph-x"></i></button>
            </div>
            <div class="meeting-detail-body">
              <div class="meeting-detail-status" id="meetingDetailStatus"></div>
              <div class="meeting-detail-grid">
                <div class="meeting-detail-item">
                  <span class="meeting-detail-label"><i class="ph-duotone ph-user"></i> Booked by</span>
                  <span class="meeting-detail-value" id="meetingDetailBooker"></span>
                </div>
                <div class="meeting-detail-item">
                  <span class="meeting-detail-label"><i class="ph-duotone ph-envelope"></i> Email</span>
                  <span class="meeting-detail-value" id="meetingDetailEmail"></span>
                </div>
                <div class="meeting-detail-item">
                  <span class="meeting-detail-label"><i class="ph-duotone ph-calendar"></i> Date</span>
                  <span class="meeting-detail-value" id="meetingDetailDate"></span>
                </div>
                <div class="meeting-detail-item">
                  <span class="meeting-detail-label"><i class="ph-duotone ph-clock"></i> Time</span>
                  <span class="meeting-detail-value" id="meetingDetailTime"></span>
                </div>
                <div class="meeting-detail-item">
                  <span class="meeting-detail-label"><i class="ph-duotone ph-timer"></i> Duration</span>
                  <span class="meeting-detail-value" id="meetingDetailDuration"></span>
                </div>
                <div class="meeting-detail-item">
                  <span class="meeting-detail-label"><i class="ph-duotone ph-bookmark"></i> Profile</span>
                  <span class="meeting-detail-value" id="meetingDetailProfile"></span>
                </div>
                <div class="meeting-detail-item" id="meetingDetailAttendeesRow">
                  <span class="meeting-detail-label"><i class="ph-duotone ph-users"></i> Attendees</span>
                  <span class="meeting-detail-value" id="meetingDetailAttendees"></span>
                </div>
                <div class="meeting-detail-item" id="meetingDetailDescRow" style="display:none;">
                  <span class="meeting-detail-label"><i class="ph-duotone ph-note"></i> Description</span>
                  <span class="meeting-detail-value" id="meetingDetailDesc"></span>
                </div>
              </div>
            </div>
            <div class="meeting-detail-footer" id="meetingDetailFooter">
              <a href="#" class="meeting-detail-btn secondary" id="meetingDetailEmailBtn"><i class="ph-bold ph-envelope-simple"></i> Send Email</a>
              <form method="POST" id="meetingDetailCancelForm" style="margin:0;">
                <input type="hidden" name="_csrf" value="${token}">
                <button type="submit" class="meeting-detail-btn danger"><i class="ph-bold ph-x-circle"></i> Cancel Meeting</button>
              </form>
            </div>
          </div>
        </div>

        <script>
        (function(){
          var overlay = document.getElementById('meetingDetailOverlay');
          var backdrop = overlay.querySelector('.meeting-detail-backdrop');
          var closeBtn = document.getElementById('meetingDetailClose');
          var cancelForm = document.getElementById('meetingDetailCancelForm');

          document.querySelectorAll('.meeting-row-clickable').forEach(function(row) {
            row.addEventListener('click', function() {
              var d = row.dataset;
              document.getElementById('meetingDetailTitle').textContent = d.meetingTitle;
              document.getElementById('meetingDetailBooker').textContent = d.meetingBooker;
              document.getElementById('meetingDetailEmail').textContent = d.meetingEmail;
              document.getElementById('meetingDetailDate').textContent = d.meetingDate;
              document.getElementById('meetingDetailTime').textContent = d.meetingTime;
              document.getElementById('meetingDetailDuration').textContent = d.meetingDuration + ' minutes';
              document.getElementById('meetingDetailProfile').textContent = d.meetingProfile;
              document.getElementById('meetingDetailAttendees').textContent = d.meetingAttendees;
              document.getElementById('meetingDetailEmailBtn').href = 'mailto:' + d.meetingEmail;

              var descRow = document.getElementById('meetingDetailDescRow');
              if (d.meetingDescription) {
                descRow.style.display = '';
                document.getElementById('meetingDetailDesc').textContent = d.meetingDescription;
              } else {
                descRow.style.display = 'none';
              }

              var statusEl = document.getElementById('meetingDetailStatus');
              var footer = document.getElementById('meetingDetailFooter');
              if (d.meetingStatus === 'cancelled') {
                statusEl.innerHTML = '<span class="badge error">Cancelled</span>';
                footer.style.display = 'none';
              } else {
                statusEl.innerHTML = '<span class="badge success">Confirmed</span>';
                footer.style.display = '';
              }

              cancelForm.action = '/admin/bookings/' + d.meetingId + '/cancel';
              cancelForm.onsubmit = function(e) {
                e.preventDefault();
                var f = cancelForm;
                AppModal.confirm('Are you sure you want to cancel this meeting?', function(){ f.submit(); }, {title:'Cancel Meeting', confirmText:'Cancel Meeting', danger:true, icon:'<i class="ph-fill ph-calendar-x" style="font-size:32px;color:var(--error)"></i>'});
              };

              overlay.classList.add('active');
              document.body.style.overflow = 'hidden';
            });
          });

          function closeOverlay() {
            overlay.classList.remove('active');
            document.body.style.overflow = '';
          }

          closeBtn.addEventListener('click', closeOverlay);
          backdrop.addEventListener('click', closeOverlay);
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && overlay.classList.contains('active')) closeOverlay();
          });
        })();
        </script>
      `, true, 'bookings'));
    });

    app.post('/bookings/:id/cancel', { preHandler: app.csrfProtection }, async (request, reply) => {
      const { id } = request.params;
      const adminId = request.session.get('adminId');
      const booking = await app.db.getOne("SELECT b.*, bp.write_calendar_id FROM bookings b JOIN booking_profiles bp ON b.profile_id = bp.id WHERE b.id = $1 AND bp.user_id = $2", [id, adminId]);

      if (!booking) {
        return reply.code(404).type('text/html').send(BASE_LAYOUT('Not Found', '<h1>Booking not found</h1>'));
      }

      if (booking.status === 'cancelled') {
        return reply.code(400).type('text/html').send(BASE_LAYOUT('Error', '<h1>Booking already cancelled</h1>'));
      }

      if (booking.calendar_event_id) {
        const deleteEv = async (connection, eventId) => {
          try {
            let accessToken;
            try { accessToken = decrypt(connection.encrypted_access_token, encryptionKey); } catch { accessToken = connection.encrypted_access_token; }
            if (connection.provider === 'google') {
              await app.fetchFn(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
            } else if (connection.provider === 'microsoft') {
              await app.fetchFn(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
            } else if (connection.provider === 'zoho') {
              const calendarsResponse = await app.fetchFn('https://calendar.zoho.com/api/v1/calendars', { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
              const calendarsData = await calendarsResponse.json();
              const primaryCalendar = calendarsData.calendars.find(c => c.isprimary) || calendarsData.calendars[0];
              await app.fetchFn(`https://calendar.zoho.com/api/v1/calendars/${primaryCalendar.uid}/events/${eventId}`, { method: 'DELETE', headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
            }
          } catch { }
        };

        try {
          const events = JSON.parse(booking.calendar_event_id);
          for (const ev of events) {
            const connection = await app.db.getOne("SELECT * FROM calendar_connections WHERE id = $1 AND status = 'connected'", [ev.connectionId]);
            if (connection) await deleteEv(connection, ev.eventId);
          }
        } catch (err) {
          if (booking.write_calendar_id) {
            const connection = await app.db.getOne("SELECT * FROM calendar_connections WHERE id = $1 AND status = 'connected'", [booking.write_calendar_id]);
            if (connection) await deleteEv(connection, booking.calendar_event_id);
          }
        }
      }

      await app.db.run("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [id]);
      return reply.redirect('/admin/bookings');
    });

    app.post('/bookings/:id/delete', { preHandler: app.csrfProtection }, async (request, reply) => {
      const { id } = request.params;
      const adminId = request.session.get('adminId');
      const booking = await app.db.getOne("SELECT b.*, bp.write_calendar_id FROM bookings b JOIN booking_profiles bp ON b.profile_id = bp.id WHERE b.id = $1 AND bp.user_id = $2", [id, adminId]);

      if (!booking) {
        return reply.code(404).type('text/html').send(BASE_LAYOUT('Not Found', '<h1>Booking not found</h1>'));
      }

      // Try to cancel from calendar provider if it's not already cancelled
      if (booking.status === 'confirmed' && booking.calendar_event_id) {
        const deleteEv = async (connection, eventId) => {
          try {
            let accessToken;
            try { accessToken = decrypt(connection.encrypted_access_token, encryptionKey); } catch { accessToken = connection.encrypted_access_token; }
            if (connection.provider === 'google') {
              await app.fetchFn(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
            } else if (connection.provider === 'microsoft') {
              await app.fetchFn(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
            } else if (connection.provider === 'zoho') {
              const calendarsResponse = await app.fetchFn('https://calendar.zoho.com/api/v1/calendars', { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
              const calendarsData = await calendarsResponse.json();
              const primaryCalendar = calendarsData.calendars.find(c => c.isprimary) || calendarsData.calendars[0];
              await app.fetchFn(`https://calendar.zoho.com/api/v1/calendars/${primaryCalendar.uid}/events/${eventId}`, { method: 'DELETE', headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
            }
          } catch { }
        };

        try {
          const events = JSON.parse(booking.calendar_event_id);
          for (const ev of events) {
            const connection = await app.db.getOne("SELECT * FROM calendar_connections WHERE id = $1 AND status = 'connected'", [ev.connectionId]);
            if (connection) await deleteEv(connection, ev.eventId);
          }
        } catch (err) {
          if (booking.write_calendar_id) {
            const connection = await app.db.getOne("SELECT * FROM calendar_connections WHERE id = $1 AND status = 'connected'", [booking.write_calendar_id]);
            if (connection) await deleteEv(connection, booking.calendar_event_id);
          }
        }
      }

      await app.db.run("DELETE FROM bookings WHERE id = $1", [id]);
      return reply.redirect('/admin/bookings');
    });

    app.post('/logout', { preHandler: app.csrfProtection }, async (request, reply) => {
      await request.session.destroy();
      return reply.redirect('/admin/login');
    });

    app.get('/logout', async (request, reply) => {
      await request.session.destroy();
      return reply.redirect('/admin/login');
    });

    app.get('/calendars', async (request, reply) => {
      const adminId = request.session.get('adminId');
      const connections = await app.db.getAll('SELECT * FROM calendar_connections WHERE user_id = $1', [adminId]);
      const token = reply.generateCsrf();
      const icons = {
        google: `<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`,
        microsoft: `<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M1.15 1.15h10.27v10.27H1.15z" fill="#f25022"/><path d="M12.58 1.15h10.27v10.27H12.58z" fill="#7fba00"/><path d="M1.15 12.58h10.27v10.27H1.15z" fill="#00a4ef"/><path d="M12.58 12.58h10.27v10.27H12.58z" fill="#ffb900"/></svg>`,
        zoho: `<svg width="18" height="18" viewBox="0 0 24 24" fill="#E31A2D" xmlns="http://www.w3.org/2000/svg"><path d="M23.111 21.054a1.862 1.862 0 1 1 0 3.725 1.862 1.862 0 0 1 0-3.725ZM7.587 3.551a3.551 3.551 0 1 1 0 7.102 3.551 3.551 0 0 1 0-7.102Zm7.564 3.726c1.614 0 2.923.637 2.923 1.956v3.744h.79a1.002 1.002 0 0 0 .977-1.196L18.423.856a.992.992 0 0 0-.964-.856H3.344a.99.99 0 0 0-.982 1.13l.872 6.071c.07.494.512.8711 1.012.8711h9.905v.2c0 .548-.567 1.002-1.282 1.002H7.669c-2.316 0-4.195-1.554-4.195-3.473V4.945C3.474 2.213 5.342 0 7.644 0h11.233L20.89 13.999a2.981 2.981 0 0 1-2.909 3.578h-.572a.992.992 0 0 0-.992.993v2.858c0 .548-.574 1.002-1.282 1.002H9.083l-4.526 2.45a2.155 2.155 0 0 1-1.026.257H1.587a.991.991 0 0 1-.991-.991v-2.072c0-1.874 1.83-3.41 4.103-3.41h10.453v.19c0-1.309-1.309-1.946-2.923-1.946h-3.486A5.513 5.513 0 0 1 3.474 11.29V8.657a.992.992 0 0 1 .992-.992h10.685Zm-7.564.846a.735.735 0 1 0 0 1.47.735.735 0 0 0 0-1.47Z"/></svg>`
      };

      const connectionCards = connections.map(c => `
        <div class="calendar-connection-card">
          <div class="calendar-connection-info">
            <div class="calendar-connection-icon">${icons[c.provider] || ''}</div>
            <div>
              <div class="calendar-connection-email">${escapeHtml(c.email || '')}</div>
              <div class="calendar-connection-provider">${escapeHtml(c.provider.charAt(0).toUpperCase() + c.provider.slice(1))}</div>
            </div>
          </div>
          <div class="calendar-connection-actions">
            <span class="calendar-connection-status status-${c.status}">${escapeHtml(c.status)}</span>
            <form method="POST" action="/admin/calendars/${c.id}/disconnect" style="display:inline" onsubmit="event.preventDefault(); var f=this; AppModal.confirm('Are you sure you want to disconnect this calendar?', function(){f.submit()}, {title:'Disconnect Calendar', confirmText:'Disconnect', danger:true, icon:'<i class=\\'ph-fill ph-plug\\' style=\\'font-size:32px;color:var(--error)\\'></i>'}); return false;">
              <input type="hidden" name="_csrf" value="${token}">
              <button type="submit" class="btn-disconnect"><i class="ph-bold ph-plug"></i> Disconnect</button>
            </form>
          </div>
        </div>
      `).join('');

      const googleConfigured = !!(googleClientId && googleClientSecret && googleRedirectUri);
      const msClientId = opts.microsoftClientId || process.env.MICROSOFT_CLIENT_ID;
      const msConfigured = !!msClientId;
      const zohoConfigured = !!(zohoClientId && zohoClientSecret && zohoRedirectUri);

      const connectBtn = (href, label, svg, configured) => configured
        ? `<a href="${href}" class="calendar-connect-btn">${svg} <span>${label}</span></a>`
        : `<a class="calendar-connect-btn disabled" title="Not configured">${svg} <span>${label}</span></a>`;

      const missingVars = [];
      if (!googleConfigured) missingVars.push('Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)');
      if (!msConfigured) missingVars.push('Microsoft (MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID, MICROSOFT_REDIRECT_URI)');
      if (!zohoConfigured) missingVars.push('Zoho (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI)');
      const configNotice = missingVars.length
        ? `<details><summary>Some providers are not configured</summary><p>Add the following to your <code>.env</code> file:</p><ul>${missingVars.map(v => `<li>${v}</li>`).join('')}</ul></details>`
        : '';

      reply.type('text/html').send(BASE_LAYOUT('Calendar Connections', `
        <div class="calendars-page">
          <div class="calendars-header">
            <h1>Calendar Connections</h1>
            <p class="calendars-subtitle">Connect your calendar accounts to sync availability and create events.</p>
          </div>
          ${configNotice}
          <div class="calendars-connect-section">
            <span class="field-label" style="margin-bottom: 12px; display: block;">Add a calendar</span>
            <div class="calendar-connect-grid">
              ${connectBtn('/admin/calendars/connect/google', 'Connect Google Calendar', icons.google, googleConfigured)}
              ${connectBtn('/admin/calendars/connect/microsoft', 'Connect Office 365', icons.microsoft, msConfigured)}
              ${connectBtn('/admin/calendars/connect/zoho', 'Connect Zoho Calendar', icons.zoho, zohoConfigured)}
            </div>
          </div>
          ${connections.length ? `
            <div class="calendars-list-section">
              <span class="field-label" style="margin-bottom: 12px; display: block;">Connected accounts</span>
              <div class="calendar-connections-list">
                ${connectionCards}
              </div>
            </div>
          ` : `
            <div class="calendars-empty">
              <div class="calendars-empty-icon">
                <i class="ph-duotone ph-calendar-plus"></i>
              </div>
              <h3>No calendars connected</h3>
              <p>Connect a calendar account above to start syncing your availability and automatically create events for bookings.</p>
              <div class="calendars-empty-features">
                <div class="calendars-empty-feature">
                  <i class="ph-duotone ph-arrows-clockwise"></i>
                  <span>Real-time sync</span>
                </div>
                <div class="calendars-empty-feature">
                  <i class="ph-duotone ph-shield-check"></i>
                  <span>Conflict detection</span>
                </div>
                <div class="calendars-empty-feature">
                  <i class="ph-duotone ph-bell-ringing"></i>
                  <span>Auto reminders</span>
                </div>
              </div>
            </div>
          `}
        </div>
      `, true, 'calendars'));
    });

    app.get('/calendars/connect/google', async (request, reply) => {
      if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
        return reply.status(400).type('text/html').send(BASE_LAYOUT('Not Configured', `
          <h1>Google OAuth2 Not Configured</h1>
          <p>Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>GOOGLE_REDIRECT_URI</code> to your <code>.env</code> file, then restart the server.</p>
          <a href="/admin/calendars" role="button" class="secondary">Back to Calendars</a>
        `));
      }
      const state = crypto.randomBytes(16).toString('hex');
      request.session.set('googleOauthState', state);
      const url = buildGoogleAuthUrl(googleClientId, googleRedirectUri, state);
      return reply.redirect(url);
    });

    app.get('/calendars/callback/google', async (request, reply) => {
      const { code, error, state } = request.query;
      if (!code || error) {
        return reply.redirect('/admin/calendars?error=oauth_denied');
      }
      const expectedState = request.session.get('googleOauthState');
      if (expectedState) {
        if (!state || state !== expectedState) {
          return reply.redirect('/admin/calendars?error=oauth_failed');
        }
        request.session.set('googleOauthState', null);
      }
      try {
        const tokens = await exchangeCodeForTokens(code, googleClientId, googleClientSecret, googleRedirectUri);
        const email = await getGoogleUserEmail(tokens.access_token);
        const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

        const encryptedAccess = encrypt(tokens.access_token, encryptionKey);
        const encryptedRefresh = tokens.refresh_token ? encrypt(tokens.refresh_token, encryptionKey) : null;

        const userId = request.session.get('adminId');
        if (!userId) {
          return reply.redirect('/admin/login');
        }

        const existing = await app.db.getOne(
          'SELECT id FROM calendar_connections WHERE provider = $1 AND email = $2 AND user_id = $3',
          ['google', email, userId]
        );

        if (existing) {
          await app.db.run(
            'UPDATE calendar_connections SET encrypted_access_token = $1, encrypted_refresh_token = $2, token_expiry = $3, status = $4 WHERE id = $5',
            [encryptedAccess, encryptedRefresh || '', tokenExpiry, 'connected', existing.id]
          );
        } else {
          await app.db.run(
            'INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [userId, 'google', encryptedAccess, encryptedRefresh || '', tokenExpiry, email, 'connected']
          );
        }

        return reply.redirect('/admin/calendars');
      } catch (err) {
        request.log.error(err);
        return reply.redirect('/admin/calendars?error=oauth_failed');
      }
    });

    app.get('/calendars/connect/microsoft', async (request, reply) => {
      const clientId = opts.microsoftClientId || process.env.MICROSOFT_CLIENT_ID;
      const tenantId = opts.microsoftTenantId || process.env.MICROSOFT_TENANT_ID;
      const redirectUri = opts.microsoftRedirectUri || process.env.MICROSOFT_REDIRECT_URI;
      if (!clientId || !tenantId || !redirectUri) {
        return reply.status(400).type('text/html').send(BASE_LAYOUT('Not Configured', `
          <h1>Microsoft OAuth2 Not Configured</h1>
          <p>Add <code>MICROSOFT_CLIENT_ID</code>, <code>MICROSOFT_CLIENT_SECRET</code>, <code>MICROSOFT_TENANT_ID</code>, and <code>MICROSOFT_REDIRECT_URI</code> to your <code>.env</code> file, then restart the server.</p>
          <a href="/admin/calendars" role="button" class="secondary">Back to Calendars</a>
        `));
      }
      const scope = 'offline_access Calendars.ReadWrite User.Read';
      const state = crypto.randomBytes(16).toString('hex');
      request.session.set('oauthState', state);
      const authUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', scope);
      authUrl.searchParams.set('response_mode', 'query');
      authUrl.searchParams.set('state', state);
      return reply.redirect(authUrl.toString());
    });

    app.get('/calendars/callback/microsoft', async (request, reply) => {
      const { code, state } = request.query;
      if (!code) {
        return reply.status(400).send('Missing authorization code');
      }
      const expectedState = request.session.get('oauthState');
      if (!state || state !== expectedState) {
        return reply.status(403).send('Invalid OAuth state');
      }
      request.session.set('oauthState', null);

      const clientId = opts.microsoftClientId || process.env.MICROSOFT_CLIENT_ID;
      const clientSecret = opts.microsoftClientSecret || process.env.MICROSOFT_CLIENT_SECRET;
      const tenantId = opts.microsoftTenantId || process.env.MICROSOFT_TENANT_ID;
      const redirectUri = opts.microsoftRedirectUri || process.env.MICROSOFT_REDIRECT_URI;

      const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
      const tokenResponse = await app.fetchFn(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          scope: 'offline_access Calendars.ReadWrite User.Read',
        }).toString(),
      });

      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) {
        return reply.status(502).send('Failed to exchange authorization code');
      }

      const meResponse = await app.fetchFn('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const meData = await meResponse.json();

      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      const userId = request.session.get('adminId');
      if (!userId) {
        return reply.redirect('/admin/login');
      }

      const msEmail = meData.mail || meData.userPrincipalName;
      const msExisting = await app.db.getOne(
        'SELECT id FROM calendar_connections WHERE provider = $1 AND email = $2 AND user_id = $3',
        ['microsoft', msEmail, userId]
      );

      if (msExisting) {
        await app.db.run(
          'UPDATE calendar_connections SET encrypted_access_token = $1, encrypted_refresh_token = $2, token_expiry = $3, status = $4 WHERE id = $5',
          [
            encrypt(tokenData.access_token, encryptionKey),
            encrypt(tokenData.refresh_token, encryptionKey),
            expiresAt,
            'connected',
            msExisting.id
          ]
        );
      } else {
        await app.db.run(`
          INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          userId,
          'microsoft',
          encrypt(tokenData.access_token, encryptionKey),
          encrypt(tokenData.refresh_token, encryptionKey),
          expiresAt,
          msEmail,
          'connected'
        ]);
      }

      return reply.redirect('/admin/calendars');
    });

    app.get('/calendars/connect/zoho', async (request, reply) => {
      if (!zohoClientId || !zohoClientSecret || !zohoRedirectUri) {
        return reply.status(400).type('text/html').send(BASE_LAYOUT('Not Configured', `
          <h1>Zoho OAuth2 Not Configured</h1>
          <p>Add <code>ZOHO_CLIENT_ID</code>, <code>ZOHO_CLIENT_SECRET</code>, and <code>ZOHO_REDIRECT_URI</code> to your <code>.env</code> file, then restart the server.</p>
          <a href="/admin/calendars" role="button" class="secondary">Back to Calendars</a>
        `));
      }
      const params = new URLSearchParams({
        client_id: zohoClientId,
        redirect_uri: zohoRedirectUri,
        response_type: 'code',
        scope: 'ZohoCalendar.calendar.ALL,ZohoCalendar.event.ALL,ZohoCalendar.freebusy.READ',
        access_type: 'offline',
        prompt: 'consent',
      });
      return reply.redirect(`https://accounts.zoho.com/oauth/v2/auth?${params}`);
    });

    app.get('/calendars/zoho/callback', async (request, reply) => {
      const { code } = request.query;
      if (!code) {
        return reply.status(400).send('Missing authorization code');
      }

      const fetchFn = app.zohoFetch || globalThis.fetch;

      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: zohoClientId,
        client_secret: zohoClientSecret,
        redirect_uri: zohoRedirectUri,
        code,
      });

      const tokenResponse = await fetchFn(`https://accounts.zoho.com/oauth/v2/token?${tokenParams}`, {
        method: 'POST',
      });

      if (!tokenResponse.ok) {
        return reply.status(502).send('Failed to exchange code for tokens');
      }

      const tokenData = await tokenResponse.json();
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      const userResponse = await fetchFn('https://accounts.zoho.com/oauth/user/info', {
        headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
      });
      const userData = await userResponse.json();
      const email = userData.Email || '';

      const encryptedAccess = encrypt(tokenData.access_token, encryptionKey);
      const encryptedRefresh = encrypt(tokenData.refresh_token, encryptionKey);

      const userId = request.session.get('adminId');
      if (!userId) {
        return reply.redirect('/admin/login');
      }

      const zohoExisting = await app.db.getOne(
        'SELECT id FROM calendar_connections WHERE provider = $1 AND email = $2 AND user_id = $3',
        ['zoho', email, userId]
      );

      if (zohoExisting) {
        await app.db.run(
          'UPDATE calendar_connections SET encrypted_access_token = $1, encrypted_refresh_token = $2, token_expiry = $3, status = $4 WHERE id = $5',
          [encryptedAccess, encryptedRefresh, expiresAt, 'connected', zohoExisting.id]
        );
      } else {
        await app.db.run(
          'INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [userId, 'zoho', encryptedAccess, encryptedRefresh, expiresAt, email, 'connected']
        );
      }

      return reply.redirect('/admin/calendars');
    });

    app.post('/calendars/:id/disconnect', { preHandler: app.csrfProtection }, async (request, reply) => {
      const { id } = request.params;
      const adminId = request.session.get('adminId');
      await app.db.run("UPDATE booking_profiles SET write_calendar_id = NULL WHERE write_calendar_id = $1 AND user_id = $2", [id, adminId]);
      await app.db.run('DELETE FROM calendar_connections WHERE id = $1 AND user_id = $2', [id, adminId]);
      return reply.redirect('/admin/calendars');
    });

    registerProfileRoutes(app);

    app.get('/settings', async (request, reply) => {
      const adminId = request.session.get('adminId');
      const admin = await app.db.getOne('SELECT timezone, notification_email FROM admin WHERE id = $1', [adminId]);
      const token = reply.generateCsrf();
      const flash = request.session.get('flash') || '';
      request.session.set('flash', '');

      const timezoneOptions = TIMEZONES.map(tz =>
        `<option value="${tz}"${tz === admin.timezone ? ' selected' : ''}>${tz}</option>`
      ).join('');

      reply.type('text/html').send(BASE_LAYOUT('Settings', `
        <div class="settings-page">
          <div class="settings-header">
            <h1>Settings</h1>
            <p class="settings-subtitle">Manage your account preferences</p>
          </div>
          ${flash ? `<div role="alert" class="success">${escapeHtml(flash)}</div>` : ''}
          <div class="settings-content">
            <div class="settings-card">
              <div class="settings-card-header">
                <div class="settings-card-icon"><i class="ph-duotone ph-moon-stars"></i></div>
                <div>
                  <h2>Appearance</h2>
                  <p>Choose your preferred theme for the interface.</p>
                </div>
              </div>
              <div class="theme-switcher">
                <button type="button" class="theme-option" data-theme="light" onclick="setTheme('light')">
                  <i class="ph-duotone ph-sun"></i>
                  <span>Light</span>
                </button>
                <button type="button" class="theme-option" data-theme="dark" onclick="setTheme('dark')">
                  <i class="ph-duotone ph-moon"></i>
                  <span>Dark</span>
                </button>
              </div>
              <script>
                function setTheme(theme) {
                  document.documentElement.style.setProperty('transition', 'background-color 0.4s ease, color 0.3s ease');
                  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : '');
                  if (theme === 'dark') {
                    document.documentElement.setAttribute('data-theme', 'dark');
                  } else {
                    document.documentElement.removeAttribute('data-theme');
                  }
                  localStorage.setItem('theme', theme);
                  document.querySelectorAll('.theme-option').forEach(function(btn) {
                    btn.classList.toggle('active', btn.dataset.theme === theme);
                  });
                  fetch('/admin/settings/theme', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: '_csrf=${token}&theme=' + theme
                  });
                  setTimeout(function() { document.documentElement.style.removeProperty('transition'); }, 500);
                }
                (function() {
                  var current = localStorage.getItem('theme') || 'light';
                  document.querySelectorAll('.theme-option').forEach(function(btn) {
                    btn.classList.toggle('active', btn.dataset.theme === current);
                  });
                })();
              </script>
            </div>
            <div class="settings-card">
              <div class="settings-card-header">
                <div class="settings-card-icon"><i class="ph-duotone ph-globe-hemisphere-west"></i></div>
                <div>
                  <h2>Timezone</h2>
                  <p>Set your default timezone for displaying booking times.</p>
                </div>
              </div>
              <form method="POST" action="/admin/settings/timezone" class="settings-form">
                <input type="hidden" name="_csrf" value="${token}">
                <div class="field-group">
                  <label class="field-label">Select your timezone</label>
                  <select name="timezone" class="settings-select">${timezoneOptions}</select>
                </div>
                <button type="submit" class="settings-save-btn">Save Timezone</button>
              </form>
            </div>
            <div class="settings-card">
              <div class="settings-card-header">
                <div class="settings-card-icon"><i class="ph-duotone ph-lock-key"></i></div>
                <div>
                  <h2>Change Password</h2>
                  <p>Update your admin password. Make sure to use a strong password.</p>
                </div>
              </div>
              <form method="POST" action="/admin/settings/password" class="settings-form">
                <input type="hidden" name="_csrf" value="${token}">
                <div class="field-group">
                  <label class="field-label">Current Password</label>
                  <input type="password" name="current_password" class="settings-input" placeholder="Enter current password" required>
                </div>
                <div class="field-group">
                  <label class="field-label">New Password</label>
                  <input type="password" name="new_password" class="settings-input" placeholder="Enter new password" required>
                </div>
                <div class="field-group">
                  <label class="field-label">Confirm New Password</label>
                  <input type="password" name="confirm_password" class="settings-input" placeholder="Confirm new password" required>
                </div>
                <button type="submit" class="settings-save-btn">Change Password</button>
              </form>
            </div>
            <div class="settings-card">
              <div class="settings-card-header">
                <div class="settings-card-icon"><i class="ph-duotone ph-envelope"></i></div>
                <div>
                  <h2>Notification Email</h2>
                  <p>Receive email notifications when someone books a meeting.</p>
                </div>
              </div>
              <form method="POST" action="/admin/settings/notification-email" class="settings-form">
                <input type="hidden" name="_csrf" value="${token}">
                <div class="field-group">
                  <label class="field-label">Email address</label>
                  <input type="email" name="notification_email" class="settings-input" placeholder="your@email.com" value="${escapeHtml(admin.notification_email || '')}">
                </div>
                <p style="margin: 0 0 16px; color: #6b6b6b; font-size: 13px;">Leave empty to disable email notifications.</p>
                <button type="submit" class="settings-save-btn">Save Email</button>
              </form>
            </div>
          </div>
        </div>
      `, true, 'settings'));
    });

    app.post('/settings/theme', { preHandler: app.csrfProtection }, async (request, reply) => {
      const { theme } = request.body || {};
      const adminId = request.session.get('adminId');
      const validTheme = theme === 'dark' ? 'dark' : 'light';
      await app.db.run('UPDATE admin SET theme = $1 WHERE id = $2', [validTheme, adminId]);
      return reply.send({ ok: true });
    });

    app.post('/settings/timezone', { preHandler: app.csrfProtection }, async (request, reply) => {
      const { timezone } = request.body || {};
      const adminId = request.session.get('adminId');

      if (!TIMEZONES.includes(timezone)) {
        request.session.set('flash', 'Invalid timezone selected');
        return reply.redirect('/admin/settings');
      }

      await app.db.run('UPDATE admin SET timezone = $1 WHERE id = $2', [timezone, adminId]);
      request.session.set('flash', 'Timezone updated successfully');
      return reply.redirect('/admin/settings');
    });

    app.post('/settings/password', { preHandler: app.csrfProtection }, async (request, reply) => {
      const { current_password, new_password, confirm_password } = request.body || {};
      const adminId = request.session.get('adminId');
      const admin = await app.db.getOne('SELECT password_hash FROM admin WHERE id = $1', [adminId]);

      if (new_password !== confirm_password) {
        request.session.set('flash', 'New passwords do not match');
        return reply.redirect('/admin/settings');
      }

      const valid = await bcrypt.compare(current_password || '', admin.password_hash);
      if (!valid) {
        request.session.set('flash', 'Current password is incorrect');
        return reply.redirect('/admin/settings');
      }

      const newHash = await bcrypt.hash(new_password, 10);
      await app.db.run('UPDATE admin SET password_hash = $1 WHERE id = $2', [newHash, adminId]);
      request.session.set('flash', 'Password changed successfully');
      return reply.redirect('/admin/settings');
    });

    app.post('/settings/notification-email', { preHandler: app.csrfProtection }, async (request, reply) => {
      const { notification_email } = request.body || {};
      const adminId = request.session.get('adminId');
      const email = (notification_email || '').trim();

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        request.session.set('flash', 'Invalid email address');
        return reply.redirect('/admin/settings');
      }

      await app.db.run('UPDATE admin SET notification_email = $1 WHERE id = $2', [email, adminId]);
      request.session.set('flash', email ? 'Notification email saved' : 'Notification email removed');
      return reply.redirect('/admin/settings');
    });
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
