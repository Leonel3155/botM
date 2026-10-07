import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Bot, Loader2, Plus, Save } from "lucide-react";
import {
  CUSTOM_COMMAND_LIMITS,
  CUSTOM_COMMAND_PLACEHOLDERS,
  type CustomCommandCreateRequest,
  type CustomCommandItem,
  type CustomCommandResponse,
  type CustomCommandUpdateRequest,
} from "@shared/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, isApiError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ResponsePreview } from "./response-preview";
import {
  errorMessage,
  invalidateCustomCommands,
  updateCachedCommands,
  type PlaceholderKey,
  type PreviewValue,
} from "./utils";

const { nameMaxLength, descriptionMaxLength, responseMaxLength } = CUSTOM_COMMAND_LIMITS;
const NAME_REGEX = new RegExp(CUSTOM_COMMAND_LIMITS.namePattern);

/** Igual que el servidor: sin espacios alrededor y en minúsculas. */
function normalizeName(raw: string): string {
  return raw.trim().toLowerCase();
}

interface NameRules {
  prefix: string;
  reserved: Set<string>;
  /** Nombres que ya usan otros comandos de este servidor. */
  taken: Set<string>;
}

/** Problema con el nombre (o null si se puede usar), con el mismo criterio que el servidor. */
function nameProblem(raw: string, { prefix, reserved, taken }: NameRules): string | null {
  const name = normalizeName(raw);
  if (!name) return "Ponle un nombre al comando.";
  if (name.length > nameMaxLength) return `El nombre puede tener hasta ${nameMaxLength} caracteres.`;
  if (!NAME_REGEX.test(name)) {
    if (prefix && name.startsWith(prefix.toLowerCase())) {
      return `Escribe solo el nombre, sin el prefijo ${prefix} (ese ya lo ponemos nosotros).`;
    }
    if (/\s/.test(name)) return "Sin espacios: usa - o _ para separar palabras.";
    return "Usa solo letras minúsculas sin acentos (ni ñ), números, - y _.";
  }
  if (reserved.has(name)) return `${prefix}${name} ya es un comando del bot. Elige otro nombre.`;
  if (taken.has(name)) return `Ya tienes un comando llamado ${prefix}${name}.`;
  return null;
}

function buildSchema(rules: NameRules) {
  return z.object({
    name: z.string().superRefine((value, ctx) => {
      const message = nameProblem(value, rules);
      if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }),
    description: z
      .string()
      .max(descriptionMaxLength, `La descripción puede tener hasta ${descriptionMaxLength} caracteres.`),
    response: z.string().superRefine((value, ctx) => {
      const length = value.trim().length;
      if (length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Escribe lo que va a contestar el bot." });
      } else if (length > responseMaxLength) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `La respuesta puede tener hasta ${responseMaxLength.toLocaleString("es-MX")} caracteres (ahora tiene ${length.toLocaleString("es-MX")}).`,
        });
      }
    }),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;
type FieldName = keyof FormValues;
const FIELD_NAMES: FieldName[] = ["name", "description", "response"];

type SaveRequest =
  | { kind: "create"; body: CustomCommandCreateRequest }
  | { kind: "update"; id: string; body: CustomCommandUpdateRequest };

function CharCount({ value, max }: { value: number; max: number }) {
  return (
    <span className={cn("font-mono text-xs", value > max ? "text-destructive" : "text-muted-foreground")}>
      {value.toLocaleString("es-MX")}/{max.toLocaleString("es-MX")}
    </span>
  );
}

export interface CommandDraft {
  name: string;
  description: string;
}

export interface CommandFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guildId: string;
  prefix: string;
  /** El bot tiene que estar en el servidor para crear comandos. */
  botInGuild: boolean;
  reservedNames: Set<string>;
  /** Nombres de todos los comandos del servidor. */
  existingNames: string[];
  /** null = crear uno nuevo. */
  command: CustomCommandItem | null;
  /** Al crear: nombre y descripción sugeridos (las ideas del estado vacío). */
  draft?: CommandDraft | null;
  /** Valores de la vista previa (de ejemplo o reales). */
  previewValues: Record<PlaceholderKey, PreviewValue>;
}

/** Diálogo para crear o editar un comando personalizado (con vista previa en vivo). */
export function CommandFormDialog({
  open,
  onOpenChange,
  guildId,
  prefix,
  botInGuild,
  reservedNames,
  existingNames,
  command,
  draft = null,
  previewValues,
}: CommandFormDialogProps) {
  const { toast } = useToast();
  const editing = command !== null;
  const [rootError, setRootError] = useState<string | null>(null);
  const [insertError, setInsertError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** La persona ya puso el cursor en la respuesta (si no, las variables se agregan al final). */
  const cursorKnownRef = useRef(false);

  const taken = useMemo(
    () => new Set(existingNames.filter((name) => name !== command?.name)),
    [existingNames, command?.name],
  );
  const schema = useMemo(() => buildSchema({ prefix, reserved: reservedNames, taken }), [prefix, reservedNames, taken]);

  const defaults = useMemo<FormValues>(
    () => ({
      name: command?.name ?? draft?.name ?? "",
      description: command ? command.description ?? "" : draft?.description ?? "",
      response: command?.response ?? "",
    }),
    [command, draft],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
    mode: "onTouched",
  });

  // Cada vez que se abre, empieza con los datos del comando (o vacío)
  useEffect(() => {
    if (!open) return;
    form.reset(defaults);
    setRootError(null);
    setInsertError(null);
    cursorKnownRef.current = false;
    // Solo al abrir o al cambiar de comando: no queremos borrar lo escrito cuando la lista se vuelve a pedir
  }, [open, command?.id, draft]);

  const mutation = useMutation({
    mutationFn: async (request: SaveRequest): Promise<CustomCommandResponse> => {
      const res =
        request.kind === "create"
          ? await apiRequest("POST", `/api/custom-commands/${guildId}`, request.body)
          : await apiRequest("PATCH", `/api/custom-commands/${guildId}/${request.id}`, request.body);
      return (await res.json()) as CustomCommandResponse;
    },
    onSuccess: (saved, request) => {
      if (request.kind === "create") {
        updateCachedCommands(guildId, (commands) => [...commands.filter((c) => c.id !== saved.id), saved]);
        invalidateCustomCommands(guildId, { dashboard: true });
        toast({
          title: `¡Listo! Creaste ${prefix}${saved.name}`,
          description: `Pruébalo escribiendo ${prefix}${saved.name} en un canal donde el bot pueda escribir.`,
        });
      } else {
        updateCachedCommands(guildId, (commands) => commands.map((c) => (c.id === saved.id ? saved : c)));
        invalidateCustomCommands(guildId);
        toast({ title: "Cambios guardados", description: `${prefix}${saved.name} ya responde con lo nuevo.` });
      }
      onOpenChange(false);
    },
    onError: (error, request) => {
      const message = errorMessage(error);
      toast({
        variant: "destructive",
        title: request.kind === "create" ? "No se pudo crear el comando" : "No se pudieron guardar los cambios",
        description: message,
      });

      if (!isApiError(error)) {
        setRootError(message);
        return;
      }

      // El comando ya no existe (lo borró alguien más): cerramos y actualizamos la lista
      if (request.kind === "update" && error.kind === "notFound") {
        invalidateCustomCommands(guildId, { dashboard: true });
        onOpenChange(false);
        return;
      }

      if (error.status === 409) {
        // Nombre repetido (lo dice el mensaje) o límite de comandos alcanzado
        invalidateCustomCommands(guildId, { dashboard: true });
        const sentName = request.body.name;
        if (sentName && message.includes(`"${sentName}"`)) {
          form.setError("name", { type: "server", message: `Ya tienes un comando llamado ${prefix}${sentName}.` });
        } else {
          setRootError(message);
        }
        return;
      }

      if (error.status === 400 && error.body?.details?.length) {
        let mapped = false;
        for (const detail of error.body.details) {
          const field = FIELD_NAMES.find((name) => name === detail.field);
          if (field) {
            form.setError(field, { type: "server", message: detail.message });
            mapped = true;
          }
        }
        if (!mapped) setRootError(message);
        return;
      }

      setRootError(message);
    },
  });

  const pending = mutation.isPending;

  const handleOpenChange = (next: boolean) => {
    if (!next && pending) return; // no cerrar a medio guardar
    onOpenChange(next);
  };

  const onSubmit = form.handleSubmit((values) => {
    setRootError(null);
    const name = normalizeName(values.name);
    const description = values.description.trim() || null;
    const response = values.response.trim();

    if (!command) {
      mutation.mutate({ kind: "create", body: { name, response, description } });
      return;
    }

    // Solo mandamos lo que cambió
    const body: CustomCommandUpdateRequest = {};
    if (name !== command.name) body.name = name;
    if (response !== command.response) body.response = response;
    if (description !== (command.description ?? null)) body.description = description;
    if (Object.keys(body).length === 0) {
      toast({ title: "No había cambios que guardar" });
      onOpenChange(false);
      return;
    }
    mutation.mutate({ kind: "update", id: command.id, body });
  });

  const insertPlaceholder = (key: string) => {
    setInsertError(null);
    const current = form.getValues("response");
    const el = textareaRef.current;
    const atCursor = cursorKnownRef.current && el !== null;
    const start = atCursor ? Math.min(el.selectionStart, current.length) : current.length;
    const end = atCursor ? Math.min(Math.max(el.selectionEnd, start), current.length) : current.length;
    // Si se agrega al final sin cursor, la separamos con un espacio
    const text = !atCursor && current.length > 0 && !/\s$/.test(current) ? ` ${key}` : key;
    const next = current.slice(0, start) + text + current.slice(end);

    if (next.length > responseMaxLength) {
      setInsertError(`No cabe: la respuesta pasaría de ${responseMaxLength.toLocaleString("es-MX")} caracteres.`);
      return;
    }

    form.setValue("response", next, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: form.formState.isSubmitted || Boolean(form.formState.errors.response),
    });
    const cursor = start + text.length;
    requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(cursor, cursor);
    });
  };

  const name = form.watch("name");
  const response = form.watch("response");
  const description = form.watch("description");
  const normalizedName = normalizeName(name);
  const renamed = editing && normalizedName !== "" && normalizedName !== command.name;
  const trigger = `${prefix}${normalizedName || "nombre"}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-lg p-4 sm:p-6"
        onOpenAutoFocus={(event) => {
          // Con una idea elegida el nombre ya está puesto: directo a escribir la respuesta
          if (!command && draft && textareaRef.current) {
            event.preventDefault();
            textareaRef.current.focus();
          }
        }}
        data-testid="dialog-command-form"
      >
        <DialogHeader className="pr-6 text-left">
          <DialogTitle className="break-all leading-tight">
            {command ? (
              <>
                Editar <span className="font-mono text-primary">{prefix}{command.name}</span>
              </>
            ) : (
              "Nuevo comando"
            )}
          </DialogTitle>
          <DialogDescription>
            {command
              ? "Cambia el nombre, la descripción o lo que contesta el bot."
              : "Elige cómo se llama y qué contesta el bot cuando alguien lo escriba en Discord."}
          </DialogDescription>
        </DialogHeader>

        {!command && !botInGuild && (
          <Alert className="border-status-warning/40 bg-status-warning/10">
            <Bot className="h-4 w-4 !text-status-warning" aria-hidden="true" />
            <AlertTitle>El bot no está en este servidor</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Invítalo primero: sin el bot no se puede guardar el comando (ni habría quien lo conteste).
            </AlertDescription>
          </Alert>
        )}

        {rootError && (
          <Alert variant="destructive" data-testid="alert-command-error">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>No se pudo guardar</AlertTitle>
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>Nombre del comando</FormLabel>
                    <CharCount value={normalizeName(field.value).length} max={nameMaxLength} />
                  </div>
                  <div className="flex">
                    <span
                      className="inline-flex h-9 shrink-0 items-center rounded-l-md border border-r-0 border-input bg-muted px-3 font-mono text-sm text-primary"
                      aria-hidden="true"
                    >
                      {prefix}
                    </span>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(event) => field.onChange(event.target.value.toLowerCase().replace(/\s/g, "-"))}
                        className="min-w-0 rounded-l-none font-mono"
                        placeholder="reglas"
                        maxLength={nameMaxLength}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={pending}
                        data-testid="input-command-name"
                      />
                    </FormControl>
                  </div>
                  <FormDescription className="text-xs">
                    Minúsculas, números, - y _ (los espacios se cambian por -). En Discord se usa escribiendo{" "}
                    <code className="break-all font-mono text-foreground">{trigger}</code>.
                  </FormDescription>
                  {renamed && (
                    <p className="text-xs text-status-warning">
                      Ojo: <span className="font-mono">{prefix}{command.name}</span> dejará de funcionar y habrá que
                      usar <span className="font-mono">{prefix}{normalizedName}</span>.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>
                      Descripción <span className="font-normal text-muted-foreground">(opcional)</span>
                    </FormLabel>
                    <CharCount value={description.length} max={descriptionMaxLength} />
                  </div>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Para qué sirve"
                      maxLength={descriptionMaxLength}
                      autoComplete="off"
                      disabled={pending}
                      data-testid="input-command-description"
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Solo se ve aquí en el panel, para que recuerdes para qué es.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="response"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>Respuesta del bot</FormLabel>
                    <CharCount value={response.trim().length} max={responseMaxLength} />
                  </div>
                  <FormControl>
                    <Textarea
                      {...field}
                      ref={(element) => {
                        field.ref(element);
                        textareaRef.current = element;
                      }}
                      onFocus={() => {
                        cursorKnownRef.current = true;
                      }}
                      rows={5}
                      maxLength={responseMaxLength}
                      placeholder="Lo que dirá el bot. Puedes usar las variables de abajo."
                      className="min-h-[120px] resize-y"
                      disabled={pending}
                      data-testid="input-command-response"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Variables: se insertan donde está el cursor */}
            <fieldset className="space-y-2" disabled={pending}>
              <legend className="text-sm font-medium text-foreground">Variables</legend>
              <p className="text-xs text-muted-foreground">
                Toca una para agregarla a la respuesta. El bot la cambia por el dato real cada vez que alguien usa el comando.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CUSTOM_COMMAND_PLACEHOLDERS.map((placeholder) => (
                  <button
                    key={placeholder.key}
                    type="button"
                    onClick={() => insertPlaceholder(placeholder.key)}
                    className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-1.5 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    aria-label={`Insertar ${placeholder.key}: ${placeholder.description}`}
                    data-testid={`button-placeholder-${placeholder.key.slice(1, -1)}`}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <code className="shrink-0 font-mono text-xs text-primary">{placeholder.key}</code>
                    <span className="min-w-0 text-xs text-muted-foreground">{placeholder.description}</span>
                  </button>
                ))}
              </div>
              {insertError && (
                <p className="text-xs font-medium text-destructive" role="alert">
                  {insertError}
                </p>
              )}
            </fieldset>

            <ResponsePreview trigger={trigger} response={response} values={previewValues} />

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={pending || (editing && !form.formState.isDirty)}
                data-testid="button-save-command"
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : command ? <Save aria-hidden="true" /> : <Plus aria-hidden="true" />}
                {pending ? "Guardando…" : command ? "Guardar cambios" : "Crear comando"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
