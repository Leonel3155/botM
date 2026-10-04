# 🤖 Configuración del Bot de Discord

## Paso 1: Crear la Aplicación en Discord

1. Ve a https://discord.com/developers/applications
2. Haz clic en "New Application"
3. Dale un nombre a tu bot (ej: "UltraBot Pro")
4. Guarda la **Application ID** (la necesitarás)

## Paso 2: Configurar el Bot

1. Ve a la sección **"Bot"** en el menú izquierdo
2. Haz clic en "Add Bot" si no está creado
3. **Importante**: Desactiva "Public Bot" si no quieres que otros lo inviten
4. Copia el **Token** del bot (mantenlo secreto)

## Paso 3: Configurar OAuth2 (Para el Link de Invitación)

1. Ve a la sección **"OAuth2"** → **"General"**
2. En **"Redirects"**, agrega estas URLs:
   ```
   https://tu-repl-name.replit.app/auth/callback
   http://localhost:5000/auth/callback
   ```

## Paso 4: Generar Link de Invitación

1. Ve a **"OAuth2"** → **"URL Generator"**
2. En **"Scopes"** selecciona:
   - ✅ `bot`
   - ✅ `applications.commands`

3. En **"Bot Permissions"** selecciona:
   - ✅ Send Messages
   - ✅ Use Slash Commands
   - ✅ Manage Messages
   - ✅ Manage Roles
   - ✅ Manage Channels
   - ✅ Kick Members
   - ✅ Ban Members
   - ✅ Moderate Members
   - ✅ Add Reactions
   - ✅ Connect (para música)
   - ✅ Speak (para música)

4. **Copia el link generado** en la parte inferior

## Paso 5: Configurar Variables de Entorno

En Replit, ve a "Secrets" (icono de candado) y agrega:

```
DISCORD_TOKEN=tu_bot_token_aqui
DISCORD_CLIENT_ID=tu_application_id_aqui
DISCORD_APPLICATION_ID=tu_application_id_aqui (mismo que CLIENT_ID)
```

## Link de Invitación Rápido (Sin OAuth2)

Si solo necesitas invitar el bot sin dashboard web, usa este formato:

```
https://discord.com/api/oauth2/authorize?client_id=TU_APPLICATION_ID&permissions=8&scope=bot%20applications.commands
```

Reemplaza `TU_APPLICATION_ID` con tu Application ID real.

## Permisos Recomendados (Valor Numérico)

Para todos los permisos del sistema de protección:
- **Administrador**: `8` (todos los permisos)
- **Moderación completa**: `402653184` (kick, ban, manage messages, etc.)
- **Básico**: `2147483648` (use slash commands)

## Solución al Error de Redirect URL

Si el Developer Portal dice que el redirect URL es inválido:

1. **Para desarrollo local**: `http://localhost:5000/auth/callback`
2. **Para Replit**: `https://[tu-repl-name].[tu-username].replit.app/auth/callback`
3. **Sin dashboard**: No necesitas redirect URL, solo usa el link de invitación simple

## Verificar que el Bot Funciona

Después de invitar el bot:
1. Escribe `/help` en un canal
2. Deberían aparecer todos los comandos del bot
3. Prueba `/rank` o `/balance` para verificar el sistema psicológico

## Comandos Disponibles

El bot tiene estos comandos principales:
- **Niveles**: `/rank`, `/leaderboard`, `/level`
- **Economía**: `/balance`, `/daily`, `/work`, `/gamble`
- **Psicológicos**: `/lottery`, `/collection`, `/stats`, `/milestones`
- **Moderación**: `/warn`, `/kick`, `/ban`, `/timeout`
- **Protección**: `/lockdown`, `/massrole`, `/nsfw`
- **Roles**: `/autorole`, `/reactionrole`
- **Música**: `/play`, `/queue`, `/skip`

¡Tu bot ya está listo para usar con todas las funciones implementadas!