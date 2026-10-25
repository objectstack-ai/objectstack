/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export interface ChartImplProps {
  data?: Array<Record<string, any>>;
  dataKey?: string;
  xAxisKey?: string;
  height?: number;
  className?: string;
  color?: string;
}

/** Truncate a long axis label, keeping the full text available on hover. */
function truncate(s: string, max = 14): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Angled, truncated X-axis tick — used when categories are many or wide so the
 * labels don't overlap on a narrow widget. A `<title>` exposes the full label
 * on hover when truncated.
 */
function AngledTick({ x, y, payload }: any) {
  const raw = String(payload?.value ?? '');
  const label = truncate(raw);
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        dy={10}
        textAnchor="end"
        transform="rotate(-32)"
        fill="hsl(var(--muted-foreground))"
        fontSize={11}
        fontFamily="monospace"
      >
        {raw !== label && <title>{raw}</title>}
        {label}
      </text>
    </g>
  );
}

/**
 * ChartImpl - The heavy implementation that imports Recharts
 * This component is lazy-loaded to avoid including Recharts in the initial bundle
 */
export default function ChartImpl({
  data = [],
  dataKey = 'value',
  xAxisKey = 'name',
  height = 400,
  className = '',
  // Default to standard primary color
  color = 'hsl(var(--primary))',
}: ChartImplProps) {
  // Angle + truncate the category labels when they would crowd a narrow widget:
  // many categories, or any label long enough to collide with its neighbour.
  const labels = data.map((d) => String(d?.[xAxisKey] ?? ''));
  const needAngle = labels.length > 4 || labels.some((l) => l.length > 8);
  return (
    <div className={`p-2 sm:p-3 md:p-4 rounded-xl border border-border bg-card/40 backdrop-blur-sm shadow-lg shadow-background/5 ${className}`}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: needAngle ? 24 : 5 }}>
          <defs>
            <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={1} />
              <stop offset="90%" stopColor={color} stopOpacity={0.6} />
              <stop offset="100%" stopColor={color} stopOpacity={0.3} />
            </linearGradient>
            <filter id="glow" height="130%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
              <feOffset in="blur" dx="0" dy="0" result="offsetBlur" />
              <feFlood floodColor={color} floodOpacity="0.5" result="offsetColor" />
              <feComposite in="offsetColor" in2="offsetBlur" operator="in" result="offsetBlur" />
              <feMerge>
                <feMergeNode in="offsetBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey={xAxisKey}
            tick={needAngle ? <AngledTick /> : { fill: 'hsl(var(--muted-foreground))', fontSize: 12, fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            // Always render every category tick. The old non-angled branch used
            // `preserveStartEnd`, which keeps ONLY the first + last label — so a
            // short 3–4 category chart lost its middle labels entirely (AI-built
            // "count by status" dashboards showed 4 bars but only 2 axis labels,
            // leaving the middle bars unlabelled). Non-angled means ≤4 short
            // categories — horizontal space is ample — and the angled branch
            // already prevents overlap on crowded axes, so `0` is safe for both.
            interval={0}
            height={needAngle ? 56 : undefined}
            dy={needAngle ? undefined : 10}
          />
          <YAxis 
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12, fontFamily: 'monospace' }} 
            tickLine={false}
            axisLine={false}
          />
          <Tooltip 
            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
            contentStyle={{ 
              backgroundColor: 'hsl(var(--popover))', 
              borderColor: 'hsl(var(--border))', 
              color: 'hsl(var(--popover-foreground))',
              borderRadius: '8px',
              fontFamily: 'monospace',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
            }}
            itemStyle={{ color: 'hsl(var(--primary))' }}
          />
          <Legend wrapperStyle={{ paddingTop: '20px', fontFamily: 'monospace' }} />
          <Bar 
            dataKey={dataKey} 
            fill="url(#barGradient)" 
            radius={[4, 4, 0, 0]}
            filter="url(#glow)"
            animationDuration={1500}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
