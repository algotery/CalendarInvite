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

module.exports = { convertUTCToLocalTime, convertTimeToUTC };
