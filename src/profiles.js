const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function convertUTCToLocalTime(utcTimeStr, adminTimezone) {
  if (!utcTimeStr || utcTimeStr.length === 0) return utcTimeStr;

  const [hours, minutes] = utcTimeStr.split(':').map(Number);

  // Create UTC date
  const now = new Date();
  const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0));

  // Convert to local time
  const localHours = String(utcDate.getHours()).padStart(2, '0');
  const localMinutes = String(utcDate.getMinutes()).padStart(2, '0');

  return `${localHours}:${localMinutes}`;
}

function convertTimeToUTC(timeStr, adminTimezone) {
  if (!timeStr || timeStr.length === 0) return timeStr;

  const [hours, minutes] = timeStr.split(':').map(Number);

  // Create a date in admin's timezone
  const now = new Date();
  const localDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);

  // Get UTC time string
  const utcHours = String(localDate.getUTCHours()).padStart(2, '0');
  const utcMinutes = String(localDate.getUTCMinutes()).padStart(2, '0');

  return `${utcHours}:${utcMinutes}`;
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

function overridesHtml(overrides) {
  const overrideRows = (overrides || []).map(o => {
    const isBlocked = o.is_blocked ? 1 : 0;
    const typeLabel = isBlocked ? 'Blocked' : 'Custom';
    let rangesDisplay = '';
    if (!isBlocked && o.custom_ranges) {
      const ranges = JSON.parse(o.custom_ranges);
      rangesDisplay = ranges.map(r => `${escapeHtml(r.start)} - ${escapeHtml(r.end)}`).join(', ');
    }

    return `<tr>
      <td>
        ${escapeHtml(o.date)}
        <input type="hidden" name="override_dates[]" value="${escapeHtml(o.date)}">
        <input type="hidden" name="override_is_blocked[]" value="${isBlocked}">
        <input type="hidden" name="override_custom_ranges[]" value="${escapeHtml(o.custom_ranges || '')}">
      </td>
      <td>${typeLabel}</td>
      <td>${rangesDisplay}</td>
      <td><button type="button" class="danger outline remove-override-btn" style="padding: 4px 8px; font-size: 12px;">Delete</button></td>
    </tr>`;
  }).join('');

  return `
    <fieldset>
      <legend>Schedule Overrides</legend>
      <small style="color: var(--text-secondary); display: block; margin-bottom: 1rem;">Add specific dates where you are unavailable or have custom hours.</small>
      
      <table id="overrides-table" style="${overrides && overrides.length ? '' : 'display:none;'}">
        <thead><tr><th>Date</th><th>Type</th><th>Hours</th><th>Actions</th></tr></thead>
        <tbody id="overrides-tbody">${overrideRows}</tbody>
      </table>
      <p id="no-overrides-msg" style="${overrides && overrides.length ? 'display:none;' : ''}">No overrides configured.</p>

      <div style="margin-top: 1rem; border: 1px solid var(--border-color); padding: 1rem; border-radius: 8px;">
        <h4 style="margin-top: 0; margin-bottom: 1rem;">Add New Override</h4>
        <div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: flex-end;">
          <div style="display: flex; flex-direction: column; margin-bottom: 0;">
            <label for="new_override_date" style="margin-bottom: 0.25rem; font-size: 0.875rem;">Date</label>
            <input type="date" id="new_override_date" style="margin-bottom: 0;">
          </div>
          <div style="display: flex; flex-direction: column; margin-bottom: 0;">
            <label for="new_override_type" style="margin-bottom: 0.25rem; font-size: 0.875rem;">Type</label>
            <select id="new_override_type" style="margin-bottom: 0;">
              <option value="blocked">Block entire day</option>
              <option value="custom">Custom hours</option>
            </select>
          </div>
          <div id="new_override_custom" style="display:none; gap: 0.5rem; align-items: center; margin-bottom: 0;">
            <input type="text" class="time-picker-override" id="new_override_start" value="09:00" style="width: 100px; margin-bottom: 0;">
            <span style="margin-bottom: 0;">-</span>
            <input type="text" class="time-picker-override" id="new_override_end" value="17:00" style="width: 100px; margin-bottom: 0;">
          </div>
          <button type="button" id="add-override-btn" class="outline" style="margin-bottom: 0; padding-top: 0.5rem; padding-bottom: 0.5rem;">Add Override</button>
        </div>
      </div>
    </fieldset>
  `;
}

function profileFormHtml(token, profile, calendars, attendees, schedules, error, overrides, adminTimezone = 'UTC') {
  const isEdit = !!profile;
  const action = isEdit ? `/admin/profiles/${profile.id}` : '/admin/profiles';
  const title = isEdit ? 'Edit Profile' : 'New Profile';

  const calendarOptions = calendars.map(c =>
    `<option value="${c.id}">${escapeHtml(c.email)} (${c.provider})</option>`
  ).join('');

  const writeCalendarIds = isEdit
    ? (schedules.writeCalendarIds || []).concat(profile.write_calendar_id ? [profile.write_calendar_id] : [])
    : [];

  const writeCalendarCheckboxes = calendars.map(c =>
    `<label><input type="checkbox" name="write_calendar_ids[]" value="${c.id}" ${writeCalendarIds.includes(c.id) ? 'checked' : ''}> ${escapeHtml(c.email)} (${c.provider})</label>`
  ).join('');

  const readCalendarIds = isEdit
    ? schedules.readCalendarIds || []
    : [];

  const readCalendarCheckboxes = calendars.map(c =>
    `<label><input type="checkbox" name="read_calendar_ids[]" value="${c.id}" ${readCalendarIds.includes(c.id) ? 'checked' : ''}> ${escapeHtml(c.email)} (${c.provider})</label>`
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

  const overrideSection = overridesHtml(overrides || []);

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
          <h1 class="floating-modal-title"><span class="floating-modal-dot"></span> ${escapeHtml(profile?.name || 'New Profile')}</h1>
          <span class="floating-modal-subtitle">One-on-One</span>
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
                <p class="modal-section-summary">${slugSummary}</p>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <div class="field-group">
                <span class="field-label">Slug</span>
                <input type="text" name="slug" value="${escapeHtml(profile?.slug || '')}" placeholder="my-meeting" required>
              </div>
              <div class="field-group">
                <span class="field-label">Display Name</span>
                <input type="text" name="name" value="${escapeHtml(profile?.name || '')}" placeholder="30 Min Meeting" required>
              </div>
            </div>
          </div>

          <!-- Duration & Buffer Section -->
          <div class="modal-section ${isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Duration & Buffer</h3>
                <p class="modal-section-summary">${bufferSummary}</p>
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
                <p class="modal-section-summary">${locationSummary}</p>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <div class="field-group">
                <span class="field-label">Meeting Link</span>
                <input type="url" name="meeting_link_url" value="${escapeHtml(profile?.meeting_link_url || '')}" placeholder="https://meet.google.com/abc-defg-hij">
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
                <p class="modal-section-summary">${calendarSummary}</p>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <div class="field-group">
                <span class="field-label">Write Calendars</span>
                <div class="checkbox-group">
                  ${writeCalendarCheckboxes || '<p style="color: var(--text-secondary); margin: 0; font-size: 0.875rem;">No calendar connections available.</p>'}
                </div>
              </div>
              <div class="field-group">
                <span class="field-label">Read Calendars</span>
                <div class="checkbox-group">
                  ${readCalendarCheckboxes || '<p style="color: var(--text-secondary); margin: 0; font-size: 0.875rem;">No connections. <a href="/admin/calendars">Connect</a></p>'}
                </div>
              </div>
            </div>
          </div>

          <!-- Availability Section -->
          <div class="modal-section ${isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Availability</h3>
                <p class="modal-section-summary">${availabilitySummary}</p>
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
                <p class="modal-section-summary">${overrideSummary}</p>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <table id="overrides-table" style="${overrides && overrides.length ? '' : 'display:none;'}">
                <thead><tr><th>Date</th><th>Type</th><th>Hours</th><th>Actions</th></tr></thead>
                <tbody id="overrides-tbody">${(overrides || []).map(o => {
                  const isBlocked = o.is_blocked ? 1 : 0;
                  const typeLabel = isBlocked ? 'Blocked' : 'Custom';
                  let rangesDisplay = '';
                  if (!isBlocked && o.custom_ranges) {
                    const ranges = JSON.parse(o.custom_ranges);
                    rangesDisplay = ranges.map(r => `${escapeHtml(r.start)} - ${escapeHtml(r.end)}`).join(', ');
                  }
                  return `<tr>
                    <td>
                      ${escapeHtml(o.date)}
                      <input type="hidden" name="override_dates[]" value="${escapeHtml(o.date)}">
                      <input type="hidden" name="override_is_blocked[]" value="${isBlocked}">
                      <input type="hidden" name="override_custom_ranges[]" value="${escapeHtml(o.custom_ranges || '')}">
                    </td>
                    <td>${typeLabel}</td>
                    <td>${rangesDisplay}</td>
                    <td><button type="button" class="danger outline remove-override-btn" style="padding: 4px 8px; font-size: 12px;">Delete</button></td>
                  </tr>`;
                }).join('')}</tbody>
              </table>
              <p id="no-overrides-msg" style="${overrides && overrides.length ? 'display:none;' : ''}">No overrides configured.</p>

              <div style="margin-top: 1rem; border: 1px solid var(--neutral-30); padding: 16px; border-radius: 8px; background: var(--neutral-10);">
                <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;">
                  <div style="display: flex; flex-direction: column;">
                    <span class="field-label">Date</span>
                    <input type="date" id="new_override_date" style="margin-bottom: 0; width: auto;">
                  </div>
                  <div style="display: flex; flex-direction: column;">
                    <span class="field-label">Type</span>
                    <select id="new_override_type" style="margin-bottom: 0; width: auto;">
                      <option value="blocked">Block entire day</option>
                      <option value="custom">Custom hours</option>
                    </select>
                  </div>
                  <div id="new_override_custom" style="display:none; gap: 8px; align-items: center;">
                    <input type="text" class="time-picker-override" id="new_override_start" value="09:00" style="width: 90px; margin-bottom: 0;">
                    <span>-</span>
                    <input type="text" class="time-picker-override" id="new_override_end" value="17:00" style="width: 90px; margin-bottom: 0;">
                  </div>
                  <button type="button" id="add-override-btn" class="outline" style="margin-bottom: 0; padding: 8px 16px; font-size: 0.8125rem;">Add</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Default Attendees Section -->
          <div class="modal-section ${isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Default Attendees</h3>
                <p class="modal-section-summary">${attendeeSummary}</p>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <div class="field-group">
                <span class="field-label">Emails</span>
                ${attendeeInputs}
              </div>
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
      function toggleSection(header) {
        const section = header.closest('.modal-section');
        section.classList.toggle('open');
      }

      (function() {
        flatpickr('.time-picker-override', { enableTime: true, noCalendar: true, dateFormat: "H:i", time_24hr: true });

        document.getElementById('new_override_type').addEventListener('change', (e) => {
          document.getElementById('new_override_custom').style.display = e.target.value === 'custom' ? 'flex' : 'none';
        });

        document.getElementById('overrides-tbody').addEventListener('click', (e) => {
          if (e.target.classList.contains('remove-override-btn')) {
            e.target.closest('tr').remove();
            if (document.querySelectorAll('#overrides-tbody tr').length === 0) {
              document.getElementById('overrides-table').style.display = 'none';
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

          const tbody = document.getElementById('overrides-tbody');
          const tr = document.createElement('tr');
          const typeLabel = isBlocked ? 'Blocked' : 'Custom';
          const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

          tr.innerHTML =
            '<td>' +
              escapeHtml(date) +
              '<input type="hidden" name="override_dates[]" value="' + escapeHtml(date) + '">' +
              '<input type="hidden" name="override_is_blocked[]" value="' + (isBlocked ? '1' : '0') + '">' +
              '<input type="hidden" name="override_custom_ranges[]" value="' + escapeHtml(customRangesStr) + '">' +
            '</td>' +
            '<td>' + typeLabel + '</td>' +
            '<td>' + rangesDisplay + '</td>' +
            '<td><button type="button" class="danger outline remove-override-btn" style="padding: 4px 8px; font-size: 12px;">Delete</button></td>';
          tbody.appendChild(tr);

          document.getElementById('overrides-table').style.display = '';
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
                const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                const ampm = h < 12 ? 'AM' : 'PM';
                const label = String(hour12).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ' ' + ampm;
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
    const profiles = app.db.prepare("SELECT * FROM booking_profiles ORDER BY created_at DESC").all();
    const baseUrl = `${request.protocol}://${request.hostname}${request.port && request.port !== 80 && request.port !== 443 ? ':' + request.port : ''}`;

    const rows = profiles.map(p => {
      const bookingUrl = `${baseUrl}/book/${escapeHtml(p.slug)}`;

      // Get schedule summary for display
      const schedules = app.db.prepare(
        "SELECT day_of_week, start_time, end_time FROM schedule_templates WHERE profile_id = ? ORDER BY day_of_week, start_time"
      ).all(p.id);

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
              30 min • ${p.meeting_tool === 'meet' ? 'Google Meet' : p.meeting_tool === 'teams' ? 'Microsoft Teams' : 'Phone call'} • One-on-One<br>
              <span style="color: var(--text-secondary);">${activeDays ? activeDays + ', ' + timeRange : 'No schedule set'}</span>
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
    `}).join('');

    const adminTimezone = process.env.ADMIN_TIMEZONE || 'UTC';
    const defaultSchedules = app.db.prepare(
      "SELECT day_of_week, start_time, end_time FROM default_schedule_templates ORDER BY day_of_week, start_time"
    ).all();

    const SHORT_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    function buildDefaultTimeDropdown(name, selectedValue, disabled) {
      const [h, m] = selectedValue.split(':').map(Number);
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h < 12 ? 'AM' : 'PM';
      const label = `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
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
            ${rows || `<div class="calendars-empty">
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

      <div id="profile-overlay" class="profile-overlay" style="display:none">
        <div class="profile-overlay-backdrop"></div>
        <div class="profile-overlay-panel">
          <div class="profile-overlay-content" id="profile-overlay-content"></div>
        </div>
      </div>

      <script>
        // Profile overlay logic
        (function() {
          var overlay = document.getElementById('profile-overlay');
          var content = document.getElementById('profile-overlay-content');

          function openOverlay(url) {
            overlay.style.display = 'flex';
            content.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:64px;"><i class="ph-bold ph-spinner loading" style="font-size:24px;opacity:0.5;"></i></div>';
            document.body.style.overflow = 'hidden';
            fetch(url)
              .then(function(res) { return res.text(); })
              .then(function(html) {
                content.innerHTML = html;
                // Execute scripts in the loaded content
                content.querySelectorAll('script').forEach(function(oldScript) {
                  var newScript = document.createElement('script');
                  newScript.textContent = oldScript.textContent;
                  oldScript.parentNode.replaceChild(newScript, oldScript);
                });
                // Re-init time pickers if available
                if (window.initTimePickers) window.initTimePickers();
              });
          }

          function closeOverlay() {
            overlay.style.display = 'none';
            content.innerHTML = '';
            document.body.style.overflow = '';
          }

          // Open triggers
          document.addEventListener('click', function(e) {
            var trigger = e.target.closest('.profile-overlay-trigger');
            if (trigger) {
              e.preventDefault();
              // Close any open dropdown menus
              document.querySelectorAll('.dropdown-menu').forEach(function(m) { m.style.display = 'none'; });
              openOverlay(trigger.dataset.url);
            }
          });

          // Close on backdrop click
          overlay.querySelector('.profile-overlay-backdrop').addEventListener('click', closeOverlay);

          // Close on Cancel button clicks inside overlay
          document.addEventListener('click', function(e) {
            if (e.target.closest('#profile-overlay') && e.target.closest('a[href="/admin/profiles"]')) {
              e.preventDefault();
              closeOverlay();
            }
          });

          // Intercept form submission inside overlay
          document.addEventListener('submit', function(e) {
            var form = e.target;
            if (!form.closest('#profile-overlay')) return;
            if (form.id === 'delete-profile-form') return; // Let delete go through normally
            e.preventDefault();
            var formData = new FormData(form);
            fetch(form.action + (form.action.includes('?') ? '&' : '?') + 'partial=1', {
              method: 'POST',
              body: new URLSearchParams(formData),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              redirect: 'manual'
            }).then(function(res) {
              if (res.status === 0 || res.type === 'opaqueredirect' || res.status === 302 || res.status === 303) {
                closeOverlay();
                window.location.reload();
              } else {
                return res.text();
              }
            }).then(function(html) {
              if (html) {
                content.innerHTML = html;
                content.querySelectorAll('script').forEach(function(oldScript) {
                  var newScript = document.createElement('script');
                  newScript.textContent = oldScript.textContent;
                  oldScript.parentNode.replaceChild(newScript, oldScript);
                });
                if (window.initTimePickers) window.initTimePickers();
              }
            });
          });

          window.ProfileOverlay = { open: openOverlay, close: closeOverlay };
        })();

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
        window.TimeDropdown = window.TimeDropdown || {
          timeSlots: (function() {
            const slots = [];
            for (let h = 0; h < 24; h++) {
              for (let m = 0; m < 60; m += 15) {
                const val = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
                const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                const ampm = h < 12 ? 'AM' : 'PM';
                const label = String(hour12).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ' ' + ampm;
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
    const adminTimezone = process.env.ADMIN_TIMEZONE || 'UTC';
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

    app.db.prepare("DELETE FROM default_schedule_templates").run();
    const insert = app.db.prepare("INSERT INTO default_schedule_templates (day_of_week, start_time, end_time) VALUES (?, ?, ?)");
    for (const entry of entries) {
      insert.run(entry.day_of_week, entry.start_time, entry.end_time);
    }

    return reply.redirect('/admin/profiles');
  });

  app.get('/profiles/new', async (request, reply) => {
    const token = reply.generateCsrf();
    const calendars = app.db.prepare("SELECT * FROM calendar_connections WHERE status = 'connected'").all();
    const adminTimezone = process.env.ADMIN_TIMEZONE || 'UTC';
    const defaultTemplates = app.db.prepare(
      "SELECT day_of_week, start_time, end_time FROM default_schedule_templates ORDER BY day_of_week, start_time"
    ).all();
    const html = profileFormHtml(token, null, calendars, [], { templates: defaultTemplates, readCalendarIds: [] }, null, [], adminTimezone);
    if (request.query.partial === '1') {
      return reply.type('text/html').send(html);
    }
    reply.type('text/html').send(require('./app').BASE_LAYOUT('New Profile', html, true, 'profiles'));
  });

  app.post('/profiles', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { slug, name, meeting_link_url, meeting_tool } = request.body || {};

    if (!slug || !SLUG_REGEX.test(slug)) {
      const token = reply.generateCsrf();
      const calendars = app.db.prepare("SELECT * FROM calendar_connections WHERE status = 'connected'").all();
      const html = profileFormHtml(token, null, calendars, [], { templates: [], readCalendarIds: [] }, 'Slug must be lowercase alphanumeric and hyphens only.');
      if (request.query.partial === '1') return reply.type('text/html').send(html);
      return reply.type('text/html').send(require('./app').BASE_LAYOUT('New Profile', html, true, 'profiles'));
    }

    const existing = app.db.prepare("SELECT id FROM booking_profiles WHERE slug = ?").get(slug);
    if (existing) {
      const token = reply.generateCsrf();
      const calendars = app.db.prepare("SELECT * FROM calendar_connections WHERE status = 'connected'").all();
      const html = profileFormHtml(token, null, calendars, [], { templates: [], readCalendarIds: [] }, 'That slug already exists. Please choose a different one.');
      if (request.query.partial === '1') return reply.type('text/html').send(html);
      return reply.type('text/html').send(require('./app').BASE_LAYOUT('New Profile', html, true, 'profiles'));
    }

    const buffer_time_minutes = parseInt(request.body.buffer_time_minutes, 10) || 0;

    const result = app.db.prepare(
      "INSERT INTO booking_profiles (slug, name, is_active, write_calendar_id, meeting_link_url, meeting_tool, buffer_time_minutes, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)"
    ).run(slug, name, null, meeting_link_url || null, meeting_tool || null, buffer_time_minutes, new Date().toISOString());

    const profileId = result.lastInsertRowid;

    const attendees = parseAttendeesFromBody(request.body);
    const insertAttendee = app.db.prepare("INSERT INTO default_attendees (profile_id, email) VALUES (?, ?)");
    for (const email of attendees) {
      insertAttendee.run(profileId, email);
    }

    const adminTimezone = process.env.ADMIN_TIMEZONE || 'UTC';
    let scheduleEntries = parseScheduleFromBody(request.body, adminTimezone);
    if (scheduleEntries.length === 0) {
      scheduleEntries = app.db.prepare(
        "SELECT day_of_week, start_time, end_time FROM default_schedule_templates ORDER BY day_of_week, start_time"
      ).all();
    }
    const insertSchedule = app.db.prepare("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)");
    for (const entry of scheduleEntries) {
      insertSchedule.run(profileId, entry.day_of_week, entry.start_time, entry.end_time);
    }

    const readCalIds = request.body['read_calendar_ids[]'];
    if (readCalIds) {
      const ids = Array.isArray(readCalIds) ? readCalIds : [readCalIds];
      const insertRead = app.db.prepare("INSERT INTO profile_read_calendars (profile_id, calendar_connection_id) VALUES (?, ?)");
      for (const cid of ids) {
        insertRead.run(profileId, Number(cid));
      }
    }

    const writeCalIds = request.body['write_calendar_ids[]'];
    if (writeCalIds) {
      const wIds = Array.isArray(writeCalIds) ? writeCalIds : [writeCalIds];
      const insertWrite = app.db.prepare("INSERT INTO profile_write_calendars (profile_id, calendar_connection_id) VALUES (?, ?)");
      for (const cid of wIds) {
        insertWrite.run(profileId, Number(cid));
      }
    }

    const overrides = parseOverridesFromBody(request.body);
    const insertOverride = app.db.prepare("INSERT INTO schedule_overrides (profile_id, date, is_blocked, custom_ranges) VALUES (?, ?, ?, ?)");
    for (const o of overrides) {
      insertOverride.run(profileId, o.date, o.is_blocked, o.custom_ranges);
    }

    return reply.redirect('/admin/profiles');
  });

  app.get('/profiles/:id/edit', async (request, reply) => {
    const { id } = request.params;
    const profile = app.db.prepare("SELECT * FROM booking_profiles WHERE id = ?").get(id);
    if (!profile) {
      return reply.code(404).type('text/html').send(require('./app').BASE_LAYOUT('Not Found', '<h1>Profile not found</h1>'));
    }

    const token = reply.generateCsrf();
    const calendars = app.db.prepare("SELECT * FROM calendar_connections WHERE status = 'connected'").all();
    const attendees = app.db.prepare("SELECT email FROM default_attendees WHERE profile_id = ?").all(profile.id).map(a => a.email);
    const templates = app.db.prepare("SELECT * FROM schedule_templates WHERE profile_id = ? ORDER BY day_of_week, start_time").all(profile.id);
    const readCalendarIds = app.db.prepare("SELECT calendar_connection_id FROM profile_read_calendars WHERE profile_id = ?").all(profile.id).map(r => r.calendar_connection_id);
    const writeCalendarIds = app.db.prepare("SELECT calendar_connection_id FROM profile_write_calendars WHERE profile_id = ?").all(profile.id).map(r => r.calendar_connection_id);
    const overrides = app.db.prepare("SELECT * FROM schedule_overrides WHERE profile_id = ? ORDER BY date").all(profile.id);
    const adminTimezone = process.env.ADMIN_TIMEZONE || 'UTC';

    const html = profileFormHtml(token, profile, calendars, attendees, { templates, readCalendarIds, writeCalendarIds }, null, overrides, adminTimezone);
    if (request.query.partial === '1') {
      return reply.type('text/html').send(html);
    }
    reply.type('text/html').send(require('./app').BASE_LAYOUT('Edit Profile', html, true, 'profiles'));
  });

  app.post('/profiles/:id', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { id } = request.params;
    const profile = app.db.prepare("SELECT * FROM booking_profiles WHERE id = ?").get(id);
    if (!profile) {
      return reply.code(404).type('text/html').send(require('./app').BASE_LAYOUT('Not Found', '<h1>Profile not found</h1>'));
    }

    const { slug, name, meeting_link_url, meeting_tool } = request.body || {};
    const buffer_time_minutes = parseInt(request.body.buffer_time_minutes, 10) || 0;

    if (!slug || !SLUG_REGEX.test(slug)) {
      const token = reply.generateCsrf();
      const calendars = app.db.prepare("SELECT * FROM calendar_connections WHERE status = 'connected'").all();
      const attendees = app.db.prepare("SELECT email FROM default_attendees WHERE profile_id = ?").all(profile.id).map(a => a.email);
      const templates = app.db.prepare("SELECT * FROM schedule_templates WHERE profile_id = ?").all(profile.id);
      const html = profileFormHtml(token, profile, calendars, attendees, { templates, readCalendarIds: [] }, 'Slug must be lowercase alphanumeric and hyphens only.');
      if (request.query.partial === '1') return reply.type('text/html').send(html);
      return reply.type('text/html').send(require('./app').BASE_LAYOUT('Edit Profile', html, true, 'profiles'));
    }

    const existing = app.db.prepare("SELECT id FROM booking_profiles WHERE slug = ? AND id != ?").get(slug, id);
    if (existing) {
      const token = reply.generateCsrf();
      const calendars = app.db.prepare("SELECT * FROM calendar_connections WHERE status = 'connected'").all();
      const attendees = app.db.prepare("SELECT email FROM default_attendees WHERE profile_id = ?").all(profile.id).map(a => a.email);
      const templates = app.db.prepare("SELECT * FROM schedule_templates WHERE profile_id = ?").all(profile.id);
      const html = profileFormHtml(token, profile, calendars, attendees, { templates, readCalendarIds: [] }, 'That slug already exists.');
      if (request.query.partial === '1') return reply.type('text/html').send(html);
      return reply.type('text/html').send(require('./app').BASE_LAYOUT('Edit Profile', html, true, 'profiles'));
    }

    app.db.prepare(
      "UPDATE booking_profiles SET slug = ?, name = ?, write_calendar_id = ?, meeting_link_url = ?, meeting_tool = ?, buffer_time_minutes = ? WHERE id = ?"
    ).run(slug, name, null, meeting_link_url || null, meeting_tool || null, buffer_time_minutes, id);

    // Replace attendees
    app.db.prepare("DELETE FROM default_attendees WHERE profile_id = ?").run(id);
    const attendees = parseAttendeesFromBody(request.body);
    const insertAttendee = app.db.prepare("INSERT INTO default_attendees (profile_id, email) VALUES (?, ?)");
    for (const email of attendees) {
      insertAttendee.run(id, email);
    }

    // Replace schedule templates
    app.db.prepare("DELETE FROM schedule_templates WHERE profile_id = ?").run(id);
    const adminTimezone = process.env.ADMIN_TIMEZONE || 'UTC';
    const scheduleEntries = parseScheduleFromBody(request.body, adminTimezone);
    const insertSchedule = app.db.prepare("INSERT INTO schedule_templates (profile_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)");
    for (const entry of scheduleEntries) {
      insertSchedule.run(id, entry.day_of_week, entry.start_time, entry.end_time);
    }

    // Replace read calendars
    app.db.prepare("DELETE FROM profile_read_calendars WHERE profile_id = ?").run(id);
    const readCalIds = request.body['read_calendar_ids[]'];
    if (readCalIds) {
      const ids = Array.isArray(readCalIds) ? readCalIds : [readCalIds];
      const insertRead = app.db.prepare("INSERT INTO profile_read_calendars (profile_id, calendar_connection_id) VALUES (?, ?)");
      for (const cid of ids) {
        insertRead.run(id, Number(cid));
      }
    }

    // Replace write calendars
    app.db.prepare("DELETE FROM profile_write_calendars WHERE profile_id = ?").run(id);
    const writeCalIds = request.body['write_calendar_ids[]'];
    if (writeCalIds) {
      const wIds = Array.isArray(writeCalIds) ? writeCalIds : [writeCalIds];
      const insertWrite = app.db.prepare("INSERT INTO profile_write_calendars (profile_id, calendar_connection_id) VALUES (?, ?)");
      for (const cid of wIds) {
        insertWrite.run(id, Number(cid));
      }
    }

    app.db.prepare("DELETE FROM schedule_overrides WHERE profile_id = ?").run(id);
    const overrides = parseOverridesFromBody(request.body);
    const insertOverride = app.db.prepare("INSERT INTO schedule_overrides (profile_id, date, is_blocked, custom_ranges) VALUES (?, ?, ?, ?)");
    for (const o of overrides) {
      insertOverride.run(id, o.date, o.is_blocked, o.custom_ranges);
    }

    return reply.redirect('/admin/profiles');
  });



  app.post('/profiles/:id/toggle', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { id } = request.params;
    app.db.prepare("UPDATE booking_profiles SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?").run(id);
    return reply.redirect('/admin/profiles');
  });

  app.post('/profiles/:id/delete', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { id } = request.params;
    const profile = app.db.prepare("SELECT * FROM booking_profiles WHERE id = ?").get(id);
    if (!profile) {
      return reply.code(404).type('text/html').send(require('./app').BASE_LAYOUT('Not Found', '<h1>Profile not found</h1>'));
    }
    app.db.prepare("DELETE FROM booking_profiles WHERE id = ?").run(id);
    return reply.redirect('/admin/profiles');
  });
}

module.exports = { registerProfileRoutes };
