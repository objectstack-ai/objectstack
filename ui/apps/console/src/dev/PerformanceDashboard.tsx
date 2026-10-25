/**
 * PerformanceDashboard
 *
 * Development-mode floating panel that surfaces Web Vitals, memory usage,
 * render counts, and performance budget violations. Toggle with Ctrl+Shift+P
 * or the ⚡ button in the bottom-right corner.
 *
 * Integrates with usePerformance and usePerformanceBudget from @object-ui/react.
 * @module
 */

import { useState, useEffect, useCallback } from 'react';
import { usePerformance, usePerformanceBudget } from '@object-ui/react';
import type { BudgetViolation } from '@object-ui/react';
import { X, Activity, ChevronDown, ChevronUp } from 'lucide-react';

// Only render in development mode
const IS_DEV = import.meta.env.DEV;

function MetricCard({ label, value, unit, budget, status }: {
  label: string;
  value: string | number | null;
  unit?: string;
  budget?: number;
  status?: 'good' | 'warn' | 'bad';
}) {
  const color = status === 'bad'
    ? 'text-red-500'
    : status === 'warn'
      ? 'text-yellow-500'
      : 'text-green-500';

  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className={`text-sm font-semibold tabular-nums ${color}`}>
          {value ?? '—'}
        </span>
        {unit && <span className="text-[10px] text-muted-foreground">{unit}</span>}
      </div>
      {budget != null && (
        <span className="text-[10px] text-muted-foreground">budget: {budget}{unit}</span>
      )}
    </div>
  );
}

function MemoryBar({ usedMB, budgetMB }: { usedMB: number | null; budgetMB: number }) {
  if (usedMB == null) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Memory</span>
        <span className="text-xs text-muted-foreground">Not available</span>
      </div>
    );
  }
  const pct = Math.min((usedMB / budgetMB) * 100, 100);
  const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Memory</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {usedMB.toFixed(1)} / {budgetMB} MB
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ViolationsList({ violations }: { violations: BudgetViolation[] }) {
  if (violations.length === 0) {
    return (
      <div className="text-xs text-green-500">✓ All metrics within budget</div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Budget Violations</span>
      <ul className="flex flex-col gap-0.5">
        {violations.map((v, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-red-500">
            <span className="font-medium">{v.metric}</span>
            <span className="text-muted-foreground">
              {v.actual} &gt; {v.budget}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PerformanceDashboard() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const perf = usePerformance();
  const budget = usePerformanceBudget({
    maxLCP: 600,
    maxFCP: 300,
    maxRenderTime: 16,
    maxMemoryMB: 128,
    warnOnViolation: false,
  });

  // Keyboard shortcut: Ctrl+Shift+P
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      setOpen(prev => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Don't render in production
  if (!IS_DEV) return null;

  // Floating toggle button when closed
  if (!open) {
    return (
      <button type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background shadow-lg hover:bg-muted transition-colors"
        title="Performance Dashboard (Ctrl+Shift+P)"
      >
        <Activity className="h-4 w-4 text-muted-foreground" />
      </button>
    );
  }

  const lcpStatus = perf.metrics.lcp == null ? undefined
    : perf.metrics.lcp <= 600 ? 'good' as const
    : perf.metrics.lcp <= 1200 ? 'warn' as const
    : 'bad' as const;

  const fcpStatus = perf.metrics.fcp == null ? undefined
    : perf.metrics.fcp <= 300 ? 'good' as const
    : perf.metrics.fcp <= 600 ? 'warn' as const
    : 'bad' as const;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">Performance Dashboard</span>
          {!budget.isWithinBudget && (
            <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-500">
              {budget.violations.length} violation{budget.violations.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button type="button"
            onClick={() => setCollapsed(prev => !prev)}
            className="rounded p-1 hover:bg-muted transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <button type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 hover:bg-muted transition-colors"
            title="Close (Ctrl+Shift+P)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {!collapsed && (
        <div className="flex flex-wrap items-start gap-4 px-4 py-3">
          {/* Web Vitals */}
          <div className="flex gap-2">
            <MetricCard label="LCP" value={perf.metrics.lcp} unit="ms" budget={600} status={lcpStatus} />
            <MetricCard label="FCP" value={perf.metrics.fcp} unit="ms" budget={300} status={fcpStatus} />
          </div>

          {/* Render metrics */}
          <div className="flex gap-2">
            <MetricCard label="Renders" value={perf.metrics.renderCount} />
            <MetricCard
              label="Last Render"
              value={perf.metrics.lastRenderDuration}
              unit="ms"
              status={
                perf.metrics.lastRenderDuration == null ? undefined
                  : perf.metrics.lastRenderDuration <= 16 ? 'good'
                  : perf.metrics.lastRenderDuration <= 32 ? 'warn'
                  : 'bad'
              }
            />
          </div>

          {/* Memory */}
          <div className="min-w-48">
            <MemoryBar usedMB={budget.snapshot.memoryMB} budgetMB={128} />
          </div>

          {/* Violations */}
          <div className="min-w-48">
            <ViolationsList violations={budget.violations} />
          </div>
        </div>
      )}
    </div>
  );
}
