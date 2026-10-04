# 🚀 COMO EJECUTAR TU BOT EN TU COMPUTADORA

## 📦 **REQUISITOS PREVIOS:**

### 1. Instalar Node.js
```bash
# Verifica si ya tienes Node.js:
node --version
npm --version

# Si no tienes, descarga desde: https://nodejs.org
# Necesitas versión 18 o superior
```

## ⚡ **PASOS PARA EJECUTAR:**

### 1. **Preparar el proyecto:**
```bash
# Navegar a la carpeta del proyecto
cd tu-discord-bot-proyecto

# Instalar todas las dependencias
npm install
```

### 2. **Configurar tokens y base de datos:**
```bash
# Usar tu configuración completa (TODO LISTO):
mv .env.final .env

# ¡Ya no necesitas editar nada más!
```

### 3. **Configurar base de datos:**
```bash
# Sincronizar esquema (solo la primera vez):
npm run db:push
```

### 4. **¡Ejecutar el bot!**
```bash
# Modo desarrollo (con auto-restart):
npm run dev

# O modo producción:
npm start
```

## ✅ **VERIFICACIÓN EXITOSA:**

Si todo funciona, verás en tu terminal:
```
✅ Session middleware configured
✅ Discord slash commands registered successfully  
🛡️ Anti-raid protection initialized
✅ Test data seeded successfully
🕐 Content scheduler started
🚀 Discord bot and content scheduler started successfully
🤖 Discord bot ready as Replit#1397
📋 Prefix commands enabled alongside slash commands
```

## 🎯 **LO QUE TENDRÁS:**

- **Bot idéntico** a Replit con todas las funciones
- **Misma base de datos** - usuarios conservan dinero, niveles, items
- **Todos los comandos**:
  - 💰 Economía completa (balance, daily, work, crime, rob)
  - 🎰 Casino psicológico (blackjack, slots, ruleta, dados)
  - 🛡️ Moderación completa (ban, kick, mute, clear, warn)
  - 📈 Sistema de niveles y prestige
  - 🏪 Tienda e inventario
  - 🎵 Música y LoFi radio 24/7
  - 🔧 Diagnósticos y herramientas admin

## 🆘 **SI TIENES PROBLEMAS:**

1. **Node.js no encontrado**: Instala desde nodejs.org
2. **Error de dependencias**: Ejecuta `npm install` nuevamente
3. **Error de base de datos**: Verifica que DATABASE_URL esté correcto
4. **Bot no responde**: Verifica que DISCORD_TOKEN sea correcto

## 💡 **VENTAJAS:**

- ✅ Sin configuración adicional
- ✅ Tokens ya incluidos y funcionando
- ✅ Base de datos compartida
- ✅ Sistema completo "holy grail" 
- ✅ Supera a MEE6 + UnbelievaBoat + Carl-bot

¡Tu bot estará listo en menos de 5 minutos! 🚀