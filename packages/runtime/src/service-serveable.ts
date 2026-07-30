// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ONE predicate for "may the dispatcher call the thing in this service slot
 * like a real implementation?" — ADR-0076 D12 conclusion 3, applied across the
 * service domains (#4058).
 *
 * D12's third conclusion binds *consumers*: only `handlerReady: true` counts as
 * a real capability. Discovery honoured that from #3028 on; the dispatcher — a
 * consumer too — gated every domain on mere slot occupancy, so anything
 * registered under a canonical name got called and its fabricated results went
 * back as a 200. #4000 enforced the rule for `analytics` alone
 * (`isAnalyticsServiceServeable`, since folded into this module) because the
 * class-wide adoption needed a per-domain decision; #4058 made it and this is
 * where the answer lives.
 *
 * `handlerReady` (not `status`) is the test, and that distinction is what makes
 * the rule safe to apply everywhere: an implementation that self-declares
 * `degraded` genuinely serves requests — `handlerReady` defaults to `true` for
 * it — and keeps serving. Only a self-confessed non-handler (`handlerReady:
 * false`, which is the default for `status: 'stub'`) is answered as if the slot
 * were empty. A working in-memory fallback is therefore NOT collateral damage:
 * it is `degraded`, and it stays on the wire.
 *
 * Read by the service domains, the route-mount gate, and discovery's
 * `routes`/`features` — one predicate, so what is advertised and what is served
 * cannot disagree.
 */

import { readServiceSelfInfo } from '@objectstack/spec/api';

/**
 * True when `svc` occupies its slot AND does not self-declare as a non-handler.
 *
 * An empty slot and a slot filled by a self-declared stub are the same amount
 * of capability, so callers answer both the same way — whatever their empty-slot
 * exit already is (`handled: false` → 404, or an explicit 501).
 *
 * [#4127] A type guard, not a `boolean`. Every domain already calls this as its
 * first act on a resolved slot, so once `getService` returns
 * `Contract | undefined` this one predicate narrows away the `undefined` for the
 * whole handler body — the null check and the capability check are the same
 * check, and were always meant to be. Written as `svc is NonNullable<T>` so the
 * caller keeps its own contract type instead of being widened to a shared one.
 */
export function isServiceServeable<T>(svc: T): svc is NonNullable<T> {
    if (!svc) return false;
    return readServiceSelfInfo(svc)?.handlerReady !== false;
}
