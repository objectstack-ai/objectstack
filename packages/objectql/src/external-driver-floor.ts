// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27277] The engine's correctness floor over a plugin driver on an external
 * datasource (ADR-0015 Tier A, epic #27261 P1).
 *
 * ## Which drivers
 *
 * A datasource gets the floor when BOTH hold ({@link needsExternalDriverFloor}):
 *
 * - its `schemaMode` is not `managed` — the platform does not own the storage;
 * - its `driver` id is not a built-in one (`resolveDriverId` answers nothing,
 *   so it is not in `BUILTIN_DRIVER_IDS`) — a server plugin published the
 *   driver as `driver.<name>`.
 *
 * Built-in drivers keep executing the whole query, as `find()`'s contract
 * requires and their conformance suites pin; a managed datasource and an
 * ADR-0015 federated database (a built-in SQL driver on `schemaMode:
 * 'external'`) are untouched. A plugin driver declares nothing and cannot opt
 * out: `DriverCapabilities` carries no pushdown claim (the query bits were
 * retired in 17.0.0), so the engine treats every part of the query as
 * unclaimed (ruling 6471382887, maintainer decision Q1 = B on #27277). A
 * verified-pushdown credential that lets a conformance-tested driver skip the
 * floor is the epic's P3 and does not exist yet.
 *
 * ## What it does
 *
 * - `find`, `findOne`, `count`: the driver is sent `where` and `orderBy` (it
 *   may push either down) and `limit` {@link EXTERNAL_ROW_CAP} + 1 — never
 *   `offset` or `fields`, which the engine applies after it filters. More than
 *   {@link EXTERNAL_ROW_CAP} rows back ⇒ {@link ExternalRowCapExceededError};
 *   otherwise the engine applies the whole query to the rows
 *   (`applyDriverQueryInMemory`), so a driver that returned every row still
 *   answers the right subset. `findOne` is that read with `limit: 1`, `count`
 *   its length.
 * - `aggregate` is hidden, so the engine's existing find + in-memory
 *   aggregation path runs over the floored `find`.
 * - Writes pass through, by id: `updateMany` / `deleteMany` are hidden too, so
 *   no `where` the engine cannot re-check reaches a write. A write the remote
 *   refuses with a request-shaped 4xx (`EXTERNAL_WRITE_REFUSED_STATUSES`) is
 *   {@link ExternalWriteRefusedError} (422, the remote's message); a `find`
 *   the driver refuses with one (`EXTERNAL_READ_REFUSED_STATUSES`, #27471) is
 *   {@link ExternalReadRefusedError} (400, the driver's registered code or
 *   `INVALID_QUERY`; the driver's message only when the sent `where` is
 *   attested as the caller's own, else a fixed sentence and the message in the
 *   server log). Any other
 *   failure of a read or a write — an auth or rate-limit 4xx, or a throw that
 *   declares no status, included — is `ERR_DATASOURCE_UNAVAILABLE` (503,
 *   reason `remote`), with the cause in the server log and never on the wire.
 * - Everything else (`connect`, `supports`, `syncSchema`, `introspectSchema`,
 *   `beginTransaction`, …) is the driver's own, unchanged.
 *
 * ## One instance
 *
 * The engine stores the floored driver in its `drivers` map in place of the
 * driver, once ({@link createExternalDriverFloor} is idempotent per driver), so
 * every identity comparison the engine makes (`getDriver(object) ===
 * defaultDriver`, a transaction's scope driver) compares one instance.
 * {@link unwrapExternalDriverFloor} answers the driver behind it.
 */

import type { DriverQuery, IDataDriver } from '@objectstack/spec/contracts';
import { filterSubtreeProvenanceOf, resolveDriverId } from '@objectstack/spec/data';
import { applyDriverQueryInMemory, assertDriverWhereEvaluableInMemory } from './driver-query-in-memory.js';
import { declaredFieldClasses, declaredJsonStoredFields } from './having-filter.js';
import { DatasourceUnavailableError } from './driver-connect-errors.js';
import {
  EXTERNAL_READ_REFUSED_STATUSES,
  EXTERNAL_ROW_CAP,
  EXTERNAL_WRITE_REFUSED_STATUSES,
  ExternalReadRefusedError,
  ExternalRowCapExceededError,
  ExternalWriteRefusedError,
  type ExternalWriteOperation,
} from './external-driver-errors.js';

/**
 * Does a datasource with this definition get the floor? `schemaMode` absent
 * reads as `managed`, the schema's default.
 */
export function needsExternalDriverFloor(def: { driver?: unknown; schemaMode?: unknown } | undefined): boolean {
  if (!def) return false;
  if (def.schemaMode === undefined || def.schemaMode === 'managed') return false;
  return typeof def.driver === 'string' && resolveDriverId(def.driver) === undefined;
}

/** What the floor needs from the engine. */
export interface ExternalDriverFloorHost {
  /** The datasource the driver serves — named in every refusal. */
  datasource: string;
  /** The object's declared `fields` record, for its comparand classes; `undefined` when unknown. */
  fieldsOf(object: string): unknown;
  /** Where a remote failure's cause is written: the wire answer withholds it. */
  logger: { warn(message: string, meta?: Record<string, unknown>): void };
}

const WRITE_METHODS: ReadonlySet<string> = new Set<ExternalWriteOperation>([
  'create', 'update', 'upsert', 'delete',
  'bulkCreate', 'bulkUpdate', 'bulkDelete',
]);

/**
 * Members the floored driver does not offer, whatever the driver has.
 * `aggregate`: the engine aggregates in memory over the floored `find`.
 * `updateMany` / `deleteMany`: a predicate write would hand the driver a
 * `where` the engine cannot re-check, so a driver that ignored it would write
 * rows the caller never selected. Without them the engine writes by id (the
 * ADR-0142 D4 precondition takes its documented no-`updateMany` path) and
 * refuses a multi-row predicate write.
 */
const HIDDEN: ReadonlySet<PropertyKey> = new Set(['aggregate', 'updateMany', 'deleteMany']);

/**
 * The refusal of a multi-row predicate update / delete on a floored datasource,
 * where the floored driver offers no `updateMany` / `deleteMany` ({@link HIDDEN}).
 * A plain `Error`, as the engine's generic no-predicate-write refusal it stands
 * in for (that one tells the caller to pass `options.multi=true`, which this
 * caller already did).
 */
export function externalPredicateWriteRefusal(datasource: string, object: string, verb: 'update' | 'delete'): Error {
  return new Error(
    `Datasource '${datasource}' is served by a plugin driver; the engine does not run a multi-row predicate `
    + `${verb} on '${object}' there, because it cannot re-check which rows the driver's where selects. `
    + `Read the matching ids, then ${verb} each record by id.`,
  );
}

/** floored driver → the driver behind it */
const innerOf = new WeakMap<object, IDataDriver>();
/** driver → its floored driver, so wrapping one driver twice answers one instance */
const floorOf = new WeakMap<object, IDataDriver>();

/** The driver behind a floored one, or `driver` itself when it is not floored. */
export function unwrapExternalDriverFloor(driver: IDataDriver): IDataDriver {
  return innerOf.get(driver) ?? driver;
}

/** Is `driver` a floored driver? */
export function isExternalDriverFloor(driver: unknown): boolean {
  return typeof driver === 'object' && driver !== null && innerOf.has(driver);
}

/**
 * The floored driver for `driver` — the same instance on every call for one
 * driver. See the module comment.
 */
export function createExternalDriverFloor(driver: IDataDriver, host: ExternalDriverFloorHost): IDataDriver {
  const inner = unwrapExternalDriverFloor(driver);
  const existing = floorOf.get(inner);
  if (existing) return existing;

  const classesOf = (object: string) => {
    const fields = host.fieldsOf(object);
    return { fieldClasses: declaredFieldClasses(fields), jsonStored: declaredJsonStoredFields(fields) };
  };

  const remoteFailure = (object: string, operation: string, error: unknown): Error => {
    const message = error instanceof Error ? error.message : String(error);
    host.logger.warn(
      `[ObjectQL] the plugin driver of datasource '${host.datasource}' failed a ${operation} on '${object}'; `
      + 'the caller was answered ERR_DATASOURCE_UNAVAILABLE (503) without this cause',
      { datasource: host.datasource, object, operation, error: message },
    );
    const refusal = new DatasourceUnavailableError(host.datasource, object, 'remote');
    (refusal as Error & { cause?: unknown }).cause = error;
    return refusal;
  };

  /**
   * [#27471] A `find` the driver refused with a request-shaped 4xx. Its sentence
   * reaches the caller only when every predicate it can be about is the
   * caller's own ({@link whereIsCallersOwn}); otherwise it goes to the log, as
   * a remote failure's cause does, and the caller reads a fixed sentence.
   */
  const readRefusal = (object: string, where: unknown, status: number, error: unknown): Error => {
    const message = error instanceof Error ? error.message : String(error);
    const disclosed = whereIsCallersOwn(where);
    if (!disclosed) {
      host.logger.warn(
        `[ObjectQL] the plugin driver of datasource '${host.datasource}' refused a find on '${object}'; `
        + 'the caller was answered without this reason, because the read carries a predicate the caller did not write',
        { datasource: host.datasource, object, operation: 'find', status, error: message },
      );
    }
    const { code } = (error ?? {}) as { code?: unknown };
    return new ExternalReadRefusedError(host.datasource, object, status, disclosed ? message : null, {
      cause: error,
      ...(typeof code === 'string' ? { remoteCode: code } : {}),
    });
  };

  const readCapped = async (object: string, query: DriverQuery | undefined, options: unknown) => {
    assertDriverWhereEvaluableInMemory(query?.where);
    const routed = (query as { object?: unknown } | undefined)?.object;
    const sent = {
      ...(routed !== undefined ? { object: routed } : {}),
      ...(query?.where !== undefined ? { where: query.where } : {}),
      ...(query?.orderBy !== undefined ? { orderBy: query.orderBy } : {}),
      limit: EXTERNAL_ROW_CAP + 1,
    } as DriverQuery;
    let rows: unknown;
    try {
      rows = await inner.find(object, sent, options as Parameters<IDataDriver['find']>[2]);
    } catch (error) {
      const status = declaredStatus(error);
      if (status !== undefined && EXTERNAL_READ_REFUSED_STATUSES.has(status)) {
        throw readRefusal(object, sent.where, status, error);
      }
      throw remoteFailure(object, 'find', error);
    }
    if (!Array.isArray(rows)) {
      throw remoteFailure(object, 'find', new Error(`find answered ${typeof rows}, not an array of rows`));
    }
    if (rows.length > EXTERNAL_ROW_CAP) throw new ExternalRowCapExceededError(host.datasource, object);
    return rows as Record<string, unknown>[];
  };

  const find = async (object: string, query: DriverQuery = {}, options?: unknown) =>
    applyDriverQueryInMemory(await readCapped(object, query, options), withoutRouting(query), classesOf(object));

  const findOne = async (object: string, query: DriverQuery = {}, options?: unknown) =>
    applyDriverQueryInMemory(
      await readCapped(object, query, options), { ...withoutRouting(query), limit: 1 }, classesOf(object),
    )[0] ?? null;

  const count = async (object: string, query: DriverQuery = {}, options?: unknown) =>
    applyDriverQueryInMemory(
      await readCapped(object, query, options),
      query?.where !== undefined ? { where: query.where } : {},
      classesOf(object),
    ).length;

  const write = (operation: string, method: (...args: unknown[]) => Promise<unknown>) =>
    async (object: string, ...rest: unknown[]) => {
      try {
        return await method.call(inner, object, ...rest);
      } catch (error) {
        const status = declaredStatus(error);
        if (status !== undefined && EXTERNAL_WRITE_REFUSED_STATUSES.has(status)) {
          throw new ExternalWriteRefusedError(
            host.datasource, object, operation as ExternalWriteOperation, status,
            error instanceof Error ? error.message : String(error), { cause: error },
          );
        }
        throw remoteFailure(object, operation, error);
      }
    };

  const bound = new Map<PropertyKey, unknown>();
  const floored = new Proxy(inner, {
    get(target, prop) {
      if (prop === 'find') return find;
      if (prop === 'findOne') return findOne;
      if (prop === 'count') return count;
      if (HIDDEN.has(prop)) return undefined;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (!bound.has(prop)) {
        bound.set(prop, typeof prop === 'string' && WRITE_METHODS.has(prop)
          ? write(prop, value as (...args: unknown[]) => Promise<unknown>)
          : (value as (...args: unknown[]) => unknown).bind(target));
      }
      return bound.get(prop);
    },
    has(target, prop) {
      if (HIDDEN.has(prop)) return false;
      return Reflect.has(target, prop);
    },
  }) as IDataDriver;

  innerOf.set(floored, inner);
  floorOf.set(inner, floored);
  return floored;
}

/** The query as the in-memory helper reads it: without the call's routing (`object`) and the engine's own `expand`. */
function withoutRouting(query: DriverQuery): DriverQuery {
  const { object: _object, expand: _expand, ...rest } = query as DriverQuery & { object?: unknown; expand?: unknown };
  return rest as DriverQuery;
}

/**
 * [#27471] Is every predicate in `where` the caller's own, so a driver's refusal
 * of it may be quoted back? Yes when there is no `where`, or when its root is
 * marked `'author'` and no node under it is marked `'policy'`. Anything else —
 * an unmarked root (no merge boundary vouched for it), a policy arm under an
 * author root — answers no, the fail-closed direction
 * `filter-subtree-provenance.ts` requires. Walks plain objects and arrays, and
 * stops on a cycle.
 */
function whereIsCallersOwn(where: unknown): boolean {
  if (where === undefined) return true;
  if (filterSubtreeProvenanceOf(where) !== 'author') return false;
  const onPath = new Set<object>();
  const carriesPolicy = (node: unknown): boolean => {
    if (node === null || typeof node !== 'object' || onPath.has(node)) return false;
    if (filterSubtreeProvenanceOf(node) === 'policy') return true;
    onPath.add(node);
    try {
      return Object.values(node as Record<string, unknown>).some(carriesPolicy);
    } finally {
      onPath.delete(node);
    }
  };
  return !carriesPolicy(where);
}

/** The HTTP status a thrown error declares, read as the repo's HTTP exits read it: `status`, then `statusCode`. */
function declaredStatus(error: unknown): number | undefined {
  const { status, statusCode } = (error ?? {}) as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : typeof statusCode === 'number' ? statusCode : undefined;
  return value !== undefined && Number.isInteger(value) && value >= 100 && value < 600 ? value : undefined;
}
