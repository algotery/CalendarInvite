const { escapeHtml } = require('../utils/html');
const { convertUTCToLocalTime } = require('../utils/time');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];


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
              <div class="avatar-upload-section" ${!isEdit ? 'data-new-profile="1"' : ''}>
                <div class="avatar-upload-container" id="avatar-upload-container">
                  <div class="avatar-preview" id="avatar-preview">
                    ${isEdit && profile.avatar_url
                      ? `<img src="${escapeHtml(profile.avatar_url)}" alt="Profile logo" class="avatar-preview-img" id="avatar-img">`
                      : `<div class="avatar-placeholder" id="avatar-placeholder"><i class="ph-bold ph-image"></i><span>Upload Logo</span></div>`
                    }
                    <div class="avatar-upload-overlay" id="avatar-overlay">
                      <i class="ph-bold ph-upload-simple"></i>
                      <span>${isEdit ? 'Change' : 'Upload'}</span>
                    </div>
                  </div>
                  <input type="file" id="avatar-file-input" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml" style="display:none">
                </div>
                <div class="avatar-upload-info">
                  <span class="avatar-upload-label">Profile Logo</span>
                  <span class="avatar-upload-hint">Recommended: 400×100px or similar ratio, max 5MB</span>
                  ${isEdit && profile.avatar_url ? `<button type="button" class="avatar-remove-btn" id="avatar-remove-btn"><i class="ph ph-trash"></i> Remove</button>` : ''}
                </div>
              </div>
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

          <!-- Duration Section -->
          <div class="modal-section ${isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Meeting Duration</h3>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <div class="field-group">
                <span class="field-label">Duration Options</span>
                <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 12px 0;">Add up to 5 duration options visitors can choose from when booking.</p>
                <div class="duration-chips-container" id="duration-chips-container">
                  <div class="duration-chips" id="duration-chips">
                    ${(() => {
                      let durations = [30, 45, 60];
                      try { durations = JSON.parse(profile?.allowed_durations || '[30,45,60]'); } catch(e) {}
                      return durations.map(d => `
                        <div class="duration-chip" data-value="${d}">
                          <input type="hidden" name="allowed_durations[]" value="${d}">
                          <span class="duration-chip-label">${d} min</span>
                          <button type="button" class="duration-chip-remove" onclick="removeDurationChip(this)">
                            <i class="ph-bold ph-x"></i>
                          </button>
                        </div>
                      `).join('');
                    })()}
                  </div>
                  <div class="duration-add-row" id="duration-add-row">
                    <div class="duration-add-input-wrap">
                      <input type="number" id="new-duration-input" min="5" max="480" step="5" placeholder="Minutes">
                      <span class="duration-add-suffix">min</span>
                    </div>
                    <button type="button" class="duration-add-btn" id="add-duration-btn">
                      <i class="ph-bold ph-plus"></i> Add
                    </button>
                  </div>
                  <p class="duration-chips-hint" id="duration-limit-msg" style="display: none;">Maximum 5 duration options reached.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Buffer Section -->
          <div class="modal-section ${isEdit ? 'open' : ''}">
            <div class="modal-section-header" onclick="toggleSection(this)">
              <div>
                <h3 class="modal-section-title">Buffer Time</h3>
              </div>
              <i class="ph-bold ph-caret-down modal-section-chevron"></i>
            </div>
            <div class="modal-section-content">
              <div class="field-group">
                <span class="field-label">Time between meetings</span>
                <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                  <div class="duration-add-input-wrap">
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
                        class="buffer-preset-btn${(profile?.buffer_time_minutes ?? 0) == v ? ' active' : ''}">
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
              <div class="field-group">
                <span class="field-label">Meeting Tool</span>
                <div class="meeting-tool-select-wrapper">
                  <select name="meeting_tool" id="meeting-tool-select" class="meeting-tool-select">
                    <option value=""${!profile?.meeting_tool ? ' selected' : ''}>None</option>
                    <option value="meet"${profile?.meeting_tool === 'meet' ? ' selected' : ''}>Google Meet</option>
                    <option value="teams"${profile?.meeting_tool === 'teams' ? ' selected' : ''}>Microsoft Teams</option>
                  </select>
                  <i class="ph-bold ph-caret-down meeting-tool-select-icon"></i>
                </div>
              </div>
              <div class="float-field" id="meeting-link-field" style="${profile?.meeting_tool ? '' : 'display:none;'}">
                <input type="url" name="meeting_link_url" value="${escapeHtml(profile?.meeting_link_url || '')}" placeholder=" ">
                <label>Meeting Link (optional)</label>
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

      // Avatar upload
      (function() {
        var container = document.getElementById('avatar-upload-container');
        if (!container) return;
        var fileInput = document.getElementById('avatar-file-input');
        var preview = document.getElementById('avatar-preview');
        var overlay = document.getElementById('avatar-overlay');
        var removeBtn = document.getElementById('avatar-remove-btn');
        var profileId = '${isEdit ? profile.id : ''}';
        var isNewProfile = !profileId;
        var pendingFile = null;

        if (isNewProfile) {
          container.addEventListener('click', function() { fileInput.click(); });
          fileInput.addEventListener('change', function() {
            if (!fileInput.files.length) return;
            var file = fileInput.files[0];
            if (file.size > 5 * 1024 * 1024) { Toast.show('File too large. Maximum 5MB.', 'error'); return; }
            if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) { Toast.show('Invalid file type.', 'error'); return; }
            pendingFile = file;
            var reader = new FileReader();
            reader.onload = function(e) {
              preview.innerHTML = '<img src="' + e.target.result + '" alt="Profile logo" class="avatar-preview-img" id="avatar-img">' +
                '<div class="avatar-upload-overlay" id="avatar-overlay"><i class="ph-bold ph-upload-simple"></i><span>Change</span></div>';
            };
            reader.readAsDataURL(file);
          });

          container.addEventListener('dragover', function(e) { e.preventDefault(); container.classList.add('dragover'); });
          container.addEventListener('dragleave', function() { container.classList.remove('dragover'); });
          container.addEventListener('drop', function(e) {
            e.preventDefault();
            container.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
              fileInput.files = e.dataTransfer.files;
              fileInput.dispatchEvent(new Event('change'));
            }
          });

          // Intercept form submit for new profiles
          var form = document.getElementById('profile-form');
          form.addEventListener('submit', function(e) {
            if (!pendingFile) return; // let normal submit happen
            e.preventDefault();
            var formData = new FormData(form);
            var submitBtn = form.querySelector('button[type="submit"], .floating-modal-footer .btn-primary');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }

            fetch(form.action + (form.action.includes('?') ? '&' : '?') + 'partial=1', {
              method: 'POST',
              headers: { 'Accept': 'application/json' },
              body: new URLSearchParams(formData)
            })
            .then(function(res) { return res.json(); })
            .then(function(data) {
              if (!data.success || !data.profileId) {
                Toast.show(data.error || 'Failed to create profile.', 'error');
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create'; }
                return;
              }
              var avatarData = new FormData();
              avatarData.append('file', pendingFile);
              return fetch('/admin/profiles/' + data.profileId + '/avatar', { method: 'POST', body: avatarData })
                .then(function() { window.location.href = '/admin/profiles'; });
            })
            .catch(function() {
              Toast.show('Something went wrong.', 'error');
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create'; }
            });
          });
          return;
        }

        container.addEventListener('click', function() { fileInput.click(); });

        container.addEventListener('dragover', function(e) {
          e.preventDefault();
          container.classList.add('dragover');
        });
        container.addEventListener('dragleave', function() {
          container.classList.remove('dragover');
        });
        container.addEventListener('drop', function(e) {
          e.preventDefault();
          container.classList.remove('dragover');
          if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
        });

        fileInput.addEventListener('change', function() {
          if (fileInput.files.length) uploadFile(fileInput.files[0]);
        });

        function uploadFile(file) {
          if (file.size > 5 * 1024 * 1024) {
            Toast.show('File too large. Maximum 5MB.', 'error');
            return;
          }
          if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
            Toast.show('Invalid file type. Use JPEG, PNG, WebP or GIF.', 'error');
            return;
          }

          container.classList.add('uploading');
          var formData = new FormData();
          formData.append('file', file);

          fetch('/admin/profiles/' + profileId + '/avatar', {
            method: 'POST',
            body: formData
          })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            container.classList.remove('uploading');
            if (data.error) {
              Toast.show(data.error, 'error');
              return;
            }
            var img = document.getElementById('avatar-img');
            if (img) {
              img.src = data.avatar_url + '?t=' + Date.now();
            } else {
              preview.innerHTML = '<img src="' + data.avatar_url + '?t=' + Date.now() + '" alt="Profile avatar" class="avatar-preview-img" id="avatar-img">' +
                '<div class="avatar-upload-overlay" id="avatar-overlay"><i class="ph-bold ph-camera"></i></div>';
            }
            container.classList.add('upload-success');
            setTimeout(function() { container.classList.remove('upload-success'); }, 1200);

            if (!document.getElementById('avatar-remove-btn')) {
              var info = container.parentElement.querySelector('.avatar-upload-info');
              var btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'avatar-remove-btn';
              btn.id = 'avatar-remove-btn';
              btn.innerHTML = '<i class="ph ph-trash"></i> Remove';
              btn.addEventListener('click', handleRemove);
              info.appendChild(btn);
            }
          })
          .catch(function() {
            container.classList.remove('uploading');
            Toast.show('Upload failed. Please try again.', 'error');
          });
        }

        function handleRemove(e) {
          e.stopPropagation();
          fetch('/admin/profiles/' + profileId + '/avatar/delete', { method: 'POST' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.success) {
              preview.innerHTML = '<div class="avatar-placeholder" id="avatar-placeholder"><i class="ph-bold ph-user"></i></div>' +
                '<div class="avatar-upload-overlay" id="avatar-overlay"><i class="ph-bold ph-camera"></i></div>';
              var btn = document.getElementById('avatar-remove-btn');
              if (btn) btn.remove();
            }
          });
        }

        if (removeBtn) removeBtn.addEventListener('click', handleRemove);
      })();

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

      // Meeting tool selection
      (function() {
        var select = document.getElementById('meeting-tool-select');
        var linkField = document.getElementById('meeting-link-field');
        if (!select) return;
        select.addEventListener('change', function() {
          if (select.value) {
            linkField.style.display = '';
          } else {
            linkField.style.display = 'none';
          }
        });
      })();

      // Duration chips management
      function removeDurationChip(btn) {
        const chip = btn.closest('.duration-chip');
        const container = document.getElementById('duration-chips');
        chip.style.transform = 'scale(0.8)';
        chip.style.opacity = '0';
        setTimeout(function() {
          chip.remove();
          updateDurationUI();
        }, 150);
      }

      function updateDurationUI() {
        const chips = document.querySelectorAll('.duration-chip');
        const addRow = document.getElementById('duration-add-row');
        const limitMsg = document.getElementById('duration-limit-msg');
        if (chips.length >= 5) {
          addRow.style.display = 'none';
          limitMsg.style.display = 'block';
        } else {
          addRow.style.display = 'flex';
          limitMsg.style.display = 'none';
        }
      }

      document.getElementById('add-duration-btn').addEventListener('click', function() {
        const input = document.getElementById('new-duration-input');
        const value = parseInt(input.value, 10);
        if (!value || value < 5 || value > 480) {
          input.style.borderColor = 'var(--error)';
          setTimeout(function() { input.style.borderColor = ''; }, 800);
          return;
        }

        const existing = document.querySelectorAll('.duration-chip');
        if (existing.length >= 5) return;

        for (var i = 0; i < existing.length; i++) {
          if (parseInt(existing[i].dataset.value) === value) {
            existing[i].style.transform = 'scale(1.05)';
            setTimeout(function() { existing[i].style.transform = ''; }, 200);
            input.value = '';
            return;
          }
        }

        const chip = document.createElement('div');
        chip.className = 'duration-chip';
        chip.dataset.value = value;
        chip.style.opacity = '0';
        chip.style.transform = 'scale(0.8)';
        chip.innerHTML = '<input type="hidden" name="allowed_durations[]" value="' + value + '">' +
          '<span class="duration-chip-label">' + value + ' min</span>' +
          '<button type="button" class="duration-chip-remove" onclick="removeDurationChip(this)"><i class="ph-bold ph-x"></i></button>';

        document.getElementById('duration-chips').appendChild(chip);
        requestAnimationFrame(function() {
          chip.style.transition = 'opacity 0.2s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
          chip.style.opacity = '1';
          chip.style.transform = 'scale(1)';
        });

        input.value = '';
        updateDurationUI();
      });

      document.getElementById('new-duration-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('add-duration-btn').click();
        }
      });

      updateDurationUI();

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
            if (container.querySelectorAll('.time-range').length >= 10) {
              Toast.show('Maximum 10 time ranges per day', 'warning');
              return;
            }
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

module.exports = { profileFormHtml, DAYS };
