// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Oracle Database as a federation dialect (ADR-0015 §4.6): the knex client
 * this driver connects through, and the session it opens.
 *
 * Oracle is a READ identity in this driver — paging, identifier case, text
 * matching, value presentation, introspection and the double-opt-in write
 * path — and never a DDL target: `SqlDriver.assertDialectEmits` refuses
 * schema work on it by name, and `@objectstack/spec` refuses a managed Oracle
 * datasource at authoring. Minimum supported server: **Oracle Database 12c
 * Release 1** (12.1), the release that introduced the row-limiting clause
 * paging is compiled to. node-oracledb runs in Thin mode (pure JavaScript),
 * so no Oracle Client libraries are needed on the host.
 *
 * ## Paging: `OFFSET … ROWS FETCH NEXT … ROWS ONLY`
 *
 * knex's `oracledb` compiler pages with the pre-12c `ROWNUM` wrapper:
 *
 * ```sql
 * select * from (select row_.*, ROWNUM rownum_ from (<query>) row_
 *   where rownum <= ?) where rownum_ > ?
 * ```
 *
 * Measured on knex 3.3.0 against Oracle 23ai: an offset page answers every
 * row with an extra `ROWNUM_` column the object never declared. The client
 * below compiles the SQL:2008 row-limiting clause instead, appended after the
 * `ORDER BY` the driver always writes for a paged read, so a page holds the
 * object's own columns and nothing else.
 *
 * ## Instants: bound as `TIMESTAMP WITH TIME ZONE`, compared in a UTC session
 *
 * node-oracledb Thin reads and writes a zone-less `DATE` / `TIMESTAMP` in the
 * Node PROCESS's time zone (`new Date(y, m, d, h, …)` on the way in, local
 * getters on the way out — `lib/impl/datahandlers/buffer.js`). Measured under
 * `TZ=America/New_York`: a bound `2024-03-10T02:30:00.123Z` is stored as
 * `2024-03-09 21:30:00`, and the spring-forward wall clock `02:30` reads back
 * as `03:30`. The platform's canon is that a zone-less stored instant is UTC —
 * the same reading the MySQL `DATETIME` pin gives (`withUtcSession`) — so:
 *
 *  - every JavaScript `Date` binding is sent as `TIMESTAMP WITH TIME ZONE` at
 *    `+00:00` (UTC components, whatever the process zone), and
 *  - every connection runs `ALTER SESSION SET TIME_ZONE = 'UTC'`, because
 *    Oracle converts a `DATE` / `TIMESTAMP` column to a zoned value in the
 *    SESSION's zone when it is compared with one — Thin otherwise opens the
 *    session in the process zone.
 *
 *  - every zone-less column READ is presented as the UTC instant its wall
 *    clock names ({@link oracleWallClockAsUtc}), exact on every host whose
 *    process zone has no daylight-saving gap (`TZ=UTC` above all).
 */

import knex, { type Knex } from 'knex';

import type { SqlDialectName } from './schema-drift.js';
import { StandardErrorCode } from '@objectstack/spec/api';

import { withheldFilterError } from './sql-driver-top-level.js';

/** The knex client spellings this module serves — `SqlDriver.ORACLE_CLIENTS`' only member. */
export const ORACLE_KNEX_CLIENT = 'oracledb';

/**
 * The statement every pooled connection runs once, before its first query:
 *
 *  - `TIME_ZONE = 'UTC'` — the zone Oracle converts a zone-less column into
 *    when it meets a zoned bind (see the module docblock);
 *  - `NLS_COMP = BINARY` and `NLS_SORT = BINARY` — `=`, `LIKE` and `ORDER BY`
 *    compare code units, case-exact, whatever the database or the user's
 *    profile defaults to. Under `LINGUISTIC` / `BINARY_CI` Oracle's `LIKE`
 *    folds case, which would break the case-exact `$contains` contract
 *    without any statement changing.
 *
 * The NLS date formats are deliberately not set: no temporal value crosses the
 * wire as text, so none is parsed or rendered by them.
 */
export const ORACLE_SESSION_SETUP_SQL =
  `ALTER SESSION SET TIME_ZONE = 'UTC' NLS_COMP = 'BINARY' NLS_SORT = 'BINARY'`;

/**
 * The row-limiting clause, as a replacement for knex's ROWNUM wrapper. Bound
 * to a knex `oracledb` query compiler; `this.single` is the compiler's own
 * record of `.limit()` / `.offset()`, and `_getValueOrParameterFromAttribute`
 * is knex's binding helper (it honours `skipBinding`, so a `limit` the caller
 * asked to inline stays inline).
 */
function rowLimitingClause(this: any, query: string): string {
  const { limit, offset } = this.single as { limit?: unknown; offset?: unknown };
  const hasLimit = limit !== undefined && limit !== null && limit !== '';
  const hasOffset = offset !== undefined && offset !== null && offset !== '' && Number(offset) !== 0;
  if (!hasLimit && !hasOffset) return query;
  let out = query || '';
  if (hasOffset) out += ` offset ${this._getValueOrParameterFromAttribute('offset', Number(offset))} rows`;
  if (hasLimit) out += ` fetch next ${this._getValueOrParameterFromAttribute('limit', Number(limit))} rows only`;
  return out;
}

/** The node-oracledb type constants this module reads off the loaded driver. */
interface OracleTypeConstants {
  DB_TYPE_DATE?: unknown;
  DB_TYPE_TIMESTAMP?: unknown;
  DB_TYPE_RAW?: unknown;
  DB_TYPE_TIMESTAMP_TZ?: unknown;
}

/**
 * A zone-less value node-oracledb Thin materialised in the PROCESS zone, read
 * back as the UTC instant its wall clock names.
 *
 * Thin builds the `Date` with the local constructor
 * (`new Date(y, m - 1, d, h, mi, s, ms)`), so the local getters return the
 * stored wall clock exactly — for every wall clock that EXISTS in the process
 * zone. The one loss is a daylight-saving spring-forward gap: a stored
 * `02:30` on the night New York skips `02:00–03:00` is constructed as `03:30`
 * before this function sees it. Thin offers no hook ahead of that constructor
 * (a fetch type of `TIMESTAMP WITH TIME ZONE` is refused, NJS-119; one of
 * `… LOCAL TIME ZONE` converts client-side through the same local `Date` —
 * both measured), so the documented remedy is a host whose process zone has
 * no gap, `TZ=UTC`, under which this function is the identity.
 */
export function oracleWallClockAsUtc(value: unknown): unknown {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return value;
  return new Date(Date.UTC(
    value.getFullYear(), value.getMonth(), value.getDate(),
    value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds(),
  ));
}

/**
 * A `RAW(16)` value as the canonical lowercase, hyphenated UUID text — the
 * `uuid` column class `@objectstack/spec`'s type matrix assigns `RAW(16)`
 * (`SYS_GUID()` keys). Any other `RAW` width stays the `Buffer` node-oracledb
 * returns.
 */
export function oracleRaw16AsUuid(value: unknown): unknown {
  if (!(value instanceof Uint8Array) || value.length !== 16) return value;
  const hex = Buffer.from(value).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The `fetchTypeHandler` every statement this client runs is executed with
 * (unless a caller passed its own): zone-less `DATE` / `TIMESTAMP` columns
 * through {@link oracleWallClockAsUtc}, `RAW(16)` through
 * {@link oracleRaw16AsUuid}. Every other column is fetched as node-oracledb
 * fetches it.
 */
function oracleFetchTypeHandler(driver: OracleTypeConstants) {
  return (metaData: { dbType?: unknown; byteSize?: number }) => {
    if (metaData.dbType === driver.DB_TYPE_DATE || metaData.dbType === driver.DB_TYPE_TIMESTAMP) {
      return { converter: oracleWallClockAsUtc };
    }
    if (metaData.dbType === driver.DB_TYPE_RAW && metaData.byteSize === 16) {
      return { converter: oracleRaw16AsUuid };
    }
    return undefined;
  };
}

let cachedClient: (new (config: Knex.Config) => unknown) | undefined;

/**
 * The knex client class this driver hands knex for `client: 'oracledb'`.
 *
 * A subclass of knex's own `Client_Oracledb` — knex's documented
 * bring-your-own-client hatch, so a transaction's client (built from the
 * PROTOTYPE, not the instance) inherits the same compiler and bindings. The
 * base class is read off a connection-less knex instance rather than a deep
 * `knex/lib/dialects/oracledb` import: knex has no `exports` map promising
 * that path, and a re-bundling host rewrites a runtime `require` of it into a
 * stub that throws. Building one opens nothing — knex initialises a driver
 * and a pool only for a config that names a `connection`.
 */
export function oracleFederationClient(): new (config: Knex.Config) => unknown {
  if (cachedClient) return cachedClient;
  const probe = knex({ client: ORACLE_KNEX_CLIENT });
  const Base = probe.client.constructor as new (config: Knex.Config) => any;

  class Client_OracleFederation extends Base {
    queryCompiler(builder: unknown, formatter: unknown): unknown {
      const compiler = super.queryCompiler(builder, formatter);
      compiler._surroundQueryWithLimitAndOffset = rowLimitingClause;
      return compiler;
    }

    _query(connection: unknown, obj: { options?: Record<string, unknown> }): unknown {
      const driver = this.driver as OracleTypeConstants | undefined;
      if (driver && !obj.options?.fetchTypeHandler) {
        obj.options = { ...obj.options, fetchTypeHandler: oracleFetchTypeHandler(driver) };
      }
      return super._query(connection, obj);
    }

    prepBindings(bindings: unknown[]): unknown[] {
      const prepared = super.prepBindings(bindings) as unknown[];
      const driver = this.driver as OracleTypeConstants | undefined;
      if (!driver?.DB_TYPE_TIMESTAMP_TZ) return prepared;
      return prepared.map((value) =>
        value instanceof Date ? { val: value, type: driver.DB_TYPE_TIMESTAMP_TZ } : value,
      );
    }
  }

  cachedClient = Client_OracleFederation as unknown as new (config: Knex.Config) => unknown;
  return cachedClient;
}

/**
 * The knex config an Oracle driver connects with: the federation client in
 * place of the `oracledb` spelling, and the UTC session pin chained onto the
 * pool's `afterCreate` (a host's own `afterCreate` still runs, after it).
 * Every other client's config is returned untouched.
 *
 * Applied to the config handed to knex only; the driver's `config` keeps the
 * `'oracledb'` spelling, which is what `isOracle` reads.
 */
export function withOracleFederationClient(knexConfig: Record<string, any>): Record<string, any> {
  if (knexConfig.client !== ORACLE_KNEX_CLIENT) return knexConfig;
  const out: Record<string, any> = { ...knexConfig, client: oracleFederationClient() };
  const pool = (out.pool ?? {}) as Record<string, any>;
  const hostAfterCreate = pool.afterCreate as
    | ((conn: unknown, done: (err?: unknown) => void) => void)
    | undefined;
  out.pool = {
    ...pool,
    afterCreate(connection: any, done: (err?: unknown, conn?: unknown) => void) {
      Promise.resolve(connection.execute(ORACLE_SESSION_SETUP_SQL)).then(
        () => {
          if (!hostAfterCreate) return done(undefined, connection);
          hostAfterCreate(connection, (hostErr?: unknown) => done(hostErr, connection));
        },
        (err: unknown) => done(err),
      );
    },
  };
  return out;
}

/**
 * A canonical UTC instant (`canonicalUtcDatetime`'s text) as the value an
 * Oracle statement binds: a JavaScript `Date`, which the federation client
 * sends as `TIMESTAMP WITH TIME ZONE` at `+00:00`. Oracle parses no text into
 * a `DATE` / `TIMESTAMP` without an NLS format mask, and binding text against
 * one raises ORA-01861 (measured on 23ai). A value that is not canonical text
 * (an unparseable comparand the canonicaliser passed through) is returned
 * unchanged, so Oracle refuses it rather than this line guessing.
 */
export function oracleInstantBinding(canonical: unknown): unknown {
  if (typeof canonical !== 'string') return canonical;
  const ms = Date.parse(canonical);
  return Number.isNaN(ms) || !/Z$/.test(canonical) ? canonical : new Date(ms);
}

/**
 * A calendar day (`YYYY-MM-DD`) as an Oracle binding: the instant of its UTC
 * midnight, which a `DATE` column compares against at `00:00:00` in the
 * UTC session. Anything else is returned unchanged (see
 * {@link oracleInstantBinding}).
 */
export function oracleDayBinding(day: unknown): unknown {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  return oracleInstantBinding(`${day}T00:00:00.000Z`);
}

/**
 * The comparison operators whose answer Oracle's `'' IS NULL` rule changes.
 * The pattern operators (`$contains`, `$startsWith`, `$endsWith`, `$like`) are
 * not here: their pattern is built before binding (`'%' || '' || '%'` is never
 * sent), and an Oracle column holds no `''` for `'%%'` to miss.
 */
const ORACLE_EMPTY_STRING_SENSITIVE_OPERATORS: ReadonlySet<string> = new Set([
  '=', '$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte', '$between',
]);

/**
 * Refuses a `''` comparand on an Oracle read, for the operators in
 * {@link ORACLE_EMPTY_STRING_SENSITIVE_OPERATORS}.
 *
 * Oracle stores a zero-length `VARCHAR2` as `NULL`, and a bound `''` IS `NULL`
 * there, so `col = ''` is never true and `col <> ''` never true either —
 * measured on 23ai: `{ region: '' }` answered no rows and
 * `{ region: { $ne: '' } }` answered only the `NULL` row, against a table where
 * every other dialect answers the opposite. Answering either would be a
 * silent wrong answer, so the filter is refused and names the spelling that
 * does mean what the caller asked: `$null` / `$empty`.
 */
export function assertOracleComparandNotEmptyString(
  operator: string,
  field: string,
  value: unknown,
  subtree?: unknown,
): void {
  if (!ORACLE_EMPTY_STRING_SENSITIVE_OPERATORS.has(operator)) return;
  const hasEmpty = value === '' || (Array.isArray(value) && value.includes(''));
  if (!hasEmpty) return;
  const why =
    "an empty-string comparand on an Oracle table. Oracle stores '' as NULL and compares a bound '' as " +
    "NULL, so the condition can never be true and would silently answer the wrong rows. Use " +
    '{ "$null": true } (or "$empty") to match a missing value.';
  const op = operator === '=' ? 'equality' : `operator "${operator}"`;
  throw withheldFilterError(
    `This filter uses ${op} with ${why} The field is withheld from the message; the full diagnostic is in ` +
      'the server log.',
    `Field "${field}" uses ${op} with ${why}`,
    subtree,
  );
}

/**
 * `upsert()` on an Oracle datasource: NOT_IMPLEMENTED / 501, before any
 * statement is built.
 *
 * Oracle has no `INSERT … ON CONFLICT`; its merge is a `MERGE INTO … USING`
 * statement, which knex does not compile (`.onConflict() is not supported for
 * oracledb`, measured on knex 3.3.0) and this driver does not yet emit. The
 * federation write path on Oracle is `create` / `update` / `delete` and their
 * bulk and filtered forms; a merge is refused by name rather than leaving the
 * driver as knex's untyped error.
 */
export function oracleUpsertUnsupportedError(object: string): Error {
  const err = new Error(
    `upsert() on object '${object}' was refused: its datasource is Oracle, which has no INSERT … ON CONFLICT, ` +
      'and this driver does not emit the MERGE statement Oracle merges with. This is a capability gap in the ' +
      'backend, not a mistake in the request, which is why it answers NOT_IMPLEMENTED/501. Write with ' +
      'create() / update() (look the row up by its key first), which an Oracle datasource supports.',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  return err;
}

/**
 * The dialect `@objectstack/core`'s shared SQL constructs are asked in.
 *
 * Those constructs (`aggregandOperandSql`, `jsonMembershipPredicate`) model
 * the three dialects this driver can also MANAGE, and answer `'unknown'` with
 * their portable or declined form. Oracle reaches them as `'unknown'`, each for
 * a stated reason:
 *
 *  - the aggregand operand stays the bare column — Oracle's `SUM` / `AVG`
 *    over a `NUMBER` accumulate in decimal, which is exact, so there is no
 *    double-accumulation divergence to align;
 *  - JSON membership has no construct, and the caller refuses it on Oracle
 *    rather than falling back to a substring test over the JSON text
 *    (`applyJsonMembership`).
 */
export function coreSqlDialectOf(dialect: SqlDialectName): 'sqlite' | 'postgres' | 'mysql' | 'unknown' {
  return dialect === 'oracle' ? 'unknown' : dialect;
}
