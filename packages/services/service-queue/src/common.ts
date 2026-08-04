// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Narrow ObjectQL engine surface used by job/queue adapters.
 * Keeps the adapter testable without booting a real kernel.
 *
 * IMPORTANT: matches the canonical engine API:
 *   - find: `where:` (NOT `filter:`)
 *   - update: `(table, {id, ...patch}, opts)`
 */
export interface JobEngine {
  find(object: string, options?: any): Promise<any[]>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, idOrData: any, dataOrOptions?: any, options?: any): Promise<any>;
  delete(object: string, options?: any): Promise<any>;
}

/** Stamped only in tests to make `now` deterministic. */
export interface JobClock { now(): Date }

export interface JobLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error?(msg: string, meta?: unknown): void;
}

export const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

export function uid(prefix: string): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(clock?: JobClock): string {
  return (clock?.now() ?? new Date()).toISOString();
}

/**
 * Milliseconds per ADR-0057 lifecycle duration unit. Mirrors
 * `parseLifecycleDuration` in `@objectstack/objectql` (the canonical runtime
 * consumer), reproduced here rather than imported because the queue adapters
 * deliberately do not depend on the engine package — they duck-type
 * {@link JobEngine} so they stay testable without booting a kernel. Both
 * tables are fixed by the ADR (coarse operational bounds: `y` is 365 days),
 * and `job-queue-retention.test.ts` pins this one against them.
 */
const LIFECYCLE_UNIT_MS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  y: 365 * 86_400_000,
};

/**
 * Parse an ADR-0057 duration literal (`'6h'`, `'7d'`, `'12w'`, `'7y'`) into
 * milliseconds. Throws on anything else: declarations reach this code already
 * validated by `LifecycleSchema`, so a failure here is a broken declaration,
 * not user input — and a queue that silently guessed a window would be exactly
 * the silent behaviour #5179 is about.
 */
export function lifecycleDurationMs(literal: string): number {
  const m = /^(\d+)(h|d|w|y)$/.exec(literal);
  if (!m) {
    throw new Error(
      `[service-queue] invalid lifecycle duration literal '${literal}' — expected <n><unit> with unit h|d|w|y (e.g. '7d')`,
    );
  }
  return Number(m[1]) * LIFECYCLE_UNIT_MS[m[2]!]!;
}

export function parseJson<T = unknown>(raw: unknown, fallback?: T): T | undefined {
  if (raw == null) return fallback;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  if (typeof raw === 'object') return raw as T;
  return fallback;
}
