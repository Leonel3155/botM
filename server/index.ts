import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import cors from "cors";
import path from "path";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { bot } from "./bot/index";
import { ContentScheduler } from "./bot/scheduler";

// Sin SESSION_SECRET las sesiones del panel serían inseguras: mejor no arrancar
if (!process.env.SESSION_SECRET) {
  console.error('❌ Falta SESSION_SECRET en el archivo .env (usa una clave aleatoria larga).');
  process.exit(1);
}

const app = express();

// Trust proxy para Replit (paso 2 de ChatGPT)
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS con credenciales (paso 3 de ChatGPT)
const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || '5000'}`;
const frontendUrl = process.env.FRONTEND_URL || appUrl;

app.use(cors({
  origin: frontendUrl,
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// Configure session middleware (paso 2 de ChatGPT - cookies/sesión)
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiry on each request
  cookie: {
    httpOnly: true,
    sameSite: 'lax',  // dev HTTP (usar 'none' para prod HTTPS)
    secure: process.env.NODE_ENV === 'production', // true en HTTPS
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 días
  }
}));

console.log('✅ Session middleware configured');
console.log('🌐 Frontend URL:', frontendUrl);
console.log('🔧 DISCORD_CLIENT_ID:', process.env.DISCORD_CLIENT_ID ? 'Set' : 'Missing');
console.log('🔧 DISCORD_CLIENT_SECRET:', process.env.DISCORD_CLIENT_SECRET ? 'Set' : 'Missing');
console.log('🔧 SESSION_SECRET:', process.env.SESSION_SECRET ? 'Set' : 'Missing');

// Logs que ayudan mucho (paso 8 de ChatGPT)
app.use((req, _res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/api')) {
    console.log('SESSION ID:', (req as any).sessionID, 'User:', (req as any).user?.id || 'none');
    console.log('Headers:', {
      'x-forwarded-proto': req.headers['x-forwarded-proto'],
      'host': req.headers['host']
    });
  }
  next();
});

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
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error(err);
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Start Discord bot
  try {
    await bot.start();
    
    // Start content scheduler
    const scheduler = new ContentScheduler(bot);
    await scheduler.startScheduler();
    
    console.log('🚀 Discord bot and content scheduler started successfully');
  } catch (error) {
    console.error('❌ Failed to start Discord bot:', error);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
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
})();
