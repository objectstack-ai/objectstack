// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform's own system api, derived from the api a write's hook is
 * handed — for the rows a platform service writes to an object it owns
 * because that write happened.
 *
 * ## Why `sudo()` is not that api
 *
 * A hook's `ctx.api` runs the write's own context (`buildHookApi`), and its
 * `sudo()` spreads that context. So when the write is app-authored
 * automation's — an action body's, a hook's that runs as system, a flow
 * run's — the elevation `sudo()` makes carries the automation's provenance:
 * the app-automation elevation mark (`appAutomationElevationOf`,
 * `@objectstack/core`) or the run's `flowRunId`. That is deliberate: a write
 * the automation's own write sets off under the same context is judged as
 * the automation's (the mark's module header), and ⛔ `sudo()` never sheds it.
 *
 * The audit writer's `sys_audit_log` row and its `sys_activity` mirror are not
 * such a write. They are the platform's record that the write happened, made
 * by the service that owns both objects, and plugin-security judges an
 * automation's insert into an append-only object by exactly that provenance
 * (`isSystem` AND (`flowRunId` OR the mark),
 * `flow-system-identity-write-refusal.ts`). Written through `sudo()`, the
 * platform's own rows were judged as the automation's insert.
 *
 * ## What it derives
 *
 * The write's context, elevated as `sudo()` elevates it — every other key kept,
 * so the rows stay in the write's unit of work, its organization and its
 * attribution — without the app-automation mark and without `flowRunId`. The
 * api is derived as every api is (`derive`): not app-authored, so its own
 * `sudo()` adds no mark.
 *
 * ⛔ For the platform's own rows only, never for a write the automation itself
 * asked for: an action body's or a hook's insert into those objects, through
 * its `ctx.api` or its `ctx.api.sudo()`, keeps the provenance and is judged.
 * That line holds on two of the apis the automation is handed, and on every
 * api derived from either:
 *
 *  - an app-authored hook's api (its handler's `ctx.api`,
 *    `APP_AUTHORED_HOOK_API`): the engine enforces it, and this answers
 *    exactly what that api's `sudo()` answers — the `'hook'` mark when the
 *    context carries none, the mark it carries otherwise, `flowRunId` kept;
 *  - the api an action door hands its handler, a host code action handler's
 *    included (runtime's `buildActionApi`): runtime's layer over it carries
 *    the action door's own origin flag and answers this symbol member with
 *    the api's `sudo()`, so the `'action'` mark and any `flowRunId` stay. Not
 *    the engine's app-authored flag, which also refuses a permanent delete
 *    (ADR-0148 D3) that a host handler keeps.
 *
 * So a handler handing its own api here gains nothing, and its writes to the
 * identity-assignment objects are judged as its own. The api the audit writer
 * holds is neither: `buildHookApi` builds a fresh `ScopedContext` over the
 * write's context, carrying the `'action'` mark when an action's write fired
 * the hook, and this takes it off there. Neither line is a security boundary:
 * a host handler's package registered through the engine it holds, whose
 * `createContext({ isSystem: true })` already builds a system api with neither
 * the mark nor the run. They keep the documented answer for the api a handler
 * was handed. And what this returns over runtime's wrapped `ctx.api` stays
 * wrapped: runtime's `deriveThroughSeam` (the stored-metadata read seam and
 * the landed-write answer) walks this symbol member as it walks `sudo()`.
 *
 * A symbol, and ⛔ not re-exported from either package entry, for the reason
 * `SEED_USER_GRANTS` gives (`hook-run-as.ts`): the method is no nameable member
 * of `ScopedContext`'s published face, reached only through
 * {@link platformSystemApi}. `Symbol.for` rather than a module-local
 * `Symbol()`, because the reader and the engine may be different copies of
 * this package — its ESM and CJS builds, or its two entries (`.` and
 * `./core`) served from different builds — and the key must be the same in
 * each, or the reader would silently fall back to `sudo()`; and runtime names
 * it too (`deriveThroughSeam`), which no export can serve.
 */

import type { ScopedContext } from './engine.js';

/** The key the engine's `ScopedContext` derives the platform's own system api under. */
export const PLATFORM_SYSTEM_API: unique symbol = Symbol.for('objectstack.objectql.platformSystemApi');

interface PlatformSystemDerivableApi {
  [PLATFORM_SYSTEM_API](): ScopedContext;
}

/**
 * The platform's own system api over `api`'s context (see the module header),
 * or `undefined` for an api this engine did not build — which has no context
 * to derive from, and keeps its own `sudo()`.
 */
export function platformSystemApi(api: unknown): ScopedContext | undefined {
  const derivable = api as Partial<PlatformSystemDerivableApi> | null | undefined;
  if (!derivable || typeof derivable[PLATFORM_SYSTEM_API] !== 'function') return undefined;
  return derivable[PLATFORM_SYSTEM_API]();
}
