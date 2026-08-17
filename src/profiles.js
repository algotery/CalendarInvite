const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function convertUTCToLocalTime(utcTimeStr, adminTimezone) {
  if (!utcTimeStr || utcTimeStr.length === 0) return utcTimeStr;

  const [hours, minutes] = utcTimeStr.split(':').map(Number);
  const utcDate = new Date(Date.UTC(2024, 0, 1, hours, minutes, 0));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: adminTimezone || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(utcDate);
  const localHours = parts.find(p => p.type === 'hour').value;
  const localMinutes = parts.find(p => p.type === 'minute').value;

  return `${localHours}:${localMinutes}`;
}

function convertTimeToUTC(timeStr, adminTimezone) {
  if (!timeStr || timeStr.length === 0) return timeStr;

  const [hours, minutes] = timeStr.split(':').map(Number);
  const tz = adminTimezone || 'UTC';
  const probe = new Date(Date.UTC(2024, 0, 1, 12, 0, 0));
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = formatter.formatToParts(probe);
  const localAtProbe = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const utcAtProbe = 12;
  const offsetHours = localAtProbe - utcAtProbe;

  let utcHours = hours - offsetHours;
  if (utcHours < 0) utcHours += 24;
  if (utcHours >= 24) utcHours -= 24;

  return `${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseScheduleFromBody(body, adminTimezone = 'UTC') {
  const entries = [];
  for (let day = 0; day <= 6; day++) {
    const key = `schedule[${day}]`;
    const starts = body[`${key}[start][]`];
    const ends = body[`${key}[end][]`];
    if (!starts || !ends) continue;

    const startArr = Array.isArray(starts) ? starts : [starts];
    const endArr = Array.isArray(ends) ? ends : [ends];

    for (let i = 0; i < startArr.length; i++) {
      if (startArr[i] && endArr[i]) {
        const utcStart = convertTimeToUTC(startArr[i], adminTimezone);
        const utcEnd = convertTimeToUTC(endArr[i], adminTimezone);
        entries.push({ day_of_week: day, start_time: utcStart, end_time: utcEnd });
      }
    }
  }
  return entries;
}

function parseAttendeesFromBody(body) {
  const raw = body['attendees[]'];
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .flatMap(e => e.split(','))
    .filter(e => e && e.trim())
    .map(e => e.trim());
}

function parseOverridesFromBody(body) {
  const dates = body['override_dates[]'];
  const isBlockeds = body['override_is_blocked[]'];
  const customRanges = body['override_custom_ranges[]'];
  const overrides = [];
  if (dates) {
    const dArr = Array.isArray(dates) ? dates : [dates];
    const bArr = Array.isArray(isBlockeds) ? isBlockeds : [isBlockeds];
    const cArr = Array.isArray(customRanges) ? customRanges : [customRanges];
    for (let i = 0; i < dArr.length; i++) {
      overrides.push({
        date: dArr[i],
        is_blocked: parseInt(bArr[i], 10) || 0,
        custom_ranges: cArr[i] && cArr[i].trim() !== '' ? cArr[i] : null
      });
    }
  }
  return overrides;
}


function profileFormHtml(token, profile, calendars, attendees, schedules, error, overrides, adminTimezone = 'UTC', timeFormat = '12h') {
  const isEdit = !!profile;
  const action = isEdit ? `/admin/profiles/${profile.id}` : '/admin/profiles';
  const title = isEdit ? 'Edit Profile' : 'New Profile';

  const calendarOptions = calendars.map(c =>
    `<option value="${c.id}">${escapeHtml(c.email)} (${c.provider})</option>`
  ).join('');

  const writeCalendarIds = isEdit
    ? (schedules.writeCalendarIds || []).concat(profile.write_calendar_id ? [profile.write_calendar_id] : [])
    : [];

  const writeCalendarRadios = calendars.map(c =>
    `<label class="radio-card"><input type="radio" name="write_calendar_id" value="${c.id}" ${writeCalendarIds.includes(c.id) ? 'checked' : ''}><span class="radio-card-content"><i class="ph-fill ph-calendar-check"></i><span class="radio-card-text"><span class="radio-card-email">${escapeHtml(c.email)}</span><span class="radio-card-provider">${c.provider}</span></span></span></label>`
  ).join('');

  const readCalendarIds = isEdit
    ? schedules.readCalendarIds || []
    : [];

  const readCalendarCheckboxes = calendars.map(c =>
    `<label class="calendar-check-card"><input type="checkbox" name="read_calendar_ids[]" value="${c.id}" ${readCalendarIds.includes(c.id) ? 'checked' : ''}><span class="calendar-check-content"><i class="ph-fill ph-eye"></i><span class="calendar-check-text"><span class="calendar-check-email">${escapeHtml(c.email)}</span><span class="calendar-check-provider">${c.provider}</span></span></span></label>`
  ).join('');

  const attendeeJsonArr = JSON.stringify(attendees);
  const attendeeInputs = `
    <div class="guests-section">
      <div class="guests-input-area open" style="max-height:200px;opacity:1;padding:10px 12px;">
        <div class="guests-tags" id="profile-guests-tags"></div>
        <input type="text" id="profile-guests-input" class="guests-text-input" placeholder="Enter email address">
        <input type="hidden" name="attendees[]" id="profile-attendees-hidden">
      </div>
    </div>`;

  const SHORT_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  function formatTimeLabel(val) {
    const [h, m] = val.split(':').map(Number);
    if (timeFormat === '24h') {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const ampm = h < 12 ? 'AM' : 'PM';
    return `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function buildTimeDropdown(name, selectedValue, disabled) {
    const label = formatTimeLabel(selectedValue);
    const disabledAttr = disabled ? ' disabled' : '';
    return `<div class="time-dropdown${disabled ? ' disabled' : ''}"><input type="hidden" name="${name}" value="${selectedValue}"${disabledAttr}><button type="button" class="time-dropdown-trigger"${disabledAttr}><span class="time-dropdown-value">${label}</span><i class="ph ph-caret-down"></i></button></div>`;
  }

  const scheduleHtml = `<div class="schedule-grid">` + DAYS.map((dayName, dayIdx) => {
    const daySchedules = (schedules.templates || []).filter(s => s.day_of_week === dayIdx);
    const isActive = daySchedules.length > 0;

    let rangesHtml = '';
    if (isActive) {
      rangesHtml = daySchedules.map(s => {
        const localStart = convertUTCToLocalTime(s.start_time, adminTimezone);
        const localEnd = convertUTCToLocalTime(s.end_time, adminTimezone);
        return `<div class="time-range">${buildTimeDropdown(`schedule[${dayIdx}][start][]`, localStart, false)}<span class="time-range-sep">–</span>${buildTimeDropdown(`schedule[${dayIdx}][end][]`, localEnd, false)}<button type="button" class="remove-range-btn remove-range" title="Remove"><i class="ph ph-trash"></i></button></div>`;
      }).join('');
    } else {
      rangesHtml = `<div class="time-range">${buildTimeDropdown(`schedule[${dayIdx}][start][]`, '09:00', true)}<span class="time-range-sep">–</span>${buildTimeDropdown(`schedule[${dayIdx}][end][]`, '17:00', true)}<button type="button" class="remove-range-btn remove-range" title="Remove"><i class="ph ph-trash"></i></button></div>`;
    }

    return `
      <div class="schedule-day ${isActive ? '' : 'disabled'}" id="day-row-${dayIdx}">
        <div class="day-toggle">
          <label class="toggle-switch">
            <input type="checkbox" class="toggle-day-cb" data-day="${dayIdx}" id="toggle-${dayIdx}" ${isActive ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <span class="day-label">${SHORT_DAYS[dayIdx]}</span>
        </div>
        <div class="time-ranges" id="ranges-${dayIdx}" style="${isActive ? '' : 'display:none;'}">
          <div class="ranges-container" id="container-${dayIdx}">${rangesHtml}</div>
        </div>
        <div class="schedule-day-actions" id="actions-${dayIdx}" style="${isActive ? '' : 'display:none;'}">
          <button type="button" class="schedule-action-btn add-range-btn" data-day="${dayIdx}" title="Add time range"><i class="ph ph-plus"></i></button>
        </div>
        <div class="unavailable-text" id="unavail-${dayIdx}" style="${isActive ? 'display:none;' : ''}">
          Unavailable
        </div>
      </div>
    `;
  }).join('') + `</div><button type="button" class="copy-times-link" id="copy-times-trigger"><i class="ph ph-copy"></i> Copy times to...</button>`;

  // Calculate summaries for accordion sections
  const slugSummary = profile?.slug ? escapeHtml(profile.slug) : 'Not set';
  const bufferSummary = (profile?.buffer_time_minutes ?? 0) > 0 ? `${profile.buffer_time_minutes} min buffer` : 'No buffer';
  const locationSummary = profile?.meeting_tool === 'meet' ? 'Google Meet' : profile?.meeting_tool === 'teams' ? 'Microsoft Teams' : 'No location set';
  const writeCalCount = writeCalendarIds.length;
  const readCalCount = readCalendarIds.length;
  const calendarSummary = (writeCalCount + readCalCount) > 0 ? `${writeCalCount + readCalCount} connected` : 'No calendars';

  const activeDays = DAYS.filter((_, idx) => (schedules.templates || []).some(s => s.day_of_week === idx));
  const availabilitySummary = activeDays.length > 0 ? `${activeDays.length} days configured` : 'No availability set';

  const overrideCount = (overrides || []).length;
  const overrideSummary = overrideCount > 0 ? `${overrideCount} override${overrideCount > 1 ? 's' : ''}` : 'No overrides';

  const attendeeCount = attendees.length;
  const attendeeSummary = attendeeCount > 0 ? `${attendeeCount} attendee${attendeeCount > 1 ? 's' : ''}` : 'None';

  return `
    <div class="floating-modal-backdrop">
      <div class="floating-modal">
        <div class="floating-modal-header">
          <a href="/admin/profiles" class="floating-modal-close"><i class="ph-bold ph-x"></i></a>
          <span class="floating-modal-label">Event type</span>
          <h1 class="floating-modal-title">${escapeHtml(profile?.name || 'New Profile')}</h1>
        </div>

        <div class="floating-modal-body">
        ${error ? `<div role="alert" class="error" style="margin-bottom: 16px;">${escapeHtml(error)}</div>` : ''}

        <form id="profile-form" method="POST" action="${action}">
          <input type="hidden" name="_csrf" value="${token}">

          <!-- Profile Settings Section -->
          <div class="modal-section ${!isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Profile Settings</h3>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <div class="float-field">
                <input type="text" name="slug" value="${escapeHtml(profile?.slug || '')}" placeholder=" " required>
                <label>Slug</label>
              </div>
              <div class="float-field">
                <input type="text" name="name" value="${escapeHtml(profile?.name || '')}" placeholder=" " required>
                <label>Display Name</label>
              </div>
            </div>
          </div>

          <!-- Duration & Buffer Section -->
          <div class="modal-section ${isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Duration & Buffer</h3>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <div class="field-group">
                <span class="field-label">Buffer Time</span>
                <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                  <div style="display: flex; align-items: center; gap: 8px; background: var(--neutral-10); border: 1px solid var(--neutral-30); border-radius: 8px; padding: 10px 16px;">
                    <input
                      type="number"
                      id="buffer_time_minutes"
                      name="buffer_time_minutes"
                      value="${profile?.buffer_time_minutes ?? 0}"
                      min="0" max="120" step="5"
                      style="width: 56px; font-size: 20px; font-weight: 700; text-align: center; border: none; background: transparent; color: var(--primary); margin: 0; padding: 0; -moz-appearance: textfield;"
                    >
                    <span style="font-size: 13px; color: var(--text-secondary);">min</span>
                  </div>
                  <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    ${[0, 5, 10, 15, 30].map(v => `
                      <button type="button"
                        onclick="document.getElementById('buffer_time_minutes').value=${v}"
                        style="padding: 6px 14px; font-size: 13px; font-weight: 600; border-radius: 20px; border: 1.5px solid var(--neutral-30); background: ${(profile?.buffer_time_minutes ?? 0) == v ? 'var(--primary)' : 'var(--neutral-0)'}; color: ${(profile?.buffer_time_minutes ?? 0) == v ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; transition: all 0.15s;">
                        ${v === 0 ? 'None' : v + ' min'}
                      </button>`).join('')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Meeting Location Section -->
          <div class="modal-section ${isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Meeting Location</h3>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <div class="float-field">
                <input type="url" name="meeting_link_url" value="${escapeHtml(profile?.meeting_link_url || '')}" placeholder=" ">
                <label>Meeting Link</label>
              </div>
              <div class="field-group">
                <span class="field-label">Meeting Tool</span>
                <select name="meeting_tool">
                  <option value="">None</option>
                  <option value="meet" ${profile?.meeting_tool === 'meet' ? 'selected' : ''}>Google Meet</option>
                  <option value="teams" ${profile?.meeting_tool === 'teams' ? 'selected' : ''}>Microsoft Teams</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Calendar Integration Section -->
          <div class="modal-section ${isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Calendar Integration</h3>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <div class="cal-integration-group">
                <div class="cal-integration-card">
                  <div class="cal-integration-header">
                    <i class="ph-fill ph-pencil-simple-line"></i>
                    <div>
                      <span class="cal-integration-title">Write Calendar</span>
                      <span class="cal-integration-desc">New events will be created in this calendar</span>
                    </div>
                  </div>
                  <div class="cal-integration-options">
                    ${writeCalendarRadios || '<p class="cal-integration-empty"><i class="ph ph-link-break"></i> No calendar connections. <a href="/admin/calendars">Connect one</a></p>'}
                  </div>
                </div>
                <div class="cal-integration-card">
                  <div class="cal-integration-header">
                    <i class="ph-fill ph-eye"></i>
                    <div>
                      <span class="cal-integration-title">Read Calendars</span>
                      <span class="cal-integration-desc">Check these for conflicts when booking</span>
                    </div>
                  </div>
                  <div class="cal-integration-options">
                    ${readCalendarCheckboxes || '<p class="cal-integration-empty"><i class="ph ph-link-break"></i> No connections. <a href="/admin/calendars">Connect one</a></p>'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Availability Section -->
          <div class="modal-section ${isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Availability</h3>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              ${scheduleHtml}
            </div>
          </div>

          <!-- Schedule Overrides Section -->
          <div class="modal-section ${isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Schedule Overrides</h3>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <div class="overrides-list" id="overrides-list" style="${overrides && overrides.length ? '' : 'display:none;'}">
                ${(overrides || []).map(o => {
                  const isBlocked = o.is_blocked ? 1 : 0;
                  const typeLabel = isBlocked ? 'Blocked' : 'Custom';
                  let rangesDisplay = '';
                  if (!isBlocked && o.custom_ranges) {
                    const ranges = JSON.parse(o.custom_ranges);
                    rangesDisplay = ranges.map(r => `${escapeHtml(r.start)} - ${escapeHtml(r.end)}`).join(', ');
                  }
                  const dateObj = new Date(o.date + 'T00:00:00');
                  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                  const dateFormatted = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  return `<div class="override-card">
                    <input type="hidden" name="override_dates[]" value="${escapeHtml(o.date)}">
                    <input type="hidden" name="override_is_blocked[]" value="${isBlocked}">
                    <input type="hidden" name="override_custom_ranges[]" value="${escapeHtml(o.custom_ranges || '')}">
                    <div class="override-card-info">
                      <div class="override-card-date">
                        <span class="override-card-day">${dayName}</span>
                        <span>${dateFormatted}</span>
                      </div>
                      <div class="override-card-type ${isBlocked ? 'blocked' : 'custom'}">
                        <i class="ph-bold ${isBlocked ? 'ph-prohibit' : 'ph-clock'}"></i>
                        ${typeLabel}${!isBlocked && rangesDisplay ? ' &middot; ' + rangesDisplay : ''}
                      </div>
                    </div>
                    <button type="button" class="override-card-delete remove-override-btn" title="Remove"><i class="ph-bold ph-trash"></i></button>
                  </div>`;
                }).join('')}
              </div>
              <p id="no-overrides-msg" class="override-empty-msg" style="${overrides && overrides.length ? 'display:none;' : ''}"><i class="ph-duotone ph-calendar-blank"></i> No overrides configured.</p>

              <div class="override-add-form">
                <div class="override-add-row">
                  <div class="field-group" style="margin-bottom: 0; flex: 1; min-width: 140px;">
                    <span class="field-label">Date</span>
                    <input type="date" id="new_override_date" style="margin-bottom: 0;">
                  </div>
                  <div class="field-group" style="margin-bottom: 0; flex: 1; min-width: 140px;">
                    <span class="field-label">Type</span>
                    <select id="new_override_type" style="margin-bottom: 0;">
                      <option value="blocked">Block entire day</option>
                      <option value="custom">Custom hours</option>
                    </select>
                  </div>
                  <div id="new_override_custom" style="display:none; gap: 8px; align-items: flex-end;">
                    <div class="field-group" style="margin-bottom: 0;">
                      <span class="field-label">Start</span>
                      <input type="text" class="time-picker-override" id="new_override_start" value="09:00" style="width: 90px; margin-bottom: 0;">
                    </div>
                    <span style="padding-bottom: 8px;">-</span>
                    <div class="field-group" style="margin-bottom: 0;">
                      <span class="field-label">End</span>
                      <input type="text" class="time-picker-override" id="new_override_end" value="17:00" style="width: 90px; margin-bottom: 0;">
                    </div>
                  </div>
                </div>
                <button type="button" id="add-override-btn" class="override-add-btn"><i class="ph-bold ph-plus"></i> Add Override</button>
              </div>
            </div>
          </div>

          <!-- Default Attendees Section -->
          <div class="modal-section ${isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Default Attendees</h3>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              ${attendeeInputs}
            </div>
          </div>
        </form>
        </div>

        <div class="floating-modal-footer">
          <a href="/admin/profiles" class="btn-secondary">Cancel</a>
          <button type="submit" form="profile-form" class="btn-primary">${isEdit ? 'Update' : 'Create'}</button>
          ${isEdit ? `
          <button type="submit" form="delete-profile-form" class="btn-danger">Delete</button>
          ` : ''}
        </div>

        ${isEdit ? `
        <form id="delete-profile-form" method="POST" action="/admin/profiles/${profile.id}/delete" style="display:none;" onsubmit="event.preventDefault(); var f=this; AppModal.confirm('All bookings and settings associated with this profile will be permanently deleted.', function(){f.submit()}, {title:'Delete Profile', confirmText:'Delete', danger:true, icon:'<i class=\\'ph-fill ph-trash\\' style=\\'font-size:32px;color:var(--error)\\'></i>'}); return false;">
          <input type="hidden" name="_csrf" value="${token}">
        </form>
        ` : ''}
      </div>
    </div>
    <script>
      var APP_TIME_FORMAT = '${timeFormat}';
      function toggleSection(header) {
        const section = header.closest('.modal-section');
        const wasOpen = section.classList.contains('open');
        section.classList.toggle('open');
        if (!wasOpen) {
          setTimeout(function() {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 80);
        }
      }

      (function() {
        flatpickr('.time-picker-override', { enableTime: true, noCalendar: true, dateFormat: "H:i", time_24hr: APP_TIME_FORMAT === '24h' });

        document.getElementById('new_override_type').addEventListener('change', (e) => {
          document.getElementById('new_override_custom').style.display = e.target.value === 'custom' ? 'flex' : 'none';
        });

        document.getElementById('overrides-list').addEventListener('click', (e) => {
          if (e.target.closest('.remove-override-btn')) {
            e.target.closest('.override-card').remove();
            if (document.querySelectorAll('.override-card').length === 0) {
              document.getElementById('overrides-list').style.display = 'none';
              document.getElementById('no-overrides-msg').style.display = 'block';
            }
          }
        });

        document.getElementById('add-override-btn').addEventListener('click', () => {
          const date = document.getElementById('new_override_date').value;
          const type = document.getElementById('new_override_type').value;
          if (!date) return AppModal.alert('Please select a date.', {title:'Missing Date'});

          const isBlocked = type === 'blocked';
          let customRangesStr = '';
          let rangesDisplay = '';

          if (!isBlocked) {
            const start = document.getElementById('new_override_start').value;
            const end = document.getElementById('new_override_end').value;
            if (!start || !end) return AppModal.alert('Please select start and end times.', {title:'Missing Times'});
            const ranges = [{ start, end }];
            customRangesStr = JSON.stringify(ranges);
            rangesDisplay = start + ' - ' + end;
          }

          const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          const dateObj = new Date(date + 'T00:00:00');
          const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
          const dateFormatted = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const typeLabel = isBlocked ? 'Blocked' : 'Custom';

          const card = document.createElement('div');
          card.className = 'override-card';
          card.innerHTML =
            '<input type="hidden" name="override_dates[]" value="' + escapeHtml(date) + '">' +
            '<input type="hidden" name="override_is_blocked[]" value="' + (isBlocked ? '1' : '0') + '">' +
            '<input type="hidden" name="override_custom_ranges[]" value="' + escapeHtml(customRangesStr) + '">' +
            '<div class="override-card-info">' +
              '<div class="override-card-date">' +
                '<span class="override-card-day">' + dayName + '</span>' +
                '<span>' + dateFormatted + '</span>' +
              '</div>' +
              '<div class="override-card-type ' + (isBlocked ? 'blocked' : 'custom') + '">' +
                '<i class="ph-bold ' + (isBlocked ? 'ph-prohibit' : 'ph-clock') + '"></i> ' +
                typeLabel + (!isBlocked && rangesDisplay ? ' &middot; ' + rangesDisplay : '') +
              '</div>' +
            '</div>' +
            '<button type="button" class="override-card-delete remove-override-btn" title="Remove"><i class="ph-bold ph-trash"></i></button>';

          document.getElementById('overrides-list').appendChild(card);
          document.getElementById('overrides-list').style.display = '';
          document.getElementById('no-overrides-msg').style.display = 'none';
          document.getElementById('new_override_date').value = '';
        });

        // Custom time dropdown logic
        window.TimeDropdown = {
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
            const s = this.timeSlots.find(t => t.val === val);
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
              panel.querySelectorAll('.time-dropdown-item').forEach(i => i.classList.remove('active'));
              item.classList.add('active');
              dropdown.classList.remove('open');
              panel.remove();
            });
          },
          closeAll: function() {
            document.querySelectorAll('.time-dropdown.open').forEach(function(d) {
              d.classList.remove('open');
              const p = d.querySelector('.time-dropdown-panel');
              if (p) p.remove();
            });
          }
        };

        document.addEventListener('click', function(e) {
          const trigger = e.target.closest('.time-dropdown-trigger');
          if (trigger && !trigger.disabled) {
            e.stopPropagation();
            TimeDropdown.open(trigger);
            return;
          }
          if (!e.target.closest('.time-dropdown-panel')) {
            TimeDropdown.closeAll();
          }
        });

        function makeProfileTimeRange(day, startVal, endVal) {
          const div = document.createElement('div');
          div.className = 'time-range';
          div.innerHTML = TimeDropdown.createDropdownHtml('schedule[' + day + '][start][]', startVal, false) + '<span class="time-range-sep">–</span>' + TimeDropdown.createDropdownHtml('schedule[' + day + '][end][]', endVal, false) + '<button type="button" class="remove-range-btn remove-range" title="Remove"><i class="ph ph-trash"></i></button>';
          return div;
        }

        // Toggle Day
        document.querySelectorAll('.toggle-day-cb').forEach(cb => {
          cb.addEventListener('change', (e) => {
            const day = e.target.dataset.day;
            const row = document.getElementById('day-row-' + day);
            const rangesDiv = document.getElementById('ranges-' + day);
            const actionsDiv = document.getElementById('actions-' + day);
            const unavailText = document.getElementById('unavail-' + day);

            if (e.target.checked) {
              row.classList.remove('disabled');
              rangesDiv.style.display = '';
              if (actionsDiv) actionsDiv.style.display = '';
              unavailText.style.display = 'none';
              rangesDiv.querySelectorAll('input[type="hidden"]').forEach(s => s.disabled = false);
              rangesDiv.querySelectorAll('.time-dropdown').forEach(d => d.classList.remove('disabled'));
              rangesDiv.querySelectorAll('.time-dropdown-trigger').forEach(b => b.disabled = false);
            } else {
              row.classList.add('disabled');
              rangesDiv.style.display = 'none';
              if (actionsDiv) actionsDiv.style.display = 'none';
              unavailText.style.display = '';
              rangesDiv.querySelectorAll('input[type="hidden"]').forEach(s => s.disabled = true);
              rangesDiv.querySelectorAll('.time-dropdown').forEach(d => d.classList.add('disabled'));
              rangesDiv.querySelectorAll('.time-dropdown-trigger').forEach(b => b.disabled = true);
            }
          });
        });

        // Remove Range
        document.addEventListener('click', (e) => {
          if (e.target.classList.contains('remove-range') || e.target.closest('.remove-range')) {
            const btn = e.target.classList.contains('remove-range') ? e.target : e.target.closest('.remove-range');
            const timeRange = btn.closest('.time-range');
            const container = timeRange.parentElement;
            timeRange.remove();

            if (container.children.length === 0) {
              const day = container.id.replace('container-', '');
              const cb = document.getElementById('toggle-' + day);
              if (cb) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
                const defaultRange = makeProfileTimeRange(day, '09:00', '17:00');
                defaultRange.querySelectorAll('input[type="hidden"]').forEach(s => s.disabled = true);
                defaultRange.querySelectorAll('.time-dropdown').forEach(d => d.classList.add('disabled'));
                defaultRange.querySelectorAll('.time-dropdown-trigger').forEach(b => b.disabled = true);
                container.appendChild(defaultRange);
              }
            }
          }
        });

        // Add Range
        document.querySelectorAll('.add-range-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const day = e.target.closest('.schedule-action-btn').dataset.day;
            const container = document.getElementById('container-' + day);
            container.appendChild(makeProfileTimeRange(day, '09:00', '17:00'));
          });
        });

        // Copy times to... trigger
        const copyTrigger = document.getElementById('copy-times-trigger');
        if (copyTrigger) {
          copyTrigger.addEventListener('click', () => {
            const activeDays = [];
            for (let i = 0; i < 7; i++) {
              if (document.getElementById('toggle-' + i).checked) activeDays.push(i);
            }
            if (activeDays.length === 0) return;
            const sourceDay = activeDays[0];
            const sourceContainer = document.getElementById('container-' + sourceDay);
            const values = Array.from(sourceContainer.querySelectorAll('.time-range')).map(r => {
              const inputs = r.querySelectorAll('input[type="hidden"]');
              return { start: inputs[0].value, end: inputs[1].value };
            });

            for (let i = 0; i < 7; i++) {
              if (i === sourceDay) continue;
              const cb = document.getElementById('toggle-' + i);
              cb.checked = true;
              cb.dispatchEvent(new Event('change'));
              const container = document.getElementById('container-' + i);
              container.innerHTML = '';
              values.forEach(v => container.appendChild(makeProfileTimeRange(i, v.start, v.end)));
            }
          });
        }

        // Profile guests tag input
        (function() {
          var guests = ${attendeeJsonArr};
          var input = document.getElementById('profile-guests-input');
          var tagsContainer = document.getElementById('profile-guests-tags');
          var hiddenInput = document.getElementById('profile-attendees-hidden');

          function isValidEmail(email) {
            return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
          }

          function renderTags() {
            tagsContainer.innerHTML = guests.map(function(email, i) {
              return '<span class="guest-tag">' + email + '<button type="button" data-idx="' + i + '" class="remove-guest-tag">\\u00d7</button></span>';
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

          tagsContainer.addEventListener('click', function(e) {
            if (e.target.classList.contains('remove-guest-tag')) {
              guests.splice(parseInt(e.target.dataset.idx), 1);
              renderTags();
            }
          });

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

          renderTags();
        })();
      })();
    </script>
  `;
}

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
              <hr style="margin: 4px 0; border: none; border-top: 1px solid #e8e8e8;">
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

      const startArr = Array.isArray(starts) ? starts : [starts];
      const endArr = Array.isArray(ends) ? ends : [ends];

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

    const writeCalIdDirect = request.body['write_calendar_id'] ? Number(request.body['write_calendar_id']) : null;
    const result = await app.db.query(
      "INSERT INTO booking_profiles (user_id, slug, name, is_active, write_calendar_id, meeting_link_url, meeting_tool, buffer_time_minutes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
      [adminId, slug, name, true, writeCalIdDirect, meeting_link_url || null, meeting_tool || null, buffer_time_minutes, new Date().toISOString()]
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

    const writeCalIdForProfile = request.body['write_calendar_id'] ? Number(request.body['write_calendar_id']) : null;
    await app.db.run(
      "UPDATE booking_profiles SET slug = $1, name = $2, write_calendar_id = $3, meeting_link_url = $4, meeting_tool = $5, buffer_time_minutes = $6 WHERE id = $7",
      [slug, name, writeCalIdForProfile, meeting_link_url || null, meeting_tool || null, buffer_time_minutes, id]
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
