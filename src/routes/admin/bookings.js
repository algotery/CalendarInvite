const { escapeHtml } = require('../../utils/html');
const { BASE_LAYOUT } = require('../../views/layout');
const { decrypt } = require('../../encryption');
const { getBatchedBookings } = require('../../performance-fixes');

function registerBookingsRoutes(app, { encryptionKey }) {
    app.get('/bookings', async (request, reply) => {
      const token = reply.generateCsrf();
      const adminId = request.session.get('adminId');
      const admin = await app.db.getOne('SELECT timezone, time_format FROM admin WHERE id = $1', [adminId]);
      const adminTz = admin ? admin.timezone : 'UTC';
      const adminTimeFormat = admin ? (admin.time_format || '12h') : '12h';

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
      const formatterTime = new Intl.DateTimeFormat('en-US', { timeZone: adminTz, hour: '2-digit', minute: '2-digit', hour12: adminTimeFormat !== '24h' });

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
}

module.exports = { registerBookingsRoutes };
