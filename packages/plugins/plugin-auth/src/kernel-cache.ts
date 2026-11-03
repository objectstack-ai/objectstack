// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { readServiceSelfInfo } from '@objectstack/spec/api';

import type { CounterStore } from './rate-limit-storage.js';

/**
 * ADR-0069 D2 — resolve the kernel `cache` service for this package's
 * cross-node counters (better-auth's rate limits, the per-number OTP send
 * budget, the signed-out invitation preview), through the accessors a
 * `PluginContext` really carries.
 *
 * The rule: when a `cache` service is registered — as a value or as a factory —
 * the counters count in it; only when none is registered do they fall back to
 * the per-process store.
 *
 * "None registered" includes the kernel's OWN stand-in: an `ObjectKernel` with
 * no cache plugin injects an in-memory `cache` that self-describes as
 * `degraded` (ADR-0076 D12, `readServiceSelfInfo`). Counting in it buys nothing
 * the per-process fallback does not — it is just as process-local — and the
 * fallback is the store this package bounds for these counters
 * (`InProcessCounterStore` prunes expired keys and caps how many it holds). So
 * a `degraded` cache answers `undefined`, the counters keep the bounded
 * fallback, and the one-shot warning that there is no shared cache stays true.
 *
 * - `ObjectKernel`: `ctx.getKernel().getServiceAsync('cache')`. It is the one
 *   accessor that answers a value registration AND a factory registration; the
 *   synchronous `ctx.getService` throws `is async - use await` for a factory
 *   that has not been built yet. The context itself has no `getServiceAsync`
 *   member, so an optional call on it answers `undefined` on every host — the
 *   counters would never reach a registered cache.
 * - A `KernelBase`-shaped host (`LiteKernel`) has no `getServiceAsync` and no
 *   service factories at all, so `ctx.getService('cache')` is complete there.
 *
 * Any failure — not registered, not buildable right now — answers `undefined`:
 * "no shared cache right now", asked again at the next count
 * (`createLazyCounterStore`'s contract). A value without `get`/`set` is not a
 * counter store and answers `undefined` too.
 *
 * Internal to `@objectstack/plugin-auth`: not re-exported from the package root.
 */
export async function resolveKernelCache(
  ctx: Pick<PluginContext, 'getKernel' | 'getService'>,
): Promise<CounterStore | undefined> {
  let cache: unknown;
  try {
    const kernel = (typeof ctx.getKernel === 'function' ? ctx.getKernel() : undefined) as
      | { getServiceAsync?: (name: string) => Promise<unknown> }
      | undefined;
    cache =
      kernel && typeof kernel.getServiceAsync === 'function'
        ? await kernel.getServiceAsync('cache')
        : ctx.getService<unknown>('cache');
  } catch {
    return undefined;
  }
  if (!cache || typeof (cache as CounterStore).get !== 'function' || typeof (cache as CounterStore).set !== 'function') {
    return undefined;
  }
  if (readServiceSelfInfo(cache)?.status === 'degraded') return undefined;
  return cache as CounterStore;
}
