# Estructura del Proyecto

## Directorios Principales

```
discord-bot-dashboard/
├── docs/                          # 📚 Documentación completa
│   ├── README.md                  # Resumen general del proyecto
│   ├── COMMANDS_REFERENCE.md      # Lista de todos los comandos
│   ├── INSTALLATION_GUIDE.md      # Guía de instalación paso a paso
│   ├── PROJECT_STRUCTURE.md       # Este archivo
│   └── [archivos antiguos movidos]
│
├── client/                        # 🌐 Frontend (React + TypeScript)
│   ├── src/
│   │   ├── components/            # Componentes React reutilizables
│   │   ├── pages/                 # Páginas de la aplicación
│   │   ├── lib/                   # Utilidades y configuración
│   │   └── hooks/                 # Custom React hooks
│   └── index.html                 # Página principal
│
├── server/                        # 🔧 Backend (Express + TypeScript)
│   ├── bot/                       # 🤖 Discord bot
│   │   ├── commands/              # Comandos del bot organizados por categoría
│   │   │   ├── gambling.ts        # Juegos de casino (blackjack, slots, etc.)
│   │   │   ├── casinogames.ts     # Sistema psicológico (lottery, rank, stats)
│   │   │   ├── economy.ts         # Sistema económico (balance, trabajo, etc.)
│   │   │   ├── level.ts           # Sistema de niveles y XP
│   │   │   ├── music.ts           # Comandos de música
│   │   │   ├── moderation.ts      # Moderación y administración
│   │   │   ├── diagnostics.ts     # Diagnósticos del sistema
│   │   │   └── index.ts           # Registro de comandos
│   │   ├── events/                # Event handlers de Discord
│   │   ├── scheduler.ts           # Tareas programadas
│   │   └── index.ts               # Configuración principal del bot
│   │
│   ├── routes/                    # 🛣️ API endpoints
│   │   ├── auth.ts                # Autenticación OAuth
│   │   ├── dashboard.ts           # Estadísticas del dashboard
│   │   ├── levels.ts              # API de niveles
│   │   └── music.ts               # API de música
│   │
│   ├── middleware/                # Middleware de Express
│   ├── services/                  # Servicios externos
│   ├── storage.ts                 # Capa de acceso a datos
│   └── index.ts                   # Servidor principal
│
├── shared/                        # 📋 Código compartido
│   └── schema.ts                  # Esquemas de base de datos (Drizzle)
│
├── standalone-simple-bot/         # 🚀 Bot independiente para terminal
│   ├── bot.js                     # Bot simplificado
│   ├── package.json               # Dependencias del bot independiente
│   └── README.md                  # Instrucciones del bot independiente
│
└── attached_assets/               # 📁 Archivos temporales
    └── archive/                   # Comandos antiguos archivados
```

## Descripción de Componentes

### Frontend (`client/`)
- **React + TypeScript**: Interfaz moderna y responsiva
- **Tailwind CSS + shadcn/ui**: Sistema de diseño consistente
- **TanStack Query**: Gestión de estado del servidor
- **WebSockets**: Actualizaciones en tiempo real

### Backend (`server/`)
- **Express.js**: Servidor web y API REST
- **Discord.js v14**: Interacción con Discord API
- **PostgreSQL + Drizzle**: Base de datos y ORM
- **OAuth2**: Autenticación con Discord

### Sistema del Bot (`server/bot/`)

#### Comandos por Categoría:
1. **gambling.ts** - Juegos de Casino
   - Blackjack con cartas reales
   - Máquina tragamonedas
   - Ruleta europea
   - Juego de dados
   - Ruleta rusa

2. **casinogames.ts** - Sistema Psicológico
   - Lotería con boletos acumulativos
   - Colección de objetos raros
   - Sistema de ranking con percentiles
   - Estadísticas detalladas
   - Hitos y recompensas

3. **economy.ts** - Economía Virtual
   - Balance y transacciones
   - Trabajo y recompensas diarias
   - Sistema bancario
   - Transferencias entre usuarios

4. **level.ts** - Sistema de Niveles
   - XP por actividad
   - Progreso visual
   - Leaderboards
   - Recompensas por nivel

5. **music.ts** - Sistema de Música
   - Reproducción de YouTube
   - Cola de canciones
   - Radio lofi 24/7
   - Controles de audio

6. **moderation.ts** - Herramientas de Moderación
   - Lockdown del servidor
   - Gestión masiva de roles
   - Auto-roles para nuevos miembros
   - Reaction roles

### Base de Datos (`shared/schema.ts`)

#### Tablas Principales:
- **users**: Usuarios de Discord
- **guilds**: Configuración de servidores
- **userLevels**: Sistema de niveles y XP
- **userEconomy**: Sistema económico
- **economyTransactions**: Historial de transacciones
- **virtualItems**: Objetos coleccionables
- **lotteryDraws**: Sistema de lotería
- **userAchievements**: Logros y hitos
- **musicQueue**: Cola de reproducción

## Flujo de Datos

### 1. Mensaje de Usuario en Discord
```
Usuario escribe → Discord API → Bot procesa → 
XP +25 → Monedas +10 → Check drop raro (0.5%) → 
Actualizar BD → Respuesta al usuario
```

### 2. Comando de Casino
```
Usuario `/blackjack 100` → Validar balance → 
Juego interactivo → Resultado → 
Actualizar balance → Logs de transacción
```

### 3. Dashboard Web
```
Usuario OAuth → Discord auth → Session → 
API calls → Base de datos → 
WebSocket updates → UI en tiempo real
```

## Archivos de Configuración

- **package.json**: Dependencias y scripts
- **tsconfig.json**: Configuración TypeScript
- **tailwind.config.ts**: Configuración de estilos
- **vite.config.ts**: Configuración del bundler
- **drizzle.config.ts**: Configuración de la base de datos
- **components.json**: Configuración de shadcn/ui

## Scripts NPM

```bash
npm run dev          # Desarrollo con hot reload
npm run build        # Build para producción
npm start            # Ejecutar en producción
npm run db:push      # Actualizar schema de BD
npm run db:studio    # Interfaz visual de BD
npm run seed         # Poblar datos de prueba
```

## Variables de Entorno

```bash
# Discord
DISCORD_TOKEN=          # Token del bot
DISCORD_CLIENT_ID=      # ID de la aplicación
DISCORD_CLIENT_SECRET=  # Secret para OAuth

# Base de Datos
DATABASE_URL=           # String de conexión PostgreSQL

# Configuración
SESSION_SECRET=         # Clave para sesiones
NODE_ENV=              # development/production
```

## Dependencias Principales

### Backend:
- express: Servidor web
- discord.js: Cliente de Discord
- drizzle-orm: ORM para base de datos
- passport: Autenticación
- ws: WebSockets

### Frontend:
- react: Framework de UI
- @tanstack/react-query: Gestión de estado
- tailwindcss: Framework de CSS
- @radix-ui: Componentes primitivos
- lucide-react: Iconografía

## Extensibilidad

### Añadir Nuevo Comando:
1. Crear archivo en `server/bot/commands/`
2. Exportar array de comandos
3. Importar en `server/bot/commands/index.ts`
4. Reiniciar bot para registrar

### Añadir Nueva Tabla:
1. Definir schema en `shared/schema.ts`
2. Ejecutar `npm run db:push`
3. Actualizar tipos en `storage.ts`
4. Crear endpoints API si necesario

### Añadir Nueva Página:
1. Crear componente en `client/src/pages/`
2. Añadir ruta en `client/src/App.tsx`
3. Crear API endpoint si necesario
4. Añadir navegación

---

**Esta estructura está optimizada para desarrollo rápido y mantenimiento a largo plazo.**