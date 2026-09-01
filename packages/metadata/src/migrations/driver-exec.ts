// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How the migrations in this directory obtain a raw-SQL entry point.
 *
 * Every helper here used to guard on — and drive through — `driver.raw(sql,
 * bindings?)`. **No data driver in this repo defines `raw`.** Measured on
 * `origin/main`, the only `raw(` member anywhere outside a test double is
 * `packages/verify/src/harness.ts`, an HTTP harness whose signature is
 * `(path, init)`. `SqlDriver` keeps its knex handle `protected`, so
 * `driver.raw` is `undefined` there too, and `SqliteWasmDriver` inherits that.
 * The result was a published, operator-documented migration path that refused
 * every driver the platform ships — quietly, because
 * `migrateSysNotificationToEvent` *returns* `{ status: 'error' }` rather than
 * throwing, and the message blamed the operator's driver instead of saying the
 * migration did not run.
 *
 * ## Why `execute` is tried FIRST
 *
 * `IDataDriver` (`@objectstack/spec/contracts`, `data-driver.ts`) declares
 *
 * ```ts
 * execute(command: unknown, parameters?: unknown[], options?: DriverOptions): Promise<unknown>;
 * ```
 *
 * — **non-optional**, with bound parameters as the second POSITIONAL argument,
 * which is the exact shape `raw(sql, bindings?)` was being called in. `raw` has
 * never appeared on that interface. So `execute` is not merely the surface the
 * shipped drivers happen to have; it is the only raw-execution surface the
 * contract guarantees at all, and a driver that satisfies `IDataDriver` always
 * has it. Trying it first is therefore the order that matches the declaration.
 *
 * ⚠️ `IDataEngine.execute?(command, options?)` (`data-engine.ts`) is a DIFFERENT
 * member on a different interface — its second parameter is an options bag, not
 * bindings. These helpers take an `IDataDriver`, so `data-driver.ts` governs.
 * Do not reason about this call from the engine declaration.
 *
 * ## Prior art, and why the order had to be chosen rather than copied
 *
 * `packages/metadata-protocol/src/migrations/` already resolves both surfaces
 * instead of assuming one — twice, and **in opposite orders**:
 * `partial-index-probe.ts` tries `raw` first, `seed-tenancy-backfill.ts` tries
 * `execute` first. `metadata-protocol/src/protocol.ts` (`ensureOverlayIndex`)
 * is a third, raw-first. One operation with three implementations and two
 * behaviours resolves to the declaration-bound side, so this directory adopts
 * `execute`-first uniformly across all four of its members.
 *
 * `raw` is kept as a fallback rather than dropped: nothing in this repo defines
 * it, but a host or a third-party driver may, and removing a surface that
 * currently works is not what this repair is for. The refusal below therefore
 * fires only for a driver that has NEITHER.
 *
 * ## Known limitation, deliberately not papered over here
 *
 * Two shipped drivers satisfy `typeof driver.execute === 'function'` without
 * being able to run SQL: `MemoryDriver.execute` logs a warning and returns
 * `null` for every command, and `MongoDbDriver.execute` returns a string
 * command back verbatim. Both are selected by the probe below and then answer
 * every column probe with "absent", so a migration reports `not_applicable` /
 * `table_missing` instead of refusing. `IDataDriver` exposes no capability flag
 * that would separate "implements the escape hatch" from "can run SQL"
 * (`DriverCapabilities` has no such member), so distinguishing them is a
 * contract question, not something to guess at with a driver-name sniff.
 * Filed separately.
 */

import type { IDataDriver } from '@objectstack/spec/contracts';

/**
 * A raw-SQL entry point resolved off a driver. `bindings` are passed
 * positionally, matching `IDataDriver.execute`'s declared `parameters`.
 */
export type DriverExec = (sql: string, bindings?: readonly unknown[]) => Promise<any>;

/**
 * Resolve the raw-SQL entry point of `driver`, or `undefined` when it offers
 * neither surface.
 *
 * Callers that must refuse should pair this with {@link driverExecRefusal} so
 * every member of this directory states the same remedy.
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

/**
 * The single refusal sentence used by every migration in this directory, for a
 * driver that offers neither surface.
 *
 * Assembled in one place because the wording carries pinned properties: the
 * remedy is stated exactly ONCE (a guard here once concatenated its instruction
 * twice), the two sentences stay separated rather than running together, and a
 * conforming driver is named so the operator has something to act on.
 */
export function driverExecRefusal(helper: string): string {
    return (
        `${helper}: driver must expose an .execute(sql, bindings?) or .raw(sql, bindings?) method. ` +
        'SqlDriver (better-sqlite3/knex) exposes .execute(), as does its SqliteWasmDriver subclass; ' +
        'cloud-side TursoDriver also conforms.'
    );
}
