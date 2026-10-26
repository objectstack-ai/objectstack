/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0057 #8 — the proactive AI usage indicator for the ChatDock header.
 *
 * ONE small gauge for the environment's ONE AI quota pool (objectui#8524,
 * following the cloud single-pool ruling), so the user sees remaining AI headroom
 * BEFORE a send hits the 429 wall, instead of only learning the limit reactively.
 * Data comes from {@link useAiUsage} (the cloud `GET /api/v1/ai/usage` endpoint),
 * which speaks D5-SAFE fractions — this component NEVER renders a token number,
 * only the gauge, qualitative words and, in the popover, the pool's used share as
 * ONE percentage.
 *
 * objectui#11658 — the popover shows that one figure and nothing else. The pool's
 * split (`breakdown`: app-building vs data Q&A) is no longer drawn: since the
 * single composer, a data question asked of the build agent counts as building,
 * so the split read「AI 搭建 19% · 数据问询 0%」after a data question — it cannot
 * attribute a composer turn honestly. `useAiUsage` still reads `breakdown`
 * strictly off the wire; nothing renders it.
 *
 * Near-full (≥ {@link NEAR_FULL}) the ring turns amber and, on click, the popover
 * shows "running low — resets tonight/next cycle" plus the SAME upgrade / top-up CTA
 * the 429 error banner uses ({@link cloudConsoleUrl}). When usage is unknown
 * (endpoint absent on an older backend, OSS, no seat) or the pool is unmetered, the
 * whole indicator renders nothing — a missing endpoint degrades to no widget, never
 * a broken one.
 *
 * objectui#11799 — and with AI off it asks nothing. AI is on for this viewer when
 * the access-filtered agent catalog at the same base (`GET {apiBase}/agents`)
 * lists an agent: the signal `useAiSurfaceEnabled` gates every AI entry point
 * on, whose header says why it is not discovery's `services.ai`. An open-edition
 * server answers that catalog with its empty-list courtesy and every other
 * `/ai/*` route with 501, so the Studio dock — drawn while the catalog loads —
 * used to log a 501 for the usage read on every mount.
 */
import * as React from 'react';
import { cn, Button, Popover, PopoverTrigger, PopoverContent } from '@object-ui/components';
import { formatNumber, useObjectTranslation } from '@object-ui/i18n';
import { useAgents } from '@object-ui/plugin-chatbot/core';
import { useAiUsage, type AiMeterUsage } from '../hooks/useAiUsage.js';
import { cloudConsoleUrl } from '../console/marketplace/marketplaceApi.js';

/** Fraction at/above which the pool is "running low" (amber + CTA). */
export const NEAR_FULL = 0.8;

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

type Tone = 'ok' | 'low' | 'full';

function toneFor(fraction: number): Tone {
  if (fraction >= 1) return 'full';
  if (fraction >= NEAR_FULL) return 'low';
  return 'ok';
}

function ringColorClass(tone: Tone): string {
  if (tone === 'full') return 'text-destructive';
  if (tone === 'low') return 'text-amber-500';
  return 'text-primary';
}

function statusColorClass(tone: Tone): string {
  if (tone === 'full') return 'text-destructive';
  if (tone === 'low') return 'text-amber-600 dark:text-amber-500';
  return 'text-muted-foreground';
}

/**
 * The pool gauge: a full, solid outline (the track) around a pie wedge that
 * fills clockwise from 12 o'clock with the used share. Presentational only
 * (aria-hidden) — the button labels it.
 *
 * objectui#11658 — it used to be a stroked arc over a faint 25%-opacity track,
 * which at low usage is a short arc in the header: the exact silhouette of a
 * loading spinner, read as「还在加载」in every acceptance screenshot. A pie
 * inside a closed outline reads as a quantity at any fraction — an empty circle
 * at 0, a sliver at 5%, a full disc at the cap — and never as a spinner, since
 * a spinner is an OPEN arc. Both parts take the tone colour (`currentColor`),
 * so the track is as visible as the fill.
 */
function MeterGauge({ fraction, tone, size = 16 }: { fraction: number; tone: Tone; size?: number }) {
  const center = size / 2;
  const outline = 1.5;
  const trackR = (size - outline) / 2;
  // The wedge is drawn as a circle whose stroke is as wide as its own diameter:
  // a dash of `pct` of its circumference paints a pie sector of radius `pieR`,
  // inset from the track by a gap the width of the outline.
  const pieR = trackR - outline;
  const r = pieR / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, fraction));
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={ringColorClass(tone)}
      aria-hidden="true"
      focusable="false"
      data-gauge="pie"
    >
      <circle
        cx={center}
        cy={center}
        r={trackR}
        fill="none"
        stroke="currentColor"
        strokeWidth={outline}
        data-gauge-part="track"
      />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={pieR}
        strokeDasharray={`${circumference * pct} ${circumference}`}
        transform={`rotate(-90 ${center} ${center})`}
        data-gauge-part="fill"
      />
    </svg>
  );
}

export interface AiUsageIndicatorProps {
  /** Resolved AI service base (e.g. `/api/v1/ai`). Falsy → the hook stays inert. */
  apiBase?: string;
  /** Gate rendering (e.g. no AI seat). Default true. */
  enabled?: boolean;
  className?: string;
}

/**
 * The ChatDock-header usage indicator. Renders nothing until the pool has a
 * numeric fraction to show (fail-soft — see file header).
 */
export function AiUsageIndicator({ apiBase, enabled = true, className }: AiUsageIndicatorProps) {
  const { t, language } = useObjectTranslation();
  // objectui#11799 — no usage read until the catalog lists an agent (see the
  // file header). The catalog read is shared with the dock's own: `useAgents`
  // keeps one request per base in flight and its answer for a short while.
  const { agents } = useAgents({ apiBase, enabled });
  const { usage } = useAiUsage({ apiBase, enabled: enabled && agents.length > 0 });

  // "Now", read OUTSIDE render (react-hooks/purity forbids `Date.now()` in the
  // render body — it is non-deterministic and the compiler assumes render can
  // re-run any number of times). `null` until the mount effect measures it —
  // the render body itself never calls `Date.now()`, only reads this state —
  // then refreshed periodically so a long-open popover's "N days/hours" stays
  // roughly current; the countdown is day/hour-grained, so a minute of drift
  // is invisible.
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!enabled || !usage) return null;
  // Unknown (null) and unmetered (usage-based) pools have nothing to ring.
  const { pool } = usage;
  if (pool.unmetered || pool.fraction === null) return null;
  const fraction = pool.fraction;
  const tone = toneFor(fraction);
  const usedPercent = formatNumber(fraction, { locale: language, style: 'percent', maximumFractionDigits: 0 });

  const statusLabel = (level: Tone): string => {
    if (level === 'full') return t('console.ai.usage.statusFull', { defaultValue: 'Limit reached' });
    if (level === 'low') return t('console.ai.usage.statusLow', { defaultValue: 'Running low' });
    return t('console.ai.usage.statusOk', { defaultValue: 'Plenty left' });
  };

  // "N hours" until the reset, rounded UP and never below 1: a reset under an
  // hour away reads "1 hour", never "0 hours", and the line never promises a
  // reset earlier than the real one. The `resetsWeeklyHours` copy names no
  // window ("Resets in N hours" in every locale pack), so the weekly arm's
  // final day and the whole 5-hour window share it.
  const hoursResetLabel = (diffMs: number): string => {
    const hours = Math.max(1, Math.ceil(diffMs / ONE_HOUR_MS));
    return t('console.ai.usage.resetsWeeklyHours', { count: hours, defaultValue: 'Resets in {{count}} hours' });
  };

  // The rolling windows (`weekly`: 7 days, cloud PR #1852; `fiveHour`: the
  // 5-hour pace, cloud#2059) count down from `resetsAt` and the `now` state
  // above — PURE given those two inputs, no clock read here. Contract-first
  // (objectui#7371) — `resetsAt` is the ONE source of the reset instant;
  // never re-derive or guess it client-side.
  const weeklyResetLabel = (resetsAt: string, nowMs: number): string => {
    const diffMs = new Date(resetsAt).getTime() - nowMs;
    if (diffMs <= ONE_DAY_MS) return hoursResetLabel(diffMs);
    const days = Math.ceil(diffMs / ONE_DAY_MS);
    return t('console.ai.usage.resetsWeeklyDays', { count: days, defaultValue: 'Resets in {{count}} days' });
  };
  const fiveHourResetLabel = (resetsAt: string, nowMs: number): string =>
    hoursResetLabel(new Date(resetsAt).getTime() - nowMs);

  // `null` = render nothing for this line — an unrecognized `resetKind` (a
  // future backend value this build doesn't know yet) fails soft instead of
  // crashing or showing stale/wrong copy, a rolling-window pool with no
  // `resetsAt` yet (nothing counted) is never guessed at (objectui#7371), and
  // `now` not yet measured (the one frame before the mount effect above runs)
  // is the same "nothing to show yet" as any other missing input.
  const resetLabel = (meter: AiMeterUsage): string | null => {
    if (meter.resetKind === 'daily') return t('console.ai.usage.resetsDaily', { defaultValue: 'Resets tonight' });
    if (meter.resetKind === 'monthly')
      return t('console.ai.usage.resetsMonthly', { defaultValue: 'Resets next cycle' });
    if (meter.resetKind === 'weekly')
      return meter.resetsAt && now !== null ? weeklyResetLabel(meter.resetsAt, now) : null;
    if (meter.resetKind === 'fiveHour')
      return meter.resetsAt && now !== null ? fiveHourResetLabel(meter.resetsAt, now) : null;
    return null;
  };

  // No upstream cloud named by the runtime ⇒ no control plane to send anyone
  // to, so no CTA (objectui#7253).
  const showCta = tone !== 'ok' && (pool.upgrade || pool.topUp) && !!cloudConsoleUrl();
  const reset = resetLabel(pool);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid="ai-usage-indicator"
          className={cn('h-7 gap-1.5 px-1.5 text-muted-foreground hover:text-foreground', className)}
          aria-label={t('console.ai.usage.ariaLabel', {
            defaultValue: 'AI usage: {{status}}',
            status: statusLabel(tone),
          })}
        >
          <MeterGauge fraction={fraction} tone={tone} />
          {tone !== 'ok' ? (
            <span className={cn('hidden text-xs font-medium sm:inline', statusColorClass(tone))}>
              {statusLabel(tone)}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" data-testid="ai-usage-popover">
        <div className="mb-2 text-xs font-semibold text-foreground/80">
          {t('console.ai.usage.title', { defaultValue: 'AI usage' })}
        </div>
        <div className="flex items-start gap-2.5">
          <MeterGauge fraction={fraction} tone={tone} size={22} />
          <div className="min-w-0 flex-1">
            <div className={cn('text-sm font-medium', statusColorClass(tone))}>{statusLabel(tone)}</div>
            <div className="text-xs tabular-nums text-foreground" data-testid="ai-usage-pool-used">
              {t('console.ai.usage.poolUsed', { percent: usedPercent, defaultValue: '{{percent}} used' })}
            </div>
            {reset ? <div className="text-xs text-muted-foreground">{reset}</div> : null}
            {showCta ? (
              <Button
                variant="link"
                size="sm"
                className="mt-1 h-auto p-0 text-xs"
                data-testid="ai-usage-cta"
                onClick={() => window.open(cloudConsoleUrl(), '_blank', 'noopener,noreferrer')}
              >
                {pool.upgrade
                  ? t('console.ai.usage.ctaUpgrade', { defaultValue: 'Upgrade to keep going' })
                  : t('console.ai.usage.ctaTopUp', { defaultValue: 'Add credits to continue' })}
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
