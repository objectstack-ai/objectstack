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
 * api is derived as every api is (`derive`), and its own `sudo()` marks again.
 *
 * ⛔ For the platform's own rows only, never for a write the automation itself
 * asked for: an action body's or a hook's insert into those objects, through
 * its `ctx.api` or its `ctx.api.sudo()`, keeps the provenance and is judged.
 * The engine enforces that line for the one api it knows is the automation's:
 * on an app-authored hook's api (its handler's `ctx.api`, and every api
 * derived from it) this answers exactly what that api's `sudo()` answers — the
 * `'hook'` mark when the context carries none, the mark it carries otherwise,
 * `flowRunId` kept — so a hook handing its own api here gains nothing.
 *
 * A symbol, and ⛔ not re-exported from either package entry, for the reason
 * `SEED_USER_GRANTS` gives (`hook-run-as.ts`): the method is no nameable member
 * of `ScopedContext`'s published face, reached only through
 * {@link platformSystemApi}. `Symbol.for` rather than a module-local
 * `Symbol()`, because the reader and the engine may be different copies of
 * this package — its ESM and CJS builds, or its two entries (`.` and
 * `./core`) served from different builds — and the key must be the same in
 * each, or the reader would silently fall back to `sudo()`.
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
