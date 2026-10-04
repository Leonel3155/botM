# Discord Bot Management Dashboard

A sleek, modern dashboard for managing and monitoring your Discord bot with real-time statistics and security insights. Built with the Dark Knight color scheme (black and yellow).

## Features

- **Real-time Statistics**: Monitor server count, user reach, uptime, and memory usage
- **Security Monitoring**: Track security events, failed logins, and bot status
- **Environment Switching**: Seamlessly switch between development and production modes
- **Discord OAuth**: Secure authentication (ready for implementation)
- **Responsive Design**: Beautiful UI that works on all devices

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Shadcn UI
- **Backend**: Express.js, Node.js
- **Database**: In-memory (development) / PostgreSQL (production)
- **Routing**: Wouter
- **State Management**: TanStack Query

## Getting Started

### Development Mode (Replit)

1. The dashboard is pre-configured to run in development mode with mock data served from the backend
2. Run the application:
   ```bash
   npm run dev
   ```
3. Access the dashboard at `http://localhost:5000`
4. The backend serves mock data from in-memory storage (MemStorage)
5. Login page is accessible at `/login` (OAuth placeholder - ready for Discord OAuth implementation)

**Note**: In development mode, data resets on server restart (in-memory storage). This is intentional for quick iteration.

### Production Mode (Home Server)

1. Copy the environment variables:
   ```bash
   cp .env.example .env
   ```

2. Configure your `.env` file:
   ```env
   SERVER_MODE=true
   DATABASE_URL=postgresql://user:password@localhost:5432/botdashboard
   SESSION_SECRET=your-secure-secret-key
   DISCORD_CLIENT_ID=your-discord-app-client-id
   DISCORD_CLIENT_SECRET=your-discord-app-client-secret
   ```

3. **Database Setup**: Configure PostgreSQL with the schema from `shared/schema.ts` or implement your preferred storage adapter

4. Set up your Discord bot to send data to the dashboard:
   - POST bot statistics to `/api/stats`
   - POST security events to `/api/security/events`

5. **Authentication** (Optional): Implement Discord OAuth by completing the placeholder routes in `server/routes.ts`

6. Deploy to your home server and run:
   ```bash
   npm install
   npm run build
   npm start
   ```

**Important**: The MVP uses in-memory storage. For production, you'll need to:
- Connect to PostgreSQL using the DATABASE_URL
- Implement a database storage adapter (replace MemStorage)
- Or modify MemStorage to persist to a file/database

## API Endpoints

### Statistics
- `GET /api/stats` - Get current bot statistics
- `POST /api/stats` - Update bot statistics (for your bot to call)

### Security
- `GET /api/security/events` - Get all security events
- `GET /api/security/events/recent` - Get recent security events
- `POST /api/security/events` - Add a security event (for your bot to call)

### Authentication
- `GET /api/auth/discord` - Initiate Discord OAuth
- `GET /api/auth/discord/callback` - OAuth callback
- `POST /api/auth/logout` - Logout

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVER_MODE` | Set to 'true' for production on your home server | `false` |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `SESSION_SECRET` | Secret key for sessions | Required |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID | - |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret | - |

## Connecting Your Discord Bot

When running on your home server, your Discord bot should make HTTP requests to update the dashboard:

```javascript
// Example: Update bot statistics
await fetch('http://localhost:5000/api/stats', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    serverCount: 142,
    userCount: 8547,
    uptimeSeconds: process.uptime(),
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    commandsExecuted: totalCommands
  })
});

// Example: Log a security event
await fetch('http://localhost:5000/api/security/events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    eventType: 'bot_restart',
    severity: 'info',
    description: 'Bot service restarted',
    ipAddress: null
  })
});
```

## Color Scheme

The dashboard uses a Dark Knight inspired color palette:

- **Primary**: Yellow (`#FFC107`, `#FFD700`) - Accents, buttons, highlights
- **Background**: Pure black (`#000000`) - Main background
- **Surface**: Dark gray (`#111111`, `#1a1a1a`) - Cards, panels
- **Text**: White/off-white (`#FFFFFF`, `#F5F5F5`) - Primary text
- **Borders**: Dark gray (`#2a2a2a`, `#333333`) - Subtle separators

## License

MIT
