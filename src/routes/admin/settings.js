const bcrypt = require('bcrypt');
const { escapeHtml } = require('../../utils/html');
const { BASE_LAYOUT, TIMEZONES } = require('../../views/layout');

function registerSettingsRoutes(app) {
  app.get('/settings', async (request, reply) => {
    const adminId = request.session.get('adminId');
    const admin = await app.db.getOne('SELECT timezone, notification_email, time_format FROM admin WHERE id = $1', [adminId]);
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
            <form method="POST" action="/admin/settings/timezone" class="settings-form" id="tz-form">
              <input type="hidden" name="_csrf" value="${token}">
              <input type="hidden" name="timezone" id="tz-hidden" value="${admin.timezone || 'UTC'}">
              <div class="field-group">
                <label class="field-label">Select your timezone</label>
                <div class="tz-picker" id="tz-picker">
                  <button type="button" class="tz-picker-btn" id="tz-picker-btn">
                    <i class="ph ph-globe-hemisphere-west"></i>
                    <span class="tz-picker-value" id="tz-picker-value">${admin.timezone || 'UTC'}</span>
                    <i class="ph ph-caret-down tz-picker-caret"></i>
                  </button>
                  <div class="tz-picker-dropdown" id="tz-picker-dropdown" style="display:none">
                    <div class="tz-picker-search">
                      <i class="ph ph-magnifying-glass"></i>
                      <input type="text" placeholder="Search timezone..." id="tz-search-input" autocomplete="off">
                    </div>
                    <div class="tz-picker-list" id="tz-picker-list"></div>
                  </div>
                </div>
              </div>
              <button type="submit" class="settings-save-btn">Save Timezone</button>
            </form>
            <script>
            (function(){
              var ZONES = ${JSON.stringify(TIMEZONES)};
              var current = '${admin.timezone || 'UTC'}';
              var picker = document.getElementById('tz-picker');
              var btn = document.getElementById('tz-picker-btn');
              var dropdown = document.getElementById('tz-picker-dropdown');
              var list = document.getElementById('tz-picker-list');
              var searchInput = document.getElementById('tz-search-input');
              var hidden = document.getElementById('tz-hidden');
              var valueEl = document.getElementById('tz-picker-value');

              function formatTz(tz) {
                try {
                  var now = new Date();
                  var fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
                  var parts = fmt.formatToParts(now);
                  var offset = parts.find(function(p){ return p.type === 'timeZoneName'; });
                  return offset ? tz + ' (' + offset.value + ')' : tz;
                } catch(e) { return tz; }
              }

              function render(filter) {
                var q = (filter || '').toLowerCase();
                var html = '';
                ZONES.forEach(function(tz) {
                  if (q && tz.toLowerCase().indexOf(q) === -1) return;
                  var active = tz === current ? ' active' : '';
                  html += '<button type="button" class="tz-picker-option' + active + '" data-tz="' + tz + '">' + formatTz(tz) + '</button>';
                });
                list.innerHTML = html || '<div class="tz-picker-empty">No results</div>';
              }

              function open() {
                dropdown.style.display = '';
                btn.classList.add('open');
                searchInput.value = '';
                render('');
                requestAnimationFrame(function(){ searchInput.focus(); });
              }

              function close() {
                dropdown.style.display = 'none';
                btn.classList.remove('open');
              }

              btn.addEventListener('click', function() {
                dropdown.style.display === 'none' ? open() : close();
              });

              searchInput.addEventListener('input', function() { render(this.value); });

              list.addEventListener('click', function(e) {
                var opt = e.target.closest('.tz-picker-option');
                if (!opt) return;
                current = opt.dataset.tz;
                hidden.value = current;
                valueEl.textContent = current;
                close();
              });

              document.addEventListener('click', function(e) {
                if (!picker.contains(e.target)) close();
              });

              document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') close();
              });
            })();
            </script>
          </div>
          <div class="settings-card">
            <div class="settings-card-header">
              <div class="settings-card-icon"><i class="ph-duotone ph-clock"></i></div>
              <div>
                <h2>Time Format</h2>
                <p>Choose how times are displayed throughout the app.</p>
              </div>
            </div>
            <div class="time-format-switcher">
              <button type="button" class="time-format-option${(admin.time_format || '12h') === '12h' ? ' active' : ''}" data-format="12h" onclick="setTimeFormat('12h')">
                <span class="time-format-example">2:30 PM</span>
                <span>12-hour</span>
              </button>
              <button type="button" class="time-format-option${(admin.time_format || '12h') === '24h' ? ' active' : ''}" data-format="24h" onclick="setTimeFormat('24h')">
                <span class="time-format-example">14:30</span>
                <span>24-hour</span>
              </button>
            </div>
            <script>
              function setTimeFormat(format) {
                document.querySelectorAll('.time-format-option').forEach(function(btn) {
                  btn.classList.toggle('active', btn.dataset.format === format);
                });
                localStorage.setItem('timeFormat', format);
                fetch('/admin/settings/time-format', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: '_csrf=${token}&time_format=' + format
                }).then(function() { Toast.show('Time format updated', 'success'); });
              }
              localStorage.setItem('timeFormat', '${(admin.time_format || '12h')}');
            </script>
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

  app.post('/settings/time-format', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { time_format } = request.body || {};
    const adminId = request.session.get('adminId');
    const validFormat = time_format === '24h' ? '24h' : '12h';
    await app.db.run('UPDATE admin SET time_format = $1 WHERE id = $2', [validFormat, adminId]);
    return reply.send({ ok: true });
  });
}

module.exports = { registerSettingsRoutes };
