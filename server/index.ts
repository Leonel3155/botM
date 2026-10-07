import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import cors from "cors";
import path from "path";
import createMemoryStore from "memorystore";
import { registerRoutes } from "./routes";
import { SESSION_COOKIE_NAME } from "./routes/middleware";
import { setupVite, serveStatic, log } from "./vite";
import { bot, explainBotStartError } from "./bot/index";
import { ContentScheduler } from "./bot/scheduler";
import { checkDatabaseConnection } from "./db";

// Sin SESSION_SECRET las sesiones del panel serían inseguras: mejor no arrancar
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.error('❌ Falta SESSION_SECRET en el archivo .env (usa una clave aleatoria larga).');
  process.exit(1);
}
// Un texto de ejemplo copiado tal cual es público (está en el repo): firmar con él no protege nada
if (/^cambia_esto/i.test(sessionSecret)) {
  console.error('❌ SESSION_SECRET todavía tiene el texto de ejemplo; genera una clave aleatoria tuya.');
  process.exit(1);
}
if (sessionSecret.length < 32) {
  console.warn('⚠️ SESSION_SECRET es muy corta; usa al menos 32 caracteres aleatorios.');
}

const isProduction = process.env.NODE_ENV === 'production';

const app = express();

// Detrás de un proxy HTTPS (Replit, Railway, etc.): necesario para cookies "secure"
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS con credenciales: SIEMPRE un origen concreto, nunca "*"
const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || '5000'}`).replace(/\/+$/, '');
const frontendUrl = (process.env.FRONTEND_URL || appUrl).replace(/\/+$/, '');

if (frontendUrl.includes('*')) {
  console.error('❌ FRONTEND_URL no puede ser "*" (las cookies de sesión van con credenciales). Usa la URL exacta del panel.');
  process.exit(1);
}

app.use(cors({
  origin: frontendUrl,
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// Sesiones del panel. El mismo middleware se usa para autenticar el WebSocket.
const MemoryStore = createMemoryStore(session);
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24 h sin actividad (rolling)

const sessionParser = session({
  name: SESSION_COOKIE_NAME,
  secret: sessionSecret,
  store: new MemoryStore({ checkPeriod: 1000 * 60 * 60 }), // limpia sesiones caducadas cada hora
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiry on each request
  cookie: {
    httpOnly: true,
    sameSite: 'lax',      // la cookie no viaja en peticiones POST/PUT/DELETE desde otros sitios
    secure: isProduction, // en producción solo por HTTPS (requiere trust proxy si hay proxy delante)
    maxAge: SESSION_MAX_AGE_MS
  }
});
app.use(sessionParser);

console.log('✅ Session middleware configured');
console.log('🌐 Frontend URL:', frontendUrl);
console.log('🔧 DISCORD_CLIENT_ID:', process.env.DISCORD_CLIENT_ID ? 'Set' : 'Missing');
console.log('🔧 DISCORD_CLIENT_SECRET:', process.env.DISCORD_CLIENT_SECRET ? 'Set' : 'Missing');
console.log('🔧 SESSION_SECRET:', sessionSecret ? 'Set' : 'Missing');

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app, { sessionParser });

  // Último recurso para errores no atrapados. Nunca enviamos err.message en un 5xx (puede
  // traer detalles internos: SQL, rutas, tokens...); el detalle completo queda en el log del servidor.
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const rawStatus = Number(err?.status ?? err?.statusCode);
    const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;

    let error: string;
    if (status >= 500) {
      console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err);
      error = 'Ocurrió un error inesperado en el servidor. Intenta de nuevo en un momento.';
    } else if (err?.type === 'entity.parse.failed') {
      error = 'Los datos enviados no son un JSON válido.';
    } else if (err?.type === 'entity.too.large') {
      error = 'Los datos enviados son demasiado grandes.';
    } else {
      console.warn(`[ERROR] ${req.method} ${req.originalUrl} → ${status}:`, err?.message ?? err);
      error = 'La solicitud no es válida.';
    }

    if (res.headersSent) {
      return next(err);
    }
    res.status(status).json({ error });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);

  // Errores al abrir el puerto (p. ej. otra copia de BotM ya lo usa): mensaje claro y salir
  const onListenError = (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ El puerto ${port} ya está en uso (EADDRINUSE). ¿Dejaste otra ventana con BotM abierta? Ciérrala, o cambia PORT (y también APP_URL, FRONTEND_URL y el redirect de Discord).`);
    } else if (error.code === 'EACCES') {
      // En Windows pasa con puertos que reserva el sistema (Hyper-V/WSL), aunque nadie los use
      console.error(`❌ No hay permiso para usar el puerto ${port} (EACCES); Windows a veces reserva algunos puertos. Prueba con otro PORT (por ejemplo 3000 u 8080) y cambia también APP_URL, FRONTEND_URL y el redirect de Discord.`);
    } else {
      console.error('❌ El servidor web no pudo arrancar:', error);
    }
    process.exit(1);
  };
  server.once('error', onListenError);

  // El panel se abre primero y no espera al bot: si el token falta o está mal, o Discord no
  // responde, el panel sigue funcionando y lo dice (el bot aparece desconectado).
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    server.off('error', onListenError);
    log(`serving on port ${port}`);
    console.log(`🖥️ Panel web listo en ${appUrl}`);
    void checkDatabaseConnection();
    void startDiscordBot();
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });
})().catch((error) => {
  // Sin esto el proceso se quedaría vivo sin servir nada (la promesa rechazada solo se anota)
  console.error('❌ BotM no pudo arrancar el servidor web:', error);
  process.exit(1);
});

// Conecta el bot de Discord y, si lo logra, el programador (pregunta del día y feeds de Reddit).
// Nunca lanza: cualquier fallo se explica en la consola y el panel sigue funcionando.
async function startDiscordBot() {
  try {
    await bot.start();
  } catch (error) {
    const { reason, details } = explainBotStartError(error);
    console.error(`❌ El bot de Discord no se pudo conectar. ${reason}`);
    if (details) console.error(error);
    console.error(`   El panel web sigue funcionando en ${appUrl}, pero el bot aparece desconectado. Corrige el .env y reinicia BotM (Ctrl + C y vuelve a arrancarlo).`);
    return;
  }

  try {
    const scheduler = new ContentScheduler(bot);
    await scheduler.startScheduler();
    console.log('🚀 Bot de Discord y programador de contenido en marcha');
  } catch (error) {
    console.error('❌ No se pudo iniciar el programador (pregunta del día y feeds de Reddit):', error);
  }
}
