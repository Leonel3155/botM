# Discord Bot Management Dashboard

## Overview

This is a modern Discord bot management dashboard built to monitor and control Discord bot statistics, security events, and user authentication. The application features a "Dark Knight" color scheme (black and yellow) and is designed to work in two modes: development mode with in-memory storage for rapid iteration on Replit, and production mode with PostgreSQL for deployment on a home server.

The dashboard provides real-time bot statistics (server count, user count, uptime, memory usage, command execution), security event monitoring, and is prepared for Discord OAuth authentication integration.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Routing**: React with TypeScript, using Wouter for client-side routing. The application follows a component-based architecture with clear separation between pages, reusable components, and UI primitives.

**UI Component System**: Built on Shadcn UI with Radix UI primitives and styled with Tailwind CSS. All UI components follow a consistent design system with the "Dark Knight" color scheme defined in CSS custom properties. Components are highly composable and include variants for different states and sizes.

**State Management**: TanStack Query (React Query) handles all server state, data fetching, and caching. Query keys follow a REST-like pattern (`["/api/stats"]`, `["/api/security/events"]`) for automatic cache invalidation and refetching.

**Design System**: Custom Dark Knight theme with:
- Pure black backgrounds (#000000)
- Yellow accent colors for primary actions (#FFD700, #FFC107)
- Elevation system using box shadows for depth
- Responsive grid layouts with mobile-first approach
- Typography system using Inter and JetBrains Mono fonts

### Backend Architecture

**Server Framework**: Express.js with TypeScript, serving both API endpoints and the static frontend in production.

**Dual-Mode Operation**: The server operates in two distinct modes controlled by environment variables:
- **Development Mode** (Replit): Uses in-memory storage with mock data for rapid development. Data resets on server restart.
- **Production Mode** (Home Server): Uses PostgreSQL database with persistent storage via Drizzle ORM.

**API Structure**: RESTful API endpoints at `/api/*`:
- `GET /api/health` - Health check with environment mode information
- `GET /api/stats` - Retrieve current bot statistics
- `POST /api/stats` - Update bot statistics (for bot to call from home server)
- `GET /api/security/events` - Retrieve all security events
- `GET /api/security/events/recent` - Retrieve recent security events
- `GET /api/servers` - Retrieve all servers with engagement metrics
- `POST /api/servers` - Create/update server data with usage analytics
- `GET /api/commands` - Retrieve command usage data
- `POST /api/commands` - Track command execution
- `GET /api/moderation` - Retrieve moderation logs
- `POST /api/moderation` - Log moderation actions
- `GET /api/config` - Retrieve bot configuration
- `POST /api/config` - Update bot configuration settings

**Storage Abstraction**: `IStorage` interface provides a consistent API for data operations regardless of storage backend. Implementations include:
- `MemStorage` - In-memory storage for development with mock data initialization
- Database storage (via Drizzle ORM) for production mode

**Development Server**: Vite development server is integrated as Express middleware in development mode, providing hot module replacement and fast refresh for the frontend.

### Data Models

**Database Schema** (Drizzle ORM with PostgreSQL):

1. **bot_stats**: Stores bot performance metrics
   - id, serverCount, userCount, uptimeSeconds, memoryUsageMB, commandsExecuted, timestamp

2. **security_events**: Logs security-related events
   - id, eventType, severity, description, ipAddress, timestamp
   - Event types: login_success, login_failed, bot_restart, permission_change
   - Severity levels: info, warning, error

3. **users**: Discord user authentication data
   - id, discordId, username, discriminator, avatar, email, lastLogin

4. **servers**: Discord servers where bot is active (with engagement metrics)
   - id, name, icon, memberCount, activeUsers, commandsUsed, botJoinedAt, isActive, prefix, lastActivityUpdate
   - Tracks total members vs active users (30-day window) for engagement percentage calculation

5. **commands**: Command execution tracking for analytics
   - id, commandName, serverId, userId, executedAt, success, errorMessage
   - Used to generate command usage statistics and trends

6. **moderation_logs**: Moderation action history
   - id, serverId, moderatorId, moderatorName, targetUserId, targetUsername, action, reason, timestamp
   - Actions: ban, kick, mute, warn

7. **bot_config**: Bot configuration settings
   - id, key, value, description, updatedAt, updatedBy
   - Stores settings like prefix, welcomeMessage, logChannel, moderationRole, enableAutoMod

**Schema Validation**: Zod schemas validate all incoming data before database operations. Serialized types handle Date-to-string conversion for API responses.

### Build & Deployment

**Development Build**: `npm run dev` starts the Express server with Vite middleware, enabling hot reload.

**Production Build**: 
- Frontend: Vite bundles React application to `dist/public`
- Backend: esbuild bundles Express server to `dist/index.js` as ESM module
- Single `npm start` command serves both

**TypeScript Configuration**: Shared configuration across client, server, and shared modules with path aliases for clean imports (`@/*`, `@shared/*`, `@assets/*`).

## External Dependencies

### Third-Party Services

**Discord OAuth** (Prepared, not implemented):
- Client ID and secret configured via environment variables
- Placeholder login page at `/login` with Discord login button
- Backend route `/api/auth/discord` ready for OAuth flow implementation

### Database

**PostgreSQL** (Production mode only):
- Accessed via Neon serverless driver (`@neondatabase/serverless`)
- ORM: Drizzle ORM for type-safe database operations
- Connection managed through `DATABASE_URL` environment variable
- Schema migrations stored in `./migrations` directory

### UI Libraries

**Radix UI**: Headless component primitives for accessibility (accordion, alert-dialog, avatar, checkbox, dialog, dropdown-menu, hover-card, label, navigation-menu, popover, progress, radio-group, scroll-area, select, separator, slider, switch, tabs, toast, tooltip)

**Shadcn UI**: Pre-styled component library built on Radix UI, customized with Dark Knight theme

**Additional UI Dependencies**:
- `embla-carousel-react` - Carousel component
- `cmdk` - Command palette/search component
- `date-fns` - Date formatting and manipulation
- `lucide-react` - Icon library
- `react-icons` - Additional icon set (Discord icon)

### Build Tools

- **Vite**: Frontend build tool and dev server
- **esbuild**: Backend bundler for production
- **Tailwind CSS**: Utility-first CSS framework
- **PostCSS**: CSS transformation pipeline with autoprefixer
- **TypeScript**: Type system for both frontend and backend

### Session Management

**connect-pg-simple**: PostgreSQL session store for Express (production mode)
- Sessions configured with `SESSION_SECRET` environment variable
- Cookie-based authentication ready for Discord OAuth integration