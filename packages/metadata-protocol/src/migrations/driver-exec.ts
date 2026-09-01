// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How this package obtains a raw-SQL entry point from a driver — one
 * definition, because it used to be three and they did not agree.
 *
 * ## The divergence this module closes
 *
 * Three sites in `@objectstack/metadata-protocol` resolved a raw-SQL seam off a
 * driver, in TWO different orders:
 *
 * | site                                  | order              |
 * |:--------------------------------------|:-------------------|
 * | `migrations/partial-index-probe.ts`   | `raw`, then `execute` |
 * | `migrations/seed-tenancy-backfill.ts` | `execute`, then `raw` |
 * | `protocol.ts` (`ensureOverlayIndex`)  | `raw`, then `execute` |
 *
 * On the drivers this repo ships the two orders pick the same surface, so the
 * split produced no measurable difference (see "Why this was not urgent"
 * below). It still had to be closed: a host or third-party driver defining BOTH
 * surfaces would have been driven through `raw` at two of those sites and
 * `execute` at the third — the same operation taking two different paths in one
 * process — and the dead limb read as the preferred one to anybody maintaining
 * the raw-first sites.
 *
 * ## Why `execute` is tried FIRST
 *
 * `IDataDriver` (`@objectstack/spec/contracts`, `data-driver.ts`) declares
 *
 * ```ts
 * execute(command: unknown, parameters?: unknown[], options?: DriverOptions): Promise<unknown>;
 * ```
 *
 * — **non-optional**. `raw` has never appeared on that interface at all. So
 * `execute` is not merely the surface the shipped drivers happen to have; it is
 * the only raw-execution surface the contract guarantees, and any driver
 * satisfying `IDataDriver` has it. Trying it first is the order that matches the
 * declaration.
 *
 * This is the 2026-08-07 meta-criterion — one operation, several
 * implementations, inconsistent behaviour, decide by the declaration-bound side
 * — applied a second time. The first application is the precedent this module
 * follows: `packages/metadata/src/migrations/driver-exec.ts`, which converted
 * `@objectstack/metadata`'s migrations to `execute`-first for exactly this
 * reason. ⚠️ That module and this one are TWINS and must stay in step; its
 * header carries the longer argument, including the `raw(sql, bindings?)` call
 * shape that made `execute`'s positional `parameters` the matching surface.
 *
 * `execute`-first also happens to be the order `seed-tenancy-backfill.ts`
 * already argued for on independent grounds: `execute(sql, params)` carries
 * bound parameters and `raw(sql)`, as this package was calling it, did not.
 *
 * ⚠️ `IDataEngine.execute?(command, options?)` (`data-engine.ts`) is a DIFFERENT
 * member on a different interface — its second parameter is an options bag, not
 * bindings. These helpers resolve an `IDataDriver`, so `data-driver.ts` governs.
 * Do not reason about this call from the engine declaration.
 *
 * ## Why `raw` is KEPT
 *
 * Nothing in this repo defines `raw` on a data driver, but a host or a
 * third-party driver may, and removing a surface that currently works is not
 * what this alignment is for. The fallback stays; only the ORDER changed.
 * Callers that must refuse should treat `undefined` as "neither surface".
 *
 * ## Why this is a twin rather than an import
 *
 * `@objectstack/metadata` is already a declared dependency of this package, and
 * `resolveDriverExec` could have been imported instead of restated. It is not,
 * for two reasons:
 *
 *  - `driver-exec.ts` is INTERNAL to `metadata`'s migrations directory — it is
 *    not re-exported from `@objectstack/metadata/migrations`. Importing it would
 *    mean widening that package's published surface to serve three call sites in
 *    a sibling package.
 *  - The only subpath that could carry it is the `./migrations` barrel, and
 *    `ensureOverlayIndex` — one of the three callers — runs on EVERY boot.
 *    Pulling a migrations barrel onto the boot path to save ten lines is the
 *    wrong trade.
 *
 * ⚠️ The comment in `protocol.ts` that used to justify keeping this logic local
 * cited a circular dependency ("metadata already depends on objectql"). That
 * reason is STALE and was not the one acted on here: `@objectstack/metadata`
 * does not depend on `@objectstack/objectql`; `objectql` depends on both. The
 * two bullets above are the live reasons.
 *
 * ## Known limitation, deliberately not papered over here
 *
 * `typeof driver.execute === 'function'` separates "declares the surface" from
 * "does not declare it" — it does NOT separate either from "can actually run
 * SQL". Two shipped drivers satisfy the non-optional `execute` declaration and
 * then execute nothing: `InMemoryDriver.execute` logs and returns `null` for
 * every command, and `MongoDBDriver.execute` hands the command back. Both are
 * selected by the resolver below and then answer every probe with "absent", so a
 * migration reports "not applicable" instead of refusing. `IDataDriver` exposes
 * no capability flag that would tell the two apart (`DriverCapabilities` has no
 * such member), so distinguishing them is a contract question rather than
 * something to guess at with a driver-name sniff. Filed separately and tracked
 * on the capability-declaration surface; this module inherits the limitation and
 * does not add to it. Nothing below should be read as an endorsement of the
 * probe — only as agreement about its ORDER.
 *
 * ## Why this was not urgent
 *
 * Measured on the tree this module landed on: no data driver in this repo
 * defines `raw`. `InMemoryDriver`, `MongoDBDriver` and `SqlDriver` each declare
 * `execute` and none declares `raw`; `SqliteWasmDriver` and `TursoDriver` extend
 * `SqlDriver` and inherit the same. The only `raw(` members anywhere are two
 * test doubles and `packages/verify/src/harness.ts`, an HTTP harness whose
 * signature is `(path, init)` and which is not a data driver. So on every
 * shipped driver the `raw` limb is unreachable and the flip changes no observed
 * behaviour today — which is precisely why it was safe to do before a
 * third-party driver made it a live defect.
 */

import type { IDataDriver } from '@objectstack/spec/contracts';

/**
 * A raw-SQL entry point resolved off a driver. `bindings` are passed
 * positionally, matching `IDataDriver.execute`'s declared `parameters`.
 */
export type DriverExec = (sql: string, bindings?: readonly unknown[]) => Promise<any>;

/**
 * Whether `driver` offers either raw-SQL surface.
 *
 * Exactly `resolveDriverExec(driver) !== undefined`, and defined in terms of it
 * so the predicate and the resolution can never disagree about which drivers
 * count — the three call sites previously spelled this test three times, once
 * per site, alongside three copies of the resolution.
 */
export function driverCanRunSql(driver: unknown): boolean {
    return resolveDriverExec(driver as IDataDriver | null | undefined) !== undefined;
}

/**
 * Resolve the raw-SQL entry point of `driver`, or `undefined` when it offers
 * neither surface.
 *
 * Order: declared surface (`execute`) first, `raw` as the fallback — see the
 * header for why, and do not flip it back without reading that argument.
 */
export function resolveDriverExec(driver: IDataDriver | null | undefined): DriverExec | undefined {
    const candidate = driver as any;
    if (!candidate) return undefined;
    // Declared surface first — see the header.
    if (typeof candidate.execute === 'function') {
        return (sql, bindings) => candidate.execute(sql, bindings ? [...bindings] : []);
    }
    if (typeof candidate.raw === 'function') {
        return (sql, bindings) => candidate.raw(sql, bindings ? [...bindings] : []);
    }
    return undefined;
}
