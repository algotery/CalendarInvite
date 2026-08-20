const { decrypt } = require('../encryption');
const { refreshAccessToken: refreshGoogleToken } = require('../google');
const { createMicrosoftClient } = require('../microsoft');
const { getZohoClient } = require('../zoho');

const CALENDAR_API_TIMEOUT_MS = 8000;

function fetchWithTimeout(fetchFn, url, options, timeoutMs = CALENDAR_API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchFn(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function getValidTokenForConnection(db, encryptionKey, connection) {
  const expiry = new Date(connection.token_expiry || 0);
  if (expiry > new Date()) {
    try {
      return decrypt(connection.encrypted_access_token, encryptionKey);
    } catch {
      return connection.encrypted_access_token;
    }
  }

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

async function getCalendarBusySlots(db, encryptionKey, profileId, dateStr, fetchFn) {
  const readCalendars = await db.getAll(
    "SELECT cc.* FROM profile_read_calendars prc JOIN calendar_connections cc ON prc.calendar_connection_id = cc.id WHERE prc.profile_id = $1 AND cc.status = 'connected'",
    [profileId]
  );

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

async function createCalendarEvent(fetchFn, db, encryptionKey, connection, eventData) {
  const accessToken = await getValidTokenForConnection(db, encryptionKey, connection);

  if (connection.provider === 'google') {
    const event = { summary: eventData.title, description: eventData.description || '', start: { dateTime: eventData.start }, end: { dateTime: eventData.end }, attendees: eventData.attendees.map(email => ({ email })) };
    const response = await fetchFn('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
    if (!response.ok) { const errText = await response.text(); throw new Error(`Google event creation failed: ${errText}`); }
    const data = await response.json();
    return data.id;
  } else if (connection.provider === 'microsoft') {
    const body = { subject: eventData.title, start: { dateTime: eventData.start, timeZone: 'UTC' }, end: { dateTime: eventData.end, timeZone: 'UTC' }, attendees: eventData.attendees.map(email => ({ emailAddress: { address: email }, type: 'required' })), body: { contentType: 'Text', content: eventData.description || '' } };
    const response = await fetchFn('https://graph.microsoft.com/v1.0/me/events', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Microsoft event creation failed');
    const data = await response.json();
    return data.id;
  } else if (connection.provider === 'zoho') {
    const calendarsResponse = await fetchFn('https://calendar.zoho.com/api/v1/calendars', { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    const calendarsData = await calendarsResponse.json();
    const primaryCalendar = calendarsData.calendars.find(c => c.isprimary) || calendarsData.calendars[0];
    const calendarUid = primaryCalendar.uid;
    const pad = n => String(n).padStart(2, '0');
    const formatZoho = (isoStr) => { const d = new Date(isoStr); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}+0000`; };
    const zohoBody = { eventdata: { title: eventData.title, description: eventData.description || '', start: formatZoho(eventData.start), end: formatZoho(eventData.end), attendees: eventData.attendees.map(email => ({ email })) } };
    const response = await fetchFn(`https://calendar.zoho.com/api/v1/calendars/${calendarUid}/events`, { method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(zohoBody) });
    if (!response.ok) throw new Error('Zoho event creation failed');
    const result = await response.json();
    return result.events[0].uid;
  }

  throw new Error(`Unsupported provider: ${connection.provider}`);
}

async function deleteCalendarEvent(fetchFn, db, encryptionKey, connection, calendarEventId) {
  let accessToken;
  try { accessToken = decrypt(connection.encrypted_access_token, encryptionKey); } catch { accessToken = connection.encrypted_access_token; }

  if (connection.provider === 'google') {
    await fetchFn(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${calendarEventId}?sendUpdates=all`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
  } else if (connection.provider === 'microsoft') {
    await fetchFn(`https://graph.microsoft.com/v1.0/me/events/${calendarEventId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
  } else if (connection.provider === 'zoho') {
    const calendarsResponse = await fetchFn('https://calendar.zoho.com/api/v1/calendars', { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    const calendarsData = await calendarsResponse.json();
    const primaryCalendar = calendarsData.calendars.find(c => c.isprimary) || calendarsData.calendars[0];
    await fetchFn(`https://calendar.zoho.com/api/v1/calendars/${primaryCalendar.uid}/events/${calendarEventId}`, { method: 'DELETE', headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
  }
}

module.exports = {
  getValidTokenForConnection,
  getCalendarBusySlots,
  createCalendarEvent,
  deleteCalendarEvent,
  fetchWithTimeout,
  CALENDAR_API_TIMEOUT_MS,
};
