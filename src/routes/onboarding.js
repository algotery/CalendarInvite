const { BASE_LAYOUT, escapeHtml } = require('../views/layout');

function registerOnboardingRoutes(app, opts = {}) {
  const googleClientId = opts.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const googleConfigured = !!(googleClientId && (opts.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET) && (opts.googleRedirectUri || process.env.GOOGLE_REDIRECT_URI));
  const msConfigured = !!(opts.microsoftClientId || process.env.MICROSOFT_CLIENT_ID);

  const PROVIDER_ICONS = {
    google: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`,
    microsoft: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M1.15 1.15h10.27v10.27H1.15z" fill="#f25022"/><path d="M12.58 1.15h10.27v10.27H12.58z" fill="#7fba00"/><path d="M1.15 12.58h10.27v10.27H1.15z" fill="#00a4ef"/><path d="M12.58 12.58h10.27v10.27H12.58z" fill="#ffb900"/></svg>`,
  };

  app.get('/onboarding', async (request, reply) => {
    const adminId = request.session.get('adminId');
    const admin = await app.db.getOne('SELECT onboarding_completed_at, email FROM admin WHERE id = $1', [adminId]);

    if (admin && admin.onboarding_completed_at && admin.email !== 'onboarding@test.com') {
      return reply.redirect('/admin/dashboard');
    }

    const calendars = await app.db.getAll('SELECT id, provider, email FROM calendar_connections WHERE user_id = $1', [adminId]);
    const hasCalendar = calendars.length > 0;

    const schedules = await app.db.getAll('SELECT id FROM default_schedule_templates WHERE user_id = $1 LIMIT 1', [adminId]);
    const hasSchedule = schedules.length > 0;

    const step = request.query.step || (hasCalendar ? (hasSchedule ? '3' : '2') : '1');
    const token = reply.generateCsrf();

    reply.type('text/html').send(BASE_LAYOUT('Setup', `
      <div class="onboarding-page">
        <div class="onboarding-container">
          <div class="onboarding-header">
            <img src="/img/icon.svg" alt="" class="onboarding-logo">
            <h1 class="onboarding-title">Welcome to Lumi</h1>
            <p class="onboarding-subtitle">Let's get you set up in a few quick steps.</p>
          </div>

          <div class="onboarding-progress">
            <div class="onboarding-progress-step${step >= 1 ? ' active' : ''}${hasCalendar ? ' done' : ''}">
              <span class="onboarding-progress-dot"></span>
              <span class="onboarding-progress-label">Calendar</span>
            </div>
            <div class="onboarding-progress-line${step >= 2 ? ' active' : ''}"></div>
            <div class="onboarding-progress-step${step >= 2 ? ' active' : ''}${hasSchedule ? ' done' : ''}">
              <span class="onboarding-progress-dot"></span>
              <span class="onboarding-progress-label">Availability</span>
            </div>
            <div class="onboarding-progress-line${step >= 3 ? ' active' : ''}"></div>
            <div class="onboarding-progress-step${step >= 3 ? ' active' : ''}">
              <span class="onboarding-progress-dot"></span>
              <span class="onboarding-progress-label">Profile</span>
            </div>
          </div>

          ${step === '1' ? `
          <!-- Step 1: Calendar -->
          <div class="onboarding-step-panel" data-step="1">
            <div class="onboarding-panel-header">
              <h2 class="onboarding-panel-title">Connect a Calendar</h2>
              <p class="onboarding-panel-desc">Link your calendar so bookings sync automatically and conflicts are detected.</p>
            </div>

            ${hasCalendar ? `
              <div class="onboarding-connected">
                <i class="ph-fill ph-check-circle"></i>
                <span>Connected: ${escapeHtml(calendars[0].email)}</span>
              </div>
            ` : `
              <div class="onboarding-calendar-options">
                ${googleConfigured ? `<a href="/admin/calendars/connect/google?from=onboarding" class="onboarding-calendar-btn">
                  ${PROVIDER_ICONS.google}
                  <span>Google Calendar</span>
                </a>` : ''}
                ${msConfigured ? `<a href="/admin/calendars/connect/microsoft?from=onboarding" class="onboarding-calendar-btn">
                  ${PROVIDER_ICONS.microsoft}
                  <span>Microsoft 365</span>
                </a>` : ''}
                ${!googleConfigured && !msConfigured ? '<p class="onboarding-panel-desc" style="text-align:center;">No calendar providers configured yet.</p>' : ''}
              </div>
            `}

            <div class="onboarding-panel-actions">
              <a href="/admin/onboarding?step=2" class="onboarding-skip-btn">Skip this step</a>
              ${hasCalendar ? '<a href="/admin/onboarding?step=2" class="onboarding-next-btn">Continue <i class="ph ph-arrow-right"></i></a>' : ''}
            </div>
          </div>
          ` : ''}

          ${step === '2' ? `
          <!-- Step 2: Availability -->
          <div class="onboarding-step-panel" data-step="2">
            <div class="onboarding-panel-header">
              <h2 class="onboarding-panel-title">Set Your Availability</h2>
              <p class="onboarding-panel-desc">Choose when you're available for meetings. You can customize this later.</p>
            </div>

            ${hasSchedule ? `
              <div class="onboarding-connected">
                <i class="ph-fill ph-check-circle"></i>
                <span>Availability configured</span>
              </div>
            ` : `
              <form method="POST" action="/admin/onboarding/availability" class="onboarding-availability-form">
                <input type="hidden" name="_csrf" value="${token}">
                <div class="onboarding-presets">
                  <label class="onboarding-preset selected">
                    <input type="radio" name="preset" value="weekdays-9-17" checked>
                    <div class="onboarding-preset-content">
                      <span class="onboarding-preset-title">Weekdays 9 AM – 5 PM</span>
                      <span class="onboarding-preset-desc">Mon – Fri, standard hours</span>
                    </div>
                  </label>
                  <label class="onboarding-preset">
                    <input type="radio" name="preset" value="weekdays-10-18">
                    <div class="onboarding-preset-content">
                      <span class="onboarding-preset-title">Weekdays 10 AM – 6 PM</span>
                      <span class="onboarding-preset-desc">Mon – Fri, late start</span>
                    </div>
                  </label>
                  <label class="onboarding-preset">
                    <input type="radio" name="preset" value="weekdays-8-16">
                    <div class="onboarding-preset-content">
                      <span class="onboarding-preset-title">Weekdays 8 AM – 4 PM</span>
                      <span class="onboarding-preset-desc">Mon – Fri, early start</span>
                    </div>
                  </label>
                </div>
                <button type="submit" class="onboarding-next-btn" style="margin-top: 20px; width: 100%;">Save & Continue <i class="ph ph-arrow-right"></i></button>
              </form>
            `}

            <div class="onboarding-panel-actions">
              <a href="/admin/onboarding?step=1" class="onboarding-back-btn"><i class="ph ph-arrow-left"></i> Back</a>
              ${hasSchedule
                ? '<a href="/admin/onboarding?step=3" class="onboarding-next-btn">Continue <i class="ph ph-arrow-right"></i></a>'
                : '<a href="/admin/onboarding?step=3" class="onboarding-skip-btn">Skip this step</a>'
              }
            </div>
          </div>
          ` : ''}

          ${step === '3' ? `
          <!-- Step 3: Done -->
          <div class="onboarding-step-panel" data-step="3">
            <div class="onboarding-panel-header" style="text-align: center;">
              <div class="onboarding-done-icon"><i class="ph-fill ph-check-circle"></i></div>
              <h2 class="onboarding-panel-title">You're all set!</h2>
              <p class="onboarding-panel-desc">Create your first booking profile so people can schedule meetings with you.</p>
            </div>

            <div class="onboarding-final-actions">
              <form method="POST" action="/admin/onboarding/complete" style="display:inline">
                <input type="hidden" name="_csrf" value="${token}">
                <input type="hidden" name="redirect" value="profile">
                <button type="submit" class="onboarding-next-btn" style="width: 100%;">
                  <i class="ph ph-user-plus"></i> Create Booking Profile
                </button>
              </form>
              <form method="POST" action="/admin/onboarding/complete" style="display:inline; width: 100%;">
                <input type="hidden" name="_csrf" value="${token}">
                <button type="submit" class="onboarding-skip-btn" style="width: 100%; text-align: center;">Skip, go to Dashboard</button>
              </form>
            </div>

            <div class="onboarding-panel-actions">
              <a href="/admin/onboarding?step=2" class="onboarding-back-btn"><i class="ph ph-arrow-left"></i> Back</a>
            </div>
          </div>
          ` : ''}
        </div>
      </div>

      <script>
        document.querySelectorAll('.onboarding-preset').forEach(function(label) {
          label.addEventListener('click', function() {
            document.querySelectorAll('.onboarding-preset').forEach(function(l) { l.classList.remove('selected'); });
            label.classList.add('selected');
          });
        });
      </script>
    `, false, ''));
  });

  app.post('/onboarding/availability', { preHandler: app.csrfProtection }, async (request, reply) => {
    const adminId = request.session.get('adminId');
    const { preset } = request.body || {};

    const presets = {
      'weekdays-9-17': { days: [1,2,3,4,5], start: '09:00', end: '17:00' },
      'weekdays-10-18': { days: [1,2,3,4,5], start: '10:00', end: '18:00' },
      'weekdays-8-16': { days: [1,2,3,4,5], start: '08:00', end: '16:00' },
    };

    const config = presets[preset] || presets['weekdays-9-17'];

    await app.db.run('DELETE FROM default_schedule_templates WHERE user_id = $1', [adminId]);
    for (const day of config.days) {
      await app.db.run(
        'INSERT INTO default_schedule_templates (user_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)',
        [adminId, day, config.start, config.end]
      );
    }

    return reply.redirect('/admin/onboarding?step=3');
  });

  app.post('/onboarding/complete', { preHandler: app.csrfProtection }, async (request, reply) => {
    const adminId = request.session.get('adminId');
    await app.db.run('UPDATE admin SET onboarding_completed_at = $1 WHERE id = $2', [new Date().toISOString(), adminId]);
    const redirect = request.body?.redirect;
    if (redirect === 'profile') {
      return reply.redirect('/admin/profiles');
    }
    return reply.redirect('/admin/dashboard');
  });
}

module.exports = { registerOnboardingRoutes };
