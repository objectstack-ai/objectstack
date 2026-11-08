// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Class head: dialect probes, logger, configuration"
 * section of `SqlDriver`: the bodies of `logger`, `logDurabilityFailure`,
 * `emissionClients`, `clientSpelling`, `insertReturnsStoredRows`,
 * `aliasIdentifierSql`, `dateGranularityCapabilities`, `dateBucketSql`,
 * `knexConfigFor`, `withConnectBound`, `withUtcSession`,
 * `withMysqlCalendarDayAsText`, `withPostgresCalendarDayAsText`,
 * `installQueryTiming`, `assertSchemaMutable`, `assertDialectEmits` moved out
 * of `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link ClassHeadFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link ClassHeadHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `classHeadHost` in
 * `sql-driver-facet-hosts.ts`, built once per driver by the class's static
 * block. Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * driver.
 *
 * `SqlDriver` here is `SqlDriverStatics` (imported AS `SqlDriver`): forwarders to the
 * statics the bodies read, private ones included, which the class fills in a
 * static block; the class as a type is `SqlDriverClass`.
 *
 * Values that stayed in `sql-driver.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import type { DateGranularityValue } from '@objectstack/spec/data';
import { ExternalSchemaModeViolationError } from '@objectstack/spec/shared';
import { UnsupportedDialectEmissionError } from './dialect-emission-refusal.js';
import type { Knex } from 'knex';
import { currentPerfTiming, perfNow } from '@objectstack/observability';
import type { PerfTiming } from '@objectstack/observability';
import { resolveSqliteAbsentFileTarget } from './sql-driver-top-level.js';
import type { SqliteAbsentFileMode } from './sql-driver-top-level.js';
import { SqlDriverStatics as SqlDriver } from './sql-driver.js';
import type { SqlDriver as SqlDriverClass } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link ClassHeadFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface ClassHeadHost {
  assertDialectEmits: SqlDriverClass['assertDialectEmits'];
  buildDateBucketExpr: SqlDriverClass['buildDateBucketExpr'];
  readonly config: SqlDriverClass['config'];
  readonly isMysql: SqlDriverClass['isMysql'];
  readonly isMssql: SqlDriverClass['isMssql'];
  readonly isPostgres: SqlDriverClass['isPostgres'];
  readonly isSqlite: SqlDriverClass['isSqlite'];
  readonly knex: SqlDriverClass['knex'];
  readonly logger: SqlDriverClass['logger'];
  openedEmptyInMemory: SqlDriverClass['openedEmptyInMemory'];
  readonly schemaMode: SqlDriverClass['schemaMode'];
}

/** The bodies of the "Class head: dialect probes, logger, configuration" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class ClassHeadFacet {
  /** The initializer of `SqlDriver#logger`; the field's declaration there is its contract. */
  static logger(): SqlDriverClass['logger'] {
    return {
    warn: (msg, meta) => console.warn(msg, meta ?? ''),
    error: (msg, meta) => console.error(msg, meta ?? ''),
  };
  }

  /** The body of `SqlDriver#logDurabilityFailure`; the method's docblock there is its contract. */
  static logDurabilityFailure(this: Pick<ClassHeadHost, 'logger'>, msg: string, meta?: any): void {
    if (this.logger.error) this.logger.error(msg, meta);
    else this.logger.warn(msg, meta);
  }

  /** The body of `SqlDriver#emissionClients`; the method's docblock there is its contract. */
  static emissionClients(): string[] {
    return [
      ...SqlDriver.SQLITE_EMIT_CLIENTS,
      ...SqlDriver.POSTGRES_EMIT_CLIENTS,
      ...SqlDriver.MYSQL_EMIT_CLIENTS,
    ].sort();
  }

  /**
   * The configured client as a STRING, or `''`.
   *
   * `Knex.Config['client']` also admits a Client CONSTRUCTOR (knex's documented
   * bring-your-own-dialect hatch). Such a value names no spelling in any table
   * here, and `''` is how it says so — the same answer the literal comparisons
   * this replaces gave, without stringifying a class to get there.
   */
  static clientSpelling(config: unknown): string {
    const c = (config as { client?: unknown } | null | undefined)?.client;
    return typeof c === 'string' ? c : '';
  }

  /** The body of `SqlDriver#insertReturnsStoredRows`; the method's docblock there is its contract. */
  static insertReturnsStoredRows(this: Pick<ClassHeadHost, 'isMssql' | 'isPostgres' | 'isSqlite'>): boolean {
    return this.isSqlite || this.isPostgres || this.isMssql;
  }

  /** The body of `SqlDriver#aliasIdentifierSql`; the method's docblock there is its contract. */
  static aliasIdentifierSql(this: Pick<ClassHeadHost, 'knex'>, alias: string): string {
    return (this.knex.client as { wrapIdentifier(value: string): string }).wrapIdentifier(String(alias));
  }

  /** The body of `SqlDriver#dateGranularityCapabilities`; the method's docblock there is its contract. */
  static dateGranularityCapabilities(this: Pick<ClassHeadHost, 'isMysql' | 'isPostgres' | 'isSqlite'>): Record<string, boolean> {
    if (this.isPostgres) {
      return { day: true, month: true, quarter: true, year: true, week: true };
    }
    if (this.isMysql) {
      return { day: true, month: true, quarter: true, year: true, week: true };
    }
    if (this.isSqlite) {
      // [#21595] All five, `week` included. The ISO week is computed by the
      // Thursday rule through date modifiers (the `week` arm of
      // `buildDateBucketExpr`), never `strftime('%V')` / `'%G'`: those arrived
      // in SQLite 3.46, and libSQL (`driver-turso`) bundles an older engine.
      // Measured: better-sqlite3 13.0.3 runs 3.53.4, `@libsql/client` 0.18.0
      // runs 3.45.1 (where `%V` answers NULL), sql.js 1.14.2
      // (`driver-sqlite-wasm`) runs 3.49.1. The expression runs on all three.
      return { day: true, month: true, quarter: true, year: true, week: true };
    }
    return {};
  }

  /** The body of `SqlDriver#dateBucketSql`; the method's docblock there is its contract. */
  static dateBucketSql(this: Pick<ClassHeadHost, 'buildDateBucketExpr' | 'knex'>, objectName: string, field: string, granularity: DateGranularityValue): string | null {
    const bucket = this.buildDateBucketExpr(field, granularity, objectName);
    return bucket ? this.knex.raw(bucket.sql, bucket.bindings).toQuery() : null;
  }

  /**
   * Apply {@link SqliteAbsentFileMode} to the Knex config, redirecting a
   * missing SQLite file to `:memory:` before Knex ever opens it.
   *
   * Has to happen HERE rather than in `connect()`: the filename is baked into
   * the Knex instance at construction, and better-sqlite3 opens (and therefore
   * creates) the file on the first statement — which for this driver is the
   * `PRAGMA auto_vacuum` in {@link connect}.
   *
   * A file the judgement refuses — one that can be neither opened nor created
   * (#24961) — throws its `SqliteDatabaseFileError` out of the constructor, so
   * no Knex instance is ever built over it.
   *
   * Only a SQLite client is asked (#24961). A server dialect's `connection`
   * string is a URL, never a filename: handed to the judgement it read as an
   * absent file, and a `pg` driver given this option had its connection string
   * rewritten to `:memory:` — against {@link SqlDriverConfig.sqliteAbsentFile}'s
   * "ignored for non-SQLite dialects".
   */
  static knexConfigFor(this: Pick<ClassHeadHost, 'isSqlite' | 'openedEmptyInMemory'>, knexConfig: Knex.Config, mode: SqliteAbsentFileMode | undefined): Knex.Config {
    if (mode !== 'empty-in-memory' || !this.isSqlite) return knexConfig;
    const conn = (knexConfig as { connection?: unknown }).connection;
    const declared = typeof conn === 'string' ? conn : (conn as { filename?: unknown })?.filename;
    if (typeof declared !== 'string') return knexConfig;
    const resolved = resolveSqliteAbsentFileTarget(declared, mode);
    if (!resolved.openedEmptyInMemory) return knexConfig;
    this.openedEmptyInMemory = true;
    return {
      ...knexConfig,
      connection: typeof conn === 'string'
        ? resolved.filename
        : { ...(conn as object), filename: resolved.filename },
    } as Knex.Config;
  }

  /** The body of `SqlDriver#withConnectBound`; the method's docblock there is its contract. */
  static withConnectBound(knexConfig: Record<string, any>): Record<string, any> {
    const pool = knexConfig.pool as Record<string, any> | undefined;
    const bounded: Record<string, any> =
      pool?.createTimeoutMillis === undefined
        ? {
          ...knexConfig,
          pool: { ...(pool ?? {}), createTimeoutMillis: SqlDriver.DEFAULT_CREATE_TIMEOUT_MS },
        }
        : { ...knexConfig }; // host chose its own bound — respect it

    // `!dialect` — sqlite, or a client with no connect-timeout knob — means
    // there is no TIMEOUT to inject. It deliberately does not skip the session
    // pins below: those answer a different question (what does a value MEAN on
    // this connection), and the two lists are not the same list.
    //
    // ⚠️ The worked example that used to stand here was RETIRED by #11784,
    // which gave `redshift` the connect-timeout row it was missing. Until then
    // `redshift` was in {@link POSTGRES_WIRE_CLIENTS} (so it needed #11389's
    // calendar-day pin) yet absent from {@link DIALECT_CONNECT_TIMEOUT} — so a
    // `return` placed at this point silently opted it out of a fix it needed.
    // That was measured, not hypothetical, which is why the example is recorded
    // here rather than dropped.
    //
    // The hazard outlives the example. Every client needing a session pin
    // happens to have a timeout row TODAY; that is current membership, not a
    // property either table promises. The next pg-wire client added without a
    // connect-timeout knob restores the exact bug — and it would fail the way
    // this one did, in silence, with every test green. So: no `return` here,
    // and the two tables stay separate. The tripwire that goes red the moment
    // those memberships diverge again lives in
    // `sql-driver-11389-date-tz-skew.test.ts`.
    const dialect = SqlDriver.DIALECT_CONNECT_TIMEOUT[String(knexConfig.client ?? '')];
    if (dialect) {
      const conn = knexConfig.connection;
      if (typeof conn === 'string') {
        // The URL must move into the dialect's own URL slot so the timeout can
        // ride alongside it. Verified for both dialects: the connection attempt
        // still goes to the URL's host/port, `?sslmode=` is still honoured.
        bounded.connection = {
          [dialect.urlKey]: conn,
          [dialect.key]: SqlDriver.DEFAULT_CONNECT_TIMEOUT_MS,
        };
      } else if (conn && typeof conn === 'object' && (conn as any)[dialect.key] === undefined) {
        bounded.connection = { ...(conn as object), [dialect.key]: SqlDriver.DEFAULT_CONNECT_TIMEOUT_MS };
      }
      // A function-valued `connection` (knex's per-acquire provider) is left
      // alone: the host is building each connection itself and owns its timeouts.
    }
    return SqlDriver.withPostgresCalendarDayAsText(
      SqlDriver.withMysqlCalendarDayAsText(SqlDriver.withUtcSession(bounded)),
    );
  }

  /**
   * Pin a MySQL connection to UTC, in both directions (#3942).
   *
   * MySQL is the one supported dialect where the SESSION timezone participates
   * in what a datetime means, on two independent layers, and both default to
   * something machine-dependent:
   *
   *   - **mysql2** (`connection.timezone`, default `'local'`) decides how a bound
   *     JS `Date` is rendered and how a returned `DATETIME` string is parsed back.
   *     Left at `'local'`, two app servers in different zones write the same
   *     instant as different values, and read the same row as different instants.
   *   - **The server** (`@@session.time_zone`, default `SYSTEM`) decides how a
   *     zone-naive literal is interpreted for a `TIMESTAMP` column, and what
   *     `CURRENT_TIMESTAMP` renders. Measured at 8 hours off on a server
   *     configured `+08:00`.
   *
   * Setting both to UTC makes the wall clock the driver writes *be* the instant,
   * which is what {@link mysqlDatetimeLiteral} relies on — and it keeps legacy
   * `TIMESTAMP` columns correct too, so a deployment stays right whether or not
   * the `DATETIME(3)` migration has run.
   *
   * A host that set either one explicitly is left alone; an existing
   * `pool.afterCreate` is chained rather than replaced, since it is a documented
   * knex extension point the host may already be using.
   */
  static withUtcSession(knexConfig: Record<string, any>): Record<string, any> {
    // The MySQL identity question again, asked from a static: the same set
    // `isMysql` reads, not a fourth hand-written copy of it (#11550).
    if (!SqlDriver.MYSQL_EMIT_CLIENTS.has(SqlDriver.clientSpelling(knexConfig))) return knexConfig;

    const out: Record<string, any> = { ...knexConfig };
    const conn = out.connection;
    if (conn && typeof conn === 'object' && (conn as any).timezone === undefined) {
      out.connection = { ...(conn as object), timezone: 'Z' };
    }

    const pool = (out.pool ?? {}) as Record<string, any>;
    const hostAfterCreate = pool.afterCreate as
      | ((conn: unknown, done: (err?: unknown) => void) => void)
      | undefined;
    out.pool = {
      ...pool,
      afterCreate(connection: any, done: (err?: unknown, conn?: unknown) => void) {
        connection.query(`SET time_zone = '+00:00'`, (err: unknown) => {
          if (err) return done(err);
          if (!hostAfterCreate) return done(undefined, connection);
          hostAfterCreate(connection, (hostErr?: unknown) => done(hostErr, connection));
        });
      },
    };
    return out;
  }

  /**
   * Keep a MySQL `DATE` a calendar-day STRING, never a JS `Date` (#20280).
   *
   * The MySQL counterpart of {@link withPostgresCalendarDayAsText}: the wire
   * form of a `DATE` IS `YYYY-MM-DD`, so the driver asks mysql2 for that text
   * (`dateStrings: ['DATE']`) and presents it through {@link toDateOnly} —
   * `@objectstack/core`'s `temporalStorageForm`, the rule the write and
   * `where` paths already apply. A `date` column then reaches the read doors
   * as TEXT on every dialect.
   *
   * ## The measurement
   *
   * mysql2 3.23's `Packet#parseDate` rebuilds a `DATE` from its three numbers:
   * `new Date(Date.UTC(y, m - 1, d))` under the `timezone: 'Z'` pin of
   * {@link withUtcSession}, `new Date(y, m - 1, d)` under the default
   * `'local'`. Both constructors read a year from 0 to 99 as 1900 + year.
   * Measured on MySQL 8.0.46 (server `time_zone='+08:00'`) through `find()`:
   *
   * | stored (`CAST(d AS CHAR)`) | mysql2 materialised | presented before | presented now |
   * |---|---|---|---|
   * | `0009-03-04` | `1909-03-04T00:00:00.000Z` | `1909-03-04` | `0009-03-04` |
   * | `0099-03-04` | `1999-03-04T00:00:00.000Z` | `1999-03-04` | `0099-03-04` |
   * | `0999-06-15` | `0999-06-15T00:00:00.000Z` | `0999-06-15` | `0999-06-15` |
   * | `2026-03-04` | `2026-03-04T00:00:00.000Z` | `2026-03-04` | `2026-03-04` |
   *
   * The write was right and the read was wrong: `where d $eq '0009-03-04'`
   * found the row and presented `1909-03-04`. A year from 1000 to 9999 presents
   * exactly what it did. A zero day (`0000-00-00`, storable only with
   * `NO_ZERO_DATE` off) presents as that text, where mysql2 invented
   * `1899-11-30`.
   *
   * ## Why `DATE` and not `DATETIME`
   *
   * `dateStrings` also takes `'DATETIME'`, and a `DATETIME` in years 0..99 is
   * misread too: `parseDateTime` hands `'0009-03-04 10:00:00.000Z'` to V8's
   * non-ISO `Date` parser, which answers 2004-09-03. But a `DATETIME` is an
   * instant, and ADR-0053 D-F2 keeps the client parser's `Date` for an instant,
   * folded to text only at the driver's own read doors — text at the client
   * parser is the option that ADR did not take. That half is not decided here.
   *
   * The other measured remedy, a `'+00:00'` zone, takes mysql2's padded
   * string-constructor arm for a `DATE` but keeps the `Date`, and moves the
   * zone every bound `Date` and every `DATETIME` is rendered in. The text is
   * the narrower change, and it is how PostgreSQL already reads a day.
   *
   * A host that set `dateStrings` itself is left alone, as
   * {@link withUtcSession} leaves an explicit `timezone`; so is a
   * function-valued `connection`, which the host builds per acquire.
   */
  static withMysqlCalendarDayAsText(knexConfig: Record<string, any>): Record<string, any> {
    if (!SqlDriver.MYSQL_EMIT_CLIENTS.has(SqlDriver.clientSpelling(knexConfig))) return knexConfig;

    const conn = knexConfig.connection;
    if (!conn || typeof conn !== 'object' || (conn as any).dateStrings !== undefined) return knexConfig;
    return {
      ...knexConfig,
      connection: { ...(conn as object), dateStrings: [...SqlDriver.MYSQL_TEXT_TEMPORAL_TYPES] },
    };
  }

  /**
   * Keep a Postgres `date` a calendar-day STRING, never a JS `Date` (#11389).
   *
   * This is the Postgres counterpart of {@link withUtcSession}, and it exists
   * for the same reason: the value a driver materialises must not depend on
   * which machine's clock the Node process happens to be running.
   *
   * ## The measurement
   *
   * `node-postgres` parses OID 1082 with `new Date(y, m - 1, d)` — **local**
   * midnight. `SqlDriver#toDateOnly` reads a `Date` with UTC components (its
   * documented contract, see there), so on a process east of UTC the two
   * disagree by a calendar day. Measured on PostgreSQL 16, one stored row
   * `d = '2026-08-24'`, only the process `TZ` changed:
   *
   * | process TZ | pg materialises | `toDateOnly` returned |
   * |---|---|---|
   * | `UTC` | `2026-08-24T00:00:00.000Z` | `2026-08-24` |
   * | `America/New_York` | `2026-08-24T04:00:00.000Z` | `2026-08-24` |
   * | `Asia/Shanghai` | `2026-08-23T16:00:00.000Z` | **`2026-08-23`** |
   *
   * West of UTC the UTC components happen to name the right day, which is why
   * the `Temporal Conformance (live PG + MySQL)` job — pinned at
   * `TZ=America/New_York` — was green throughout. Only an east-of-UTC process
   * zone can fail it, so the pin that guards this sweeps the process zone.
   *
   * ## Why the parser and not the reader
   *
   * The alternative — read local components in `toDateOnly` — was measured and
   * rejected: that helper is shared by the READ path (`formatOutput`,
   * `presentReadValue`), the WRITE path (`formatInput`) and the FILTER path
   * (`coerceFilterValue`), and the `Date`s they receive are on different
   * clocks. A caller's `new Date('2026-08-24')` is UTC midnight, so under
   * `TZ=America/New_York` local components read it as `2026-08-23` — the same
   * one-day error in the mirror direction, moved onto the write and filter
   * paths. Fixing it at the parser leaves exactly one clock in play, because
   * the driver then never produces a `Date` for a `date` column at all — which
   * is already how SQLite behaves (TEXT round-trip) and, via
   * {@link withMysqlCalendarDayAsText}, how mysql2 behaves. (Before that,
   * {@link withUtcSession}'s `timezone: 'Z'` kept mysql2's `Date` on the one
   * UTC clock, but read a year below 100 a century late.)
   *
   * `pool.afterCreate` is the hook rather than a `pg.types.setTypeParser`
   * call because `setTypeParser` mutates the pg-types registry **process
   * wide**, which would reach every other pg client in the host application.
   * A parser registered on the connection is scoped to the pools this driver
   * opened; a host's own `pg` clients keep the stock behaviour. `pg` is an
   * optional peer dependency and is never imported here — `setTypeParser` /
   * `getTypeParser` are read off the `pg.Client` knex hands the hook.
   *
   * `timestamptz` / `timestamp` are deliberately untouched here: those are
   * instants, and a `Date` is the right materialisation for them at the
   * CLIENT layer, where the wire text is parsed. It is not, however, what the
   * driver hands out of its read doors: [ADR-0053 D-F1/D-F2] (#13973) fold that
   * `Date` to the canonical `YYYY-MM-DDTHH:MM:SS.sssZ` text in `formatOutput`
   * / `presentReadValue`, so every dialect presents the instant the way
   * SQLite always has. This comment used to add that "`Field.datetime`
   * depends on" the `Date` materialisation; #13973 checked that on the tree
   * and it did not hold — nothing on the read path consumed the `Date` (the
   * SQLite-gated `formatOutput` never touched a datetime column on Postgres),
   * and every in-repo reader of the value already accepted the text form.
   * Canonicalising at the driver's own read boundary rather than at this
   * parser is the ruled shape: one clock stays in play here for `date`, the
   * instant types keep their stock parser, and no host `pg` client is touched.
   *
   * A host's existing `pool.afterCreate` is chained rather than replaced,
   * exactly as in {@link withUtcSession}.
   */
  static withPostgresCalendarDayAsText(knexConfig: Record<string, any>): Record<string, any> {
    if (!SqlDriver.POSTGRES_WIRE_CLIENTS.has(String(knexConfig.client ?? ''))) return knexConfig;

    const out: Record<string, any> = { ...knexConfig };
    const pool = (out.pool ?? {}) as Record<string, any>;
    const hostAfterCreate = pool.afterCreate as
      | ((conn: unknown, done: (err?: unknown) => void) => void)
      | undefined;
    out.pool = {
      ...pool,
      afterCreate(connection: any, done: (err?: unknown, conn?: unknown) => void) {
        const chain = (): void => {
          if (!hostAfterCreate) return done(undefined, connection);
          hostAfterCreate(connection, (hostErr?: unknown) => done(hostErr, connection));
        };
        // Not a `pg.Client` after all (a stub, a future knex shape): leave the
        // connection exactly as it was rather than failing the acquire.
        if (
          typeof connection?.setTypeParser !== 'function' ||
          typeof connection?.getTypeParser !== 'function'
        ) {
          return chain();
        }
        const parseTextArray = connection.getTypeParser(SqlDriver.PG_OID_TEXT_ARRAY, 'text');
        // The wire form of `date` IS `YYYY-MM-DD`; handing it back verbatim is
        // both the fix and the whole parser.
        connection.setTypeParser(SqlDriver.PG_OID_DATE, (text: string) => text);
        connection.setTypeParser(SqlDriver.PG_OID_DATE_ARRAY, parseTextArray);
        chain();
      },
    };
    return out;
  }

  /**
   * Per-request SQL query timing (perf-tuning mode). Correlates knex's
   * `query` → `query-response` / `query-error` events by `__knexQueryUid` and
   * folds each query's wall time into the ambient request collector's `db`
   * aggregate — one `Server-Timing` member carrying total DB time **and** a
   * query count, the number most useful for spotting N sequential round-trips
   * in DevTools → Network → Timing.
   *
   * Attribution is captured at `query` time, which runs inside the initiating
   * request's `AsyncLocalStorage` scope (knex emits it synchronously from the
   * runner after connection acquisition, still on the awaited call chain), so
   * concurrent requests never cross-attribute. When perf-tuning is off,
   * {@link currentPerfTiming} is `undefined` and the listener returns at once —
   * nothing is tracked and the map stays empty, so the cost is a single ALS
   * lookup per query.
   *
   * The aggregate records only durations and a count — never SQL text — so the
   * `Server-Timing` header can be surfaced without leaking query shapes to
   * non-admins. When an admin opts into DETAIL mode (`X-OS-Debug-Timing: json`,
   * admin-gated), each query's PARAMETRIZED statement (knex's `q.sql`, which
   * carries `?` placeholders — the bindings live separately and are NEVER
   * recorded) is additionally captured so the admin-only detail payload can list
   * the slowest queries by shape. Literal row values never enter the collector.
   */
  static installQueryTiming(this: Pick<ClassHeadHost, 'knex'>): void {
    // uid → { start, collector }, populated only while a collector is active,
    // and always removed when the query settles (bounded by in-flight queries).
    const inflight = new Map<string, { t0: number; timing: PerfTiming }>();
    this.knex.on('query', (q: any) => {
      const timing = currentPerfTiming();
      if (!timing) return;
      const uid = q?.__knexQueryUid;
      if (typeof uid === 'string') inflight.set(uid, { t0: perfNow(), timing });
    });
    const settle = (q: any): void => {
      const uid = q?.__knexQueryUid;
      if (typeof uid !== 'string') return;
      const rec = inflight.get(uid);
      if (!rec) return;
      inflight.delete(uid);
      const dur = perfNow() - rec.t0;
      rec.timing.count('db', dur, 'queries');
      // Admin-gated detail mode: keep the query SHAPE (parametrized SQL, no
      // bindings) so the slowest queries can be surfaced. `recordDetail` is a
      // no-op unless detail capture is on, so this is free on the normal path.
      if (rec.timing.detailEnabled && typeof q?.sql === 'string') {
        rec.timing.recordDetail('db', q.sql, dur);
      }
    };
    this.knex.on('query-response', (_response: any, q: any) => settle(q));
    this.knex.on('query-error', (_error: any, q: any) => settle(q));
  }

  /** The body of `SqlDriver#assertSchemaMutable`; the method's docblock there is its contract. */
  static assertSchemaMutable(this: Pick<ClassHeadHost, 'assertDialectEmits' | 'schemaMode'>, operation: string): void {
    if (this.schemaMode !== 'managed') {
      throw new ExternalSchemaModeViolationError(
        `DDL operation '${operation}' is forbidden: datasource schemaMode='${this.schemaMode}'. ` +
          `ObjectStack never mutates the schema of an external database.`,
      );
    }
    this.assertDialectEmits(operation);
  }

  /** The body of `SqlDriver#assertDialectEmits`; the method's docblock there is its contract. */
  static assertDialectEmits(this: Pick<ClassHeadHost, 'config'>, operation: string): void {
    const client = SqlDriver.clientSpelling(this.config);
    if (SqlDriver.MSSQL_FEDERATION_CLIENTS.has(client)) {
      throw new UnsupportedDialectEmissionError(client, operation, SqlDriver.emissionClients(), 'federation-only');
    }
    if (!SqlDriver.POSTGRES_WIRE_ONLY_CLIENTS.has(client)) return;
    throw new UnsupportedDialectEmissionError(client, operation, SqlDriver.emissionClients());
  }
}
