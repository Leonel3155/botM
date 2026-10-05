import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, type LucideIcon } from "lucide-react";
import type { DiscordChannelItem } from "@shared/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ChannelIssueNote, ChannelPicker, getChannelIssue } from "./channel-picker";

interface ChannelRoleCardProps {
  /** Se usa para el id del selector y los textos de ayuda. */
  fieldId: string;
  icon: LucideIcon;
  title: string;
  /** Para qué usa el bot este canal (una frase). */
  purpose: ReactNode;
  /** Detalles de cómo funciona, según lo que hace el bot de verdad. */
  facts: ReactNode[];
  /** Estado de la función relacionada (p. ej. "Bienvenida activada"). */
  status?: ReactNode;
  value: string | null;
  savedValue: string | null;
  onChange: (channelId: string | null) => void;
  onBlur?: () => void;
  channels: DiscordChannelItem[];
  disabled?: boolean;
  /** Avisos según el contexto (p. ej. la bienvenida está activada y no hay canal). */
  notes?: ReactNode;
  /** Error de validación del formulario. */
  error?: string;
  link: { href: string; label: string };
}

/** Una fila de la página Canales: qué hace el bot ahí y el selector del canal. */
export function ChannelRoleCard({
  fieldId,
  icon: Icon,
  title,
  purpose,
  facts,
  status,
  value,
  savedValue,
  onChange,
  onBlur,
  channels,
  disabled,
  notes,
  error,
  link,
}: ChannelRoleCardProps) {
  const changed = value !== savedValue;
  const issue = getChannelIssue(channels, value);
  const helpId = `${fieldId}-ayuda`;
  const issueId = `${fieldId}-aviso`;
  const errorId = `${fieldId}-error`;
  const describedBy = [helpId, issue ? issueId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <Card className={cn(changed && "border-primary/60")} data-testid={`card-channel-${fieldId}`}>
      <CardHeader className="space-y-2 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            {title}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {changed && <Badge>Cambio sin guardar</Badge>}
            {status}
          </div>
        </div>
        <CardDescription className="text-sm">{purpose}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <ul className="space-y-2 text-sm text-muted-foreground" id={helpId}>
            {facts.map((fact, index) => (
              <li key={index} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{fact}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-2">
            <Label htmlFor={fieldId}>Canal</Label>
            <ChannelPicker
              id={fieldId}
              value={value}
              onChange={onChange}
              onBlur={onBlur}
              channels={channels}
              noneLabel="Sin canal"
              placeholder="Sin canal"
              disabled={disabled}
              aria-describedby={describedBy}
              aria-invalid={!!error}
              data-testid={`select-${fieldId}`}
            />
            <ChannelIssueNote issue={issue} id={issueId} />
            {notes}
            {error && (
              <p id={errorId} className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <Button asChild variant="link" size="sm" className="h-auto px-0">
              <Link href={link.href}>
                {link.label}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
