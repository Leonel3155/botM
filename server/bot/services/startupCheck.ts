// Revisión de lo nuevo (autorroles, tienda, Reddit y actualizaciones): sale en la consola al arrancar el bot
// y también en /selftest. Solo lee: no cambia nada en Discord ni en la base de datos.
import { DiscordAPIError, RESTJSONErrorCodes, type Client, type Guild } from 'discord.js';
import { count, eq, sql } from 'drizzle-orm';
import { contentFeeds } from '@shared/schema';
import { db } from '../../db';
import { listRolePanels } from './rolePanels';
import { listShopItems } from './shop';
import { checkGrantableRole } from './roles';
import { resolveSendableChannel } from './channels';
import { lastUpdateStatus } from './updater';
import { getExtrasSafe } from './extras';
import { unmarkedNsfwChannels } from './nsfw';
import { RedditError, redditService, REDDIT_RSS_SHUTDOWN_AT } from '../../services/reddit';

export type CheckLevel = 'ok' | 'warn' | 'error';

export interface CheckLine {
  level: CheckLevel;
  text: string;
}

const ICON: Record<CheckLevel, string> = { ok: '✅', warn: '⚠️', error: '❌' };

/** Las menciones de Discord (<#id>, <@&id>) y **negritas** no se ven bien en la consola. */
function plain(guild: Guild, text: string): string {
  return text
    .replace(/<#(\d+)>/g, (_m, id: string) => `#${guild.channels.cache.get(id)?.name ?? 'canal-desconocido'}`)
    .replace(/<@&(\d+)>/g, (_m, id: string) => `@${guild.roles.cache.get(id)?.name ?? 'rol-desconocido'}`)
    .replace(/\*\*/g, '');
}

async function checkTables(): Promise<CheckLine> {
  try {
    await db.execute(sql`select 1 from role_panels limit 1`);
    await db.execute(sql`select 1 from shop_items limit 1`);
    await db.execute(sql`select 1 from shop_inventory limit 1`);
    return { level: 'ok', text: 'Tablas de autorroles y tienda listas' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { level: 'error', text: `Faltan tablas de autorroles o tienda (${message}). Cierra BotM y corre "npm run db:push".` };
  }
}

async function messageExists(guild: Guild, channelId: string, messageId: string): Promise<boolean | null> {
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return false;
  try {
    await channel.messages.fetch(messageId);
    return true;
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage) return false;
    return null; // no se pudo saber (permisos, Discord lento)
  }
}

/** Paneles de autorroles y artículos de la tienda de un servidor. */
export async function checkGuildFeatures(guild: Guild): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];

  const panels = await listRolePanels(guild.id);
  for (const panel of panels) {
    const problems: string[] = [];
    const channel = resolveSendableChannel(guild, panel.channelId);
    if (!channel.ok) problems.push(plain(guild, channel.reason));
    else if (!panel.messageId) problems.push('el mensaje no está publicado');
    else if (await messageExists(guild, panel.channelId, panel.messageId) === false) {
      problems.push('alguien borró el mensaje (ábrelo en el panel y pulsa Guardar para publicarlo otra vez)');
    }
    for (const button of panel.roles) {
      const role = checkGrantableRole(guild, button.roleId);
      if (!role.ok) problems.push(`"${button.label}": ${plain(guild, role.reason)}`);
    }
    lines.push(problems.length === 0
      ? { level: 'ok', text: `Autorroles «${panel.title}»: ${panel.roles.length} botón(es) funcionando` }
      : { level: 'warn', text: `Autorroles «${panel.title}»: ${problems.join(' · ')}` });
  }

  const extras = await getExtrasSafe(guild.id);
  if (extras.nsfwEnabled) {
    const unmarked = unmarkedNsfwChannels(guild, extras);
    lines.push(unmarked.length === 0
      ? { level: 'ok', text: `Contenido +18: ${extras.nsfwChannelIds.length} canal(es) autorizados y marcados +18` }
      : { level: 'warn', text: `Contenido +18: ${unmarked.length} canal(es) autorizados ya no están marcados +18 en Discord; ahí no publico nada` });
  }

  const items = await listShopItems(guild.id);
  const roleProblems = items
    .filter((item) => item.enabled && item.roleId)
    .flatMap((item) => {
      const role = checkGrantableRole(guild, item.roleId);
      return role.ok ? [] : [`«${item.name}»: ${plain(guild, role.reason)}`];
    });
  if (items.length > 0) {
    const forSale = items.filter((item) => item.enabled).length;
    lines.push(roleProblems.length === 0
      ? { level: 'ok', text: `Tienda: ${forSale} de ${items.length} artículo(s) a la venta` }
      : { level: 'warn', text: `Tienda: no puedo dar el rol de ${roleProblems.join(' · ')}` });
  }
  return lines;
}

function updateLine(): CheckLine | null {
  const last = lastUpdateStatus();
  if (!last) return null;
  const { pending, localChanges } = last.status;
  if (pending.length > 0) return { level: 'warn', text: `Hay ${pending.length} cambio(s) nuevo(s) en GitHub: usa /actualizar ahora` };
  if (localChanges.length > 0) return { level: 'warn', text: 'Hay archivos cambiados a mano: /actualizar no podrá bajar versiones nuevas' };
  return { level: 'ok', text: 'BotM está en la última versión' };
}

async function redditLine(): Promise<CheckLine | null> {
  if (redditService.usesApi) {
    try {
      await redditService.checkCredentials();
      return { level: 'ok', text: 'Reddit: conectado con la API oficial (tus claves funcionan)' };
    } catch (error) {
      const message = error instanceof RedditError ? error.message : String(error);
      return { level: 'error', text: `Reddit: ${message}` };
    }
  }
  const [row] = await db.select({ total: count() }).from(contentFeeds).where(eq(contentFeeds.source, 'reddit'));
  const total = row?.total ?? 0;
  if (total === 0) return null;
  const fix = 'Pon REDDIT_CLIENT_ID y REDDIT_CLIENT_SECRET en el .env (README, sección «Claves de Reddit»).';
  return Date.now() >= REDDIT_RSS_SHUTDOWN_AT
    ? { level: 'error', text: `Reddit: apagó su RSS y ${total} feed(s) de Reddit ya no publican. ${fix}` }
    : { level: 'warn', text: `Reddit: sin claves, ${total} feed(s) de Reddit dejan de publicar el 13 de noviembre (Reddit apaga su RSS). ${fix}` };
}

/** Todo lo que se puede revisar de un servidor (para /selftest). */
export async function runFeatureChecks(guild: Guild | null, commandNames: string[]): Promise<CheckLine[]> {
  const lines: CheckLine[] = [await checkTables()];
  const missing = ['tienda', 'comprar', 'inventario', 'actualizar'].filter((name) => !commandNames.includes(name));
  lines.push(missing.length === 0
    ? { level: 'ok', text: 'Comandos /tienda, /comprar, /inventario y /actualizar cargados' }
    : { level: 'error', text: `No se cargaron: ${missing.map((name) => `/${name}`).join(', ')}` });
  if (guild && lines[0].level === 'ok') lines.push(...await checkGuildFeatures(guild));
  try {
    const reddit = await redditLine();
    if (reddit) lines.push(reddit);
  } catch (error) {
    lines.push({ level: 'warn', text: `Reddit: no pude revisarlo (${error instanceof Error ? error.message : String(error)})` });
  }
  const update = updateLine();
  if (update) lines.push(update);
  return lines;
}

export function formatCheckLines(lines: CheckLine[]): string {
  return lines.map((line) => `${ICON[line.level]} ${line.text}`).join('\n');
}

/** Al conectarse el bot: revisa todo en todos los servidores y lo escribe en la consola. Nunca lanza. */
export async function runStartupChecks(client: Client, commandNames: string[]): Promise<void> {
  try {
    const lines = await runFeatureChecks(null, commandNames);
    if (lines[0].level === 'ok') {
      for (const guild of client.guilds.cache.values()) {
        const guildLines = await checkGuildFeatures(guild);
        lines.push(...guildLines.map((line) => ({ ...line, text: `[${guild.name}] ${line.text}` })));
      }
    }
    const problems = lines.filter((line) => line.level !== 'ok').length;
    console.log(`🧪 Revisión de autorroles, tienda, Reddit y actualizaciones (${problems === 0 ? 'todo bien' : `${problems} aviso(s)`}):`);
    for (const line of lines) console.log(`   ${ICON[line.level]} ${line.text}`);
  } catch (error) {
    console.error('⚠️ No se pudo hacer la revisión al arrancar:', error);
  }
}
