// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * JobPreview — read-only summary of a Background Job draft.
 *
 * Canonical shape (see `packages/spec/src/system/job.zod.ts`):
 *   schedule: { type: 'cron',     expression: string | { dialect:'cron', source:string }, timezone? }
 *           | { type: 'interval', intervalMs: number }
 *           | { type: 'once',     at: string (ISO) }
 *   handler: string         — function key registered in defineStack({ functions })
 *   retryPolicy?: { maxRetries, backoffMs, backoffMultiplier }
 *   timeout?: number (ms)
 *   enabled?: boolean
 *
 * Legacy / app-supplied flat shapes are also tolerated:
 *   • `cron` (string)        — top-level cron expression
 *   • `every` / `interval`   — interval like "5m" or millis number
 *   • `at` / `runAs`         — one-shot ISO
 *   • `timezone` / `tz`
 *   • `active` / `enabled`
 *
 * For cron schedules we compute the **next 5 fire times** locally so
 * operators can sanity-check the schedule without waiting for the
 * runtime. The cron parser handles standard 5-field cron with `*`,
 * `*\/N`, comma lists, and ranges (`a-b`). Special tokens like
 * `@daily` / `@hourly` are also expanded.
 */

import * as React from 'react';
import { useDisplayLocale } from '@object-ui/i18n';
import {
  AlarmClock,
  Calendar,
  Clock,
  Code2,
  Globe2,
  PlayCircle,
  Power,
  RotateCcw,
  Timer,
} from 'lucide-react';
import { EmptyDescription } from '@object-ui/components';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { t as tr, tFormat } from '../i18n.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';

const CRON_ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

interface CronField {
  values: Set<number>;
  step?: number;
  any: boolean;
}

function parseCronField(raw: string, min: number, max: number): CronField | null {
  const out: CronField = { values: new Set(), any: false };
  if (raw === '*') {
    for (let i = min; i <= max; i++) out.values.add(i);
    out.any = true;
    return out;
  }
  for (const part of raw.split(',')) {
    let stepStr: string | undefined;
    let body = part;
    if (part.includes('/')) {
      const [b, s] = part.split('/');
      body = b;
      stepStr = s;
    }
    const step = stepStr ? Math.max(1, parseInt(stepStr, 10) || 1) : 1;
    let lo = min;
    let hi = max;
    if (body !== '*') {
      if (body.includes('-')) {
        const [a, b] = body.split('-').map((n) => parseInt(n, 10));
        if (Number.isNaN(a) || Number.isNaN(b)) return null;
        lo = a;
        hi = b;
      } else {
        const v = parseInt(body, 10);
        if (Number.isNaN(v)) return null;
        lo = v;
        hi = v;
      }
    }
    for (let i = lo; i <= hi; i += step) {
      if (i >= min && i <= max) out.values.add(i);
    }
  }
  return out;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
}

function parseCron(expr: string): ParsedCron | null {
  const aliased = CRON_ALIASES[expr.trim()] ?? expr.trim();
  const parts = aliased.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return null;
  // Strip optional 6th seconds field — we ignore second-resolution for preview.
  const fields = parts.length === 6 ? parts.slice(1) : parts;
  const [m, h, dom, mon, dow] = fields;
  const minute = parseCronField(m, 0, 59);
  const hour = parseCronField(h, 0, 23);
  const domF = parseCronField(dom, 1, 31);
  const month = parseCronField(mon, 1, 12);
  const dowF = parseCronField(dow === '7' ? '0' : dow, 0, 6);
  if (!minute || !hour || !domF || !month || !dowF) return null;
  return { minute, hour, dom: domF, month, dow: dowF };
}

function nextCronFires(expr: string, from: Date, count: number): Date[] {
  const cron = parseCron(expr);
  if (!cron) return [];
  const results: Date[] = [];
  // Walk minute by minute up to ~366 days; bail early once we hit count.
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limitMs = 366 * 24 * 60 * 60 * 1000;
  const endAt = from.getTime() + limitMs;
  while (results.length < count && cursor.getTime() <= endAt) {
    if (
      cron.minute.values.has(cursor.getMinutes()) &&
      cron.hour.values.has(cursor.getHours()) &&
      cron.month.values.has(cursor.getMonth() + 1) &&
      // POSIX cron OR semantics: when both DOM and DOW are restricted,
      // a match in EITHER triggers; when one is `*`, the other governs.
      (cron.dom.any || cron.dow.any
        ? cron.dom.values.has(cursor.getDate()) && cron.dow.values.has(cursor.getDay())
        : cron.dom.values.has(cursor.getDate()) || cron.dow.values.has(cursor.getDay()))
    ) {
      results.push(new Date(cursor.getTime()));
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return results;
}

function parseInterval(every: string): number | null {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(every.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
    default:
      return null;
  }
}

function nextIntervalFires(intervalMs: number, from: Date, count: number): Date[] {
  const out: Date[] = [];
  for (let i = 1; i <= count; i++) out.push(new Date(from.getTime() + i * intervalMs));
  return out;
}

/** In the session's display locale — it passed an explicit `undefined`, the MACHINE's locale (objectui#9909). */
function formatWhen(d: Date, locale: string): string {
  return d.toLocaleString(locale, {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Normalize the canonical Schedule discriminated-union and legacy flat
 * shapes into `{ cron?, every?, at?, timezone? }` for rendering.
 *
 * Supports:
 *   • d.schedule = { type:'cron',     expression: string | {source}, timezone? }
 *   • d.schedule = { type:'interval', intervalMs: number }
 *   • d.schedule = { type:'once',     at: string }
 *   • d.schedule = "0 9 * * 1-5"     (legacy: string cron)
 *   • d.cron / d.every / d.interval / d.at / d.runAt / d.timezone / d.tz
 */
function normalizeSchedule(d: Record<string, unknown>): {
  cron?: string;
  every?: string;
  at?: string;
  timezone?: string;
} {
  // Canonical discriminated-union schedule object.
  if (d.schedule && typeof d.schedule === 'object') {
    const s = d.schedule as Record<string, unknown>;
    const t = String(s.type ?? '');
    const tz = (s.timezone as string | undefined) ?? (d.timezone as string | undefined) ?? (d.tz as string | undefined);
    if (t === 'cron') {
      const expr = s.expression;
      const src =
        typeof expr === 'string'
          ? expr
          : expr && typeof expr === 'object' && typeof (expr as any).source === 'string'
            ? (expr as any).source
            : undefined;
      return { cron: src, timezone: tz };
    }
    if (t === 'interval') {
      const ms = Number(s.intervalMs);
      return { every: Number.isFinite(ms) && ms > 0 ? humanizeMs(ms) : undefined, timezone: tz };
    }
    if (t === 'once') {
      return { at: typeof s.at === 'string' ? s.at : undefined, timezone: tz };
    }
  }

  // Flat legacy shapes.
  const cron =
    typeof d.cron === 'string'
      ? d.cron
      : typeof d.schedule === 'string'
        ? d.schedule
        : undefined;
  const everyRaw = d.every ?? d.interval;
  const every =
    typeof everyRaw === 'string'
      ? everyRaw
      : typeof everyRaw === 'number'
        ? humanizeMs(everyRaw)
        : undefined;
  const at = typeof d.at === 'string' ? d.at : typeof d.runAt === 'string' ? d.runAt : undefined;
  const timezone = (d.timezone as string | undefined) ?? (d.tz as string | undefined);
  return { cron, every, at, timezone };
}

function humanizeMs(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

export function JobPreview({ name, draft, locale }: MetadataPreviewProps) {
  const displayLocale = useDisplayLocale();
  const d = draft as Record<string, unknown>;
  const jobName = String(d.name ?? name ?? '');
  const label = String(d.label ?? jobName);
  const description = (d.description as string | undefined) ?? '';

  const { cron, every, at, timezone } = normalizeSchedule(d);

  const handler = (d.handler as string | undefined)
    ?? (d.target as string | undefined)
    ?? (d.function as string | undefined)
    ?? (d.functionName as string | undefined);
  const active = d.active !== false && d.enabled !== false;
  // Canonical: retryPolicy.{maxRetries,backoffMs,backoffMultiplier}; legacy: flat fields.
  const retryPolicy = d.retryPolicy as Record<string, unknown> | undefined;
  const maxRetries =
    (retryPolicy?.maxRetries as number | undefined)
    ?? (d.maxRetries as number | undefined)
    ?? (d.retries as number | undefined);
  const backoffMs = retryPolicy?.backoffMs as number | undefined;
  const timeoutMs = (d.timeout as number | undefined) ?? (d.timeoutMs as number | undefined);
  const concurrency = (d.concurrency as number | undefined);

  const intervalMs = every ? parseInterval(every) : null;
  const { nextFires, deltas } = React.useMemo(() => {
    const now = new Date();
    let fires: Date[] = [];
    if (cron) fires = nextCronFires(cron, now, 5);
    else if (intervalMs) fires = nextIntervalFires(intervalMs, now, 5);
    else if (at) {
      const t = Date.parse(at);
      if (!Number.isNaN(t)) fires = [new Date(t)];
    }
    return {
      nextFires: fires,
      deltas: fires.map((f) => humanDelta(f.getTime() - now.getTime())),
    };
  }, [cron, intervalMs, at]);

  const scheduleInvalid = (cron && nextFires.length === 0) || (every && !intervalMs);

  if (!jobName && !cron && !every && !at && !handler) {
    return (
      <PreviewShell hint="job">
        <PreviewMessage>{tr('engine.jobPreview.empty', locale)}</PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell hint="job">
      <PreviewErrorBoundary>
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="rounded border bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <AlarmClock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium truncate">{label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{jobName}</span>
                </div>
                {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <Pill
                    icon={Power}
                    label={tr(active ? 'engine.jobPreview.active' : 'engine.jobPreview.paused', locale)}
                    tone={active ? 'green' : 'gray'}
                  />
                  {timezone && <Pill icon={Globe2} label={timezone} mono />}
                  {maxRetries != null && (
                    <Pill
                      icon={RotateCcw}
                      label={
                        backoffMs
                          ? tFormat('engine.jobPreview.retriesBackoff', locale, {
                              count: String(maxRetries),
                              backoff: humanizeMs(backoffMs),
                            })
                          : tFormat('engine.jobPreview.retries', locale, { count: String(maxRetries) })
                      }
                    />
                  )}
                  {timeoutMs != null && (
                    <Pill icon={Timer} label={tFormat('engine.jobPreview.timeout', locale, { duration: humanizeMs(timeoutMs) })} />
                  )}
                  {concurrency != null && (
                    <Pill label={tFormat('engine.jobPreview.concurrency', locale, { count: String(concurrency) })} />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Schedule */}
          <Section title={tr('engine.jobPreview.schedule', locale)} icon={Calendar}>
            <div className="rounded border bg-background p-2.5 text-xs space-y-1">
              {/* "Cron" is the name of the syntax, the same in every locale. */}
              {cron && (
                <ScheduleLine label="Cron">
                  <code className="font-mono">{cron}</code>
                </ScheduleLine>
              )}
              {every && (
                <ScheduleLine label={tr('engine.jobPreview.every', locale)}>
                  <code className="font-mono">{every}</code>
                  {!intervalMs && <span className="ml-2 text-amber-700">{tr('engine.jobPreview.unparseable', locale)}</span>}
                </ScheduleLine>
              )}
              {at && (
                <ScheduleLine label={tr('engine.jobPreview.at', locale)}>
                  <code className="font-mono">{at}</code>
                </ScheduleLine>
              )}
              {!cron && !every && !at && (
                <EmptyDescription className="text-xs italic">{tr('engine.jobPreview.noSchedule', locale)}</EmptyDescription>
              )}
            </div>
          </Section>

          {/* Next 5 fires */}
          {(cron || intervalMs || at) && (
            <Section
              title={tFormat(
                nextFires.length === 1 ? 'engine.jobPreview.nextRunOne' : 'engine.jobPreview.nextRunOther',
                locale,
                { count: Math.max(nextFires.length, 1) },
              )}
              icon={Clock}
            >
              {nextFires.length === 0 ? (
                <div className="text-xs text-amber-700">
                  {tr(scheduleInvalid ? 'engine.jobPreview.noFireTime' : 'engine.jobPreview.noUpcoming', locale)}
                </div>
              ) : (
                <ul className="rounded border bg-background divide-y text-xs">
                  {nextFires.map((d, i) => (
                    <li key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                      <span className="w-4 text-right text-muted-foreground text-[10px]">{i + 1}</span>
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono">{formatWhen(d, displayLocale)}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {deltas[i] == null
                          ? tr('engine.jobPreview.inNow', locale)
                          : tFormat('engine.jobPreview.inDelta', locale, { delta: deltas[i] as string })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {/* Handler */}
          <Section title={tr('engine.jobPreview.handler', locale)} icon={Code2}>
            {handler ? (
              <div className="rounded border bg-background px-2.5 py-1.5 text-xs flex items-center gap-2">
                <PlayCircle className="h-3.5 w-3.5 text-muted-foreground" />
                <code className="font-mono break-all">{handler}</code>
              </div>
            ) : (
              <div className="text-xs text-amber-700">{tr('engine.jobPreview.noHandler', locale)}</div>
            )}
          </Section>
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

/**
 * The time until a fire, in the compact duration notation the schedule itself
 * is written in (`45s`, `5m`, `2h`, `3d`). `null` when the fire time is not in
 * the future, which the caller words in the designer locale
 * (`engine.jobPreview.inNow`, objectui#10862).
 */
function humanDelta(ms: number): string | null {
  if (ms <= 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  const days = Math.round(h / 24);
  return `${days}d`;
}

function ScheduleLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground w-12 shrink-0">{label}:</span>
      <span className="break-all">{children}</span>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {Icon && <Icon className="h-3 w-3" />}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Pill({
  icon: Icon,
  label,
  tone = 'gray',
  mono = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: 'gray' | 'green';
  mono?: boolean;
}) {
  const cls = tone === 'green' ? 'text-emerald-700' : 'text-foreground';
  return (
    <span className="inline-flex items-center gap-1">
      {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
      <span className={`${cls} ${mono ? 'font-mono' : ''}`}>{label}</span>
    </span>
  );
}
