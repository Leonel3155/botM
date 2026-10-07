import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import type { LevelBucket, ModerationDay, WealthEntry } from "@shared/api";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHART_COLOR, ChartTooltipBox } from "./chart-card";
import { formatCompact, formatDay, formatNumber, moderationLabel, plural, userName } from "./format";

// Gráficas de Estadísticas (recharts). Una sola serie por gráfica, en el amarillo del tema:
// rejilla horizontal fina, ejes en gris, barras de ≤24 px con la punta redondeada.

const AXIS_FONT_SIZE = 11;
const AXIS_TICK = { fontSize: AXIS_FONT_SIZE };

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Valor de una barra solo si es mayor que 0 (las barras vacías no llevan etiqueta). */
function labelIfPositive(value: unknown): string {
  return typeof value === "number" && value > 0 ? formatCompact(value) : "";
}

// =============================================
// Distribución de niveles
// =============================================

function bucketTitle(bucket: LevelBucket): string {
  return bucket.maxLevel === null ? `Nivel ${bucket.minLevel} o más` : `Niveles ${bucket.minLevel} a ${bucket.maxLevel}`;
}

const levelConfig = { users: { label: "Personas", color: CHART_COLOR } } satisfies ChartConfig;

/** Ancho aproximado (px) de un carácter del eje a 11 px, con algo de margen. */
const AXIS_CHAR_WIDTH = 7;
/** Espacio mínimo (px) entre dos etiquetas vecinas. */
const AXIS_LABEL_GAP = 6;

/** Props que recharts le pasa a cada etiqueta del eje X (width = ancho del eje). */
interface AxisTickProps {
  x?: number;
  y?: number;
  width?: number;
  visibleTicksCount?: number;
  payload?: { value?: unknown };
}

/**
 * Etiqueta del eje de niveles: "20-29" en una línea si cabe en su hueco; si no
 * (celular, o dos gráficas lado a lado), en dos líneas: "20" y "a 29". Así las
 * 8 etiquetas nunca se pisan.
 */
function LevelAxisTick({ x = 0, y = 0, width = 0, visibleTicksCount = 1, payload }: AxisTickProps) {
  const label = String(payload?.value ?? "");
  const slot = width / Math.max(1, visibleTicksCount);
  const [from, to] = label.split("-");
  const stacked = to !== undefined && label.length * AXIS_CHAR_WIDTH + AXIS_LABEL_GAP > slot;
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={AXIS_FONT_SIZE}>
      <tspan x={x} dy="0.71em">
        {stacked ? from : label}
      </tspan>
      {stacked && (
        <tspan x={x} dy="1.2em">
          a {to}
        </tspan>
      )}
    </text>
  );
}

export function LevelDistributionChart({ buckets }: { buckets: LevelBucket[] }) {
  return (
    <ChartContainer config={levelConfig} className="aspect-auto h-64 w-full" data-testid="chart-levels">
      <BarChart data={buckets} margin={{ top: 20, right: 4, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        {/* Alto para dos líneas de etiqueta (ver LevelAxisTick) */}
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={0}
          height={40}
          tick={(props: AxisTickProps) => <LevelAxisTick {...props} />}
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} tick={AXIS_TICK} tickFormatter={formatCompact} />
        <ChartTooltip
          cursor={{ fillOpacity: 0.5 }}
          content={({ active, payload }) => {
            const bucket = active ? (payload?.[0]?.payload as LevelBucket | undefined) : undefined;
            if (!bucket) return null;
            return (
              <ChartTooltipBox
                title={bucketTitle(bucket)}
                rows={[{ label: bucket.users === 1 ? "persona" : "personas", value: formatNumber(bucket.users), color: CHART_COLOR }]}
              />
            );
          }}
        />
        <Bar dataKey="users" fill="var(--color-users)" radius={[4, 4, 0, 0]} maxBarSize={24}>
          <LabelList dataKey="users" position="top" offset={6} className="fill-foreground" fontSize={11} formatter={labelIfPositive} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function LevelDistributionTable({ buckets }: { buckets: LevelBucket[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Niveles</TableHead>
          <TableHead className="text-right">Personas</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {buckets.map((bucket) => (
          <TableRow key={bucket.label}>
            <TableCell>{bucketTitle(bucket)}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{formatNumber(bucket.users)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function levelDistributionSummary(buckets: LevelBucket[]): string {
  return `Personas por rango de nivel: ${buckets.map((b) => `${bucketTitle(b)}, ${plural(b.users, "persona", "personas")}`).join("; ")}.`;
}

// =============================================
// Quién tiene más monedas
// =============================================

interface EarnerRow extends WealthEntry {
  /** "1. Nombre": único aunque dos personas se llamen igual */
  key: string;
  name: string;
}

function toEarnerRows(entries: WealthEntry[]): EarnerRow[] {
  return entries.map((entry) => {
    const name = userName({ id: entry.userId, username: entry.username });
    return { ...entry, name, key: `${entry.rank}. ${name}` };
  });
}

const earnersConfig = { total: { label: "Monedas", color: CHART_COLOR } } satisfies ChartConfig;

const EARNER_ROW_HEIGHT = 34;

export function TopEarnersChart({ entries }: { entries: WealthEntry[] }) {
  const rows = toEarnerRows(entries);
  return (
    <ChartContainer
      config={earnersConfig}
      className="aspect-auto w-full"
      style={{ height: rows.length * EARNER_ROW_HEIGHT + 36 }}
      data-testid="chart-earners"
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 44, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={formatCompact} />
        <YAxis
          type="category"
          dataKey="key"
          tickLine={false}
          axisLine={false}
          width={104}
          tick={AXIS_TICK}
          tickFormatter={(value: string) => truncate(value, 15)}
        />
        <ChartTooltip
          cursor={{ fillOpacity: 0.5 }}
          content={({ active, payload }) => {
            const row = active ? (payload?.[0]?.payload as EarnerRow | undefined) : undefined;
            if (!row) return null;
            return (
              <ChartTooltipBox
                title={`#${row.rank} · ${row.name}`}
                rows={[
                  { label: "monedas en total", value: formatNumber(row.total), color: CHART_COLOR },
                  { label: "en la cartera", value: formatNumber(row.wallet) },
                  { label: "en el banco", value: formatNumber(row.bank) },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="total" fill="var(--color-total)" radius={[0, 4, 4, 0]} maxBarSize={20}>
          <LabelList dataKey="total" position="right" offset={6} className="fill-foreground" fontSize={11} formatter={labelIfPositive} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function TopEarnersTable({ entries }: { entries: WealthEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Nombre</TableHead>
          <TableHead className="text-right">Cartera</TableHead>
          <TableHead className="text-right">Banco</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {toEarnerRows(entries).map((row) => (
          <TableRow key={row.userId}>
            <TableCell className="font-mono tabular-nums text-muted-foreground">{row.rank}</TableCell>
            <TableCell className="max-w-[10rem] truncate">{row.name}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{formatNumber(row.wallet)}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{formatNumber(row.bank)}</TableCell>
            <TableCell className="text-right font-mono font-semibold tabular-nums">{formatNumber(row.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function topEarnersSummary(entries: WealthEntry[]): string {
  return `Personas con más monedas: ${toEarnerRows(entries)
    .map((row) => `${row.rank}. ${row.name}, ${plural(row.total, "moneda", "monedas")}`)
    .join("; ")}.`;
}

// =============================================
// Moderación por día
// =============================================

interface DayRow extends ModerationDay {
  short: string;
}

const moderationConfig = { total: { label: "Acciones", color: CHART_COLOR } } satisfies ChartConfig;

/** byType ordenado de mayor a menor, con nombres en español. */
function typeBreakdown(byType: Record<string, number>): { type: string; label: string; count: number }[] {
  return Object.entries(byType)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, label: moderationLabel(type), count }));
}

export function ModerationPerDayChart({ days }: { days: ModerationDay[] }) {
  const rows: DayRow[] = days.map((day) => ({ ...day, short: formatDay(day.date, "short") }));
  return (
    <ChartContainer config={moderationConfig} className="aspect-auto h-64 w-full" data-testid="chart-moderation">
      <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="short"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
          minTickGap={18}
          tick={AXIS_TICK}
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={AXIS_TICK} tickFormatter={formatCompact} />
        <ChartTooltip
          cursor={{ fillOpacity: 0.5 }}
          content={({ active, payload }) => {
            const row = active ? (payload?.[0]?.payload as DayRow | undefined) : undefined;
            if (!row) return null;
            return (
              <ChartTooltipBox
                title={capitalize(formatDay(row.date, "long"))}
                rows={[
                  { label: row.total === 1 ? "acción" : "acciones", value: formatNumber(row.total), color: CHART_COLOR },
                  ...typeBreakdown(row.byType).map((item) => ({ label: item.label, value: formatNumber(item.count) })),
                ]}
              />
            );
          }}
        />
        <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ChartContainer>
  );
}

export function ModerationPerDayTable({ days }: { days: ModerationDay[] }) {
  // Solo los días con acciones (los demás son 0)
  const withActions = [...days].reverse().filter((day) => day.total > 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Día</TableHead>
          <TableHead className="text-right">Acciones</TableHead>
          <TableHead>Detalle</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {withActions.map((day) => (
          <TableRow key={day.date}>
            <TableCell className="whitespace-nowrap">{capitalize(formatDay(day.date, "long"))}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{formatNumber(day.total)}</TableCell>
            <TableCell className="text-muted-foreground">
              {typeBreakdown(day.byType)
                .map((item) => `${item.label}: ${formatNumber(item.count)}`)
                .join(" · ")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function moderationPerDaySummary(days: ModerationDay[]): string {
  const withActions = days.filter((day) => day.total > 0);
  const total = withActions.reduce((sum, day) => sum + day.total, 0);
  const busiest = withActions.reduce<ModerationDay | null>((max, day) => (!max || day.total > max.total ? day : max), null);
  return `${plural(total, "acción", "acciones")} de moderación en ${plural(withActions.length, "día", "días")} de los últimos ${days.length}.${
    busiest ? ` El día con más fue ${formatDay(busiest.date, "long")}, con ${plural(busiest.total, "acción", "acciones")}.` : ""
  }`;
}

/** Acciones de los últimos 30 días por tipo: barras simples en HTML con el número al lado. */
export function ModerationByTypeList({ byType }: { byType: Record<string, number> }) {
  const items = typeBreakdown(byType);
  const max = items[0]?.count ?? 0;
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2.5" data-testid="list-moderation-types">
      {items.map((item) => (
        <li key={item.type} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{item.label}</span>
          <div className="h-2 rounded-full bg-primary/15" aria-hidden="true">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${max > 0 ? Math.max(4, (item.count / max) * 100) : 0}%` }}
            />
          </div>
          <span className="text-right font-mono tabular-nums text-foreground">{formatNumber(item.count)}</span>
        </li>
      ))}
    </ul>
  );
}
