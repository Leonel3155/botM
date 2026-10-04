# Migrar el bot de Discord

Este paquete contiene el bot completo y su panel web. No incluye credenciales, datos de la base de datos ni `node_modules`.

## Requisitos

- Node.js 20 o superior y npm.
- Una aplicación/bot creado en [Discord Developer Portal](https://discord.com/developers/applications).
- Una base de datos PostgreSQL accesible desde el nuevo servidor.

## Instalación

1. Extrae el ZIP y abre una terminal en la carpeta `discord-bot-migracion`.
2. Instala dependencias:

   ```sh
   npm install
   ```

3. Copia `.env.example` a `.env` y completa los valores:

   - `DISCORD_TOKEN`: token del bot.
   - `DISCORD_CLIENT_ID`: ID de aplicación de Discord.
   - `DISCORD_CLIENT_SECRET`: secreto OAuth de Discord para el panel.
   - `DATABASE_URL`: cadena de conexión PostgreSQL.
   - `SESSION_SECRET`: una clave aleatoria larga, distinta de las credenciales de Discord.
   - `APP_URL`: URL pública del servidor, sin `/` al final. En local usa `http://localhost:5000`.
   - `FRONTEND_URL`: URL del panel. Si el panel y el servidor se alojan juntos, usa el mismo valor que `APP_URL`.

4. En Discord Developer Portal, añade esta URL a **OAuth2 → Redirects**; debe coincidir exactamente con `APP_URL`:

   ```text
   https://tu-dominio/auth/discord/callback
   ```

   Para desarrollo local, usa `http://localhost:5000/auth/discord/callback`.

5. Habilita **Server Members Intent** y **Message Content Intent** en la configuración del bot. Invítalo al servidor con los permisos y los scopes `bot` y `applications.commands`.
6. Si es una base de datos nueva, crea las tablas:

   ```sh
   npm run db:push
   ```

7. Ejecuta localmente con `npm run dev`, o compila y arranca con:

   ```sh
   npm run build
   npm start
   ```

## Datos y cambio de servidor

El ZIP no contiene datos. Si quieres conservar niveles, monedas, ajustes y demás información, apunta `DATABASE_URL` a la base de datos existente o exporta PostgreSQL en el servidor anterior e importa ese respaldo en la nueva base de datos. No ejecutes `npm run db:push` contra una base de datos con datos importantes sin revisar antes los cambios de esquema.

Al cambiar de alojamiento, actualiza `APP_URL`, `FRONTEND_URL` y el redirect OAuth en Discord. Mantén los secretos en las variables privadas del nuevo alojamiento o en un `.env` local que no compartas. No subas `.env` al ZIP ni a Git.

Para evitar que el mismo bot se ejecute dos veces, detén el proceso antiguo cuando confirmes que el nuevo está conectado.