const crypto = require('node:crypto');
const { escapeHtml } = require('../../utils/html');
const { BASE_LAYOUT } = require('../../views/layout');
const { buildGoogleAuthUrl, exchangeCodeForTokens, getGoogleUserEmail } = require('../../google');
const { encrypt, decrypt } = require('../../encryption');

function registerCalendarsRoutes(app, opts) {
  const encryptionKey = opts.encryptionKey;
  const googleClientId = opts.googleClientId;
  const googleClientSecret = opts.googleClientSecret;
  const googleRedirectUri = opts.googleRedirectUri;
  const zohoClientId = opts.zohoClientId;
  const zohoClientSecret = opts.zohoClientSecret;
  const zohoRedirectUri = opts.zohoRedirectUri;
  const zohoAccountsServer = opts.zohoAccountsServer || 'https://accounts.zoho.com';

  app.get('/calendars', async (request, reply) => {
    const adminId = request.session.get('adminId');
    const connections = await app.db.getAll('SELECT * FROM calendar_connections WHERE user_id = $1', [adminId]);
    const token = reply.generateCsrf();
    const icons = {
      google: `<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`,
      microsoft: `<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M1.15 1.15h10.27v10.27H1.15z" fill="#f25022"/><path d="M12.58 1.15h10.27v10.27H12.58z" fill="#7fba00"/><path d="M1.15 12.58h10.27v10.27H1.15z" fill="#00a4ef"/><path d="M12.58 12.58h10.27v10.27H12.58z" fill="#ffb900"/></svg>`,
      zoho: `<svg width="18" height="18" viewBox="0 0 24 24" fill="#E31A2D" xmlns="http://www.w3.org/2000/svg"><path d="M23.111 21.054a1.862 1.862 0 1 1 0 3.725 1.862 1.862 0 0 1 0-3.725ZM7.587 3.551a3.551 3.551 0 1 1 0 7.102 3.551 3.551 0 0 1 0-7.102Zm7.564 3.726c1.614 0 2.923.637 2.923 1.956v3.744h.79a1.002 1.002 0 0 0 .977-1.196L18.423.856a.992.992 0 0 0-.964-.856H3.344a.99.99 0 0 0-.982 1.13l.872 6.071c.07.494.512.8711 1.012.8711h9.905v.2c0 .548-.567 1.002-1.282 1.002H7.669c-2.316 0-4.195-1.554-4.195-3.473V4.945C3.474 2.213 5.342 0 7.644 0h11.233L20.89 13.999a2.981 2.981 0 0 1-2.909 3.578h-.572a.992.992 0 0 0-.992.993v2.858c0 .548-.574 1.002-1.282 1.002H9.083l-4.526 2.45a2.155 2.155 0 0 1-1.026.257H1.587a.991.991 0 0 1-.991-.991v-2.072c0-1.874 1.83-3.41 4.103-3.41h10.453v.19c0-1.309-1.309-1.946-2.923-1.946h-3.486A5.513 5.513 0 0 1 3.474 11.29V8.657a.992.992 0 0 1 .992-.992h10.685Zm-7.564.846a.735.735 0 1 0 0 1.47.735.735 0 0 0 0-1.47Z"/></svg>`
    };

    const connectionCards = connections.map(c => `
      <div class="calendar-connection-card">
        <div class="calendar-connection-info">
          <div class="calendar-connection-icon">${icons[c.provider] || ''}</div>
          <div>
            <div class="calendar-connection-email">${escapeHtml(c.email || '')}</div>
            <div class="calendar-connection-provider">${escapeHtml(c.provider.charAt(0).toUpperCase() + c.provider.slice(1))}</div>
          </div>
        </div>
        <div class="calendar-connection-actions">
          <span class="calendar-connection-status status-${c.status}">${escapeHtml(c.status)}</span>
          <form method="POST" action="/admin/calendars/${c.id}/disconnect" style="display:inline" onsubmit="event.preventDefault(); var f=this; AppModal.confirm('Are you sure you want to disconnect this calendar?', function(){f.submit()}, {title:'Disconnect Calendar', confirmText:'Disconnect', danger:true, icon:'<i class=\\'ph-fill ph-plug\\' style=\\'font-size:32px;color:var(--error)\\'></i>'}); return false;">
            <input type="hidden" name="_csrf" value="${token}">
            <button type="submit" class="btn-disconnect"><i class="ph-bold ph-plug"></i> Disconnect</button>
          </form>
        </div>
      </div>
    `).join('');

    const googleConfigured = !!(googleClientId && googleClientSecret && googleRedirectUri);
    const msClientId = opts.microsoftClientId || process.env.MICROSOFT_CLIENT_ID;
    const msConfigured = !!msClientId;
    const zohoConfigured = !!(zohoClientId && zohoClientSecret && zohoRedirectUri);

    const connectBtn = (href, label, svg, configured) => configured
      ? `<a href="${href}" class="calendar-connect-btn">${svg} <span>${label}</span></a>`
      : `<a class="calendar-connect-btn disabled" title="Not configured">${svg} <span>${label}</span></a>`;

    const missingVars = [];
    if (!googleConfigured) missingVars.push('Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)');
    if (!msConfigured) missingVars.push('Microsoft (MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID, MICROSOFT_REDIRECT_URI)');
    if (!zohoConfigured) missingVars.push('Zoho (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI)');
    const configNotice = missingVars.length
      ? `<details><summary>Some providers are not configured</summary><p>Add the following to your <code>.env</code> file:</p><ul>${missingVars.map(v => `<li>${v}</li>`).join('')}</ul></details>`
      : '';

    return reply.type('text/html').send(BASE_LAYOUT('Calendar Connections', `
      <div class="calendars-page">
        <div class="calendars-header">
          <h1>Calendar Connections</h1>
          <p class="calendars-subtitle">Connect your calendar accounts to sync availability and create events.</p>
        </div>
        ${configNotice}
        <div class="calendars-connect-section">
          <span class="field-label" style="margin-bottom: 12px; display: block;">Add a calendar</span>
          <div class="calendar-connect-grid">
            ${connectBtn('/admin/calendars/connect/google', 'Connect Google Calendar', icons.google, googleConfigured)}
            ${msConfigured ? `
              <div class="calendar-connect-dropdown">
                <button type="button" class="calendar-connect-btn" onclick="this.parentElement.classList.toggle('open')">${icons.microsoft} <span>Connect Office 365</span></button>
                <div class="calendar-connect-dropdown-menu">
                  <a href="/admin/calendars/connect/microsoft?account_type=personal">Personal (Outlook.com / Hotmail)</a>
                  <a href="/admin/calendars/connect/microsoft?account_type=work">Work / School</a>
                </div>
              </div>
            ` : connectBtn('#', 'Connect Office 365', icons.microsoft, false)}
            ${connectBtn('/admin/calendars/connect/zoho', 'Connect Zoho Calendar', icons.zoho, zohoConfigured)}
          </div>
        </div>
        ${connections.length ? `
          <div class="calendars-list-section">
            <span class="field-label" style="margin-bottom: 12px; display: block;">Connected accounts</span>
            <div class="calendar-connections-list">
              ${connectionCards}
            </div>
          </div>
        ` : `
          <div class="calendars-empty">
            <div class="calendars-empty-icon">
              <i class="ph-duotone ph-calendar-plus"></i>
            </div>
            <h3>No calendars connected</h3>
            <p>Connect a calendar account above to start syncing your availability and automatically create events for bookings.</p>
            <div class="calendars-empty-features">
              <div class="calendars-empty-feature">
                <i class="ph-duotone ph-arrows-clockwise"></i>
                <span>Real-time sync</span>
              </div>
              <div class="calendars-empty-feature">
                <i class="ph-duotone ph-shield-check"></i>
                <span>Conflict detection</span>
              </div>
              <div class="calendars-empty-feature">
                <i class="ph-duotone ph-bell-ringing"></i>
                <span>Auto reminders</span>
              </div>
            </div>
          </div>
        `}
      </div>
    `, true, 'calendars'));
  });

  app.get('/calendars/connect/google', async (request, reply) => {
    if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
      return reply.status(400).type('text/html').send(BASE_LAYOUT('Not Configured', `
        <h1>Google OAuth2 Not Configured</h1>
        <p>Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>GOOGLE_REDIRECT_URI</code> to your <code>.env</code> file, then restart the server.</p>
        <a href="/admin/calendars" role="button" class="secondary">Back to Calendars</a>
      `));
    }
    const from = request.query.from || '';
    const adminId = request.session.get('adminId');
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload = Buffer.from(JSON.stringify({ nonce, adminId, from })).toString('base64url');
    const hmac = crypto.createHmac('sha256', encryptionKey).update(payload).digest('base64url');
    const state = `${payload}.${hmac}`;
    request.session.set('googleOauthState', nonce);
    const url = buildGoogleAuthUrl(googleClientId, googleRedirectUri, state);
    return reply.redirect(url);
  });

  app.get('/calendars/callback/google', async (request, reply) => {
    const { code, error, state } = request.query;
    if (!code || error) {
      return reply.redirect('/admin/calendars?error=oauth_denied');
    }

    let stateAdminId = null;
    let stateFrom = '';
    if (state && state.includes('.')) {
      const [payload, sig] = state.split('.');
      const expectedSig = crypto.createHmac('sha256', encryptionKey).update(payload).digest('base64url');
      if (sig === expectedSig) {
        try {
          const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
          stateAdminId = decoded.adminId;
          stateFrom = decoded.from || '';
          const expectedNonce = request.session.get('googleOauthState');
          if (expectedNonce && decoded.nonce !== expectedNonce) {
            return reply.redirect('/admin/calendars?error=oauth_failed');
          }
        } catch {}
      } else {
        return reply.redirect('/admin/calendars?error=oauth_failed');
      }
    }
    request.session.set('googleOauthState', null);

    try {
      const tokens = await exchangeCodeForTokens(code, googleClientId, googleClientSecret, googleRedirectUri);
      const email = await getGoogleUserEmail(tokens.access_token);
      const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      const encryptedAccess = encrypt(tokens.access_token, encryptionKey);
      const encryptedRefresh = tokens.refresh_token ? encrypt(tokens.refresh_token, encryptionKey) : null;

      const userId = request.session.get('adminId') || stateAdminId;
      if (!userId) {
        return reply.redirect('/admin/login?next=/admin/onboarding');
      }
      request.session.set('adminId', userId);

      const existing = await app.db.getOne(
        'SELECT id FROM calendar_connections WHERE provider = $1 AND email = $2 AND user_id = $3',
        ['google', email, userId]
      );

      if (existing) {
        await app.db.run(
          'UPDATE calendar_connections SET encrypted_access_token = $1, encrypted_refresh_token = $2, token_expiry = $3, status = $4 WHERE id = $5',
          [encryptedAccess, encryptedRefresh || '', tokenExpiry, 'connected', existing.id]
        );
      } else {
        await app.db.run(
          'INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [userId, 'google', encryptedAccess, encryptedRefresh || '', tokenExpiry, email, 'connected']
        );
      }

      const calFrom = request.session.get('calendarFrom') || stateFrom;
      request.session.set('calendarFrom', null);
      return reply.redirect(calFrom === 'onboarding' ? '/admin/onboarding?step=2' : '/admin/calendars');
    } catch (err) {
      request.log.error(err);
      return reply.redirect('/admin/calendars?error=oauth_failed');
    }
  });

  app.get('/calendars/connect/microsoft', async (request, reply) => {
    const clientId = opts.microsoftClientId || process.env.MICROSOFT_CLIENT_ID;
    const tenantId = opts.microsoftTenantId || process.env.MICROSOFT_TENANT_ID;
    const redirectUri = opts.microsoftRedirectUri || process.env.MICROSOFT_REDIRECT_URI;
    if (!clientId || !tenantId || !redirectUri) {
      return reply.status(400).type('text/html').send(BASE_LAYOUT('Not Configured', `
        <h1>Microsoft OAuth2 Not Configured</h1>
        <p>Add <code>MICROSOFT_CLIENT_ID</code>, <code>MICROSOFT_CLIENT_SECRET</code>, <code>MICROSOFT_TENANT_ID</code>, and <code>MICROSOFT_REDIRECT_URI</code> to your <code>.env</code> file, then restart the server.</p>
        <a href="/admin/calendars" role="button" class="secondary">Back to Calendars</a>
      `));
    }
    const from = request.query.from || '';
    const accountType = request.query.account_type || '';
    const adminId = request.session.get('adminId');
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload = Buffer.from(JSON.stringify({ nonce, adminId, from, accountType })).toString('base64url');
    const hmac = crypto.createHmac('sha256', encryptionKey).update(payload).digest('base64url');
    const state = `${payload}.${hmac}`;
    request.session.set('oauthState', nonce);
    const scope = 'offline_access Calendars.ReadWrite User.Read';
    // Use 'consumers' for personal accounts, configured tenantId for work/school
    const effectiveTenant = accountType === 'personal' ? 'consumers' : tenantId;
    const authUrl = new URL(`https://login.microsoftonline.com/${effectiveTenant}/oauth2/v2.0/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('response_mode', 'query');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('prompt', 'consent');
    return reply.redirect(authUrl.toString());
  });

  app.get('/calendars/callback/microsoft', async (request, reply) => {
    const { code, state } = request.query;
    if (!code) {
      return reply.status(400).send('Missing authorization code');
    }

    let stateAdminId = null;
    let stateFrom = '';
    if (state && state.includes('.')) {
      const [payload, sig] = state.split('.');
      const expectedSig = crypto.createHmac('sha256', encryptionKey).update(payload).digest('base64url');
      if (sig === expectedSig) {
        try {
          const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
          stateAdminId = decoded.adminId;
          stateFrom = decoded.from || '';
          const expectedNonce = request.session.get('oauthState');
          if (expectedNonce && decoded.nonce !== expectedNonce) {
            return reply.status(403).send('Invalid OAuth state');
          }
        } catch {}
      } else {
        return reply.status(403).send('Invalid OAuth state');
      }
    } else {
      const expectedState = request.session.get('oauthState');
      if (!state || state !== expectedState) {
        return reply.status(403).send('Invalid OAuth state');
      }
    }
    request.session.set('oauthState', null);

    const clientId = opts.microsoftClientId || process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = opts.microsoftClientSecret || process.env.MICROSOFT_CLIENT_SECRET;
    const redirectUri = opts.microsoftRedirectUri || process.env.MICROSOFT_REDIRECT_URI;

    // Determine which tenant was used for authorize from state
    let accountType = '';
    try {
      if (state && state.includes('.')) {
        const [p] = state.split('.');
        const decoded = JSON.parse(Buffer.from(p, 'base64url').toString());
        accountType = decoded.accountType || '';
      }
    } catch {}
    const exchangeTenant = accountType === 'personal' ? 'consumers' : 'common';

    const tokenUrl = `https://login.microsoftonline.com/${exchangeTenant}/oauth2/v2.0/token`;
    const tokenResponse = await app.fetchFn(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'offline_access Calendars.ReadWrite User.Read',
      }).toString(),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error('[MS OAuth] Token exchange failed:', JSON.stringify(tokenData));
      return reply.status(502).send('Failed to exchange authorization code');
    }

    let actualTenantId = exchangeTenant;
    if (exchangeTenant === 'common') {
      try {
        const tokenPayload = JSON.parse(Buffer.from(tokenData.access_token.split('.')[1], 'base64').toString());
        actualTenantId = tokenPayload.tid || 'common';
      } catch {}
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in;

    const meResponse = await app.fetchFn('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const meData = await meResponse.json();

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const userId = request.session.get('adminId') || stateAdminId;
    if (!userId) {
      return reply.redirect('/admin/login?next=/admin/onboarding');
    }
    request.session.set('adminId', userId);

    let msEmail = meData.mail || meData.userPrincipalName || '';
    if (msEmail.includes('#EXT#')) {
      msEmail = msEmail.split('#EXT#')[0].replace(/_([^_]*)$/, '@$1');
    }
    const msExisting = await app.db.getOne(
      'SELECT id FROM calendar_connections WHERE provider = $1 AND email = $2 AND user_id = $3',
      ['microsoft', msEmail, userId]
    );

    let connectionId;
    if (msExisting) {
      connectionId = msExisting.id;
      await app.db.run(
        'UPDATE calendar_connections SET encrypted_access_token = $1, encrypted_refresh_token = $2, token_expiry = $3, status = $4, ms_tenant_id = $5 WHERE id = $6',
        [
          encrypt(accessToken, encryptionKey),
          encrypt(refreshToken, encryptionKey),
          expiresAt,
          'connected',
          actualTenantId,
          msExisting.id
        ]
      );
    } else {
      const insertResult = await app.db.query(`
        INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status, ms_tenant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
      `, [
        userId,
        'microsoft',
        encrypt(accessToken, encryptionKey),
        encrypt(refreshToken, encryptionKey),
        expiresAt,
        msEmail,
        'connected',
        actualTenantId
      ]);
      connectionId = insertResult.rows[0].id;
    }

    // Ensure profile_read_calendars mapping exists for all user profiles
    const profiles = await app.db.getAll('SELECT id FROM booking_profiles WHERE user_id = $1', [userId]);
    for (const profile of profiles) {
      await app.db.run(
        'INSERT INTO profile_read_calendars (profile_id, calendar_connection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [profile.id, connectionId]
      );
    }

    const calFrom = request.session.get('calendarFrom') || stateFrom;
    request.session.set('calendarFrom', null);
    return reply.redirect(calFrom === 'onboarding' ? '/admin/onboarding?step=2' : '/admin/calendars');
  });

  app.get('/calendars/connect/zoho', async (request, reply) => {
    if (!zohoClientId || !zohoClientSecret || !zohoRedirectUri) {
      return reply.status(400).type('text/html').send(BASE_LAYOUT('Not Configured', `
        <h1>Zoho OAuth2 Not Configured</h1>
        <p>Add <code>ZOHO_CLIENT_ID</code>, <code>ZOHO_CLIENT_SECRET</code>, and <code>ZOHO_REDIRECT_URI</code> to your <code>.env</code> file, then restart the server.</p>
        <a href="/admin/calendars" role="button" class="secondary">Back to Calendars</a>
      `));
    }
    const params = new URLSearchParams({
      client_id: zohoClientId,
      redirect_uri: zohoRedirectUri,
      response_type: 'code',
      scope: 'ZohoCalendar.calendar.ALL,ZohoCalendar.event.ALL,ZohoCalendar.freebusy.READ,AaaServer.profile.READ',
      access_type: 'offline',
      prompt: 'consent',
    });
    return reply.redirect(`${zohoAccountsServer}/oauth/v2/auth?${params}`);
  });

  app.get('/calendars/zoho/callback', async (request, reply) => {
    const { code } = request.query;
    if (!code) {
      return reply.status(400).send('Missing authorization code');
    }

    const accountsServer = request.query['accounts-server'] || 'https://accounts.zoho.com';
    const fetchFn = app.zohoFetch || globalThis.fetch;

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: zohoClientId,
      client_secret: zohoClientSecret,
      redirect_uri: zohoRedirectUri,
      code,
    });

    const tokenResponse = await fetchFn(`${accountsServer}/oauth/v2/token?${tokenParams}`, {
      method: 'POST',
    });

    if (!tokenResponse.ok) {
      return reply.status(502).send('Failed to exchange code for tokens');
    }

    const tokenData = await tokenResponse.json();
    const expiresIn = tokenData.expires_in || 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    let email = '';
    try {
      const userResponse = await fetchFn(`${accountsServer}/oauth/user/info`, {
        headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
      });
      if (userResponse.ok) {
        const userData = await userResponse.json();
        email = userData.Email || userData.email || userData.DISPLAY_NAME || '';
      }
    } catch (e) {
      // user info is best-effort
    }

    const encryptedAccess = encrypt(tokenData.access_token, encryptionKey);
    const encryptedRefresh = encrypt(tokenData.refresh_token, encryptionKey);

    const userId = request.session.get('adminId');
    if (!userId) {
      return reply.redirect('/admin/login');
    }

    const zohoExisting = await app.db.getOne(
      'SELECT id FROM calendar_connections WHERE provider = $1 AND email = $2 AND user_id = $3',
      ['zoho', email, userId]
    );

    if (zohoExisting) {
      await app.db.run(
        'UPDATE calendar_connections SET encrypted_access_token = $1, encrypted_refresh_token = $2, token_expiry = $3, status = $4, accounts_server = $5 WHERE id = $6',
        [encryptedAccess, encryptedRefresh, expiresAt, 'connected', accountsServer, zohoExisting.id]
      );
    } else {
      await app.db.run(
        'INSERT INTO calendar_connections (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expiry, email, status, accounts_server) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [userId, 'zoho', encryptedAccess, encryptedRefresh, expiresAt, email, 'connected', accountsServer]
      );
    }

    return reply.redirect('/admin/calendars');
  });

  app.post('/calendars/:id/disconnect', { preHandler: app.csrfProtection }, async (request, reply) => {
    const { id } = request.params;
    const adminId = request.session.get('adminId');
    await app.db.run("UPDATE booking_profiles SET write_calendar_id = NULL WHERE write_calendar_id = $1 AND user_id = $2", [id, adminId]);
    await app.db.run('DELETE FROM calendar_connections WHERE id = $1 AND user_id = $2', [id, adminId]);
    return reply.redirect('/admin/calendars');
  });
}

module.exports = { registerCalendarsRoutes };
