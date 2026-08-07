// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which driver arms actually READ `datasource.pool` — and the loud rejection
 * for the ones that do not (#5714).
 *
 * ## The failure this exists for
 *
 * `datasource.pool` is declared, strict, documented, and honoured by exactly
 * the arms that build a pooled client: `postgres` / `mysql` hand
 * `buildSqlPool(spec)` to `SqlDriver`, and `mongo` maps `min`/`max` onto the
 * MongoClient's `minPoolSize`/`maxPoolSize`. The `sqlite` and `sqlite-wasm`
 * arms never received it at all — `resolveSqliteDriver` has no pool option and
 * `SqliteWasmDriver` does not take one — so a datasource that sized its pool
 * got the driver's own single connection and no indication whatsoever.
 * Measured on `origin/main` before this module existed:
 *
 * ```text
 * sqlite   + pool{min:3,max:9}   knex.client.config.pool = {"createTimeoutMillis":15000}   live {min:1,max:1}
 * postgres + pool{min:3,max:9}   knex config.pool = {"min":3,"max":9}                      live {min:3,max:9}
 * ```
 *
 * `examples/app-crm` was the live specimen: `CrmDatasource` declared
 * `pool: { min: 1, max: 5 }` and ran on `{min:1,max:1}`.
 *
 * ## Why rejection rather than wiring it up
 *
 * Wiring the block through to knex would be wrong, not merely more work: knex's
 * better-sqlite3 dialect pins `{min:1,max:1}` **on purpose**, because every
 * pool acquire runs `new Database(filename)` and two connections to `:memory:`
 * are two SEPARATE, mutually invisible databases. Honouring `max: 5` there
 * would silently split one datasource's data across five stores. Sizing a
 * SQLite pool is not a knob the platform can offer, so the honest answer to a
 * declaration it cannot serve is to reject it — Prime Directive #12: fix the
 * metadata at the producer and reject it at authoring/publish, never tolerate
 * it in the consumer. Maintainer ruling on #5714 (2026-08-06), option B.
 *
 * ## Where the boundary is, deliberately
 *
 * - A driver id the platform ships no contract for (`com.vendor.snowflake`) is
 *   NOT judged. Same line the `datasource.config` gate draws: "we validate what
 *   we can construct" — a plugin driver may well pool, and rejecting a key
 *   against a shape we do not have would be worse than the silence it replaces.
 * - `memory` is a built-in that does not read `pool` either, and it is
 *   deliberately NOT in the rejected set: the #5714 ruling authorised this
 *   authoring-surface tightening for the two sqlite arms, and widening it is a
 *   contract decision for triage rather than for this module. Filed as #5931 so
 *   the hole is known rather than overlooked.
 */

import { resolveDriverId } from '@objectstack/spec/data';

/**
 * Canonical driver ids whose connection strategy is decided by the driver, so a
 * declared `datasource.pool` can never reach anything.
 *
 * Both are SQLite: `sqlite` (better-sqlite3, via `resolveSqliteDriver`) and
 * `sqlite-wasm` (`SqliteWasmDriver`). Neither takes a pool option, and neither
 * could honour one — see the module note on `:memory:`.
 */
export const POOL_UNSUPPORTED_DRIVER_IDS = ['sqlite', 'sqlite-wasm'] as const;

export type PoolUnsupportedDriverId = (typeof POOL_UNSUPPORTED_DRIVER_IDS)[number];

/**
 * Does this driver id read a declared `datasource.pool`?
 *
 * `true` for the pooled built-ins (`postgres` / `mysql` / `mongo`) **and** for
 * every id outside the built-in table — an unknown id is not ours to judge, so
 * it is left alone rather than rejected against a contract we do not ship.
 */
export function driverReadsDeclaredPool(driver: unknown): boolean {
  const id = resolveDriverId(driver);
  if (!id) return true;
  return !(POOL_UNSUPPORTED_DRIVER_IDS as readonly string[]).includes(id);
}

/**
 * Is there a `pool` block here at all? An absent block — and an empty one,
 * which declares nothing and therefore loses nothing — is not a declaration.
 */
function isPoolDeclared(pool: unknown): boolean {
  return (
    typeof pool === 'object' && pool !== null && Object.keys(pool as Record<string, unknown>).length > 0
  );
}

/**
 * The rejection text for a `pool` block on a driver that cannot honour it.
 *
 * It is a FIX instruction, deliberately: it names the one edit that resolves it
 * (delete the block) and says where the key stays meaningful. It offers no
 * escape hatch and does not suggest changing the driver — an authoring mistake
 * has a correction, not a bypass.
 */
export function unsupportedPoolMessage(driver: string, datasourceName?: string): string {
  const subject = datasourceName ? `Datasource '${datasourceName}'` : 'This datasource';
  return (
    `${subject} declares a \`pool\` block, but the '${driver}' driver does not read it: a SQLite ` +
    `connection strategy is owned by the driver, not by the datasource — one connection per ` +
    `database, because a second connection to \`:memory:\` opens a SEPARATE, empty database. ` +
    `Sizing it here would therefore split one datasource's data across several stores, so the ` +
    `block is rejected instead of dropped. Remove \`pool\` from this datasource declaration; it ` +
    `stays meaningful on the pooled drivers (postgres / mysql / mongo).`
  );
}

/**
 * The rejection for one datasource declaration, or `undefined` when there is
 * nothing to reject. Never throws — callers that want the throw use
 * {@link assertDatasourcePoolSupported}.
 */
export function unsupportedPoolIssue(input: {
  driver: string;
  pool?: unknown;
  name?: string;
}): string | undefined {
  if (!isPoolDeclared(input.pool)) return undefined;
  if (driverReadsDeclaredPool(input.driver)) return undefined;
  return unsupportedPoolMessage(input.driver, input.name);
}

/**
 * Throw when a datasource declares a `pool` its driver cannot honour.
 *
 * Called at every door a `pool` block can come in through — the Setup wizard's
 * create/update, the boot-time auto-connect pre-pass, and the driver factory
 * itself — so the declaration is rejected before anything is built, rather than
 * dropped after.
 */
export function assertDatasourcePoolSupported(input: {
  driver: string;
  pool?: unknown;
  name?: string;
}): void {
  const issue = unsupportedPoolIssue(input);
  if (issue) throw new Error(issue);
}
