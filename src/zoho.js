const { encrypt, decrypt } = require('./encryption');

function getZohoClient({ db, encryptionKey, clientId, clientSecret, fetchFn }) {
  const fetcher = fetchFn || globalThis.fetch;

  async function getAccessToken(connectionId) {
    const conn = await db.getOne('SELECT * FROM calendar_connections WHERE id = $1', [connectionId]);
    if (!conn) throw new Error(`Connection ${connectionId} not found`);

    const now = new Date();
    const expiry = conn.token_expiry ? new Date(conn.token_expiry) : new Date(0);

    if (now < expiry) {
      return decrypt(conn.encrypted_access_token, encryptionKey);
    }

    const accountsServer = conn.accounts_server || 'https://accounts.zoho.com';
    const refreshToken = decrypt(conn.encrypted_refresh_token, encryptionKey);
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    const response = await fetcher(`${accountsServer}/oauth/v2/token?${params}`, {
      method: 'POST',
    });

    if (!response.ok) {
      await db.run('UPDATE calendar_connections SET status = $1 WHERE id = $2', ['expired', connectionId]);
      throw new Error('Failed to refresh Zoho token');
    }

    const data = await response.json();
    const expiresIn = data.expires_in || 3600;
    const newExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

    await db.run(
      'UPDATE calendar_connections SET encrypted_access_token = $1, token_expiry = $2, status = $3 WHERE id = $4',
      [encrypt(data.access_token, encryptionKey), newExpiry, 'connected', connectionId]
    );

    return data.access_token;
  }

  function getCalendarBaseUrl(conn) {
    const server = conn.accounts_server || 'https://accounts.zoho.com';
    const domain = server.replace('https://accounts.', '');
    return `https://calendar.${domain}`;
  }

  async function getBusySlots(connectionId, timeMin, timeMax) {
    const conn = await db.getOne('SELECT * FROM calendar_connections WHERE id = $1', [connectionId]);
    if (!conn) throw new Error(`Connection ${connectionId} not found`);
    const calendarBase = getCalendarBaseUrl(conn);
    const accessToken = await getAccessToken(connectionId);

    const params = new URLSearchParams({
      stime: timeMin,
      etime: timeMax,
    });

    const response = await fetcher(
      `${calendarBase}/api/v1/calendars/freebusy?${params}`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      }
    );

    if (!response.ok) throw new Error('Failed to fetch busy slots from Zoho');

    const data = await response.json();
    const fbData = data.fb_data || [];

    return fbData
      .filter(slot => slot.fbtype === 'busy')
      .map(slot => ({
        start: parseZohoDateTime(slot.s_datetime),
        end: parseZohoDateTime(slot.e_datetime),
      }));
  }

  async function createEvent(connectionId, eventData) {
    const conn = await db.getOne('SELECT * FROM calendar_connections WHERE id = $1', [connectionId]);
    if (!conn) throw new Error(`Connection ${connectionId} not found`);
    const calendarBase = getCalendarBaseUrl(conn);
    const accessToken = await getAccessToken(connectionId);

    const calendarsResponse = await fetcher(
      `${calendarBase}/api/v1/calendars`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );
    const calendarsData = await calendarsResponse.json();
    const primaryCalendar = calendarsData.calendars.find(c => c.isdefault) || calendarsData.calendars[0];
    const calendarUid = primaryCalendar.uid;

    const attendees = (eventData.attendees || []).map(email => ({ email }));

    const body = {
      eventdata: {
        title: eventData.title,
        description: eventData.description || '',
        start: formatZohoDateTime(eventData.start),
        end: formatZohoDateTime(eventData.end),
        attendees,
      },
    };

    const response = await fetcher(
      `${calendarBase}/api/v1/calendars/${calendarUid}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) throw new Error('Failed to create Zoho calendar event');

    const result = await response.json();
    return result.events[0].uid;
  }

  return { getAccessToken, getBusySlots, createEvent };
}

function parseZohoDateTime(dateStr) {
  const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{4})$/);
  if (!match) return dateStr;
  const [, year, month, day, hour, minute, second, tz] = match;
  const tzSign = tz[0] === '+' ? '+' : '-';
  const tzHours = tz.slice(1, 3);
  const tzMinutes = tz.slice(3);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${tzSign}${tzHours}:${tzMinutes}`;
}

function formatZohoDateTime(isoStr) {
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}+0000`;
}

module.exports = { getZohoClient };
