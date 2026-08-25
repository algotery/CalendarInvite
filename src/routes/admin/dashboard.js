const { escapeHtml } = require('../../utils/html');
const { BASE_LAYOUT } = require('../../views/layout');

function registerDashboardRoutes(app) {
  app.get('/dashboard', async (request, reply) => {
    const token = reply.generateCsrf();
    const adminId = request.session.get('adminId');
    const admin = await app.db.getOne('SELECT timezone, time_format, onboarding_completed_at FROM admin WHERE id = $1', [adminId]);
    const adminTz = admin ? admin.timezone : 'UTC';
    const adminTimeFormat = admin ? (admin.time_format || '12h') : '12h';

    const activeProfiles = await app.db.getOne("SELECT COUNT(*) as count FROM booking_profiles WHERE is_active = true AND user_id = $1", [adminId]);

    let setupBanner = '';
    if (!admin?.onboarding_completed_at) {
      const hasCalendar = await app.db.getOne('SELECT id FROM calendar_connections WHERE user_id = $1 LIMIT 1', [adminId]);
      const hasSchedule = await app.db.getOne('SELECT id FROM default_schedule_templates WHERE user_id = $1 LIMIT 1', [adminId]);
      const hasProfile = await app.db.getOne('SELECT id FROM booking_profiles WHERE user_id = $1 LIMIT 1', [adminId]);
      const todos = [];
      if (!hasCalendar) todos.push('<a href="/admin/calendars" class="setup-todo-item"><i class="ph ph-calendar-plus"></i> Connect calendar</a>');
      if (!hasSchedule) todos.push('<a href="/admin/profiles?tab=availability" class="setup-todo-item"><i class="ph ph-clock"></i> Set availability</a>');
      if (!hasProfile) todos.push('<a href="/admin/profiles/new" class="setup-todo-item profile-overlay-trigger" data-url="/admin/profiles/new?partial=1"><i class="ph ph-user-plus"></i> Create profile</a>');
      if (todos.length > 0) {
        setupBanner = `
          <div class="setup-banner">
            <div class="setup-banner-text">
              <i class="ph ph-sparkle"></i>
              <span>Finish setting up your account</span>
            </div>
            <div class="setup-banner-todos">${todos.join('')}</div>
            <form method="POST" action="/admin/onboarding/complete" style="display:inline">
              <input type="hidden" name="_csrf" value="${token}">
              <button type="submit" class="setup-banner-dismiss">Dismiss</button>
            </form>
          </div>`;
      }
    }
    const now = new Date().toISOString();
    const upcomingCount = await app.db.getOne("SELECT COUNT(*) as count FROM bookings b JOIN booking_profiles bp ON b.profile_id = bp.id WHERE b.status = 'confirmed' AND b.start_time > $1 AND bp.user_id = $2", [now, adminId]);
    const next5 = await app.db.getAll(
      "SELECT b.*, bp.name as profile_name FROM bookings b JOIN booking_profiles bp ON b.profile_id = bp.id WHERE b.status = 'confirmed' AND b.start_time > $1 AND bp.user_id = $2 ORDER BY b.start_time ASC LIMIT 5",
      [now, adminId]
    );

    const next5Cards = next5.map(b => {
      const start = new Date(b.start_time);
      const dateStr = start.toLocaleString('en-US', { timeZone: adminTz, dateStyle: 'medium' });
      const timeStr = start.toLocaleString('en-US', { timeZone: adminTz, hour: '2-digit', minute: '2-digit', hour12: adminTimeFormat !== '24h' });
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
        ${setupBanner}
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
}

module.exports = { registerDashboardRoutes };
