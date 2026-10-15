import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type User,
} from 'discord.js';
import { sql } from 'drizzle-orm';
import { interactionCounts } from '@shared/schema';
import { db } from '../../db';
import type { DiscordBot } from '../index';
import type { BotCommand } from './index';
import { getExtrasQuick } from '../services/extras';
import { gifSource } from '../../services/gifs';

const COLOR = 0xFF8FB1;
export const INTERACTIONS_DISABLED_MESSAGE = '🙈 Las interacciones están apagadas en este servidor (se activan en el panel, en Diversión).';

interface TargetAction {
  name: string;
  description: string;
  nekos: string | null;
  waifu: string | null;
  /** "{a} abrazó a {b}" */
  text: string;
  /** "{a} ha abrazado a {b} {n}" */
  counter: string;
  self: string;
  bot: string;
}

// Las categorías son las de nekos.best (primero) y waifu.pics (si la primera falla)
export const TARGET_ACTIONS: TargetAction[] = [
  { name: 'abrazar', description: '🤗 Dale un abrazo a alguien', nekos: 'hug', waifu: 'hug',
    text: '{a} abrazó a {b}', counter: '{a} ha abrazado a {b}', self: '¿Abrazarte a ti mismo? Ven, yo te abrazo. 🤗', bot: '¡Gracias por el abrazo! 🥹' },
  { name: 'besar', description: '😘 Dale un beso a alguien', nekos: 'kiss', waifu: 'kiss',
    text: '{a} besó a {b}', counter: '{a} ha besado a {b}', self: 'Un beso al espejo cuenta como amor propio. 😌', bot: 'Ay, me sonrojas… 😳' },
  { name: 'cachetada', description: '🖐️ Dale una cachetada (de broma) a alguien', nekos: 'slap', waifu: 'slap',
    text: '{a} le dio una cachetada a {b}', counter: '{a} le ha dado cachetadas a {b}', self: 'No te pegues, mejor tómate un vaso de agua. 💧', bot: '¡Oye! Yo solo hago mi trabajo. 😤' },
  { name: 'acariciar', description: '🫳 Acaricia la cabeza de alguien', nekos: 'pat', waifu: 'pat',
    text: '{a} acarició a {b}', counter: '{a} ha acariciado a {b}', self: 'Te mereces esa caricia. 🫶', bot: '*ronronea en binario* 🤖' },
  { name: 'golpear', description: '👊 Dale un golpe (de broma) a alguien', nekos: 'punch', waifu: 'bonk',
    text: '{a} le dio un golpe a {b}', counter: '{a} ha golpeado a {b}', self: 'Golpearte a ti mismo no es buena idea. 🤕', bot: 'Soy de metal, no me dolió. 🦾' },
  { name: 'morder', description: '😬 Muerde a alguien', nekos: 'bite', waifu: 'bite',
    text: '{a} mordió a {b}', counter: '{a} ha mordido a {b}', self: '¿Tienes hambre? Mejor pide algo de comer. 🍕', bot: 'Cuidado con los dientes, mis cables son delicados. ⚡' },
  { name: 'saludar', description: '👋 Saluda a alguien', nekos: 'wave', waifu: 'wave',
    text: '{a} saludó a {b}', counter: '{a} ha saludado a {b}', self: '¡Hola, tú! 👋', bot: '¡Hola! ¿Qué tal tu día? 👋' },
  { name: 'chocar', description: '🙌 Choca los cinco con alguien', nekos: 'highfive', waifu: 'highfive',
    text: '{a} chocó los cinco con {b}', counter: '{a} ha chocado los cinco con {b}', self: 'Chocar los cinco solo se llama aplaudir. 👏', bot: '¡Choca esos cinco! 🙌' },
  { name: 'picar', description: '👉 Pica a alguien para llamar su atención', nekos: 'poke', waifu: 'poke',
    text: '{a} picó a {b}', counter: '{a} ha picado a {b}', self: '*te pica de vuelta* 👉', bot: '¿Sí? ¿Me necesitas? 👀' },
  { name: 'acurrucar', description: '🥰 Acurrúcate con alguien', nekos: 'cuddle', waifu: 'cuddle',
    text: '{a} se acurrucó con {b}', counter: '{a} se ha acurrucado con {b}', self: 'Una cobijita y a descansar. 🛌', bot: 'Estoy un poco tibio por tanto trabajo, perfecto para acurrucarse. ♨️' },
];

interface SoloAction {
  value: string;
  label: string;
  nekos: string | null;
  waifu: string | null;
  text: string;
}

export const SOLO_ACTIONS: SoloAction[] = [
  { value: 'bailar', label: '💃 Bailar', nekos: 'dance', waifu: 'dance', text: '{a} se puso a bailar' },
  { value: 'llorar', label: '😭 Llorar', nekos: 'cry', waifu: 'cry', text: '{a} está llorando' },
  { value: 'reir', label: '😂 Reír', nekos: 'laugh', waifu: 'smile', text: '{a} se está riendo' },
  { value: 'sonreir', label: '😊 Sonreír', nekos: 'smile', waifu: 'smile', text: '{a} sonríe' },
  { value: 'sonrojarse', label: '😳 Sonrojarse', nekos: 'blush', waifu: 'blush', text: '{a} se sonrojó' },
  { value: 'feliz', label: '😄 Feliz', nekos: 'happy', waifu: 'happy', text: '{a} está feliz' },
  { value: 'enojado', label: '😠 Enojado', nekos: 'angry', waifu: null, text: '{a} está enojado' },
  { value: 'aburrido', label: '😑 Aburrido', nekos: 'bored', waifu: null, text: '{a} se está aburriendo' },
  { value: 'dormir', label: '😴 Dormir', nekos: 'sleep', waifu: null, text: '{a} se fue a dormir' },
  { value: 'pensar', label: '🤔 Pensar', nekos: 'think', waifu: null, text: '{a} se quedó pensando' },
  { value: 'guinar', label: '😉 Guiñar', nekos: 'wink', waifu: 'wink', text: '{a} guiñó un ojo' },
  { value: 'presumir', label: '😏 Presumir', nekos: 'smug', waifu: 'smug', text: '{a} está presumiendo' },
  { value: 'facepalm', label: '🤦 Facepalm', nekos: 'facepalm', waifu: null, text: '{a} no lo puede creer' },
  { value: 'encogerse', label: '🤷 Encogerse de hombros', nekos: 'shrug', waifu: null, text: '{a} se encogió de hombros' },
];

function fill(template: string, a: string, b = ''): string {
  return template.replace('{a}', a).replace('{b}', b);
}

/** Suma una interacción y devuelve cuántas van de esa persona a esa otra. */
async function bumpCount(guildId: string, userId: string, targetId: string, action: string): Promise<number | null> {
  try {
    const [row] = await db
      .insert(interactionCounts)
      .values({ guildId, userId, targetId, action, count: 1 })
      .onConflictDoUpdate({
        target: [interactionCounts.guildId, interactionCounts.userId, interactionCounts.targetId, interactionCounts.action],
        set: { count: sql`${interactionCounts.count} + 1` },
      })
      .returning({ count: interactionCounts.count });
    return row?.count ?? null;
  } catch (error) {
    console.error('[INTERACCIONES] No pude guardar el contador:', error);
    return null;
  }
}

/** Revisa que estén activadas; si no, avisa en privado. Corre antes de deferReply (la caché responde rápido). */
async function ensureEnabled(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const extras = await getExtrasQuick(interaction.guildId!);
  if (extras.interactionsEnabled) return true;
  await interaction.reply({ content: INTERACTIONS_DISABLED_MESSAGE, flags: MessageFlags.Ephemeral });
  return false;
}

function name(user: User, interaction: ChatInputCommandInteraction): string {
  const member = interaction.guild?.members.cache.get(user.id);
  return `**${member?.displayName ?? user.displayName}**`;
}

function targetCommand(action: TargetAction): BotCommand {
  return {
    data: new SlashCommandBuilder()
      .setName(action.name)
      .setDescription(action.description)
      .addUserOption((option) => option.setName('usuario').setDescription('¿A quién?').setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
      if (!(await ensureEnabled(interaction))) return;
      const target = interaction.options.getUser('usuario', true);
      const author = interaction.user;

      if (target.id === author.id) {
        await interaction.reply({ content: action.self });
        return;
      }
      await interaction.deferReply();
      const [gif, count] = await Promise.all([
        gifSource.random(action.nekos, action.waifu),
        bumpCount(interaction.guildId!, author.id, target.id, action.name),
      ]);
      const a = name(author, interaction);
      const b = name(target, interaction);
      const embed = new EmbedBuilder().setColor(COLOR).setDescription(`${fill(action.text, a, b)}${target.id === interaction.client.user.id ? `\n\n${action.bot}` : ''}`);
      if (gif) embed.setImage(gif);
      if (count && count > 1) {
        const plain = (text: string) => text.replace(/\*\*/g, '');
        embed.setFooter({ text: `${plain(fill(action.counter, a, b))} ${count} veces` });
      }
      await interaction.editReply({ content: `<@${target.id}>`, embeds: [embed], allowedMentions: { users: [target.id] } });
    },
  };
}

const reaccion: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('reaccion')
    .setDescription('🎭 Muestra cómo te sientes con un GIF')
    .addStringOption((option) => option
      .setName('accion')
      .setDescription('¿Qué haces?')
      .setRequired(true)
      .addChoices(...SOLO_ACTIONS.map((action) => ({ name: action.label, value: action.value })))),
  async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
    if (!(await ensureEnabled(interaction))) return;
    const action = SOLO_ACTIONS.find((item) => item.value === interaction.options.getString('accion', true));
    if (!action) {
      await interaction.reply({ content: 'No conozco esa reacción.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();
    const gif = await gifSource.random(action.nekos, action.waifu);
    const embed = new EmbedBuilder().setColor(COLOR).setDescription(fill(action.text, name(interaction.user, interaction)));
    if (gif) embed.setImage(gif);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

export const interaccionesCommands: BotCommand[] = [...TARGET_ACTIONS.map(targetCommand), reaccion];
