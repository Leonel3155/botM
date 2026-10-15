import { PermissionFlagsBits, type Guild, type Role } from 'discord.js';
import { DANGEROUS_PERMISSIONS } from './welcome';

export { isValidButtonEmoji } from '@shared/emoji';

export type GrantableRoleCheck = { ok: true; role: Role } | { ok: false; reason: string };

/**
 * Roles que el bot da cuando alguien lo pide (autorroles) o lo compra (tienda). Las mismas reglas que
 * el rol de bienvenida: nada de @everyone, roles de integraciones ni roles con permisos de moderación.
 */
export function checkGrantableRole(guild: Guild, roleId: string | null | undefined): GrantableRoleCheck {
  if (!roleId) return { ok: false, reason: 'No hay rol elegido.' };

  const role = guild.roles.cache.get(roleId);
  if (!role) return { ok: false, reason: 'Ese rol ya no existe.' };
  if (role.id === guild.id) return { ok: false, reason: 'No se puede usar @everyone.' };
  if (role.managed) {
    return { ok: false, reason: `${role} lo administra una integración o bot, no se puede asignar a mano.` };
  }
  if (DANGEROUS_PERMISSIONS.some(permission => role.permissions.has(permission))) {
    return { ok: false, reason: `Por seguridad no doy roles con permisos de moderación o administración (${role}).` };
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, reason: 'Me falta el permiso **Gestionar roles**.' };
  }
  if (!role.editable) {
    return { ok: false, reason: `Mi rol más alto debe estar **por encima** de ${role} en Ajustes del servidor → Roles.` };
  }
  return { ok: true, role };
}
