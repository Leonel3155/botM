import type { ReactNode } from "react";
import { Bot, Hash } from "lucide-react";
import { WELCOME_PLACEHOLDERS } from "@shared/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { displayName, initials, userAvatarUrl, type SessionUser } from "@/lib/auth";
import { guildIconUrl, type UserGuild } from "@/lib/guild";
import { formatLocalTime } from "./time";

// Colores de Discord (tema oscuro): la vista previa imita cómo se ve el mensaje allá.
// El verde del borde es el mismo que usa el bot en la bienvenida (WELCOME_COLOR).
const DISCORD = {
  chat: "bg-[#313338]",
  embed: "bg-[#2b2d31]",
  embedBorder: "border-l-[#57F287]",
  text: "text-[#dbdee1]",
  muted: "text-[#949ba4]",
  mention: "rounded bg-[#5865f2]/30 px-0.5 font-medium text-[#c9cdfb]",
};

const numberFormat = new Intl.NumberFormat("es-MX");

interface PreviewContext {
  user: SessionUser | null;
  guildName: string;
  memberCount: number | null;
}

function Mention({ children }: { children: ReactNode }) {
  return <span className={DISCORD.mention}>{children}</span>;
}

/** Hueco que no podemos rellenar con datos reales (p. ej. miembros sin el bot conectado). */
function Unknown({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-dashed border-[#949ba4]/60 px-1 text-[#949ba4]" title="Este dato lo pone el bot al publicar">
      {children}
    </span>
  );
}

// {usuario}, {nombre}... sacados de shared/api.ts para no desincronizarse con el bot
const placeholderPattern = new RegExp(
  `(${WELCOME_PLACEHOLDERS.map((p) => p.key.replace(/[{}]/g, "\\$&")).join("|")})`,
  "gi",
);

/** Sustituye los marcadores por los datos reales (como nodos de texto, nunca HTML). */
function renderPlaceholders(text: string, ctx: PreviewContext, keyPrefix: string, plain = false): ReactNode[] {
  return text.split(placeholderPattern).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (part.toLowerCase()) {
      case "{usuario}":
        if (plain) return ctx.user ? `<@${ctx.user.id}>` : "<@usuario>";
        return <Mention key={key}>@{ctx.user ? displayName(ctx.user) : "persona nueva"}</Mention>;
      case "{nombre}":
        return ctx.user ? ctx.user.username : plain ? "nombre" : <Unknown key={key}>nombre</Unknown>;
      case "{servidor}":
        return ctx.guildName;
      case "{miembros}":
        if (ctx.memberCount !== null) return numberFormat.format(ctx.memberCount);
        return plain ? "miembros" : <Unknown key={key}>nº de miembros</Unknown>;
      default:
        return part;
    }
  });
}

interface InlineRule {
  pattern: RegExp;
  /** El contenido no se interpreta (código) */
  raw?: boolean;
  wrap: (children: ReactNode, key: string) => ReactNode;
}

// Lo básico del formato de Discord: `código`, **negrita**, __subrayado__, ~~tachado~~, *cursiva*, _cursiva_, ||spoiler||
const INLINE_RULES: InlineRule[] = [
  {
    pattern: /`([^`\n]+)`/,
    raw: true,
    wrap: (children, key) => (
      <code key={key} className="rounded bg-[#1e1f22] px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    ),
  },
  { pattern: /\*\*([\s\S]+?)\*\*/, wrap: (children, key) => <strong key={key} className="font-semibold text-white">{children}</strong> },
  { pattern: /__([\s\S]+?)__/, wrap: (children, key) => <u key={key}>{children}</u> },
  { pattern: /~~([\s\S]+?)~~/, wrap: (children, key) => <s key={key}>{children}</s> },
  { pattern: /\|\|([\s\S]+?)\|\|/, wrap: (children, key) => <span key={key} className="rounded bg-[#1e1f22] px-0.5">{children}</span> },
  { pattern: /\*([^*\n]+?)\*/, wrap: (children, key) => <em key={key}>{children}</em> },
  // \b: como en Discord, los guiones bajos dentro de una palabra (mi_nombre_aqui) no son cursiva
  { pattern: /\b_([^_\n]+?)_\b/, wrap: (children, key) => <em key={key}>{children}</em> },
];

function renderInline(text: string, ctx: PreviewContext, keyPrefix: string, depth = 0): ReactNode[] {
  if (!text) return [];
  let best: { rule: InlineRule; match: RegExpExecArray } | null = null;
  if (depth < 8) {
    for (const rule of INLINE_RULES) {
      const match = rule.pattern.exec(text);
      if (match && (!best || match.index < best.match.index)) best = { rule, match };
    }
  }
  if (!best) return renderPlaceholders(text, ctx, keyPrefix);

  const { rule, match } = best;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const inner = rule.raw
    ? renderPlaceholders(match[1], ctx, `${keyPrefix}-c`, true)
    : renderInline(match[1], ctx, `${keyPrefix}-i`, depth + 1);
  return [
    ...renderPlaceholders(before, ctx, `${keyPrefix}-b`),
    rule.wrap(inner, `${keyPrefix}-w`),
    ...renderInline(after, ctx, `${keyPrefix}-a`, depth),
  ];
}

interface WelcomePreviewProps {
  /** Texto del formulario ("" = el predeterminado) */
  template: string;
  defaultMessage: string;
  user: SessionUser | null;
  guild: Pick<UserGuild, "id" | "name" | "icon"> | null;
  memberCount: number | null;
  /** Hay un canal elegido (aunque no sepamos su nombre) */
  hasChannel: boolean;
  /** "#bienvenidas", o null si no hay canal o no se sabe su nombre */
  channelName: string | null;
}

/** Vista previa en vivo de la bienvenida, con el aspecto de un mensaje de Discord. */
export function WelcomePreview({
  template,
  defaultMessage,
  user,
  guild,
  memberCount,
  hasChannel,
  channelName,
}: WelcomePreviewProps) {
  const guildName = guild?.name ?? "tu servidor";
  const ctx: PreviewContext = { user, guildName, memberCount };
  const text = template.trim() ? template : defaultMessage;
  const time = `Hoy a las ${formatLocalTime(new Date())}`;
  const avatar = userAvatarUrl(user, 128);
  const guildIcon = guild ? guildIconUrl(guild, 32) : null;
  const name = user ? displayName(user) : "Persona nueva";

  return (
    <figure className="space-y-2" aria-label="Vista previa del mensaje de bienvenida">
      <figcaption className="flex flex-wrap items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Vista previa
        {channelName ? (
          <span className="inline-flex items-center gap-0.5 normal-case tracking-normal text-foreground">
            · en <Hash className="h-3 w-3" aria-hidden="true" />
            {channelName.replace(/^#/, "")}
          </span>
        ) : (
          <span className="normal-case tracking-normal">
            {hasChannel ? "· en el canal elegido" : "· elige un canal para publicarla"}
          </span>
        )}
      </figcaption>

      <div className={`overflow-hidden rounded-lg ${DISCORD.chat} p-3 sm:p-4`} data-testid="preview-welcome">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary" aria-hidden="true">
            <Bot className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-medium text-white">BotM</span>
              <span className="rounded bg-[#5865f2] px-1 text-[10px] font-semibold leading-4 text-white">APP</span>
              <span className={`text-xs ${DISCORD.muted}`}>{time}</span>
            </div>
            <p className={`text-[15px] ${DISCORD.text}`}>
              <Mention>@{name}</Mention>
            </p>

            {/* Embed */}
            <div className={`mt-1.5 max-w-[30rem] rounded border-l-4 ${DISCORD.embedBorder} ${DISCORD.embed} p-3 sm:pr-4`}>
              <div className="flex gap-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-[15px] font-semibold text-white">
                    👋 ¡Bienvenid@ a {guildName}!
                  </p>
                  <div className={`mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed ${DISCORD.text}`}>
                    {renderInline(text, ctx, "m")}
                  </div>
                </div>
                <Avatar className="h-14 w-14 shrink-0 rounded-md after:rounded-md sm:h-20 sm:w-20">
                  {avatar && <AvatarImage src={avatar} alt="" className="rounded-md" />}
                  <AvatarFallback className="rounded-md bg-[#5865f2] text-lg font-semibold text-white">
                    {initials(name)}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className={`mt-2 flex flex-wrap items-center gap-1.5 text-xs ${DISCORD.muted}`}>
                {guildIcon && <img src={guildIcon} alt="" className="h-5 w-5 rounded-full" />}
                <span>
                  {memberCount !== null ? `Miembro #${numberFormat.format(memberCount)}` : "Miembro #—"} • {time}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Así se ve contigo como la persona nueva. Es una vista aproximada: Discord puede mostrarla un poco distinta.
      </p>
    </figure>
  );
}
