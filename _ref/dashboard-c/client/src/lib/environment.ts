// Environment configuration for development (Replit) vs production (home server)
export const ENV = {
  MODE: import.meta.env.MODE || 'development',
  IS_PRODUCTION: import.meta.env.PROD,
  IS_DEVELOPMENT: import.meta.env.DEV,
  
  // Set this to true when deploying to your home server
  IS_SERVER_MODE: import.meta.env.VITE_SERVER_MODE === 'true',
  
  API_URL: import.meta.env.VITE_API_URL || '/api',
};

// Helper to check if we're running in server mode (on your home server)
export const isServerMode = () => ENV.IS_SERVER_MODE;

// Helper to check if we're in development mode (on Replit)
export const isDevelopmentMode = () => ENV.IS_DEVELOPMENT && !ENV.IS_SERVER_MODE;
