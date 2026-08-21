const { createCalendarEvent, deleteCalendarEvent } = require('../services/calendar-service');

async function processCalendarJob(job, db, fetchFn) {
  const { type, data } = job.data;

  if (type === 'create_event') {
    const { connectionId, encryptionKey, eventData, bookingId } = data;
    const connection = await db.getOne(
      "SELECT * FROM calendar_connections WHERE id = $1 AND status = 'connected'",
      [connectionId]
    );
    if (!connection) return null;

    const eventId = await createCalendarEvent(fetchFn, db, encryptionKey, connection, eventData);

    if (eventId && bookingId) {
      const booking = await db.getOne("SELECT calendar_event_id FROM bookings WHERE id = $1", [bookingId]);
      let events = [];
      try { events = JSON.parse(booking.calendar_event_id || '[]'); } catch {}
      events.push({ connectionId, eventId });
      await db.run("UPDATE bookings SET calendar_event_id = $1 WHERE id = $2", [JSON.stringify(events), bookingId]);
    }

    return eventId;
  }

  if (type === 'delete_event') {
    const { connectionId, encryptionKey, eventId } = data;
    const connection = await db.getOne(
      "SELECT * FROM calendar_connections WHERE id = $1 AND status = 'connected'",
      [connectionId]
    );
    if (!connection) return null;
    await deleteCalendarEvent(fetchFn, db, encryptionKey, connection, eventId);
  }
}

module.exports = { processCalendarJob };
