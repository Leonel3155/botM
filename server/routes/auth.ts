import type { Express, Request, Response } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { AuthStatusResponse, SuccessResponse } from "@shared/api";
import {
  SESSION_COOKIE_NAME,
  clearSessionAuth,
  endSession,
  isDevBypassEnabled,
  isLoopbackRequest,
  isRequestAuthenticated,
} from "./middleware";

const DISCORD_API = "https://discord.com/api/v10";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // el login debe completarse en 10 minutos
// El state anti-CSRF va en una cookie firmada y de vida corta (no en la sesión):
// así las visitas sin login no crean sesiones en el servidor.
const OAUTH_STATE_COOKIE = "botm_oauth_state";

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

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function setupAuthRoutes(app: Express) {
  const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || '5000'}`).replace(/\/+$/, '');
  const frontendUrl = (process.env.FRONTEND_URL || appUrl).replace(/\/+$/, '');
  const redirectUri = `${appUrl}/auth/discord/callback`;
  const isProduction = process.env.NODE_ENV === 'production';

  // index.ts ya no arranca sin SESSION_SECRET; esto es por si alguien cambia el orden
  const stateSecret = process.env.SESSION_SECRET;
  if (!stateSecret) {
    throw new Error('Falta SESSION_SECRET: hace falta para firmar el state de OAuth.');
  }

  // La cookie del state solo viaja al callback (la ruta que ve el navegador)
  let stateCookiePath = '/';
  try {
    const callbackPath = new URL(redirectUri).pathname;
    if (callbackPath.startsWith('/')) stateCookiePath = callbackPath;
  } catch {
    // APP_URL rara: usamos "/" y Discord ya se quejará del redirect_uri
  }
  const stateCookieOptions = {
    path: stateCookiePath,
    httpOnly: true,
    sameSite: 'lax' as const, // llega en la redirección (GET de nivel superior) desde discord.com
    secure: isProduction
  };

  const signOAuthState = (payload: string) =>
    createHmac('sha256', stateSecret).update(`oauth-state:${payload}`).digest('base64url');

  /** Valor de la cookie: state.creadoEn.firma */
  const createOAuthStateCookie = (state: string) => {
    const payload = `${state}.${Date.now()}`;
    return `${payload}.${signOAuthState(payload)}`;
  };

  /** ¿El state que vuelve de Discord es el que pusimos en la cookie de ESTE navegador, firmado y sin caducar? */
  const isValidOAuthState = (cookieValue: string | undefined, state: unknown): boolean => {
    if (typeof state !== 'string' || !cookieValue) return false;
    const parts = cookieValue.split('.');
    if (parts.length !== 3) return false;
    const [expectedState, createdAtRaw, signature] = parts;
    if (!safeEqual(signature, signOAuthState(`${expectedState}.${createdAtRaw}`))) return false;
    const age = Date.now() - Number(createdAtRaw);
    if (!Number.isFinite(age) || age < 0 || age > OAUTH_STATE_TTL_MS) return false;
    return safeEqual(state, expectedState);
  };

  // Acceso de desarrollo sin Discord: solo con DEV_BYPASS_AUTH=1 y NODE_ENV=development.
  // En producción no se registra la ruta aunque la variable esté puesta.
  if (process.env.DEV_BYPASS_AUTH === '1') {
    if (isDevBypassEnabled()) {
      console.warn('[DEV-BYPASS] ⚠️ DEV_BYPASS_AUTH activo: /auth/dev-login (solo desde http://localhost en este equipo) da acceso a cualquier servidor. Nunca lo uses en producción.');

      app.get('/auth/dev-login', async (req: Request, res: Response) => {
        if (!isDevBypassEnabled()) {
          return res.status(404).json({ error: 'No encontrado' });
        }
        // Solo desde este mismo equipo y por localhost: ni desde otro aparato de la red
        // ni desde una web que apunte su dominio a 127.0.0.1 (DNS rebinding)
        if (!isLoopbackRequest(req)) {
          console.warn(`[DEV-BYPASS] /auth/dev-login rechazado (${req.socket.remoteAddress}, Host: ${req.headers.host ?? '-'}): solo funciona abriendo http://localhost en este equipo.`);
          return res.status(404).json({ error: 'No encontrado' });
        }
        try {
          endSession(req.sessionID);
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
    res.cookie(OAUTH_STATE_COOKIE, createOAuthStateCookie(state), {
      ...stateCookieOptions,
      maxAge: OAUTH_STATE_TTL_MS
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state
    });

    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  };

  app.get('/api/auth/discord', startDiscordLogin);
  // El panel usa /auth/manual como botón de "Iniciar sesión"
  app.get('/auth/manual', startDiscordLogin);

  // Callback de Discord
  app.get('/auth/discord/callback', async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    // El state es de un solo uso: borramos su cookie pase lo que pase
    const stateCookie = readCookie(req, OAUTH_STATE_COOKIE);
    res.clearCookie(OAUTH_STATE_COOKIE, stateCookieOptions);

    if (typeof error === 'string') {
      return res.redirect(`${frontendUrl}/?error=access_denied`);
    }

    if (typeof code !== 'string' || !code) {
      return res.redirect(`${frontendUrl}/?error=no_code`);
    }

    if (!isValidOAuthState(stateCookie, state)) {
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

      // Sesión nueva al iniciar sesión (evita fijación de sesión).
      // La anterior deja de valer: también se cierran sus WebSockets.
      endSession(req.sessionID);
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

    if (!isRequestAuthenticated(req)) {
      if (session?.authenticated) {
        clearSessionAuth(session);
      }
      const body: AuthStatusResponse = {
        authenticated: false,
        user: null,
        sessionExtended: false,
        expiresIn: 0
      };
      return res.json(body);
    }

    // rolling: true renueva la cookie en cada respuesta
    const maxAgeMs = session.cookie.originalMaxAge ?? 0;
    const body: AuthStatusResponse = {
      authenticated: true,
      user: session.user ?? null,
      sessionExtended: true,
      expiresIn: Math.floor(maxAgeMs / 1000),
      ...(session.devBypass ? { devMode: true } : {})
    };
    res.json(body);
  };

  app.get('/api/auth/status', authStatus);
  app.get('/auth/status', authStatus);

  // Cerrar sesión
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    // Cierra también los WebSockets abiertos con esta sesión (código 4401)
    endSession(req.sessionID);
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
      const body: SuccessResponse = { success: true };
      res.json(body);
    });
  });
}
