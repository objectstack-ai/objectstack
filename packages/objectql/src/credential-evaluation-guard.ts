// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The credential-column guard's FILTER and SORT half (ADR-0100) — the
 * counterpart of `rejectCredentialAggregation` (`engine-count-aggregate.ts`),
 * which refuses a GROUP BY / MIN / MAX over the same columns.
 *
 * A `secret` or `password` field never leaves the engine's generic read path
 * as its stored value: `secret` holds an opaque `sys_secret` ref and is served
 * as the mask, a generic `password` is plaintext at rest and served as the
 * mask. Withholding the value from the ROW is not enough on its own: a
 * predicate or an order key evaluates the stored value, so a read that names
 * such a column in `where` (or a cross-field `{ $field }` comparand) or in
 * `orderBy` has its answer shaped by a value the caller is never shown. So the
 * engine REFUSES those positions before any driver is asked, in the aggregate
 * guard's envelope — ADR-0112 `INVALID_FIELD` / 400, located at the object,
 * the field(s) and the position.
 *
 * ## The one accepted shape: a has-a-value check
 *
 * Whether a credential is SET is information every read already serves (the
 * mask for a set value, `null` for an unset one), so a presence check reveals
 * nothing the row does not: `{ f: null }`, `{ f: { $null: bool } }`,
 * `{ f: { $exists: bool } }`, `{ f: { $empty: bool } }`, `{ f: { $eq: null } }`,
 * `{ f: { $ne: null } }`, and `$not` over any of those. Every other operator
 * and operand on the column is refused.
 *
 * ## Who it binds
 *
 * Every caller except a SYSTEM context (`context.isSystem === true`). The
 * server's own credential consumers match on such columns without ever
 * returning them, and do so as system; the security/sharing middlewares and
 * `beforeFind` hooks inject their server-authored filters into the AST AFTER
 * this guard has judged the caller's own query, so they are never judged here.
 * Unlike the aggregate guard — which has no legitimate caller at all — a
 * predicate has one, and that caller is the server.
 *
 * ## Positions
 *
 *  - `where` (after the array-form lowering, so `[field, op, value]` is the
 *    object form here), every logical branch (`$and` / `$or` / `$not`);
 *  - a cross-field comparand `{ $field: <credential> }` anywhere in a value;
 *  - `orderBy` entries (string or `{ field }`);
 *  - each `aggregations[i].filter`;
 *  - each `expand` entry's own `where` / `orderBy`, at every depth, judged
 *    against that entry's TARGET object.
 *
 * A NESTED-RELATION condition (`{ <lookup>: { <related field>: … } }`) is not
 * walked here: the engine lowers it by reading the related object with the
 * caller's context (`ObjectQL.lowerRelationConditions`), and that read passes
 * through this guard against the related object's own fields.
 *
 * The collector is {@link collectCredentialFields} — type-keyed and
 * exemption-free, the one the aggregate guard reads, so the two halves cannot
 * drift. The `internal: true` flag's evaluate refusal stays where it was
 * decided, at the generic data door (`@objectstack/metadata-protocol`,
 * `assertNoInternalFieldEvaluated`), because its server-side consumers do not
 * all run as system.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { REFERENCE_VALUE_TYPES, referenceTargetOf } from '@objectstack/spec/data';
import { collectCredentialFields } from './secret-fields.js';

/** The slice of a read the guard judges. Every member is optional. */
export interface CredentialEvaluationQuery {
  where?: unknown;
  orderBy?: unknown;
  expand?: unknown;
  aggregations?: unknown;
}

/** The slice of an execution context the guard reads. */
interface CredentialEvaluationContext {
  isSystem?: unknown;
}

/** A backstop against a self-referential in-process value. */
const CREDENTIAL_WALK_DEPTH = 8;

/** Presence operators whose operand is a boolean. */
const PRESENCE_BOOLEAN_OPERATORS: ReadonlySet<string> = new Set(['$null', '$exists', '$empty']);
/** Equality operators accepted only with a `null` operand. */
const NULL_EQUALITY_OPERATORS: ReadonlySet<string> = new Set(['$eq', '$ne']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function headSegment(path: string): string {
  const dot = path.indexOf('.');
  return dot === -1 ? path : path.slice(0, dot);
}

/**
 * Whether `value`, written as the condition on a credential column, asks only
 * whether a value is set. See the module header for the accepted shapes.
 */
export function isCredentialPresenceCondition(value: unknown): boolean {
  if (value === null) return true;
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  return entries.every(([op, operand]) =>
    (PRESENCE_BOOLEAN_OPERATORS.has(op) && typeof operand === 'boolean')
    || (NULL_EQUALITY_OPERATORS.has(op) && operand === null)
    || (op === '$not' && isCredentialPresenceCondition(operand)));
}

/** A condition value that is itself a filter over a related object's fields. */
function isRelationCondition(value: unknown): boolean {
  return isPlainRecord(value) && Object.keys(value).some((k) => !k.startsWith('$'));
}

function collectComparandHits(node: unknown, credential: ReadonlySet<string>, hits: Set<string>, depth: number): void {
  if (node === null || typeof node !== 'object' || depth > CREDENTIAL_WALK_DEPTH) return;
  if (Array.isArray(node)) {
    for (const member of node) collectComparandHits(member, credential, hits, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.$field === 'string') {
    const head = headSegment(record.$field);
    if (credential.has(head)) hits.add(head);
  }
  for (const value of Object.values(record)) collectComparandHits(value, credential, hits, depth + 1);
}

function collectConditionHits(node: unknown, credential: ReadonlySet<string>, hits: Set<string>, depth: number): void {
  if (node === null || typeof node !== 'object' || depth > CREDENTIAL_WALK_DEPTH) return;
  if (Array.isArray(node)) {
    for (const member of node) collectConditionHits(member, credential, hits, depth + 1);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.startsWith('$')) {
      collectConditionHits(value, credential, hits, depth + 1);
      continue;
    }
    const head = headSegment(key);
    if (credential.has(head)) {
      if (key !== head || !isCredentialPresenceCondition(value)) hits.add(head);
      continue;
    }
    // Judged by the related object's own read (see the module header).
    if (isRelationCondition(value)) continue;
    collectComparandHits(value, credential, hits, depth + 1);
  }
}

function orderByNames(orderBy: unknown): string[] {
  if (!Array.isArray(orderBy)) return [];
  const out: string[] = [];
  for (const entry of orderBy) {
    const field = typeof entry === 'string' ? entry : isPlainRecord(entry) ? entry.field : undefined;
    if (typeof field === 'string' && field.length > 0) out.push(headSegment(field.replace(/^-/, '')));
  }
  return out;
}

function refusal(object: string, operation: string, fields: string[], param: string, types: Record<string, string>): Error {
  const first = fields[0] as string;
  const sort = param.endsWith('orderBy');
  const named = fields.map((f) => `'${f}' (${types[f] ?? 'credential'})`).join(', ');
  const err = new Error(
    `Cannot ${sort ? 'sort' : 'filter'} '${object}' by ${named} at '${param}' in ${operation}(): the query was not run. `
      + `${fields.length > 1 ? 'These are credential fields' : 'This is a credential field'} whose stored value is `
      + 'withheld on every read — served as the mask, never as the value (ADR-0100) — so it is not evaluated '
      + (sort
        ? 'as a sort key. Sort by another field.'
        : 'as a filter. Only a has-a-value check is accepted on it: { "$null": true | false }, '
          + '{ "$exists": true | false }, { "$empty": true | false }, or equality with null. Filter on another field.'),
  ) as Error & {
    code?: string; status?: number; httpStatus?: number; field?: string; fields?: string[]; object?: string; param?: string;
  };
  // ADR-0112 envelope, the aggregate guard's: `status` for the HTTP doors,
  // `httpStatus` for a consumer holding the thrown error.
  err.code = StandardErrorCode.enum.INVALID_FIELD;
  err.status = 400;
  err.httpStatus = 400;
  err.field = first;
  err.fields = fields;
  err.object = object;
  err.param = param;
  return err;
}

function credentialTypes(schema: unknown): { names: ReadonlySet<string>; types: Record<string, string> } {
  const names = collectCredentialFields(schema as never);
  const fields = (schema as { fields?: Record<string, { type?: string }> } | undefined)?.fields ?? {};
  const types: Record<string, string> = {};
  for (const n of names) types[n] = String(fields[n]?.type ?? 'credential');
  return { names: new Set(names), types };
}

function judge(
  object: string,
  operation: string,
  query: CredentialEvaluationQuery,
  schemaOf: (name: string) => unknown,
  prefix: string,
  depth: number,
): void {
  if (depth > CREDENTIAL_WALK_DEPTH) return;
  const schema = schemaOf(object);
  const { names, types } = credentialTypes(schema);
  const at = (slot: string) => (prefix ? `${prefix}.${slot}` : slot);

  if (names.size > 0) {
    const whereHits = new Set<string>();
    collectConditionHits(query.where, names, whereHits, 0);
    if (whereHits.size > 0) throw refusal(object, operation, [...whereHits], at('where'), types);

    const sortHits = orderByNames(query.orderBy).filter((n) => names.has(n));
    if (sortHits.length > 0) throw refusal(object, operation, [...new Set(sortHits)], at('orderBy'), types);

    if (Array.isArray(query.aggregations)) {
      query.aggregations.forEach((agg, i) => {
        const filterHits = new Set<string>();
        collectConditionHits(isPlainRecord(agg) ? agg.filter : undefined, names, filterHits, 0);
        if (filterHits.size > 0) throw refusal(object, operation, [...filterHits], at(`aggregations[${i}].filter`), types);
      });
    }
  }

  if (!isPlainRecord(query.expand)) return;
  const fields = (schema as { fields?: Record<string, { type?: string }> } | undefined)?.fields ?? {};
  for (const [rel, entry] of Object.entries(query.expand)) {
    if (!isPlainRecord(entry)) continue;
    const def = fields[rel];
    const target = def != null && REFERENCE_VALUE_TYPES.has(String(def.type)) ? referenceTargetOf(def) : undefined;
    if (!target) continue;
    judge(target, operation, entry as CredentialEvaluationQuery, schemaOf, at(`expand.${rel}`), depth + 1);
  }
}

/**
 * Refuse a read or a predicate write whose `where`, `orderBy`, per-aggregation
 * `filter` or `expand` tree evaluates a `secret` / `password` column, for every
 * caller but a system context. See the module header for the contract.
 *
 * Called by `find`, `findOne`, `count`, `aggregate`, `update` and `delete`,
 * right after the `where` array-form lowering and before any `search` term is
 * expanded, any token resolved, any middleware run or any driver asked.
 */
export function rejectCredentialEvaluation(
  object: string,
  operation: string,
  query: CredentialEvaluationQuery | undefined,
  context: CredentialEvaluationContext | undefined,
  schemaOf: (name: string) => unknown,
): void {
  if (!query || context?.isSystem === true) return;
  judge(object, operation, query, schemaOf, '', 0);
}
