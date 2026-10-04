// Server configuration for development vs production (server) mode
export const config = {
  // Environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  
  // Server mode switch - set to 'true' when deploying to your home server
  IS_SERVER_MODE: process.env.SERVER_MODE === 'true',
  
  // Database configuration (for when you connect to your home server database)
  DATABASE_URL: process.env.DATABASE_URL,
  
  // Session configuration
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  
  // Discord OAuth (for future implementation)
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI: process.env.DISCORD_REDIRECT_URI,
};

// Helper functions
export const isServerMode = () => config.IS_SERVER_MODE;
export const isDevelopmentMode = () => !config.IS_PRODUCTION && !config.IS_SERVER_MODE;
