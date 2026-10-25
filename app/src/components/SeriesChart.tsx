import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyPoint } from '../data/timeseries';
import type { MonthlyPoint } from '../data/history';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Custom axis tick. Recharts clones the element with `payload` (the tick
 * entry) plus `className`/`fill`, so the label is derived from the payload
 * and the forwarded props land on the underlying <text>.
 */
function AxisTick(props: {
  x?: number;
  y?: number;
  textAnchor?: 'start' | 'middle' | 'end';
  className?: string;
  fill?: string;
  index?: number;
  payload?: { value?: unknown };
  tickFormatter?: (value: unknown, index: number) => string;
}) {
  const { x, y, textAnchor = 'middle', className, fill, index, payload, tickFormatter } = props;
  const raw = payload?.value;
  const label = tickFormatter ? tickFormatter(raw, index ?? 0) : String(raw ?? '');
  return (
    <text
      className={className}
      fill={fill}
      x={x}
      y={y}
      dy={textAnchor === 'middle' ? 0 : textAnchor === 'end' ? 4 : 8}
      textAnchor={textAnchor}
      fontSize={10}
    >
      {label}
    </text>
  );
}

function formatDailyTick(date: string): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return `${MONTHS[month - 1]} ${day}`;
}

function formatMonthlyTick(key: string): string {
  // "2026-10" -> "Oct '26"
  const year = key.slice(0, 4);
  const month = Number(key.slice(5, 7));
  return `${MONTHS[month - 1]} ’${year.slice(2)}`;
}

function tooltipFormatter(value: unknown, name: unknown): [string, string] {
  const label = typeof name === 'string' ? name : String(name);
  if (typeof value !== 'number' || Number.isNaN(value)) return ['—', label];
  return [`${Math.round(value * 10) / 10} in`, label];
}

export interface SeriesChartProps {
  /** Chart title, e.g. "Tony Grove" or "Bear River basin". */
  title: string;
  /** Accessible summary, announced when the (focusable) chart is tabbed to. */
  label: string;
  /** Current-water-year daily points (SWE + daily precip). */
  points: DailyPoint[];
  /** Multi-year monthly points; shown when `historyMode` is 'multi'. */
  history: MonthlyPoint[] | null;
  /** Which series is displayed. */
  historyMode: 'wy' | 'multi';
  /** 'idle' | 'loading' | 'error' for the multi-year fetch. */
  historyState: 'idle' | 'loading' | 'error';
  /** Present when the station has a multi-year history to offer. */
  onToggleHistory?: () => void;
  /** Fixed pixel width (tests); omitted → ResponsiveContainer. */
  width?: number;
}

/**
 * SWE area + precipitation bars (docs/PLAN.md task 9).
 *
 * Two y-axes, both inches: SWE (left) is a cumulative quantity while
 * precip (right) is daily/monthly — the standard SNOTEL presentation.
 * The SVG is role="img" with a summary label; the detail table is the
 * keyboard-accessible data source, and Recharts tooltips answer touch.
 */
export function SeriesChart({
  title,
  label,
  points,
  history,
  historyMode,
  historyState,
  onToggleHistory,
  width,
}: SeriesChartProps) {
  const daily = historyMode === 'wy';
  const data = daily
    ? points
    : (history ?? []).map((p) => ({ date: p.key, swe: p.swe, precip: p.precip }));
  const empty = data.length === 0 || data.every((d) => d.swe === null && d.precip === null);

  // With an explicit `width` (unit tests under jsdom, where there is no
  // ResizeObserver) the chart gets fixed dimensions; otherwise it
  // responds to its container.
  //
  // role/aria-label go on the chart, not the <figure>: Recharts forwards
  // them to the surface <svg> (role="img" is allowed there, and Recharts 3
  // keeps the SVG keyboard-focusable, so the summary is a tab stop).
  const chart = (
    <ComposedChart
      data={data}
      width={width}
      height={220}
      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      role="img"
      aria-label={label}
    >
      <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="2 4" vertical={false} />
      <XAxis
        dataKey="date"
        tickFormatter={daily ? formatDailyTick : formatMonthlyTick}
        tick={<AxisTick />}
        stroke="var(--text-dim)"
        tickLine={false}
        axisLine={{ stroke: 'var(--chart-grid)' }}
        minTickGap={32}
      />
      <YAxis
        yAxisId="swe"
        tick={<AxisTick />}
        stroke="var(--text-dim)"
        tickLine={false}
        axisLine={false}
        width={30}
      />
      <YAxis
        yAxisId="precip"
        orientation="right"
        tick={<AxisTick />}
        stroke="var(--text-dim)"
        tickLine={false}
        axisLine={false}
        width={30}
      />
      <Tooltip
        formatter={tooltipFormatter}
        contentStyle={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          fontSize: 12,
        }}
        labelStyle={{ color: 'var(--text-dim)' }}
        labelFormatter={(l) => (daily ? formatDailyTick(String(l)) : formatMonthlyTick(String(l)))}
      />
      <Bar
        yAxisId="precip"
        dataKey="precip"
        name="Precip"
        fill="var(--chart-precip)"
        maxBarSize={14}
        isAnimationActive={false}
      />
      <Area
        yAxisId="swe"
        dataKey="swe"
        name="SWE"
        stroke="var(--chart-swe)"
        fill="var(--chart-swe-fill)"
        strokeWidth={2}
        dot={false}
        activeDot={{ r: 3 }}
        connectNulls
        isAnimationActive={false}
      />
    </ComposedChart>
  );

  return (
    <figure className="chart">
      <figcaption className="chart__header">
        <span className="chart__title">{title}</span>
        {onToggleHistory && (
          <button
            type="button"
            className="chart__toggle"
            aria-pressed={historyMode === 'multi'}
            disabled={historyState === 'loading'}
            onClick={onToggleHistory}
          >
            {historyMode === 'multi' ? 'This water year' : 'Multi-year'}
          </button>
        )}
      </figcaption>
      <div className="chart__body">
        {historyState === 'loading' ? (
          <p className="chart__status" role="status">
            Loading multi-year history…
          </p>
        ) : historyState === 'error' && historyMode === 'multi' ? (
          <p className="chart__status" role="alert">
            Couldn’t load multi-year history.
          </p>
        ) : empty ? (
          <p className="chart__status">No history yet.</p>
        ) : width ? (
          chart
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            {chart}
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}
