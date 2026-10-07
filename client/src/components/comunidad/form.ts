import { z } from "zod";
import {
  WELCOME_MESSAGE_MAX_LENGTH,
  type DailyQuestionSettings,
  type EngagementSettingsResponse,
  type EngagementUpdateRequest,
  type WelcomeSettings,
} from "@shared/api";
import { HOURS_OF_DAY, sameTimezone } from "./time";

const FIRST_HOUR = HOURS_OF_DAY[0];
const LAST_HOUR = HOURS_OF_DAY[HOURS_OF_DAY.length - 1];

/** Formulario de la página: lo mismo que guarda PATCH /api/guilds/:guildId/engagement. */
export const engagementFormSchema = z
  .object({
    welcome: z.object({
      enabled: z.boolean(),
      channelId: z.string().nullable(),
      /** "" = mensaje predeterminado del bot. */
      message: z
        .string()
        .max(
          WELCOME_MESSAGE_MAX_LENGTH,
          `El mensaje puede tener como máximo ${WELCOME_MESSAGE_MAX_LENGTH.toLocaleString("es-MX")} caracteres.`,
        ),
      roleId: z.string().nullable(),
    }),
    dailyQuestion: z.object({
      enabled: z.boolean(),
      channelId: z.string().nullable(),
      hour: z
        .number()
        .int("Elige una hora en punto.")
        .min(FIRST_HOUR, "Elige una hora del día.")
        .max(LAST_HOUR, "Elige una hora del día."),
      timezone: z.string().trim().min(1, "Elige una zona horaria."),
      thread: z.boolean(),
    }),
  })
  .superRefine((values, ctx) => {
    if (values.welcome.enabled && !values.welcome.channelId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["welcome", "channelId"],
        message: "Elige el canal de bienvenida para poder activarla.",
      });
    }
    if (values.dailyQuestion.enabled && !values.dailyQuestion.channelId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dailyQuestion", "channelId"],
        message: "Elige el canal de la pregunta del día para poder activarla.",
      });
    }
  });

export type EngagementFormValues = z.infer<typeof engagementFormSchema>;

/** Lo guardado en el servidor → valores del formulario. */
export function toFormValues(saved: EngagementSettingsResponse): EngagementFormValues {
  return {
    welcome: {
      enabled: saved.welcome.enabled,
      channelId: saved.welcome.channelId,
      message: saved.welcome.message ?? "",
      roleId: saved.welcome.roleId,
    },
    dailyQuestion: {
      enabled: saved.dailyQuestion.enabled,
      channelId: saved.dailyQuestion.channelId,
      hour: saved.dailyQuestion.hour,
      timezone: saved.dailyQuestion.timezone,
      thread: saved.dailyQuestion.thread,
    },
  };
}

/** El servidor guarda el mensaje recortado, y vacío = predeterminado (null). */
export function normalizeWelcomeMessage(message: string | null | undefined): string | null {
  const trimmed = message?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Mensaje que hay que guardar: null si está vacío o es igual al predeterminado del bot
 * (así, si el bot cambia su mensaje predeterminado, el servidor lo recibe solo).
 */
export function effectiveWelcomeMessage(
  message: string | null | undefined,
  defaultMessage: string | null | undefined,
): string | null {
  const normalized = normalizeWelcomeMessage(message);
  return normalized !== null && normalized === normalizeWelcomeMessage(defaultMessage) ? null : normalized;
}

/** ¿Los dos mensajes hacen lo mismo? (vacío y el texto predeterminado cuentan como iguales) */
export function sameWelcomeMessage(
  a: string | null | undefined,
  b: string | null | undefined,
  defaultMessage: string | null | undefined,
): boolean {
  return effectiveWelcomeMessage(a, defaultMessage) === effectiveWelcomeMessage(b, defaultMessage);
}

export interface EngagementChanges {
  body: EngagementUpdateRequest;
  welcomeChanged: boolean;
  questionChanged: boolean;
}

/** Solo lo que cambió respecto a lo guardado (null si no hay cambios). */
export function buildEngagementUpdate(
  saved: EngagementSettingsResponse,
  values: EngagementFormValues,
): EngagementChanges | null {
  const welcome: Partial<WelcomeSettings> = {};
  if (values.welcome.enabled !== saved.welcome.enabled) welcome.enabled = values.welcome.enabled;
  if ((values.welcome.channelId || null) !== saved.welcome.channelId) welcome.channelId = values.welcome.channelId || null;
  const defaultMessage = saved.welcome.defaultMessage;
  if (!sameWelcomeMessage(values.welcome.message, saved.welcome.message, defaultMessage)) {
    welcome.message = effectiveWelcomeMessage(values.welcome.message, defaultMessage);
  }
  if ((values.welcome.roleId || null) !== saved.welcome.roleId) welcome.roleId = values.welcome.roleId || null;

  const question: Partial<DailyQuestionSettings> = {};
  const savedQuestion = saved.dailyQuestion;
  if (values.dailyQuestion.enabled !== savedQuestion.enabled) question.enabled = values.dailyQuestion.enabled;
  if ((values.dailyQuestion.channelId || null) !== savedQuestion.channelId) {
    question.channelId = values.dailyQuestion.channelId || null;
  }
  if (values.dailyQuestion.hour !== savedQuestion.hour) question.hour = values.dailyQuestion.hour;
  if (!sameTimezone(values.dailyQuestion.timezone.trim(), savedQuestion.timezone)) {
    question.timezone = values.dailyQuestion.timezone.trim();
  }
  if (values.dailyQuestion.thread !== savedQuestion.thread) question.thread = values.dailyQuestion.thread;

  const welcomeChanged = Object.keys(welcome).length > 0;
  const questionChanged = Object.keys(question).length > 0;
  if (!welcomeChanged && !questionChanged) return null;

  const body: EngagementUpdateRequest = {};
  if (welcomeChanged) body.welcome = welcome;
  if (questionChanged) body.dailyQuestion = question;
  return { body, welcomeChanged, questionChanged };
}

function mergeSection<T extends object>(
  current: T,
  base: T,
  next: T,
  same: (key: keyof T, a: unknown, b: unknown) => boolean,
): T {
  const merged = { ...current };
  for (const key of Object.keys(next) as (keyof T)[]) {
    // Campo que la persona no tocó (sigue como estaba) → toma el valor nuevo del servidor,
    // salvo que el nuevo signifique lo mismo (así no se vacía el texto predeterminado que está editando)
    if (same(key, current[key], base[key]) && !same(key, current[key], next[key])) merged[key] = next[key];
  }
  return merged;
}

/**
 * Llegó una versión nueva del servidor (se guardó, o alguien cambió algo desde Discord):
 * los campos que la persona no tocó se actualizan y sus cambios sin guardar se respetan.
 * `defaultMessage` es el mensaje predeterminado del bot (vacío y ese texto cuentan como iguales).
 */
export function mergeFormValues(
  current: EngagementFormValues,
  base: EngagementFormValues,
  next: EngagementFormValues,
  defaultMessage: string | null,
): EngagementFormValues {
  return {
    welcome: mergeSection(current.welcome, base.welcome, next.welcome, (key, a, b) =>
      key === "message"
        ? sameWelcomeMessage(a as string | null, b as string | null, defaultMessage)
        : Object.is(a, b),
    ),
    dailyQuestion: mergeSection(current.dailyQuestion, base.dailyQuestion, next.dailyQuestion, (key, a, b) =>
      key === "timezone" ? sameTimezone(a as string, b as string) : Object.is(a, b),
    ),
  };
}
