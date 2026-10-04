# 🔐 Guía de Permisos de Discord - Configuración Completa

Basado en tu captura de pantalla, aquí están los permisos exactos que necesitas configurar:

## ✅ Permisos Requeridos para el Bot

### **GENERAL PERMISSIONS** (Ya tienes algunos marcados)
- ✅ **View Server Insights** (ya marcado)
- ✅ **View Server Subscription Insights** (ya marcado)
- ☑️ **Manage Channels** - Para comandos /nsfw y /lockdown
- ☑️ **Manage Server** - Para configuración avanzada
- ☑️ **View Channels** - Básico para funcionar
- ☑️ **Send Messages** - Esencial para responder
- ☑️ **Manage Messages** - Para moderación
- ☑️ **Embed Links** - Para embeds bonitos
- ☑️ **Attach Files** - Para imágenes y archivos
- ☑️ **Read Message History** - Para contexto
- ☑️ **Add Reactions** - Para reaction roles
- ☑️ **Use External Emojis** - Para mejor experiencia

### **MEMBERSHIP PERMISSIONS**
- ☑️ **Create Instant Invite** - Útil para gestión
- ☑️ **Change Nickname** - Personalización del bot
- ☑️ **Manage Nicknames** - Para comandos de moderación
- ☑️ **Kick Members** - Comando /kick
- ☑️ **Ban Members** - Comando /ban
- ☑️ **Moderate Members** - Comando /timeout ✅ (ya tienes este)

### **TEXT PERMISSIONS**
- ☑️ **Send Messages in Threads** - Para hilos
- ☑️ **Create Public Threads** - Gestión de hilos
- ☑️ **Create Private Threads** - Gestión de hilos
- ☑️ **Use External Stickers** - Mejor experiencia
- ☑️ **Mention Everyone** - Para anuncios importantes
- ☑️ **Use Slash Commands** - ESENCIAL para el bot

### **VOICE PERMISSIONS** (Para sistema de música)
- ✅ **Connect** (ya marcado) - Conectar a canales de voz
- ✅ **Speak** (ya marcado) - Para música
- ☑️ **Video** - Para funciones avanzadas
- ☑️ **Use Voice Activity** - Mejor experiencia de voz
- ☑️ **Priority Speaker** - Para anuncios
- ☑️ **Mute Members** - Moderación de voz
- ☑️ **Deafen Members** - Moderación de voz
- ☑️ **Move Members** - Gestión de canales de voz

## 🔗 Configuración de Redirect URI

Veo que necesitas el "redirect uri" en la parte inferior. Aquí están las opciones:

### **Para Solo Bot (Sin Dashboard Web) - RECOMENDADO**
```
NO NECESITAS REDIRECT URI
```
Simplemente usa el link de invitación directo (más fácil).

### **Para Bot con Dashboard Web**
Si quieres mantener el dashboard web, agrega estas URLs en "REDIRECT URIS":

```
https://tu-repl-name.tu-usuario.replit.app/auth/callback
http://localhost:5000/auth/callback
https://tu-servidor-privado.com/auth/callback
```

## 🎯 Link de Invitación Rápido

**OPCIÓN FÁCIL**: Copia este link y reemplaza `TU_APPLICATION_ID`:

```
https://discord.com/api/oauth2/authorize?client_id=TU_APPLICATION_ID&permissions=1099511627775&scope=bot%20applications.commands
```

Este link incluye todos los permisos necesarios automáticamente.

## 📋 Configuración Paso a Paso

### 1. **En la sección que muestras en la imagen:**
- Marca TODOS los permisos que listamos arriba
- Es mejor tener más permisos que menos

### 2. **En "INTEGRATION TYPE" (abajo en tu imagen):**
- Mantén "Guild Install" seleccionado
- Es la opción correcta para bots de servidor

### 3. **En "GENERATED URL" (abajo):**
- Si pide redirect URI, deja el campo vacío PARA BOT SIMPLE
- O agrega las URLs que mencionamos si quieres dashboard

### 4. **Copiar el Link Final:**
- Una vez configurados los permisos, Discord generará un link
- Ese link es lo que usas para invitar el bot

## 🚀 Permisos Valor Numérico

Si prefieres usar el valor numérico directamente:
- **Todos los permisos**: `1099511627775`
- **Solo básicos**: `2147680256` 
- **Con moderación**: `1099511627775` (recomendado)

## ⚠️ Notas Importantes

### **¿Por qué tantos permisos?**
- **Sistema de protección** necesita gestionar canales y roles
- **Moderación** requiere kick/ban/timeout
- **Reaction roles** necesita agregar reacciones
- **Lockdown** requiere gestionar permisos de canal
- **Sistema de niveles** necesita leer mensajes

### **Seguridad:**
- El bot SOLO usará los permisos que necesita
- Los permisos se pueden cambiar después en el servidor
- Es mejor dar permisos amplios al bot y restringir por canal

## 🔧 Si Tienes Problemas

### **Bot no responde a comandos:**
- Verificar que "Use Slash Commands" esté marcado
- Bot debe tener permisos de "Send Messages" en el canal

### **Comandos de moderación no funcionan:**
- Verificar "Moderate Members", "Kick Members", "Ban Members"
- El rol del bot debe estar arriba de los roles que quiere moderar

### **Reaction roles no funcionan:**
- Verificar "Add Reactions" y "Manage Roles"
- Bot debe poder gestionar los roles específicos

## 📝 Checklist Final

Antes de generar el link, verifica que tienes marcado:
- ✅ Send Messages
- ✅ Use Slash Commands  
- ✅ Moderate Members
- ✅ Manage Messages
- ✅ Add Reactions
- ✅ Connect (voz)
- ✅ Speak (voz)
- ✅ Manage Channels (para /nsfw, /lockdown)
- ✅ Manage Roles (para autoroles)

Una vez configurado, copia el link generado y úsalo para invitar el bot a tu servidor.