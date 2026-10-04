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

## Actividad del servidor: bienvenida, pregunta del día, anuncios y eventos

Estas funciones mantienen el servidor activo sin que tengas que escribir a mano todos los días. Todos los comandos de configuración responden solo a quien los usa (mensajes efímeros) y requieren el permiso **Gestionar servidor**.

> **Después de actualizar el bot ejecuta `npm run db:push` antes de arrancarlo.** Esta versión agrega columnas nuevas a la tabla `guilds` (todas con valores predeterminados; no borra datos). Sin ese paso fallará todo lo que lee la configuración del servidor (prefijo, panel, bienvenida, pregunta del día...).

### 👋 Bienvenida

Cuando alguien entra, el bot publica un embed con su avatar en el canal elegido y, si lo configuras, le da un rol automáticamente.

- `/bienvenida canal` — canal donde se da la bienvenida.
- `/bienvenida mensaje` — texto personalizado (vacío = mensaje predeterminado). Variables: `{usuario}` (mención), `{nombre}`, `{servidor}` y `{miembros}`. Escribe `\n` para un salto de línea.
- `/bienvenida rol` — rol automático al entrar (vacío = ninguno). El rol del bot debe estar **por encima** de ese rol y por seguridad no se aceptan roles con permisos de moderación o administración. Para elegirlo necesitas además **Gestionar roles** y que el rol esté por debajo de tu rol más alto (salvo que seas el dueño del servidor).
- `/bienvenida activar` / `/bienvenida desactivar`
- `/bienvenida probar` — vista previa con tu usuario y revisión de permisos (opción `publicar` para verla en el canal).

Requiere **Server Members Intent** activado en Discord Developer Portal → Bot → *Privileged Gateway Intents* (sin él Discord no avisa al bot cuando alguien entra).

### ❓ Pregunta del día

Una vez al día, a la hora elegida y en la zona horaria del servidor (por defecto `America/Mexico_City`), el bot publica una pregunta para romper el hielo y abre un hilo para las respuestas. Tiene más de 60 preguntas (videojuegos, música, comida, "¿qué prefieres...?", hipotéticas...) y no repite ninguna hasta usarlas todas. El progreso se guarda en la base de datos, así que reiniciar el bot no duplica ni repite preguntas. Puedes agregar o quitar preguntas en `server/bot/data/preguntasDelDia.ts` sin que se repitan las que ya salieron.

- `/pregunta-del-dia canal` — canal (opción `hilo` para abrir o no un hilo de respuestas).
- `/pregunta-del-dia hora` — hora de 0 a 23 (por defecto 18).
- `/pregunta-del-dia zona` — zona horaria IANA, p. ej. `America/Mexico_City`, `America/Bogota`, `Europe/Madrid` (también acepta `CDMX`, `Colombia`, `España`...).
- `/pregunta-del-dia activar` / `/pregunta-del-dia desactivar`
- `/pregunta-del-dia ahora` — publica una pregunta en ese momento (cuenta como la del día).
- `/pregunta-del-dia estado` — muestra la configuración y cuándo sale la siguiente.

### 📢 Anuncios y 📅 eventos

- `/anuncio` — publica un anuncio con título, mensaje y, opcionalmente, canal, mención (`@everyone`, `@here` o un rol), imagen (URL) y color (`rojo`, `morado`, `#FF8800`...). Solo se puede publicar en canales donde tú también puedes escribir (y mencionar a todos solo donde tienes ese permiso).
- `/evento crear` — crea un evento nativo de Discord (en un canal de voz/escenario o en un lugar externo) y lo anuncia con un botón para marcar "Me interesa". La fecha se escribe como `AAAA-MM-DD HH:mm` (también `DD/MM/AAAA HH:mm`) en la zona horaria del servidor. Requiere **Gestionar eventos** (o **Crear eventos**); el anuncio solo se publica en un canal donde tú puedes escribir y el canal de voz debe ser uno al que puedas entrar.
- `/evento lista` — muestra los próximos eventos (cualquiera puede usarlo).

Permisos que necesita el bot para todo esto: **Ver canales**, **Enviar mensajes**, **Insertar enlaces**, **Crear hilos públicos**, **Gestionar roles** (rol automático), **Gestionar eventos** y, si quieres avisar a todos, **Mencionar @everyone, @here y todos los roles**.
