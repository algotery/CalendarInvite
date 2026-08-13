const { encrypt, decrypt } = require('./encryption');

function createMicrosoftClient({ db, encryptionKey, clientId, clientSecret, tenantId, fetchFn }) {
  const fetch = fetchFn || globalThis.fetch;

  async function getValidAccessToken(connectionId) {
    const conn = await db.getOne('SELECT * FROM calendar_connections WHERE id = $1', [connectionId]);
    if (!conn) throw new Error(`Connection ${connectionId} not found`);

    const now = new Date();
    const expiry = new Date(conn.token_expiry);

    if (expiry > now) {
      return decrypt(conn.encrypted_access_token, encryptionKey);
    }

    const refreshToken = decrypt(conn.encrypted_refresh_token, encryptionKey);
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'offline_access Calendars.ReadWrite User.Read',
      }).toString(),
    });

    const tokenData = await response.json();
    if (!response.ok) {
      await db.run('UPDATE calendar_connections SET status = $1 WHERE id = $2', ['expired', connectionId]);
      throw new Error('Token refresh failed');
    }

    const newExpiry = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    await db.run(
      'UPDATE calendar_connections SET encrypted_access_token = $1, encrypted_refresh_token = $2, token_expiry = $3, status = $4 WHERE id = $5',
      [encrypt(tokenData.access_token, encryptionKey), encrypt(tokenData.refresh_token, encryptionKey), newExpiry, 'connected', connectionId]
    );

    return tokenData.access_token;
  }

  async function getMicrosoftBusySlots(connectionId, timeMin, timeMax) {
    const accessToken = await getValidAccessToken(connectionId);
    const conn = await db.getOne('SELECT email FROM calendar_connections WHERE id = $1', [connectionId]);

    const response = await fetch('https://graph.microsoft.com/v1.0/me/calendar/getSchedule', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schedules: [conn.email],
        startTime: { dateTime: timeMin, timeZone: 'UTC' },
        endTime: { dateTime: timeMax, timeZone: 'UTC' },
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error('Failed to fetch busy slots');

    const scheduleItems = data.value[0]?.scheduleItems || [];
    return scheduleItems.map(item => ({
      start: item.start.dateTime,
      end: item.end.dateTime,
    }));
  }

  async function createMicrosoftEvent(connectionId, eventData) {
    const accessToken = await getValidAccessToken(connectionId);
    const { title, startTime, endTime, attendees = [], meetingLink } = eventData;

    const body = {
      subject: title,
      start: { dateTime: startTime, timeZone: 'UTC' },
      end: { dateTime: endTime, timeZone: 'UTC' },
      attendees: attendees.map(email => ({
        emailAddress: { address: email },
        type: 'required',
      })),
      body: {
        contentType: 'HTML',
        content: meetingLink ? `<p>Join meeting: <a href="${meetingLink}">${meetingLink}</a></p>` : '',
      },
    };

    const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) throw new Error('Failed to create event');

    return data.id;
  }

  return { getMicrosoftBusySlots, createMicrosoftEvent, getValidAccessToken };
}

module.exports = { createMicrosoftClient };
