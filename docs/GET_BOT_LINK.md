# 🔗 Generador de Link de Invitación

## Paso 1: Obtener tu Application ID

1. Ve a https://discord.com/developers/applications
2. Selecciona tu aplicación (o crea una nueva)
3. En la página "General", copia el **Application ID**
   - Es un número largo como: `123456789012345678`

## Paso 2: Links Listos para Usar

Una vez que tengas tu Application ID, reemplaza `TU_APPLICATION_ID` en estos links:

### 🎯 LINK COMPLETO (Recomendado - Todos los Permisos)
```
https://discord.com/api/oauth2/authorize?client_id=TU_APPLICATION_ID&permissions=1099511627775&scope=bot%20applications.commands
```

### 🔒 LINK BÁSICO (Solo Comandos)
```
https://discord.com/api/oauth2/authorize?client_id=TU_APPLICATION_ID&permissions=2147486720&scope=bot%20applications.commands
```

### 👑 LINK ADMINISTRADOR (Todos los Permisos)
```
https://discord.com/api/oauth2/authorize?client_id=TU_APPLICATION_ID&permissions=8&scope=bot%20applications.commands
```

## Ejemplo Completo

Si tu Application ID es `987654321098765432`, el link sería:
```
https://discord.com/api/oauth2/authorize?client_id=987654321098765432&permissions=1099511627775&scope=bot%20applications.commands
```

## ⚡ Permisos Incluidos en el Link Completo

El valor `1099511627775` incluye:
- ✅ Send Messages & Use Slash Commands
- ✅ Manage Messages & Embed Links
- ✅ Add Reactions (para reaction roles)
- ✅ Manage Roles (para autoroles y massrole)
- ✅ Manage Channels (para lockdown y nsfw)
- ✅ Kick/Ban/Timeout Members (moderación)
- ✅ Connect/Speak (música)
- ✅ View Server Insights
- ✅ Y más permisos necesarios para todas las funciones

## 🎮 Comandos que Funcionarán

Una vez invitado con estos permisos:
- `/rank` - Sistema de niveles
- `/balance` - Sistema económico  
- `/leaderboard` - Rankings
- `/collection` - Objetos raros
- `/lottery` - Sistema de lotería
- `/warn` - Moderación básica
- `/lockdown` - Protección del servidor
- `/autorole` - Roles automáticos
- `/reactionrole` - Roles por reacción
- `/nsfw` - Gestión de canales NSFW

## 🚀 Próximos Pasos

1. **Obtén tu Application ID** del Developer Portal
2. **Reemplaza** `TU_APPLICATION_ID` en el link
3. **Abre el link** en tu navegador
4. **Selecciona tu servidor** Discord
5. **Confirma los permisos** y autoriza
6. **¡Listo!** Prueba `/rank` en tu servidor

¿Tienes tu Application ID? Te genero el link específico ahora mismo.