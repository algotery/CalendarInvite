const { sendNewBookingNotification, sendBookingCancelledNotification } = require('../mailer');

async function processEmailJob(job) {
  const { type, data } = job.data;

  if (type === 'booking_notification') {
    await sendNewBookingNotification(
      data.adminEmail,
      data.booking,
      data.profileName,
      data.cancelUrl,
      data.adminTimezone
    );
  } else if (type === 'cancellation_notification') {
    await sendBookingCancelledNotification(
      data.bookerEmail,
      data.booking,
      data.profileName,
      data.bookerTimezone
    );
  }
}

module.exports = { processEmailJob };
