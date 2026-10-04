import type { Express, Request, Response } from "express";
import { randomBytes, timingSafeEqual } from "crypto";
import {
  SESSION_COOKIE_NAME,
  clearSessionAuth,
  forgetUserGuilds,
  isDevBypassEnabled,
  isSessionAuthenticated,
} from "./middleware";

const DISCORD_API = "https://discord.com/api/v10";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // el login debe completarse en 10 minutos

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function setupAuthRoutes(app: Express) {
  const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || '5000'}`).replace(/\/+$/, '');
  const frontendUrl = (process.env.FRONTEND_URL || appUrl).replace(/\/+$/, '');
  const redirectUri = `${appUrl}/auth/discord/callback`;
  const isProduction = process.env.NODE_ENV === 'production';

  // Acceso de desarrollo sin Discord: solo con DEV_BYPASS_AUTH=1 y NODE_ENV=development.
  // En producción no se registra la ruta aunque la variable esté puesta.
  if (process.env.DEV_BYPASS_AUTH === '1') {
    if (isDevBypassEnabled()) {
      console.warn('[DEV-BYPASS] ⚠️ DEV_BYPASS_AUTH activo: /auth/dev-login da acceso a cualquier servidor. Nunca lo uses en producción.');

      app.get('/auth/dev-login', async (req: Request, res: Response) => {
        if (!isDevBypassEnabled()) {
          return res.status(404).json({ error: 'No encontrado' });
        }
        try {
          forgetUserGuilds(req.sessionID);
          await regenerateSession(req); // evita fijación de sesión
          req.session.authenticated = true;
          req.session.devBypass = true;
          req.session.user = {
            id: 'dev-user-123',
            username: 'DevUser',
            globalName: 'Usuario de prueba',
            avatar: null
          };
          await saveSession(req);
          console.log('[DEV-BYPASS] ✅ Dev user logged in');
          res.redirect(`${frontendUrl}/?auth=dev`);
        } catch (error) {
          console.error('[DEV-BYPASS] ❌ Error:', error);
          res.redirect(`${frontendUrl}/?error=auth_failed`);
        }
      });
    } else {
      console.warn('[DEV-BYPASS] DEV_BYPASS_AUTH=1 ignorado: solo funciona con NODE_ENV=development.');
    }
  }

  // Inicio del login con Discord (OAuth2 con state anti-CSRF)
  const startDiscordLogin = (req: Request, res: Response) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId || !process.env.DISCORD_CLIENT_SECRET) {
      console.error('[AUTH] ❌ Faltan DISCORD_CLIENT_ID o DISCORD_CLIENT_SECRET en el .env');
      return res.status(500).json({ error: 'El inicio de sesión con Discord no está configurado en el servidor.' });
    }

    const state = randomBytes(32).toString('base64url');
    req.session.oauthState = state;
    req.session.oauthStateCreatedAt = Date.now();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state
    });

    // Guardamos la sesión antes de redirigir para que el state exista al volver
    req.session.save((err) => {
      if (err) {
        console.error('[AUTH] ❌ No se pudo guardar la sesión:', err);
        return res.redirect(`${frontendUrl}/?error=auth_failed`);
      }
      res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
    });
  };

  app.get('/api/auth/discord', startDiscordLogin);
  // El panel usa /auth/manual como botón de "Iniciar sesión"
  app.get('/auth/manual', startDiscordLogin);

  // Callback de Discord
  app.get('/auth/discord/callback', async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    // El state es de un solo uso: lo sacamos de la sesión pase lo que pase
    const expectedState = req.session.oauthState;
    const stateCreatedAt = req.session.oauthStateCreatedAt ?? 0;
    delete req.session.oauthState;
    delete req.session.oauthStateCreatedAt;

    if (typeof error === 'string') {
      return res.redirect(`${frontendUrl}/?error=access_denied`);
    }

    if (typeof code !== 'string' || !code) {
      return res.redirect(`${frontendUrl}/?error=no_code`);
    }

    if (
      typeof state !== 'string' ||
      !expectedState ||
      !safeEqual(state, expectedState) ||
      Date.now() - stateCreatedAt > OAUTH_STATE_TTL_MS
    ) {
      console.warn('[AUTH] ⚠️ State OAuth inválido o caducado; login rechazado');
      return res.redirect(`${frontendUrl}/?error=invalid_state`);
    }

    try {
      const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID || '',
          client_secret: process.env.DISCORD_CLIENT_SECRET || '',
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        }),
        signal: AbortSignal.timeout(10_000)
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed (${tokenResponse.status})`);
      }

      const tokenData = await tokenResponse.json();
      if (typeof tokenData?.access_token !== 'string') {
        throw new Error('Token response without access_token');
      }
      const grantedScopes = typeof tokenData.scope === 'string' ? tokenData.scope.split(' ') : [];
      if (!grantedScopes.includes('guilds')) {
        throw new Error('El usuario no concedió el scope "guilds"');
      }

      // Obtener datos del usuario
      const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(10_000)
      });

      if (!userResponse.ok) {
        throw new Error(`Failed to fetch user data (${userResponse.status})`);
      }

      const userData = await userResponse.json();

      // Sesión nueva al iniciar sesión (evita fijación de sesión)
      forgetUserGuilds(req.sessionID);
      await regenerateSession(req);

      const expiresInSeconds = Number(tokenData.expires_in);
      req.session.authenticated = true;
      req.session.discordToken = tokenData.access_token;
      req.session.discordTokenExpiresAt = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? Date.now() + expiresInSeconds * 1000
        : undefined;
      req.session.user = {
        id: String(userData.id),
        username: String(userData.username),
        globalName: typeof userData.global_name === 'string' ? userData.global_name : null,
        avatar: typeof userData.avatar === 'string' ? userData.avatar : null
      };
      await saveSession(req);

      console.log('[AUTH] ✅ User authenticated:', userData.username);
      res.redirect(`${frontendUrl}/?auth=success`);

    } catch (error) {
      console.error('[AUTH] ❌ Error:', error);
      res.redirect(`${frontendUrl}/?error=auth_failed`);
    }
  });

  // Estado de la sesión (lo usa el panel: authenticated, user, sessionExtended, expiresIn).
  // /auth/status es el mismo endpoint para el enlace de /oauth-test.
  const authStatus = (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const session = req.session;

    if (!isSessionAuthenticated(session)) {
      if (session?.authenticated) {
        clearSessionAuth(session);
      }
      return res.json({
        authenticated: false,
        user: null,
        sessionExtended: false,
        expiresIn: 0
      });
    }

    // rolling: true renueva la cookie en cada respuesta
    const maxAgeMs = session.cookie.originalMaxAge ?? 0;
    res.json({
      authenticated: true,
      user: session.user,
      sessionExtended: true,
      expiresIn: Math.floor(maxAgeMs / 1000),
      ...(session.devBypass ? { devMode: true } : {})
    });
  };

  app.get('/api/auth/status', authStatus);
  app.get('/auth/status', authStatus);

  // Cerrar sesión
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    forgetUserGuilds(req.sessionID);
    req.session.destroy((err) => {
      if (err) {
        console.error('[AUTH] ❌ Error al cerrar sesión:', err);
      }
      res.clearCookie(SESSION_COOKIE_NAME, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction
      });
      res.json({ success: true });
    });
  });
}
