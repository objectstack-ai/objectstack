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
 * ## `turso` joined the set, and `mongodb`'s two timeouts became per-KEY (#7243)
 *
 * #6214's ledger pass read every arm and found the two faces this set did not
 * cover. Measured on `origin/main` before this change:
 *
 * ```text
 * turso   + pool{min:3,max:9,idleTimeoutMillis:30000}   `spec.pool` never read by the arm at all
 * mongodb + pool{max:20,idleTimeoutMillis:30000,connectionTimeoutMillis:3000}
 *                                driver config {"url":…,"database":"orders","maxPoolSize":20}
 * ```
 *
 * The mongodb line is the harder failure of the two: it is HALF-effective. The
 * author sizing a pool sees `max` take effect and has every reason to believe
 * the timeouts did too, when they were dropped on the floor.
 *
 * Maintainer ruling 2026-08-11, both halves:
 *
 *  1. `turso` joins the set **whole-arm**, with no fork by url mode. Local mode
 *     (`file:` / `:memory:`) is literally the better-sqlite3 engine this set
 *     already rejects for; remote mode (`libsql://`) has no connection pool
 *     either, only a `concurrency` cap on in-flight requests. The fork buys
 *     complexity and serves no measured consumer.
 *  2. mongodb's two unread timeout keys are **rejected loudly, not wired**.
 *     `MongoClient` does have `maxIdleTimeMS` / `connectTimeoutMS`, so this one
 *     *could* have been implemented — and that is exactly why it needed the
 *     ruling. Wiring it is pull-less behaviour-surface expansion with no
 *     measured consumer; rejection keeps declared = enforced and tells the
 *     author immediately. Wire them later iff real demand appears.
 *
 * That second half is a NEW SHAPE for this module: a rejection scoped to
 * individual keys rather than to the whole block, because `min` / `max` on
 * `mongodb` are honoured and must keep working. See
 * {@link POOL_UNREAD_KEYS_BY_DRIVER}.
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
 * Four built-ins, for three different reasons. The SQLite pair — `sqlite`
 * (better-sqlite3, via `resolveSqliteDriver`) and `sqlite-wasm`
 * (`SqliteWasmDriver`) — take no pool option and could not honour one, see the
 * module note on `:memory:`. `memory` (`InMemoryDriver`) is more absolute
 * still: it opens no connection at all, so there is nothing a pool could size.
 * `turso` (#7243) is the one whose two transport modes both land here for
 * reasons of their own. Each carries its own explanation in
 * {@link POOL_UNSUPPORTED_REASONS} — an id cannot join this list without one,
 * because that record is keyed by this type.
 */
export const POOL_UNSUPPORTED_DRIVER_IDS = ['memory', 'sqlite', 'sqlite-wasm', 'turso'] as const;

export type PoolUnsupportedDriverId = (typeof POOL_UNSUPPORTED_DRIVER_IDS)[number];

/**
 * Does this driver id read a declared `datasource.pool` **at all**?
 *
 * `true` for the pooled built-ins (`postgres` / `mysql` / `mongodb`) **and** for
 * every id outside the built-in table — an unknown id is not ours to judge, so
 * it is left alone rather than rejected against a contract we do not ship.
 *
 * ⚠️ "At all" is the whole precision of this predicate, and since #7243 it is
 * load-bearing: `mongodb` answers `true` while reading only `min` / `max`. Use
 * {@link unreadPoolKeys} for the per-key question — a `true` here does NOT mean
 * every declared key lands.
 *
 * `turso` answered `true` until #7243, first via the unknown-id branch and,
 * after #6345 made it a builtin, via "not in the rejected set" — both wrong the
 * same way: the arm never reads `spec.pool`. The 2026-08-11 ruling folds it in
 * whole-arm, so this now answers `false` for every spelling of it.
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
  // #7243. Deliberately NOT a paraphrase of SQLite's: an author who declared a
  // pool on a libSQL datasource is as likely to be on the remote transport as
  // the local one, and telling them about `:memory:` splitting a database would
  // describe a mode they are not in. Both modes are named, because the honest
  // answer differs by mode and the verdict does not.
  turso:
    `neither libSQL transport has a connection pool to size. A \`file:\` / \`:memory:\` url runs ` +
    `the local engine — better-sqlite3, one connection per database, the same engine the two ` +
    `sqlite arms are rejected for — and a \`libsql://\` url is a remote request transport with ` +
    `no persistent connections at all, capped by \`config.concurrency\` rather than by \`min\` / ` +
    `\`max\`. \`TursoDriverConfig\` has no \`min\` / \`max\` to receive them, so the block is ` +
    `rejected instead of dropped.`,
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
 * Keys of `datasource.pool` that a driver which DOES read the block still never
 * takes out of it — the half-effective case (#7243).
 *
 * One entry today. The `mongodb` arm maps `min` / `max` onto the MongoClient's
 * `minPoolSize` / `maxPoolSize` and reads nothing else, so a declaration of
 * `pool: { max: 20, idleTimeoutMillis: 30000 }` had `max` take effect while the
 * timeout vanished — measured on `origin/main` as driver config
 * `{"url":…,"database":"orders","maxPoolSize":20}`. That is worse than the whole
 * -block silence the set above closes, because the author's evidence that their
 * pool config "works" is real, and only half of it.
 *
 * The whole-block set could not express this: rejecting `mongodb` there would
 * throw away `min` / `max`, which ARE honoured. Hence a second, narrower gate —
 * and deliberately a DATA table rather than a per-arm `if`, so the fix for the
 * next arm that half-reads the block is one line here and inherits all three
 * doors.
 *
 * ⚠️ Every key listed here must be one this driver truly does not read; the
 * pin in `datasource-pool-support.test.ts` re-derives mongodb's list from the
 * factory arm's own source so the table cannot drift away from the code once
 * someone wires a key up.
 */
export const POOL_UNREAD_KEYS_BY_DRIVER: Readonly<Record<string, readonly string[]>> = {
  mongodb: ['idleTimeoutMillis', 'connectionTimeoutMillis'],
};

/**
 * WHY the listed keys reach nothing on that arm — one clause per driver id, for
 * the same reason {@link POOL_UNSUPPORTED_REASONS} is per-arm: a borrowed
 * explanation sends the author looking for a knob that does not exist.
 */
const POOL_UNREAD_KEY_REASONS: Readonly<Record<string, string>> = {
  mongodb:
    `the mongodb arm takes \`min\` / \`max\` out of the block and maps them onto the MongoClient's ` +
    `\`minPoolSize\` / \`maxPoolSize\` — and nothing else, so the rest of the block reaches no ` +
    `connection. This rejection is deliberate: the platform refuses a declaration it would ` +
    `otherwise drop in silence, which is what made this one hard to see (\`max\` took effect, so ` +
    `the config looked honoured).`,
};

/**
 * What SURVIVES the edit, per arm — the clause the whole-block message cannot
 * have, because there the whole block goes. Telling a mongo author to "remove
 * `pool`" would delete two keys that are honoured, so the message has to say
 * which part of their declaration is still doing something.
 */
const POOL_UNREAD_KEY_TAILS: Readonly<Record<string, string>> = {
  mongodb:
    '`min` / `max` stay meaningful here, and the timeouts stay meaningful on the knex-pooled '
    + 'drivers (postgres / mysql).',
};

/** `` `a` ``, `` `a` and `b` ``, `` `a`, `b` and `c` `` — for a list of key names. */
function formatKeyList(keys: readonly string[]): string {
  const quoted = keys.map((k) => `\`${k}\``);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * Which of this datasource's declared `pool` keys does its driver never read?
 *
 * Empty for every driver outside {@link POOL_UNREAD_KEYS_BY_DRIVER} — including
 * the ones rejected whole-block above, whose verdict is not this gate's, and
 * every id the platform ships no contract for. Order follows the table, not the
 * author's key order, so one declaration always produces one message.
 */
export function unreadPoolKeys(driver: unknown, pool: unknown): readonly string[] {
  const id = resolveDriverId(driver);
  if (!id) return [];
  const unread = POOL_UNREAD_KEYS_BY_DRIVER[id];
  if (!unread || !isPoolDeclared(pool)) return [];
  const declared = pool as Record<string, unknown>;
  return unread.filter((key) => declared[key] !== undefined);
}

/**
 * The rejection text for `pool` keys the driver reads nothing out of.
 *
 * Same voice as {@link unsupportedPoolMessage}: name the datasource, name the
 * offending keys, say the rejection is deliberate, give the one edit that fixes
 * it, and offer no escape hatch and no "use another driver" advice. It differs
 * in one respect only — it says what STAYS, because on this arm most of the
 * block is honoured and telling the author to delete `pool` would be wrong.
 */
export function unreadPoolKeysMessage(
  driver: string,
  keys: readonly string[],
  datasourceName?: string,
): string {
  const subject = datasourceName ? `Datasource '${datasourceName}'` : 'This datasource';
  const id = resolveDriverId(driver);
  const list = formatKeyList(keys);
  const them = keys.length > 1 ? 'them' : 'it';
  const reason =
    (id && POOL_UNREAD_KEY_REASONS[id])
    ?? `nothing in the arm reads ${them}, so ${them} reaches no connection.`;
  const tail =
    (id && POOL_UNREAD_KEY_TAILS[id])
    ?? `the rest of the block is unaffected.`;
  return (
    `${subject} declares ${list} in its \`pool\` block, but the '${driver}' driver does not read ` +
    `${them}: ${reason} Remove ${list} from this datasource's \`pool\`; ${tail}`
  );
}

/**
 * The rejection for one datasource declaration, or `undefined` when there is
 * nothing to reject. Never throws — callers that want the throw use
 * {@link assertDatasourcePoolSupported}.
 *
 * Two gates, in this order: the whole block first (the driver reads none of
 * it), then the individual keys (the driver reads the block but not these).
 * They cannot both fire — a driver in {@link POOL_UNSUPPORTED_DRIVER_IDS} has no
 * entry in {@link POOL_UNREAD_KEYS_BY_DRIVER} — and the order says which message
 * an author gets if one ever did: the block-level one, because deleting the
 * block is the larger edit that subsumes the other.
 */
export function unsupportedPoolIssue(input: {
  driver: string;
  pool?: unknown;
  name?: string;
}): string | undefined {
  if (!isPoolDeclared(input.pool)) return undefined;
  if (!driverReadsDeclaredPool(input.driver)) {
    return unsupportedPoolMessage(input.driver, input.name);
  }
  const unread = unreadPoolKeys(input.driver, input.pool);
  if (unread.length > 0) return unreadPoolKeysMessage(input.driver, unread, input.name);
  return undefined;
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
