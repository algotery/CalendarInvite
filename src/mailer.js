const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    return transporter;
  }

  if (process.env.AWS_SES_FROM_EMAIL || process.env.AWS_REGION) {
    const { SES, SendRawEmailCommand } = require('@aws-sdk/client-ses');
    const ses = new SES({ region: process.env.AWS_REGION || 'eu-central-1' });
    transporter = nodemailer.createTransport({
      SES: { ses, aws: { SendRawEmailCommand } },
    });
    return transporter;
  }

  return null;
}

function getFromAddress() {
  return process.env.SMTP_FROM || process.env.AWS_SES_FROM_EMAIL || process.env.SMTP_USER;
}

async function sendNewBookingNotification(adminEmail, booking, profileName, cancelUrl, adminTimezone) {
  const t = getTransporter();
  if (!t || !adminEmail) return;

  const tz = adminTimezone || 'UTC';
  const startDate = new Date(booking.start_time);
  const dateStr = startDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz });
  const timeStr = startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: tz });

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 0;">
      <div style="background: #ffffff; border: 1px solid #e8e8e8; border-radius: 12px; overflow: hidden;">
        <div style="background: #006BFF; padding: 24px 32px;">
          <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600;">New Booking Received</h1>
        </div>
        <div style="padding: 32px;">
          <p style="margin: 0 0 24px; color: #333; font-size: 15px; line-height: 1.5;">
            A new meeting has been scheduled on your <strong>${profileName}</strong> profile.
          </p>
          <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b6b6b; font-size: 14px; width: 100px;">Title</td>
                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; font-weight: 500;">${booking.title}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b6b6b; font-size: 14px;">Guest</td>
                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px;">${booking.booker_name} (${booking.booker_email})</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b6b6b; font-size: 14px;">Date</td>
                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px;">${dateStr}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b6b6b; font-size: 14px;">Time</td>
                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px;">${timeStr} (${booking.duration_minutes} min)</td>
              </tr>
            </table>
          </div>
          <div style="text-align: center;">
            <a href="${cancelUrl}" style="display: inline-block; padding: 12px 28px; background: #dc2626; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 500;">Cancel This Booking</a>
          </div>
          <p style="margin: 24px 0 0; color: #9e9e9e; font-size: 12px; text-align: center;">
            This is an automated notification from MeetsGo.
          </p>
        </div>
      </div>
    </div>
  `;

  await t.sendMail({
    from: `MeetsGo <${getFromAddress()}>`,
    to: adminEmail,
    subject: `New booking: ${booking.title} - ${dateStr}`,
    html,
  });
}

async function sendBookingCancelledNotification(bookerEmail, booking, profileName, bookerTimezone) {
  const t = getTransporter();
  if (!t || !bookerEmail) return;

  const tz = bookerTimezone || 'UTC';
  const startDate = new Date(booking.start_time);
  const dateStr = startDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz });
  const timeStr = startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: tz });

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 0;">
      <div style="background: #ffffff; border: 1px solid #e8e8e8; border-radius: 12px; overflow: hidden;">
        <div style="background: #dc2626; padding: 24px 32px;">
          <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600;">Booking Cancelled</h1>
        </div>
        <div style="padding: 32px;">
          <p style="margin: 0 0 24px; color: #333; font-size: 15px; line-height: 1.5;">
            Your scheduled meeting has been cancelled. Please book a new time if you'd like to reschedule.
          </p>
          <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b6b6b; font-size: 14px; width: 100px;">Title</td>
                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; font-weight: 500;">${booking.title}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b6b6b; font-size: 14px;">Date</td>
                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; text-decoration: line-through;">${dateStr}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b6b6b; font-size: 14px;">Time</td>
                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; text-decoration: line-through;">${timeStr} (${booking.duration_minutes} min)</td>
              </tr>
            </table>
          </div>
          <p style="margin: 0; color: #6b6b6b; font-size: 14px; line-height: 1.5; text-align: center;">
            If you'd like to schedule a new meeting, please visit the booking page.
          </p>
          <p style="margin: 24px 0 0; color: #9e9e9e; font-size: 12px; text-align: center;">
            This is an automated notification from MeetsGo.
          </p>
        </div>
      </div>
    </div>
  `;

  await t.sendMail({
    from: `MeetsGo <${getFromAddress()}>`,
    to: bookerEmail,
    subject: `Booking cancelled: ${booking.title} - ${dateStr}`,
    html,
  });
}

module.exports = { sendNewBookingNotification, sendBookingCancelledNotification };
