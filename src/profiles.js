const { escapeHtml } = require('./utils/html');
const { convertUTCToLocalTime, convertTimeToUTC } = require('./utils/time');
const { parseScheduleFromBody, parseAttendeesFromBody, parseOverridesFromBody } = require('./utils/parse');
const { profileFormHtml, DAYS } = require('./views/profile-form');

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function registerProfileRoutes(app) {
  app.get('/profiles', async (request, reply) => {
    const token = reply.generateCsrf();
    const adminId = request.session.get('adminId');
    const profiles = await app.db.getAll("SELECT * FROM booking_profiles WHERE user_id = $1 ORDER BY created_at DESC", [adminId]);
    const baseUrl = `${request.protocol}://${request.hostname}${request.port && request.port !== 80 && request.port !== 443 ? ':' + request.port : ''}`;

    const rows = await Promise.all(profiles.map(async p => {
      const bookingUrl = `${baseUrl}/book/${escapeHtml(p.slug)}`;

      // Get schedule summary for display
      const schedules = await app.db.getAll(
        "SELECT day_of_week, start_time, end_time FROM schedule_templates WHERE profile_id = $1 ORDER BY day_of_week, start_time",
        [p.id]
      );

      const schedulesByDay = {};
      schedules.forEach(s => {
        if (!schedulesByDay[s.day_of_week]) {
          schedulesByDay[s.day_of_week] = [];
        }
        schedulesByDay[s.day_of_week].push({ start: s.start_time, end: s.end_time });
      });

      const activeDays = Object.keys(schedulesByDay).map(d => DAYS[d].substring(0, 3)).join(', ');
      const firstDaySchedule = schedulesByDay[Object.keys(schedulesByDay)[0]];
      const timeRange = firstDaySchedule ? `${firstDaySchedule[0].start} - ${firstDaySchedule[0].end}` : '';

      return `
      <div class="profile-card">
        <div class="profile-card-left">
          <div class="profile-card-indicator"></div>
          <div class="profile-card-content">
            <h3 class="profile-card-title">${escapeHtml(p.name)}</h3>
            <div class="profile-card-meta">
              ${p.meeting_tool === 'meet' ? 'Google Meet' : p.meeting_tool === 'teams' ? 'Microsoft Teams' : ''}${p.meeting_tool ? ' • ' : ''}${activeDays ? activeDays + ', ' + timeRange : 'No schedule set'}
            </div>
          </div>
        </div>
        <div class="profile-card-actions">
          <button class="copy-link-btn outline" data-url="${bookingUrl}"><i class="ph ph-link"></i> Copy link</button>
          <div class="profile-card-menu">
            <button class="icon-btn dropdown-toggle" data-profile-id="${p.id}">
              <i class="ph-bold ph-dots-three"></i>
            </button>
            <div class="dropdown-menu" id="menu-${p.id}" style="display:none;">
              <a href="${bookingUrl}" target="_blank" class="dropdown-item"><i class="ph ph-eye"></i> View booking page</a>
              <button class="dropdown-item profile-overlay-trigger" data-url="/admin/profiles/${p.id}/edit?partial=1"><i class="ph ph-pencil-simple"></i> Edit</button>
              <hr style="margin: 4px 0; border: none; border-top: 1px solid var(--border-color);">

              <form method="POST" action="/admin/profiles/${p.id}/delete" id="delete-form-${p.id}" style="display:none"><input type="hidden" name="_csrf" value="${token}"></form>
              <button class="dropdown-item danger" onclick="AppModal.confirm('Are you sure you want to delete this profile?', function(){document.getElementById('delete-form-${p.id}').submit()}, {title:'Delete Profile', confirmText:'Delete', danger:true, icon:'<i class=\\'ph-fill ph-trash\\' style=\\'font-size:32px;color:var(--error)\\'></i>'})"><i class="ph ph-trash"></i> Delete</button>
            </div>
          </div>
        </div>
      </div>
    `}));

    const adminRow = await app.db.getOne('SELECT timezone, time_format FROM admin WHERE id = $1', [adminId]);
    const adminTimezone = (adminRow && adminRow.timezone) || 'UTC';
    const timeFormat = (adminRow && adminRow.time_format) || '12h';
    const defaultSchedules = await app.db.getAll(
      "SELECT day_of_week, start_time, end_time FROM default_schedule_templates WHERE user_id = $1 ORDER BY day_of_week, start_time",
      [adminId]
    );

    const SHORT_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    function buildDefaultTimeDropdown(name, selectedValue, disabled) {
      const [h, m] = selectedValue.split(':').map(Number);
      let label;
      if (timeFormat === '24h') {
        label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      } else {
        const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        const ampm = h < 12 ? 'AM' : 'PM';
        label = `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
      }
      const disabledAttr = disabled ? ' disabled' : '';
      return `<div class="time-dropdown${disabled ? ' disabled' : ''}"><input type="hidden" name="${name}" value="${selectedValue}"${disabledAttr}><button type="button" class="time-dropdown-trigger"${disabledAttr}><span class="time-dropdown-value">${label}</span><i class="ph ph-caret-down"></i></button></div>`;
    }

    const defaultScheduleHtml = DAYS.map((dayName, dayIdx) => {
      const daySchedules = defaultSchedules.filter(s => s.day_of_week === dayIdx);
      const isActive = daySchedules.length > 0;

      let rangesHtml = '';
      if (isActive) {
        rangesHtml = daySchedules.map(s => {
          const localStart = convertUTCToLocalTime(s.start_time, adminTimezone);
          const localEnd = convertUTCToLocalTime(s.end_time, adminTimezone);
          return `<div class="time-range">${buildDefaultTimeDropdown(`default_schedule[${dayIdx}][start][]`, localStart, false)}<span class="time-range-sep">–</span>${buildDefaultTimeDropdown(`default_schedule[${dayIdx}][end][]`, localEnd, false)}<button type="button" class="remove-range-btn remove-range" title="Remove"><i class="ph ph-trash"></i></button></div>`;
        }).join('');
      } else {
        rangesHtml = `<div class="time-range">${buildDefaultTimeDropdown(`default_schedule[${dayIdx}][start][]`, '09:00', true)}<span class="time-range-sep">–</span>${buildDefaultTimeDropdown(`default_schedule[${dayIdx}][end][]`, '17:00', true)}<button type="button" class="remove-range-btn remove-range" title="Remove"><i class="ph ph-trash"></i></button></div>`;
      }

      return `
        <div class="schedule-day ${isActive ? '' : 'disabled'}" id="default-day-row-${dayIdx}">
          <div class="day-toggle">
            <label class="toggle-switch">
              <input type="checkbox" class="toggle-default-day-cb" data-day="${dayIdx}" id="default-toggle-${dayIdx}" ${isActive ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <span class="day-label">${SHORT_DAYS[dayIdx]}</span>
          </div>
          <div class="time-ranges" id="default-ranges-${dayIdx}" style="${isActive ? '' : 'display:none;'}">
            <div class="ranges-container" id="default-container-${dayIdx}">${rangesHtml}</div>
          </div>
          <div class="schedule-day-actions" id="default-actions-${dayIdx}" style="${isActive ? '' : 'display:none;'}">
            <button type="button" class="schedule-action-btn add-default-range-btn" data-day="${dayIdx}" title="Add time range"><i class="ph ph-plus"></i></button>
          </div>
          <div class="unavailable-text" id="default-unavail-${dayIdx}" style="${isActive ? 'display:none;' : ''}">
            Unavailable
          </div>
        </div>
      `;
    }).join('') + '<button type="button" class="copy-times-link" id="default-copy-times-trigger"><i class="ph ph-copy"></i> Copy times to...</button>';

    const html = `
      <div class="profiles-container">
        <div class="profiles-header">
          <h1>Profiles</h1>
          <div class="profiles-header-actions">
            <button type="button" class="contrast profile-overlay-trigger" data-url="/admin/profiles/new?partial=1">
              <i class="ph ph-plus"></i> Create
            </button>
          </div>
        </div>

        <div class="profiles-tabs">
          <button class="profiles-tab active" data-tab="profiles-tab-content"><i class="ph ph-user-list"></i> Profiles</button>
          <button class="profiles-tab" data-tab="availability-tab-content"><i class="ph ph-calendar-blank"></i> Availability</button>
        </div>

        <div id="profiles-tab-content" class="profiles-tab-panel active">
          <div class="profiles-list">
            ${rows.join('') || `<div class="calendars-empty">
                <div class="calendars-empty-icon">
                  <i class="ph-duotone ph-user-circle-plus"></i>
                </div>
                <h3>No profiles yet</h3>
                <a href="/admin/profiles/new" class="btn-primary" style="margin-top: 16px;"><i class="ph-bold ph-plus"></i> Create Profile</a>
              </div>`}
          </div>
        </div>

        <div id="availability-tab-content" class="profiles-tab-panel">
          <div class="availability-section">
            <div class="availability-header">
              <div>
                <h2 style="margin: 0 0 4px 0; font-size: 1.25rem;">Default Weekly Hours</h2>
                <p style="margin: 0; color: var(--text-secondary); font-size: 0.875rem;">Set your default availability. New profiles will use these hours automatically.</p>
              </div>
            </div>
            <form id="default-availability-form" method="POST" action="/admin/profiles/default-availability">
              <input type="hidden" name="_csrf" value="${reply.generateCsrf()}">
              <div class="schedule-grid">
                ${defaultScheduleHtml}
              </div>
              <div style="margin-top: 24px; display: flex; justify-content: flex-end;">
                <button type="submit" class="contrast">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <script>
        // Tab switching
        document.querySelectorAll('.profiles-tab').forEach(tab => {
          tab.addEventListener('click', function() {
            document.querySelectorAll('.profiles-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.profiles-tab-panel').forEach(p => p.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(this.dataset.tab).classList.add('active');
          });
        });

        // Copy link functionality
        document.querySelectorAll('.copy-link-btn').forEach(btn => {
          btn.addEventListener('click', function() {
            const url = this.dataset.url;
            navigator.clipboard.writeText(url).then(() => {
              const originalText = this.innerHTML;
              this.innerHTML = '<i class="ph ph-check"></i> Copied!';
              setTimeout(() => {
                this.innerHTML = originalText;
              }, 2000);
            });
          });
        });

        // Dropdown menu functionality
        document.querySelectorAll('.dropdown-toggle').forEach(toggle => {
          toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            const profileId = this.dataset.profileId;
            const menu = document.getElementById('menu-' + profileId);
            const isVisible = menu.style.display === 'block';

            // Close all menus
            document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');

            // Toggle current menu
            menu.style.display = isVisible ? 'none' : 'block';
          });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
          document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
        });

        // Custom time dropdown logic for default availability
        var APP_TIME_FORMAT = '${timeFormat}';
        window.TimeDropdown = window.TimeDropdown || {
          timeSlots: (function() {
            const slots = [];
            for (let h = 0; h < 24; h++) {
              for (let m = 0; m < 60; m += 15) {
                const val = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
                var label;
                if (APP_TIME_FORMAT === '24h') {
                  label = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
                } else {
                  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                  const ampm = h < 12 ? 'AM' : 'PM';
                  label = String(hour12).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ' ' + ampm;
                }
                slots.push({ val, label });
              }
            }
            return slots;
          })(),
          formatLabel: function(val) {
            const s = this.timeSlots.find(function(t) { return t.val === val; });
            return s ? s.label : val;
          },
          createDropdownHtml: function(name, val, disabled) {
            const label = this.formatLabel(val);
            const dis = disabled ? ' disabled' : '';
            return '<div class="time-dropdown' + (disabled ? ' disabled' : '') + '"><input type="hidden" name="' + name + '" value="' + val + '"' + dis + '><button type="button" class="time-dropdown-trigger"' + dis + '><span class="time-dropdown-value">' + label + '</span><i class="ph ph-caret-down"></i></button></div>';
          },
          open: function(trigger) {
            this.closeAll();
            const dropdown = trigger.closest('.time-dropdown');
            const hiddenInput = dropdown.querySelector('input[type="hidden"]');
            const panel = document.createElement('div');
            panel.className = 'time-dropdown-panel';
            const currentVal = hiddenInput.value;
            let scrollTarget = null;
            this.timeSlots.forEach(function(slot) {
              const item = document.createElement('div');
              item.className = 'time-dropdown-item' + (slot.val === currentVal ? ' active' : '');
              item.textContent = slot.label;
              item.dataset.value = slot.val;
              if (slot.val === currentVal) scrollTarget = item;
              panel.appendChild(item);
            });
            dropdown.appendChild(panel);
            dropdown.classList.add('open');
            if (scrollTarget) scrollTarget.scrollIntoView({ block: 'center' });
            panel.addEventListener('click', function(e) {
              const item = e.target.closest('.time-dropdown-item');
              if (!item) return;
              hiddenInput.value = item.dataset.value;
              trigger.querySelector('.time-dropdown-value').textContent = item.textContent;
              panel.querySelectorAll('.time-dropdown-item').forEach(function(i) { i.classList.remove('active'); });
              item.classList.add('active');
              dropdown.classList.remove('open');
              panel.remove();
            });
          },
          closeAll: function() {
            document.querySelectorAll('.time-dropdown.open').forEach(function(d) {
              d.classList.remove('open');
              var p = d.querySelector('.time-dropdown-panel');
              if (p) p.remove();
            });
          }
        };

        document.addEventListener('click', function(e) {
          var trigger = e.target.closest('.time-dropdown-trigger');
          if (trigger && !trigger.disabled) {
            e.stopPropagation();
            TimeDropdown.open(trigger);
            return;
          }
          if (!e.target.closest('.time-dropdown-panel')) {
            TimeDropdown.closeAll();
          }
        });

        function makeDefaultTimeRange(day, startVal, endVal) {
          const div = document.createElement('div');
          div.className = 'time-range';
          div.innerHTML = TimeDropdown.createDropdownHtml('default_schedule[' + day + '][start][]', startVal, false) + '<span class="time-range-sep">–</span>' + TimeDropdown.createDropdownHtml('default_schedule[' + day + '][end][]', endVal, false) + '<button type="button" class="remove-range-btn remove-range" title="Remove"><i class="ph ph-trash"></i></button>';
          return div;
        }

        document.querySelectorAll('.toggle-default-day-cb').forEach(cb => {
          cb.addEventListener('change', function() {
            const day = this.dataset.day;
            const row = document.getElementById('default-day-row-' + day);
            const ranges = document.getElementById('default-ranges-' + day);
            const actions = document.getElementById('default-actions-' + day);
            const unavail = document.getElementById('default-unavail-' + day);
            const container = document.getElementById('default-container-' + day);

            if (this.checked) {
              row.classList.remove('disabled');
              ranges.style.display = '';
              actions.style.display = '';
              unavail.style.display = 'none';
              container.querySelectorAll('input[type="hidden"]').forEach(s => s.disabled = false);
              container.querySelectorAll('.time-dropdown').forEach(d => d.classList.remove('disabled'));
              container.querySelectorAll('.time-dropdown-trigger').forEach(b => b.disabled = false);
            } else {
              row.classList.add('disabled');
              ranges.style.display = 'none';
              actions.style.display = 'none';
              unavail.style.display = '';
              container.querySelectorAll('input[type="hidden"]').forEach(s => s.disabled = true);
              container.querySelectorAll('.time-dropdown').forEach(d => d.classList.add('disabled'));
              container.querySelectorAll('.time-dropdown-trigger').forEach(b => b.disabled = true);
            }
          });
        });

        document.querySelectorAll('.add-default-range-btn').forEach(btn => {
          btn.addEventListener('click', function() {
            const day = this.closest('.schedule-action-btn').dataset.day || this.dataset.day;
            const container = document.getElementById('default-container-' + day);
            if (container.querySelectorAll('.time-range').length >= 10) {
              Toast.show('Maximum 10 time ranges per day', 'warning');
              return;
            }
            container.appendChild(makeDefaultTimeRange(day, '09:00', '17:00'));
          });
        });

        // Copy times to... for default availability
        const defaultCopyTrigger = document.getElementById('default-copy-times-trigger');
        if (defaultCopyTrigger) {
          defaultCopyTrigger.addEventListener('click', function() {
            const activeDays = [];
            for (let i = 0; i < 7; i++) {
              if (document.getElementById('default-toggle-' + i).checked) {
                activeDays.push(i);
              }
            }
            if (activeDays.length === 0) return;
            const sourceDay = activeDays[0];
            const sourceContainer = document.getElementById('default-container-' + sourceDay);
            const values = Array.from(sourceContainer.querySelectorAll('.time-range')).map(r => {
              const inputs = r.querySelectorAll('input[type="hidden"]');
              return { start: inputs[0].value, end: inputs[1].value };
            });

            for (let i = 0; i < 7; i++) {
              if (i === sourceDay) continue;
              const cb = document.getElementById('default-toggle-' + i);
              cb.checked = true;
              cb.dispatchEvent(new Event('change'));
              const targetContainer = document.getElementById('default-container-' + i);
              targetContainer.innerHTML = '';
              values.forEach(v => {
                targetContainer.appendChild(makeDefaultTimeRange(i, v.start, v.end));
              });
            }
          });
        }

        // Remove range button delegation
        document.getElementById('default-availability-form').addEventListener('click', function(e) {
          if (e.target.classList.contains('remove-range') || e.target.closest('.remove-range')) {
            const btn = e.target.classList.contains('remove-range') ? e.target : e.target.closest('.remove-range');
            btn.closest('.time-range').remove();
          }
        });
      </script>
    `;

    reply.type('text/html').send(require('./app').BASE_LAYOUT('Profiles', html, true, 'profiles'));
  });

  app.post('/profiles/default-availability', { preHandler: app.csrfProtection }, async (request, reply) => {
    const adminId = request.session.get('adminId');
    const adminRow = await app.db.getOne('SELECT timezone FROM admin WHERE id = $1', [adminId]);
    const adminTimezone = (adminRow && adminRow.timezone) || 'UTC';
    const entries = [];
    for (let day = 0; day <= 6; day++) {
      const key = `default_schedule[${day}]`;
      const starts = request.body[`${key}[start][]`];
      const ends = request.body[`${key}[end][]`];
      if (!starts || !ends) continue;

      const startArr = Array.isArray(starts) ? starts.slice(0, 10) : [starts];
      const endArr = Array.isArray(ends) ? ends.slice(0, 10) : [ends];

      for (let i = 0; i < startArr.length; i++) {
        if (startArr[i] && endArr[i]) {
          const utcStart = convertTimeToUTC(startArr[i], adminTimezone);
          const utcEnd = convertTimeToUTC(endArr[i], adminTimezone);
          entries.push({ day_of_week: day, start_time: utcStart, end_time: utcEnd });
        }
      }
    }

    await app.db.run("DELETE FROM default_schedule_templates WHERE user_id = $1", [adminId]);
    for (const entry of entries) {
      await app.db.run("INSERT INTO default_schedule_templates (user_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)", [adminId, entry.day_of_week, entry.start_time, entry.end_time]);
    }

    return reply.redirect('/admin/profiles');
  });

  app.get('/profiles/new', async (request, reply) => {
    const token = reply.generateCsrf();
    const adminId = request.session.get('adminId');
    const calendars = await app.db.getAll("SELECT * FROM calendar_connections WHERE user_id = $1 AND status = 'connected'", [adminId]);
    const adminRow = await app.db.getOne('SELECT timezone, time_format FROM admin WHERE id = $1', [adminId]);
    const adminTimezone = (adminRow && adminRow.timezone) || 'UTC';
    const timeFormat = (adminRow && adminRow.time_format) || '12h';
    const defaultTemplates = await app.db.getAll(
      "SELECT day_of_week, start_time, end_time FROM default_schedule_templates WHERE user_id = $1 ORDER BY day_of_week, start_time",
      [adminId]
    );
    const html = profileFormHtml(token, null, calendars, [], { templates: defaultTemplates, readCalendarIds: [] }, null, [], adminTimezone, timeFormat);
    if (request.query.partial === '1') {
      return reply.type('text/html').send(html);
    }
    reply.type('text/html').send(require('./app').BASE_LAYOUT('New Profile', html, true, 'profiles'));
  });

  app.post('/profiles', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { slug, name, meeting_link_url, meeting_tool } = request.body || {};
    const adminId = request.session.get('adminId');
    const adminRow = await app.db.getOne('SELECT time_format FROM admin WHERE id = $1', [adminId]);
    const timeFormat = (adminRow && adminRow.time_format) || '12h';

    if (!slug || !SLUG_REGEX.test(slug)) {
      const token = reply.generateCsrf();
      const calendars = await app.db.getAll("SELECT * FROM calendar_connections WHERE user_id = $1 AND status = 'connected'", [adminId]);
      const html = profileFormHtml(token, null, calendars, [], { templates: [], readCalendarIds: [] }, 'Slug must be lowercase alphanumeric and hyphens only.', [], 'UTC', timeFormat);
      if (request.query.partial === '1') return reply.type('text/html').send(html);
      return reply.type('text/html').send(require('./app').BASE_LAYOUT('New Profile', html, true, 'profiles'));
    }

    const existing = await app.db.getOne("SELECT id FROM booking_profiles WHERE slug = $1", [slug]);
    if (existing) {
      const token = reply.generateCsrf();
      const calendars = await app.db.getAll("SELECT * FROM calendar_connections WHERE user_id = $1 AND status = 'connected'", [adminId]);
      const html = profileFormHtml(token, null, calendars, [], { templates: [], readCalendarIds: [] }, 'That slug already exists. Please choose a different one.', [], 'UTC', timeFormat);
      if (request.query.partial === '1') return reply.type('text/html').send(html);
      return reply.type('text/html').send(require('./app').BASE_LAYOUT('New Profile', html, true, 'profiles'));
    }

    const buffer_time_minutes = parseInt(request.body.buffer_time_minutes, 10) || 0;

    const rawDurations = request.body['allowed_durations[]'];
    let allowedDurations = [30, 45, 60];
    if (rawDurations) {
      const arr = Array.isArray(rawDurations) ? rawDurations : [rawDurations];
      const parsed = arr.map(v => parseInt(v, 10)).filter(v => v >= 5 && v <= 480);
      if (parsed.length > 0) allowedDurations = [...new Set(parsed)].slice(0, 5).sort((a, b) => a - b);
    }

    const writeCalIdDirect = request.body['write_calendar_id'] ? Number(request.body['write_calendar_id']) : null;
    const result = await app.db.query(
      "INSERT INTO booking_profiles (user_id, slug, name, is_active, write_calendar_id, meeting_link_url, meeting_tool, buffer_time_minutes, allowed_durations, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id",
      [adminId, slug, name, true, writeCalIdDirect, meeting_link_url || null, meeting_tool || null, buffer_time_minutes, JSON.stringify(allowedDurations), new Date().toISOString()]
    );

    const profileId = result.rows[0].id;

    const attendees = parseAttendeesFromBody(request.body);
    for (const email of attendees) {
      await app.db.run("INSERT INTO default_attendees (profile_id, email) VALUES ($1, $2)", [profileId, email]);
    }

    const adminTzRow = await app.db.getOne('SELECT timezone FROM admin WHERE id = $1', [adminId]);
    const adminTimezone = (adminTzRow && adminTzRow.timezone) || 'UTC';
    let scheduleEntries = parseScheduleFromBody(request.body, adminTimezone);
    if (scheduleEntries.length === 0) {
      scheduleEntries = await app.db.getAll(
        "SELECT day_of_week, start_time, end_time FROM default_schedule_templates WHERE user_id = $1 ORDER BY day_of_week, start_time",
        [adminId]
      );
    }
    for (const entry of scheduleEntries) {
      await app.db.run("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)", [profileId, entry.day_of_week, entry.start_time, entry.end_time]);
    }

    const readCalIds = request.body['read_calendar_ids[]'];
    if (readCalIds) {
      const ids = Array.isArray(readCalIds) ? readCalIds : [readCalIds];
      for (const cid of ids) {
        await app.db.run("INSERT INTO profile_read_calendars (profile_id, calendar_connection_id) VALUES ($1, $2)", [profileId, Number(cid)]);
      }
    }

    const writeCalId = request.body['write_calendar_id'];
    if (writeCalId) {
      await app.db.run("INSERT INTO profile_write_calendars (profile_id, calendar_connection_id) VALUES ($1, $2)", [profileId, Number(writeCalId)]);
    }

    const overrides = parseOverridesFromBody(request.body);
    for (const o of overrides) {
      await app.db.run("INSERT INTO schedule_overrides (profile_id, date, is_blocked, custom_ranges) VALUES ($1, $2, $3, $4)", [profileId, o.date, o.is_blocked, o.custom_ranges]);
    }

    return reply.redirect('/admin/profiles');
  });

  app.get('/profiles/:id/edit', async (request, reply) => {
    const { id } = request.params;
    const adminId = request.session.get('adminId');
    const profile = await app.db.getOne("SELECT * FROM booking_profiles WHERE id = $1 AND user_id = $2", [id, adminId]);
    if (!profile) {
      return reply.code(404).type('text/html').send(require('./app').BASE_LAYOUT('Not Found', '<h1>Profile not found</h1>'));
    }

    const token = reply.generateCsrf();
    const calendars = await app.db.getAll("SELECT * FROM calendar_connections WHERE user_id = $1 AND status = 'connected'", [adminId]);
    const attendees = (await app.db.getAll("SELECT email FROM default_attendees WHERE profile_id = $1", [profile.id])).map(a => a.email);
    const templates = await app.db.getAll("SELECT * FROM schedule_templates WHERE profile_id = $1 ORDER BY day_of_week, start_time", [profile.id]);
    const readCalendarIds = (await app.db.getAll("SELECT calendar_connection_id FROM profile_read_calendars WHERE profile_id = $1", [profile.id])).map(r => r.calendar_connection_id);
    const writeCalendarIds = (await app.db.getAll("SELECT calendar_connection_id FROM profile_write_calendars WHERE profile_id = $1", [profile.id])).map(r => r.calendar_connection_id);
    const overrides = await app.db.getAll("SELECT * FROM schedule_overrides WHERE profile_id = $1 ORDER BY date", [profile.id]);
    const adminRow = await app.db.getOne('SELECT timezone, time_format FROM admin WHERE id = $1', [adminId]);
    const adminTimezone = (adminRow && adminRow.timezone) || 'UTC';
    const timeFormat = (adminRow && adminRow.time_format) || '12h';

    const html = profileFormHtml(token, profile, calendars, attendees, { templates, readCalendarIds, writeCalendarIds }, null, overrides, adminTimezone, timeFormat);
    if (request.query.partial === '1') {
      return reply.type('text/html').send(html);
    }
    reply.type('text/html').send(require('./app').BASE_LAYOUT('Edit Profile', html, true, 'profiles'));
  });

  app.post('/profiles/:id', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { id } = request.params;
    const adminId = request.session.get('adminId');
    const profile = await app.db.getOne("SELECT * FROM booking_profiles WHERE id = $1 AND user_id = $2", [id, adminId]);
    if (!profile) {
      return reply.code(404).type('text/html').send(require('./app').BASE_LAYOUT('Not Found', '<h1>Profile not found</h1>'));
    }

    const { slug, name, meeting_link_url, meeting_tool } = request.body || {};
    const buffer_time_minutes = parseInt(request.body.buffer_time_minutes, 10) || 0;
    const adminRow = await app.db.getOne('SELECT time_format FROM admin WHERE id = $1', [adminId]);
    const timeFormat = (adminRow && adminRow.time_format) || '12h';

    if (!slug || !SLUG_REGEX.test(slug)) {
      const token = reply.generateCsrf();
      const calendars = await app.db.getAll("SELECT * FROM calendar_connections WHERE user_id = $1 AND status = 'connected'", [adminId]);
      const attendees = (await app.db.getAll("SELECT email FROM default_attendees WHERE profile_id = $1", [profile.id])).map(a => a.email);
      const templates = await app.db.getAll("SELECT * FROM schedule_templates WHERE profile_id = $1", [profile.id]);
      const html = profileFormHtml(token, profile, calendars, attendees, { templates, readCalendarIds: [] }, 'Slug must be lowercase alphanumeric and hyphens only.', [], 'UTC', timeFormat);
      if (request.query.partial === '1') return reply.type('text/html').send(html);
      return reply.type('text/html').send(require('./app').BASE_LAYOUT('Edit Profile', html, true, 'profiles'));
    }

    const existing = await app.db.getOne("SELECT id FROM booking_profiles WHERE slug = $1 AND id != $2", [slug, id]);
    if (existing) {
      const token = reply.generateCsrf();
      const calendars = await app.db.getAll("SELECT * FROM calendar_connections WHERE user_id = $1 AND status = 'connected'", [adminId]);
      const attendees = (await app.db.getAll("SELECT email FROM default_attendees WHERE profile_id = $1", [profile.id])).map(a => a.email);
      const templates = await app.db.getAll("SELECT * FROM schedule_templates WHERE profile_id = $1", [profile.id]);
      const html = profileFormHtml(token, profile, calendars, attendees, { templates, readCalendarIds: [] }, 'That slug already exists.', [], 'UTC', timeFormat);
      if (request.query.partial === '1') return reply.type('text/html').send(html);
      return reply.type('text/html').send(require('./app').BASE_LAYOUT('Edit Profile', html, true, 'profiles'));
    }

    const rawDurations = request.body['allowed_durations[]'];
    let allowedDurations = [30, 45, 60];
    if (rawDurations) {
      const arr = Array.isArray(rawDurations) ? rawDurations : [rawDurations];
      const parsed = arr.map(v => parseInt(v, 10)).filter(v => v >= 5 && v <= 480);
      if (parsed.length > 0) allowedDurations = [...new Set(parsed)].slice(0, 5).sort((a, b) => a - b);
    }

    const writeCalIdForProfile = request.body['write_calendar_id'] ? Number(request.body['write_calendar_id']) : null;
    await app.db.run(
      "UPDATE booking_profiles SET slug = $1, name = $2, write_calendar_id = $3, meeting_link_url = $4, meeting_tool = $5, buffer_time_minutes = $6, allowed_durations = $7 WHERE id = $8",
      [slug, name, writeCalIdForProfile, meeting_link_url || null, meeting_tool || null, buffer_time_minutes, JSON.stringify(allowedDurations), id]
    );

    // Replace attendees
    await app.db.run("DELETE FROM default_attendees WHERE profile_id = $1", [id]);
    const attendees = parseAttendeesFromBody(request.body);
    for (const email of attendees) {
      await app.db.run("INSERT INTO default_attendees (profile_id, email) VALUES ($1, $2)", [id, email]);
    }

    // Replace schedule templates
    await app.db.run("DELETE FROM schedule_templates WHERE profile_id = $1", [id]);
    const adminTzRow2 = await app.db.getOne('SELECT timezone FROM admin WHERE id = $1', [adminId]);
    const adminTimezone = (adminTzRow2 && adminTzRow2.timezone) || 'UTC';
    const scheduleEntries = parseScheduleFromBody(request.body, adminTimezone);
    for (const entry of scheduleEntries) {
      await app.db.run("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)", [id, entry.day_of_week, entry.start_time, entry.end_time]);
    }

    // Replace read calendars
    await app.db.run("DELETE FROM profile_read_calendars WHERE profile_id = $1", [id]);
    const readCalIds = request.body['read_calendar_ids[]'];
    if (readCalIds) {
      const ids = Array.isArray(readCalIds) ? readCalIds : [readCalIds];
      for (const cid of ids) {
        await app.db.run("INSERT INTO profile_read_calendars (profile_id, calendar_connection_id) VALUES ($1, $2)", [id, Number(cid)]);
      }
    }

    // Replace write calendar (single selection)
    await app.db.run("DELETE FROM profile_write_calendars WHERE profile_id = $1", [id]);
    const writeCalId = request.body['write_calendar_id'];
    if (writeCalId) {
      await app.db.run("INSERT INTO profile_write_calendars (profile_id, calendar_connection_id) VALUES ($1, $2)", [id, Number(writeCalId)]);
    }

    await app.db.run("DELETE FROM schedule_overrides WHERE profile_id = $1", [id]);
    const overrides = parseOverridesFromBody(request.body);
    for (const o of overrides) {
      await app.db.run("INSERT INTO schedule_overrides (profile_id, date, is_blocked, custom_ranges) VALUES ($1, $2, $3, $4)", [id, o.date, o.is_blocked, o.custom_ranges]);
    }

    return reply.redirect('/admin/profiles');
  });



  app.post('/profiles/:id/toggle', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { id } = request.params;
    const adminId = request.session.get('adminId');
    await app.db.run("UPDATE booking_profiles SET is_active = CASE WHEN is_active = true THEN false ELSE true END WHERE id = $1 AND user_id = $2", [id, adminId]);
    return reply.redirect('/admin/profiles');
  });

  app.post('/profiles/:id/delete', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { id } = request.params;
    const adminId = request.session.get('adminId');
    const profile = await app.db.getOne("SELECT * FROM booking_profiles WHERE id = $1 AND user_id = $2", [id, adminId]);
    if (!profile) {
      return reply.code(404).type('text/html').send(require('./app').BASE_LAYOUT('Not Found', '<h1>Profile not found</h1>'));
    }
    await app.db.run("DELETE FROM booking_profiles WHERE id = $1 AND user_id = $2", [id, adminId]);
    return reply.redirect('/admin/profiles');
  });
}

module.exports = { registerProfileRoutes };
