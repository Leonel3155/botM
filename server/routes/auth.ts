import type { Express, Request, Response } from "express";

interface SessionRequest extends Request {
  session: any;
}

export function setupAuthRoutes(app: Express) {
  const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || '5000'}`;
  const frontendUrl = process.env.FRONTEND_URL || appUrl;
  const redirectUri = `${appUrl}/auth/discord/callback`;

  // Bypass para desarrollo (solo si DEV_BYPASS_AUTH=1)
  if (process.env.DEV_BYPASS_AUTH === '1') {
    app.get('/auth/dev-login', (req: SessionRequest, res: Response) => {
      req.session.authenticated = true;
      req.session.user = { 
        id: 'dev-user-123', 
        username: 'DevUser', 
        avatar: null 
      };
      req.session.lastActivity = Date.now();
      console.log('[DEV-BYPASS] ✅ Dev user logged in');
      res.redirect(`${frontendUrl}/?auth=dev`);
    });
  }

  // Ruta principal de autenticación - DESARROLLO LOCAL
  app.get('/api/auth/discord', (req: SessionRequest, res: Response) => {
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20guilds`;

    console.log('[AUTH-DEV] Redirecting to Discord OAuth:', authUrl);
    res.redirect(authUrl);
  });

  // Callback simple y directo - DESARROLLO LOCAL
  app.get('/auth/discord/callback', async (req: SessionRequest, res: Response) => {
    const { code } = req.query;

    if (!code) {
      return res.redirect('/?error=no_code');
    }

    try {
      console.log('[AUTH-SIMPLE] Processing OAuth code');

      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID || '',
          client_secret: process.env.DISCORD_CLIENT_SECRET || '',
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: redirectUri
        })
      });

      if (!tokenResponse.ok) {
        throw new Error('Token exchange failed');
      }

      const tokenData = await tokenResponse.json();

      // Obtener datos del usuario
      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });

      if (!userResponse.ok) {
        throw new Error('Failed to fetch user data');
      }

      const userData = await userResponse.json();

      // Guardar en sesión - SIMPLE Y DIRECTO
      req.session.authenticated = true;
      req.session.discordToken = tokenData.access_token;
      req.session.user = {
        id: userData.id,
        username: userData.username,
        avatar: userData.avatar
      };
      req.session.lastActivity = Date.now();

      console.log('[AUTH-DEV] ✅ User authenticated:', userData.username);
      res.redirect(`${frontendUrl}/?auth=success`);

    } catch (error) {
      console.error('[AUTH-DEV] ❌ Error:', error);
      res.redirect(`${frontendUrl}/?error=auth_failed`);
    }
  });

  // Status simple
  app.get('/api/auth/status', (req: SessionRequest, res: Response) => {
    const isAuth = req.session?.authenticated && req.session?.discordToken;

    if (isAuth) {
      req.session.lastActivity = Date.now();
    }

    res.json({
      authenticated: !!isAuth,
      user: req.session?.user || null,
      sessionExtended: !!isAuth,
      expiresIn: 30 * 60
    });
  });

  // Logout simple
  app.post('/api/auth/logout', (req: SessionRequest, res: Response) => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });
}