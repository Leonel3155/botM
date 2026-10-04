import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { config } from "./config";
import { 
  insertBotStatsSchema, 
  insertSecurityEventSchema,
  insertServerSchema,
  insertCommandSchema,
  insertModerationLogSchema,
  insertBotConfigSchema,
  insertAuditLogSchema
} from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      mode: config.IS_SERVER_MODE ? "server" : "development",
      timestamp: new Date().toISOString()
    });
  });

  // Get current bot statistics
  app.get("/api/stats", async (req, res) => {
    try {
      const stats = await storage.getCurrentStats();
      
      if (!stats) {
        return res.status(404).json({ error: "No statistics available" });
      }
      
      res.json(stats);
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update bot statistics (for your bot to call from home server)
  app.post("/api/stats", async (req, res) => {
    try {
      const validatedData = insertBotStatsSchema.parse(req.body);
      const stats = await storage.insertStats(validatedData);
      res.json(stats);
    } catch (error: any) {
      console.error("Error inserting stats:", error);
      // Differentiate between validation errors (400) and server errors (500)
      if (error.name === 'ZodError' || error.issues) {
        return res.status(400).json({ error: "Invalid statistics data", details: error.issues });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get all security events
  app.get("/api/security/events", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const events = await storage.getSecurityEvents(limit);
      res.json(events);
    } catch (error) {
      console.error("Error fetching security events:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get recent security events (last 5)
  app.get("/api/security/events/recent", async (req, res) => {
    try {
      const count = req.query.count ? parseInt(req.query.count as string) : 5;
      const events = await storage.getRecentSecurityEvents(count);
      res.json(events);
    } catch (error) {
      console.error("Error fetching recent events:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Add a security event (for your bot to call from home server)
  app.post("/api/security/events", async (req, res) => {
    try {
      const validatedData = insertSecurityEventSchema.parse(req.body);
      const event = await storage.insertSecurityEvent(validatedData);
      res.json(event);
    } catch (error: any) {
      console.error("Error inserting security event:", error);
      // Differentiate between validation errors (400) and server errors (500)
      if (error.name === 'ZodError' || error.issues) {
        return res.status(400).json({ error: "Invalid security event data", details: error.issues });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Placeholder Discord OAuth routes (to be implemented when needed)
  app.get("/api/auth/discord", (req, res) => {
    // In production, this would redirect to Discord OAuth
    // For now, just redirect to dashboard
    res.redirect("/");
  });

  app.get("/api/auth/discord/callback", (req, res) => {
    // In production, this would handle the OAuth callback
    res.redirect("/");
  });

  app.post("/api/auth/logout", (req, res) => {
    // In production, this would clear the session
    res.json({ success: true });
  });

  // Server management endpoints
  app.get("/api/servers", async (req, res) => {
    try {
      const servers = await storage.getServers();
      res.json(servers);
    } catch (error) {
      console.error("Error fetching servers:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/servers/:id", async (req, res) => {
    try {
      const server = await storage.getServer(req.params.id);
      if (!server) {
        return res.status(404).json({ error: "Server not found" });
      }
      res.json(server);
    } catch (error) {
      console.error("Error fetching server:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/servers", async (req, res) => {
    try {
      const validatedData = insertServerSchema.parse(req.body);
      const server = await storage.createServer(validatedData);
      res.json(server);
    } catch (error: any) {
      console.error("Error creating server:", error);
      if (error.name === 'ZodError' || error.issues) {
        return res.status(400).json({ error: "Invalid server data", details: error.issues });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/servers/:id", async (req, res) => {
    try {
      const server = await storage.updateServer(req.params.id, req.body);
      if (!server) {
        return res.status(404).json({ error: "Server not found" });
      }
      res.json(server);
    } catch (error) {
      console.error("Error updating server:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Command analytics endpoints
  app.get("/api/commands", async (req, res) => {
    try {
      const serverId = req.query.serverId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const commands = await storage.getCommands(serverId, limit);
      res.json(commands);
    } catch (error) {
      console.error("Error fetching commands:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/commands/stats", async (req, res) => {
    try {
      const stats = await storage.getCommandStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching command stats:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/commands", async (req, res) => {
    try {
      const validatedData = insertCommandSchema.parse(req.body);
      const command = await storage.insertCommand(validatedData);
      res.json(command);
    } catch (error: any) {
      console.error("Error inserting command:", error);
      if (error.name === 'ZodError' || error.issues) {
        return res.status(400).json({ error: "Invalid command data", details: error.issues });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Moderation logs endpoints
  app.get("/api/moderation", async (req, res) => {
    try {
      const serverId = req.query.serverId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const logs = await storage.getModerationLogs(serverId, limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching moderation logs:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/moderation", async (req, res) => {
    try {
      const validatedData = insertModerationLogSchema.parse(req.body);
      const log = await storage.insertModerationLog(validatedData);
      res.json(log);
    } catch (error: any) {
      console.error("Error inserting moderation log:", error);
      if (error.name === 'ZodError' || error.issues) {
        return res.status(400).json({ error: "Invalid moderation log data", details: error.issues });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Bot configuration endpoints
  app.get("/api/config", async (req, res) => {
    try {
      const key = req.query.key as string | undefined;
      if (key) {
        const config = await storage.getConfig(key);
        if (!config) {
          return res.status(404).json({ error: "Configuration not found" });
        }
        res.json(config);
      } else {
        const configs = await storage.getAllConfig();
        res.json(configs);
      }
    } catch (error) {
      console.error("Error fetching config:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/config", async (req, res) => {
    try {
      const validatedData = insertBotConfigSchema.parse(req.body);
      const config = await storage.setConfig(validatedData);
      res.json(config);
    } catch (error: any) {
      console.error("Error setting config:", error);
      if (error.name === 'ZodError' || error.issues) {
        return res.status(400).json({ error: "Invalid config data", details: error.issues });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Audit logs endpoints
  app.get("/api/audit", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const logs = await storage.getAuditLogs(limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/audit", async (req, res) => {
    try {
      const validatedData = insertAuditLogSchema.parse(req.body);
      const log = await storage.insertAuditLog(validatedData);
      res.json(log);
    } catch (error: any) {
      console.error("Error inserting audit log:", error);
      if (error.name === 'ZodError' || error.issues) {
        return res.status(400).json({ error: "Invalid audit log data", details: error.issues });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
