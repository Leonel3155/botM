# BotM

BotM es un bot de Discord con su propio **panel web en español** para administrar tu servidor. El bot da la bienvenida a quien entra, publica una pregunta del día para animar la plática, reparte XP y monedas por participar, trae juegos de casino con monedas virtuales, ayuda al staff a moderar y protege el servidor de raids (entradas masivas de cuentas para llenarlo de spam). Desde el panel, que abres en el navegador e inicias sesión con tu cuenta de Discord, configuras todo eso sin escribir comandos y ves estadísticas reales de tu servidor. Todo corre en un solo programa: al arrancarlo se encienden el bot y el panel a la vez.

**Contenido**

- [Qué hace](#qué-hace)
- [Requisitos](#requisitos)
- [Instalación paso a paso (Windows)](#instalación-paso-a-paso-windows)
- [Variables de entorno](#variables-de-entorno)
- [Comandos](#comandos)
- [Problemas comunes](#problemas-comunes)
- [Actualizar BotM](#actualizar-botm)
- [Producción (hosting)](#producción-hosting)
- [Bueno saber](#bueno-saber)
- [Dónde está cada cosa](#dónde-está-cada-cosa)

---

## Qué hace

### 👋 Comunidad

- **Bienvenida**: cuando alguien entra, el bot publica un mensaje con su avatar en el canal que elijas y, si quieres, le da un rol automático (si el servidor pide aceptar las reglas, el rol se da al aceptarlas). El texto se puede personalizar con `{usuario}`, `{nombre}`, `{servidor}` y `{miembros}`. Por seguridad no acepta como rol automático uno con permisos de moderación o administración, y si entran más de 8 personas en un minuto deja de saludar para no inundar el canal.
- **Pregunta del día**: una vez al día, a la hora y en la zona horaria de tu servidor (por defecto `America/Mexico_City`, a las 18:00), publica una pregunta para romper el hielo y abre un hilo para las respuestas. Trae 80 preguntas (videojuegos, música, comida, "¿qué prefieres…?", hipotéticas…) y no repite ninguna hasta usarlas todas, aunque reinicies el bot.
- **`/anuncio`**: publica un anuncio bonito con título, texto, imagen, color y, si quieres, mención a `@everyone`, `@here` o un rol.
- **`/evento`**: crea un evento de Discord (en un canal de voz o en un lugar externo) y lo anuncia con un botón para marcar "Me interesa".

### 📊 Niveles y prestigio

- Cada mensaje da entre 15 y 25 XP (solo cuenta un mensaje por minuto por persona, así el spam no sirve). Cada nivel pide 10 % más XP que el anterior.
- Al subir de nivel se ganan monedas (nivel² × 50) y boletos si la economía está prendida, y el bot lo anuncia en el chat (puedes apagar esos avisos en el panel).
- Desde el nivel 100 se puede usar `/prestige`: vuelves al nivel 1 y ganas +10 % de XP por mensaje en cada prestigio (máximo +100 %).

### 💰 Economía y juegos

- Monedas virtuales con cartera y banco (lo del banco no te lo pueden robar). Se ganan platicando, con `/daily`, `/work`, `/crime`… y se pueden regalar, depositar o intentar robar.
- Juegos: blackjack, tragamonedas, ruleta europea, dado y ruleta rusa.
- Comandos de administración para dar, quitar o reiniciar monedas.
- Puedes apagar toda la economía desde el panel: los comandos avisan que está desactivada y la gente solo gana XP.
- También se juntan boletos de lotería, pero **todavía no hay sorteos**: por ahora solo se acumulan.

### 🔨 Moderación

- `/clear`, `/kick`, `/ban` (también a alguien que ya se fue, con su ID), `/mute` (con el aislamiento temporal de Discord, hasta 1 semana), `/unmute`, `/lockdown` (bloquea el canal y al desbloquear deja los permisos como estaban) y `/warn` / `/warnings`.
- Cada comando pide su propio permiso de Discord, y nadie puede usarlos contra alguien con un rol igual o más alto que el suyo (el dueño del servidor sí).
- Cada acción queda guardada y la ves en el panel, en **Moderación**.

### 🛡️ Anti-raid

- Detecta cuando entran muchas cuentas en pocos segundos (por defecto 8 en 15 s) y activa el "modo raid" por unos minutos.
- Tú eliges qué hacer: solo avisar al staff, subir el nivel de verificación del servidor al máximo, o lockdown (verificación al máximo y expulsar a quien entre mientras dure).
- Avisa en el canal que elijas (si no eliges, en el canal de moderación o un canal privado de logs del staff; si no hay ninguno, por mensaje directo al dueño).
- Se configura con `/antiraid` o desde el panel, en **Seguridad**, donde también ves el historial de raids. Si el bot se reinicia en pleno modo raid, lo retoma.

### 💬 Comandos personalizados

- Desde el panel creas respuestas propias: si alguien escribe `&reglas` (con el prefijo de tu servidor), el bot responde el texto que guardaste.
- Variables: `{usuario}`, `{nombre}`, `{servidor}`, `{canal}` y `{miembros}`. Hasta 50 por servidor, con una espera de 5 segundos por persona.
- Nunca mencionan a `@everyone`, `@here` ni a roles, y no pueden usar nombres de comandos del bot (como `bal` o `help`).

### 🌐 Redes (Reddit)

- Feeds que comparten imágenes de un subreddit en un canal cada cierto tiempo (de 1 a 1440 minutos). Nunca publica contenido NSFW. Hasta 10 feeds por servidor.
- Twitter/X no está disponible: el bot no publica nada de ahí.

### 🖥️ Panel web

Inicias sesión con Discord y solo ves los servidores donde eres dueño o tienes **Administrador** o **Gestionar servidor**. Secciones:

| Sección | Para qué sirve |
| --- | --- |
| **Resumen** | Estado del bot, números del servidor, cómo van la bienvenida, la pregunta del día y el anti-raid, top de niveles y últimas acciones de moderación. |
| **Estadísticas** | Gráficas de cómo se reparten los niveles, quién tiene más monedas, y la moderación y las alertas de raid de los últimos 30 días. |
| **Servidores** | Elige con qué servidor trabajar e invita al bot a los que todavía no lo tienen. |
| **Bienvenida y pregunta del día** | Canal, mensaje y rol de bienvenida (con prueba); canal, hora y zona de la pregunta del día (con "publicar ahora"). |
| **Niveles** | Ranking, cómo se reparten los niveles, reglas de XP y el interruptor de avisos al subir de nivel. |
| **Economía** | Ranking de monedas, totales y el interruptor para prender o apagar la economía. |
| **Redes sociales** | Crear, editar, pausar y borrar feeds de Reddit. |
| **Moderación** | Historial de lo que hizo el staff con los comandos del bot. |
| **Seguridad** | Prender y configurar el anti-raid, terminar un modo raid y ver el historial. |
| **Comandos personalizados** | Crear, editar, activar y borrar tus comandos. |
| **Canales** | Canal de bienvenida, canal por defecto de Reddit y canal de moderación (donde llegan las alertas de raid). |
| **Ajustes** | Prefijo de los comandos (por defecto `&`), tu cuenta (cerrar sesión) y el estado del bot. |

---

## Requisitos

- **Windows 10 u 11** (también funciona en Mac y Linux, pero esta guía usa Windows).
- **Node.js 20.11 o más nuevo.** Lo más fácil es instalar la versión **LTS** que te ofrezca nodejs.org.
- **Git**, para descargar y actualizar el proyecto (si prefieres, puedes bajar el ZIP desde GitHub).
- **Una base de datos PostgreSQL.** Sirve cualquiera: [Neon](https://neon.tech) en la nube (el plan gratis alcanza y es lo más fácil), un PostgreSQL instalado en tu computadora, o un proveedor como Supabase o Railway. En el [paso 3](#3-crea-la-base-de-datos) están las opciones.
- **Una cuenta de Discord** y un servidor donde seas dueño o administrador.

Necesitas unos 30 minutos. No hace falta pagar nada.

---

## Instalación paso a paso (Windows)

Todo se hace desde el navegador y desde **PowerShell** (búscalo en el menú Inicio).

### 1. Instala Node.js y Git

1. Entra a [nodejs.org](https://nodejs.org), descarga el instalador **LTS** para Windows (el archivo `.msi`) e instálalo con las opciones por defecto. La casilla de "herramientas adicionales" (Chocolatey) no hace falta.
2. Entra a [git-scm.com](https://git-scm.com/download/win), descarga **Git for Windows** e instálalo con las opciones por defecto.

   (Si te gusta usar `winget`, también sirve: `winget install OpenJS.NodeJS.LTS` y `winget install Git.Git`.)
3. **Cierra y vuelve a abrir PowerShell** y comprueba que todo quedó instalado:

   ```powershell
   node -v
   npm -v
   git --version
   ```

   `node -v` debe mostrar `v20.11` o un número mayor (por ejemplo `v22.x.x`).

> Si `npm -v` muestra un error en rojo que dice que **la ejecución de scripts está deshabilitada**, mira [este problema](#npm-no-funciona-en-powershell-ejecución-de-scripts-deshabilitada).

### 2. Descarga el proyecto

En PowerShell, ve a la carpeta donde quieras guardarlo (por ejemplo Documentos) y clónalo:

```powershell
cd $HOME\Documents
git clone https://github.com/Leonel3155/botM.git
cd botM
```

Si el repositorio es privado, Git abrirá una ventana para que inicies sesión en GitHub. A partir de aquí, **todos los comandos se ejecutan dentro de la carpeta `botM`**. Un truco: en el Explorador de archivos, abre la carpeta, haz clic derecho en un espacio vacío y elige **Abrir en Terminal** (en Windows 10: Shift + clic derecho → **Abrir la ventana de PowerShell aquí**).

### 3. Crea la base de datos

BotM guarda los niveles, las monedas y los ajustes en una base PostgreSQL. Elige **una** de estas opciones; al final de cualquiera tendrás una dirección (la *connection string*) que va en `DATABASE_URL`. Es secreta: tiene la contraseña de tu base.

BotM decide solo cómo conectarse: si la dirección es de Neon (termina en `.neon.tech`) usa el controlador de Neon, y con cualquier otra usa el controlador normal de PostgreSQL. No tienes que configurar nada más.

> ¿Ya tenías BotM corriendo con otra base y quieres conservar niveles, monedas y ajustes? Usa la connection string de **esa** base en lugar de crear una nueva, y lee con calma el paso 6.

#### Opción A: Neon (en la nube, gratis; la más fácil)

1. Crea una cuenta en [neon.tech](https://neon.tech) (puedes entrar con Google o GitHub).
2. Crea un proyecto (por ejemplo `botm`) y elige la región más cercana a donde vaya a correr el bot.
3. En el panel del proyecto pulsa **Connect** y copia la **connection string**. Se ve más o menos así:

   ```text
   postgresql://usuario:contrasena@ep-algo-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

   Guárdala: es tu `DATABASE_URL`.

#### Opción B: PostgreSQL instalado en tu computadora (Windows)

1. Entra a [postgresql.org/download/windows](https://www.postgresql.org/download/windows/), pulsa **Download the installer** (el de EDB) y descarga la versión más nueva.
2. Instálalo con las opciones por defecto. Te pedirá una **contraseña para el usuario `postgres`**: invéntala y apúntala. Deja el puerto en **5432**. Al terminar puedes cerrar *Stack Builder* sin instalar nada.
3. Abre **SQL Shell (psql)** desde el menú Inicio. Pulsa Enter en cada pregunta (`Server`, `Database`, `Port`, `Username`) y escribe tu contraseña cuando la pida (no se ve mientras escribes). Si sale un aviso sobre *code page*, ignóralo. Crea la base con:

   ```sql
   CREATE DATABASE botm;
   ```

   Debe responder `CREATE DATABASE`. Escribe `\q` y Enter para salir.
4. Tu `DATABASE_URL` queda así (cambia `TU_CONTRASENA` por la del paso 2):

   ```text
   postgresql://postgres:TU_CONTRASENA@localhost:5432/botm
   ```

   Sin `?sslmode=require` al final: un PostgreSQL en tu computadora no lo necesita.

PostgreSQL queda como un servicio de Windows que arranca solo con la computadora. Si alguna vez BotM dice que nadie responde en la base, búscalo en **Servicios** (se llama `postgresql-x64-…`) e inícialo.

#### Opción C: Supabase, Railway, Docker u otro proveedor

Copia la connection string (URI) que te da el proveedor:

- **Supabase**: botón **Connect** → la de **Session pooler** (la *Direct connection* solo funciona si tu internet tiene IPv6). Cambia `[YOUR-PASSWORD]` por la contraseña de tu base.
- **Railway**: en el servicio de PostgreSQL, pestaña **Variables**, la `DATABASE_PUBLIC_URL` (la `DATABASE_URL` de Railway solo funciona para programas que corren dentro de Railway).
- **Docker**: `docker run --name botm-db -e POSTGRES_PASSWORD=TU_CONTRASENA -e POSTGRES_DB=botm -p 5432:5432 -d postgres:16` y usa `postgresql://postgres:TU_CONTRASENA@localhost:5432/botm`.

Si al conectar sale `self-signed certificate in certificate chain`, cambia `sslmode=require` por `sslmode=no-verify` al final de la dirección (la conexión sigue cifrada, solo no se comprueba el certificado del proveedor).

> **Contraseñas con símbolos:** si tu contraseña tiene `@`, `:`, `/`, `#`, `?` o `%`, en la dirección hay que escribirlos codificados (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`, `?` → `%3F`, `%` → `%25`). Lo más fácil es usar una contraseña de solo letras y números.

### 4. Crea la aplicación en Discord Developer Portal

1. Entra a [discord.com/developers/applications](https://discord.com/developers/applications) y pulsa **New Application**. Ponle nombre (por ejemplo `BotM`) y acepta.
2. En **General Information** copia el **Application ID** (un número largo). Va en `DISCORD_CLIENT_ID` y en `VITE_DISCORD_CLIENT_ID`.
3. En **Bot**:
   - Pulsa **Reset Token** y copia el token. Va en `DISCORD_TOKEN`. **Es secreto**: si alguien lo ve, vuelve a pulsar Reset Token.
   - En **Privileged Gateway Intents** activa **Server Members Intent** y **Message Content Intent**, y pulsa **Save Changes**. Son obligatorios: sin ellos el bot no puede conectarse. (Presence Intent no hace falta.)
   - Deja **apagado** "Requires OAuth2 Code Grant".
   - "Public Bot" es opcional: si lo apagas, solo tú puedes invitar al bot. (Si Discord no te deja apagarlo, primero ve a **Installation** y en *Install Link* elige *None*.)
4. En **OAuth2**:
   - En **Client Secret** pulsa **Reset Secret** y cópialo. Va en `DISCORD_CLIENT_SECRET`. También es secreto.
   - En **Redirects** pulsa **Add Redirect**, pega **exactamente** esta URL y guarda los cambios:

     ```text
     http://localhost:5000/auth/discord/callback
     ```

     El servidor arma esa dirección como `APP_URL` + `/auth/discord/callback`. Si cambias `APP_URL` o `PORT`, cambia también este redirect para que coincidan letra por letra (`localhost` no es lo mismo que `127.0.0.1`, ni `http` que `https`).

### 5. Configura los archivos `.env`

BotM usa **dos** archivos de configuración. Créalos a partir de los ejemplos (así no terminan llamándose `.env.txt` por accidente):

```powershell
Copy-Item .env.example .env
Copy-Item client\.env.example client\.env
notepad .env
```

Llena el `.env` (el de la carpeta principal) con lo que copiaste, sin comillas ni espacios alrededor del `=`:

```dotenv
DISCORD_TOKEN=el_token_del_bot
DISCORD_CLIENT_ID=tu_application_id
DISCORD_CLIENT_SECRET=el_client_secret
DATABASE_URL=la_connection_string_del_paso_3
SESSION_SECRET=una_clave_aleatoria_larga
APP_URL=http://localhost:5000
FRONTEND_URL=http://localhost:5000
PORT=5000
```

Para `SESSION_SECRET` genera una clave aleatoria con este comando y pega el resultado:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Recomendado mientras pruebas:** pon en `DISCORD_DEV_GUILD_ID` el ID de tu servidor y los comandos aparecerán al instante (si no, Discord puede tardar en mostrarlos). Ojo: mientras esté puesto, con `npm run dev` los comandos solo aparecen en ese servidor (o en los que pongas, separados por comas). Para copiar el ID: en Discord ve a **Ajustes de usuario → Avanzado** y activa **Modo desarrollador**; luego clic derecho en el ícono de tu servidor → **Copiar ID del servidor**.

Guarda y cierra el Bloc de notas. Después abre el otro archivo:

```powershell
notepad client\.env
```

y pon tu Application ID (el mismo número que `DISCORD_CLIENT_ID`):

```dotenv
VITE_DISCORD_CLIENT_ID=tu_application_id
```

Con esto funciona el botón **Invitar bot** del panel. En [Variables de entorno](#variables-de-entorno) está la lista completa de qué es cada cosa.

> Cada vez que cambies un `.env`, detén el programa (Ctrl + C en PowerShell) y vuelve a arrancarlo para que tome los cambios.

### 6. Instala las dependencias y crea las tablas

```powershell
npm install
npm run db:push
```

- `npm install` descarga todo lo que necesita el proyecto (crea la carpeta `node_modules`). Tarda unos minutos y es normal que muestre avisos amarillos (`warn` / `deprecated`).
- `npm run db:push` crea o actualiza las tablas en tu base de datos (lee `DATABASE_URL` del `.env`). Con una base **nueva** no pregunta nada y termina con `[✓] Changes applied`. Si lo vuelves a correr y no hay nada que cambiar, dice `[i] No changes detected`: también está bien.

**Si usas una base que ya tenía datos de una versión anterior de BotM**, puede hacerte preguntas en inglés. Te mueves con las flechas ↑ ↓ y eliges con Enter:

| Si pregunta… | Elige | Por qué |
| --- | --- | --- |
| `You're about to add custom_commands_guild_name_unique unique constraint to the table… Do you want to truncate custom_commands table?` | **`No, add the constraint without truncating the table`** | "Truncate" **borraría todos tus comandos personalizados**. Solo se agrega una regla para que no haya dos comandos con el mismo nombre. |
| `You're about to delete music_queue table with N items` … `Do you still want to push changes?` (y es la **única** tabla de la lista) | **`Yes, I want to remove 1 table`** | Es la cola de la música vieja. La música ya no existe en BotM y nada usa esa tabla. |
| `Is … table created or renamed from another table?` (o lo mismo con `column`) | La opción que empieza con **`+`** (*create*) | Son tablas o columnas nuevas, no renombradas. |
| Cualquier otra cosa que diga que va a borrar (`delete`, `remove`) otra tabla o columna, o `truncate` | **`No, abort`** | Así no se pierde nada. Pide ayuda antes de seguir (y mira [Problemas comunes](#npm-run-dbpush-falla)). |

### 7. Arranca BotM

```powershell
npm run dev
```

En la consola deberías ver, entre otras, estas líneas (el orden puede variar un poco):

```text
🗄️ Base de datos: controlador PostgreSQL estándar (node-postgres)
… [express] serving on 127.0.0.1:5000
🖥️ Panel web listo en http://localhost:5000
✅ Conectado a la base de datos
✅ … comandos de barra registrados …
🤖 Bot de Discord listo como BotM#1234
```

Con Neon la primera línea dice `controlador de Neon (WebSocket)`. Si alguna línea sale con ❌, mira [Problemas comunes](#problemas-comunes): el mensaje dice qué falta. El panel se abre aunque el bot o la base de datos fallen, para que veas el error con calma.

Si Windows pregunta si permites que Node.js use la red, basta con **Redes privadas** (para usar el panel en tu computadora ni siquiera hace falta).

**Deja esa ventana de PowerShell abierta**: si la cierras (o pulsas Ctrl + C), el bot y el panel se apagan.

### 8. Invita al bot y entra al panel

1. Abre [http://localhost:5000](http://localhost:5000) en el navegador. Usa exactamente la misma dirección que pusiste en `APP_URL`.
2. Pulsa **Iniciar sesión con Discord** y acepta. El panel solo pide ver tu perfil y tu lista de servidores (`identify` y `guilds`).
3. Ve a **Servidores** y pulsa **Invitar bot** en tu servidor. Discord te muestra los permisos que pide el bot: acepta.

   Si el botón está gris es que falta `VITE_DISCORD_CLIENT_ID` en `client\.env` (y reiniciar `npm run dev`). También puedes invitarlo a mano con este enlace, cambiando `TU_APPLICATION_ID`:

   ```text
   https://discord.com/oauth2/authorize?client_id=TU_APPLICATION_ID&scope=bot+applications.commands&permissions=1486330784886
   ```

   Ese número de permisos es el mismo que arma el panel e incluye: Ver canales, Enviar mensajes, Enviar mensajes en hilos, Crear hilos públicos, Crear hilos privados, Insertar enlaces, Adjuntar archivos, Leer el historial de mensajes, Añadir reacciones, Usar emojis externos, Mencionar @everyone, @here y todos los roles, Gestionar mensajes, Gestionar canales, Gestionar roles, Gestionar servidor, Gestionar eventos, Expulsar miembros, Banear miembros, Aislar temporalmente a miembros, Conectar y Hablar. (Conectar y Hablar no son para música: Discord pide Conectar para crear eventos en canales de voz con `/evento`, y el `/mute` de versiones viejas los usaba con el rol "Muteado".)
4. En Discord, ve a **Ajustes del servidor → Roles** y arrastra el rol del bot **por encima** del rol de bienvenida y de los roles de las personas que quieras poder expulsar, banear o silenciar. Si no, Discord no lo deja.
5. De vuelta en el panel, elige tu servidor y configura lo que quieras: **Canales**, **Bienvenida y pregunta del día**, **Seguridad**… En Discord escribe `/` para ver los comandos del bot. Para revisar que todo esté bien, usa `/selftest` (solo administradores).

¡Listo! 🎉

---

## Variables de entorno

Los ejemplos con todos los valores y comentarios están en [`.env.example`](.env.example) y [`client/.env.example`](client/.env.example). Nunca compartas tus `.env` ni los subas a GitHub (ya están en `.gitignore`).

**Archivo `.env` (carpeta principal):**

| Variable | ¿Obligatoria? | Qué es |
| --- | --- | --- |
| `DISCORD_TOKEN` | Sí | Token del bot (Developer Portal → Bot → Reset Token). Secreto. |
| `DISCORD_CLIENT_ID` | Sí | Application ID (Developer Portal → General Information). Se usa para registrar los comandos y para el login del panel. |
| `DISCORD_CLIENT_SECRET` | Sí | Client Secret (Developer Portal → OAuth2). Lo usa el login del panel. Secreto. |
| `DATABASE_URL` | Sí | Connection string de tu base PostgreSQL (Neon, una instalada en tu computadora, Supabase, Railway…; ver el [paso 3](#3-crea-la-base-de-datos)). Sin ella el programa no arranca. Secreta. |
| `SESSION_SECRET` | Sí | Clave aleatoria para firmar las sesiones del panel. Sin ella el programa no arranca; usa al menos 32 caracteres. |
| `APP_URL` | Recomendada | Dirección pública del servidor, sin `/` al final. Por defecto `http://localhost:` + `PORT`. Discord vuelve del login a `APP_URL/auth/discord/callback`. |
| `FRONTEND_URL` | Recomendada | Dirección del panel. Pon lo mismo que en `APP_URL` (el panel y el servidor van juntos). Por defecto, igual que `APP_URL`. |
| `PORT` | No | Puerto donde escucha el servidor. Por defecto `5000`. |
| `DISCORD_DEV_GUILD_ID` | No | ID de tu servidor de pruebas (o varios separados por comas). Con `npm run dev` los comandos se registran ahí al instante. Con `npm start`, si sigue puesto, el bot registra los comandos globales y borra las copias de prueba de esos servidores. |
| `DEV_BYPASS_AUTH` | No | Solo para desarrollo: con `1` aparece `/auth/dev-login`, que entra al panel **sin Discord** y deja ver todos los servidores del bot. Solo funciona con `npm run dev` y desde la misma computadora, entrando por `http://localhost`. Nunca lo actives en un servidor público. |
| `HOST` | No | Dirección de red donde escucha el servidor. Por defecto, con `npm run dev` solo se puede abrir desde tu computadora (`127.0.0.1`) y con `npm start` desde cualquier lado (`0.0.0.0`). Pon `HOST=0.0.0.0` si quieres abrir el panel de desarrollo desde tu celular en la misma red. |
| `DATABASE_DRIVER` | No | Fuerza el controlador de la base: `neon` o `pg`. Sin ella se elige solo: `neon` si `DATABASE_URL` es de Neon (`….neon.tech`) y `pg` (PostgreSQL normal) con cualquier otra. `pg` también funciona con Neon. Casi nunca hace falta. |
| `DB_POOL_MAX` | No | Conexiones a la base abiertas a la vez (por defecto `10`). Déjalo así. |
| `DB_CONNECTION_TIMEOUT_MS` | No | Cuánto esperar al abrir una conexión antes de dar error, en milisegundos (por defecto `10000`). |
| `DB_IDLE_TIMEOUT_MS` | No | Cierra las conexiones que llevan este tiempo sin usarse, en milisegundos (por defecto `30000`). |
| `DB_STATEMENT_TIMEOUT_MS` | No | Tiempo máximo de cada consulta, en milisegundos (por defecto `30000`; `0` = sin límite). |
| `GLOBAL_CONCURRENCY` | No | Cuántas tareas del bot pueden correr a la vez (por defecto `50`). Déjalo así. |
| `GLOBAL_TIMEOUT_MS` | No | Tiempo máximo de cada tarea del bot en milisegundos (por defecto `120000`). Déjalo así. |
| `TWITTER_BEARER_TOKEN` / `X_BEARER_TOKEN` | No | No se usan: Twitter/X está desactivado. |

`NODE_ENV` no va en el `.env`: `npm run dev` usa `development` y `npm start` usa `production` solos.

**Archivo `client/.env` (panel):**

| Variable | ¿Obligatoria? | Qué es |
| --- | --- | --- |
| `VITE_DISCORD_CLIENT_ID` | Recomendada | El mismo Application ID. Sirve para el botón **Invitar bot**. Es un dato público: termina dentro del panel que descarga el navegador, así que **aquí nunca pongas secretos**. Se lee al arrancar `npm run dev` o al hacer `npm run build`. |

---

## Comandos

Todos los comandos funcionan solo dentro de un servidor (no por mensaje directo). Los que tienen 🔒 solo los ven y usan quienes tienen ese permiso en Discord; como dueño del servidor puedes cambiarlo en **Ajustes del servidor → Integraciones → BotM**. Además, el bot hace su propia revisión cada vez que alguien los usa.

Las opciones entre `< >` son obligatorias y las de `[ ]` opcionales.

### Comunidad

| Comando | Qué hace | Quién |
| --- | --- | --- |
| `/bienvenida canal <canal>` | Elige el canal donde se da la bienvenida. | 🔒 Gestionar servidor |
| `/bienvenida mensaje [texto]` | Cambia el texto de bienvenida (vacío = el predeterminado). Usa `{usuario}`, `{nombre}`, `{servidor}`, `{miembros}` y `\n` para saltos de línea. | 🔒 Gestionar servidor |
| `/bienvenida rol [rol]` | Rol automático al entrar (vacío = ninguno). No acepta roles con permisos de moderación. | 🔒 Gestionar servidor + Gestionar roles |
| `/bienvenida activar` · `/bienvenida desactivar` | Prende o apaga la bienvenida. | 🔒 Gestionar servidor |
| `/bienvenida probar [publicar]` | Vista previa con tu usuario y revisión de permisos (con `publicar` la manda al canal). | 🔒 Gestionar servidor |
| `/pregunta-del-dia canal <canal> [hilo]` | Canal de la pregunta del día y si abre un hilo para responder. | 🔒 Gestionar servidor |
| `/pregunta-del-dia hora <hora>` | Hora de publicación, de 0 a 23, en la hora del servidor (por defecto 18). | 🔒 Gestionar servidor |
| `/pregunta-del-dia zona <zona>` | Zona horaria del servidor, p. ej. `America/Mexico_City`, `America/Bogota`, `Europe/Madrid` (también entiende `CDMX`, `Colombia`, `España`…). También la usa `/evento`. | 🔒 Gestionar servidor |
| `/pregunta-del-dia activar` · `/pregunta-del-dia desactivar` | Prende o apaga la pregunta del día. | 🔒 Gestionar servidor |
| `/pregunta-del-dia ahora` | Publica una pregunta en este momento (cuenta como la de hoy). | 🔒 Gestionar servidor |
| `/pregunta-del-dia estado` | Muestra la configuración y cuándo sale la siguiente. | 🔒 Gestionar servidor |
| `/anuncio <titulo> <mensaje> [canal] [mencion] [rol] [imagen] [color]` | Publica un anuncio. Color: `rojo`, `morado`, `#FF8800`… Solo publica donde tú también puedes escribir. | 🔒 Gestionar servidor |
| `/evento crear <nombre> <fecha> […]` | Crea un evento de Discord y lo anuncia con botón "Me interesa". Fecha: `AAAA-MM-DD HH:mm` o `DD/MM/AAAA HH:mm` en la zona del servidor. Opciones: descripción, duración, lugar, canal de voz, canal del anuncio, mención y si se anuncia. | 🔒 Gestionar eventos (o Crear eventos / Gestionar servidor) |
| `/evento lista` | Muestra los próximos eventos del servidor. | Todos |

### Niveles y prestigio

| Comando | Qué hace | Quién |
| --- | --- | --- |
| `/level [usuario]` | Tu nivel, XP, puesto y progreso (o los de otra persona). | Todos |
| `/lv [usuario]` | Atajo de `/level`. | Todos |
| `/lb [limite]` | Ranking de niveles del servidor (hasta 25 personas). | Todos |
| `/prestige` | Desde el nivel 100: vuelves al nivel 1 a cambio de más XP para siempre. Pide confirmación. | Todos |
| `/levelrewards` | Qué ganas al subir de nivel. | Todos |
| `/xpinfo` | Cómo funciona el XP y el prestigio. | Todos |

### Economía

Si apagas la economía desde el panel, estos comandos solo avisan que está desactivada.

| Comando | Qué hace | Quién |
| --- | --- | --- |
| `/balance [usuario]` | Cartera y banco tuyos o de otra persona. | Todos |
| `/daily` | Recompensa diaria (500 monedas + 10 por nivel). Cada 24 h; la racha se pierde si pasan más de 48 h. | Todos |
| `/work [trabajo]` | Trabaja para ganar monedas. Una vez por hora. | Todos |
| `/crime` | Arriesgas el 20 % de tu cartera; sale bien la mitad de las veces. Cada 2 h. | Todos |
| `/slut` | "Trabajo nocturno" de alto riesgo y mejor paga. Cada 2 h. | Todos |
| `/rob <usuario>` | Intenta robar de la cartera de alguien; si te atrapan pagas multa. Cada 4 h. | Todos |
| `/give <usuario> <cantidad>` | Regala monedas de tu cartera. | Todos |
| `/deposit <cantidad>` | Guarda monedas en el banco (número o `todo`). | Todos |
| `/withdraw <cantidad>` | Saca monedas del banco (número o `todo`). | Todos |
| `/leaderboard [limite]` | Ranking de quién tiene más monedas (cartera + banco). | Todos |
| `/economy-stats` | Estadísticas de la economía del servidor. | Todos |
| `/add-money <usuario> <cantidad>` | Da monedas a alguien. | 🔒 Administrador |
| `/remove-money <usuario> <cantidad>` | Quita monedas de la cartera de alguien (número o `todo`). | 🔒 Administrador |
| `/reset-money <usuario>` | Deja en cero la cartera y el banco de alguien. | 🔒 Administrador |
| `/add-money-role <rol> <cantidad>` | Da monedas a todas las personas con un rol. | 🔒 Administrador |

### Juegos (usan las monedas de la cartera)

También se apagan si desactivas la economía.

| Comando | Qué hace | Quién |
| --- | --- | --- |
| `/blackjack <cantidad>` | Blackjack contra el bot (número o `todo`). Gana 1:1; blackjack natural paga 3:2. | Todos |
| `/slots <cantidad>` | Tragamonedas. | Todos |
| `/ruleta <apuesta> <cantidad>` | Ruleta europea: un número del 0 al 36 (paga x36) o `rojo`, `negro`, `par`, `impar` (pagan x2). | Todos |
| `/dado [cantidad]` | Tira un dado: si sale 6 ganas 6 veces lo apostado. Sin cantidad, solo por diversión. | Todos |
| `/ruleta-rusa [camaras]` | Apuestas **toda** tu cartera. De 2 a 12 cámaras (por defecto 6): con más cámaras es más seguro pero ganas menos. | Todos |

### Moderación

Además del permiso de Discord, el bot pide que quien lo usa tenga un rol llamado **Moderador**, **Admin** o **Staff**, o algún permiso de moderación.

| Comando | Qué hace | Quién |
| --- | --- | --- |
| `/clear <cantidad>` | Borra de 1 a 100 mensajes del canal (Discord no deja borrar así mensajes de más de 14 días). | 🔒 Gestionar mensajes |
| `/kick <usuario> [razon]` | Expulsa a un miembro. | 🔒 Expulsar miembros |
| `/ban <usuario> [razon]` | Banea a un miembro. | 🔒 Banear miembros |
| `/mute <usuario> <minutos>` | Aísla temporalmente al miembro (no puede escribir, hablar ni reaccionar), hasta 1 semana. Discord lo quita solo al cumplirse el tiempo, aunque el bot se reinicie. | 🔒 Aislar temporalmente a miembros |
| `/unmute <usuario>` | Quita el aislamiento antes de tiempo (o el rol "Muteado" de versiones viejas). | 🔒 Aislar temporalmente a miembros |
| `/lockdown <accion>` | Bloquea (o desbloquea) el canal actual y sus hilos para que solo el staff escriba. | 🔒 Gestionar canales |
| `/warn <usuario> [razon]` | Registra una advertencia. | 🔒 Aislar temporalmente a miembros |
| `/warnings <usuario>` | Historial de advertencias y otras acciones de alguien. | 🔒 Aislar temporalmente a miembros |

### Seguridad y diagnóstico

| Comando | Qué hace | Quién |
| --- | --- | --- |
| `/antiraid status` | Estado y configuración del anti-raid, y si hay un modo raid activo. | 🔒 Gestionar servidor |
| `/antiraid activar` · `/antiraid desactivar` | Prende o apaga la protección (desactivar también termina un modo raid activo). | 🔒 Gestionar servidor |
| `/antiraid configurar […]` | Ajusta cuántas entradas (`entradas`, 3-100) en cuántos segundos (`segundos`, 5-300) cuentan como raid, la `accion`, el `canal` de alertas, la `duracion` del modo raid (1-1440 min) y la `edad_cuenta` mínima (0-365 días). | 🔒 Gestionar servidor |
| `/antiraid levantar` | Termina ahora el modo raid activo. | 🔒 Gestionar servidor |
| `/selftest` | Revisa la base de datos, los comandos registrados y los permisos del bot. | 🔒 Administrador |

### Comandos con prefijo

Se escriben como mensaje normal. El prefijo por defecto es `&` y lo puedes cambiar en el panel (**Ajustes**, de 1 a 5 caracteres). Necesitan el **Message Content Intent** activado. Los de economía también se apagan si desactivas la economía.

| Comando | Qué hace |
| --- | --- |
| `&bal [@alguien]` · `&balance` | Saldo (cartera y banco). |
| `&daily` | Recompensa diaria. |
| `&dep <cantidad\|todo>` · `&deposit` | Depositar en el banco. |
| `&with <cantidad\|todo>` · `&withdraw` | Retirar del banco. |
| `&lot` · `&lottery` | Cuántos boletos tienes (todavía no hay sorteos). |
| `&lv [@alguien]` · `&level` · `&rank` | Nivel y puesto. |
| `&lb [cantidad]` · `&leaderboard` | Ranking de niveles (hasta 25). |
| `&help` · `&commands` · `&ayuda` | Lista de comandos rápidos. |

Tus **comandos personalizados** también se usan con el prefijo (por ejemplo `&reglas`).

### Solo en desarrollo

Con `npm run dev` se registran además dos comandos de prueba, solo para administradores: `/stress` (prueba de carga de las colas del bot) y `/oauth-test` (enlaces para probar el login del panel). Con `npm start` el bot no los registra ni los atiende.

---

## Problemas comunes

### npm no funciona en PowerShell (ejecución de scripts deshabilitada)

Si al escribir `npm` aparece algo como *"No se puede cargar el archivo …\npm.ps1 porque la ejecución de scripts está deshabilitada en este sistema"*, ejecuta esto una vez en PowerShell y acepta con `S` (o `Y`):

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Cierra y vuelve a abrir PowerShell. Otra opción es escribir `npm.cmd` en lugar de `npm`, o usar el **Símbolo del sistema** (cmd).

### El programa se cierra al arrancar

- `❌ Falta SESSION_SECRET en el archivo .env` o `SESSION_SECRET todavía tiene el texto de ejemplo`: genera una clave con el comando del paso 5 y pégala en el `.env`.
- `❌ Falta DATABASE_URL en el archivo .env`: falta `DATABASE_URL`, o el `.env` no está en la carpeta principal del proyecto (revisa que no se llame `.env.txt`: en el Explorador activa **Vista → Extensiones de nombre de archivo**).
- `❌ El puerto 5000 ya está en uso (EADDRINUSE)`: otro programa ya usa el puerto 5000 (¿dejaste otra ventana con BotM abierta?). Ciérralo, o cambia `PORT`, `APP_URL`, `FRONTEND_URL` y el redirect de Discord al nuevo puerto.
- `❌ No hay permiso para usar el puerto 5000 (EACCES)`: Windows a veces reserva ese puerto para sí mismo (pasa con Hyper-V o WSL). Usa otro, por ejemplo `PORT=3000`, y cambia también `APP_URL`, `FRONTEND_URL` y el redirect de Discord.
- `❌ BotM no pudo arrancar el servidor web`: copia el error completo que sale debajo y pide ayuda. Si usas `npm start`, primero ejecuta `npm run build`.

### La base de datos no conecta

Al arrancar, BotM prueba la base y escribe `✅ Conectado a la base de datos` o una línea `❌ No se pudo usar la base de datos (…)` que termina con qué hacer. Las más comunes:

- `password authentication failed` (`28P01`): el usuario o la contraseña de `DATABASE_URL` están mal. Si la contraseña tiene símbolos, mira la nota de [contraseñas con símbolos](#opción-c-supabase-railway-docker-u-otro-proveedor).
- `relation "guilds" does not exist` (`42P01`): la base está vacía. Ejecuta `npm run db:push` y reinicia BotM.
- `database "botm" does not exist` (`3D000`): falta crear la base (paso 3, opción B).
- `ECONNREFUSED`: PostgreSQL no está encendido, o el host o el puerto de `DATABASE_URL` están mal. En Windows búscalo en **Servicios** (`postgresql-x64-…`) e inícialo.
- `self-signed certificate`: cambia `sslmode=require` por `sslmode=no-verify` en `DATABASE_URL`.
- `The server does not support SSL connections`: tu PostgreSQL no usa SSL; quita `?sslmode=require` del final de `DATABASE_URL`.

Mientras la base no conecte, el panel abre pero sus secciones muestran errores. Corrige el `.env` y reinicia BotM.

### El bot aparece desconectado (offline)

El panel abre aunque el bot no se haya conectado. Busca en la consola la línea `❌ El bot de Discord no se pudo conectar.`: dice qué pasó (con el mensaje original de Discord entre comillas) y qué hacer:

- `Falta DISCORD_TOKEN en el archivo .env`: pega el token del bot en `DISCORD_TOKEN` (paso 4).
- `DISCORD_TOKEN no es válido ("An invalid token was provided.")`: el `DISCORD_TOKEN` está mal copiado. Genera otro en **Bot → Reset Token**.
- `Faltan los Privileged Gateway Intents ("Used disallowed intents")`: faltan **Server Members Intent** o **Message Content Intent** (Developer Portal → Bot → Privileged Gateway Intents → Save Changes). BotM necesita los dos: sin el primero no se entera de quién entra (bienvenida y anti-raid) y sin el segundo no lee los comandos con prefijo.
- `No se pudo llegar a Discord` o `Discord rechazó la conexión`: no hay internet, o un firewall, antivirus o proxy bloquea a Discord (o Discord está caído). El bot lo vuelve a intentar solo (cada vez espera un poco más, hasta 5 minutos), así que cuando se arregle se conecta sin reiniciar.
- No hay ningún error: recuerda que el bot vive dentro de `npm run dev`. Si cerraste PowerShell o la computadora se durmió, el bot se apaga.

Si el problema era el token o los intents, el bot no lo reintenta: corrige el `.env` o el Developer Portal y reinicia BotM (Ctrl + C y otra vez `npm run dev`).

### Los comandos `/` no aparecen

- Sin `DISCORD_DEV_GUILD_ID` los comandos se registran **globales** y Discord puede tardar unos minutos (a veces hasta una hora) en mostrarlos. Para verlos al instante pon el ID de tu servidor en `DISCORD_DEV_GUILD_ID` y reinicia `npm run dev`. También ayuda recargar Discord con **Ctrl + R**.
- Revisa la consola: debe decir `✅ … comandos de barra registrados …`. Si dice `❌ No se pudieron registrar los comandos`, casi siempre es que `DISCORD_CLIENT_ID` no es el Application ID de la **misma** aplicación que el token.
- Los comandos con 🔒 no se le muestran a quien no tiene el permiso: es a propósito.
- Si invitaste al bot con otro enlace, vuelve a invitarlo con el del paso 8 (necesita el scope `applications.commands`).

### Veo cada comando repetido dos veces

Pasa si se registraron globales **y** como comandos de prueba de tu servidor (`DISCORD_DEV_GUILD_ID`). El bot quita las copias de prueba al arrancar en modo producción mientras `DISCORD_DEV_GUILD_ID` sigue puesto: ejecuta una vez `npm run build` y `npm start` con esa variable puesta. En desarrollo, si dejas `DISCORD_DEV_GUILD_ID` puesto desde el principio, no se repiten.

### El login dice "El inicio de sesión caducó" (`invalid_state`)

El panel guarda una cookie al pulsar "Iniciar sesión" y la revisa cuando Discord te regresa. Falla si:

- **Abriste el panel con otra dirección distinta a `APP_URL`**. Por ejemplo entraste por `http://127.0.0.1:5000` pero `APP_URL` es `http://localhost:5000`: Discord te regresa a `localhost` y ahí no está la cookie. Entra siempre por la dirección exacta de `APP_URL`.
- Pasaron más de 10 minutos entre pulsar el botón y aceptar en Discord, o empezaste el login en dos pestañas a la vez. Vuelve a intentarlo desde una sola pestaña.
- Tu navegador bloquea las cookies de ese sitio.
- Estás usando `npm start` (producción) sin HTTPS: en producción las cookies solo viajan por HTTPS. Para probar en tu computadora usa `npm run dev`.

### Otros errores del login

- Discord muestra **`Invalid OAuth2 redirect_uri`**: el redirect del Developer Portal no coincide exactamente con `APP_URL` + `/auth/discord/callback` (revisa `http`/`https`, `localhost`/`127.0.0.1` y el puerto).
- El panel dice **"Discord no pudo confirmar tu inicio de sesión"** (`auth_failed`) y la consola muestra `Token exchange failed (401)`: el `DISCORD_CLIENT_SECRET` está mal. Genera otro en **OAuth2 → Reset Secret**.
- Sale **"El inicio de sesión con Discord no está configurado en el servidor"**: faltan `DISCORD_CLIENT_ID` o `DISCORD_CLIENT_SECRET` en el `.env`.
- Entras pero **no ves tu servidor**: solo aparecen los servidores donde eres dueño o tienes **Administrador** o **Gestionar servidor**. Si acabas de recibir el permiso, pulsa **Actualizar**.
- El panel dice **"El bot no está en este servidor"**: invítalo (paso 8).

### La bienvenida, el rol automático o el anti-raid no hacen nada

- Revisa que **Server Members Intent** esté activado (paso 4).
- El rol del bot debe estar **por encima** del rol de bienvenida (Ajustes del servidor → Roles).
- Usa `/bienvenida probar`: revisa la configuración y los permisos del bot en el canal.
- Para el anti-raid, revisa que esté **activado** en el panel (**Seguridad**) o con `/antiraid status`.

### `npm run db:push` falla

- `DATABASE_URL, ensure the database is provisioned`: falta `DATABASE_URL` en el `.env` (o el `.env` no está en la carpeta principal).
- Errores de conexión o contraseña (`password authentication failed`, `ENOTFOUND`, `ECONNREFUSED`…): vuelve a copiar la connection string (en Neon, desde **Connect**) y revisa que tu PostgreSQL esté encendido. Son los mismos casos de [La base de datos no conecta](#la-base-de-datos-no-conecta).
- `self-signed certificate in certificate chain` (o `DEPTH_ZERO_SELF_SIGNED_CERT`): cambia `sslmode=require` por `sslmode=no-verify` en `DATABASE_URL`.
- `The server does not support SSL connections`: quita `?sslmode=require` del final de `DATABASE_URL`.
- Las preguntas en inglés no se ven bien o no responden a las flechas: ejecútalo desde PowerShell o el Símbolo del sistema (no desde Git Bash).
- Con una base vieja, si sale un error que dice que la columna `enabled` o `post_interval` de `content_feeds` *contains null values*, abre el **SQL Editor** de Neon (con PostgreSQL en tu computadora, **SQL Shell (psql)** conectado a tu base: en `Database` escribe `botm`), ejecuta esto y vuelve a correr `npm run db:push`:

  ```sql
  UPDATE content_feeds SET enabled = true WHERE enabled IS NULL;
  UPDATE content_feeds SET post_interval = 30 WHERE post_interval IS NULL;
  ```

- Si sale un error de que no se pudo crear `custom_commands_guild_name_unique` porque una clave está *duplicated*, es que tienes dos comandos personalizados con el mismo nombre en un servidor. En el **SQL Editor** de Neon (o en SQL Shell) puedes dejar solo uno de cada nombre con esto y luego repetir `npm run db:push`:

  ```sql
  DELETE FROM custom_commands a
  USING custom_commands b
  WHERE a.guild_id = b.guild_id AND a.name = b.name AND a.id < b.id;
  ```

---

## Actualizar BotM

Detén el programa (Ctrl + C) y ejecuta en la carpeta del proyecto:

```powershell
git pull
npm install
npm run db:push
npm run dev
```

`npm run db:push` va **siempre** antes de arrancar una versión nueva: si la versión agrega columnas y no lo ejecutas, fallará todo lo que lee la configuración del servidor. Si te hace preguntas, usa la tabla del [paso 6](#6-instala-las-dependencias-y-crea-las-tablas).

---

## Producción (hosting)

Para tenerlo encendido todo el tiempo en un servidor o hosting:

1. Instala las dependencias **completas** con `npm install` (no uses `--omit=dev` ni `--production`: el servidor compilado todavía necesita algunas, como Vite).
2. Pon en el `.env` tu dominio con HTTPS, por ejemplo `APP_URL=https://botm.tudominio.com` y `FRONTEND_URL=https://botm.tudominio.com`, y agrega `https://botm.tudominio.com/auth/discord/callback` en **OAuth2 → Redirects** de Discord. En `DATABASE_URL` puede ir la misma base que usabas o la que te dé tu hosting (si el hosting te da una dirección interna para su PostgreSQL, como Railway, úsala ahí).
3. Pon `VITE_DISCORD_CLIENT_ID` en `client/.env` (o como variable de entorno) **antes** de compilar: queda dentro del panel compilado.
4. Compila y arranca:

   ```powershell
   npm run db:push
   npm run build
   npm start
   ```

   `npm start` pone `NODE_ENV=production` solo y sirve el panel ya compilado desde la carpeta `dist`.

Ten en cuenta:

- **HTTPS es obligatorio.** En producción las cookies de sesión son `secure` y el navegador solo las manda por HTTPS; sin HTTPS no se puede iniciar sesión. Si usas un proxy delante (Nginx, Caddy, o el de tu hosting) que se encarga del HTTPS, ya está soportado (`trust proxy`).
- **Las sesiones viven en memoria.** Cada vez que reinicias el programa, todos tienen que volver a iniciar sesión en el panel. También caducan tras 24 horas sin usar el panel. El bot no se ve afectado.
- **Una sola copia a la vez.** No corras BotM dos veces con el mismo token (ni en dos computadoras, ni con varias instancias en el hosting): el bot respondería doble y publicaría doble, y parte de su estado (esperas, modo raid, sesiones del panel) vive en la memoria de cada copia. Si te mudas de hosting, apaga la copia vieja cuando la nueva esté conectada.
- `DEV_BYPASS_AUTH` no funciona en producción aunque lo pongas, y `/stress` y `/oauth-test` no se registran.

---

## Bueno saber

- **Rol "Muteado" viejo:** si usabas la versión anterior, al conectarse el bot pasa a quienes aún tenían ese rol al aislamiento de Discord por el tiempo que les quedaba. El rol se queda en el servidor; puedes borrarlo a mano.
- **Mientras el modo raid está activo** el bot no da la bienvenida ni el rol automático a quien entra. Si alguien legítimo entró en ese rato, dale el rol a mano.
- **Lotería:** los boletos se acumulan, pero todavía no hay sorteos.
- **Twitter/X:** no está disponible; solo hay feeds de Reddit.
- **Preguntas del día:** están en `server/bot/data/preguntasDelDia.ts`. Puedes agregar o quitar las que quieras; el bot recuerda cuáles ya salieron (si corriges el texto de una, cuenta como nueva).

---

## Dónde está cada cosa

```text
botM/
├── client/                  Panel web (React)
│   ├── .env                 VITE_DISCORD_CLIENT_ID (lo creas tú)
│   └── src/pages/           Una página por sección del panel
├── server/
│   ├── index.ts             Arranca todo: servidor web, panel y bot
│   ├── db.ts                Conexión a la base de datos (Neon o cualquier PostgreSQL)
│   ├── routes.ts, routes/   API del panel (login, ajustes, estadísticas…)
│   ├── services/reddit.ts   Lee las publicaciones de Reddit
│   └── bot/
│       ├── commands/        Comandos de barra y con prefijo
│       ├── events/          XP, monedas y bienvenidas
│       ├── middleware/      Anti-raid
│       ├── data/            Preguntas del día
│       └── scheduler.ts     Pregunta del día y feeds de Reddit (revisa cada minuto)
├── shared/
│   ├── schema.ts            Tablas de la base de datos
│   └── api.ts               Tipos que comparten el panel y el servidor
├── .env                     Tus llaves (lo creas tú; nunca lo compartas)
└── .env.example             Plantilla del .env
```

Comandos de npm disponibles:

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Arranca el bot y el panel en modo desarrollo (el panel se actualiza solo al cambiar el código). |
| `npm run db:push` | Crea o actualiza las tablas de la base de datos. |
| `npm run build` | Compila el panel y el servidor en la carpeta `dist`. |
| `npm start` | Arranca la versión compilada en modo producción. |
| `npm run check` | Revisa los tipos de TypeScript (para desarrolladores). |
