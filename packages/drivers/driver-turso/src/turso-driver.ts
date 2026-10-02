// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Turso/libSQL Driver for ObjectStack
 *
 * Dual-transport architecture supporting:
 * - **Local mode:** file-based or in-memory SQLite via SqlDriver (Knex + better-sqlite3)
 * - **Replica mode:** local SQLite + embedded replica sync via @libsql/client
 * - **Remote mode:** pure remote queries via @libsql/client (HTTP/WebSocket)
 *
 * In local/replica mode, all CRUD, schema, query, filter, and introspection
 * logic is inherited from SqlDriver. In remote mode, TursoDriver delegates
 * all operations to RemoteTransport which uses @libsql/client directly.
 *
 * The transport mode is auto-detected from the URL, its scheme matched in any
 * letter case, as `@libsql/client` matches it:
 * - `file:` or `:memory:` → local
 * - `file:` + `syncUrl` → replica (an embedded replica is a local FILE)
 * - `libsql://`, `https://`, `http://`, `wss://` or `ws://` (no syncUrl) → remote
 *   (`http://` / `ws://` = plaintext, for self-hosted / local-dev endpoints)
 *
 * Refused at construction (`VALIDATION_ERROR` / 400), because the local engine
 * would have run on a private `:memory:` database: in a local or replica mode,
 * a url that is none of those (a bare path, an unsupported scheme); a remote
 * url beside `syncUrl` or under `mode: 'local'` / `'replica'`; and a replica
 * whose url names an in-memory database. A forced `mode: 'replica'` with no
 * `syncUrl` is refused too, because nothing would ever sync it, and so is a
 * forced `mode: 'local'` beside a `syncUrl`, because it would sync anyway.
 */

import {
  SqlDriver,
  GLOBAL_TENANT,
  type IntrospectedSchema,
  type ManagedDriftEntry,
  type SqlDriverConfig,
  type SqlWindowFunctionQuery,
} from '@objectstack/driver-sql';
import { StandardErrorCode } from '@objectstack/spec/api';
import type { DriverQuery } from '@objectstack/spec/contracts';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import type { Client } from '@libsql/client';
import { RemoteTransport, type RemoteTenantScope } from './remote-transport.js';
import {
  backfillRemoteCanonicalColumns,
  type RemoteBackfillClient,
  type RemoteBackfillColumn,
  type RemoteCanonicalBackfillOptions,
  type RemoteCanonicalBackfillReport,
} from './remote-canonical-backfill.js';
import {
  backfillRemoteCodecResidueColumns,
  type RemoteCodecResidueColumn,
  type RemoteCodecResidueReport,
} from './remote-codec-residue-backfill.js';

// ── Transport Mode ───────────────────────────────────────────────────────────

/**
 * Transport mode for TursoDriver.
 *
 * - `local`: File-based or in-memory SQLite via Knex + better-sqlite3
 * - `replica`: Local SQLite + embedded replica sync from remote Turso
 * - `remote`: Pure remote queries via @libsql/client (no local DB)
 */
export type TursoTransportMode = 'local' | 'replica' | 'remote';

// ── Configuration Types ──────────────────────────────────────────────────────

/**
 * Turso driver configuration.
 *
 * Supports the following connection modes:
 * 1. **Local (Embedded):** `url: 'file:./data/local.db'`
 * 2. **In-memory (Ephemeral):** `url: ':memory:'`
 * 3. **Embedded Replica (Hybrid):** `url` (a local `file:`, never `:memory:`
 *    or a remote url, both refused at construction) + `syncUrl` (remote
 *    `libsql://` / `https://` Turso endpoint)
 * 4. **Remote (Cloud):** `url: 'libsql://...'` — pure remote queries
 *    via @libsql/client, no local SQLite needed
 *
 * In local/replica modes, the primary query engine runs against a local
 * SQLite database (via SqlDriver / Knex + better-sqlite3). In remote mode,
 * all operations use @libsql/client SDK (HTTP/WebSocket) directly.
 *
 * Transport mode is auto-detected from the URL, or can be forced via `mode`.
 */
export interface TursoDriverConfig {
  /**
   * Database URL.
   *
   * - `file:./data/local.db` → local mode
   * - `:memory:` → local mode (ephemeral)
   * - `libsql://my-db.turso.io` → remote mode (cloud-only)
   * - `https://my-db.turso.io` → remote mode (cloud-only)
   *
   * The scheme matches in any letter case (`LIBSQL://` is `libsql://`), as it
   * does in `@libsql/client`. A path to a local database file needs the
   * `file:` prefix: a bare path such as `./data/app.db` is not a url. In a
   * local or replica mode the constructor refuses any url that is not `file:`,
   * `:memory:` or a remote url (`VALIDATION_ERROR` / 400), because the local
   * engine could open nothing but a private in-memory database for it.
   */
  url: string;

  /** JWT auth token for the remote Turso database */
  authToken?: string;

  /**
   * AES-256 encryption key for the local database file.
   * Only effective in local/replica modes.
   */
  encryptionKey?: string;

  /**
   * Maximum concurrent requests to the remote database.
   * Effective in replica and remote modes.
   * Default: 20
   */
  concurrency?: number;

  /**
   * Remote sync URL for embedded replica mode (`libsql://` or `https://`).
   *
   * Turns a local `file:` `url` into an embedded replica. Beside a remote
   * `url` or `:memory:` the constructor refuses it (`VALIDATION_ERROR` / 400):
   * there is no local file for the replica to live in, so the local engine
   * would run on a private in-memory database. For a remote database, drop
   * `syncUrl` and keep the remote `url`. Under a forced `mode: 'remote'` it is
   * refused too (`VALIDATION_ERROR` / 400): the remote client never receives
   * it, so no sync would ever run. Under a forced `mode: 'local'` it is
   * refused as well (`VALIDATION_ERROR` / 400): the driver would sync the
   * database with it anyway and the declared local mode would be ignored.
   */
  syncUrl?: string;

  /**
   * Sync configuration for embedded replica mode. Requires `syncUrl`: without
   * one the constructor refuses it (`VALIDATION_ERROR` / 400), in any mode,
   * because nothing would read it.
   */
  sync?: {
    /** Periodic sync interval in seconds (0 = manual only). Default: 60 */
    intervalSeconds?: number;
    /** Sync immediately on connect. Default: true */
    onConnect?: boolean;
  };

  /**
   * Operation timeout in milliseconds for remote operations.
   * Effective in replica and remote modes; `0` or unset means no bound.
   *
   * What it bounds, per arm (measured against `@libsql/client@0.18.0`):
   *
   * - **Remote mode over HTTP** (`libsql://`, `https://`, `http://`): every
   *   request the client's HTTP transport makes, when THIS driver creates the
   *   client. The driver hands `@libsql/client` a `fetch` that aborts once the
   *   window elapses, so a stalled endpoint fails the operation as `TIMEOUT` /
   *   504 instead of hanging it. Two remote compositions cannot carry that
   *   window, and the constructor REFUSES both (`VALIDATION_ERROR` / 400)
   *   rather than accept a bound it cannot deliver:
   *   - a `wss://` / `ws://` URL, which rides the WebSocket transport and
   *     exposes no such seam in this client version — drop `timeout`, or spell
   *     the url `libsql://` / `https://`, which IS bounded;
   *   - a pre-configured {@link TursoDriverConfig.client}, which arrives with
   *     its transport already built and no seam left to install the window on
   *     — drop `client`, or drop `timeout` and build the bound into that client
   *     when you create it.
   * - **Replica mode**: `sync()` — the one remote operation on this arm (reads
   *   and writes run against the local file). A sync still running when the
   *   window closes rejects with the same envelope; the native binding's own
   *   sync is not cancelled, only no longer awaited.
   *
   * Deliberately NOT forwarded to `@libsql/client`'s `Config.timeout`: that is
   * the busy timeout for lock contention on local `file:` databases, which
   * "remote clients ignore" — a different setting that happens to share the
   * name.
   */
  timeout?: number;

  /**
   * Force a specific transport mode. If not provided, mode is auto-detected
   * from the URL:
   *
   * - `file:` or `:memory:` without syncUrl → `'local'`
   * - `file:` with syncUrl → `'replica'`
   * - `libsql://` / `https://` / `http://` / `wss://` / `ws://` without syncUrl → `'remote'`
   *
   * Schemes match in any letter case. A url that is none of these is refused
   * at construction (`VALIDATION_ERROR` / 400), with or without `syncUrl`.
   *
   * A forced `'local'` or `'replica'` still runs on the local engine, so it
   * is refused beside a remote url or any other url that is not `file:` or
   * `:memory:` (`VALIDATION_ERROR` / 400), and `'replica'` is refused on an
   * in-memory url too. The engine would otherwise run on a private in-memory
   * database.
   *
   * A forced `'replica'` also needs {@link TursoDriverConfig.syncUrl}, the
   * remote it replicates from: without one (or with an empty one) the
   * constructor refuses it (`VALIDATION_ERROR` / 400), because nothing would
   * ever sync and the datasource would run as a plain local database. For a
   * local database, drop `mode`; for a replica, set `syncUrl`.
   *
   * A forced `'local'` is refused beside a (non-empty)
   * {@link TursoDriverConfig.syncUrl} (`VALIDATION_ERROR` / 400): the driver
   * syncs whenever `syncUrl` is set, so the datasource would run as an
   * embedded replica under a `local` label. For a replica, drop `mode`; for a
   * local database, drop `syncUrl` (and `sync`).
   */
  mode?: TursoTransportMode;

  /**
   * Pre-configured @libsql/client instance. When provided, TursoDriver uses
   * this client directly instead of creating its own. Useful for custom
   * caching, connection pooling, or testing.
   *
   * Only effective in remote and replica modes.
   *
   * **In REMOTE mode this key may not be combined with a non-zero
   * {@link TursoDriverConfig.timeout}** — the constructor refuses the pair
   * (`VALIDATION_ERROR` / 400). The window is the `fetch` this driver installs
   * while CREATING the remote client, so a client it did not create cannot
   * carry it; accepting the pair meant running every request unbounded while
   * `timeout`'s contract promised otherwise. Build the bound into the client
   * you hand in (`createClient({ fetch })`), or drop `client` and let the
   * driver create the remote client. Replica mode is unaffected: `sync()` —
   * the one remote operation on that arm — is bounded whatever client is in
   * use, so the pair stays accepted there.
   */
  client?: Client;
}

// ── Autonumber on the remote face ────────────────────────────────────────────

/**
 * [#6944 → #21113] A record number this face ISSUES — from the same persistent
 * `_objectstack_sequences` counter the other two faces draw from, atomically
 * in the database, over the remote transport.
 *
 * # What was measured, and where the knowledge lives
 *
 * `TursoDriver` picks its transport from `url`. Local and embedded-replica
 * inherit `SqlDriver.create`, which calls `fillAutoNumberFields` and issues the
 * number from the persistent `_objectstack_sequences` table. Remote overrides
 * the write path to `RemoteTransport`, which builds its own `INSERT` and never
 * entered that method — so on this face `auto_number` was only a column mapped
 * to `TEXT`, and the slot the engine deliberately left empty stayed empty.
 * Measured on `main` @ `2f3e79351`, remote, `case_number: { type: 'autonumber' }`:
 *
 * ```
 * create      -> RESOLVED case_number=null
 * bulkCreate  -> RESOLVED [null, null]
 * upsert      -> RESOLVED case_number=null
 * LOCAL create-> RESOLVED case_number="CASE-00001"
 * ```
 *
 * The engine cannot catch this for the caller: `supports.autonumber` is `true`
 * here (inherited through `...super.supports`), so `engine.ts` defers generation
 * to the driver entirely and never runs its own fallback — see the driver table
 * in its `generateAutoNumbers` docblock, which records `driver-turso` as
 * "inherited, no fallback path". A declared capability that boots and quietly
 * delivers nothing is the shape #3724 ruled on; triage applied that ruling here
 * (2026-08-09) as **disposition B, explicit refusal** (`NOT_IMPLEMENTED`/501,
 * raised on this driver), and left **A, implement autonumber on remote**,
 * behind the appetite door "for want of measured demand", recording that the
 * capability bit "flips *with* the implementation, not before it".
 *
 * The demand was then measured: a published app on the hosted product, in a
 * release check (objectstack-ai/cloud#2531 — `POST /api/v1/data/crm_account`
 * answered `501 NOT_IMPLEMENTED` on a hosted tenant, whose database is on this
 * transport, so no object declaring an `auto_number` field could get a new
 * record there). The door's own condition was met, and A shipped: the refusal
 * became generation, and `supports.autonumber: true` on this face became TRUE
 * rather than knowingly false.
 *
 * ⚠️ Generation happens HERE, on the driver, and not inside `RemoteTransport`,
 * for the reason the refusal was raised here: the transport cannot see what it
 * would need to decide. `RemoteTransport.create(object, data)` takes no schema
 * and caches none (`syncSchema` reads one and keeps nothing), so it cannot tell
 * an `auto_number` column from any other `TEXT` one. The driver can:
 * `registerRemoteFieldMetadata` → `SqlDriver.registerExternalObject` classifies
 * every field at remote schema-sync time and keys `autoNumberFields` by object
 * name — measured populated in remote mode, tenant field and all. So the slots
 * are filled one layer above the statement builder, and the transport receives
 * a row that already carries its number, exactly as it receives a caller-
 * supplied one.
 *
 * # One semantics, not two — what is SHARED with the other faces
 *
 * An embedded-replica face and a remote face can point at ONE database, so a
 * second copy of any of these would hand out colliding numbers on it:
 *
 *  - the format rendering and precedence — `resolveAutonumberFormat` at
 *    registration, `renderAutonumber` / `missingFieldValues` in
 *    `fillAutoNumberFields`, which this face now CALLS for every write (the
 *    empty-slot predicate, the `{field}` refusal, the tenant resolution, the
 *    scope / prefix / suffix of the probe, the reservation report: all its);
 *  - the counter identity — `SqlDriver.sequenceKeyHash` over
 *    `(table, tenant, field, scope)` and `resolveSequenceTenantId`;
 *  - the table — `SqlDriver.defineSequencesTable`, compiled to text by the
 *    connection-less Knex this face already holds (#20054) and sent as-is;
 *  - the bootstrap — `SqlDriver.maxAutonumberCounter`, the one reading of the
 *    data table's MAX, suffix included (#6468), over rows this face fetches;
 *  - the collision re-seed (#5495) — `collidingAutoNumberReservations` with
 *    this face's `autoNumberValueExists` and `resyncSequenceToDataMax`.
 *
 * What is this face's own is only HOW the counter moves, because a Knex
 * transaction (`SqlDriver.getNextSequenceValue`: lock the row, read, update) is
 * an interactive transaction held across HTTP round trips here, and `forUpdate`
 * is a no-op on SQLite anyway. The remote face moves it in ONE statement:
 *
 * ```
 * warm:  UPDATE _objectstack_sequences SET last_value = last_value + 1
 *        WHERE key_hash = ? RETURNING last_value
 * cold:  (scan the data table's MAX, in JS, by the shared reading) then
 *        INSERT … VALUES (…, max + 1) ON CONFLICT (key_hash)
 *        DO UPDATE SET last_value = last_value + 1 RETURNING last_value
 * ```
 *
 * Each is a single SQLite statement, serialised by the database's write lock
 * whoever holds the connection — two processes cannot both read `last_value`
 * before either writes it, which is the property an in-process counter or the
 * engine's in-memory fallback cannot have, and the one the hosted runtime
 * (several containers, one tenant database) needs. Two cold writers racing on
 * the first row both scan, both INSERT, one wins the row and the other's
 * `ON CONFLICT` arm increments the winner's value: distinct numbers, no lost
 * seed. Measured on two processes, each holding its own `@libsql/client`
 * connection to one database file (`turso-remote-autonumber-concurrency.test.ts`).
 * The seed is NOT folded into the statement as a SQL `MAX(…)`: the bootstrap
 * reading strips a declared suffix and reads the digit run after the prefix
 * (`readAutonumberCounter`), which a dialect expression would be a second copy
 * of, and that copy is the collision this section exists to prevent.
 *
 * # The legacy table shape — refused, not migrated
 *
 * `SqlDriver.ensureSequencesKeyHashShape` rebuilds a pre-`key_hash` table in
 * place through a live Knex connection. This face has none, and a raw-SQL
 * rewrite of that rebuild would be a second copy of a migration. So a table
 * found WITHOUT `key_hash` is refused here, loudly and actionably, instead of
 * being keyed by the legacy `(object, tenant_id, field)` rule — which would be
 * a second keying rule beside the shared one. It cannot arise on a database
 * this face created (it creates the current shape), only on one a pre-`key_hash`
 * local face wrote first; the remedy is to open that database once through the
 * local or embedded-replica face, whose `initObjects` migrates it.
 *
 * # What is deliberately left as it was
 *
 * A record that ALREADY carries a value in the slot. `fillAutoNumberFields`
 * skips exactly those (`undefined` / `null` / `''` is its generate predicate),
 * and on this face they are written through unchanged — the `isSystem` seed
 * replay and the `preserveAudit` historical import, which `engine.ts` exempts
 * from its strip on purpose (#5503). And on `upsert`, a row that MERGES keeps
 * the number already in its column (#7011): the autonumber columns are named
 * to the transport as insert-only, so the fresh reservation lands only on the
 * insert leg — the leg #7099 recorded as writing NULL, which now gets a number.
 */

/**
 * The refusal for a pre-`key_hash` sequences table this face cannot migrate —
 * see the section above for why it refuses rather than keys by the legacy
 * rule. `DATABASE_ERROR`/500: the request is spelled correctly, the backend's
 * own state is what blocks the write, and a `StandardErrorCode` member so there
 * is no new code.
 */
function refuseLegacyRemoteSequencesTable(table: string): never {
  const err = new Error(
    `The sequence-counter table "${table}" on this database predates the key_hash shape, and the ` +
    `Turso REMOTE transport does not migrate it (the local and embedded-replica transports do, ` +
    `in place, when they initialise objects). No record number was issued and no row was written. ` +
    `Open this database once through the local or embedded-replica transport (a \`file:\` URL, with ` +
    `\`syncUrl\` for a replica) and let it initialise the objects that declare autonumber fields; ` +
    `the rebuilt table then serves every transport.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.DATABASE_ERROR;
  err.status = 500;
  throw err;
}

/**
 * A table, field or tenant column interpolated into a sequence statement,
 * spelled the way the transport spells a table it does not own
 * (`RemoteTransport.tableSql`): double-quoted, any embedded quote doubled, so
 * nothing inside the name can close the quoting and continue as grammar. Not
 * held to the bare-identifier shape, because a federated object's
 * `external.remoteName` is authored as any string and the local face reads
 * such a table through Knex's own quoting — the counter must bootstrap from
 * the same table on this face.
 */
function quoteSequenceName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// ── Remote transactions: refused, never decorative ───────────────────────────

/**
 * [#18616] The Turso REMOTE face has no transaction semantics, and now says so
 * instead of handing back a handle nothing honours.
 *
 * # The defect this replaces
 *
 * `@objectstack/spec`'s `driver.zod.ts` states the delivery mechanism verbatim:
 *
 * > A transaction handle to be passed to subsequent operations via
 * > `options.transaction`.
 *
 * In remote mode nothing can receive that handle. `RemoteTransport` names a
 * transaction in exactly three members — `beginTransaction()`, `commit(t)`,
 * `rollback(t)` — and **zero** of its data methods take an `options` argument
 * at all, against **9** data methods present in the file (the firing control
 * that makes the zero a reading). Every remote arm in this class forwards
 * without `options`, and `connect()` skips knex initialisation on that arm, so
 * no `SqlDriver` body that would honour a handle ever runs.
 *
 * The consequence is not a missing feature, it is a false success: a write
 * issued between `beginTransaction()` and `rollback()` executed on the plain
 * connection, was **already durable**, and the rollback — which resolved —
 * undid nothing. `turso-driver.test.ts` asserts exactly that shape for LOCAL
 * mode ("should support transactions with rollback"), so the tree already knew
 * what correct looks like here; the remote face was the unpinned one.
 *
 * # Why a refusal rather than an implementation
 *
 * Triage's ruling on this card (2026-09-17) drew the line and it is quoted
 * rather than paraphrased, because the boundary IS the deliverable:
 *
 * > **止损(本卡)**:remote 模式遇到 `options.transaction` 或
 * > `beginTransaction()` 时**大声拒绝 / 声明不支持**,让调用者立刻知道自己没有
 * > 事务语义。
 * > **实现远程事务**:那是 **#18116 已完成的那次「measure, do not implement」
 * > 量出来的半径**,是**另一件事**、另一个量级。⛔ 不要把它折进本卡。
 *
 * This is the same disposition — B, explicit refusal — that
 * {@link refuseRemoteAutonumber} above records for the sibling gap on this same
 * transport, and it answers in the same envelope for the same reason: the
 * caller's request is spelled correctly and `@objectstack/spec` declares the
 * member, so the gap is the backend's, which is `NOT_IMPLEMENTED`/501 and not a
 * 400 (ADR-0112 vocabulary; the two-class taxonomy this package already applies
 * to aggregate functions and date buckets).
 *
 * # Why the refusal is raised HERE and not inside `RemoteTransport`
 *
 * The same layering argument `refuseRemoteAutonumber` records: the transport
 * cannot see what it would have to refuse. Its data methods have no `options`
 * parameter, so a handle is already gone by the time a statement is built —
 * this class is the last layer that still holds one.
 *
 * # Why NOT a standard-catalog addition or a new code
 *
 * `NOT_IMPLEMENTED` is a {@link StandardErrorCode} member, so this emits
 * nothing the error-code ledger has to register — the ledger carries *extension*
 * codes only. No `packages/spec` edit is implied by this refusal, deliberately.
 */
function refuseRemoteTransaction(door: string, detail: string): never {
  const err = new Error(
    `${door} is not supported by the Turso REMOTE transport. ${detail} Remote mode routes every ` +
    `operation through \`RemoteTransport\`, whose data methods take no \`options\` argument at ` +
    `all, so a transaction handle cannot reach the statement that would have to join it: the ` +
    `write executes on the plain connection and is ALREADY DURABLE, and a later \`rollback()\` ` +
    `resolves without undoing it. Until this change that sequence reported success at every step ` +
    `and silently kept the data. The object and the call are spelled correctly and ` +
    `@objectstack/spec declares these members, so this is a capability gap in the remote ` +
    `transport rather than a mistake in the request — which is why it answers ` +
    `NOT_IMPLEMENTED/501 and not a 400. Use the local or embedded-replica transport, which ` +
    `inherit \`SqlDriver\`'s knex transactions and honour \`options.transaction\`, or take the ` +
    `non-transactional path deliberately: \`engine.transaction()\` without \`require: true\` on a ` +
    `datasource whose driver has no transactions runs the callback with no rollback and says so ` +
    // ⛔ No tracker id in this string: it reaches authors and operators, who have
    // no tracker to resolve one against (`check:doc-authoring`). The card id is
    // in the docblock above, where the reader who CAN resolve it is reading.
    `(ADR-0119 D1). Implementing transactions on this transport is a separate piece of work.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
}

// ── Remote deferred schema DDL: refused, never decorative ────────────────────

/**
 * [#19823] The Turso REMOTE face cannot defer schema DDL, and now says so when
 * a caller tries to arm the deferral instead of accepting it and ignoring it.
 *
 * # The defect this replaces
 *
 * `SqlDriver.setDeferredDdl(true)` is how `os migrate plan` / `apply` /
 * `duplicates` / `account-issuer` / `multi-value-columns` keep their dry-run or
 * confirm-before-change promise: the Knex `initObjects` records the work in
 * `deferredSchemaObjects` instead of performing it, `previewDeferredSchemaWork`
 * renders it and `flushDeferredSchemaDdl` performs it after the operator says
 * yes. This class inherited the setter, so the CLI's own loud refusal (it fires
 * only when the method is absent) never fired — while every remote schema door
 * (`syncSchemasBatch`, the engine's boot sync; `syncSchema` / `initObjects`)
 * routes through `RemoteTransport`, which performs the DDL immediately, and the
 * latter two also ran the #5770 canonical temporal backfill, which rewrites
 * stored rows (the batch door runs it too since #19844). Measured
 * (`turso-remote-deferred-ddl.test.ts`, before this refusal existed): the deferral was
 * accepted, CREATE/ALTER ran on every door, the backfill rewrote rows on two of
 * them, and preview and flush both answered `[]` — a dry run that changed the
 * database and then reported no pending work.
 *
 * # Why a refusal rather than an implementation
 *
 * Honouring the deferral remotely means recording the objects and building a
 * remote preview/flush — new capability with no measured pull. The refusal keeps
 * every promise those commands make true today, in the envelope and for the
 * reason {@link refuseRemoteTransaction} and {@link refuseRemoteAutonumber}
 * record for their sibling gaps on this transport: the call is spelled correctly
 * and the base class declares it, so the gap is the backend's —
 * `NOT_IMPLEMENTED`/501, a {@link StandardErrorCode} member, no new code.
 *
 * # Why at the setter
 *
 * It is the one door every deferring caller passes through, and it runs before
 * any schema work: a refused arm has sent nothing to the database, and the
 * driver is left un-armed, so an ordinary boot sync on it is unchanged.
 */
function refuseRemoteDeferredDdl(): never {
  const err = new Error(
    'Deferred schema DDL is not supported by the Turso REMOTE transport (this datasource\'s ' +
    'transport mode is `remote`), so a command that promises a dry run or a confirmation before ' +
    'any schema change cannot keep that promise against it. Remote mode sends every CREATE TABLE ' +
    'and ALTER TABLE through `RemoteTransport`, which performs it immediately and records nothing ' +
    'a plan could preview, and a remote schema sync also rewrites stored datetime/time values to ' +
    'their canonical spelling in place. Until this change arming the deferral was accepted: the ' +
    'database was altered during the boot and the plan then reported no pending work. The call is ' +
    'spelled correctly and `SqlDriver` declares it, so this is a capability gap of the remote ' +
    'transport rather than a mistake in the request — which is why it answers NOT_IMPLEMENTED/501 ' +
    'and not a 400. To preview schema work, run the command against a local SQLite copy of this ' +
    'database (a `file:` URL) — the local and embedded-replica faces defer DDL; to apply it, an ' +
    'ordinary boot against this datasource (`os serve` / `os start`) performs the additive schema ' +
    'sync directly.',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
}

// ── Remote schema drift detection: refused, never "no drift" ─────────────────

/**
 * [#19845] The Turso REMOTE face cannot detect schema drift, and now says so
 * instead of answering that there is none.
 *
 * # The defect this replaces
 *
 * `SqlDriver.detectManagedDrift` reads the physical schema through Knex: a
 * `hasTable` probe per table, then column and index introspection fed to the
 * shared differ. In remote mode that Knex instance was then the placeholder
 * `:memory:` database {@link TursoDriver.toKnexConfig} handed the base
 * constructor. It held none of this datasource's tables, so every table was
 * skipped as absent and the answer was `[]` whatever the remote database held.
 * The no-argument call had a second reason to answer `[]`: it iterates
 * `managedObjectFields`, which only the Knex `initObjects` fills and no remote
 * schema door reaches. [#20054] Remote mode's Knex has no connection at all
 * now, so an explicit-objects call would fail on its first `hasTable`; the
 * no-argument call would still answer `[]` from the empty registry, which is
 * why the refusal stays. Measured on the transport's SQLite-backed double
 * (`turso-remote-drift-detection-refusal.test.ts`): a synced table carrying an
 * extra physical column the declaration omits reads `unmapped_column` /
 * `drop_column` on the local face and `[]` on the remote one, with or without
 * explicit objects. The artifact-pinned boot gate of `os serve`, whose job is
 * to refuse a boot on destructive drift, therefore let every remote-Turso boot
 * through as never drifted.
 *
 * # Why a refusal rather than an implementation
 *
 * The shared differ would serve a remote table: a clean remote-synced table,
 * judged through a local Knex connection to the same SQLite file, reports no
 * entries, as the local face does. But every read that feeds the differ goes
 * through `this.knex` (table existence, column facts and order, the index set,
 * the NULL-safe duplicate probe), so a remote implementation is a second copy
 * of each of those SQLite arms. It also needs a remote answer for
 * `applyMigrationEntries`, which the gate calls on whatever it finds and which
 * runs through the same `this.knex`. Until that exists the refusal is the honest
 * answer, in the envelope and for the reason {@link refuseRemoteDeferredDdl}
 * records for its sibling gap on this transport: the call is spelled correctly
 * and the base class declares it, so the gap is the backend's.
 * `NOT_IMPLEMENTED`/501 is a {@link StandardErrorCode} member, so there is no
 * new code.
 *
 * # What a caller sees
 *
 * The boot gate already has a channel for "the check did not run": a throw
 * from `detectManagedDrift` becomes a warning carrying this message, and the
 * boot continues. That is the right reading of a driver that cannot judge. It
 * is neither a drift verdict that would refuse every remote boot nor a
 * silence. The `os migrate` commands that read drift never get this far on a
 * remote datasource, because they arm deferred DDL first and that is refused.
 */
function refuseRemoteDriftDetection(): never {
  const err = new Error(
    'Schema drift detection is not supported by the Turso REMOTE transport (this datasource\'s ' +
    'transport mode is `remote`), so this driver cannot say whether the database\'s physical ' +
    'schema matches the declared objects. Drift detection reads the physical schema through the ' +
    'SQL driver\'s Knex connection, which remote mode does not have: every statement goes to the ' +
    'remote database through the libSQL client instead. The objects it compares by default are the ' +
    'ones the SQL driver\'s own schema sync registers, and remote mode registers none there, so ' +
    'answering would report "no drift" for every remote database, whatever its tables hold; the ' +
    'call refuses instead. The call is spelled ' +
    'correctly and `SqlDriver` declares it, so this is a capability gap of the remote transport ' +
    'rather than a mistake in the request, which is why it answers NOT_IMPLEMENTED/501 and not a ' +
    '400. To check this database for drift, run `os migrate plan` against a local SQLite copy of it ' +
    '(a `file:` URL), where the physical schema is introspected. Pointed at the remote URL, ' +
    '`os migrate plan` refuses, because the remote transport cannot defer schema DDL.',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
}

// ── Remote media column move planning: refused, never "nothing to move" ──────

/**
 * [#19894] The Turso REMOTE face cannot plan the ADR-0104 media column move,
 * and now says so instead of answering that there is nothing to move.
 *
 * # The defect this replaces
 *
 * `SqlDriver.planMediaColumnMove` is the read-only half of the column step of
 * `os migrate files-to-references --apply`. It walks `managedObjectFields`,
 * which the Knex `initObjects` fills (through `registerObjectMetadata`) and no
 * remote schema door reaches, and it probes each table with `hasTable` and
 * column introspection through `this.knex`, which in remote mode was then the
 * placeholder `:memory:` database {@link TursoDriver.toKnexConfig} handed the
 * base constructor. Either reason alone empties the answer. [#20054] Remote
 * mode's Knex has no connection at all now, and the walk over the empty
 * registry still answers an empty scan without reaching it, which is why the
 * refusal stays. Measured on the
 * transport's SQLite-backed double
 * (`turso-remote-media-column-move-refusal.test.ts`): a table `m` with a `file`
 * and an `image` field, synced through each of the three remote schema doors,
 * holds its two physical TEXT columns on the remote database, and the remote
 * face answered `{ plans: [], refusals: [] }` on every door, with
 * `managedObjectFields` empty and the placeholder reporting no table `m`. The
 * local and embedded-replica faces planned two `unquote` moves for the same
 * declaration. The command mapped the empty scan to "nothing to move — this
 * datastore declares no single-value media column".
 *
 * # Why a refusal rather than an implementation
 *
 * Planning remotely needs a remote copy of the SQLite arms the planner reads
 * through Knex (table existence and column introspection), which is the same
 * second copy {@link refuseRemoteDriftDetection} declines for drift. It would
 * also need a remote answer to the step after the plan: the command stamps
 * `columns_moved_at` so the driver writes bare ids from its next boot, and the
 * remote face never asks for that stamp. The ADR-0104 resolver is supplied to
 * this driver, but only `SqlDriver.initObjects` asks it, and none of the three
 * remote schema doors calls that method; `toKnexConfig` forwards no
 * `fileColumnsMoved` either. Measured: the resolver was taken and asked zero
 * times on every remote door, and a remote write stored `"file_abc"` (the JSON
 * encoding) and read it back as `file_abc`. So until both halves exist the
 * refusal is the honest answer, in the envelope and for the reason
 * {@link refuseRemoteDriftDetection} records for its sibling gap on this
 * transport: the call is spelled correctly and the base class declares it, so
 * the gap is the backend's. `NOT_IMPLEMENTED`/501 is a
 * {@link StandardErrorCode} member, so there is no new code.
 *
 * # What a caller sees
 *
 * `os migrate files-to-references` calls the planner only after the backfill
 * and its self-check have passed, and reports this refusal as a column step it
 * could not judge, beside the backfill and verify reports and the flag it
 * recorded. Nothing is planned, no statement is sent, and nothing is stamped.
 */
function refuseRemoteMediaColumnMove(): never {
  const err = new Error(
    'Planning the ADR-0104 media column move is not supported by the Turso REMOTE transport ' +
    '(this datasource\'s transport mode is `remote`), so this driver cannot say which single-value ' +
    'media columns the database holds or how their values are encoded. The planner reads the ' +
    'physical columns through the SQL driver\'s Knex connection, which remote mode does not have: ' +
    'every statement goes to the remote database through the libSQL client instead. The objects it ' +
    'walks are the ones the SQL driver\'s own schema sync registers, and remote mode registers its ' +
    'objects another way. Answering from them would report "nothing to move" for every remote ' +
    'database, whatever media columns it holds, so the call refuses: nothing was planned and nothing ' +
    'ran. The call is spelled correctly and `SqlDriver` declares it, so this is a capability gap of ' +
    'the remote transport rather than a mistake in the request, which is why it answers ' +
    'NOT_IMPLEMENTED/501 and not a 400. In remote mode this driver keeps these columns on the JSON ' +
    'encoding: it writes each file id as a JSON string and reads it back as the id, and it does not ' +
    'read the record of a completed column move.',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
}

// ── Remote inherited members: answered here or refused, never by accident ────

/**
 * [#20055] The refusal for a `SqlDriver` member the REMOTE face cannot answer,
 * in the envelope and the shape of {@link refuseRemoteDriftDetection} and
 * {@link refuseRemoteMediaColumnMove}: the operation, what the caller cannot
 * have, why this face cannot give it, the 501 rationale, and where the answer
 * does exist.
 *
 * # The defect this closes
 *
 * `TursoDriver extends SqlDriver`, so every public member the class does not
 * redeclare runs the Knex implementation on the remote face too. Remote mode
 * builds that Knex with no connection (#20054), so those members either
 * failed with knex's `Unable to acquire a connection`, which reads as a
 * connectivity fault rather than a capability gap, or answered from state no
 * remote door fills. Measured on a remote face over a libSQL `file:` client
 * holding the rows a local control answered from: `introspectSchema()`,
 * `findWithWindowFunctions()` and `rotateShards()` failed that way;
 * `explain()` / `analyzeQuery()` resolved with the LOCAL compiler's statement
 * and an error in place of a plan; `applyMigrationEntries()` resolved with a
 * destructive entry its caller had allowed reported `skipped`; `getKnex()`
 * handed out an instance that cannot run a statement. Each member is now
 * either answered on this face or refused through here, and
 * {@link REMOTE_FACE_ANSWERS} is the complete list, pinned against
 * `SqlDriver`'s public members.
 *
 * # Route or refuse
 *
 * A member with a real remote answer goes to the transport. A member whose
 * remote answer would need a second copy of a Knex arm (a compiler, or the
 * SQLite introspection readers) is refused. The reason for each is in its
 * message and at its override. `NOT_IMPLEMENTED` / 501 is a
 * {@link StandardErrorCode} member, so there is no new code.
 */
function refuseRemoteInheritedMember(
  operation: string,
  consequence: string,
  detail: string,
  alternative: string,
): never {
  const err = new Error(
    `${operation} is not supported by the Turso REMOTE transport (this datasource's transport ` +
    `mode is \`remote\`), so ${consequence} ${detail} The call is spelled correctly and ` +
    '`SqlDriver` declares it, so this is a capability gap of the remote transport rather than a ' +
    `mistake in the request, which is why it answers NOT_IMPLEMENTED/501 and not a 400. ${alternative}`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
}

// ── Federated objects on the remote face ─────────────────────────────────────

/**
 * [#20107] The refusal for a federated object whose `external.columnMap`
 * renames a column, on any REMOTE data door.
 *
 * # Why the table is answered and the column map is refused
 *
 * The two halves of an ADR-0015 binding reach the local face through one
 * registration, `SqlDriver.registerExternalObject`, and are read there in two
 * different places. The TABLE (`external.remoteName`) is read wherever a
 * statement is built, which on this face is one argument per data door:
 * {@link TursoDriver.remoteTableFor} hands it to `RemoteTransport`, and every
 * door now answers from the mapped table. The COLUMN map is read inside the
 * local compiler itself. `SqlDriver` translates each WHERE and ORDER BY key and
 * each write key to the remote column, and keeps the type coercion keyed by the
 * local field. `RemoteTransport` compiles its own WHERE, projection, ORDER BY,
 * aggregate and write statements and addresses every column by field name. So
 * this face could reach the right table and still name columns it does not
 * have. Measured on the remote face with the table resolved and the map
 * ignored, a filter on a renamed field answered an empty list: the transport
 * then read the backend's `no such column` as "no rows". A write failed with the
 * backend's own error. (Since #20424 that read is refused `INVALID_FILTER` /
 * 400 instead, which is loud but still wrong for a field the author declared:
 * the refusal below stays the answer.)
 *
 * Translating the map here would be a second copy of the local compiler's
 * column rule inside the transport's compiler. That is the second
 * implementation ADR-0053 D-A1 exists to prevent, so it is not written. Until
 * it is, the object is refused before any statement is built. An empty answer
 * that is really a missing column is the shape a caller cannot see.
 *
 * # Only a map that renames something
 *
 * An entry whose remote column equals its local field is a no-op on the local
 * face as well: `formatOutput` skips it and the column resolver answers the
 * same name. Refusing it would refuse a binding this face serves correctly, so
 * it is not refused.
 *
 * # Why NOT_IMPLEMENTED / 501
 *
 * The binding is spelled correctly, `@objectstack/spec` declares it, and the
 * local and embedded-replica faces of this driver honour it. The gap is this
 * transport's, which is the class this file answers with 501 everywhere else
 * ({@link refuseRemoteInheritedMember}). `NOT_IMPLEMENTED` is a
 * {@link StandardErrorCode} member, so there is no new code.
 */
function refuseRemoteColumnMap(object: string, door: string, renamed: string[]): never {
  const err = new Error(
    `\`${door}()\` on object "${object}" is not supported by the Turso REMOTE transport (this ` +
    `datasource's transport mode is \`remote\`): the object's \`external.columnMap\` renames ` +
    `field(s) [${renamed.join(', ')}] to other remote columns, and this transport does not ` +
    'translate that map. It builds its own statements and addresses every column by the field ' +
    'name, so a filter on a renamed field would read a column the remote table does not have, ' +
    'and a write would name one. Nothing was read or written. The object\'s remote table ' +
    '(`external.remoteName`) is honoured on this face; only the column translation is missing. ' +
    'The binding is spelled correctly and the local and embedded-replica faces of this driver ' +
    'translate it, so this is a capability gap of the remote transport rather than a mistake in ' +
    'the request, which is why it answers NOT_IMPLEMENTED/501 and not a 400. Use the local or ' +
    'embedded-replica transport for an object whose remote columns are renamed, or name the ' +
    'fields after the remote columns and drop the renaming entries.',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
}

/** The sentence the Knex-bound refusals below share. */
const REMOTE_HAS_NO_KNEX_CONNECTION =
  'Remote mode builds the SQL driver\'s Knex with no connection and sends every statement to the ' +
  'remote database through the libSQL client instead.';

// ── The tenant scope on the remote face ──────────────────────────────────────

/**
 * [#21226] What Knex's SQLite compiler answers for the bare probe
 * {@link TursoDriver.remoteTenantScope} hands the tenant-scope chokepoint:
 * `select *` when the chokepoint added nothing (no tenant context, or no
 * tenant column), and `select * where <predicate>` when it scoped the call.
 */
const REMOTE_SCOPE_PROBE_UNSCOPED = 'select *';
const REMOTE_SCOPE_PROBE_PREFIX = 'select * where ';

/**
 * [#21226] The refusal for a tenant-scoped remote call whose scope compiled to
 * a shape {@link TursoDriver.remoteTenantScope} does not read: anything beside
 * `where` terms (a limit, an order, a join), or a statement that does not open
 * with the probe's own prefix. Unreachable while `SqlDriver.applyTenantScope`
 * only adds a `where` group. It exists so a change there fails a call instead
 * of sending it without the scope, or with a fragment that is not a predicate:
 * fail toward isolation, never toward exposure.
 */
function refuseUnreadableRemoteTenantScope(object: string): never {
  const err = new Error(
    `The tenant scope for "${object}" could not be put on the remote statement: the SQL driver's ` +
      'tenant-scope chokepoint compiled to a shape the remote face does not read, so the call is ' +
      'refused rather than sent without the scope. This is a defect in the driver, not in the request.',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INTERNAL_ERROR;
  err.status = 500;
  throw err;
}

/** How the REMOTE face answers one public `SqlDriver` member. */
export type RemoteFaceAnswer =
  /** `TursoDriver` redeclares it, and its remote arm answers from the remote database or from this face's own state. */
  | 'remote'
  /** `TursoDriver` redeclares it, and its remote arm refuses with `NOT_IMPLEMENTED` / 501. */
  | 'refused'
  /** Not redeclared: the `SqlDriver` member's answer is already true on this face. Each such row says why. */
  | 'inherited';

/**
 * [#20055] Every public member of `SqlDriver`, and how the REMOTE face answers
 * it. The `satisfies` clause is the pin: `keyof SqlDriver` is exactly the
 * public instance members, so a member added to `SqlDriver` fails this
 * package's typecheck and build until its remote answer is decided here. It
 * cannot reach remote callers by inheritance unnoticed.
 * `turso-remote-inherited-members.test.ts` holds each row to the code: a
 * `remote` or `refused` row is redeclared by `TursoDriver`, an `inherited` row
 * is not, and every row that was inherited before #20055 answers as written.
 */
export const REMOTE_FACE_ANSWERS = {
  // IDataDriver identity and declarations.
  name: 'remote',
  version: 'remote',
  supports: 'remote',
  // Lifecycle.
  connect: 'remote',
  checkHealth: 'remote',
  disconnect: 'remote',
  // CRUD, counting and raw execution: the remote transport.
  find: 'remote',
  findOne: 'remote',
  create: 'remote',
  update: 'remote',
  upsert: 'remote',
  delete: 'remote',
  bulkCreate: 'remote',
  bulkUpdate: 'remote',
  bulkDelete: 'remote',
  updateMany: 'remote',
  deleteMany: 'remote',
  count: 'remote',
  aggregate: 'remote',
  execute: 'remote',
  // `SELECT DISTINCT`, compiled by the transport. A tenant-scoped call is
  // refused: this door's statement carries no tenant scope (the other read
  // doors carry it since #21226).
  distinct: 'remote',
  // Transactions: none on this face (ADR-0119 D1).
  beginTransaction: 'refused',
  commit: 'refused',
  rollback: 'refused',
  // Deprecated aliases: they call `this.commit` / `this.rollback`, which refuse.
  commitTransaction: 'inherited',
  rollbackTransaction: 'inherited',
  // Knex-only reads.
  findWithWindowFunctions: 'refused',
  analyzeQuery: 'refused',
  // Calls `this.analyzeQuery`, which refuses.
  explain: 'inherited',
  introspectSchema: 'refused',
  getKnex: 'refused',
  // Schema doors.
  syncSchema: 'remote',
  dropTable: 'remote',
  initObjects: 'remote',
  // The `PRAGMA incremental_vacuum` the local face issues, sent to the remote
  // database.
  reclaimSpace: 'remote',
  // `false`: no remote schema door rotates, so the lifecycle service takes its
  // age-based reap instead.
  supportsRotation: 'remote',
  rotateShards: 'refused',
  // In-memory bookkeeping with no Knex; the remote schema doors call it
  // themselves (`registerRemoteFieldMetadata`). Every remote data door reads
  // the table it records (`remoteTableFor`), as `getBuilder` does locally.
  registerExternalObject: 'inherited',
  // In-memory bookkeeping with no Knex, by its own contract (`skipSchemaSync`).
  registerObjectMetadata: 'inherited',
  // Deferred DDL: arming is refused, so nothing is ever deferred here, and the
  // three inherited members answer that truthfully without reaching Knex.
  setDeferredDdl: 'refused',
  deferredSchemaObjectCount: 'inherited',
  previewDeferredSchemaWork: 'inherited',
  flushDeferredSchemaDdl: 'inherited',
  // `{ created: 0, existing: 0 }`: the remote doors count nothing, and both
  // counts at zero is the `IDataDriver` contract's "cannot say".
  getSchemaSyncStats: 'inherited',
  // Drift and migration: every read and write goes through Knex.
  detectManagedDrift: 'refused',
  applyMigrationEntries: 'refused',
  planMediaColumnMove: 'refused',
  // `false`, the method's own "not taken" answer: only the Knex `initObjects`
  // asks the resolver, so on this face it would never be asked.
  setFileColumnsMovedResolver: 'remote',
  // `false`: remote mode opens no in-memory database.
  sqliteOpenedEmptyInMemory: 'inherited',
  // `'sqlite'`: libSQL speaks SQLite, and `execute()` sends what a caller
  // compiles for it to the remote database.
  dialectName: 'inherited',
  // Pure functions of the registries the remote arms read themselves.
  temporalFilterValue: 'inherited',
  temporalFilterColumnSql: 'inherited',
} as const satisfies Record<keyof SqlDriver, RemoteFaceAnswer>;

// ── Remote operation timeout ─────────────────────────────────────────────────

/**
 * The failure a remote operation raises when `TursoDriverConfig.timeout`
 * closes on it — the ADR-0112 envelope (`code` + `status`), so a caller and the
 * REST layer read a stalled Turso endpoint as a gateway timeout rather than as
 * the platform's bare `TimeoutError` DOMException or an anonymous `Error`.
 */
function remoteOperationTimedOut(what: string, timeoutMs: number): Error & { code: string; status: number } {
  const err = new Error(
    `Turso ${what} did not complete within the configured timeout of ${timeoutMs} ms ` +
      `(\`TursoDriverConfig.timeout\`): the remote did not answer inside the window, so the ` +
      `operation was abandoned rather than left hanging. Raise \`timeout\`, or omit it for no bound.`,
  ) as Error & { code: string; status: number };
  err.code = StandardErrorCode.enum.TIMEOUT;
  err.status = 504;
  return err;
}

/**
 * The `fetch` handed to `@libsql/client`'s HTTP transport when `timeout` is
 * set.
 *
 * Why this seam and not `Config.timeout`: measured against
 * `@libsql/client@0.18.0` (`@libsql/core@0.18.0`), that option is the BUSY
 * timeout for lock contention on local `file:` databases — its own docblock
 * says "remote clients ignore it" — so forwarding the driver's key to it would
 * have left remote mode exactly as inert as before while giving replica mode a
 * different setting under the same name. `Config.fetch` is the one seam the
 * remote transport exposes: the hrana HTTP client routes EVERY request through
 * it (the protocol-version probe included), and the WebSocket transport takes
 * no such hook at all — which is why a `wss://` / `ws://` url with a window is
 * refused at construction ({@link refuseWebSocketTimeout}) instead of being
 * handed a `fetch` that nothing reads.
 *
 * A signal already on the request is honoured alongside the window
 * (`AbortSignal.any`), so a caller's own abort keeps working; only an abort the
 * window itself raised is translated into the timeout envelope.
 */
function fetchBoundedBy(timeoutMs: number): typeof globalThis.fetch {
  return async (input, init) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const upstream = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = upstream ? AbortSignal.any([upstream, deadline]) : deadline;
    try {
      return await globalThis.fetch(input, { ...init, signal });
    } catch (error) {
      if (deadline.aborted) throw remoteOperationTimedOut('remote request', timeoutMs);
      throw error;
    }
  };
}

/**
 * Await `operation` for at most `timeoutMs`, rejecting with the timeout
 * envelope when the window closes first. The operation itself is not
 * cancelled — the replica arm's `sync()` runs in the native binding, which
 * offers no cancellation — it is simply no longer what the caller waits on.
 * `Promise.race` keeps a handler on it, so a late rejection is observed rather
 * than unhandled.
 */
async function boundedBy<T>(operation: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(remoteOperationTimedOut(what, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** The configured window, or `undefined` for "no bound" — `0` and unset alike. */
function timeoutWindow(config: TursoDriverConfig): number | undefined {
  return config.timeout && config.timeout > 0 ? config.timeout : undefined;
}

/**
 * Whether a remote url rides `@libsql/client`'s WebSocket transport.
 *
 * The client's routing switch matches the literal lowercase (`lib-esm/node.js`:
 * `wss` / `ws` → its ws client, `https` / `http` → its HTTP client), but it
 * never sees the url as the author spelled it: the node entry is
 * `_createClient(expandConfig(config, true))`, and `expandConfig` has ALREADY
 * lowercased the scheme by then — `@libsql/core@0.18.0`,
 * `lib-esm/config.js`: `const originalUriScheme = uri.scheme.toLowerCase();`.
 * Executed against that version:
 * `expandConfig({ url: 'WSS://db.example.turso.io' }, true).scheme === 'wss'`
 * and `'Ws://127.0.0.1:8080'` → `'ws'`; the control that makes those a reading
 * is `'LIBSQL://…'` → `'https'`, the same call answering something other than
 * the input's own letters. (`libsql://` is expanded before the switch too, and
 * the entry this driver imports expands it to HTTPS.)
 *
 * ⇒ Case is folded HERE so this predicate agrees with the client it hands the
 * url to. Reading the switch alone says an uppercase `WSS://` cannot reach the
 * WebSocket arm; it can, and a window beside it would be accepted and never
 * delivered — the corner {@link refuseWebSocketTimeout} exists to close. Only
 * the comparison is folded: the url itself is passed on exactly as authored, so
 * the refusal message echoes the operator's own spelling and stays greppable
 * against their config.
 *
 * `TursoDriver.detectMode` reads the scheme through the same fold
 * ({@link startsWithScheme}), so the two readers of one url agree: an uppercase
 * `WSS://` with no `mode` is detected as remote and meets this refusal too. It
 * used to be matched case-sensitively there and fell through to `'local'` on a
 * private `:memory:` engine; that fall-through was argued and removed on its
 * own (see {@link localEngineDefect}), not folded in here as a tidy-up.
 */
function ridesWebSocketTransport(url: string): boolean {
  return startsWithScheme(url, 'wss://') || startsWithScheme(url, 'ws://');
}

/**
 * `timeout` beside a `wss://` / `ws://` url — refused at construction.
 *
 * On those two schemes the window reaches nothing. `@libsql/client@0.18.0`'s
 * WebSocket client (`lib-esm/ws.js` → `hrana.openWs(url, authToken)`) consults
 * neither `Config.fetch` — the seam {@link fetchBoundedBy} rides — nor any
 * timeout option of its own: over `@libsql/hrana-client@0.10.0`'s
 * `lib-esm/ws/*.js` and `lib-esm/index.js` a `timeout` grep returns zero,
 * while a `fetch` grep over `lib-esm/http/` finds the call sites — the control
 * that makes the zero a reading. `Config.timeout` is not a seam either: it is
 * the busy timeout for local `file:` lock contention, which "remote clients
 * ignore".
 *
 * ADR-0049 enforce-or-remove: a declared setting that changes nothing is worse
 * than absent, and "documented as not bounded" was still a `timeout: 30000`
 * that an author reads as a bound. Accepting the pair silently was the defect;
 * the refusal turns it into a loud one and changes no wire behaviour — routing
 * a `wss://` url over HTTP because `timeout` is set would change the transport
 * behind the author's back, and is deliberately NOT done here.
 *
 * Raised BEFORE `super()`, beside `detectMode`: ahead of the Knex base and of
 * any `@libsql/client`, so it cannot be reached with a half-built driver, and
 * a boot that would have run unbounded fails at the one constructor every
 * loader calls (`buildTursoDriverConfig` → `new TursoDriver`).
 *
 * Scoped to REMOTE mode: on the replica arm `sync()` is bounded, so the key is
 * not inert there. (A `wss://` url never reaches that arm: a remote url beside
 * `syncUrl` is refused on its own grounds by `localEngineDefect`, whatever
 * `timeout` says, and a replica's url is always a local `file:`.) `timeout: 0` is
 * the documented "no bound", asks for nothing, and is not refused. A
 * caller-supplied `client` is not consulted — its transport is not the driver's
 * to know; the scheme of the `url` beside it is what decides here.
 *
 * ⛔ No internal issue id in the message: it reaches an operator's boot log and
 * Studio's datasource form. The ids live in the comments beside it.
 */
function refuseWebSocketTimeout(url: string, timeoutMs: number): never {
  const scheme = url.slice(0, url.indexOf('://') + '://'.length);
  const err = new Error(
    `\`TursoDriverConfig.timeout\` (${timeoutMs} ms) is set beside a \`${scheme}\` url, and on that ` +
      `scheme it bounds nothing: a \`${scheme}\` url rides @libsql/client's WebSocket transport, which ` +
      `takes no fetch and no timeout option (measured against @libsql/client 0.18.0), so the window would ` +
      `be accepted and never delivered. Either omit \`timeout\` and run this remote unbounded, or keep it ` +
      `and spell the url \`libsql://\` or \`https://\` — the client resolves \`libsql://\` to HTTPS — ` +
      `where every request IS bounded and a stalled endpoint fails as TIMEOUT / 504.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.VALIDATION_ERROR;
  err.status = 400;
  throw err;
}

/**
 * `timeout` beside a caller-supplied `client` in REMOTE mode — refused at
 * construction.
 *
 * On the HTTP arm the window is not a driver-side wrapper around each call: it
 * is installed once, as the `fetch` this driver hands `@libsql/client` when it
 * BUILDS the client ({@link createRemoteClient} — the single site that spreads
 * `{ fetch: fetchBoundedBy(timeoutMs) }`). A pre-configured `client` arrives
 * with its transport already constructed, and `Config.fetch` is read at
 * `createClient()` time and kept inside the hrana transport; there is no
 * after-the-fact seam on a built client for the driver to reach (the same
 * reading that ruled out option (b) on the filing card). So both remote sites
 * that take the supplied client — `connect()` and the transport's lazy connect
 * factory, which spell the choice identically as
 * `this.tursoConfig.client ?? (await this.createRemoteClient())` — skip the one
 * place the window is installed, and every request runs unbounded.
 *
 * ADR-0049 enforce-or-remove: `timeout`'s own docblock promised "every request
 * the client's HTTP transport makes", and `client`'s said nothing about the key
 * ceasing to apply, so this composition was a declared setting that changed
 * nothing — accepted silently, which is the defect. Refusing it says so at the
 * one constructor every loader calls and changes no wire behaviour.
 *
 * ⛔ NOT done here, deliberately: wrapping or re-creating the caller's client so
 * the window rides after all. A client handed in for "custom caching,
 * connection pooling, or testing" is the caller's object; replacing its
 * transport because `timeout` is set would discard exactly the configuration
 * they built it to carry, behind their back — the same reason a `wss://` url is
 * not silently re-routed over HTTP.
 *
 * Scoped to REMOTE mode. On the replica arm a supplied `client` keeps the key
 * live: `sync()` — the one remote operation that arm performs — is bounded by
 * {@link boundedBy} around the awaited promise, whatever client is in use, so
 * the key is not inert there and the pair is accepted. `timeout: 0` and unset
 * are the documented "no bound", ask for nothing, and are not refused.
 *
 * Ordered AFTER {@link refuseWebSocketTimeout} on purpose: that refusal already
 * takes every `wss://` / `ws://` url with a window — its own contract records
 * that "a caller-supplied `client` is not consulted" — so this one fires only
 * on compositions the constructor accepts today, and no configuration changes
 * which message it gets.
 *
 * ⛔ No internal issue id in the message: it reaches an operator's boot log and
 * Studio's datasource form. The ids live in the comments beside it.
 */
function refuseSuppliedClientTimeout(timeoutMs: number): never {
  const err = new Error(
    `\`TursoDriverConfig.timeout\` (${timeoutMs} ms) is set beside \`TursoDriverConfig.client\` in remote ` +
      `mode, and on that pair it bounds nothing: the window is the \`fetch\` this driver hands ` +
      `@libsql/client while CREATING the remote client, and a pre-configured client is already built — ` +
      `its transport is not the driver's to replace (measured against @libsql/client 0.18.0), so the ` +
      `window would be accepted and never delivered. Either drop \`client\` and let the driver create the ` +
      `remote client, where every request IS bounded and a stalled endpoint fails as TIMEOUT / 504, or ` +
      `keep \`client\` and omit \`timeout\`, building the bound into that client yourself when you call ` +
      `\`createClient({ fetch })\`. Replica mode is unaffected: there \`sync()\` is bounded whatever ` +
      `client is in use.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.VALIDATION_ERROR;
  err.status = 400;
  throw err;
}

// ── Sync keys the driver would ignore — refused, in the contract's own words ──

/**
 * [#20200] `syncUrl` under a forced `mode: 'remote'` — refused at construction.
 *
 * Remote mode sends every read and write straight to `url` through the client
 * {@link createRemoteClient} builds, and that builder forwards no `syncUrl`; no
 * sync interval is started on the remote arm either. Measured on the built
 * driver before this refusal (`url: 'libsql://…'` or a `file:` url, forced
 * `mode: 'remote'`, `syncUrl`, `sync: { intervalSeconds: 60 }`): it constructed
 * and connected, `isSyncEnabled()` answered `true`, no interval started, and
 * `sync()` rejected with `SYNC_NOT_SUPPORTED` (`SyncNotSupported("File")` on
 * the `file:` url). A declared replica the runtime never runs, reported as
 * enabled: the declared-but-not-enforced shape ADR-0049 does not ship.
 *
 * Only a FORCED remote mode reaches this: a remote url beside `syncUrl` with no
 * `mode` is classified `replica` by {@link TursoDriver.detectMode} and refused
 * on its own grounds by `localEngineDefect`.
 *
 * ⚠️ The text is `@objectstack/spec`'s `TursoConfigSchema` refusal on `syncUrl`,
 * byte for byte, so a datasource hears the same sentence at authoring and at
 * boot. The spec keeps it module-local and this package does not grow the
 * spec's published surface for one string (the ruling on #20200), so it is a
 * copy here, held equal to the schema's issue by
 * `spec/turso-config-constructor-parity.test.ts`. Edit it there first, then
 * here, never here alone.
 */
const REMOTE_MODE_SYNC_URL_REFUSAL =
  "`syncUrl` configures an embedded replica, but `mode: 'remote'` sends every read and write " +
  'straight to `url` and builds no replica: the turso driver refuses this configuration when ' +
  'it starts. For a remote database, drop `syncUrl` (and `sync`). For an embedded replica, drop ' +
  "`mode` and point `url` at a local file beside `syncUrl`: `url: 'file:./data/replica.db'`.";

/**
 * [#20200] `sync` with no `syncUrl` — refused at construction, in every mode.
 *
 * `sync` configures the embedded-replica sync, and `connect()` reads it only
 * inside the `syncUrl` arm: without `syncUrl` no sync client is built, no
 * interval is started, and `sync()` returns without doing anything, whatever
 * `intervalSeconds` / `onConnect` say (measured on the built driver in local,
 * forced-replica and remote mode). Same ADR-0049 shape as the `syncUrl` refusal
 * above.
 *
 * ⚠️ The text is `@objectstack/spec`'s `TursoConfigSchema` refusal on `sync`, byte
 * for byte, held equal by the same parity test. Edit it there first.
 */
const SYNC_WITHOUT_SYNC_URL_REFUSAL =
  '`sync` configures embedded-replica syncing, which only runs when `syncUrl` names the ' +
  'remote to replicate from. Set `syncUrl`, or remove `sync` — on its own it configures ' +
  'nothing.';

/**
 * [#20437] A forced `mode: 'replica'` with no `syncUrl` — refused at construction.
 *
 * An embedded replica is a local file kept in sync with the remote named in
 * `syncUrl`. Forced with no `syncUrl` (or an empty one), the driver used to
 * build it with `transportMode = 'replica'` and then run it as a plain local
 * database: `connect()` builds the sync client only inside its `syncUrl` arm,
 * so no sync ever ran, no interval started, `isSyncEnabled()` answered `false`
 * and `sync()` returned without doing anything, while reads and writes went to
 * the local file (measured on the built driver before this refusal, with and
 * without `sync: { intervalSeconds: 60 }`). A declared mode the runtime never
 * runs: the declared-but-not-enforced shape ADR-0049 does not ship. The
 * datasource is not re-classified as local instead, for the same reason
 * `localEngineDefect` gives: that would accept the declaration and ignore it.
 *
 * Only a FORCED replica reaches this: with no `mode`, {@link TursoDriver.detectMode}
 * answers `replica` only beside a `syncUrl`. A forced replica on a url the local
 * engine cannot open met `localEngineDefect` first, and one with `sync` met the
 * `sync` refusal first, so this fires on a `file:` url alone.
 *
 * ⚠️ The text is `@objectstack/spec`'s `TursoConfigSchema` refusal on `mode`,
 * byte for byte, held equal by `spec/turso-config-constructor-parity.test.ts`.
 * Edit it there first.
 */
const REPLICA_MODE_WITHOUT_SYNC_URL_REFUSAL =
  "`mode: 'replica'` makes this datasource an embedded replica, a local file kept in sync with " +
  'the remote named in `syncUrl`, but no `syncUrl` is set: nothing would ever sync, so it would ' +
  'run as a plain local database that never replicates — the turso driver refuses this ' +
  'configuration when it starts. For an embedded replica, name the remote in `syncUrl` beside ' +
  "the local file: `url: 'file:./data/replica.db'` with `syncUrl` set to the `libsql://` or " +
  "`https://` Turso endpoint. For a plain local database, drop `mode: 'replica'`.";

/**
 * [#20586] A forced `mode: 'local'` beside a `syncUrl` — refused at construction.
 *
 * The same defect as the replica refusal above, the other way round. The
 * driver used to build it with `transportMode = 'local'` and then run it as an
 * embedded replica: `connect()` builds the sync client whenever `syncUrl` is
 * set in a non-remote mode, whatever `mode` says. Measured on this package's
 * source before this refusal (a `file:` url, forced `mode: 'local'`,
 * `syncUrl`, `sync: { intervalSeconds: 1 }`, a sync-counting client): one sync
 * on connect, `isSyncEnabled()` answered `true`, the interval started and
 * synced again — exactly what the same config with no `mode` (a replica) did,
 * while the same `file:` url with no `syncUrl` synced nothing. A declared mode
 * the runtime ignores: the declared-but-not-enforced shape ADR-0049 does not
 * ship. The datasource is not honoured as local by skipping the sync instead:
 * that would ignore a declared `syncUrl`, the same defect with the keys
 * swapped.
 *
 * Only a FORCED local mode reaches this: with no `mode`,
 * {@link TursoDriver.detectMode} answers `replica` beside a `syncUrl`. A forced
 * local mode on a url the local engine cannot open met `localEngineDefect`
 * first, so this fires on a `file:` url or `:memory:`. An empty `syncUrl` is
 * unset, as everywhere in this driver, and is not refused.
 *
 * ⚠️ The text is `@objectstack/spec`'s `TursoConfigSchema` refusal on `mode`
 * for this shape, byte for byte, held equal by
 * `spec/turso-config-constructor-parity.test.ts`. Edit it there first.
 */
const LOCAL_MODE_WITH_SYNC_URL_REFUSAL =
  "`mode: 'local'` makes this datasource a plain local database, but `syncUrl` names a remote to " +
  'replicate from: the database would still be synced with that remote as an embedded replica, ' +
  'so the declared local mode would be ignored — the turso driver refuses this configuration ' +
  'when it starts. For an embedded replica, drop `mode` and keep `syncUrl` beside the local file: ' +
  "`url: 'file:./data/replica.db'`. For a plain local database, drop `syncUrl` (and `sync`).";

/**
 * Throw one of the four sync-key refusals above as the ADR-0112 envelope.
 *
 * Raised BEFORE `super()`, AFTER the three refusals above it in the
 * constructor, so no configuration those already refuse changes which message
 * it gets. ⛔ The messages carry no url and no internal issue id: they reach an
 * operator's boot log and Studio's datasource form.
 */
function refuseIgnoredSyncKey(message: string): never {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.VALIDATION_ERROR;
  err.status = 400;
  throw err;
}

// ── The local engine: a file, or a declared `:memory:` — never a silent one ───

/**
 * Does `url` begin with `prefix` (a lowercase scheme, with its `://` or `:`),
 * comparing the scheme's letters in any case?
 *
 * A url's scheme is case-insensitive, and `@libsql/client` reads it that way:
 * `@libsql/core@0.18.0` `lib-esm/config.js` routes on
 * `uri.scheme.toLowerCase()`. Executed against that version, `expandConfig`
 * answers `https` for `LIBSQL://…`, `wss` for `Wss://…` and `file` for
 * `FILE:./x.db`, and `createClient` opens each of them. Every reader of the url
 * in this driver compares through here, so none of them classifies a url
 * differently from the client it is handed to. Only the comparison folds: the
 * url itself is passed on exactly as authored.
 */
function startsWithScheme(url: string, prefix: string): boolean {
  return url.slice(0, prefix.length).toLowerCase() === prefix;
}

/**
 * The url prefixes {@link TursoDriver.detectMode} classifies as remote — one
 * list for the classifier and for {@link localEngineDefect}, so the refusal can
 * never disagree with it about which urls are remote. Matched in any letter
 * case, through {@link startsWithScheme}.
 */
const REMOTE_URL_PREFIXES = ['libsql://', 'https://', 'http://', 'wss://', 'ws://'] as const;

function hasRemotePrefix(url: string): boolean {
  return REMOTE_URL_PREFIXES.some((prefix) => startsWithScheme(url, prefix));
}

/** A `file:` url, its scheme matched in any letter case: the local engine opens its path. */
function isFileUrl(url: string): boolean {
  return startsWithScheme(url, 'file:');
}

/**
 * Does this url name an in-memory database, by `@libsql/client`'s own reading?
 *
 * `@libsql/core@0.18.0` `lib-esm/config.js` expands a bare `:memory:` to
 * `file::memory:`, and `isInMemoryConfig` then answers true for a `file` scheme
 * whose path is `:memory:` or starts with `:memory:?`. Mirrored here so the
 * replica refusal below covers exactly the urls the client's own embedded
 * replica refuses.
 */
function namesInMemoryDatabase(url: string): boolean {
  if (url === ':memory:') return true;
  if (!isFileUrl(url)) return false;
  const path = url.slice('file:'.length);
  return path === ':memory:' || path.startsWith(':memory:?');
}

type LocalEngineDefect = 'remote-url' | 'unrecognised-url' | 'in-memory-replica';

/**
 * Which way, if any, a LOCAL or REPLICA configuration would leave the local
 * engine with nothing durable behind it.
 *
 * Both non-remote arms run every read and write through the inherited Knex +
 * better-sqlite3 engine, which can open exactly two things:
 * {@link TursoDriver.toKnexConfig} hands it the path of a `file:` url, or
 * `:memory:`. Anything else reached that method's last arm, which handed it
 * `:memory:`: a private in-memory database. The writes succeed and read back,
 * so from outside the datasource looks healthy, and all of it is gone on
 * restart. Measured on `main` @ `2c1011b01b`, a `create` then a `find` then a
 * fresh driver on the same config:
 *
 * ```
 * libsql:// + syncUrl (sync.onConnect: false) -> replica, knex :memory:, 1 row, 0 after restart
 * https:// / wss:// + syncUrl (same)          -> same
 * libsql:// + mode: 'replica' (no syncUrl)    -> replica, knex :memory:, 1 row, 0 after restart
 * libsql:// + mode: 'local'                   -> local,   knex :memory:, 1 row, 0 after restart
 * :memory: + syncUrl + a supplied client      -> replica, knex :memory:, 1 row, 0 after restart
 * file: + syncUrl (control)                   -> replica, knex <the file>, 1 row, 1 after restart
 * ```
 *
 * With the driver building its own client and the default `sync.onConnect`,
 * the first two rows failed at `connect()` rather than silently, but on
 * libsql's error, not this driver's: an http/ws client's `sync()` throws
 * `SYNC_NOT_SUPPORTED`, and a `:memory:` url beside `syncUrl` throws
 * `URL_INVALID` ("Embedded replica must use file for local db"). So:
 *
 * - `'remote-url'`: a url {@link TursoDriver.detectMode} would call remote, in
 *   a local or replica mode. `@libsql/client@0.18.0` builds no embedded replica
 *   for it: `lib-esm/node.js` routes `http`/`https` to its HTTP client and
 *   `ws`/`wss` to its WebSocket client, and `syncUrl` is read by
 *   `lib-esm/sqlite3.js` alone (a `syncUrl` grep over `http.js` and `ws.js`
 *   returns zero, while `authToken` returns six in each: the control that
 *   makes the zero a reading).
 * - `'unrecognised-url'`: a url that is none of `file:`, `:memory:` or a
 *   remote url, such as a bare path (`./data/app.db`) or an unsupported
 *   scheme. With no `mode`, {@link TursoDriver.detectMode} used to answer
 *   `'local'` for it, matching remote schemes case-sensitively too, so an
 *   uppercase `LIBSQL://` landed here as well; a forced `mode: 'local'` sent it
 *   the same way (an uppercase `FILE:` too). Measured on `main` @ `a7581b326`,
 *   same probe:
 *
 *   ```
 *   LIBSQL://… (no mode)             -> local, 1 row, 0 after restart
 *   FILE:<tmp>/x.db (no mode)        -> local, 1 row, 0 after restart, file never created
 *   ./<dir>/app.db (no mode)         -> local, 1 row, 0 after restart, file never created
 *   <tmp>/app.db (no mode)           -> local, 1 row, 0 after restart, file never created
 *   ./<dir>/app.db + mode: 'local'   -> local, 1 row, 0 after restart, file never created
 *   file:<tmp>/x.db (control)        -> local, 1 row, 1 after restart, file created
 *   ```
 *
 *   The scheme is now matched in any letter case (see {@link startsWithScheme}),
 *   so an uppercase remote url is remote, as the client routes it. What is left
 *   has no durable reading at all: `@libsql/client@0.18.0` refuses a bare path
 *   as `URL_INVALID` ("not in a valid format") and an unsupported scheme as
 *   `URL_SCHEME_NOT_SUPPORTED`. Treating a bare path as `file:` instead was
 *   rejected: that invents a url spelling the client refuses, so the same
 *   string would open a file as a local database and fail as a replica.
 * - `'in-memory-replica'`: a replica on a url `@libsql/client` reads as
 *   in-memory. A replica IS a local file kept in sync with the remote; on
 *   anything else nothing the sync brings down can reach the engine the reads
 *   go through. The same rule as `@libsql/client`'s own `URL_INVALID` above.
 *
 * Checked in that order, so each configuration meets the one refusal that
 * names its way out.
 */
function localEngineDefect(url: string, mode: 'local' | 'replica'): LocalEngineDefect | undefined {
  if (hasRemotePrefix(url)) return 'remote-url';
  if (url !== ':memory:' && !isFileUrl(url)) return 'unrecognised-url';
  if (mode === 'replica' && namesInMemoryDatabase(url)) return 'in-memory-replica';
  return undefined;
}

/**
 * A local or replica configuration with nothing durable behind its engine,
 * refused at construction. See {@link localEngineDefect} for the measurement.
 *
 * Raised BEFORE `super()`, beside `detectMode`, like the two `timeout`
 * refusals above: ahead of the Knex base and of any `@libsql/client`, at the
 * one constructor every loader calls (`buildTursoDriverConfig` →
 * `new TursoDriver`). Neither loader parses a config schema on the way in, so
 * this is the runtime's only gate for a datasource that bypassed authoring
 * validation.
 *
 * ADR-0049 enforce-or-remove, and AGENTS.md's durability rule (prefer failing
 * to falling back): the configuration asked for a replica, or a local
 * database, and the driver quietly delivered a scratch in-memory one. The
 * refusal changes no wire behaviour. Re-classifying the pair as `remote`
 * instead was rejected: that would accept a declared `syncUrl` and then ignore
 * it, which is the same declared-but-not-enforced shape.
 *
 * ⛔ The url is not echoed, only a remote url's scheme: a url may carry a live
 * `?authToken=` (see `turso-authtoken-url-channel.test.ts`), and this message
 * reaches an operator's boot log and Studio's datasource form. An unrecognised
 * url has no scheme this driver can name, so nothing of it is echoed. ⛔ No
 * internal issue id in the message either, for the same reason. The ids live
 * in the comments beside it.
 */
function refuseNonDurableLocalEngine(
  config: TursoDriverConfig,
  mode: 'local' | 'replica',
  defect: LocalEngineDefect,
): never {
  const arm = mode === 'replica' ? 'an embedded replica' : 'a local database';
  const cause = config.mode ? `\`mode: '${config.mode}'\`` : '`syncUrl`';
  let message: string;
  if (defect === 'remote-url') {
    const scheme = config.url.slice(0, config.url.indexOf('://') + '://'.length);
    const toRemote = config.mode
      ? `drop \`mode\` (a \`${scheme}\` url is detected as remote) or set \`mode: 'remote'\`` +
        (config.syncUrl ? ', and drop `syncUrl`' : '')
      : 'drop `syncUrl` (and `sync`): the url alone sends every read and write to it';
    const toLocal =
      mode === 'replica'
        ? 'For an embedded replica, point `url` at a local file and keep the remote in `syncUrl`: ' +
          "`url: 'file:./data/replica.db'`."
        : "For a local database, point `url` at a file: `url: 'file:./data/app.db'`."
    message =
      `\`TursoDriverConfig.url\` is a remote \`${scheme}\` url, but ${cause} makes this datasource ` +
      `${arm}, which runs every read and write through a local SQLite engine. That engine cannot open ` +
      `a remote url, so it would run on a private in-memory database instead: writes would succeed and ` +
      `read back, then be lost on restart, and none of them would reach the remote. ` +
      (mode === 'replica'
        ? '(@libsql/client builds a plain remote client for a remote url and ignores `syncUrl` beside ' +
          'it, measured against @libsql/client 0.18.0, so there is no embedded replica to sync.) '
        : '') +
      `To use the remote database, ${toRemote}. ${toLocal}`;
  } else if (defect === 'unrecognised-url') {
    const asks = config.mode
      ? `${cause} makes this datasource ${arm}`
      : config.syncUrl
        ? `\`syncUrl\` makes this datasource ${arm}`
        : `With no \`mode\` and no remote scheme, this datasource is ${arm}`;
    // Every key that would still make a remote url a local or replica
    // configuration, so the remote way out is complete as written.
    const keepsItLocal = [
      ...(config.mode ? [`\`mode: '${config.mode}'\``] : []),
      ...(config.syncUrl ? ['`syncUrl` (and `sync`)'] : []),
    ];
    const toRemote =
      'For a remote database, ' +
      (keepsItLocal.length > 0 ? `drop ${keepsItLocal.join(' and ')} and ` : '') +
      'use one of the remote schemes above.';
    const toFile =
      mode === 'replica'
        ? 'For an embedded replica, spell the local path as a `file:` url and ' +
          (config.syncUrl ? 'keep' : 'name') +
          " the remote in `syncUrl`: `url: 'file:./data/replica.db'`."
        : "For a local database file, spell the path as a `file:` url: `url: 'file:./data/app.db'`. " +
          "For a throwaway in-memory database, `url: ':memory:'`.";
    message =
      '`TursoDriverConfig.url` is not a url this driver recognises: it is not `:memory:`, not a ' +
      '`file:` url, and not a remote `libsql://`, `https://`, `http://`, `wss://` or `ws://` url ' +
      `(a scheme matches in any letter case). ${asks}, which runs every read and write through a ` +
      'local SQLite engine that can open only a `file:` url or `:memory:`. On this url it would run ' +
      'on a private in-memory database instead: writes would succeed and read back, then be lost on ' +
      'restart. (@libsql/client refuses such a url itself: a bare path as URL_INVALID, an unsupported ' +
      `scheme as URL_SCHEME_NOT_SUPPORTED, measured against @libsql/client 0.18.0.) ${toFile} ${toRemote}`;
  } else {
    const drop = config.mode
      ? "`mode: 'replica'`" + (config.syncUrl ? ' and `syncUrl`' : '')
      : '`syncUrl` (and `sync`)';
    message =
      `\`TursoDriverConfig.url\` names an in-memory database, so it cannot hold an embedded replica, ` +
      `which ${cause} asks for. A replica is a local FILE kept in sync with the remote named in ` +
      '`syncUrl`. Here the local engine would run on a private in-memory database that no sync ever ' +
      'reaches: writes would succeed and read back, then be lost on restart. @libsql/client refuses ' +
      "an in-memory embedded replica itself. Point `url` at a local file (`url: 'file:./data/replica.db'` " +
      `beside \`syncUrl\`), or drop ${drop} for a plain in-memory local database, which is what the url ` +
      'names: ephemeral by declaration.';
  }
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.VALIDATION_ERROR;
  err.status = 400;
  throw err;
}

// ── Turso Driver ─────────────────────────────────────────────────────────────

/**
 * Turso/libSQL Driver for ObjectStack.
 *
 * Dual-transport architecture:
 *
 * - **Local/Replica modes:** Extends SqlDriver (Knex + better-sqlite3) for
 *   all CRUD, schema, filtering, aggregation — zero duplicated logic.
 * - **Remote mode:** Delegates all operations to RemoteTransport which
 *   uses @libsql/client SDK directly (HTTP/WebSocket). No local SQLite needed.
 *
 * Transport mode is auto-detected from the URL or forced via `config.mode`.
 *
 * @example Local mode
 * ```typescript
 * const driver = new TursoDriver({ url: 'file:./data/app.db' });
 * await driver.connect();
 * ```
 *
 * @example In-memory mode (testing)
 * ```typescript
 * const driver = new TursoDriver({ url: ':memory:' });
 * await driver.connect();
 * ```
 *
 * @example Embedded replica mode
 * ```typescript
 * const driver = new TursoDriver({
 *   url: 'file:./data/replica.db',
 *   syncUrl: 'libsql://my-db-orgname.turso.io',
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 *   sync: { intervalSeconds: 60, onConnect: true },
 * });
 * await driver.connect();
 * ```
 *
 * @example Remote mode (cloud-only)
 * ```typescript
 * const driver = new TursoDriver({
 *   url: 'libsql://my-db-orgname.turso.io',
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 * });
 * await driver.connect();
 * ```
 */
export class TursoDriver extends SqlDriver {
  // IDataDriver metadata
  public override readonly name: string = 'com.objectstack.driver.turso';
  public override readonly version: string = '1.0.0';

  public override get supports() {
    // Inherit the SqlDriver capability baseline (incl. autonumber via the
    // shared `_objectstack_sequences` mechanism, and any future flags) and
    // override only where Turso/libSQL genuinely differs. Spreading the base
    // keeps this in lock-step with `DriverCapabilities` so a new base flag can
    // never make this override an incomplete type again.
    //
    // Only bits the engine actually READS belong here. `savepoints` /
    // `queryCTE` / `fullTextSearch` / `jsonQuery` / `connectionPooling` used to
    // be declared true/false right below — accurate statements about libSQL
    // that nothing ever consumed, and objectstack#4634 (ADR-0049
    // enforce-or-remove) retired them from `DriverCapabilities` along with 26
    // other zero-reader bits. Do not re-add a bit here to "document" an engine
    // feature: a capability flag is a promise the engine dispatches on, and one
    // nobody reads is a claim that can silently go false. Documentation goes in
    // prose; a real dispatch point goes in the spec first.
    return {
      ...super.supports,

      // Turso/libSQL batches DDL over one round-trip — see `syncSchemasBatch`.
      // The engine ANDs this bit with that method's presence, which is why the
      // bit is load-bearing rather than inferable: this class inherits the
      // method shape from SqlDriver, whose transport genuinely cannot batch.
      batchSchemaSync: true,

      // Remote transport does NOT do native date bucketing. SqlDriver's
      // `aggregate` — which emits `date_trunc`/`strftime` for structured
      // `{ field, dateGranularity }` groupBy items — is only reached in
      // local/replica mode; remote mode delegates `aggregate` to
      // `RemoteTransport.aggregate`, which accepts only string group-by
      // identifiers and has no bucketing. Inheriting SqlDriver's
      // `queryDateGranularity` in remote mode is therefore a FALSE capability:
      // the analytics engine (NativeSQLStrategy declines granularity →
      // ObjectQLStrategy → engine.aggregate) trusts `supports.queryDateGranularity`
      // and pushes the structured groupBy down to `RemoteTransport.aggregate`,
      // which stringifies the object to "[object Object]" and rejects it
      // (500 ANALYTICS_QUERY_FAILED — a whole dashboard widget stuck loading).
      // Advertise no native granularity in remote mode so the engine falls back
      // to `find()` (works remotely) + in-memory `bucketDateValue()` bucketing,
      // which the contract guarantees is always correct. See
      // @objectstack/spec `driver.zod.ts` (`queryDateGranularity`: "missing keys
      // fall back to in-memory bucketing") and objectql `engine.ts` aggregate
      // dispatch. Local/replica keep native bucketing via SqlDriver.
      // (Empty record — not `undefined` — to stay assignable to SqlDriver's
      // inferred `Record<string, boolean>` supports type; every granularity is
      // absent, so all fall back.)
      ...(this.transportMode === 'remote'
        ? { queryDateGranularity: {} as Record<string, boolean> }
        : {}),

      // [#18063] The remote transport has NO transactions, and this is the
      // declaration that lets it say so. `TursoDriver extends SqlDriver`, whose
      // `beginTransaction()` opens a real knex transaction, so method presence
      // — the engine's gate until now — reported this face as transactional. It
      // is not: `RemoteTransport`'s data methods take no `options` argument at
      // all, so a handle cannot reach the statement that would have to join it;
      // the write executed on the plain connection and was already durable, and
      // `rollback()` resolved having undone nothing.
      //
      // With the bit set the engine stops opening a transaction it cannot
      // honour and takes the DECLARED non-transactional path instead (ADR-0119
      // D1) — warning once, or throwing `TransactionUnsupportedError` before
      // any write when the caller passed `require: true`. That is also the path
      // `refuseRemoteTransaction`'s own message already tells callers to take,
      // nothing could reach while the gate read method presence.
      //
      // Local and embedded-replica modes inherit `false` from SqlDriver: they
      // run knex against a real connection and honour `options.transaction`.
      transactionsUnsupported: this.transportMode === 'remote',
    };
  }

  private tursoConfig: TursoDriverConfig;
  private libsqlClient: Client | null = null;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * The resolved transport mode for this driver instance.
   * Set during construction based on URL and config.
   */
  public readonly transportMode: TursoTransportMode;

  /**
   * Remote transport delegate — only initialized in remote mode.
   */
  private remoteTransport: RemoteTransport | null = null;

  /**
   * Objects whose physical table THIS driver created through the remote
   * transport — the remote-mode answer to the one question
   * {@link SqlDriver.paginationTieBreaker} asks.
   *
   * Local mode records that fact inside `SqlDriver.initObjects`, in
   * `managedObjectFields`. Remote DDL never reaches that method (it goes out
   * over `@libsql/client` — see {@link initObjects}), so the base map stays
   * empty however many tables the transport has created, and the inherited
   * rule reading an empty map would answer "not mine" for every object in
   * remote mode. Same question, same answer, different place to look it up.
   */
  private readonly remoteManagedObjects = new Set<string>();

  /**
   * [#19868] Remote `date` / json columns whose storage backfill found nothing
   * left to do in THIS process, so later schema syncs skip them. In memory
   * only: the next process probes again, at one round-trip for all columns.
   * Nothing reads it but {@link backfillRemoteCodecResidue}; unlike the
   * temporal marks, it switches no read-side repair.
   */
  private readonly remoteCodecResidueConverged: Record<string, Set<string>> = {};

  /**
   * The remote face's `sequencesTableEnsurePromise`: that the `key_hash`-keyed
   * `_objectstack_sequences` table EXISTS, probed once per process through the
   * transport. It remembers nothing about any counter's value — the counter
   * lives in the database and moves there. See
   * {@link ensureRemoteSequencesTable}.
   */
  private remoteSequencesTableEnsured: Promise<void> | null = null;

  constructor(config: TursoDriverConfig) {
    const mode = TursoDriver.detectMode(config);
    // A local or replica engine with nothing durable behind it (a remote url,
    // a url that is none of `file:` / `:memory:` / remote, or a replica on an
    // in-memory url) is refused here, before the Knex base could open a
    // private `:memory:` database in its place. See `localEngineDefect` for
    // the measurement.
    if (mode !== 'remote') {
      const defect = localEngineDefect(config.url, mode);
      if (defect) refuseNonDurableLocalEngine(config, mode, defect);
    }
    // A window the WebSocket arm cannot deliver is refused here, ahead of the
    // Knex base and of any client — see `refuseWebSocketTimeout` for the
    // reading and the ruling behind it.
    const timeoutMs = timeoutWindow(config);
    if (mode === 'remote' && timeoutMs !== undefined && ridesWebSocketTransport(config.url)) {
      refuseWebSocketTimeout(config.url, timeoutMs);
    }
    // A window a pre-configured client cannot carry is refused here for the
    // same reason and in the same place — see `refuseSuppliedClientTimeout`.
    // The predicate mirrors the `??` at the two sites that consume the key
    // (`connect()` and the transport's lazy connect factory) exactly: those
    // take the supplied client for any non-nullish value, and fall through to
    // `createRemoteClient()` — where the window IS installed — for `null` and
    // `undefined` alike.
    if (mode === 'remote' && timeoutMs !== undefined && config.client !== undefined && config.client !== null) {
      refuseSuppliedClientTimeout(timeoutMs);
    }
    // [#20200] Sync keys this configuration would ignore are refused here too,
    // in `@objectstack/spec`'s own words: `syncUrl` under a forced remote mode
    // (the remote client never receives it and no sync runs), and `sync` with
    // no `syncUrl` in any mode (nothing reads it). The presence tests are the
    // ones `detectMode`, `connect()` and `sync()` already use — a `syncUrl` is
    // set when truthy, so an empty one is unset — and the same the spec's
    // refinement applies. See `REMOTE_MODE_SYNC_URL_REFUSAL`.
    if (mode === 'remote' && config.syncUrl) {
      refuseIgnoredSyncKey(REMOTE_MODE_SYNC_URL_REFUSAL);
    }
    if (config.sync && !config.syncUrl) {
      refuseIgnoredSyncKey(SYNC_WITHOUT_SYNC_URL_REFUSAL);
    }
    // [#20437] A replica with no remote to replicate from: a forced
    // `mode: 'replica'` with no `syncUrl` never syncs and runs as a plain local
    // database, so it is refused here too, in the spec's words. After the `sync`
    // refusal, which the spec contract also raises first. See
    // `REPLICA_MODE_WITHOUT_SYNC_URL_REFUSAL`.
    if (mode === 'replica' && !config.syncUrl) {
      refuseIgnoredSyncKey(REPLICA_MODE_WITHOUT_SYNC_URL_REFUSAL);
    }
    // [#20586] The same defect the other way round: a forced `mode: 'local'`
    // beside a `syncUrl` would still be synced by `connect()`, so the declared
    // local mode would be ignored. Refused here too, in the spec's words, last:
    // every refusal above is exclusive of it except the url ones, which the
    // spec contract also raises first. See `LOCAL_MODE_WITH_SYNC_URL_REFUSAL`.
    if (mode === 'local' && config.syncUrl) {
      refuseIgnoredSyncKey(LOCAL_MODE_WITH_SYNC_URL_REFUSAL);
    }
    const knexConfig = TursoDriver.toKnexConfig(config, mode);
    super(knexConfig);
    this.tursoConfig = config;
    this.transportMode = mode;

    if (mode === 'remote') {
      this.remoteTransport = new RemoteTransport();

      // The COLUMN half of the temporal seam (ADR-0053 D-A1). `toRemoteFilter`
      // below puts the comparand into storage form via `temporalFilterValue`;
      // its inherited companion `temporalFilterColumnSql` says how the column
      // must be READ so the two are in the same form, and its own contract
      // calls coercing the value "necessary but NOT sufficient — a caller that
      // binds `temporalFilterValue` must wrap its column with this too, or it
      // keeps half the bug". Handing the transport the rule (not a copy of it)
      // is what keeps a single dialect-aware implementation.
      this.remoteTransport.setFilterColumnSql((object, field, columnSql) =>
        this.temporalFilterColumnSql(object, field, columnSql),
      );

      // [#14079/#15683] The declared-type half of the text-operator contract,
      // handed down for the same reason the temporal rule is: the transport
      // keeps no schema, and `registerRemoteFieldMetadata` →
      // `registerExternalObject` fills the SAME `numericFields` /
      // `booleanFields` / `dateFields` / `datetimeFields` / `timeFields`
      // registries the local compiler reads, keyed by object name. So
      // `isNonTextColumn` answers in remote mode exactly what it answers in
      // local mode, and a text operator over a `Field.number` — or, since
      // #15683's ruling, over a `Field.date` / `Field.datetime` / `Field.time`
      // — compiles to the contract's constant on both transports
      // (`turso-local-remote-text-parity` holds them to one row set) instead of
      // a `GLOB` over the number's storage-class spelling or over the temporal
      // column's canonical ISO text.
      this.remoteTransport.setNonTextColumnResolver((object, field) =>
        this.isNonTextColumn(object, field),
      );

      // [#20444] The declaration `$empty` expands, handed down the same way:
      // `registerRemoteFieldMetadata` → `registerExternalObject` fills the SAME
      // `valueShapeFields` registry the local compiler reads, keyed by object
      // name, so both transports answer `$empty` by one declared row.
      this.remoteTransport.setDeclaredValueShapeResolver((object, field) =>
        this.declaredValueShape(object, field),
      );

      // [#21178] The JSON-column rule, handed down the same way:
      // `registerRemoteFieldMetadata` → `registerExternalObject` fills the SAME
      // `jsonFields` registry the local compiler's gate and `$contains`
      // membership read, keyed by object name, so a filter on a multi-value or
      // structured-JSON field is refused, or answered by membership, alike on
      // both transports (`turso-local-remote-json-column-parity` holds them to
      // one answer). [#21236] It hands down the column's CLASS, from the same
      // registry plus `mediaFields`, so a single-value file-class field (a JSON
      // column on this face always: remote mode never moves its media columns)
      // reads the local face's media-column-move refusal, not `$contains`.
      this.remoteTransport.setJsonColumnResolver((object, field) =>
        this.jsonColumnFieldClass(object, field),
      );

      // [#7929] The server-side half of a REDACTED filter refusal. The remote
      // compiler withholds the operands of a cross-field comparison for the
      // same reason the inherited local one does — an RLS rule's columns are
      // not the caller's to read — and this line is what stops the withheld
      // text from being withheld from the OPERATOR too. `this.logger` is
      // `SqlDriver`'s own sink, so a host that injected a logger for local mode
      // gets remote mode's diagnostics in the same place, and a deployment
      // cannot lose them by changing its connection string.
      this.remoteTransport.setDiagnosticSink((message) => this.logger.warn(message));

      // [#8413] A declared UNIQUE index the remote face could not create is a
      // DURABILITY degradation, not a functional one: writes keep succeeding,
      // reads keep returning rows, and the only thing that changed is that a
      // constraint the metadata declares is not enforced — the "looks normal
      // from the outside" shape AGENTS.md grades at `error`. [#17609] A declared
      // PLAIN index it could not create lands here too, for the same reason:
      // every query still answers, by scanning the table. It is a SEPARATE
      // sink from the `warn` one above precisely so this class does not have to
      // share a level with the diagnostics that are merely informative.
      this.remoteTransport.setDurabilitySink((message) =>
        (this.logger.error ?? this.logger.warn).call(this.logger, message),
      );

      // [#8413] The tenancy rule behind a field-level `unique`, handed down
      // rather than re-derived. `computeTenantField` is `SqlDriver`'s single
      // source of truth (ADR-0120 D1/D3) and is a pure function of the schema,
      // which is what the transport needs: remote DDL runs BEFORE
      // `registerRemoteFieldMetadata` fills `tenantFieldByTable`, so a lookup
      // by table name would read empty at exactly the moment the index is built
      // and would silently emit a platform-wide unique where the local face
      // builds a per-organization one.
      this.remoteTransport.setTenantFieldResolver((schema) => this.computeTenantField(schema));

      // Register a lazy-connect factory so the transport can self-heal when
      // connect() was never called, failed on first attempt, or the client
      // was lost (e.g. serverless cold-start, transient network error).
      this.remoteTransport.setConnectFactory(async () => {
        this.libsqlClient = this.tursoConfig.client ?? (await this.createRemoteClient());
        return this.libsqlClient;
      });
    }
  }

  /**
   * Detect the transport mode from the URL and config.
   *
   * The scheme is matched in any letter case ({@link startsWithScheme}), the
   * way `@libsql/client` routes it, so an uppercase `LIBSQL://` is remote here
   * exactly as it is remote to the client this driver hands it to.
   */
  static detectMode(config: TursoDriverConfig): TursoTransportMode {
    // Explicit mode override
    if (config.mode) return config.mode;

    const url = config.url;

    // Local modes: file: or :memory:
    if (url === ':memory:' || isFileUrl(url)) {
      return config.syncUrl ? 'replica' : 'local';
    }

    // Remote URL (libsql://, https://, http://, wss://, ws://).
    // `http://` and `ws://` are plaintext transports used against a
    // self-hosted / local-dev Turso-compatible endpoint (e.g. an ObjectBase
    // gateway with no TLS termination, or sqld on localhost). @libsql/client
    // natively accepts these schemes; they MUST be classified as remote so
    // queries go over the wire. Before they were, such a url fell through to
    // the fallback below and silently wrote to an ephemeral in-memory DB (data
    // never reached the remote, lost on every restart).
    if (hasRemotePrefix(url)) {
      // A remote url beside `syncUrl` is still classified `replica`, because
      // that is what the declaration asks for, and the constructor REFUSES it
      // (`localEngineDefect`). It is not a working configuration:
      // `@libsql/client` builds no embedded replica for a remote url. It
      // routes the url to its HTTP or WebSocket client, which never reads
      // `syncUrl` and throws `SYNC_NOT_SUPPORTED` from `sync()`, and the local
      // engine could only have opened `:memory:`. An embedded replica is a
      // `file:` url beside `syncUrl`.
      if (config.syncUrl) return 'replica';
      return 'remote';
    }

    // Anything else (a bare path, an unsupported scheme) is classified by what
    // the declaration asks for, like the two arms above, and the constructor
    // REFUSES it (`localEngineDefect`): the local engine can open nothing but
    // a private `:memory:` database for it, and `@libsql/client` refuses such
    // a url itself. It is never run.
    return config.syncUrl ? 'replica' : 'local';
  }

  /**
   * Convert TursoDriverConfig to a Knex-compatible SqlDriverConfig.
   * Extracts the file path from the URL for local/embedded modes.
   * In remote mode, hands the base a Knex with NO connection: the SQLite
   * dialect's compiler and nothing else (see the remote arm below).
   */
  private static toKnexConfig(config: TursoDriverConfig, mode: TursoTransportMode): SqlDriverConfig {
    // [#20054] Remote mode: every CRUD and schema door delegates to
    // RemoteTransport (`@libsql/client`), and none of them reads `this.knex`.
    // Measured with the Knex instance wrapped to record every access after
    // construction, across connect, the CRUD and bulk doors, aggregate,
    // execute, the three schema doors and disconnect: zero reads. The
    // `SqlDriver` constructor still builds a Knex instance, so this arm only
    // decides WHICH one.
    //
    // It is built WITHOUT a `connection`, and that is the whole fix. knex's
    // `Client` constructor loads the dialect's native driver
    // (`initializeDriver` → `require('better-sqlite3')`) and builds a pool only
    // when the config carries a `connection`. This arm used to pass
    // `{ filename: ':memory:' }`, but loading the native module is a side
    // effect: with `better-sqlite3` absent — the install this package's
    // manifest (an OPTIONAL peer) and README give remote mode, e.g. on Vercel
    // or an Edge runtime — construction threw knex's `npm install
    // better-sqlite3` error before any remote call was made.
    //
    // What stays the same: the client is still spelled `better-sqlite3`, so
    // `isSqlite` and every dialect-keyed rule the remote arms borrow from the
    // base (`temporalFilterColumnSql`, the canonical-time SQL) answer exactly
    // as before, and so does anything that reads the dialect name off
    // `config.client`.
    //
    // What changes for a path that still reaches `this.knex` (only `SqlDriver`
    // methods this class does not override for remote mode): it used to RUN
    // against a private, empty `:memory:` database and could answer from it,
    // as `introspectSchema()` did with "no tables". Now knex refuses to run it
    // (`Unable to acquire a connection`), because there is no connection to
    // run it on. That failure is loud; it never adds a silent answer.
    if (mode === 'remote') {
      return {
        client: 'better-sqlite3',
        useNullAsDefault: true,
      };
    }

    if (config.url === ':memory:') {
      return {
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      };
    }

    if (isFileUrl(config.url)) {
      return {
        client: 'better-sqlite3',
        connection: { filename: config.url.slice('file:'.length) },
        useNullAsDefault: true,
      };
    }

    // Not reached from the constructor: every local or replica url that is
    // neither `file:` nor `:memory:` is refused there first
    // (`localEngineDefect`). This arm used to hand such a url a private
    // `:memory:` database, which lost every write on restart. It refuses
    // instead, with the same envelope, so no url can reach an in-memory
    // engine it did not name, whatever the caller.
    return refuseNonDurableLocalEngine(config, mode, 'unrecognised-url');
  }

  /**
   * The `@libsql/client` for the remote arm — one builder for both sites that
   * need it (`connect()` and the transport's lazy connect factory), so the two
   * cannot drift apart on which config keys reach the client. That drift is how
   * `timeout` sat declared-but-unforwarded four lines from a forwarded
   * `concurrency` until the ADR-0049 ruling on it: see `fetchBoundedBy` for
   * why the window rides `Config.fetch` and not `Config.timeout`.
   *
   * Both sites can also SKIP this builder entirely — each spells the choice
   * `this.tursoConfig.client ?? (await this.createRemoteClient())` — and when
   * they do, the one place `timeout` is installed is not reached. That pair is
   * refused at construction now (`refuseSuppliedClientTimeout`), which is what
   * keeps "the window is applied here" true of the whole remote arm rather
   * than only of the branch that calls this method.
   */
  private async createRemoteClient(): Promise<Client> {
    const { createClient } = await import('@libsql/client');
    const timeoutMs = timeoutWindow(this.tursoConfig);
    return createClient({
      url: this.tursoConfig.url,
      authToken: this.tursoConfig.authToken,
      concurrency: this.tursoConfig.concurrency,
      ...(timeoutMs === undefined ? {} : { fetch: fetchBoundedBy(timeoutMs) }),
    });
  }

  /**
   * Check if this driver instance is in remote mode.
   */
  get isRemote(): boolean {
    return this.transportMode === 'remote';
  }

  /**
   * Get the Turso-specific configuration.
   */
  getTursoConfig(): Readonly<TursoDriverConfig> {
    return this.tursoConfig;
  }

  // ===================================
  // Lifecycle (Turso-specific overrides)
  // ===================================

  /**
   * Connect the driver.
   *
   * **Local/Replica modes:**
   * 1. Initializes the Knex/better-sqlite3 connection (via SqlDriver.connect)
   * 2. If syncUrl is configured, creates a @libsql/client for sync operations
   * 3. Triggers initial sync if configured
   * 4. Starts periodic sync interval if configured
   *
   * **Remote mode:**
   * 1. Creates a @libsql/client for remote queries
   * 2. Skips Knex initialization (not needed)
   */
  override async connect(): Promise<void> {
    if (this.isRemote) {
      // Remote mode: initialize @libsql/client only
      this.libsqlClient = this.tursoConfig.client ?? (await this.createRemoteClient());
      this.remoteTransport!.setClient(this.libsqlClient);
      return;
    }

    // Local/Replica mode: initialize Knex first
    await super.connect();

    // Initialize libSQL client for embedded replica sync
    if (this.tursoConfig.syncUrl) {
      if (this.tursoConfig.client) {
        this.libsqlClient = this.tursoConfig.client;
      } else {
        const { createClient } = await import('@libsql/client');
        // No `fetch` and no `Config.timeout` here, on purpose. This arm is the
        // native `libsql` binding (a `file:` url with `syncUrl`), which consults
        // no fetch — a wrapped one would be forwarded to a channel that ignores
        // it, the inert shape this key just left. And `Config.timeout` is that
        // binding's BUSY timeout for local lock contention, not the remote
        // operation timeout `TursoDriverConfig.timeout` promises. That promise
        // is kept on `sync()`, the one remote operation this arm performs.
        this.libsqlClient = createClient({
          url: this.tursoConfig.url,
          authToken: this.tursoConfig.authToken,
          encryptionKey: this.tursoConfig.encryptionKey,
          syncUrl: this.tursoConfig.syncUrl,
          concurrency: this.tursoConfig.concurrency,
        });
      }

      // Sync on connect if configured (default: true)
      if (this.tursoConfig.sync?.onConnect !== false) {
        await this.sync();
      }

      // Start periodic sync if configured
      const interval = this.tursoConfig.sync?.intervalSeconds;
      if (interval && interval > 0) {
        this.syncIntervalId = setInterval(() => {
          this.sync().catch(() => {
            /* background sync failure is non-fatal */
          });
        }, interval * 1000);
      }
    }
  }

  /**
   * Disconnect the driver, clean up sync intervals, and close libSQL client.
   */
  override async disconnect(): Promise<void> {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    if (this.isRemote) {
      // Remote mode: only clean up remoteTransport / libsqlClient
      if (this.remoteTransport) {
        this.remoteTransport.close();
      }
      this.libsqlClient = null;
      return;
    }

    // Local/Replica mode: clean up libSQL client then Knex
    if (this.libsqlClient) {
      this.libsqlClient.close();
      this.libsqlClient = null;
    }

    await super.disconnect();
  }

  /**
   * Check connection health.
   */
  override async checkHealth(): Promise<boolean> {
    if (this.isRemote) {
      return this.remoteTransport!.checkHealth();
    }
    return super.checkHealth();
  }

  // ===================================
  // CRUD (remote mode overrides)
  // ===================================
  //
  // [#6402] Every `options` parameter in this file is a {@link DriverOptions},
  // matching `SqlDriver` / `IDataDriver` — the two faces of one driver may not
  // declare one argument two ways. This was the last `any` axis left in the
  // overrides: #5181 (PR #6076), #6075 (PR #6210) and #6212 each narrowed
  // `query`, and each deliberately left `options` alone because it is a
  // SEPARATE axis whose shape was verbatim-identical across all 17 overrides —
  // narrowing one would have read as a verdict on the other sixteen. #6402
  // closed all 17 in one sweep, so there is no half-narrowed state to
  // interpret. Keep it that way: a new override here declares `DriverOptions`.

  // [#17690] The return is the contract's own type, and this override needs it
  // declared HERE: an override re-declares the door in this package's own
  // `.d.ts`, so the `@objectstack/driver-sql` narrowing does not reach a
  // consumer holding a `TursoDriver` — measured twice already (#15280 for
  // `update()`, #17277 for `aggregate()`). It was `Promise<any[]>`, whose `any` is
  // nested inside a wider type and so was invisible to #15267's
  // literal-string census. Pinned both halves in
  // `turso-driver-doors-declared-types.test.ts`.
  override async find(object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    this.assertRemoteTransactionUnsupported(options, 'find');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'find');
      const remoteQuery = this.toRemoteReadQuery(object, query);
      // [#21226] The caller's tenant scope, as the local face scopes `findRows`.
      const scope = this.remoteTenantScope(object, options);
      return this.formatRemoteRows(
        object,
        await this.remoteReadExit(object, { where: query?.where }, () =>
          this.remoteTransport!.find(object, remoteQuery, table, scope),
        ),
      );
    }
    return super.find(object, query, options);
  }

  // [#15267] The override declares the contract's type, as both of its branches
  // already do: `RemoteTransport.findOne()` answers
  // `Record<string, unknown> | null` and `formatRemoteRow` is a generic
  // pass-through; the local branch forwards to `super.findOne` (narrowed
  // alongside). The explicit `Promise<any>` was this package's own `.d.ts`
  // re-erasing the door, which no driver-sql fix reaches.
  override async findOne(object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown> | null> {
    this.assertRemoteTransactionUnsupported(options, 'findOne');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'findOne');
      const remoteQuery = this.toRemoteReadQuery(object, query, { singleRowLookup: true });
      const scope = this.remoteTenantScope(object, options);
      return this.formatRemoteRow(
        object,
        await this.remoteReadExit(object, { where: query?.where }, () =>
          this.remoteTransport!.findOne(object, remoteQuery, table, scope),
        ),
      );
    }
    return super.findOne(object, query, options);
  }

  // `findStream` was retired from `IDataDriver` in spec 17.0.0
  // (objectstack#4484): a required method with no caller anywhere, whose SQL and
  // memory implementations awaited `find()` for the whole result set before
  // yielding — the opposite of the memory guarantee it was declared for. This
  // override went with the base method; page `find()` with `limit`/`offset`.

  /**
   * [#18616] Refuse an operation that arrived carrying a transaction handle the
   * remote face cannot honour — see {@link refuseRemoteTransaction} for the
   * ruling, the contract text and the measurements.
   *
   * # Why this door exists BESIDE the `beginTransaction()` refusal
   *
   * Refusing `beginTransaction()` alone is a false floor. The engine has a
   * SECOND, independent source for the handle it hands a driver:
   * `buildDriverOptions` (`packages/objectql/src/engine.ts`) reads
   * `execCtx.transaction` FIRST — "Explicit wins; ambient is the safety net" —
   * and `ExecutionContext.transaction` is a declared, caller-settable member of
   * the envelope (`packages/spec/src/kernel/execution-context.zod.ts`). A
   * handle threaded in that way never passes through this driver's
   * `beginTransaction()` at all. And the same-origin gate does not stop it
   * either: `transactionCoversDriverFor` attributes a handle only when it IS
   * the ambient store's handle, and for anything else it "declines to judge"
   * and returns `true` — its own recorded limit. So an explicitly-threaded
   * handle reaches a remote data method with nothing between it and the drop.
   *
   * The two doors are therefore not redundant and neither subsumes the other:
   * `beginTransaction()` closes the path that STARTS here, this closes the path
   * that starts anywhere else. Measured together they are the whole reachable
   * set — every in-repo producer of a handle is a `driver.beginTransaction()`
   * call (`engine.transaction()`, `ScopedContext.beginTransaction()`, the
   * sandbox trio), and the only other way to hold one is to have been given it.
   *
   * # Fires on absence of a handle, never on absence of transactions
   *
   * The guard reads exactly one thing — `options.transaction !== undefined` —
   * so a remote call with no handle is untouched, which is every call the
   * platform makes today. The DDL arms (`syncSchema`, `initObjects`,
   * `dropTable`, `syncSchemasBatch`) carry it for consistency and are inert by
   * MEASUREMENT, not by hope: no caller in this repository passes a third
   * argument to any of them, so nothing at boot can reach this refusal.
   */
  private assertRemoteTransactionUnsupported(options: DriverOptions | undefined, door: string): void {
    if (!this.isRemote) return;
    if (options?.transaction === undefined) return;
    refuseRemoteTransaction(
      `\`options.transaction\` on \`${door}()\``,
      'A transaction handle was supplied for this operation and the remote face silently dropped it.',
    );
  }

  /**
   * [#20107] The table a REMOTE statement for `object` is compiled against: the
   * answer {@link SqlDriver.getBuilder} gives the local face, read from the same
   * registry, `physicalTableByObject`.
   *
   * # The defect this closes
   *
   * `registerExternalObject` records a federated object's remote table
   * (`external.remoteName`, ADR-0015), and on the local face `getBuilder`
   * reads that record for every statement. This face inherits the registration
   * (`REMOTE_FACE_ANSWERS.registerExternalObject`), and every remote data door
   * handed `RemoteTransport` the object name, which the transport used as the
   * table. So the registration was recorded and never read here. Measured on a
   * remote face over a libSQL `file:` client with `ext_t` registered to
   * `probe_t`, at the base of this change: `find`, `findOne`, `count` and every
   * write door failed with a bare `LibsqlError`, `SQLITE_ERROR: no such table:
   * ext_t` (no `status`); `aggregate` answered `[]`; `distinct` answered
   * `DATABASE_ERROR`/500. A local control over the same file answered all of
   * them from `probe_t`.
   *
   * The `IDataDriver` contract says what carrying `registerExternalObject`
   * promises: the driver records the physical remote table "so queries resolve
   * to the remote table". ADR-0015 says `remoteName` "is honoured on all
   * dialects". This face carries the member, so it delivers what the member
   * promises.
   *
   * # One lookup, not a copy
   *
   * The registry is `SqlDriver`'s and stays there: this reads it, and does not
   * move it or restate it. A managed object misses the map, or maps to itself
   * (`registerRemoteFieldMetadata` registers it under its own name), so it
   * resolves to its own name, and its statement is the one this face built
   * before. `physicalSchemaByObject` needs no reading here: the base
   * registration never fills it on a SQLite dialect, where it warns that the
   * qualifier is ignored, on both faces alike.
   *
   * # A column map that renames is refused here, before any statement
   *
   * See {@link refuseRemoteColumnMap}. Every remote data door calls this first,
   * so a refused call sends nothing.
   */
  private remoteTableFor(object: string, door: string): string {
    const columnFields = this.columnFieldByObject[object];
    if (columnFields) {
      const renamed = Object.entries(columnFields)
        .filter(([remoteColumn, field]) => remoteColumn !== field)
        .map(([, field]) => field);
      if (renamed.length > 0) refuseRemoteColumnMap(object, door, renamed);
    }
    return this.physicalTableByObject[object] ?? object;
  }

  /**
   * [#21226] The caller's tenant scope for a REMOTE statement on `object`,
   * compiled by the local face's own chokepoint, or `undefined` when the call
   * is unscoped. Every remote door that reads rows or picks rows to write
   * hands it to `RemoteTransport`, which ANDs it onto the statement's `WHERE`.
   *
   * # The gap this closes
   *
   * The engine threads the caller's organization to every driver as
   * `DriverOptions.tenantId` (ADR-0131 D8). On the local face
   * {@link SqlDriver.applyTenantScope} puts it on every read and on every
   * update and delete predicate. The remote branches of `find`, `findOne`,
   * `count`, `aggregate`, `update`, `delete`, `bulkUpdate`, `bulkDelete`,
   * `updateMany` and `deleteMany` handed `RemoteTransport` no `DriverOptions`,
   * so their statements carried the caller's filter and nothing else, and
   * `create` stamped no organization on the row. Only `distinct()` refused,
   * because its source stated the gap. Where the engine's Layer 0 wall composes
   * a predicate above the driver, it held other organizations' rows back. Where
   * it composes none (the `single` posture, or an elevated caller that carries
   * its organization), the driver scope is the only fence, and this face had
   * none.
   *
   * # One rule, compiled, not a copy
   *
   * This method does not restate the predicate. It hands
   * {@link SqlDriver.applyTenantScope} a bare Knex query builder and compiles
   * what the chokepoint added. So the rule's decisions all stay in that one
   * method:
   *  - the NULL-organization arm (a platform row with no organization is no
   *    other tenant's);
   *  - the `group` posture's membership set (`tenantIds`, the union Layer 0
   *    enforces);
   *  - the exits for a call with no tenant context and for an object with no
   *    tenant column.
   * The two faces therefore answer the same row set by construction. Compiling
   * needs no connection: this face's Knex has none
   * (`REMOTE_HAS_NO_KNEX_CONNECTION`), and nothing here runs a statement on
   * it. The fragment is SQLite, the dialect the remote database speaks, in the
   * identifier quoting Knex's SQLite compiler uses.
   *
   * A compiled shape this method cannot read is refused, never sent unscoped
   * ({@link refuseUnreadableRemoteTenantScope}).
   */
  private remoteTenantScope(object: string, options: DriverOptions | undefined): RemoteTenantScope | undefined {
    const probe = this.knex.queryBuilder();
    this.applyTenantScope(probe, object, options);
    // The chokepoint may add `where` terms and nothing else: a limit, an order
    // or a join cannot ride into a remote `WHERE`.
    if (probe.clone().clearWhere().toSQL().sql !== REMOTE_SCOPE_PROBE_UNSCOPED) {
      refuseUnreadableRemoteTenantScope(object);
    }
    const { sql, bindings } = probe.toSQL();
    if (sql === REMOTE_SCOPE_PROBE_UNSCOPED) return undefined;
    if (!sql.startsWith(REMOTE_SCOPE_PROBE_PREFIX)) refuseUnreadableRemoteTenantScope(object);
    return { sql: sql.slice(REMOTE_SCOPE_PROBE_PREFIX.length), args: [...bindings] };
  }

  /**
   * [#20107] The terminal of the remote `find`, `findOne` and `count` exits:
   * the local face's own read-exit envelope, {@link SqlDriver.backendStatementFault}.
   *
   * On the local face every typed read exit ends there (#8931), so a statement
   * the backend refuses leaves the driver as `DATABASE_ERROR` / 500. The
   * dialect text stays in the server log, the dialect error rides under a
   * non-enumerable `cause`, and the table the statement targeted is declared
   * for `isMissingTableError`. These three remote exits had no terminal: the
   * libSQL client's error came back whole, a `LibsqlError` with an
   * `SQLITE_ERROR` code and no `status`. That is what a federated object's
   * reads raised here, and what a remote table that really is absent still
   * raises once the table is resolved.
   *
   * The same method is called, not a copy. It resolves the targeted table the
   * way {@link remoteTableFor} does, from the same registry, so the declared
   * table is the one this face's statement named. It returns anything that
   * already declares a `status` unchanged: the transport's filter refusals and
   * the remote timeout envelope keep their own answers. `distinct` already
   * reaches the same terminal through `distinctBackendFault`. The write doors
   * are left alone exactly as the local face leaves them, because a write
   * fault is classified at the REST boundary from its message.
   *
   * [#20424] `aggregate` now ends here too, and every exit reaches the
   * terminal through {@link remoteReadFault}, which adds the local face's
   * unresolvable-column arms in front of it.
   */
  private async remoteReadExit<T>(object: string, query: DriverQuery, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      throw this.remoteReadFault(object, query, error);
    }
  }

  /**
   * [#20424] Which envelope a backend error leaving a remote read exit
   * deserves: the local face's answer, from the local face's own seam.
   *
   * # The defect this closes
   *
   * `RemoteTransport` answered a missing table or column with `[]` in two
   * catches: `aggregate` for `no such table` and `no such column`, and the
   * terminal of `find`'s projection backstop for `no such column`. Measured at
   * base `6e3e5462c` over one libSQL `file:` database, with a local driver over
   * the same file as the control, for a federated object and for a managed one
   * alike:
   *
   * ```
   * aggregate, table really absent                     local DATABASE_ERROR 500  remote []
   * aggregate, groupBy a declared field, column absent local INVALID_FIELD 400   remote []
   * find, where names a declared field, column absent  local INVALID_FILTER 400  remote []
   * findOne, the same where                            local INVALID_FILTER 400  remote null
   * find, orderBy on that field                        local rows, unordered     remote []
   * count, the same where                              local INVALID_FILTER 400  remote DATABASE_ERROR 500
   * ```
   *
   * The transport now lets the backend's error out (its `find` keeps the local
   * ladder's projection and ORDER BY rungs first), and this classifies it.
   *
   * # The seam: `SqlDriver.aggregateBackendFault`, called, not copied
   *
   * The local face decides AFTER its statement runs, from the backend's error:
   * `count` and `findRows` send an unresolvable column to
   * `unresolvableFilterColumnRefusal` (#8790) and everything else to
   * `backendStatementFault` (#8931); `aggregate` attributes the column to the
   * clause the caller's own query names it in first (#11541). All three
   * compositions are protected members this driver inherits. The class
   * predicate they share, `isUnresolvableColumnError`, is not exported from
   * `@objectstack/driver-sql`, so `aggregateBackendFault` is the one inherited
   * member that asks it. For `aggregate` it is the local exit verbatim. For
   * `find`, `findOne` and `count` it is handed the WHERE alone, and then it is
   * the local exit too: with no groupBy and no aggregation its first arm cannot
   * fire, its second is `unresolvableFilterColumnRefusal` with the caller's
   * `where`, and its terminal is `backendStatementFault`. The one place the two
   * could differ, a recognised wording whose column name does not parse (the
   * local `count` still answers `INVALID_FILTER` there, this answers
   * `DATABASE_ERROR`), cannot arise on libSQL, whose only wording is
   * `no such column: <name>`.
   *
   * # Anything that already declares a `status` passes unchanged
   *
   * The local face guards only the statement's EXECUTION, so its classifier
   * never sees a refusal raised while the statement is built. A remote door
   * compiles and executes inside one transport call, so the transport's own
   * refusals (the filter compiler's `INVALID_FILTER`, the aggregate
   * vocabulary's refusals, the timeout envelope) arrive here beside the
   * backend's errors. They all declare a `status`; a libSQL error declares
   * none. So the gate `backendStatementFault` applies first on its own terms
   * ("is it already ours") is applied here before the classifier reads a
   * message, and the classifier sees exactly what the local one sees.
   */
  private remoteReadFault(object: string, query: DriverQuery, error: unknown): Error {
    if (typeof (error as { status?: unknown } | null | undefined)?.status === 'number') return error as Error;
    return this.aggregateBackendFault(object, query, error);
  }

  // ── Autonumber on the remote face: the sequence, moved in one statement ────
  //
  // The ruling, the measurements and the shared/own split are in the module
  // docblock "Autonumber on the remote face" above. In short: every rule that
  // decides WHICH counter a value is drawn from and WHERE a cold counter starts
  // is `SqlDriver`'s and is called, never copied; only the statement that moves
  // the counter is this face's, because it has no Knex connection to hold a
  // transaction on.

  /**
   * Rows answered by one sequence statement over the remote transport. The
   * transport's raw door is used on purpose: these statements belong to the
   * counter, not to any object's data, so they bypass the per-object read
   * classifiers the data doors wrap their statements in.
   */
  private async remoteSequenceRows(sql: string, args: unknown[] = []): Promise<Array<Record<string, unknown>>> {
    const rows = await this.remoteTransport!.execute(sql, args);
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  }

  /**
   * The remote half of {@link SqlDriver.ensureSequencesTable}: make sure the
   * `key_hash`-keyed sequences table exists, once per process, through the
   * transport. The DDL is `SqlDriver.defineSequencesTable` compiled to text by
   * this face's connection-less Knex (#20054 — it holds the dialect's compiler
   * and nothing else), so both faces create the same table from one
   * definition. A pre-`key_hash` table is refused rather than migrated — see
   * {@link refuseLegacyRemoteSequencesTable}.
   *
   * Cross-process race on the first create: a sibling container may create the
   * table between this process's existence probe and its DDL. The DDL then
   * fails on "already exists", and the table is re-probed before the error is
   * believed — the same recovery `ensureSequencesTable` performs.
   */
  private async ensureRemoteSequencesTable(): Promise<void> {
    if (this.remoteSequencesTableEnsured) {
      await this.remoteSequencesTableEnsured;
      return;
    }
    const table = this.sequencesTableName;
    // Knex types its schema probes by what AWAITING them answers (`hasTable`
    // → `Promise<boolean>`), but each is a `SchemaBuilder`, and a builder
    // compiles to its statements without a connection. Compiled here and SENT
    // through the transport, so the probes and the DDL are the dialect's own
    // spellings rather than a second copy of them.
    const compile = (builder: unknown): Array<{ sql: string; bindings: readonly unknown[] }> =>
      (builder as { toSQL(): Array<{ sql: string; bindings: readonly unknown[] }> }).toSQL();
    const run = async (statements: Array<{ sql: string; bindings: readonly unknown[] }>) => {
      let rows: Array<Record<string, unknown>> = [];
      for (const s of statements) rows = await this.remoteSequenceRows(s.sql, [...s.bindings]);
      return rows;
    };
    const exists = async () => (await run(compile(this.knex.schema.hasTable(table)))).length > 0;
    this.remoteSequencesTableEnsured = (async () => {
      if (!(await exists())) {
        try {
          await run(compile(this.knex.schema.createTable(table, (t) => this.defineSequencesTable(t))));
        } catch (err) {
          if (!(await exists())) throw err;
        }
      }
      // `hasColumn` compiles to the dialect's column listing (`PRAGMA table_info`
      // on SQLite); the shape check reads the column names off its rows.
      const columns = await run(compile(this.knex.schema.hasColumn(table, 'key_hash')));
      if (!columns.some((c) => c.name === 'key_hash')) refuseLegacyRemoteSequencesTable(table);
    })();
    try {
      await this.remoteSequencesTableEnsured;
    } catch (err) {
      // Not cached: a transient failure must not pin "ensured" or "refused" on
      // the process. The next write probes again.
      this.remoteSequencesTableEnsured = null;
      throw err;
    }
  }

  /**
   * `SqlDriver.getNextSequenceValue`, routed by transport: the inherited Knex
   * transaction on the local and embedded-replica faces, one atomic statement
   * over `@libsql/client` on the remote face. The caller is
   * `fillAutoNumberFields`, inherited unchanged, which is what keeps the format,
   * the tenant, the scope and the reservation report one rule on all three
   * faces.
   */
  protected override async getNextSequenceValue(
    object: string,
    tableName: string,
    field: string,
    prefix: string,
    tenantField: string | null,
    tenantId: string | null,
    parentTrx?: Parameters<SqlDriver['getNextSequenceValue']>[6],
    scope = '',
    suffix = '',
  ): Promise<number> {
    if (!this.isRemote) {
      return super.getNextSequenceValue(object, tableName, field, prefix, tenantField, tenantId, parentTrx, scope, suffix);
    }
    return this.nextRemoteSequenceValue(tableName, field, prefix, tenantField, tenantId, scope, suffix);
  }

  /**
   * Reserve and return the next counter value over the remote transport.
   *
   * Warm path, one round trip: `UPDATE … SET last_value = last_value + 1 …
   * RETURNING last_value`. A row comes back, that is the value; none comes
   * back, the counter is cold. Cold path: bootstrap from the data table's MAX
   * by the shared reading, then `INSERT … ON CONFLICT (key_hash) DO UPDATE SET
   * last_value = last_value + 1 RETURNING last_value` — so a sibling that
   * seeded the row first is incremented, never overwritten, and the value this
   * process reads back is the one the database committed for it. Both
   * statements are single SQLite statements, serialised by the database's
   * write lock across every connection and process. No in-process state takes
   * part: `remoteSequencesTableEnsured` only remembers that the TABLE exists.
   *
   * The counter is keyed exactly as the local face keys it —
   * `sequenceKeyHash(table, resolveSequenceTenantId(…), field, scope)` — which
   * is what lets an embedded replica and a remote client of the same database
   * draw from one row rather than two.
   */
  private async nextRemoteSequenceValue(
    tableName: string,
    field: string,
    prefix: string,
    tenantField: string | null,
    tenantId: string | null,
    scope: string,
    suffix: string,
  ): Promise<number> {
    await this.ensureRemoteSequencesTable();
    const table = this.sequencesTableName;
    const resolvedTenantId = this.resolveSequenceTenantId(tenantField, tenantId);
    const keyHash = this.sequenceKeyHash(tableName, resolvedTenantId, field, scope);

    const bumped = await this.remoteSequenceRows(
      `UPDATE "${table}" SET "last_value" = "last_value" + 1, "updated_at" = CURRENT_TIMESTAMP ` +
        `WHERE "key_hash" = ? RETURNING "last_value"`,
      [keyHash],
    );
    if (bumped.length > 0) return Number(bumped[0].last_value);

    const seedMax = await this.scanRemoteMaxCounter(
      tableName,
      field,
      prefix,
      tenantField,
      resolvedTenantId === GLOBAL_TENANT ? null : resolvedTenantId,
      suffix,
    );
    const issued = await this.remoteSequenceRows(
      `INSERT INTO "${table}" ("key_hash", "object", "tenant_id", "field", "scope", "last_value", "updated_at") ` +
        `VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ` +
        `ON CONFLICT ("key_hash") DO UPDATE SET "last_value" = "${table}"."last_value" + 1, ` +
        `"updated_at" = CURRENT_TIMESTAMP RETURNING "last_value"`,
      [keyHash, tableName, resolvedTenantId, field, scope, seedMax + 1],
    );
    if (issued.length === 0) {
      // RETURNING always answers one row for an INSERT that landed or merged;
      // an empty answer means the transport is not the SQLite this face
      // expects. Said rather than read as `NaN`.
      throw new Error(
        `The sequence statement for "${tableName}.${field}" answered no row over the remote transport; ` +
          `no record number was issued. The remote endpoint must honour INSERT … ON CONFLICT … RETURNING.`,
      );
    }
    return Number(issued[0].last_value);
  }

  /**
   * The remote half of {@link SqlDriver.scanMaxNumericTail}: fetch the stored
   * values of one counter's partition through the transport and read them by
   * the shared `maxAutonumberCounter`. The predicate is the same anchor the
   * local face compiles — the escaped prefix as a `LIKE` pre-filter, the tenant
   * column when the counter is tenant-scoped — spelled with an explicit
   * `ESCAPE '\'`, because SQLite's `LIKE` has no escape character unless one is
   * declared, and the shared escaping writes backslashes.
   */
  private async scanRemoteMaxCounter(
    tableName: string,
    field: string,
    prefix: string,
    tenantField: string | null,
    tenantId: string | null,
    suffix: string,
  ): Promise<number> {
    const col = quoteSequenceName(field);
    let sql = `SELECT ${col} FROM ${quoteSequenceName(tableName)} WHERE ${col} LIKE ? ESCAPE '\\' AND ${col} IS NOT NULL`;
    const args: unknown[] = [`${this.escapeLikePrefix(prefix)}%`];
    if (tenantField && tenantId !== null) {
      sql += ` AND ${quoteSequenceName(tenantField)} = ?`;
      args.push(tenantId);
    }
    const rows = await this.remoteSequenceRows(sql, args);
    return this.maxAutonumberCounter(rows.map((r) => r[field]), prefix, suffix);
  }

  /**
   * [#5495] The collision discriminator, routed by transport: does a row in
   * this counter's partition already hold the value this driver just issued?
   * The inherited Knex read on the local faces; the same `WHERE` through the
   * transport on the remote face, which ignores the Knex runner it is handed
   * (`collidingAutoNumberReservations` passes `this.knex`, which holds no
   * connection here).
   */
  protected override async autoNumberValueExists(
    queryRunner: Parameters<SqlDriver['autoNumberValueExists']>[0],
    reservation: Parameters<SqlDriver['autoNumberValueExists']>[1],
  ): Promise<boolean> {
    if (!this.isRemote) return super.autoNumberValueExists(queryRunner, reservation);
    const col = quoteSequenceName(reservation.field);
    let sql = `SELECT ${col} FROM ${quoteSequenceName(reservation.tableName)} WHERE ${col} = ?`;
    const args: unknown[] = [reservation.value];
    if (reservation.tenantField && reservation.tenantId !== null) {
      sql += ` AND ${quoteSequenceName(reservation.tenantField)} = ?`;
      args.push(reservation.tenantId);
    }
    sql += ' LIMIT 1';
    return (await this.remoteSequenceRows(sql, args)).length > 0;
  }

  /**
   * [#5495] Re-seed one counter from the data-table MAX, routed by transport.
   * The remote statement moves the counter FORWARD only, in one atomic step:
   * `UPDATE … SET last_value = ? WHERE key_hash = ? AND last_value < ?` — the
   * same "never rewind" rule the inherited version applies in its transaction,
   * without needing one.
   */
  protected override async resyncSequenceToDataMax(
    reservation: Parameters<SqlDriver['resyncSequenceToDataMax']>[0],
  ): Promise<void> {
    if (!this.isRemote) return super.resyncSequenceToDataMax(reservation);
    await this.ensureRemoteSequencesTable();
    const resolvedTenantId = this.resolveSequenceTenantId(reservation.tenantField, reservation.tenantId);
    const keyHash = this.sequenceKeyHash(reservation.tableName, resolvedTenantId, reservation.field, reservation.scope);
    const observedMax = await this.scanRemoteMaxCounter(
      reservation.tableName,
      reservation.field,
      reservation.prefix,
      reservation.tenantField,
      resolvedTenantId === GLOBAL_TENANT ? null : resolvedTenantId,
      reservation.suffix,
    );
    await this.remoteSequenceRows(
      `UPDATE "${this.sequencesTableName}" SET "last_value" = ?, "updated_at" = CURRENT_TIMESTAMP ` +
        `WHERE "key_hash" = ? AND "last_value" < ?`,
      [observedMax, keyHash, observedMax],
    );
  }

  /**
   * One remote row write with its record numbers issued first and the #5495
   * collision re-seed around it — the shape `SqlDriver.create` and
   * `SqlDriver.upsert` give the local faces, with the statement itself handed
   * in: `fillAutoNumberFields` fills the empty slots on `row` (a caller-supplied
   * value is kept), `send` writes the filled row, and a unique violation that
   * `collidingAutoNumberReservations` proves to be THIS counter's (a seed
   * replay or import landed rows above it) re-seeds the counter from the data
   * table, clears only the colliding fields and retries, up to the inherited
   * retry budget. Any other error — including a duplicate on a value the caller
   * typed — is rethrown untouched: that 409 is the caller's to receive.
   *
   * `row` is this method's own copy of the caller's data, so the caller's
   * object is never mutated by a number it did not ask to see on it.
   */
  private async writeRemoteRowWithAutoNumbers<T>(
    object: string,
    row: Record<string, any>,
    options: DriverOptions | undefined,
    send: (filled: Record<string, any>) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const reservations = await this.fillAutoNumberFields(object, row, options);
      try {
        return await send(row);
      } catch (error) {
        if (attempt >= this.autoNumberCollisionRetries) throw error;
        const colliding = await this.collidingAutoNumberReservations(error, reservations, options);
        if (colliding.length === 0) throw error;
        for (const reservation of colliding) {
          await this.resyncSequenceToDataMax(reservation);
          delete row[reservation.field];
        }
      }
    }
  }

  // [#15267] The override declares the contract's type, as both of its branches
  // already do: `RemoteTransport.create()` answers `Record<string, unknown>`
  // through the generic `formatRemoteRow`, and the local branch forwards to
  // `super.create` (narrowed alongside). Same shape the `update()` override
  // above took with #14438.
  override async create(object: string, data: Record<string, any>, options?: DriverOptions): Promise<Record<string, unknown>> {
    this.assertRemoteTransactionUnsupported(options, 'create');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'create');
      // [#21226] The caller's organization is stamped on the row, as the local
      // face's `create` stamps it (`injectTenantOnInsert`, before the record
      // numbers, which are issued per organization). Without it the row landed
      // with no organization. An explicit value on the row is kept.
      const row: Record<string, any> = { ...data };
      this.injectTenantOnInsert(object, row, options);
      // The record numbers are issued HERE, on the layer that holds the
      // schema, before the transport builds its INSERT — see "Autonumber on
      // the remote face" at the top of this file. A row that already carries
      // its number (seed replay, import) is written through unchanged.
      const written = await this.writeRemoteRowWithAutoNumbers(object, row, options, (filled) =>
        this.remoteTransport!.create(object, this.toRemoteWriteForms(object, filled), table),
      );
      return this.formatRemoteRow(object, written);
    }
    return super.create(object, data, options);
  }

  // [#14438] The override declares the contract's type, as both of its branches
  // already do: `super.update` (driver-sql) and `RemoteTransport.update()`
  // (#14428) both answer `Record<string, unknown> | null`, and `formatRemoteRow`
  // is a generic pass-through. The explicit `Promise<any>` here was the one
  // place this package's own `.d.ts` re-erased the door.
  override async update(object: string, id: string | number, data: Record<string, any>, options?: DriverOptions): Promise<Record<string, unknown> | null> {
    this.assertRemoteTransactionUnsupported(options, 'update');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'update');
      // [#21226] The key AND the caller's tenant scope, on the write and on its
      // read-back, as `SqlDriver.update` scopes both: a row outside the scope
      // is untouched and the answer is `null`.
      const scope = this.remoteTenantScope(object, options);
      return this.formatRemoteRow(
        object,
        await this.remoteTransport!.update(object, id, this.toRemoteWriteForms(object, data), table, scope),
      );
    }
    return super.update(object, id, data, options);
  }

  // [#17690] The return is the contract's own type, and this override needs it
  // declared HERE: an override re-declares the door in this package's own
  // `.d.ts`, so the `@objectstack/driver-sql` narrowing does not reach a
  // consumer holding a `TursoDriver` — measured twice already (#15280 for
  // `update()`, #17277 for `aggregate()`). It was `Promise<Record<string, any>>`, whose `any` is
  // nested inside a wider type and so was invisible to #15267's
  // literal-string census. Pinned both halves in
  // `turso-driver-doors-declared-types.test.ts`.
  override async upsert(object: string, data: Record<string, any>, conflictKeys?: string[], options?: DriverOptions): Promise<Record<string, unknown>> {
    this.assertRemoteTransactionUnsupported(options, 'upsert');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'upsert');
      // An upsert is insert-OR-merge, and which leg it takes is knowable only
      // after it runs. The record number is therefore reserved BEFORE the
      // statement, as `SqlDriver.upsert` reserves it on the local faces, and
      // the autonumber columns are named to the transport as insert-only
      // (#7011): on the insert leg the fresh number lands with the row — the
      // leg #7099 recorded as writing NULL under the refusal — and on the merge
      // leg the row keeps the number already in its column, the reservation
      // going unused exactly as it does on the local faces (a gap in the
      // sequence, never a renumbering). An explicit payload value does not
      // renumber a merged row either; `update()` is the renumbering path.
      //
      // [#21166] The insert-only set is `insertOnlyUpsertColumns` itself, the
      // list the local faces build their merge set from, so it names `id` and
      // `created_at` beside the autonumber columns. This face once handed the
      // transport the autonumber columns alone, from a lookup of its own, so a
      // merge on a business key (`conflictKeys: ['email']`) wrote
      // `"id" = excluded."id"` and replaced the stored row's primary key with
      // the payload's, or with the nanoid minted for the insert that lost
      // (#8622's re-key, on this face). One list, so the faces cannot drift on
      // which columns a merge may write. A remote object never renames a
      // column (`remoteTableFor` refuses a renaming column map first), so the
      // list's physical names are the names the transport writes.
      //
      // [#21185] The same list now names the tenant column, so a call with no
      // tenant context never re-parents the row it merges into. And a
      // tenant-scoped call is fenced to its organization on this face as on
      // the local one, in three steps, because this face had none of them:
      //  - the caller's organization is stamped on the row on entry
      //    (`injectTenantOnInsert`, the local face's own first step) — without
      //    it the insert leg wrote a row with no organization, and the
      //    "written" organization the fence compares against was empty;
      //  - the transport puts the predicate inside the merge statement, so a
      //    conflict on another organization's row (or a row with none) leaves
      //    it untouched;
      //  - the transport reads the landed row back under the written
      //    organization exactly and answers `null` when the predicate left the
      //    row alone, which is refused here with the local face's own
      //    `UNIQUE_VIOLATION` sentence. The check sits outside the autonumber
      //    re-seed wrapper: the refusal is not a counter collision, and nothing
      //    was written to re-seed for.
      const row: Record<string, any> = { ...data };
      this.injectTenantOnInsert(object, row, options);
      const fence = this.upsertTenantGuard(object, row, options);
      const insertOnly = [...this.insertOnlyUpsertColumns(object)];
      const written = await this.writeRemoteRowWithAutoNumbers(object, row, options, (filled) =>
        this.remoteTransport!.upsert(
          object,
          this.toRemoteWriteForms(object, filled),
          conflictKeys,
          table,
          insertOnly,
          fence ? { column: fence.column, value: fence.value } : undefined,
        ),
      );
      if (written === null) throw this.upsertConflictRefusal(object, conflictKeys);
      return this.formatRemoteRow(object, written);
    }
    return super.upsert(object, data, conflictKeys, options);
  }

  override async delete(object: string, id: string | number, options?: DriverOptions): Promise<boolean> {
    this.assertRemoteTransactionUnsupported(options, 'delete');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'delete');
      // [#21226] The key AND the caller's tenant scope, as `SqlDriver.delete`.
      return this.remoteTransport!.delete(object, id, table, this.remoteTenantScope(object, options));
    }
    return super.delete(object, id, options);
  }

  override async count(object: string, query?: DriverQuery, options?: DriverOptions): Promise<number> {
    this.assertRemoteTransactionUnsupported(options, 'count');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'count');
      const remoteQuery = this.toRemoteQuery(object, query);
      const scope = this.remoteTenantScope(object, options);
      return this.remoteReadExit(object, { where: query?.where }, () =>
        this.remoteTransport!.count(object, remoteQuery, table, scope),
      );
    }
    return super.count(object, query, options);
  }

  /**
   * [#6212] `query` is a {@link DriverQuery}, matching the narrowed
   * `SqlDriver.aggregate` this forwards to — the two faces of one driver may not
   * declare one argument two ways.
   *
   * [#6402] `options` is a {@link DriverOptions} for the same reason, closed as
   * one sweep across every override in this file rather than one method at a
   * time — see the block comment above `find()`.
   *
   * [#17277] The return is the contract's own
   * `Promise<Record<string, unknown>[]>`, and this override needs it declared
   * HERE: an override re-declares the door in this package's own `.d.ts`, so
   * the `@objectstack/driver-sql` narrowing does not reach a consumer holding a
   * `TursoDriver` — the same shape #15280 had to fix separately for `update()`.
   * Both branches already answer it: the remote branch is
   * `RemoteTransport.aggregate`, declared `Promise<Record<string, unknown>[]>`,
   * and the local branch is `SqlDriver.aggregate`, narrowed alongside.
   */
  override async aggregate(
    object: string,
    query: DriverQuery,
    options?: DriverOptions,
  ): Promise<Record<string, unknown>[]> {
    this.assertRemoteTransactionUnsupported(options, 'aggregate');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'aggregate');
      // [#20424] The caller's own query is what the fault is attributed
      // against, as `SqlDriver.aggregate` does locally: its groupBy and
      // aggregation fields, and the `where` before `toRemoteFilter` rewrote it.
      //
      // [#21226] The rows are narrowed to the caller's tenant scope before they
      // are grouped, as `SqlDriver.aggregate` scopes its builder.
      const scope = this.remoteTenantScope(object, options);
      return this.remoteReadExit(object, query, () =>
        this.remoteTransport!.aggregate(object, this.toRemoteQuery(object, query), table, scope),
      );
    }
    return super.aggregate(object, query, options);
  }

  // ===================================
  // Remote read-coercion helpers
  // ===================================
  //
  // The remote transport (`@libsql/client`) returns raw SQLite column values —
  // booleans as 0/1, JSON as text, dates as raw strings — because it has no
  // field-type metadata. Local/replica mode routes reads through
  // `SqlDriver.formatOutput()`, which coerces those back to their declared
  // types. These helpers run the SAME `formatOutput()` on remote rows so both
  // transports agree on what a value *is*; without them a CEL guard like
  // `field != true` sees `1 != true` (always true) on cloud/Turso but not
  // locally — the exact divergence behind the case_escalation incident.

  // ===================================
  // Remote temporal seam (ADR-0053 D-A1, #937)
  // ===================================
  //
  // `formatOutput` above closed the READ half of the transport asymmetry. The
  // WRITE and FILTER halves were still open: `RemoteTransport` builds its own
  // SQL (`buildWhereSQL`, `serializeValue`) and never touches the SqlDriver
  // seam, which is exactly the surface ADR-0053 D-A1 legislates about —
  //
  //   any surface that binds a filter comparand into raw SQL MUST coerce
  //   through the driver's dialect-aware temporal coercion, never re-derive a
  //   type from the value's textual shape
  //
  // — and measurement matched the prediction: a bare-day `$lte` dropped the
  // whole final day (framework#3777's shape, worse than pre-fix local because
  // even the midnight row went), `$between` fell through `buildWhereSQL`'s
  // `default:` arm into an equality against a JSON-stringified array and
  // matched NOTHING, and a `Field.date` written as a `Date` was serialised to
  // full ISO while a REST write of the same day stored `YYYY-MM-DD`, so one
  // column held two forms (framework#1874 / D-E1 all over again).
  //
  // The fix is not to grow `buildWhereSQL` a matching set of operator arms —
  // that is the second implementation D-A1 exists to prevent. It is to put the
  // payload and the comparands into the driver's storage form BEFORE they
  // reach the transport, reusing the inherited members. `RemoteTransport` stays
  // the dumb SQL builder it is documented to be.

  /**
   * Put a write payload into the storage form the filter path reads against —
   * the write half `RemoteTransport` skipped by never reaching
   * `SqlDriver.create`.
   *
   * This is `formatInput`, the same function local mode applies, so the two
   * transports cannot disagree about what a written value becomes. Remote mode
   * runs on libsql (SQLite), and the base config is `better-sqlite3`, so every
   * dialect branch inside it resolves the way local mode's does.
   *
   * The write-column map is deliberately NOT applied: a managed object has
   * none (see `registerRemoteFieldMetadata`), the transport addresses columns
   * by object-field name, and a federated object whose `external.columnMap`
   * renames a column is refused before this runs ({@link remoteTableFor}).
   */
  private toRemoteWriteForms<T>(object: string, data: T): T {
    if (!data || typeof data !== 'object') return data;
    return this.formatInput(object, data) as T;
  }

  /**
   * Compile a filter into the storage forms and operator shapes the remote
   * transport can bind correctly: each comparand in the driver's storage form,
   * and `$between` split into the `$gte` / `$lte` pair the transport compiles.
   *
   * [ADR-0053 D-D1 items 5 and 9, as amended — #20822] No calendar-day widening
   * happens here any more. A bare-day upper bound is widened ONCE, by the shared
   * lowering (`lowerFilterCondition`, `@objectstack/spec/data`) at the seams,
   * in the calendar-string domain — so every seamed read hands this method `$lt`
   * the next day, which it converts to storage form like any comparand, and
   * D-E3's order (widen the day first, convert the bound second) holds by
   * construction. A caller that passes no seam gets the comparison it wrote.
   */
  private toRemoteFilter(object: string, where: unknown): unknown {
    if (where == null || typeof where !== 'object') return where;
    if (Array.isArray(where)) return where.map((w) => this.toRemoteFilter(object, w));
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(where as Record<string, unknown>)) {
      if ((key === '$and' || key === '$or') && Array.isArray(val)) {
        out[key] = val.map((sub) => this.toRemoteFilter(object, sub));
        continue;
      }
      // `$not` carries ONE nested filter condition, so it recurses like the two
      // array combinators rather than passing through as an opaque `$`-key
      // (#1076). Skipping it left every condition INSIDE a negation on the raw
      // path: `$between` was never split (so `{ $not: { amount: { $between:
      // […] } } }` reached a transport that correctly refuses an unsplit
      // `$between`, naming a step that had in fact been skipped), and a
      // comparand under a negation never reached its storage form. Comparand
      // storage form and the `$between` split apply at every depth a condition
      // can appear at, so the recursion has to reach all of them.
      if (key === '$not') {
        out[key] = this.toRemoteFilter(object, val);
        continue;
      }
      out[key] = key.startsWith('$') ? val : this.toRemoteFieldSpec(object, key, val);
    }
    return out;
  }

  /** One field's comparand(s), in storage form and with `$between` split. */
  private toRemoteFieldSpec(object: string, field: string, spec: unknown): unknown {
    if (spec == null) return spec;
    // A bare scalar / `Date` is implicit equality; a bare array is not a valid
    // field spec for this transport, so it is left for `buildWhereSQL` to
    // handle exactly as before.
    if (typeof spec !== 'object' || spec instanceof Date) {
      return this.temporalFilterValue(object, field, spec);
    }
    if (Array.isArray(spec)) return spec;

    const out: Record<string, unknown> = {};
    for (const [op, raw] of Object.entries(spec as Record<string, unknown>)) {
      switch (op) {
        case '$between': {
          // Split into its two bounds rather than given an operator of its own
          // (framework#4081): the transport compiles `$gte` / `$lte` and has no
          // `$between` arm. The split is structural only — both ends inclusive,
          // as written. [#20822] The whole-day rule is not applied here: the
          // shared lowering at the seams already split a `datetime` column's
          // bare-day range into `$gte` / `$lt` the next day, and a range that
          // arrives here unsplit is either on a column the typed seam leaves
          // alone or from a caller that passed no seam.
          //
          // [#20094] A range that is not two bounds is NOT refused here: it is
          // handed to the transport as written, un-lowered, and the transport's
          // `$between` arm refuses it (`RemoteTransport.unsupportedOperator`).
          // This method runs outside the transport's refusal seam, so a throw
          // here was a bare `Error` — no `code`, no `status`, a 500 over REST —
          // naming the field and echoing the comparand to every caller, where
          // local mode answers `INVALID_FILTER` / 400 with both withheld. The
          // transport's arm is where every other remote filter refusal already
          // lives, behind the withheld seam and its enumeration pin, so the
          // lowering keeps no refusal of its own. The refused set does not
          // move: every such range was refused before and is refused after.
          if (!Array.isArray(raw) || raw.length !== 2) {
            out[op] = raw;
            break;
          }
          out.$gte = this.temporalFilterValue(object, field, raw[0]);
          out.$lte = this.temporalFilterValue(object, field, raw[1]);
          break;
        }
        case '$in':
        case '$nin':
          out[op] = Array.isArray(raw)
            ? raw.map((v) => this.temporalFilterValue(object, field, v))
            : raw;
          break;
        // Text predicates and existence checks take no temporal comparand.
        // (`$regex` is the better-auth adapter's spelling of a substring search
        // — a comparand the temporal coercion must likewise keep its hands off.)
        case '$contains':
        case '$notContains':
        case '$startsWith':
        case '$endsWith':
        case '$regex':
        case '$null':
        case '$exists':
        // [#20444] A presence flag like the two above — its boolean is not a
        // value of the column, so the temporal coercion keeps its hands off.
        case '$empty':
          out[op] = raw;
          break;
        default:
          out[op] = this.temporalFilterValue(object, field, raw);
      }
    }
    return out;
  }

  /** A query with its `where` compiled through {@link toRemoteFilter}. */
  private toRemoteQuery(object: string, query?: DriverQuery): any {
    if (!query || typeof query !== 'object' || query.where == null) return query;
    return { ...query, where: this.toRemoteFilter(object, query.where) };
  }

  /**
   * A READ query as the remote transport should receive it: the caller's
   * `where` compiled through {@link toRemoteQuery}, and the complete ORDER BY
   * the deterministic-paging contract asks for (`IDataDriver.find`,
   * objectstack#4363) already resolved into `orderBy`.
   *
   * The order comes from the inherited {@link SqlDriver.orderKeysFor} — the
   * same method local mode calls, not a second copy of its three-state table —
   * so the two transports of this ONE driver cannot answer the same paged
   * query with different ordering guarantees when only the URL differs. That
   * split is the seam ADR-0053 D-A1 exists to close, and it was open here:
   * `RemoteTransport.buildSelectSQL` mapped the caller's `orderBy` verbatim and
   * appended no unique column, so `ORDER BY status LIMIT 50 OFFSET 50` served
   * its ties in whatever arrangement the plan chose — one row twice, another
   * never, several screens apart (#5653). `RemoteTransport` keeps its job:
   * assemble SQL for the query it is handed.
   *
   * Deriving it HERE rather than inside `buildSelectSQL` is also what keeps
   * `findOne` correct. The transport spells an id lookup as
   * `find(object, { ...query, limit: 1 })`, so by the time the SQL is built a
   * `findOne` is indistinguishable from "page one of a walk with page size 1"
   * — and the two want opposite things: `ORDER BY id LIMIT 1` is the shape
   * that makes a planner abandon the predicate's own index and walk the
   * primary key instead (~100× on the measurement recorded in
   * `SqlDriver.findRows`), and `findOne` promises *a* matching record, never a
   * position in a sequence. Up here the two callers are still distinguishable,
   * and `singleRowLookup` is how they say so — exactly as they do locally.
   *
   * `orderKeysFor` returns `[]` for the third row of its table — an unpaged
   * read with no `orderBy` (#4363's deliberate carve-out) — and an empty
   * `orderBy` makes `buildSelectSQL` emit no ORDER BY clause at all, i.e. the
   * same statement it emitted before this method existed.
   */
  private toRemoteReadQuery(
    object: string,
    query: DriverQuery,
    opts?: { singleRowLookup?: boolean },
  ): any {
    if (!query || typeof query !== 'object') return query;
    const orderBy = this.orderKeysFor(object, query, opts).map((key) => ({
      field: key.field,
      order: key.direction,
    }));
    return this.toRemoteQuery(object, { ...query, orderBy });
  }

  /**
   * The unique column a paged read can be made deterministic with (#4363),
   * answered for remote mode.
   *
   * The RULE is not restated here: {@link SqlDriver.orderKeysFor} still decides
   * *when* a tie-breaker is appended and in which direction, and remote reads
   * go through it (see {@link toRemoteReadQuery}). What is remote-specific is
   * the single FACT that rule needs — did this driver create the table, and
   * does it therefore carry an `id` primary key?
   * `RemoteTransport.buildCreateTableSQL` opens every table it creates with
   * `"id" TEXT PRIMARY KEY`, so for anything this driver synced the answer is
   * yes; it is simply recorded in {@link remoteManagedObjects}, because the
   * base class's `managedObjectFields` is filled by `SqlDriver.initObjects`
   * and remote DDL never calls it.
   *
   * The base method's conservatism is kept deliberately for everything else: a
   * table this driver did not create still gets `null` and no invented ORDER
   * BY. An `id` column that is not there fails the whole statement, and
   * guessing on a federated table (ADR-0015) would trade a reshuffle among
   * ties for the loss of the caller's entire result.
   */
  protected override paginationTieBreaker(object: string): string | null {
    if (!this.isRemote) return super.paginationTieBreaker(object);
    return this.remoteManagedObjects.has(object) ? 'id' : null;
  }

  /** Apply the inherited read-coercion to a single remote row (in place). */
  private formatRemoteRow<T>(object: string, row: T): T {
    if (row && typeof row === 'object') this.formatOutput(object, row as any);
    return row;
  }

  /** Apply read-coercion to every remote row (in place). */
  private formatRemoteRows<T extends any[]>(object: string, rows: T): T {
    if (Array.isArray(rows)) for (const row of rows) this.formatRemoteRow(object, row);
    return rows;
  }

  /**
   * Populate the read-coercion registries (boolean/json/date/numeric/…) for a
   * managed object in REMOTE mode WITHOUT running any DDL. `SqlDriver.initObjects`
   * normally does this, but TursoDriver's remote path routes DDL through
   * `RemoteTransport` and never reaches it, leaving the registries empty so
   * `formatOutput()` had nothing to coerce. Reuse the base `registerExternalObject`,
   * whose sole documented job is exactly this — it classifies fields with the
   * canonical logic, so the two can never drift. A managed object is its own
   * physical table, so the default `remoteName === name` mapping it records is
   * what {@link remoteTableFor} then reads back for the object: its own name.
   *
   * It also records the object as one whose table this driver created, which is
   * the whole input to {@link paginationTieBreaker} in remote mode. That goes
   * FIRST and outside the `try`: its only caller, {@link completeRemoteSchemaSync},
   * runs only after the DDL has already succeeded, so the table exists with its
   * `id` primary key whether or not the best-effort coercion registration below
   * does.
   */
  private registerRemoteFieldMetadata(obj: { name: string; fields?: Record<string, any>; tenancy?: any }): void {
    this.remoteManagedObjects.add(obj.name);
    try {
      this.registerExternalObject({ name: obj.name, fields: obj.fields, tenancy: obj.tenancy });
    } catch {
      /* metadata registration is best-effort; never block schema sync on it */
    }
  }

  /**
   * The post-DDL half every REMOTE schema door owes, in its one order: register
   * each synced object's field metadata, then run the canonical temporal
   * backfill and the `date` / `json` storage backfill, each ONCE for the whole
   * call.
   *
   * All three remote doors (`syncSchema`, `initObjects`, `syncSchemasBatch`)
   * send their DDL through `RemoteTransport` and so never reach
   * `SqlDriver.initObjects`, which is what fills the read-coercion registries
   * and runs the Knex backfill on the local faces. Each door has to finish the
   * job itself, and they drifted apart once: `syncSchemasBatch` — the door
   * `ObjectQLPlugin`'s boot sync takes whenever `supports.batchSchemaSync`
   * holds, so every remote-Turso boot — returned straight after its DDL. A
   * booted remote app then read a boolean back as `1` and JSON as a string, got
   * no `id` tie-breaker on a paged read, and never converged its temporal
   * columns (#19844). One helper called by all three is what keeps them from
   * drifting again.
   *
   * Callers reach here only after their DDL resolved, so a DDL failure throws
   * before anything is registered and no object is recorded as a table this
   * driver created unless it exists. Registration precedes the backfills
   * because they read it to learn which columns are temporal, `date` or json.
   * Each backfill probes every column it finds in one round-trip, so calling
   * them once per call rather than once per object is what keeps a boot's
   * steady state at one round-trip per backfill.
   */
  private async completeRemoteSchemaSync(
    objects: Array<{ name: string; fields?: Record<string, any>; tenancy?: any }>,
  ): Promise<void> {
    if (objects.length === 0) return;
    for (const obj of objects) this.registerRemoteFieldMetadata(obj);
    await this.backfillRemoteCanonicalTemporalQuietly();
    // [#19868] Then the `date` / `json` cells the pre-#19844 batch door stored
    // without the write codec. Same registration, one probe round-trip of its own.
    await this.backfillRemoteCodecResidueQuietly();
  }

  /**
   * [#19868] Converge the REMOTE `Field.date` and `Field.json` cells that the
   * pre-#19844 `syncSchemasBatch` door stored without `formatInput`: a `date`
   * stored as a full timestamp, and a json string stored bare. See
   * `remote-codec-residue-backfill.ts` for which cells are rewritten, which are
   * left alone because their original value cannot be told from their bytes,
   * and why no converted cell reads differently afterwards.
   *
   * Private on purpose: it needs no operator surface, because a budget-stopped
   * column resumes on the next schema sync by itself.
   */
  private async backfillRemoteCodecResidue(
    options?: RemoteCanonicalBackfillOptions,
  ): Promise<RemoteCodecResidueReport> {
    if (!this.isRemote) return { columns: [] };
    const client = this.remoteTransport?.getClient() as RemoteBackfillClient | null | undefined;
    if (!client) return { columns: [] };

    const columns: RemoteCodecResidueColumn[] = [];
    for (const table of this.remoteManagedObjects) {
      const done = this.remoteCodecResidueConverged[table];
      for (const field of this.dateFields[table] ?? []) {
        if (!done?.has(field)) columns.push({ table, field, kind: 'date' });
      }
      // A single-value media column's canonical form (a quoted or a bare id) is
      // an ADR-0104 deployment fact these remote doors never resolve, so it is
      // not ours to rewrite. Both forms read the same.
      const media = new Set(this.mediaFields[table] ?? []);
      for (const field of this.jsonFields[table] ?? []) {
        if (!media.has(field) && !done?.has(field)) columns.push({ table, field, kind: 'json' });
      }
    }
    if (columns.length === 0) return { columns: [] };

    const report = await backfillRemoteCodecResidueColumns(
      client,
      columns,
      // The driver's OWN `Field.date` write conversion, handed over rather than
      // copied, so what the backfill writes is what `formatInput` writes.
      { toDateOnly: (value) => this.toDateOnly(value) },
      options,
      this.logger,
    );
    for (const column of report.columns) {
      if (column.done) (this.remoteCodecResidueConverged[column.table] ??= new Set<string>()).add(column.field);
    }
    return report;
  }

  /**
   * Run {@link backfillRemoteCodecResidue} after a remote schema sync and
   * swallow everything, for the reason
   * {@link backfillRemoteCanonicalTemporalQuietly} gives: a migration must
   * never fail a boot. The module already reports instead of throwing; this
   * catch covers a client lost between the sync and here.
   */
  private async backfillRemoteCodecResidueQuietly(): Promise<void> {
    try {
      await this.backfillRemoteCodecResidue();
    } catch (err) {
      this.logger.warn(
        `[driver-turso] remote date/json storage backfill failed; the cells stay as they were`,
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /**
   * Converge this driver's REMOTE `Field.datetime` / `Field.time` columns on the
   * canonical storage form and mark the ones that are PROVED converged, so their
   * filters stop compiling to the unindexable repair expression
   * (objectstack#5770, cloud#1005 后果 A; the maintainer's 2026-08-03 方案 1).
   *
   * The remote-mode counterpart of `SqlDriver.backfillCanonicalDatetimes` /
   * `backfillCanonicalTimes`, which are Knex paths and therefore never ran here.
   * Same semantics, same expression, same consumption point: this marks
   * `canonicalDatetimeFields` / `canonicalTimeFields`, which is exactly what
   * `needsLegacyDatetimeRepair` / `needsLegacyTimeRepair` read to drop the
   * repair — so remote and local reach the indexable form through one rule
   * rather than two. It additionally recovers the TEXT-affinity numeric epochs
   * only a remote table can hold (后果 B); see `remote-canonical-backfill.ts`
   * for why that limb is safe HERE and was rejected in the shared expression.
   *
   * Called automatically after remote schema sync, and public so an operator can
   * drive a large table to completion with a bigger budget:
   *
   * ```typescript
   * await driver.backfillRemoteCanonicalTemporal({ batchSize: 2000, maxBatches: 5000 });
   * ```
   *
   * Never throws and never marks on anything but measured evidence. A column
   * that errors, that a batch budget stopped short, or that holds a row the
   * #6009 guard withheld, stays unmarked and keeps its read-side repair —
   * correct answers, just unindexed. Nothing in any read or write path may
   * depend on this having run (ADR-0053 D-B3 / cloud#1003).
   *
   * A no-op outside remote mode: local and replica reach the same state through
   * the inherited Knex backfill during `initObjects`.
   */
  async backfillRemoteCanonicalTemporal(
    options?: RemoteCanonicalBackfillOptions,
  ): Promise<RemoteCanonicalBackfillReport> {
    if (!this.isRemote) return { columns: [] };
    const client = this.remoteTransport?.getClient() as RemoteBackfillClient | null | undefined;
    if (!client) return { columns: [] };

    // Only tables this driver synced remotely, and only columns not already
    // marked — re-running is cheap by design, but skipping a proved column
    // makes it free.
    const columns: RemoteBackfillColumn[] = [];
    for (const table of this.remoteManagedObjects) {
      for (const field of this.datetimeFields[table] ?? []) {
        if (this.canonicalDatetimeFields[table]?.has(field)) continue;
        columns.push({ table, field, kind: 'datetime' });
      }
      for (const field of this.timeFields[table] ?? []) {
        if (this.canonicalTimeFields[table]?.has(field)) continue;
        columns.push({ table, field, kind: 'time' });
      }
    }
    if (columns.length === 0) return { columns: [] };

    const report = await backfillRemoteCanonicalColumns(
      client,
      columns,
      {
        // The driver's OWN repair expression — handed over, never copied, so the
        // backfill cannot drift from the read path it is retiring.
        canonical: (kind, columnSql) =>
          kind === 'datetime'
            ? this.sqliteCanonicalDatetimeSql(columnSql)
            : this.sqliteCanonicalTimeSql(columnSql),
        // [#6009] And the driver's OWN backfill-side guard, across the identical
        // boundary and for the identical reason: the rows whose only reading is
        // SQLite's julian-day limb must be withheld from the remote `UPDATE` by
        // the same predicate the local twin withholds them by, or the two
        // transports quietly disagree about which bytes are safe to overwrite.
        // Kind-free — it probes parseability, not a format.
        nonTemporalText: (columnSql) => this.sqliteNonTemporalTextSql(columnSql),
      },
      options,
      this.logger,
    );

    for (const column of report.columns) {
      if (!column.canonical) continue;
      const marks =
        column.kind === 'datetime'
          ? (this.canonicalDatetimeFields[column.table] ??= new Set<string>())
          : (this.canonicalTimeFields[column.table] ??= new Set<string>());
      marks.add(column.field);
    }

    return report;
  }

  /**
   * Run {@link backfillRemoteCanonicalTemporal} off the back of a remote schema
   * sync, swallowing everything.
   *
   * The local twin is invoked from inside `SqlDriver.initObjects` for the same
   * reason and with the same posture: schema sync is the moment the driver knows
   * which columns are temporal, and a migration must never be able to fail a
   * boot. `backfillRemoteCanonicalTemporal` already reports rather than throws;
   * this catch covers the paths that could still reject (a client lost between
   * the sync and here).
   */
  private async backfillRemoteCanonicalTemporalQuietly(): Promise<void> {
    try {
      await this.backfillRemoteCanonicalTemporal();
    } catch (err) {
      this.logger.warn(
        `[driver-turso] remote canonical temporal backfill failed; ` +
        `queries stay correct via the read-side repair`,
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  // ===================================
  // Bulk Operations (remote mode overrides)
  // ===================================

  // [#15267] The override declares the contract's type: `RemoteTransport
  // .bulkCreate()` answers `Record<string, unknown>[]` through the generic
  // `formatRemoteRows`, and the local branch forwards to `super.bulkCreate`
  // (narrowed alongside).
  override async bulkCreate(object: string, data: any[], options?: DriverOptions): Promise<Record<string, unknown>[]> {
    this.assertRemoteTransactionUnsupported(options, 'bulkCreate');
    if (this.isRemote) {
      // The column-map refusal runs once, before any row, as it did when the
      // batch was handed down whole.
      this.remoteTableFor(object, 'bulkCreate');
      // The batch is written one row at a time through this class's own
      // `create`, so each row's record number is issued on the layer that holds
      // the schema and each row's #5495 collision re-seed is its own.
      // `RemoteTransport.bulkCreate` was never one statement: it loops the
      // transport's own `create` (one INSERT and one read-back per row), so a
      // batch on this transport was never all-or-nothing, and routing it
      // through the driver's `create` changes neither the statements sent nor
      // what a mid-batch failure leaves behind — it adds only the numbers.
      const results: Record<string, unknown>[] = [];
      for (const row of data) results.push(await this.create(object, row, options));
      return results;
    }
    return super.bulkCreate(object, data, options);
  }

  // [#17690] The return is the contract's own type, and this override needs it
  // declared HERE: an override re-declares the door in this package's own
  // `.d.ts`, so the `@objectstack/driver-sql` narrowing does not reach a
  // consumer holding a `TursoDriver` — measured twice already (#15280 for
  // `update()`, #17277 for `aggregate()`). It was `Promise<Record<string, any>[]>`, whose `any` is
  // nested inside a wider type and so was invisible to #15267's
  // literal-string census. Pinned both halves in
  // `turso-driver-doors-declared-types.test.ts`.
  override async bulkUpdate(object: string, updates: Array<{ id: string | number; data: Record<string, any> }>, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    this.assertRemoteTransactionUnsupported(options, 'bulkUpdate');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'bulkUpdate');
      const formatted = Array.isArray(updates)
        ? updates.map((u) => ({ ...u, data: this.toRemoteWriteForms(object, u.data) }))
        : updates;
      // [#21226] Each row's update carries the caller's tenant scope, as each of
      // `SqlDriver.bulkUpdate`'s goes through the scoped `update`.
      const scope = this.remoteTenantScope(object, options);
      return this.formatRemoteRows(object, await this.remoteTransport!.bulkUpdate(object, formatted, table, scope));
    }
    return super.bulkUpdate(object, updates, options);
  }

  override async bulkDelete(object: string, ids: Array<string | number>, options?: DriverOptions): Promise<void> {
    this.assertRemoteTransactionUnsupported(options, 'bulkDelete');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'bulkDelete');
      // [#21226] The id set AND the caller's tenant scope, as `SqlDriver.bulkDelete`.
      return this.remoteTransport!.bulkDelete(object, ids, table, this.remoteTenantScope(object, options));
    }
    return super.bulkDelete(object, ids, options);
  }

  override async updateMany(object: string, query: DriverQuery, data: any, options?: DriverOptions): Promise<number> {
    this.assertRemoteTransactionUnsupported(options, 'updateMany');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'updateMany');
      // [#21226] The caller's filter AND tenant scope, as `SqlDriver.updateMany`.
      return this.remoteTransport!.updateMany(
        object,
        this.toRemoteQuery(object, query),
        this.toRemoteWriteForms(object, data),
        table,
        this.remoteTenantScope(object, options),
      );
    }
    return super.updateMany(object, query, data, options);
  }

  override async deleteMany(object: string, query: DriverQuery, options?: DriverOptions): Promise<number> {
    this.assertRemoteTransactionUnsupported(options, 'deleteMany');
    if (this.isRemote) {
      const table = this.remoteTableFor(object, 'deleteMany');
      // [#21226] The caller's filter AND tenant scope, as `SqlDriver.deleteMany`.
      return this.remoteTransport!.deleteMany(
        object,
        this.toRemoteQuery(object, query),
        table,
        this.remoteTenantScope(object, options),
      );
    }
    return super.deleteMany(object, query, options);
  }

  // ===================================
  // Raw Execution (remote mode override)
  // ===================================

  // [#15267] The override declares the contract's `unknown`:
  // `RemoteTransport.execute()` already answers `unknown`, and the local branch
  // forwards to `super.execute` (narrowed alongside). The explicit
  // `Promise<any>` erased the contract's `unknown` on this package's `.d.ts`.
  override async execute(command: any, params?: any[], options?: DriverOptions): Promise<unknown> {
    this.assertRemoteTransactionUnsupported(options, 'execute');
    if (this.isRemote) {
      // [#16019] The remote transport hands the libsql client's error back
      // whole — `SQLITE_ERROR: no such function: translate`: no statement, no
      // `status`, the bare shape the HTTP doors' phrasing heuristic never
      // covered. Declared through the base class's raw-path terminal so both
      // transports leave this driver with ONE envelope (`DATABASE_ERROR`/500,
      // the dialect error under a non-enumerable `cause`).
      try {
        return await this.remoteTransport!.execute(command, params);
      } catch (error) {
        throw this.rawStatementFault(typeof command === 'string' ? command : String(command), error);
      }
    }
    return super.execute(command, params, options);
  }

  // ===================================
  // Transactions (remote mode overrides)
  // ===================================

  // ⭐ [#18063] This door publishes the INHERITED declaration, and the `any` it
  // used to publish is gone. The history is worth keeping because the `any` was
  // a NAMED remainder, not an oversight: `TursoDriver extends SqlDriver`, whose
  // `beginTransaction()` publishes `Promise<Knex.Transaction>` — narrower than
  // the contract's `Promise<unknown>`, the honest direction, and the binding
  // declaration for an override. While the remote arm RETURNED a libsql
  // transaction there was no honest annotation available: the contract's own
  // type does not compile against the base (TS2416), and the base's type would
  // have been a lie on the remote arm. The `any` masked that real LSP
  // violation, and closing it meant widening `SqlDriver`'s narrowing (measured
  // at the time: +14 further consumer sites across the driver packages) or
  // restructuring the remote handle — both above an annotation swap (#17690).
  //
  // What dissolved it is that the remote arm no longer returns anything.
  // [#18616] made it REFUSE, and `refuseRemoteTransaction` returns `never`, so
  // the branch is assignable to any return type; the only arm that still
  // returns is `super.beginTransaction()`, whose type this now simply repeats.
  // The LSP violation is not re-dressed here, it is absent: there is no longer
  // a value that fails to be a knex transaction.
  //
  // And [#18063] closes the path that reached it. `supports` now declares
  // `transactionsUnsupported` on the remote arm and the engine gates on the
  // DECLARATION, so `engine.transaction()` takes the non-transactional path
  // (ADR-0119 D1) rather than calling this and catching a 501 — the refusal
  // below stays as the floor for a caller that reaches past the engine.
  // ⛔ Spelled `ReturnType<SqlDriver['beginTransaction']>` and not
  // `Promise<Knex.Transaction>`: `knex` is not a dependency of this package, so
  // its types cannot be named here (`check:undeclared-dep-imports`; the same
  // reason `turso-driver-doors-declared-types.test.ts` structurally types its
  // knex slice). Deriving it from the base is also the stronger pin — it cannot
  // drift from whatever `SqlDriver` publishes.
  override async beginTransaction(): ReturnType<SqlDriver['beginTransaction']> {
    if (this.isRemote) {
      refuseRemoteTransaction(
        '`beginTransaction()`',
        'The handle this used to return was decorative: no remote data method could receive it.',
      );
    }
    return super.beginTransaction();
  }

  // ⭐ [#18616] `commit`/`rollback` refuse on the remote arm too, and that is
  // not belt-and-braces. With `beginTransaction()` refusing, this driver issues
  // no remote handle at all, so the ONLY way to reach these is to hand them a
  // handle from somewhere else — `getLibsqlClient().transaction()`, or another
  // driver's. `rollback()` accepting one is the precise silence this card is
  // named for: it resolves, reports success, and undoes nothing, because the
  // writes it was supposed to undo never entered that transaction. A door that
  // can only ever answer a false success is closed.
  //
  // Unreachable from every in-repo transaction path, by construction: both
  // engine faces (`engine.transaction()`, `ScopedContext.commitTransaction` /
  // `rollbackTransaction`) call `commit`/`rollback` only with a handle their
  // own `beginTransaction()` returned, which now throws before either is
  // reached — so no caller can be left with an unrolled-back transaction by
  // this refusal.
  override async commit(transaction: unknown): Promise<void> {
    if (this.isRemote) {
      refuseRemoteTransaction(
        '`commit()`',
        'This face issues no transaction handle, so the handle supplied came from elsewhere and '
        + 'covers none of the statements this driver ran.',
      );
    }
    return super.commit(transaction);
  }

  override async rollback(transaction: unknown): Promise<void> {
    if (this.isRemote) {
      refuseRemoteTransaction(
        '`rollback()`',
        'This face issues no transaction handle, so rolling one back here would report a '
        + 'successful undo of writes that were never inside it and are already durable.',
      );
    }
    return super.rollback(transaction);
  }

  // ===================================
  // Schema Management (remote mode overrides)
  // ===================================

  /**
   * Arm/disarm DDL deferral — refused on the REMOTE face when arming, see
   * {@link refuseRemoteDeferredDdl}. None of the remote schema doors below reads
   * the flag, so accepting it here would promise a dry run nothing keeps.
   * Disarming is accepted (it is what the flag already is), and local / replica
   * modes inherit the Knex deferral unchanged.
   */
  override setDeferredDdl(deferred: boolean): void {
    if (deferred && this.isRemote) refuseRemoteDeferredDdl();
    super.setDeferredDdl(deferred);
  }

  /**
   * Detect managed-schema drift — refused on the REMOTE face, see
   * {@link refuseRemoteDriftDetection}. The inherited detector reads the
   * physical schema through `this.knex`, which remote mode builds with no
   * connection; with no `objects` it walks a registry no remote schema door
   * fills and answers `[]`. Refused with or without explicit `objects`, because
   * neither can judge the remote database. Local and replica modes inherit the
   * Knex detector unchanged.
   *
   * The parameter repeats the base's declared shape key for key rather than
   * deriving it (`check:object-def-param-keys` arm C), so the keys a caller may
   * pass stay visible on this override's own declaration.
   */
  override async detectManagedDrift(
    objects?: Array<{ name: string; fields?: Record<string, any>; indexes?: any[] }>,
  ): ReturnType<SqlDriver['detectManagedDrift']> {
    if (this.isRemote) refuseRemoteDriftDetection();
    return super.detectManagedDrift(objects);
  }

  /**
   * Plan the ADR-0104 media column move — refused on the REMOTE face, see
   * {@link refuseRemoteMediaColumnMove}. The inherited planner walks
   * `managedObjectFields`, which no remote schema door fills, and probes each
   * table through `this.knex`, which remote mode builds with no connection, so
   * its remote answer is an empty scan. Local and replica modes inherit the
   * Knex planner unchanged.
   */
  override async planMediaColumnMove(): ReturnType<SqlDriver['planMediaColumnMove']> {
    if (this.isRemote) refuseRemoteMediaColumnMove();
    return super.planMediaColumnMove();
  }

  override async syncSchema(object: string, schema: unknown, options?: DriverOptions): Promise<void> {
    this.assertRemoteTransactionUnsupported(options, 'syncSchema');
    if (this.isRemote) {
      await this.remoteTransport!.syncSchema(object, schema);
      // Registration + canonical backfill, see completeRemoteSchemaSync(). Key
      // strictly by `object` (what find()/formatOutput look up) — never let a
      // stray `schema.name` shadow it.
      await this.completeRemoteSchemaSync([{ ...(schema as Record<string, any>), name: object }]);
      return;
    }
    return super.syncSchema(object, schema, options);
  }

  /**
   * Provision (CREATE/ALTER) physical tables for the given object definitions.
   *
   * In **remote** mode the base `SqlDriver.initObjects()` cannot be used because
   * it relies on Knex (`better-sqlite3`) to introspect and emit DDL — that
   * native binding is unavailable in serverless environments such as Vercel
   * Lambdas. Instead we route DDL through `RemoteTransport.syncSchemasBatch()`,
   * which uses `@libsql/client.batch()` against the Turso endpoint directly.
   *
   * In local / replica modes the existing Knex-based path remains in effect.
   *
   * ⛔ #16711 — this parameter type must declare every key `SqlDriver.initObjects`
   * declares, and `scripts/check-object-def-param-keys.mjs` fails the build if it
   * stops doing so. An `override` does NOT inherit the base's parameter type, so
   * this literal is what every caller of `@objectstack/driver-turso` sees: while
   * it read `{ name; fields? }`, #4311's `tenancy` fix sat on the base for five
   * weeks and was invisible from outside `@objectstack/driver-sql`, and #16570's
   * `indexes` fix would have escaped the same way. The escape is silent because
   * TypeScript's excess-property check fires on a FRESH object literal only — and
   * the remote arm below forwards the WHOLE object as `schema`, so the runtime
   * carried both keys the whole time and only the type face refused them.
   */
  override async initObjects(
    objects: Array<{
      name: string;
      fields?: Record<string, any>;
      tenancy?: any;
      indexes?: any[];
      lifecycle?: any;
    }>,
  ): Promise<void> {
    if (this.isRemote) {
      if (objects.length === 0) return;
      await this.remoteTransport!.syncSchemasBatch(
        objects.map((obj) => ({ object: obj.name, schema: obj })),
      );
      // Remote DDL bypasses SqlDriver.initObjects, which is what normally
      // populates the boolean/json/date/numeric read-coercion registries and
      // runs the canonical temporal backfill. Without the registration a
      // boolean reads back as raw 0/1, JSON as a string, dates as raw text.
      // (Root cause of the 2026-07-06 case_escalation `1 != true` incident.)
      await this.completeRemoteSchemaSync(objects);
      return;
    }
    return super.initObjects(objects);
  }

  /**
   * Batch-synchronize multiple schemas in a single round-trip.
   *
   * In remote mode, delegates to `RemoteTransport.syncSchemasBatch()` which
   * uses `client.batch()` to submit all DDL as one network call, then finishes
   * exactly as the other two remote doors do (see
   * {@link completeRemoteSchemaSync}). This is the door `ObjectQLPlugin`'s boot
   * sync takes on this driver, so it is the one that decides what a booted
   * remote app reads back.
   * In local/replica mode, falls back to sequential `syncSchema()` calls
   * (Knex + better-sqlite3 is already local, so batching has no benefit).
   */
  async syncSchemasBatch(schemas: Array<{ object: string; schema: unknown }>, options?: DriverOptions): Promise<void> {
    this.assertRemoteTransactionUnsupported(options, 'syncSchemasBatch');
    if (this.isRemote) {
      await this.remoteTransport!.syncSchemasBatch(schemas);
      // Key strictly by `object`, as syncSchema() does: it is the name the
      // engine hands every later read and write for this table.
      await this.completeRemoteSchemaSync(
        schemas.map(({ object, schema }) => ({ ...(schema as Record<string, any>), name: object })),
      );
      return;
    }
    // Local/replica fallback: sequential sync (already fast with local SQLite)
    for (const { object, schema } of schemas) {
      await super.syncSchema(object, schema, options);
    }
  }

  override async dropTable(object: string, options?: DriverOptions): Promise<void> {
    this.assertRemoteTransactionUnsupported(options, 'dropTable');
    if (this.isRemote) return this.remoteTransport!.dropTable(object);
    return super.dropTable(object, options);
  }

  // ===================================
  // Inherited SqlDriver members (remote mode overrides)
  // ===================================
  //
  // [#20055] The public `SqlDriver` members this class used to inherit with no
  // remote arm. {@link REMOTE_FACE_ANSWERS} lists every public member and how
  // this face answers it; the overrides below are the rows that changed. Each
  // local and embedded-replica arm is the inherited Knex member, unchanged.

  /**
   * Distinct values of one field — answered on the REMOTE face by a
   * `SELECT DISTINCT` the transport compiles ({@link RemoteTransport.compileDistinct}),
   * with the filter put into storage form by {@link toRemoteFilter} as for
   * `find()`. After the read it does what `SqlDriver.distinct` does, with the
   * base's own members: the backend-fault classifier around the execution only,
   * and the `find()` presentation of each value, deduplicated.
   *
   * A tenant-scoped call is refused. `SqlDriver.distinct` puts the tenant scope
   * on its statement, and {@link RemoteTransport.compileDistinct} carries none,
   * so an answer would list every organization's values for the column. The
   * condition is the scope's own: a non-empty `tenantId` on an object with a
   * tenant field.
   *
   * [#21226] The other remote read doors now carry the scope
   * ({@link remoteTenantScope}). This one still refuses: answering the scoped
   * call instead would accept a call the face refuses today, a widening this
   * change does not make.
   */
  override async distinct(
    object: string,
    field: string,
    filters?: FilterCondition,
    options?: DriverOptions,
  ): ReturnType<SqlDriver['distinct']> {
    this.assertRemoteTransactionUnsupported(options, 'distinct');
    if (!this.isRemote) return super.distinct(object, field, filters, options);
    const tenantId = options?.tenantId;
    if (tenantId !== undefined && tenantId !== null && tenantId !== '' && this.resolveTenantField(object)) {
      refuseRemoteInheritedMember(
        'A tenant-scoped `distinct()`',
        'this driver cannot list only the values one organization may read.',
        'The remote arm of `distinct()` sends its statement through the libSQL client and does not ' +
          'apply the SQL driver\'s tenant scope (`options.tenantId` on an object with a tenant ' +
          'column), so an answer would list every organization\'s values for this column.',
        'The same call without `tenantId`, or on an object with no tenant column, is answered on ' +
          'this face. Use the local or embedded-replica transport for a tenant-scoped one.',
      );
    }
    // Compiled outside the classifier, so a filter refusal keeps its envelope.
    const table = this.remoteTableFor(object, 'distinct');
    const { sql, args } = this.remoteTransport!.compileDistinct(object, field, this.toRemoteFilter(object, filters), table);
    let rows: unknown;
    try {
      rows = await this.remoteTransport!.execute(sql, args);
    } catch (error) {
      throw this.distinctBackendFault(object, field, error, filters);
    }
    const values = (rows as Array<Record<string, unknown>>).map((row) => row[field]);
    const kind = this.readPresentationKind(object, field);
    if (!kind) return values;
    return [...new Set(values.map((value) => this.presentReadValue(kind, value)))];
  }

  /**
   * Window-function reads — refused on the REMOTE face. The door compiles
   * through the Knex query builder (`buildWindowFunction` included) and runs on
   * the Knex connection, and the transport's compiler has no window syntax, so
   * a remote answer would be a second window-function compiler.
   */
  override async findWithWindowFunctions(
    object: string,
    query: SqlWindowFunctionQuery,
    options?: DriverOptions,
  ): ReturnType<SqlDriver['findWithWindowFunctions']> {
    if (this.isRemote) {
      refuseRemoteInheritedMember(
        'A window-function read (`findWithWindowFunctions()`)',
        'this driver cannot compute windowed rows over the remote database.',
        `The window door compiles its query with the SQL driver's Knex query builder and runs it on the ` +
          `Knex connection. ${REMOTE_HAS_NO_KNEX_CONNECTION} The remote transport's own compiler has ` +
          'no window-function syntax.',
        'Use the local or embedded-replica transport for window-function reads, or send the window ' +
          'statement through `execute()`, which this face runs on the remote database.',
      );
    }
    return super.findWithWindowFunctions(object, query, options);
  }

  /**
   * Query plans — refused on the REMOTE face, and `explain()` with it (the
   * base `explain()` calls this). The inherited member compiles the query with
   * the Knex builder and runs `EXPLAIN QUERY PLAN` on the Knex connection. It
   * resolved here with that statement and an error in place of a plan, and the
   * statement was not the one this face runs: remote reads are compiled by
   * `RemoteTransport`. A remote plan would need the transport to hand out its
   * compiled statement, and neither door has a caller in this repository.
   */
  override async analyzeQuery(
    object: string,
    query: DriverQuery,
    options?: DriverOptions,
  ): ReturnType<SqlDriver['analyzeQuery']> {
    if (this.isRemote) {
      refuseRemoteInheritedMember(
        'Query plan analysis (`explain()` / `analyzeQuery()`)',
        'this driver cannot show the plan of a statement it runs against the remote database.',
        'The plan is read by compiling the query with the SQL driver\'s Knex query builder and running ' +
          `\`EXPLAIN QUERY PLAN\` on the Knex connection. ${REMOTE_HAS_NO_KNEX_CONNECTION} The ` +
          'statement that builder compiles is also not the one this face runs, because remote reads ' +
          'are compiled by the remote transport.',
        'To read a plan, run the query against the local or embedded-replica transport over a copy ' +
          'of this database.',
      );
    }
    return super.analyzeQuery(object, query, options);
  }

  /**
   * Schema introspection — refused on the REMOTE face. The inherited member
   * reads every table's columns, foreign keys, primary keys and unique
   * constraints through Knex (`columnInfo()` and the SQLite pragmas), so a
   * remote answer would be a second copy of those four readers, the copy
   * {@link refuseRemoteDriftDetection} declines for drift. Its callers already
   * treat a throw as "could not introspect": the datasource connection test
   * answers `ok: false` with this message, and the federation validation sweep
   * rows the datasource `unreachable`.
   */
  override async introspectSchema(): Promise<IntrospectedSchema> {
    if (this.isRemote) {
      refuseRemoteInheritedMember(
        'Schema introspection (`introspectSchema()`)',
        'this driver cannot list the tables and columns the remote database holds.',
        'Introspection reads the physical schema through the SQL driver\'s Knex connection. ' +
          `${REMOTE_HAS_NO_KNEX_CONNECTION} The call used to fail with knex's "Unable to acquire a ` +
          'connection", which reads as a connectivity fault; the remote database was never asked.',
        'To introspect this database, point a datasource at a local SQLite copy of it (a `file:` URL) ' +
          'or at an embedded replica (a `file:` URL with `syncUrl`); both read the physical schema.',
      );
    }
    return super.introspectSchema();
  }

  /**
   * The Knex instance — refused on the REMOTE face, where it has no connection:
   * a statement run on it failed with knex's `Unable to acquire a connection`.
   * `execute()` and {@link getLibsqlClient} are this face's raw doors.
   */
  override getKnex(): ReturnType<SqlDriver['getKnex']> {
    if (this.isRemote) {
      refuseRemoteInheritedMember(
        'Handing out the Knex instance (`getKnex()`)',
        'there is no connected Knex instance to give.',
        `${REMOTE_HAS_NO_KNEX_CONNECTION} A statement run on the instance this used to return failed ` +
          'with knex\'s "Unable to acquire a connection", which reads as a connectivity fault.',
        'Run raw statements through `execute()`, which this face sends to the remote database, or use ' +
          'the libSQL client itself through `getLibsqlClient()`.',
      );
    }
    return super.getKnex();
  }

  /**
   * Reclaim free pages — answered on the REMOTE face with the statement the
   * local face issues, `PRAGMA incremental_vacuum`, run to completion on the
   * remote database, in the raw door's envelope (`DATABASE_ERROR` / 500 if the
   * server refuses it). As on a local file, it returns pages only on a database
   * whose `auto_vacuum` is `INCREMENTAL`; the remote face does not set that
   * mode at connect, the local face does.
   *
   * The statement goes through the client's `executeMultiple()`, not
   * `execute()`. SQLite frees one page per step of this statement, and the
   * libSQL client's `execute()` steps a statement that declares no result
   * columns once and leaves it unfinished. Measured over a libSQL `file:`
   * client: the issuing connection read one page fewer (300 → 299), a second
   * connection read the freelist and the file size unchanged, and a row
   * written after the call on the same connection never reached the file.
   * `executeMultiple()` runs each statement to its end: a second connection
   * reads 300 → 0, and the later write lands. What a hosted libSQL server does
   * with either call is not measured here.
   *
   * The free-page count is read first, through the raw door, which connects
   * the transport lazily as every remote door does. Nothing more is sent when
   * the freelist is empty.
   */
  override async reclaimSpace(options?: DriverOptions): Promise<void> {
    this.assertRemoteTransactionUnsupported(options, 'reclaimSpace');
    if (this.isRemote) {
      const transport = this.remoteTransport!;
      const count = 'PRAGMA freelist_count';
      let freePages: number;
      try {
        const rows = (await transport.execute(count)) as ArrayLike<ArrayLike<unknown>>;
        freePages = Number(rows[0]?.[0]);
      } catch (error) {
        throw this.rawStatementFault(count, error);
      }
      if (freePages === 0) return;
      const statement = 'PRAGMA incremental_vacuum';
      try {
        await transport.getClient()!.executeMultiple(statement);
      } catch (error) {
        throw this.rawStatementFault(statement, error);
      }
      return;
    }
    return super.reclaimSpace(options);
  }

  /**
   * `false` on the REMOTE face: the ADR-0057 Rotator creates, adopts and drops
   * shard tables through Knex, and remote schema sync builds a plain table for
   * an object declaring rotation. The lifecycle service reads this bit, and on
   * `false` it enforces the same `shards × unit` window with an age-based reap,
   * the path it keeps for a driver that cannot shard. It used to read `true`
   * here (the base answers from the SQLite dialect), so the service called
   * {@link rotateShards}, which failed, and the window went unenforced.
   */
  override get supportsRotation(): boolean {
    return !this.isRemote && super.supportsRotation;
  }

  /**
   * The ADR-0057 Rotator — refused on the REMOTE face, for the reason
   * {@link supportsRotation} gives. The parameter repeats the base's declared
   * shape key for key (`check:object-def-param-keys` arm C).
   */
  override async rotateShards(
    objectDef: { name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[]; lifecycle?: any },
    nowMs?: number,
  ): ReturnType<SqlDriver['rotateShards']> {
    if (this.isRemote) {
      refuseRemoteInheritedMember(
        'Data-lifecycle shard rotation (`rotateShards()`)',
        'this driver cannot create, adopt or drop the time-sharded tables of an object that declares ' +
          'a rotation storage policy.',
        `Rotation issues its DDL through the SQL driver's Knex connection. ${REMOTE_HAS_NO_KNEX_CONNECTION} ` +
          'Remote schema sync creates a plain table for such an object, and this face reports ' +
          '`supportsRotation: false`, so the lifecycle service enforces the same retention window ' +
          'with an age-based reap instead of calling this.',
        'Use the local or embedded-replica transport where physical rotation is wanted.',
      );
    }
    return super.rotateShards(objectDef, nowMs);
  }

  /**
   * Apply drift entries — refused on the REMOTE face. Every entry is applied
   * through Knex. The inherited member resolved here, reporting a destructive
   * entry its caller had allowed as `skipped` (its SQLite rebuild caught the
   * connection failure), so the answer read like a policy decision. The entries
   * come from {@link detectManagedDrift}, which this face refuses too. The
   * option parameter repeats the base's declared shape (`check:object-def-param-keys`).
   */
  override async applyMigrationEntries(
    entries: ManagedDriftEntry[],
    opts: { allowDestructive?: boolean } = {},
  ): ReturnType<SqlDriver['applyMigrationEntries']> {
    if (this.isRemote) {
      refuseRemoteInheritedMember(
        'Applying schema migration entries (`applyMigrationEntries()`)',
        'this driver cannot change the physical schema of the remote database from a drift report.',
        `The entries are applied through the SQL driver's Knex connection. ${REMOTE_HAS_NO_KNEX_CONNECTION} ` +
          'Until this change the call answered as if it had run, with every entry reported ' +
          '`skipped`, including a destructive entry that `allowDestructive` permitted.',
        'An ordinary boot against this datasource (`os serve` / `os start`) performs the additive ' +
          'schema sync directly. A change that needs a table rebuild or a dropped column has no ' +
          'remote path in this driver.',
      );
    }
    return super.applyMigrationEntries(entries, opts);
  }

  /**
   * `false` on the REMOTE face, the member's own "not taken" answer. Only the
   * Knex `initObjects` asks the ADR-0104 resolver, and no remote schema door
   * reaches it, so on this face the resolver would be kept and never asked:
   * this driver writes media columns in the JSON encoding whatever it would
   * answer (`turso-remote-media-column-move-refusal.test.ts`). The member used
   * to answer `true` here, telling the caller the resolver was installed.
   */
  override setFileColumnsMovedResolver(resolve: () => boolean | Promise<boolean>): boolean {
    if (this.isRemote) return false;
    return super.setFileColumnsMovedResolver(resolve);
  }

  // ===================================
  // Turso-specific: Embedded Replica Sync
  // ===================================

  /**
   * Trigger manual sync of the embedded replica with the remote primary.
   * No-op if no syncUrl is configured or libSQL client is not initialized.
   *
   * Bounded by `TursoDriverConfig.timeout` when one is set: a sync that has not
   * completed within the window rejects with the `TIMEOUT` / 504 envelope. This
   * is the replica arm's whole share of that key — the native binding runs the
   * sync and offers neither a `fetch` seam nor cancellation, so the bound is on
   * what the caller awaits (see `boundedBy`).
   */
  async sync(): Promise<void> {
    if (!(this.libsqlClient && this.tursoConfig.syncUrl)) return;
    const timeoutMs = timeoutWindow(this.tursoConfig);
    if (timeoutMs === undefined) {
      await this.libsqlClient.sync();
      return;
    }
    await boundedBy(this.libsqlClient.sync(), timeoutMs, 'embedded replica sync');
  }

  /**
   * Check if embedded replica sync is configured and active.
   */
  isSyncEnabled(): boolean {
    return !!this.tursoConfig.syncUrl && this.libsqlClient !== null;
  }

  /**
   * Get the underlying @libsql/client instance (if available).
   * Available in both remote and replica modes after connect().
   */
  getLibsqlClient(): Client | null {
    return this.libsqlClient;
  }

  /**
   * Get the RemoteTransport instance (only available in remote mode).
   */
  getRemoteTransport(): RemoteTransport | null {
    return this.remoteTransport;
  }
}
