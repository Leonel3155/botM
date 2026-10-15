// Lo usan el servidor y el panel para revisar el emoji de un botón o artículo antes de mandarlo a Discord.

/** Emoji del servidor: <:nombre:id> o <a:nombre:id> (animado). */
const CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{17,20}>$/;
/** Emoji normal: 😀, 👍🏽, 🇲🇽, 1️⃣, 👨‍👩‍👧… */
const UNICODE_EMOJI =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]️?⃣)(?:️|‍|\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u;

export function isValidButtonEmoji(value: string): boolean {
  return CUSTOM_EMOJI.test(value) || UNICODE_EMOJI.test(value);
}
