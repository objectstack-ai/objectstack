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
 * ## The `memory` arm joined the set (#5931)
 *
 * `memory` was left OUT of the rejected set when this module was written, with
 * a pin deliberately kept green to say so: the #5714 ruling had authorised the
 * tightening for the two sqlite arms only, and widening a public authoring
 * surface is a contract decision. Triage answered it (maintainer ruling
 * 2026-08-07): `memory` joins the set, with its own explanation rather than
 * SQLite's. The hole named here is closed — this is no longer a known,
 * deliberately-drawn boundary.
 *
 * That ruling also set the default for the next sister arm (#6140): when a
 * declared key is silently dropped on one arm and an earlier ruling already
 * made it a loud authoring error on a sibling, the new arm **joins the existing
 * rejection set** rather than queueing for a ruling of its own — unless the
 * original rationale was measured to be arm-specific. SQLite's rationale is
 * not: it is about `:memory:` splitting one datasource across several stores,
 * while `memory`'s is that there is no connection to pool at all. Different
 * reasons, same verdict — hence one set, one message per arm.
 *
 * ## Where the boundary is, deliberately
 *
 * A driver id the platform ships no contract for (`com.vendor.snowflake`) is
 * NOT judged. Same line the `datasource.config` gate draws: "we validate what
 * we can construct" — a plugin driver may well pool, and rejecting a key
 * against a shape we do not have would be worse than the silence it replaces.
 */

import { resolveDriverId } from '@objectstack/spec/data';

/**
 * Canonical driver ids that cannot honour a declared `datasource.pool`, so the
 * block can never reach anything.
 *
 * Three built-ins, for two different reasons. The SQLite pair — `sqlite`
 * (better-sqlite3, via `resolveSqliteDriver`) and `sqlite-wasm`
 * (`SqliteWasmDriver`) — take no pool option and could not honour one, see the
 * module note on `:memory:`. `memory` (`InMemoryDriver`) is more absolute
 * still: it opens no connection at all, so there is nothing a pool could size.
 * Each carries its own explanation in {@link POOL_UNSUPPORTED_REASONS} — an id
 * cannot join this list without one, because that record is keyed by this type.
 */
export const POOL_UNSUPPORTED_DRIVER_IDS = ['memory', 'sqlite', 'sqlite-wasm'] as const;

export type PoolUnsupportedDriverId = (typeof POOL_UNSUPPORTED_DRIVER_IDS)[number];

/**
 * Does this driver id read a declared `datasource.pool`?
 *
 * `true` for the pooled built-ins (`postgres` / `mysql` / `mongodb`) **and** for
 * every id outside the built-in table — an unknown id is not ours to judge, so
 * it is left alone rather than rejected against a contract we do not ship.
 *
 * `turso` answers `true` as well, and did so before #6345 made it a builtin
 * (then via the unknown-id branch, now via "not in the rejected set") — so this
 * function's verdict for it is unchanged. Whether that verdict is RIGHT is a
 * separate, pre-existing question this card deliberately does not answer:
 * `TursoDriverConfig` has no `min`/`max`, only `concurrency`, and in local mode
 * the driver is a better-sqlite3 `SqlDriver` — the very engine
 * {@link POOL_UNSUPPORTED_DRIVER_IDS} rejects a `pool` block for. A declared
 * `pool` on a turso datasource is therefore dropped in silence today. Changing
 * that is a new rejection on an authoring surface and needs its own ruling; see
 * the #6345 PR's follow-ups.
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
 * The two SQLite arms are two engines for one storage model, so they share one
 * explanation rather than paraphrasing it twice. Unchanged since #5714 — this
 * is the exact text those arms have always thrown.
 */
const SQLITE_POOL_REASON =
  `a SQLite connection strategy is owned by the driver, not by the datasource — one connection ` +
  `per database, because a second connection to \`:memory:\` opens a SEPARATE, empty database. ` +
  `Sizing it here would therefore split one datasource's data across several stores, so the ` +
  `block is rejected instead of dropped.`;

/**
 * WHY each arm cannot honour the block — one clause per rejected driver id.
 *
 * Keyed by {@link PoolUnsupportedDriverId}, so adding an id to
 * {@link POOL_UNSUPPORTED_DRIVER_IDS} without writing its explanation is a
 * TYPE ERROR rather than a silently borrowed one. That matters because the
 * reasons genuinely differ: SQLite's is about `:memory:` splitting one
 * datasource across several stores, `memory`'s is that no connection exists to
 * pool. Reusing SQLite's sentence for `memory` would tell the author their
 * driver picked a connection strategy for them, when in fact there is no
 * connection and no strategy — a wrong explanation is worse than a terse one,
 * because it sends the author looking for a knob that does not exist.
 */
const POOL_UNSUPPORTED_REASONS: Readonly<Record<PoolUnsupportedDriverId, string>> = {
  memory:
    `the in-memory driver has no pool to size, and no connection to pool — its store is a plain ` +
    `data structure inside this process, reached by a direct call rather than over a wire, so ` +
    `\`min\` / \`max\` and the timeouts have nothing to configure. The block is rejected instead ` +
    `of dropped.`,
  sqlite: SQLITE_POOL_REASON,
  'sqlite-wasm': SQLITE_POOL_REASON,
};

/**
 * The clause used for a driver that is not in the rejected set at all.
 *
 * Unreachable through {@link unsupportedPoolIssue} — nothing produces a message
 * for a driver that reads the block. It exists because this function is
 * exported and takes a plain `string`, and the honest answer to "explain a
 * rejection that isn't one" is the part that is true of every rejected arm, not
 * another arm's specific reasoning.
 */
const POOL_UNSUPPORTED_REASON_GENERIC =
  `nothing in the block reaches a connection, so it is rejected instead of dropped.`;

/**
 * The rejection text for a `pool` block on a driver that cannot honour it.
 *
 * It is a FIX instruction, deliberately: it names the one edit that resolves it
 * (delete the block) and says where the key stays meaningful. It offers no
 * escape hatch and does not suggest changing the driver — an authoring mistake
 * has a correction, not a bypass. The frame is shared by every arm; only the
 * WHY clause is per-driver ({@link POOL_UNSUPPORTED_REASONS}).
 */
export function unsupportedPoolMessage(driver: string, datasourceName?: string): string {
  const subject = datasourceName ? `Datasource '${datasourceName}'` : 'This datasource';
  const id = resolveDriverId(driver);
  const reason =
    id && id in POOL_UNSUPPORTED_REASONS
      ? POOL_UNSUPPORTED_REASONS[id as PoolUnsupportedDriverId]
      : POOL_UNSUPPORTED_REASON_GENERIC;
  return (
    `${subject} declares a \`pool\` block, but the '${driver}' driver does not read it: ${reason} ` +
    `Remove \`pool\` from this datasource declaration; it stays meaningful on the pooled drivers ` +
    `(postgres / mysql / mongodb).`
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
