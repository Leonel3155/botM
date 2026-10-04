# Referencia Completa de Comandos

## Comandos de Casino y Apuestas

### 🃏 Blackjack
```
/blackjack [cantidad]
```
- **Descripción**: Juega blackjack contra el bot
- **Parámetros**: 
  - `cantidad`: Dinero a apostar o "all" para apostar todo
- **Ejemplo**: `/blackjack 100` o `/blackjack all`

### 🎰 Máquina Tragamonedas
```
/slots [cantidad]
```
- **Descripción**: Juega en la máquina tragamonedas
- **Símbolos y Multiplicadores**:
  - 🍒 x2
  - 🍋 x3  
  - 🔔 x5
  - ⭐ x10
  - 💎 x20
- **Ejemplo**: `/slots 50`

### 🎲 Ruleta Europea
```
/ruleta [apuesta] [cantidad]
```
- **Descripción**: Juega ruleta europea
- **Tipos de apuesta**:
  - `rojo/negro` (x2)
  - `par/impar` (x2)
  - `0-36` (x36)
- **Ejemplo**: `/ruleta rojo 100` o `/ruleta 17 50`

### 🎲 Dado de la Suerte  
```
/dado [cantidad]
```
- **Descripción**: Tira un dado, gana solo si sale 6
- **Multiplicador**: x6 si sale 6
- **Sin apuesta**: Solo muestra el resultado
- **Ejemplo**: `/dado 25` o `/dado` (gratis)

### 💥 Ruleta Rusa
```
/ruleta-rusa [camaras]
```
- **Descripción**: Apuesta TODO tu dinero, sobrevive y lo duplicas
- **Parámetros**:
  - `camaras`: 2-12 cámaras (default: 6)
- **Riesgo**: Pierdes todo si sale la bala
- **Ejemplo**: `/ruleta-rusa 6`

## Comandos de Economía

### 💰 Balance
```
/balance [usuario]
```
- **Descripción**: Ver tu saldo actual o el de otro usuario
- **Parámetros**: 
  - `usuario`: Usuario a consultar (opcional)
- **Muestra**: Cartera, banco, total
- **Ejemplo**: `/balance` o `/balance @user`

### 🎁 Recompensa Diaria
```
/daily
```
- **Descripción**: Reclama tu recompensa diaria de 500 monedas
- **Cooldown**: 24 horas
- **Bonus**: Racha diaria por días consecutivos
- **Ejemplo**: `/daily`

### 💼 Trabajo
```
/work [trabajo]
```
- **Descripción**: Trabaja para ganar monedas (200-349 por trabajo)
- **Cooldown**: 1 hora
- **Trabajos disponibles**:
  - 💻 Programador
  - 🏗️ Constructor 
  - 🍕 Delivery
  - 🎨 Artista
  - 🏥 Doctor
- **Ejemplo**: `/work programador` o `/work`

### 🏦 Depositar
```
/deposit [cantidad]
```
- **Descripción**: Deposita monedas en tu banco
- **Parámetros**:
  - `cantidad`: Cantidad específica o "all" para todo
- **Ejemplo**: `/deposit 1000` o `/deposit all`

### 💸 Retirar
```
/withdraw [cantidad]
```
- **Descripción**: Retira monedas de tu banco
- **Parámetros**:
  - `cantidad`: Cantidad específica o "all" para todo
- **Ejemplo**: `/withdraw 500` o `/withdraw all`

### 💝 Transferir
```
/give [usuario] [cantidad]
```
- **Descripción**: Envía monedas a otro usuario
- **Parámetros**:
  - `usuario`: Usuario destinatario
  - `cantidad`: Cantidad de monedas
- **Ejemplo**: `/give @user 100`

### 🦹 Robar
```
/rob [usuario]
```
- **Descripción**: Intenta robar monedas a otro usuario
- **Cooldown**: 5 minutos
- **Probabilidad**: 50% éxito/fallo
- **Requisitos**: Ambos usuarios deben tener 100+ monedas
- **Ejemplo**: `/rob @user`

### 🦹 Crimen
```
/crime [tipo]
```
- **Descripción**: Arriesga 20% de tu saldo cometiendo un crimen
- **Cooldown**: 5 minutos
- **Probabilidad**: 50% éxito/fallo
- **Tipos disponibles**:
  - 🏦 Banco
  - 🏪 Tienda
  - 🚗 Auto
- **Ejemplo**: `/crime banco` o `/crime`

### 💋 Slut
```
/slut [modo]
```
- **Descripción**: Arriesga 10% de tu saldo para intentar ganar más
- **Cooldown**: 5 minutos
- **Probabilidad**: 50% éxito/fallo
- **Modos disponibles**:
  - 😇 Inocente
  - 😘 Coqueto
  - 🔥 Intenso
- **Ejemplo**: `/slut coqueto` o `/slut`

### 🏆 Leaderboard
```
/leaderboard [tipo]
```
- **Descripción**: Muestra el ranking de usuarios más ricos
- **Tipos de ranking**:
  - 💵 Cartera
  - 🏦 Banco
  - 💎 Total (default)
- **Ejemplo**: `/leaderboard total` o `/leaderboard`

## Comandos Psicológicos

### 🎟️ Lotería
```
/lottery
```
- **Descripción**: Revisa tus boletos y estado del sorteo
- **Obtener boletos**: 1 por cada 25 mensajes
- **Sorteo**: Diario a las 8 PM

### 💎 Colección
```
/collection  
```
- **Descripción**: Ve tu colección de objetos raros
- **Drop rate**: 0.5% base por mensaje + bonos
- **Objetos raros**:
  - 💎 Diamante Místico (0.1%)
  - 🎭 Máscara Dorada (0.2%)
  - ⚡ Rayo Embotellado (0.3%)
  - 🔮 Esfera de Cristal (0.5%)
  - 🏆 Trofeo de Plata (1.0%)

### 🏆 Ranking
```
/rank
```
- **Descripción**: Ve tu ranking en el servidor
- **Muestra**: Nivel, dinero, posición, percentil
- **Estados**: Elite, Veterano, Activo, Novato

### 📊 Estadísticas
```
/stats
```
- **Descripción**: Estadísticas detalladas de actividad
- **Incluye**: Mensajes, promedio diario, progreso, logros

### 🎯 Hitos
```
/milestones
```
- **Descripción**: Ve tus hitos y recompensas
- **Hitos disponibles**:
  - Primera Conexión (1 mensaje → 100 monedas)
  - Conversador (100 mensajes → 500 monedas)
  - Activo Regular (1000 mensajes → 2000 monedas)
  - Super Activo (5000 mensajes → 10000 monedas)
  - Primer Nivel (nivel 5 → 200 monedas)
  - Nivel Intermedio (nivel 25 → 1000 monedas)
  - Nivel Avanzado (nivel 50 → 5000 monedas)

## Comandos de Sistema

### 🔧 Diagnósticos
```
/diagnostics
&check
```
- **Descripción**: Diagnóstico completo del sistema
- **Verifica**: Permisos, voz, música, configuración
- **Soluciones**: Guía paso a paso para problemas

### ⚡ Configuración Rápida
```
/quicksetup
```
- **Descripción**: Configuración automática del servidor
- **Configura**: Canales, roles, permisos básicos

### 🚀 Activación
```
/activate
```
- **Descripción**: Activa todas las funciones del bot
- **Habilita**: Niveles, economía, música, moderación

## Comandos de Economía

### 💰 Balance
```
/balance [usuario]
/bal [usuario]
```
- **Descripción**: Ver dinero virtual
- **Muestra**: Monedas en efectivo y banco

### 💼 Trabajo
```
/work
```
- **Descripción**: Trabajar para ganar dinero
- **Ganancia**: 50-200 monedas
- **Cooldown**: 1 hora

### 🎁 Diario
```
/daily
```
- **Descripción**: Recompensa diaria
- **Ganancia**: 100-500 monedas + bonos por racha
- **Cooldown**: 24 horas

### 🏪 Tienda
```
/shop
/buy [item]
```
- **Descripción**: Ver y comprar items
- **Items**: Herramientas, protecciones, coleccionables

## Comandos de Niveles

### 📊 Nivel
```
/level [usuario]
/rank [usuario]
```
- **Descripción**: Ver nivel y XP
- **Muestra**: Nivel, XP, progreso al siguiente nivel

### 🏆 Leaderboard
```
/leaderboard
/lb
```
- **Descripción**: Top usuarios por nivel o dinero
- **Tipos**: Por XP, por dinero, por actividad

## Comandos de Música

### 🎵 Reproducir
```
/play [canción]
```
- **Descripción**: Reproduce música de YouTube
- **Parámetros**: URL de YouTube o búsqueda

### 📝 Cola
```
/queue
```
- **Descripción**: Ver cola de reproducción actual

### ⏭️ Saltar
```
/skip
```
- **Descripción**: Saltar a la siguiente canción

### ⏹️ Detener
```
/stop
```
- **Descripción**: Detener música y limpiar cola

### 📻 Radio Lofi
```
/lofi start
/lofi stop
/lofi status
&lofi start
&lofi stop
```
- **Descripción**: Radio lofi hip hop 24/7
- **Función**: Streaming continuo, auto-renovación

## Comandos de Moderación

### 🔒 Lockdown
```
/lockdown
```
- **Descripción**: Bloqueo de emergencia del servidor
- **Requiere**: Permisos de administrador

### 🤖 Auto Roles
```
/autorole [rol]
```
- **Descripción**: Rol automático para nuevos miembros
- **Configura**: Rol que se asigna al unirse

### 🔄 Reaction Roles
```
/reactionrole [mensaje] [emoji] [rol]
```
- **Descripción**: Roles por reacciones
- **Configura**: Emoji + rol en mensaje específico

### 👥 Mass Role
```
/massrole [acción] [rol] [usuarios]
```
- **Descripción**: Gestión masiva de roles
- **Acciones**: add, remove, toggle

### 🔞 NSFW
```
/nsfw [canal] [activar/desactivar]
```
- **Descripción**: Control de canales NSFW
- **Requiere**: Permisos de administrador

## Comandos de Utilidad

### 🆔 Información
```
/userinfo [usuario]
/serverinfo
```
- **Descripción**: Información de usuario o servidor

### 🔗 Invitación
```
/invite
```
- **Descripción**: Enlace de invitación del bot

### 🆘 Ayuda
```
/help [comando]
```
- **Descripción**: Ayuda general o comando específico

## Comandos con Prefijo (&)

Todos los comandos slash también funcionan con el prefijo `&`:

```bash
&activate    # Equivale a /activate
&play música # Equivale a /play música  
&balance     # Equivale a /balance
&check       # Equivale a /diagnostics
&help        # Equivale a /help
```

---

**Nota**: Algunos comandos requieren permisos específicos o roles de administrador. Usa `/diagnostics` para verificar permisos.