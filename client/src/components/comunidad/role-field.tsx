import type { UseQueryResult } from "@tanstack/react-query";
import type { Control } from "react-hook-form";
import { RefreshCw } from "lucide-react";
import type { DiscordRoleItem, DiscordRolesResponse } from "@shared/api";
import { Button } from "@/components/ui/button";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorInfo, isApiError } from "@/lib/queryClient";
import type { EngagementFormValues } from "./form";
import { RichSelectItem } from "./rich-select-item";
import { InlineWarning } from "./section-parts";

/** Valor del selector para "sin rol" (Radix no admite "" en los elementos). */
const NO_ROLE = "__sin_rol__";

function RoleName({ role }: { role: DiscordRoleItem }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        className="h-3 w-3 shrink-0 rounded-full border border-border"
        style={role.color ? { backgroundColor: role.color } : undefined}
        aria-hidden="true"
      />
      <span className="truncate">@{role.name}</span>
    </span>
  );
}

/** "@Miembro" si conocemos el rol, o null. */
export function roleLabel(roles: DiscordRolesResponse | undefined, roleId: string | null | undefined): string | null {
  if (!roleId) return null;
  const role = roles?.find((candidate) => candidate.id === roleId);
  return role ? `@${role.name}` : null;
}

interface RoleFieldProps {
  control: Control<EngagementFormValues>;
  rolesQuery: UseQueryResult<DiscordRolesResponse>;
  savedRoleId: string | null;
  savedProblem: string | null;
}

/** Rol automático de bienvenida (opcional). Los roles que no se pueden dar salen en gris con el motivo. */
export function RoleField({ control, rolesQuery, savedRoleId, savedProblem }: RoleFieldProps) {
  const roles = rolesQuery.data ?? [];
  const blocked = roles.filter((role) => !role.assignable);
  // Si ningún rol se puede usar por el mismo motivo (p. ej. te falta Gestionar roles), lo decimos una vez
  const sharedReason =
    roles.length > 0 && blocked.length === roles.length && new Set(blocked.map((role) => role.reason)).size === 1
      ? blocked[0].reason
      : null;
  const errorInfo = rolesQuery.isError ? getApiErrorInfo(rolesQuery.error) : null;
  const botMissing = isApiError(rolesQuery.error) && rolesQuery.error.kind === "botMissing";

  return (
    <FormField
      control={control}
      name="welcome.roleId"
      render={({ field }) => {
        const value = field.value ?? null;
        const selected = value ? roles.find((role) => role.id === value) : undefined;
        const unknown = !!value && rolesQuery.isSuccess && !selected;

        let warning: string | null = null;
        if (value && value === savedRoleId && savedProblem) warning = savedProblem;
        else if (unknown) warning = "Ese rol ya no existe. Elige otro o quítalo.";
        else if (selected && !selected.assignable && selected.reason) warning = selected.reason;

        return (
          <FormItem>
            <FormLabel>Rol automático al entrar (opcional)</FormLabel>
            {rolesQuery.isLoading ? (
              <Skeleton className="h-9 w-full" aria-label="Cargando roles" />
            ) : (
              <Select
                value={value ?? NO_ROLE}
                onValueChange={(next) => field.onChange(next === NO_ROLE ? null : next)}
                disabled={!rolesQuery.isSuccess}
              >
                <FormControl>
                  <SelectTrigger ref={field.ref} onBlur={field.onBlur} data-testid="select-welcome-role">
                    <SelectValue>
                      {rolesQuery.isSuccess
                        ? undefined
                        : value
                          ? "Rol guardado (no pude cargar la lista)"
                          : "Sin rol automático"}
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="max-h-80">
                  <RichSelectItem value={NO_ROLE} hint="Solo el mensaje de bienvenida">
                    Sin rol automático
                  </RichSelectItem>
                  {(roles.length > 0 || unknown) && <SelectSeparator />}
                  {unknown && value && (
                    <RichSelectItem value={value} disabled hint="Ya no existe">
                      Rol desconocido
                    </RichSelectItem>
                  )}
                  {roles.map((role) => (
                    <RichSelectItem
                      key={role.id}
                      value={role.id}
                      disabled={!role.assignable}
                      hint={role.assignable || sharedReason ? undefined : role.reason ?? "No se puede usar"}
                    >
                      <RoleName role={role} />
                    </RichSelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <FormDescription>
              Se lo doy a cada persona nueva (si tu servidor pide aceptar las reglas, se lo doy al aceptarlas).
            </FormDescription>
            {rolesQuery.isSuccess && roles.length === 0 && (
              <p className="text-xs text-muted-foreground">Este servidor todavía no tiene roles (aparte de @everyone).</p>
            )}
            {sharedReason && <InlineWarning>{sharedReason}</InlineWarning>}
            <FormMessage />
            {warning && warning !== sharedReason && <InlineWarning>{warning}</InlineWarning>}
            {errorInfo && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="alert">
                <span>
                  {errorInfo.title}.{" "}
                  {botMissing ? "Invita al bot para poder elegir un rol." : errorInfo.description}
                </span>
                {!botMissing && (
                  <Button type="button" variant="outline" size="sm" onClick={() => void rolesQuery.refetch()}>
                    <RefreshCw />
                    Reintentar
                  </Button>
                )}
              </div>
            )}
          </FormItem>
        );
      }}
    />
  );
}
