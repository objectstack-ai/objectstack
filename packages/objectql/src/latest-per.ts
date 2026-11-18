// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Each X with its latest Y" — the newest record per group, served as ONE
 * statement on the SQL family: `engine.find('crm_opportunity', query,
 * { [LATEST_PER]: { by: ['account'], orderBy: [{ field: 'close_date', order:
 * 'desc' }] } })` reaches the driver as
 * `… WHERE <the read's final where> AND id IN (SELECT id FROM (SELECT id,
 * ROW_NUMBER() OVER (PARTITION BY account ORDER BY close_date DESC, id DESC) rn
 * FROM crm_opportunity WHERE <the read's final where> AND <tenant wall>) WHERE
 * rn = 1) ORDER BY … LIMIT …`: one row per group, the group's first row in the
 * request's order, ties broken by `id`, and the read's own ordering, paging,
 * projection and presentation applied to those rows.
 *
 * ## An engine-internal option, never a wire key
 *
 * The request rides on {@link LATEST_PER}, a symbol-keyed READ option (the
 * `EngineReadOptions` third argument of `find`), exactly as the relation
 * group join rides on its own (`relation-group-join.ts`): no wire request,
 * JSON body or spread author input can carry a symbol, so the public query
 * vocabulary (`QueryAST`) is unchanged. It is a `Symbol.for` key because the
 * doors that carry it to the engine (`@objectstack/metadata-protocol`'s
 * `findData`, the MCP tools) do not depend on this package at runtime.
 * Holding the key grants nothing: the read is still the caller's own `find`,
 * through every door, gate and middleware the read always runs.
 *
 * ## The partition and order fields are sort keys to every door
 *
 * Grouping by a field and picking a row by a field both disclose that field's
 * value through which rows come back, exactly as sorting by it does. So the AST
 * the doors and the middleware chain see is ordered by each partition and
 * order field the caller's own `orderBy` does not already name
 * ({@link latestPerJudgedSortKeys}): every guard that judges a sort key — the
 * field-level read gate on predicates first among them, the credential and
 * internal-field refusals, the materialisable-sort door — judges these fields
 * for the caller, in its own words. Only after the chain has run does the
 * engine take those keys back out of the statement it hands the driver
 * ({@link withoutJudgedLatestPerKeys}). ⛔ No second copy of any field gate
 * lives here.
 *
 * ## The window runs over the fully scoped read
 *
 * The driver directive ({@link LATEST_PER_DIRECTIVE}) is attached at the
 * executor boundary, to the AST whose `where` already carries every scope the
 * pipeline composed (row-level security, sharing, the planned relation
 * leaves); the driver applies its tenant wall to the windowed read with the
 * read's own options. So the newest row of a group is chosen among the rows
 * this caller may read: a group whose newest row is hidden from the caller
 * answers its newest VISIBLE row.
 *
 * ## Refused, never approximated
 *
 * Prime Directive 5 (ruling record 6888468549): only a driver that compiles
 * the window in SQL serves it ({@link driverCompilesLatestPer}). Every other
 * driver — the in-memory driver, MongoDB, OData, the remote face of the Turso
 * driver — is refused with `INVALID_QUERY` / 400 before anything is read; no
 * in-process evaluation and no slower path exist. So is a read of an object
 * whose rows can be narrowed after the driver call — an `afterFind` hook or
 * an object-keyed read middleware — because the newest row the driver chose
 * could then be dropped and the group would lose its answer; and a federated
 * object, whose remote table this driver does not own.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { STRUCTURED_JSON_TYPES, isMultiValueField } from '@objectstack/spec/data';
import { isFederatedObject } from './federated-object.js';
import { driverNameOf } from './relation-semi-join.js';
import { PLATFORM_PROVISIONED_COLUMNS } from './declared-read-columns.js';

/**
 * The read-option key of a latest-per request: `find(object, query,
 * { [LATEST_PER]: request })`. A `Symbol.for` key — its carriers live in
 * packages that do not import this one — and a symbol, so no wire request can
 * carry it.
 */
export const LATEST_PER: unique symbol = Symbol.for('objectstack.objectql.latestPer');

/**
 * The AST key the driver reads its window from ({@link DriverLatestPer});
 * `driver-sql`'s `find` reads the same `Symbol.for` key. Set by the engine on
 * the composed AST it hands `driver.find`, after every middleware has run — no
 * middleware and no caller sees it.
 */
export const LATEST_PER_DIRECTIVE: unique symbol = Symbol.for('objectstack.driver.find.latestPer');

/** The most partition fields, and the most order keys, one request may name. */
export const LATEST_PER_MAX_KEYS = 3;

/** One key of the order that decides which row of a group is "latest". */
export interface LatestPerOrder {
  readonly field: string;
  readonly order: 'asc' | 'desc';
}

/** What the engine did with a {@link LatestPerRequest}: set only once the driver answered it. */
export interface LatestPerOutcome {
  readonly kind: 'served';
}

/**
 * The request: the fields that form a group, the order whose first row is a
 * group's answer, and the slot the engine writes its {@link LatestPerOutcome}
 * to. A carrier that hands the request on reads the slot back after the read:
 * a read that came back without it was not served as one row per group, and
 * is never an answer.
 */
export interface LatestPerRequest {
  readonly by: readonly string[];
  readonly orderBy: readonly LatestPerOrder[];
  outcome?: LatestPerOutcome;
}

/** What the driver is handed, on the AST under {@link LATEST_PER_DIRECTIVE}. */
export interface DriverLatestPer {
  readonly by: readonly string[];
  readonly orderBy: readonly LatestPerOrder[];
}

/**
 * The drivers whose `find` compiles {@link LATEST_PER_DIRECTIVE}, named — no
 * capability bit says which drivers compile it, and an unnamed driver is never
 * handed one. `driver-sql` covers every dialect it speaks; the WASM SQLite
 * driver inherits its `find`. The Turso driver is admitted only on its local
 * and replica faces ({@link driverCompilesLatestPer}), which inherit the same
 * `find`; its remote face compiles its own reads.
 */
export const LATEST_PER_COMPILING_DRIVERS: ReadonlySet<string> = new Set([
  'com.objectstack.driver.sql',
  'com.objectstack.driver.sqlite-wasm',
]);

const TURSO_DRIVER = 'com.objectstack.driver.turso';
const TURSO_SQL_FACES: ReadonlySet<string> = new Set(['local', 'replica']);

/** The request on a read's options, when one rides there. */
export function latestPerRequestOf(options: unknown): LatestPerRequest | undefined {
  if (options === null || typeof options !== 'object') return undefined;
  const request = (options as Record<symbol, unknown>)[LATEST_PER];
  return request === undefined ? undefined : (request as LatestPerRequest);
}

/**
 * Whether `driver` compiles the window: a named driver of
 * {@link LATEST_PER_COMPILING_DRIVERS}, or the Turso driver on a face that
 * runs `driver-sql`'s own `find` (`transportMode` `local` or `replica`, read
 * as written — anything else is the remote face or unknown, and refused).
 */
export function driverCompilesLatestPer(driver: { readonly name?: unknown; readonly find?: unknown } | undefined): boolean {
  if (typeof driver?.find !== 'function') return false;
  const name = driver.name;
  if (typeof name !== 'string') return false;
  if (LATEST_PER_COMPILING_DRIVERS.has(name)) return true;
  if (name !== TURSO_DRIVER) return false;
  const mode = (driver as { readonly transportMode?: unknown }).transportMode;
  return typeof mode === 'string' && TURSO_SQL_FACES.has(mode);
}

type CodedError = Error & {
  code?: string; status?: number; httpStatus?: number;
  object?: string; param?: string; field?: string;
};

/** A refusal of the request, `INVALID_QUERY` (or the named code) / 400, nothing read. */
function refusal(object: string, detail: string, code: string = StandardErrorCode.enum.INVALID_QUERY, field?: string): CodedError {
  const err = new Error(
    `find('${object}') with latestPer: ${detail} The query was NOT run and nothing was read.`,
  ) as CodedError;
  err.code = code;
  err.status = 400;
  // …and `httpStatus`, the same number under ADR-0112 D5's spelling — what a
  // consumer holding the THROWN error reads; `status` stays for the HTTP doors.
  err.httpStatus = 400;
  err.object = object;
  err.param = 'latestPer';
  if (field !== undefined) err.field = field;
  return err;
}

const isFieldName = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * Judge the request's SHAPE: one to {@link LATEST_PER_MAX_KEYS} distinct
 * partition fields, one to {@link LATEST_PER_MAX_KEYS} distinct order keys each
 * `asc` or `desc`. Throws the refusal on a request built wrong.
 */
export function assertLatestPerShape(object: string, request: LatestPerRequest): void {
  const by = (request as { by?: unknown }).by;
  if (!Array.isArray(by) || by.length === 0 || by.length > LATEST_PER_MAX_KEYS || !by.every(isFieldName)) {
    throw refusal(object, `'by' must name 1 to ${LATEST_PER_MAX_KEYS} fields that form a group.`);
  }
  if (new Set(by).size !== by.length) throw refusal(object, `'by' names a field twice.`);
  const orderBy = (request as { orderBy?: unknown }).orderBy;
  if (!Array.isArray(orderBy) || orderBy.length === 0 || orderBy.length > LATEST_PER_MAX_KEYS) {
    throw refusal(object, `'orderBy' must name 1 to ${LATEST_PER_MAX_KEYS} keys that decide which record of a group is the latest.`);
  }
  const seen = new Set<string>();
  for (const key of orderBy as unknown[]) {
    const field = (key as { field?: unknown } | null)?.field;
    const order = (key as { order?: unknown } | null)?.order;
    if (!isFieldName(field) || (order !== 'asc' && order !== 'desc')) {
      throw refusal(object, `each 'orderBy' key is { field, order } with order 'asc' or 'desc'.`);
    }
    if (seen.has(field)) throw refusal(object, `'orderBy' names '${field}' twice.`);
    seen.add(field);
  }
}

/**
 * The field verdict: every partition and order field is a stored, single-valued
 * scalar column of `object` — a declared field or a platform column (`id`,
 * `created_at`, `updated_at`). Unknown, dotted, computed (`formula`),
 * structured-JSON and multi-value fields are refused `INVALID_FIELD` / 400: no
 * driver shares a meaning for a computed value or a document as a group key or
 * an order. `undefined` when every field passes.
 */
export function latestPerFieldRefusal(object: string, schema: unknown, request: LatestPerRequest): Error | undefined {
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return refusal(object, `the object's fields are not registered, so its partition and order fields cannot be judged.`);
  }
  const provisioned = new Set<string>(PLATFORM_PROVISIONED_COLUMNS);
  const named = [
    ...request.by.map((field) => ({ field, role: 'partition' })),
    ...request.orderBy.map((key) => ({ field: key.field, role: 'order' })),
  ];
  for (const { field, role } of named) {
    if (field.includes('.')) {
      return refusal(object, `the ${role} field '${field}' is a dotted path; name a field of '${object}' itself.`, StandardErrorCode.enum.INVALID_FIELD, field);
    }
    if (provisioned.has(field)) continue;
    if (!Object.prototype.hasOwnProperty.call(fields, field)) {
      return refusal(object, `the ${role} field '${field}' is not a field of '${object}'.`, StandardErrorCode.enum.INVALID_FIELD, field);
    }
    const def = (fields as Record<string, { type?: unknown; multiple?: unknown } | undefined>)[field];
    const type = typeof def?.type === 'string' ? def.type : undefined;
    if (type === 'formula') {
      return refusal(object, `the ${role} field '${field}' is a formula, computed on read, so no column holds it; `
        + `store the value in a field of its own and name that field.`, StandardErrorCode.enum.INVALID_FIELD, field);
    }
    if (type !== undefined && (STRUCTURED_JSON_TYPES.has(type) || isMultiValueField({ type, multiple: def?.multiple === true }))) {
      return refusal(object, `the ${role} field '${field}' holds a list or a JSON document, which is no group key or `
        + `order the drivers share; name a field that stores one scalar value.`, StandardErrorCode.enum.INVALID_FIELD, field);
    }
  }
  return undefined;
}

/** What {@link latestPerRegistryRefusal} reads off the engine. */
export interface LatestPerRegistryFacts {
  readonly driver: { readonly name?: unknown; readonly find?: unknown } | undefined;
  readonly schema: unknown;
  /** An `afterFind` hook is registered for the object. */
  readonly hasAfterFindHook: boolean;
  /** An object-keyed read middleware is registered for the object. */
  readonly hasObjectMiddleware: boolean;
}

/**
 * The registry half of the refusal: the error the request is refused with on
 * this read, or `undefined` when the registry admits it. Nothing is read.
 */
export function latestPerRegistryRefusal(object: string, facts: LatestPerRegistryFacts): Error | undefined {
  if (!driverCompilesLatestPer(facts.driver)) {
    return refusal(object, `this read's driver '${driverNameOf(facts.driver as { readonly name?: unknown } | undefined)}' `
      + 'does not compile one row per group in its own statement, and the platform does not compute it in memory. '
      + 'The SQL drivers serve it; on this driver, read the groups first, then each group\'s latest record.');
  }
  if (isFederatedObject(facts.schema)) {
    return refusal(object, `'${object}' is a federated object, whose remote table this driver does not window.`);
  }
  if (facts.hasAfterFindHook) {
    return refusal(object, `'${object}' has an afterFind hook, which may drop rows after the driver chose each group's `
      + 'latest record, so a group could lose its answer.');
  }
  if (facts.hasObjectMiddleware) {
    return refusal(object, `'${object}' has an object-keyed read middleware, which may drop rows after the driver chose `
      + 'each group\'s latest record, so a group could lose its answer.');
  }
  return undefined;
}

/** The field a sort entry names: a plain string, or a `{ field }` node. */
function sortKeyField(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  const field = (entry as { field?: unknown } | null | undefined)?.field;
  return typeof field === 'string' ? field : undefined;
}

/**
 * The sort keys the read is judged as ordered by: each partition field (`asc`)
 * and each order key the caller's own `orderBy` does not already name. The
 * engine adds them to the AST the doors and the middleware chain see, so every
 * guard that judges a sort key judges them.
 */
export function latestPerJudgedSortKeys(request: LatestPerRequest, ownOrderBy: unknown): LatestPerOrder[] {
  const named = new Set((Array.isArray(ownOrderBy) ? ownOrderBy : []).map(sortKeyField));
  const judged: LatestPerOrder[] = [];
  const add = (key: LatestPerOrder): void => {
    if (named.has(key.field)) return;
    named.add(key.field);
    judged.push({ field: key.field, order: key.order });
  };
  for (const field of request.by) add({ field, order: 'asc' });
  for (const key of request.orderBy) add(key);
  return judged;
}

/**
 * The statement the driver is handed: the chain's final AST without the sort
 * keys {@link latestPerJudgedSortKeys} added for it, and with the window
 * directive. An AST whose own `orderBy` was absent stays absent when nothing
 * else is left in it.
 */
export function withLatestPerDirective<T extends { orderBy?: unknown }>(
  ast: T,
  judged: readonly LatestPerOrder[],
  ownOrderBy: unknown,
  request: LatestPerRequest,
): T {
  const drop = new Set(judged.map((key) => key.field));
  let orderBy = ast.orderBy;
  if (drop.size > 0 && Array.isArray(orderBy)) {
    const kept = (orderBy as unknown[]).filter((entry) => {
      const field = sortKeyField(entry);
      return field === undefined || !drop.has(field);
    });
    orderBy = kept.length === 0 && !Array.isArray(ownOrderBy) ? undefined : kept;
  }
  const directive: DriverLatestPer = {
    by: [...request.by],
    orderBy: request.orderBy.map((key) => ({ field: key.field, order: key.order })),
  };
  return { ...ast, orderBy, [LATEST_PER_DIRECTIVE]: directive };
}
