const publicPaths = [
  '/admin/login',
  '/admin/register',
  '/admin/calendars/callback/google',
  '/admin/calendars/callback/microsoft',
  '/admin/calendars/zoho/callback',
];

async function requireAuth(request, reply) {
  const urlPath = request.url.split('?')[0];
  if (publicPaths.includes(urlPath)) return;
  if (!request.session.get('adminId')) {
    return reply.redirect('/admin/login');
  }
}

module.exports = { requireAuth };
