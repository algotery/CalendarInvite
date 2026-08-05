const crypto = require('node:crypto');
const { decrypt } = require('./encryption');
const { refreshAccessToken: refreshGoogleToken } = require('./google');
const { createMicrosoftClient } = require('./microsoft');
const { getZohoClient } = require('./zoho');
const { optimizedCleanupOldRateLimits } = require('./performance-fixes');

async function getValidTokenForConnection(db, encryptionKey, connection) {
  const expiry = new Date(connection.token_expiry || 0);
  if (expiry > new Date()) {
    try {
      return decrypt(connection.encrypted_access_token, encryptionKey);
    } catch {
      return connection.encrypted_access_token;
    }
  }

  // Token is expired, refresh it
  if (connection.provider === 'google') {
    return await refreshGoogleToken(db, encryptionKey, connection.id, process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  } else if (connection.provider === 'microsoft') {
    const client = createMicrosoftClient({ db, encryptionKey, clientId: process.env.MICROSOFT_CLIENT_ID, clientSecret: process.env.MICROSOFT_CLIENT_SECRET, tenantId: process.env.MICROSOFT_TENANT_ID || 'common' });
    return await client.getValidAccessToken(connection.id);
  } else if (connection.provider === 'zoho') {
    const client = getZohoClient({ db, encryptionKey, clientId: process.env.ZOHO_CLIENT_ID, clientSecret: process.env.ZOHO_CLIENT_SECRET });
    return await client.getAccessToken(connection.id);
  }
  throw new Error('Unknown provider');
}

const VALID_DURATIONS = [30, 45, 60];
const LEAD_TIME_MS = 2 * 60 * 60 * 1000;
const HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const IP_RATE_LIMIT = 20;
const IP_RATE_WINDOW_MS = 60 * 1000;
const EMAIL_RATE_LIMIT = 5;
const EMAIL_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function computeSlots(db, profileId, dateStr, durationMinutes, now) {
  const date = new Date(dateStr + 'T00:00:00.000Z');
  const dayOfWeek = date.getUTCDay();

  const override = db.prepare(
    "SELECT * FROM schedule_overrides WHERE profile_id = ? AND date = ?"
  ).get(profileId, dateStr);

  let ranges;
  if (override) {
    if (override.is_blocked) return [];
    if (override.custom_ranges) {
      ranges = JSON.parse(override.custom_ranges);
    } else {
      ranges = [];
    }
  } else {
    const templates = db.prepare(
      "SELECT start_time, end_time FROM schedule_templates WHERE profile_id = ? AND day_of_week = ? ORDER BY start_time"
    ).all(profileId, dayOfWeek);
    ranges = templates.map(t => ({ start: t.start_time, end: t.end_time }));
  }

  if (ranges.length === 0) return [];

  const slots = [];
  const durationMs = durationMinutes * 60 * 1000;
  const leadTimeCutoff = new Date(now.getTime() + LEAD_TIME_MS);
  const horizonCutoff = new Date(now.getTime() + HORIZON_MS);

  for (const range of ranges) {
    const [startH, startM] = range.start.split(':').map(Number);
    const [endH, endM] = range.end.split(':').map(Number);

    const rangeStart = new Date(date);
    rangeStart.setUTCHours(startH, startM, 0, 0);
    const rangeEnd = new Date(date);
    rangeEnd.setUTCHours(endH, endM, 0, 0);

    let slotStart = rangeStart.getTime();
    while (slotStart + durationMs <= rangeEnd.getTime()) {
      const slotStartDate = new Date(slotStart);
      const slotEndDate = new Date(slotStart + durationMs);

      if (slotStartDate >= leadTimeCutoff && slotStartDate < horizonCutoff) {
        slots.push({
          start: slotStartDate.toISOString(),
          end: slotEndDate.toISOString(),
        });
      }
      slotStart += 30 * 60 * 1000;
    }
  }

  return slots;
}

function removeConflicts(slots, busyPeriods, bufferMs = 0) {
  return slots.filter(slot => {
    const slotStart = new Date(slot.start).getTime();
    const slotEnd = new Date(slot.end).getTime();
    for (const busy of busyPeriods) {
      const busyStart = new Date(busy.start).getTime() - bufferMs;
      const busyEnd = new Date(busy.end).getTime() + bufferMs;
      if (slotStart < busyEnd && slotEnd > busyStart) {
        return false;
      }
    }
    return true;
  });
}

const CALENDAR_API_TIMEOUT_MS = 8000;

function fetchWithTimeout(fetchFn, url, options, timeoutMs = CALENDAR_API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchFn(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function getCalendarBusySlots(db, encryptionKey, profileId, dateStr, fetchFn) {
  const readCalendars = db.prepare(
    "SELECT cc.* FROM profile_read_calendars prc JOIN calendar_connections cc ON prc.calendar_connection_id = cc.id WHERE prc.profile_id = ? AND cc.status = 'connected'"
  ).all(profileId);

  if (readCalendars.length === 0) return [];

  const timeMin = dateStr + 'T00:00:00Z';
  const timeMax = dateStr + 'T23:59:59Z';

  const results = await Promise.allSettled(readCalendars.map(async (cal) => {
    const accessToken = await getValidTokenForConnection(db, encryptionKey, cal);
    const busy = [];

    if (cal.provider === 'google') {
      const response = await fetchWithTimeout(fetchFn, 'https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: [{ id: 'primary' }],
        }),
      });
      if (response.ok) {
        const data = await response.json();
        busy.push(...(data.calendars?.primary?.busy || []));
      }
    } else if (cal.provider === 'microsoft') {
      const response = await fetchWithTimeout(fetchFn, 'https://graph.microsoft.com/v1.0/me/calendar/getSchedule', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schedules: [cal.email],
          startTime: { dateTime: timeMin, timeZone: 'UTC' },
          endTime: { dateTime: timeMax, timeZone: 'UTC' },
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const scheduleItems = data.value?.[0]?.scheduleItems || [];
        busy.push(...scheduleItems.map(item => ({
          start: item.start.dateTime,
          end: item.end.dateTime,
        })));
      }
    } else if (cal.provider === 'zoho') {
      const params = new URLSearchParams({ stime: timeMin, etime: timeMax });
      const response = await fetchWithTimeout(fetchFn, `https://calendar.zoho.com/api/v1/calendars/freebusy?${params}`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        const fbData = data.fb_data || [];
        busy.push(...fbData.filter(s => s.fbtype === 'busy').map(s => ({
          start: s.s_datetime,
          end: s.e_datetime,
        })));
      }
    }

    return busy;
  }));

  const allBusy = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allBusy.push(...result.value);
    }
  }
  return allBusy;
}

function getExistingBookings(db, profileId, dateStr) {
  const dayStart = dateStr + 'T00:00:00.000Z';
  const dayEnd = dateStr + 'T23:59:59.999Z';
  return db.prepare(
    "SELECT start_time as start, end_time as end FROM bookings WHERE profile_id = ? AND status = 'confirmed' AND start_time >= ? AND end_time <= ?"
  ).all(profileId, dayStart, dayEnd);
}

function cleanupOldRateLimits(db) {
  const cutoff = new Date(Date.now() - EMAIL_RATE_WINDOW_MS).toISOString();
  db.prepare("DELETE FROM rate_limits WHERE timestamp < ?").run(cutoff);
}

function checkIpRateLimit(db, ip) {
  const windowStart = new Date(Date.now() - IP_RATE_WINDOW_MS).toISOString();
  const count = db.prepare(
    "SELECT COUNT(*) as cnt FROM rate_limits WHERE key = ? AND type = 'ip' AND timestamp > ?"
  ).get(ip, windowStart).cnt;
  return count >= IP_RATE_LIMIT;
}

function recordIpRequest(db, ip, endpoint) {
  db.prepare(
    "INSERT INTO rate_limits (key, type, endpoint, timestamp) VALUES (?, 'ip', ?, ?)"
  ).run(ip, endpoint, new Date().toISOString());
}

function checkEmailRateLimit(db, email) {
  const windowStart = new Date(Date.now() - EMAIL_RATE_WINDOW_MS).toISOString();
  const count = db.prepare(
    "SELECT COUNT(*) as cnt FROM rate_limits WHERE key = ? AND type = 'email' AND timestamp > ?"
  ).get(email, windowStart).cnt;
  return count >= EMAIL_RATE_LIMIT;
}

function recordEmailBooking(db, email, endpoint) {
  db.prepare(
    "INSERT INTO rate_limits (key, type, endpoint, timestamp) VALUES (?, 'email', ?, ?)"
  ).run(email, endpoint, new Date().toISOString());
}

function getClientIp(request) {
  return request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip || '127.0.0.1';
}

function registerBookingRoutes(app, { encryptionKey, baseLayout }) {
  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params;
    const profile = app.db.prepare("SELECT * FROM booking_profiles WHERE slug = ?").get(slug);

    if (!profile) {
      return reply.code(404).type('text/html').send(baseLayout('Not Found', '<h1>Page not found</h1>'));
    }

    if (!profile.is_active) {
      return reply.type('text/html').send(baseLayout(`Book - ${escapeHtml(profile.name)}`, `
        <div style="text-align: center; padding: 4rem 0;">
          <h1>${escapeHtml(profile.name)}</h1>
          <article>
            <p style="color: var(--text-secondary);">This booking profile is not currently accepting bookings.</p>
          </article>
        </div>
      `));
    }

    const meetingTool = profile.meeting_tool === 'meet' ? 'Google Meet' : profile.meeting_tool === 'teams' ? 'Microsoft Teams' : 'Phone call';
    const meetingIcon = profile.meeting_tool === 'meet' ? 'ph-video-camera' : profile.meeting_tool === 'teams' ? 'ph-video-camera' : 'ph-phone';

    reply.type('text/html').send(baseLayout(`Book - ${escapeHtml(profile.name)}`, `
      <div class="booking-page-container">
        <!-- Step Indicator -->
        <div class="step-indicator" id="step-indicator">
          <div class="step-item active" data-step="1"><div class="step-number">1</div><div class="step-label">Date</div></div>
          <div class="step-line"></div>
          <div class="step-item" data-step="2"><div class="step-number">2</div><div class="step-label">Time</div></div>
          <div class="step-line"></div>
          <div class="step-item" data-step="3"><div class="step-number">3</div><div class="step-label">Details</div></div>
        </div>

        <!-- Two Column Layout -->
        <div class="booking-layout">
          <!-- Left Panel -->
          <div class="booking-left-panel">
            <button type="button" class="booking-back-btn" id="back-btn" style="display:none;">
              <i class="ph-bold ph-arrow-left"></i> Back
            </button>

            <div class="booking-profile-info">
              <div class="booking-profile-name">${escapeHtml(profile.name)}</div>
              <h1 class="booking-profile-title">${escapeHtml(profile.name)}</h1>

              <div class="booking-profile-meta">
                <div class="booking-profile-meta-item">
                  <i class="ph-fill ph-clock"></i>
                  <span id="duration-display">30 min</span>
                  <div class="duration-toggle">
                    <button type="button" class="duration-btn active" data-duration="30">30 min</button>
                    <button type="button" class="duration-btn" data-duration="45">45 min</button>
                    <button type="button" class="duration-btn" data-duration="60">60 min</button>
                  </div>
                </div>
                <div class="booking-profile-meta-item">
                  <i class="ph-fill ${meetingIcon}"></i>
                  <span>${meetingTool}</span>
                </div>
              </div>

              <div id="selected-info" class="booking-profile-selected" style="display:none;">
                <!-- Selected date/time will be shown here -->
              </div>
            </div>
          </div>

          <!-- Right Panel -->
          <div class="booking-right-panel">
            <!-- Calendar Step -->
            <div id="calendar-step">
              <div class="booking-content-header">
                <h2 class="booking-content-title">Select a Date & Time</h2>
              </div>

              <div class="booking-calendar-container">
                <div class="booking-calendar-section">
                  <div id="calendar-header"></div>
                  <div id="calendar-grid"></div>
                  <div class="busyness-legend">
                    <div class="busyness-legend-item"><div class="busyness-legend-dot dot-low"></div><span>Available</span></div>
                    <div class="busyness-legend-item"><div class="busyness-legend-dot dot-medium"></div><span>Filling up</span></div>
                    <div class="busyness-legend-item"><div class="busyness-legend-dot dot-high"></div><span>Almost full</span></div>
                    <div class="busyness-legend-item"><div class="busyness-legend-dot dot-none"></div><span>Unavailable</span></div>
                  </div>
                </div>

                <div class="booking-slots-section" id="slots-section" style="display:none;">
                  <div class="booking-slots-header" id="selected-date-header"></div>
                  <div class="booking-slots-list" id="time-slots"></div>
                </div>
              </div>
            </div>

            <!-- Form Step -->
            <div id="form-step" style="display:none;">
              <div class="booking-content-header">
                <h2 class="booking-content-title">Enter Details</h2>
              </div>

              <div id="booking-error" style="display:none"></div>

              <form id="booking-form">
                <label>
                  Name *
                  <input type="text" name="name" placeholder="Your Name" required>
                </label>
                <label>
                  Email *
                  <input type="email" name="email" placeholder="Your Email" required>
                </label>
                <div class="guests-section">
                  <button type="button" id="add-guests-btn" class="add-guests-btn" onclick="toggleGuestsInput()">
                    <i class="ph-bold ph-user-plus"></i> Add Guests
                  </button>
                  <div id="guests-input-area" class="guests-input-area">
                    <div class="guests-tags" id="guests-tags"></div>
                    <input type="text" id="guests-text-input" class="guests-text-input" placeholder="Enter email address">
                    <input type="hidden" name="additional_attendees" id="additional_attendees_hidden">
                  </div>
                </div>
                <label>
                  Meeting Title
                  <input type="text" name="title" placeholder="Meeting with ${escapeHtml(profile.name)}">
                </label>
                <label>
                  Description (optional)
                  <textarea name="description" placeholder="Add any notes or agenda items..." rows="4"></textarea>
                </label>
                <button type="submit" style="width: 100%; margin-top: 16px;">Schedule Event</button>
              </form>
            </div>

            <!-- Confirmation Step -->
            <div id="confirmation-step" style="display:none;">
              <div style="text-align: center; padding: 48px 24px;">
                <i class="ph-fill ph-check-circle" style="font-size: 4rem; color: var(--success); margin-bottom: 16px;"></i>
                <h2 style="color: var(--success); margin-bottom: 24px;">Booking Confirmed!</h2>
                <div id="confirmation-details"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <script>
        (function() {
          const slug = '${escapeHtml(slug)}';
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          var selectedDuration = 30;
          let selectedSlotStart = null;
          let selectedDateStr = null;

          function updateStepIndicator(activeStep) {
            document.querySelectorAll('.step-item').forEach(function(item) {
              var step = parseInt(item.dataset.step);
              item.classList.remove('active', 'completed');
              if (step === activeStep) item.classList.add('active');
              else if (step < activeStep) item.classList.add('completed');
            });
            document.querySelectorAll('.step-line').forEach(function(line, idx) {
              line.classList.toggle('completed', idx < activeStep - 1);
            });
          }

          function showBackButton() {
            document.getElementById('back-btn').style.display = 'inline-flex';
          }

          function hideBackButton() {
            document.getElementById('back-btn').style.display = 'none';
          }

          // Duration toggle
          document.querySelectorAll('.duration-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
              document.querySelectorAll('.duration-btn').forEach(function(b) { b.classList.remove('active'); });
              btn.classList.add('active');
              selectedDuration = parseInt(btn.dataset.duration);
              document.getElementById('duration-display').textContent = selectedDuration + ' min';
              busynessCache = {};
              fetchBusyness(currentMonth.getFullYear(), currentMonth.getMonth());
              if (selectedDateStr) {
                loadSlots(selectedDateStr);
              }
            });
          });

          var slotsAbortController = null;

          function loadSlots(dateStr) {
            if (slotsAbortController) slotsAbortController.abort();
            slotsAbortController = new AbortController();
            var signal = slotsAbortController.signal;

            var container = document.getElementById('time-slots');
            container.innerHTML = '<div class="booking-slots-empty"><i class="ph-bold ph-spinner booking-slots-empty-icon loading" style="opacity: 1;"></i><div class="booking-slots-empty-description">Loading available times...</div></div>';
            document.getElementById('slots-section').style.display = 'block';

            fetch('/api/book/' + slug + '/slots?date=' + dateStr + '&duration=' + selectedDuration + '&timezone=' + tz, { signal: signal })
              .then(function(res) { if (!res.ok) throw new Error(res.status); return res.json(); })
              .then(function(data) {
                if (signal.aborted) return;
                if (!data.slots || !data.slots.length) {
                  container.innerHTML = '<div class="booking-slots-empty"><i class="ph-bold ph-calendar-x booking-slots-empty-icon"></i><div class="booking-slots-empty-title">No Available Times</div><div class="booking-slots-empty-description">Please select another date to see available time slots.</div></div>';
                  return;
                }
                var renderedSlots = data.slots.map(function(s) {
                  var t = new Date(s.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
                  return '<button class="booking-slot-btn" data-start="' + s.start + '" data-time="' + t + '">' + t + '</button>';
                });
                container.innerHTML = renderedSlots.join('');
                container.querySelectorAll('.booking-slot-btn').forEach(function(slotBtn) {
                  slotBtn.addEventListener('click', function() {
                    selectedSlotStart = slotBtn.dataset.start;
                    var d2 = new Date(selectedDateStr + 'T00:00:00Z');
                    var dateDisplay2 = d2.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
                    updateSelectedInfo(dateDisplay2, slotBtn.dataset.time);
                    document.getElementById('calendar-step').style.display = 'none';
                    document.getElementById('form-step').style.display = 'block';
                    document.getElementById('booking-error').style.display = 'none';
                    updateStepIndicator(3);
                    var dt = document.querySelector('.duration-toggle');
                    if (dt) dt.style.display = 'none';
                  });
                });
              })
              .catch(function(err) {
                if (err && err.name === 'AbortError') return;
                container.innerHTML = '<div class="booking-slots-empty"><i class="ph-bold ph-wifi-x booking-slots-empty-icon" style="color: #dc2626;"></i><div class="booking-slots-empty-title" style="color: #dc2626;">Connection Error</div><div class="booking-slots-empty-description">Failed to load times. Please try again.</div></div>';
              });
          }

          function updateSelectedInfo(dateStr, timeStr) {
            const selectedInfo = document.getElementById('selected-info');
            if (dateStr && timeStr) {
              selectedInfo.innerHTML = '<div class="booking-profile-selected-item"><i class="ph-fill ph-calendar"></i><span>' + dateStr + '</span></div><div class="booking-profile-selected-item"><i class="ph-fill ph-clock"></i><span>' + timeStr + '</span></div>';
              selectedInfo.style.display = 'block';
            } else if (dateStr) {
              selectedInfo.innerHTML = '<div class="booking-profile-selected-item"><i class="ph-fill ph-calendar"></i><span>' + dateStr + '</span></div>';
              selectedInfo.style.display = 'block';
            } else {
              selectedInfo.style.display = 'none';
            }
          }

          // Back button handler
          document.getElementById('back-btn').addEventListener('click', function() {
            const formVisible = document.getElementById('form-step').style.display !== 'none';
            const slotsVisible = document.getElementById('slots-section').style.display !== 'none';

            if (formVisible) {
              // From form back to slots
              document.getElementById('form-step').style.display = 'none';
              document.getElementById('calendar-step').style.display = 'block';
              document.getElementById('slots-section').style.display = 'block';
              updateStepIndicator(2);
              updateSelectedInfo(selectedDateStr, null);
              var dt = document.querySelector('.duration-toggle');
              if (dt) dt.style.display = '';
            } else if (slotsVisible) {
              // From slots back to calendar
              document.getElementById('slots-section').style.display = 'none';
              hideBackButton();
              updateStepIndicator(1);
              updateSelectedInfo(null, null);
            }
          });
          function formatDateToYYYYMMDD(date) {
            var year = date.getFullYear();
            var month = String(date.getMonth() + 1).padStart(2, '0');
            var day = String(date.getDate()).padStart(2, '0');
            return year + '-' + month + '-' + day;
          }

          var currentMonth = new Date();
          currentMonth.setHours(0,0,0,0);
          currentMonth.setDate(1);

          var today = new Date();
          today.setHours(0,0,0,0);

          var busynessCache = {};

          function fetchBusyness(year, month) {
            var key = year + '-' + String(month + 1).padStart(2, '0');
            if (busynessCache[key]) {
              applyBusyness(busynessCache[key]);
              return;
            }
            fetch('/api/book/' + slug + '/busyness?month=' + key + '&duration=' + selectedDuration)
              .then(function(res) { if (!res.ok) throw new Error(res.status); return res.json(); })
              .then(function(data) {
                if (data.busyness) {
                  busynessCache[key] = data.busyness;
                  applyBusyness(data.busyness);
                }
              })
              .catch(function() {});
          }

          function applyBusyness(busynessData) {
            document.querySelectorAll('.calendar-day').forEach(function(btn) {
              if (btn.disabled) return;
              btn.classList.remove('busyness-low', 'busyness-medium', 'busyness-high', 'busyness-full');
              var dayNum = parseInt(btn.textContent.trim());
              var dateStr = formatDateToYYYYMMDD(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), dayNum));
              var level = busynessData[dateStr];
              if (level && level !== 'none') {
                btn.classList.add('busyness-' + level);
              }
            });
          }

          // Start by rendering calendar
          updateStepIndicator(1);
          renderCalendar();

          function renderCalendar() {
            var grid = document.getElementById('calendar-grid');
            var header = document.getElementById('calendar-header');

            var monthYear = currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            header.innerHTML = '<button id="prev-month" class="outline calendar-nav">&larr;</button><span class="calendar-month-title">' + monthYear + '</span><button id="next-month" class="outline calendar-nav">&rarr;</button>';

            document.getElementById('prev-month').addEventListener('click', function() {
              currentMonth.setMonth(currentMonth.getMonth() - 1);
              renderCalendar();
            });

            document.getElementById('next-month').addEventListener('click', function() {
              currentMonth.setMonth(currentMonth.getMonth() + 1);
              renderCalendar();
            });

            grid.innerHTML = '';

            var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            dayNames.forEach(function(name) {
              var dayHeader = document.createElement('div');
              dayHeader.className = 'calendar-day-header';
              dayHeader.textContent = name;
              grid.appendChild(dayHeader);
            });

            var firstDay = new Date(currentMonth);
            var lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

            var startDay = firstDay.getDay();
            for (var i = 0; i < startDay; i++) {
              var emptyCell = document.createElement('div');
              emptyCell.className = 'calendar-day-empty';
              grid.appendChild(emptyCell);
            }

            var horizon = new Date();
            horizon.setHours(0,0,0,0);
            horizon.setDate(horizon.getDate() + 90);

            for (var day = 1; day <= lastDay.getDate(); day++) {
              var d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
              var dateStr = formatDateToYYYYMMDD(d);
              var btn = document.createElement('button');
              btn.textContent = day;
              btn.className = 'calendar-day';

              var isPast = d < today;
              var isFuture = d > horizon;
              var isToday = d.getTime() === today.getTime();

              if (isPast || isFuture) {
                btn.className += ' calendar-day-disabled';
                btn.disabled = true;
              } else {
                if (isToday) {
                  btn.className += ' calendar-day-today';
                }
                (function(ds) {
                  btn.addEventListener('click', function() { selectDate(ds); });
                })(dateStr);
              }

              grid.appendChild(btn);
            }

            fetchBusyness(currentMonth.getFullYear(), currentMonth.getMonth());
          }

          var selectedDate = null;

          function selectDate(dateStr) {
            selectedDateStr = dateStr;

            // Mark selected date in calendar
            document.querySelectorAll('.calendar-day').forEach(function(btn) {
              btn.classList.remove('calendar-day-selected');
            });

            var targetDate = new Date(dateStr + 'T00:00:00Z');
            var targetDay = targetDate.getUTCDate();
            var targetMonth = targetDate.getUTCMonth();
            var targetYear = targetDate.getUTCFullYear();

            document.querySelectorAll('.calendar-day').forEach(function(btn) {
              if (btn.disabled) return;
              var btnDay = parseInt(btn.textContent.trim());
              if (btnDay === targetDay &&
                  currentMonth.getMonth() === targetMonth &&
                  currentMonth.getFullYear() === targetYear) {
                btn.classList.add('calendar-day-selected');
              }
            });

            showBackButton();
            updateStepIndicator(2);

            var d = new Date(dateStr + 'T00:00:00Z');
            var dateDisplay = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
            document.getElementById('selected-date-header').textContent = dateDisplay;
            updateSelectedInfo(dateDisplay, null);

            loadSlots(dateStr);
          }

          function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

          document.getElementById('booking-form').addEventListener('submit', function(e) {
            e.preventDefault();
            var form = e.target;
            var errDiv = document.getElementById('booking-error');
            var submitBtn = form.querySelector('button[type="submit"]');
            errDiv.style.display = 'none';

            submitBtn.textContent = 'Creating booking...';
            submitBtn.disabled = true;

            var attendeesRaw = document.getElementById('additional_attendees_hidden').value.trim();
            var additionalAttendees = attendeesRaw ? attendeesRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];

            var payload = {
              name: form.name.value.trim(),
              email: form.email.value.trim(),
              additional_attendees: additionalAttendees,
              title: form.title.value.trim() || undefined,
              description: form.description.value.trim() || undefined,
              start_time: selectedSlotStart,
              duration: selectedDuration,
              timezone: tz
            };

            fetch('/api/book/' + slug, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
            .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
            .then(function(result) {
              if (!result.ok) {
                errDiv.textContent = result.data.error || 'Something went wrong. Please try again.';
                errDiv.className = 'alert error';
                errDiv.style.display = 'block';
                submitBtn.textContent = 'Schedule Event';
                submitBtn.disabled = false;
                errDiv.scrollIntoView({ behavior: 'smooth' });
                return;
              }

              var b = result.data.booking;

              // Hide form, show confirmation
              document.getElementById('form-step').style.display = 'none';
              document.getElementById('confirmation-step').style.display = 'block';
              hideBackButton();
              var stepIndicator = document.getElementById('step-indicator');
              if (stepIndicator) stepIndicator.style.display = 'none';

              var startLocal = new Date(b.start_time).toLocaleString(undefined, { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });
              var endLocal = new Date(b.end_time).toLocaleTimeString(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });

              var details = '<div style="background: #f5f5f5; border-radius: 8px; padding: 24px; margin-bottom: 24px; text-align: left;">';
              details += '<h3 style="margin-top: 0; font-size: 1.125rem;">' + esc(b.title) + '</h3>';
              details += '<div style="display: flex; align-items: center; gap: 12px; margin: 12px 0;"><i class="ph-fill ph-calendar" style="font-size: 1.25rem; color: #4a4a4a;"></i><span>' + esc(startLocal) + '</span></div>';
              details += '<div style="display: flex; align-items: center; gap: 12px; margin: 12px 0;"><i class="ph-fill ph-clock" style="font-size: 1.25rem; color: #4a4a4a;"></i><span>' + b.duration_minutes + ' minutes</span></div>';
              if (b.meeting_link) {
                details += '<div style="display: flex; align-items: center; gap: 12px; margin: 12px 0;"><i class="ph-fill ph-video-camera" style="font-size: 1.25rem; color: #4a4a4a;"></i><a href="' + esc(b.meeting_link) + '" target="_blank" style="color: var(--primary); font-weight: 500;">Join meeting</a></div>';
              }
              details += '<div style="display: flex; align-items: center; gap: 12px; margin: 12px 0;"><i class="ph-fill ph-users" style="font-size: 1.25rem; color: #4a4a4a;"></i><span>' + b.attendees.map(esc).join(', ') + '</span></div>';
              details += '</div>';
              details += '<p style="color: #6b6b6b; font-size: 0.9375rem; text-align: center;">A calendar invitation has been sent to all attendees.</p>';

              document.getElementById('confirmation-details').innerHTML = details;
            })
            .catch(function(err) {
              errDiv.textContent = 'Network error. Please check your connection and try again.';
              errDiv.className = 'alert error';
              errDiv.style.display = '';
              submitBtn.textContent = 'Confirm Booking';
              submitBtn.disabled = false;
            });
          });
        })();

        function toggleGuestsInput() {
          var btn = document.getElementById('add-guests-btn');
          var area = document.getElementById('guests-input-area');
          btn.style.display = 'none';
          area.classList.add('open');
          document.getElementById('guests-text-input').focus();
        }

        (function() {
          var guests = [];
          var input = document.getElementById('guests-text-input');
          var tagsContainer = document.getElementById('guests-tags');
          var hiddenInput = document.getElementById('additional_attendees_hidden');

          function isValidEmail(email) {
            return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
          }

          function renderTags() {
            tagsContainer.innerHTML = guests.map(function(email, i) {
              return '<span class="guest-tag">' + email + '<button type="button" onclick="removeGuest(' + i + ')">×</button></span>';
            }).join('');
            hiddenInput.value = guests.join(',');
          }

          function addGuest(email) {
            email = email.trim();
            if (email && isValidEmail(email) && guests.indexOf(email) === -1) {
              guests.push(email);
              renderTags();
            }
          }

          window.removeGuest = function(idx) {
            guests.splice(idx, 1);
            renderTags();
          };

          input.addEventListener('keydown', function(e) {
            if (e.key === ' ' || e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addGuest(input.value);
              input.value = '';
            }
            if (e.key === 'Backspace' && !input.value && guests.length > 0) {
              guests.pop();
              renderTags();
            }
          });

          input.addEventListener('blur', function() {
            if (input.value.trim()) {
              addGuest(input.value);
              input.value = '';
            }
          });
        })();
      </script>
    `, false, '', true));
  });
}

function registerRateLimitHook(app) {
  app.addHook('onRequest', async (request, reply) => {
    // Only rate-limit POST requests (booking submissions), not read-only GETs
    if (request.method !== 'POST') return;
    optimizedCleanupOldRateLimits(app.db);
    const ip = getClientIp(request);
    if (checkIpRateLimit(app.db, ip)) {
      return reply.code(429).send({ error: 'Too many requests, please try again later' });
    }
    recordIpRequest(app.db, ip, request.url);
  });
}

function registerBusynessApi(app, { encryptionKey }) {
  app.get('/:slug/busyness', async (request, reply) => {
    const { slug } = request.params;
    const { month, duration } = request.query;

    if (!month) {
      return reply.code(400).send({ error: 'month is required (YYYY-MM)' });
    }

    const durationMinutes = parseInt(duration, 10) || 30;
    if (!VALID_DURATIONS.includes(durationMinutes)) {
      return reply.code(400).send({ error: 'duration must be 30, 45, or 60' });
    }

    const profile = app.db.prepare("SELECT * FROM booking_profiles WHERE slug = ?").get(slug);
    if (!profile) {
      return reply.code(404).send({ error: 'profile not found' });
    }

    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const horizonDate = new Date(now.getTime() + HORIZON_MS);
    const bufferMs = (profile.buffer_time_minutes || 0) * 60 * 1000;

    const activeDates = [];
    const result = {};

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dateObj = new Date(dateStr + 'T00:00:00Z');

      if (dateObj < new Date(todayStr + 'T00:00:00Z') || dateObj > horizonDate) {
        continue;
      }

      const totalSlots = computeSlots(app.db, profile.id, dateStr, durationMinutes, now);
      if (totalSlots.length === 0) {
        result[dateStr] = 'none';
        continue;
      }

      const existingBookings = getExistingBookings(app.db, profile.id, dateStr);
      let available = totalSlots;
      if (existingBookings.length > 0) {
        available = removeConflicts(available, existingBookings, bufferMs);
      }

      activeDates.push({ dateStr, totalSlots, available });
    }

    // Fetch calendar busy data for all active dates in one batch per calendar
    const readCalendars = app.db.prepare(
      "SELECT cc.* FROM profile_read_calendars prc JOIN calendar_connections cc ON prc.calendar_connection_id = cc.id WHERE prc.profile_id = ? AND cc.status = 'connected'"
    ).all(profile.id);

    let calendarBusyByDate = {};
    if (readCalendars.length > 0 && activeDates.length > 0) {
      const firstDate = activeDates[0].dateStr;
      const lastDate = activeDates[activeDates.length - 1].dateStr;
      const rangeMin = firstDate + 'T00:00:00Z';
      const rangeMax = lastDate + 'T23:59:59Z';

      const allBusy = [];
      const calResults = await Promise.allSettled(readCalendars.map(async (cal) => {
        const accessToken = await getValidTokenForConnection(app.db, encryptionKey, cal);
        if (cal.provider === 'google') {
          const response = await fetchWithTimeout(app.fetchFn, 'https://www.googleapis.com/calendar/v3/freeBusy', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeMin: rangeMin, timeMax: rangeMax, items: [{ id: 'primary' }] }),
          });
          if (response.ok) {
            const data = await response.json();
            return data.calendars?.primary?.busy || [];
          }
        } else if (cal.provider === 'microsoft') {
          const response = await fetchWithTimeout(app.fetchFn, 'https://graph.microsoft.com/v1.0/me/calendar/getSchedule', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ schedules: [cal.email], startTime: { dateTime: rangeMin, timeZone: 'UTC' }, endTime: { dateTime: rangeMax, timeZone: 'UTC' } }),
          });
          if (response.ok) {
            const data = await response.json();
            return (data.value?.[0]?.scheduleItems || []).map(item => ({ start: item.start.dateTime, end: item.end.dateTime }));
          }
        } else if (cal.provider === 'zoho') {
          const params = new URLSearchParams({ stime: rangeMin, etime: rangeMax });
          const response = await fetchWithTimeout(app.fetchFn, `https://calendar.zoho.com/api/v1/calendars/freebusy?${params}`, {
            headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
          });
          if (response.ok) {
            const data = await response.json();
            return (data.fb_data || []).filter(s => s.fbtype === 'busy').map(s => ({ start: s.s_datetime, end: s.e_datetime }));
          }
        }
        return [];
      }));

      for (const r of calResults) {
        if (r.status === 'fulfilled' && r.value) allBusy.push(...r.value);
      }

      // Group busy slots by date
      for (const busy of allBusy) {
        const busyDate = busy.start.split('T')[0];
        if (!calendarBusyByDate[busyDate]) calendarBusyByDate[busyDate] = [];
        calendarBusyByDate[busyDate].push(busy);
      }
    }

    for (const { dateStr, totalSlots, available } of activeDates) {
      let finalAvailable = available;
      const dayBusy = calendarBusyByDate[dateStr];
      if (dayBusy && dayBusy.length > 0) {
        finalAvailable = removeConflicts(finalAvailable, dayBusy, bufferMs);
      }

      const ratio = finalAvailable.length / totalSlots.length;
      if (ratio === 0) {
        result[dateStr] = 'full';
      } else if (ratio <= 0.3) {
        result[dateStr] = 'high';
      } else if (ratio <= 0.6) {
        result[dateStr] = 'medium';
      } else {
        result[dateStr] = 'low';
      }
    }

    return { busyness: result };
  });
}

function registerSlotsApi(app, { encryptionKey }) {
  app.get('/:slug/slots', async (request, reply) => {
    const { slug } = request.params;
    const { date, duration, timezone } = request.query;

    if (!date || !duration) {
      return reply.code(400).send({ error: 'date and duration are required' });
    }

    const durationMinutes = parseInt(duration, 10);
    if (!VALID_DURATIONS.includes(durationMinutes)) {
      return reply.code(400).send({ error: 'duration must be 30, 45, or 60' });
    }

    const profile = app.db.prepare("SELECT * FROM booking_profiles WHERE slug = ?").get(slug);
    if (!profile) {
      return reply.code(404).send({ error: 'profile not found' });
    }

    const now = new Date();
    let slots = computeSlots(app.db, profile.id, date, durationMinutes, now);

    const bufferMs = (profile.buffer_time_minutes || 0) * 60 * 1000;
    const existingBookings = getExistingBookings(app.db, profile.id, date);
    if (existingBookings.length > 0) {
      slots = removeConflicts(slots, existingBookings, bufferMs);
    }

    try {
      const busySlots = await getCalendarBusySlots(app.db, encryptionKey, profile.id, date, app.fetchFn);
      if (busySlots.length > 0) {
        slots = removeConflicts(slots, busySlots, bufferMs);
      }
    } catch {
      // If calendar API fails, return slots without conflict filtering rather than erroring
    }

    return { slots };
  });
}

async function createCalendarEvent(fetchFn, db, encryptionKey, connection, eventData) {
  const accessToken = await getValidTokenForConnection(db, encryptionKey, connection);

  if (connection.provider === 'google') {
    const event = {
      summary: eventData.title,
      description: eventData.description || '',
      start: { dateTime: eventData.start },
      end: { dateTime: eventData.end },
      attendees: eventData.attendees.map(email => ({ email })),
    };
    const response = await fetchFn('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google event creation failed: ${errText}`);
    }
    const data = await response.json();
    return data.id;
  } else if (connection.provider === 'microsoft') {
    const body = {
      subject: eventData.title,
      start: { dateTime: eventData.start, timeZone: 'UTC' },
      end: { dateTime: eventData.end, timeZone: 'UTC' },
      attendees: eventData.attendees.map(email => ({ emailAddress: { address: email }, type: 'required' })),
      body: { contentType: 'Text', content: eventData.description || '' },
    };
    const response = await fetchFn('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('Microsoft event creation failed');
    const data = await response.json();
    return data.id;
  } else if (connection.provider === 'zoho') {
    const calendarsResponse = await fetchFn('https://calendar.zoho.com/api/v1/calendars', {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const calendarsData = await calendarsResponse.json();
    const primaryCalendar = calendarsData.calendars.find(c => c.isprimary) || calendarsData.calendars[0];
    const calendarUid = primaryCalendar.uid;

    const pad = n => String(n).padStart(2, '0');
    const formatZoho = (isoStr) => {
      const d = new Date(isoStr);
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}+0000`;
    };

    const zohoBody = {
      eventdata: {
        title: eventData.title,
        description: eventData.description || '',
        start: formatZoho(eventData.start),
        end: formatZoho(eventData.end),
        attendees: eventData.attendees.map(email => ({ email })),
      },
    };
    const response = await fetchFn(`https://calendar.zoho.com/api/v1/calendars/${calendarUid}/events`, {
      method: 'POST',
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(zohoBody),
    });
    if (!response.ok) throw new Error('Zoho event creation failed');
    const result = await response.json();
    return result.events[0].uid;
  }

  throw new Error(`Unsupported provider: ${connection.provider}`);
}

function registerBookingSubmitApi(app, { encryptionKey }) {
  app.post('/:slug', async (request, reply) => {
    const { slug } = request.params;
    const body = request.body || {};

    const { name, email, additional_attendees, title, description, start_time, duration, timezone } = body;

    if (!name || !name.trim()) {
      return reply.code(400).send({ error: 'name is required' });
    }
    if (!email || !email.trim()) {
      return reply.code(400).send({ error: 'email is required' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return reply.code(400).send({ error: 'invalid email format' });
    }

    if (additional_attendees && Array.isArray(additional_attendees)) {
      for (const attendeeEmail of additional_attendees) {
        if (attendeeEmail && !EMAIL_REGEX.test(attendeeEmail)) {
          return reply.code(400).send({ error: 'invalid additional attendee email format' });
        }
      }
    }

    const durationMinutes = parseInt(duration, 10);
    if (!VALID_DURATIONS.includes(durationMinutes)) {
      return reply.code(400).send({ error: 'duration must be 30, 45, or 60' });
    }

    if (!start_time) {
      return reply.code(400).send({ error: 'start_time is required' });
    }

    const profile = app.db.prepare("SELECT * FROM booking_profiles WHERE slug = ?").get(slug);
    if (!profile) {
      return reply.code(404).send({ error: 'profile not found' });
    }

    if (!profile.is_active) {
      return reply.code(400).send({ error: 'This profile is not currently accepting bookings' });
    }

    if (checkEmailRateLimit(app.db, email.trim())) {
      return reply.code(429).send({ error: 'Too many bookings, please try again later' });
    }

    const startDate = new Date(start_time);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
    const dateStr = start_time.split('T')[0];

    // Re-validate availability
    const now = new Date();
    let slots = computeSlots(app.db, profile.id, dateStr, durationMinutes, now);

    const bufferMs = (profile.buffer_time_minutes || 0) * 60 * 1000;
    const existingBookings = getExistingBookings(app.db, profile.id, dateStr);
    if (existingBookings.length > 0) {
      slots = removeConflicts(slots, existingBookings, bufferMs);
    }

    const busySlots = await getCalendarBusySlots(app.db, encryptionKey, profile.id, dateStr, app.fetchFn);
    if (busySlots.length > 0) {
      slots = removeConflicts(slots, busySlots, bufferMs);
    }

    const slotAvailable = slots.some(s => s.start === startDate.toISOString());
    if (!slotAvailable) {
      return reply.code(409).send({ error: 'This slot is no longer available, please pick another' });
    }

    // Gather attendees
    const defaultAttendees = app.db.prepare("SELECT email FROM default_attendees WHERE profile_id = ?").all(profile.id).map(a => a.email);
    const allAttendees = [...new Set([email, ...defaultAttendees, ...(additional_attendees || [])])];

    const bookingTitle = title && title.trim() ? title.trim() : `Meeting with ${name.trim()}`;
    const bookingDescription = description || '';
    const cancellationToken = crypto.randomUUID();

    // Build event description with cancellation link and meeting link
    let eventDescription = bookingDescription;
    if (profile.meeting_link_url) {
      eventDescription += (eventDescription ? '\n\n' : '') + `Meeting link: ${profile.meeting_link_url}`;
    }
    eventDescription += (eventDescription ? '\n\n' : '') + `Cancel this booking: /cancel/${cancellationToken}`;

    // Create calendar events if write calendars are configured
    const writeCalendars = app.db.prepare(
      "SELECT c.* FROM calendar_connections c JOIN profile_write_calendars p ON c.id = p.calendar_connection_id WHERE p.profile_id = ? AND c.status = 'connected'"
    ).all(profile.id);

    // Fallback to legacy column just in case
    if (writeCalendars.length === 0 && profile.write_calendar_id) {
      const fallback = app.db.prepare("SELECT * FROM calendar_connections WHERE id = ? AND status = 'connected'").get(profile.write_calendar_id);
      if (fallback) writeCalendars.push(fallback);
    }

    const createdEvents = [];
    for (const connection of writeCalendars) {
      try {
        const evId = await createCalendarEvent(app.fetchFn, app.db, encryptionKey, connection, {
          title: bookingTitle,
          description: eventDescription,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          attendees: allAttendees,
        });
        if (evId) createdEvents.push({ connectionId: connection.id, eventId: evId });
      } catch (err) {
        app.log.error(`Failed to create event on connection ${connection.id}: ${err.message}`);
      }
    }
    const calendarEventIdStr = createdEvents.length > 0 ? JSON.stringify(createdEvents) : null;

    // Store booking
    app.db.prepare(
      "INSERT INTO bookings (profile_id, booker_name, booker_email, additional_attendees, title, description, start_time, end_time, duration_minutes, cancellation_token, status, calendar_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      profile.id,
      name.trim(),
      email.trim(),
      additional_attendees ? JSON.stringify(additional_attendees) : null,
      bookingTitle,
      bookingDescription,
      startDate.toISOString(),
      endDate.toISOString(),
      durationMinutes,
      cancellationToken,
      'confirmed',
      calendarEventIdStr,
      new Date().toISOString()
    );

    recordEmailBooking(app.db, email.trim(), request.url);

    return {
      booking: {
        title: bookingTitle,
        description: bookingDescription || undefined,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        duration_minutes: durationMinutes,
        booker_name: name.trim(),
        booker_email: email.trim(),
        additional_attendees: additional_attendees || [],
        cancellation_token: cancellationToken,
        calendar_event_id: calendarEventIdStr,
        meeting_link: profile.meeting_link_url || undefined,
        attendees: allAttendees,
      },
    };
  });
}

async function deleteCalendarEvent(fetchFn, db, encryptionKey, connection, calendarEventId) {
  let accessToken;
  try {
    accessToken = decrypt(connection.encrypted_access_token, encryptionKey);
  } catch {
    accessToken = connection.encrypted_access_token;
  }

  if (connection.provider === 'google') {
    await fetchFn(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${calendarEventId}?sendUpdates=all`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } else if (connection.provider === 'microsoft') {
    await fetchFn(`https://graph.microsoft.com/v1.0/me/events/${calendarEventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } else if (connection.provider === 'zoho') {
    const calendarsResponse = await fetchFn('https://calendar.zoho.com/api/v1/calendars', {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const calendarsData = await calendarsResponse.json();
    const primaryCalendar = calendarsData.calendars.find(c => c.isprimary) || calendarsData.calendars[0];
    await fetchFn(`https://calendar.zoho.com/api/v1/calendars/${primaryCalendar.uid}/events/${calendarEventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
  }
}

function registerCancellationPage(app, { encryptionKey, baseLayout }) {
  app.get('/:token', async (request, reply) => {
    const { token } = request.params;
    const booking = app.db.prepare("SELECT b.*, bp.name as profile_name FROM bookings b JOIN booking_profiles bp ON b.profile_id = bp.id WHERE b.cancellation_token = ?").get(token);

    if (!booking) {
      return reply.code(404).type('text/html').send(baseLayout('Not Found', `
        <div style="text-align: center; padding: 4rem 0;">
          <h1>Booking Not Found</h1>
          <p style="color: var(--text-secondary);">The booking link you're looking for doesn't exist or has expired.</p>
          <a href="/" role="button">Go Home</a>
        </div>
      `));
    }

    if (booking.status === 'cancelled') {
      return reply.type('text/html').send(baseLayout('Already Cancelled', `
        <div style="text-align: center; padding: 4rem 0;">
          <article style="max-width: 500px; margin: 0 auto;">
            <h1 style="color: var(--text-secondary);">Already Cancelled</h1>
            <p>This booking has already been cancelled.</p>
            <a href="/" role="button" class="secondary">Go Home</a>
          </article>
        </div>
      `));
    }

    const startDate = new Date(booking.start_time);
    const endDate = new Date(booking.end_time);
    const startLocal = startDate.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
    const endLocal = endDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const attendees = [booking.booker_email];
    if (booking.additional_attendees) {
      try { attendees.push(...JSON.parse(booking.additional_attendees)); } catch {}
    }

    reply.type('text/html').send(baseLayout('Cancel Booking', `
      <div style="max-width: 600px; margin: 3rem auto;">
        <div style="margin-bottom: 0.5rem;"><i class="ph-duotone ph-warning-circle" style="font-size: 4rem; color: var(--error); display: block; margin: 0 auto 0.5rem auto;"></i></div>
        <h1 style="text-align: center; margin-bottom: 1rem; color: var(--error);">Cancel Booking</h1>
        <p style="text-align: center; color: var(--text-secondary); margin-bottom: 2rem;">Are you sure you want to cancel this booking? This action cannot be undone.</p>
        <article style="border-color: var(--error-light); background: linear-gradient(135deg, var(--neutral-0) 0%, rgba(220, 38, 38, 0.05) 100%);">
          <h3>${escapeHtml(booking.title)}</h3>
          <p><strong>When:</strong> ${escapeHtml(startLocal)} - ${escapeHtml(endLocal)}</p>
          <p><strong>Duration:</strong> ${booking.duration_minutes} minutes</p>
          <p><strong>Attendees:</strong><br>${attendees.map(e => escapeHtml(e)).join('<br>')}</p>
        </article>
        <div style="display: flex; gap: 1rem; margin-top: 2rem;">
          <form method="POST" action="/api/cancel/${escapeHtml(token)}" style="flex: 1; margin: 0; background: transparent; border: none; padding: 0;">
            <button type="submit" class="danger" style="width: 100%;">Yes, Cancel Booking</button>
          </form>
          <a href="/" role="button" class="secondary" style="flex: 1;">No, Keep Booking</a>
        </div>
      </div>
    `));
  });
}

function registerCancellationApi(app, { encryptionKey }) {
  app.post('/:token', async (request, reply) => {
    const { token } = request.params;
    const booking = app.db.prepare("SELECT b.*, bp.write_calendar_id FROM bookings b JOIN booking_profiles bp ON b.profile_id = bp.id WHERE b.cancellation_token = ?").get(token);

    if (!booking) {
      return reply.code(404).send({ error: 'Booking not found' });
    }

    if (booking.status === 'cancelled') {
      return reply.code(400).send({ error: 'This booking has already been cancelled' });
    }

    // Attempt to delete calendar events
    if (booking.calendar_event_id) {
      try {
        const events = JSON.parse(booking.calendar_event_id);
        for (const ev of events) {
          const connection = app.db.prepare("SELECT * FROM calendar_connections WHERE id = ? AND status = 'connected'").get(ev.connectionId);
          if (connection) {
            try {
              await deleteCalendarEvent(app.fetchFn, app.db, encryptionKey, connection, ev.eventId);
            } catch {
              // Ignore individual delete failures
            }
          }
        }
      } catch (err) {
        // Fallback for legacy single string ID
        if (booking.write_calendar_id) {
          const connection = app.db.prepare("SELECT * FROM calendar_connections WHERE id = ? AND status = 'connected'").get(booking.write_calendar_id);
          if (connection) {
            try { await deleteCalendarEvent(app.fetchFn, app.db, encryptionKey, connection, booking.calendar_event_id); } catch {}
          }
        }
      }
    }

    // Mark as cancelled in DB
    app.db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);

    return { message: 'Booking successfully cancelled' };
  });
}

module.exports = { registerBookingRoutes, registerSlotsApi, registerBusynessApi, registerBookingSubmitApi, registerCancellationPage, registerCancellationApi, registerRateLimitHook, computeSlots, removeConflicts, getCalendarBusySlots, getExistingBookings, VALID_DURATIONS };
