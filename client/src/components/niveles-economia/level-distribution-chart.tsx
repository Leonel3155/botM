import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import type { LevelBucket } from "@shared/api";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatNumber } from "./format";

const chartConfig = {
  users: { label: "Personas", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

/**
 * Cuántas personas hay en cada rango de nivel (GET /api/guilds/:guildId/analytics).
 * Barras horizontales: en un teléfono los rangos se leen sin amontonarse.
 */
export function LevelDistributionChart({ buckets }: { buckets: LevelBucket[] }) {
  const summary = buckets.map((b) => `Niveles ${b.label}: ${formatNumber(b.users)}`).join(". ");

  return (
    <figure>
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-72 w-full"
        role="img"
        aria-label="Gráfica de personas por rango de nivel"
        data-testid="chart-level-distribution"
      >
        <BarChart data={buckets} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false} hide />
          <YAxis
            type="category"
            dataKey="label"
            width={52}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
          />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent labelFormatter={(label) => `Niveles ${String(label)}`} />}
          />
          <Bar dataKey="users" fill="var(--color-users)" radius={4} maxBarSize={22}>
            <LabelList
              dataKey="users"
              position="right"
              offset={8}
              className="fill-foreground font-mono"
              fontSize={11}
              formatter={(value: number) => (value > 0 ? formatNumber(value) : "")}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
      <figcaption className="sr-only">Personas por rango de nivel. {summary}.</figcaption>
    </figure>
  );
}
