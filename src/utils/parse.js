const { convertTimeToUTC } = require('./time');

function parseScheduleFromBody(body, adminTimezone = 'UTC') {
  const entries = [];
  for (let day = 0; day <= 6; day++) {
    const key = `schedule[${day}]`;
    const starts = body[`${key}[start][]`];
    const ends = body[`${key}[end][]`];
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

module.exports = { parseScheduleFromBody, parseAttendeesFromBody, parseOverridesFromBody };
