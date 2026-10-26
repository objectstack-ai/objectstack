/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0057 #8 — the console AI usage indicator's data hook.
 *
 * Fetches `GET {apiBase}/usage` (the cloud runtime's read-only companion to the
 * token guardrail) and exposes the headroom of the environment's ONE AI quota
 * pool, which the ChatDock header renders as a single ring (objectui#8524). The
 * endpoint speaks a D5-SAFE shape — FRACTIONS of the pool's cap, never a raw
 * token count — so nothing here (or downstream) can leak a token number.
 *
 * Wire shape: `{ pool, breakdown }`. `pool` is the one reading that gates;
 * `breakdown` is an observation-only split of that same pool into app-building
 * vs data Q&A (cloud ADR-0015). The reader is strict: it reads this shape and no
 * other — the retired per-meter `{ meters: { build, dataChat } }` answer parses
 * to `null` — so the next wire change is a failed parse, not a silent second
 * dialect. `breakdown` is optional upstream (cloud#2133 lets the endpoint keep
 * it, it does not require it), so its ABSENCE is a normal reading and never a
 * parse failure.
 *
 * Refetch triggers, cheap and event-driven (no busy polling):
 *   - on mount / apiBase change,
 *   - on the `AI_USAGE_REFRESH_EVENT` the chat engine fires after a turn finishes
 *     or a send is rejected (429) — so the ring moves right after the user's action,
 *   - on tab re-focus (catches usage spent in another tab).
 *
 * Fail-soft: any error (endpoint absent on an old backend, network, non-2xx, an
 * answer that is not the shape above) leaves `usage` null and sets `error`. The
 * indicator treats null as "nothing to show" and renders nothing, so a
 * missing/!deployed endpoint degrades to no widget rather than a broken one.
 */
import * as React from 'react';
import { AI_USAGE_REFRESH_EVENT } from '@object-ui/plugin-chatbot/core';

/**
 * The binding window. `weekly` and `fiveHour` are the cloud quota policy's two
 * rolling windows (cloud#2059: the 7-day budget and the 5-hour pace).
 * `daily` / `monthly` are what control planes before cloud#2574 still emit, so
 * they stay until every deployed control plane has stopped emitting them.
 */
export type AiUsageResetKind = 'daily' | 'weekly' | 'monthly' | 'fiveHour';
export type AiUsagePlanType = 'free' | 'paid';

/**
 * The D5-safe usage signal of the environment's ONE AI quota pool — the reading
 * that blocks (mirrors the cloud endpoint's `pool`).
 */
export interface AiMeterUsage {
  planType: AiUsagePlanType;
  /** 0..1 of the binding window's cap, or null when unmetered / unknown. Never tokens. */
  fraction: number | null;
  /** No finite cap (usage-based) — the UI would draw spend, not a ring. */
  unmetered: boolean;
  resetKind: AiUsageResetKind;
  /**
   * Best-effort reset instant (ISO); null when unknown. Weekly (the rolling
   * 7-day window, cloud PR #1852) and fiveHour (the rolling 5-hour pace
   * window, cloud#2059): null while nothing is counted in that window yet —
   * never guessed client-side (objectui#7371). Monthly: null, the
   * billing-cycle anchor is not known at this layer.
   */
  resetsAt: string | null;
  /** Free-tier upgrade CTA applies. */
  upgrade: boolean;
  /** Paid credit-pack top-up CTA applies (monthly window only). */
  topUp: boolean;
}

/**
 * Where the ONE pool went: each member is a fraction (0..1) of the SAME cap
 * `pool.fraction` is measured against, so the two add up to the pool's reading.
 * OBSERVATION ONLY — neither member is a budget and nothing gates on it. `null`
 * when the pool is unmetered, usage is unknown, or the split was not measured.
 */
export interface AiUsageBreakdown {
  build: number | null;
  dataChat: number | null;
}

export interface AiUsageResponse {
  /** The one metered pool — this is what blocks. */
  pool: AiMeterUsage;
  /** Read-only split of the same pool. Absent when the runtime does not report it. */
  breakdown?: AiUsageBreakdown;
}

export interface UseAiUsageOptions {
  /** Resolved AI service base (e.g. `/api/v1/ai`). Falsy → the hook is inert. */
  apiBase?: string;
  /** Gate the whole hook (e.g. no AI seat). Default true. */
  enabled?: boolean;
}

export interface UseAiUsageReturn {
  usage: AiUsageResponse | null;
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

function isFractionOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v));
}

/**
 * Every field the pool declares, checked by primitive type. `resetKind` and
 * `planType` are checked as strings, not against their unions: a reset kind this
 * build does not know yet is rendered without a reset line (objectui#7371), not
 * treated as an unreadable answer.
 */
function isPool(v: unknown): v is AiMeterUsage {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.planType === 'string' &&
    isFractionOrNull(p.fraction) &&
    typeof p.unmetered === 'boolean' &&
    typeof p.resetKind === 'string' &&
    (p.resetsAt === null || typeof p.resetsAt === 'string') &&
    typeof p.upgrade === 'boolean' &&
    typeof p.topUp === 'boolean'
  );
}

function isBreakdown(v: unknown): v is AiUsageBreakdown {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return isFractionOrNull(b.build) && isFractionOrNull(b.dataChat);
}

/**
 * Read the wire payload as `{ pool, breakdown? }` — and only as that. `null`
 * means the answer is not this shape (see the file header for why no second
 * shape is read).
 */
function parseUsage(payload: unknown): AiUsageResponse | null {
  if (!payload || typeof payload !== 'object') return null;
  const { pool, breakdown } = payload as { pool?: unknown; breakdown?: unknown };
  if (!isPool(pool)) return null;
  // Absent `breakdown` is a normal reading (optional upstream, cloud#2133), never
  // a parse failure: the pool alone is everything the ring needs.
  if (breakdown === undefined) return { pool };
  if (!isBreakdown(breakdown)) return null;
  return { pool, breakdown: { build: breakdown.build, dataChat: breakdown.dataChat } };
}

/**
 * Load the environment's AI usage headroom for the console indicator. See the file
 * header for the refetch triggers and fail-soft contract.
 */
export function useAiUsage(options: UseAiUsageOptions = {}): UseAiUsageReturn {
  const { apiBase, enabled = true } = options;
  const [usage, setUsage] = React.useState<AiUsageResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<Error | undefined>(undefined);
  const [reloadToken, setReloadToken] = React.useState(0);

  const refetch = React.useCallback(() => setReloadToken((n) => n + 1), []);

  const active = enabled && !!apiBase;

  React.useEffect(() => {
    if (!active) {
      setUsage(null);
      setError(undefined);
      setLoading(false);
      return;
    }
    if (typeof fetch !== 'function') return; // non-browser env → stay inert (fail-soft)
    let cancelled = false;
    const url = `${apiBase!.replace(/\/$/, '')}/usage`;
    setLoading(true);
    fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load AI usage (${res.status})`);
        return res.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const parsed = parseUsage(payload);
        setUsage(parsed);
        setError(parsed ? undefined : new Error('Unrecognized AI usage response shape'));
      })
      .catch((err) => {
        if (cancelled) return;
        // Fail-soft: keep no data; the indicator hides itself on null usage.
        setUsage(null);
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, apiBase, reloadToken]);

  // Refetch on the chat engine's post-turn / 429 nudge, and on tab re-focus.
  React.useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const onRefresh = () => refetch();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    window.addEventListener(AI_USAGE_REFRESH_EVENT, onRefresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(AI_USAGE_REFRESH_EVENT, onRefresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, refetch]);

  return { usage, loading, error, refetch };
}
