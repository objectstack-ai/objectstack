// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import type { CounterStore } from '@objectstack/plugin-auth/rate-limit-storage';
import { readServiceSelfInfo } from '@objectstack/spec/api';

/**
 * ADR-0069 D2 — resolve the kernel `cache` service for the `notify` node's
 * per-address email-field send limit, through the accessors a `PluginContext`
 * really carries.
 *
 * The rule: when a `cache` service is registered — as a value or as a factory —
 * the counter counts in it; only when none is registered does it fall back to
 * the bounded per-process store `createLazyCounterStore` keeps.
 *
 * "None registered" includes the kernel's OWN stand-in: an `ObjectKernel` with
 * no cache plugin injects an in-memory `cache` that self-describes as
 * `degraded` (ADR-0076 D12, `readServiceSelfInfo`). Counting in it buys nothing
 * the per-process fallback does not — it is just as process-local — and the
 * fallback is the store bounded for counters. So a `degraded` cache answers
 * `undefined`, the counter keeps the bounded fallback, and the one-shot warning
 * that there is no shared cache stays true.
 *
 * - `ObjectKernel`: `ctx.getKernel().getServiceAsync('cache')`. It is the one
 *   accessor that answers a value registration AND a factory registration; the
 *   synchronous `ctx.getService` throws `is async - use await` for a factory
 *   that has not been built yet. The context itself has no `getServiceAsync`
 *   member, so an optional call on it answers `undefined` on every host.
 * - A `KernelBase`-shaped host (`LiteKernel`) has no `getServiceAsync` and no
 *   service factories at all, so `ctx.getService('cache')` is complete there.
 *
 * Any failure — not registered, not buildable right now — answers `undefined`:
 * "no shared cache right now", asked again at the next count
 * (`createLazyCounterStore`'s contract). A value without `get`/`set` is not a
 * counter store and answers `undefined` too.
 *
 * A package-local copy of `@objectstack/plugin-auth`'s internal
 * `kernel-cache.ts` (same rule, same code), kept local so that package's
 * published `./rate-limit-storage` entry does not widen. Not re-exported from
 * this package.
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
