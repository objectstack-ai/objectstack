// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `uniqueId` — the designer's one id minter, in a module with no React in it.
 *
 * It lives here rather than in `_shared.tsx` (which still re-exports it, so
 * every existing `from './_shared'` import is untouched) because the id
 * convention is needed by PURE reconciliation modules too — `flow-decision-edges`
 * mints edge ids on commit (objectui#3202). Importing it from `_shared.tsx`
 * would drag React, lucide, and the whole `@object-ui/components` barrel into
 * those modules' node-environment unit tests: measured at 7.4s of module load
 * versus 63ms, for a helper that is fifteen lines of string arithmetic.
 *
 * One minter, not two: a second local id generator is how two paths end up
 * disagreeing about what a fresh id looks like.
 */

/**
 * Generate a snake_case id that doesn't collide with `existing`. Used
 * by Add helpers that need a stable identifier (Flow nodes, Flow edges, App
 * nav, Dashboard widgets) before the user fills in a meaningful name.
 *
 *   uniqueId('node', ['node_1', 'node_3']) -> 'node_2'
 *
 * `existing` tolerates holes (`undefined` / `null`) so callers can pass a raw
 * `items.map((i) => i.id)` without pre-filtering.
 */
export function uniqueId(prefix: string, existing: ReadonlyArray<string | undefined | null>): string {
  const taken = new Set(existing.filter((x): x is string => typeof x === 'string'));
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${prefix}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${prefix}_${Date.now()}`;
}
