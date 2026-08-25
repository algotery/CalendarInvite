const LEAD_TIME_MS = 2 * 60 * 60 * 1000;
const HORIZON_MS = 90 * 24 * 60 * 60 * 1000;

async function computeSlots(db, profileId, dateStr, durationMinutes, now) {
  const date = new Date(dateStr + 'T00:00:00.000Z');
  const dayOfWeek = date.getUTCDay();

  const override = await db.getOne(
    "SELECT * FROM schedule_overrides WHERE profile_id = $1 AND date = $2",
    [profileId, dateStr]
  );

  let ranges;
  if (override) {
    if (override.is_blocked) return [];
    if (override.custom_ranges) {
      ranges = JSON.parse(override.custom_ranges);
    } else {
      ranges = [];
    }
  } else {
    const templates = await db.getAll(
      "SELECT start_time, end_time FROM schedule_templates WHERE profile_id = $1 AND day_of_week = $2 ORDER BY start_time",
      [profileId, dayOfWeek]
    );
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

async function getExistingBookings(db, profileId, dateStr) {
  const dayStart = dateStr + 'T00:00:00.000Z';
  const dayEnd = dateStr + 'T23:59:59.999Z';
  return await db.getAll(
    "SELECT start_time as start, end_time as \"end\" FROM bookings WHERE profile_id = $1 AND status = 'confirmed' AND start_time >= $2 AND end_time <= $3",
    [profileId, dayStart, dayEnd]
  );
}

module.exports = { computeSlots, removeConflicts, getExistingBookings, LEAD_TIME_MS, HORIZON_MS };
