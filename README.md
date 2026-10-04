# Migrar el bot de Discord

Este paquete contiene el bot completo y su panel web. No incluye credenciales, datos de la base de datos ni `node_modules`.

## Cómo ponerlo en marcha (Windows)

Necesitas unos 20 minutos. Todo se hace desde el navegador y una ventana de **PowerShell** (búscala en el menú Inicio). No hace falta pagar nada.

### 1. Instala Node.js 20

1. Entra a [nodejs.org](https://nodejs.org), descarga la versión **LTS** (20 o más nueva) para Windows e instálala con las opciones por defecto.
2. Cierra y vuelve a abrir PowerShell y comprueba que quedó instalado:

   ```powershell
   node -v
   npm -v
   ```

   `node -v` debe mostrar `v20.x.x` o mayor.

### 2. Crea una base de datos PostgreSQL gratis en Neon

El bot usa el controlador de Neon (`@neondatabase/serverless`), así que **la opción recomendada (y la que funciona sin configurar nada más) es [Neon](https://neon.tech)**. Un PostgreSQL instalado en tu computadora no se conecta con este controlador.

1. Crea una cuenta en [neon.tech](https://neon.tech) (puedes entrar con Google o GitHub) y crea un proyecto. Elige la región más cercana a donde vaya a correr el bot.
2. En el panel del proyecto pulsa **Connect** y copia la **connection string**. Se ve así:

   ```text
   postgresql://usuario:contrasena@ep-algo-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

   Guárdala: va en `DATABASE_URL`.

### 3. Crea la aplicación y el bot en Discord

1. Entra a [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**, ponle nombre y acepta.
2. **General Information**: copia el **Application ID** → va en `DISCORD_CLIENT_ID`.
3. **Bot**:
   - Pulsa **Reset Token** y copia el token → va en `DISCORD_TOKEN`. Es secreto: si alguien lo ve, genera otro.
   - En **Privileged Gateway Intents** activa **Server Members Intent** y **Message Content Intent** y pulsa **Save Changes**. Sin el primero el bot no se entera de quién entra (bienvenidas y anti-raid); sin el segundo no puede leer los comandos con prefijo (`&bal`, comandos personalizados...).
4. **OAuth2**:
   - En **Client Secret** pulsa **Reset Secret** y cópialo → va en `DISCORD_CLIENT_SECRET`.
   - En **Redirects** pulsa **Add Redirect**, escribe exactamente esta URL y guarda:

     ```text
     http://localhost:5000/auth/discord/callback
     ```

     Cuando lo subas a un hosting agrega también `https://tu-dominio/auth/discord/callback` (tiene que coincidir con `APP_URL`).

### 4. Invita el bot a tu servidor

Usa este enlace cambiando `TU_CLIENT_ID` por tu Application ID (scopes `bot` y `applications.commands`, con los permisos que usa el bot):

```text
https://discord.com/oauth2/authorize?client_id=TU_CLIENT_ID&scope=bot%20applications.commands&permissions=19009793944694
```

Ese número incluye: Ver canales, Enviar mensajes, Enviar mensajes en hilos, Crear hilos públicos, Insertar enlaces, Adjuntar archivos, Leer el historial, Añadir reacciones, Mencionar @everyone, Gestionar mensajes, Gestionar canales, Gestionar roles, Gestionar servidor, Expulsar, Banear, Aislar temporalmente miembros, Gestionar eventos y Crear eventos. (También puedes armarlo tú en **OAuth2 → URL Generator**.)

Después, en **Ajustes del servidor → Roles**, arrastra el rol del bot **por encima** de los roles que quieras que dé automáticamente (rol de bienvenida) o que deba poder moderar.

### 5. Configura el `.env`

1. Abre PowerShell en la carpeta del proyecto (en el Explorador de archivos: clic derecho dentro de la carpeta → **Abrir en Terminal**).
2. Copia el archivo de ejemplo:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

3. Llena los valores con lo que copiaste: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DATABASE_URL` y una `SESSION_SECRET` larga y aleatoria. Para generarla:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Deja `APP_URL` y `FRONTEND_URL` en `http://localhost:5000` mientras lo pruebes en tu computadora. Cada variable está explicada dentro de `.env.example`.

### 6. Instala, crea las tablas y arranca

```powershell
npm install
npm run db:push
npm run dev
```

- `npm run db:push` crea (o actualiza) las tablas en Neon. Vuelve a ejecutarlo **cada vez que actualices el bot**, antes de arrancarlo. Si alguna vez te pregunta por borrar datos, lee con calma qué tabla o columna menciona antes de aceptar.
- Con `npm run dev` abre [http://localhost:5000](http://localhost:5000), inicia sesión con Discord y elige tu servidor. En la consola debe aparecer `🤖 Discord bot ready as ...`.
- Los comandos de barra (`/bienvenida`, `/pregunta-del-dia`...) pueden tardar unos minutos en aparecer en Discord la primera vez.

Para dejarlo corriendo "en serio" (por ejemplo en un hosting), compila y arranca en modo producción:

```powershell
npm run build
npm start
```

En producción usa HTTPS, pon tu dominio en `APP_URL` y `FRONTEND_URL`, y agrega el redirect de ese dominio en Discord (paso 3).

**Si algo falla al arrancar:**

- `Falta SESSION_SECRET` o `DATABASE_URL must be set`: el `.env` no está en la carpeta del proyecto o le falta ese valor.
- `An invalid token was provided` / `TokenInvalid`: el `DISCORD_TOKEN` está mal copiado; genera otro en Bot → Reset Token.
- `Used disallowed intents`: falta activar los dos intents del paso 3.
- El login de Discord dice `Invalid OAuth2 redirect_uri`: la URL de Redirects no coincide exactamente con `APP_URL` + `/auth/discord/callback`.

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
