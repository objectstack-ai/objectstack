// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `internal: true` flag's EVALUATE refusal — the ONE definition
 * (route-ownership rule 1). The engine owns it because the engine owns the
 * flag: `internal: true` means "the value is never returned on a generic data
 * exit", and the engine is what omits such a column from every row
 * ({@link collectInternalReadFields}, the one flag reader). A filter or sort on
 * such a column is a confirmation oracle (a predicate matches the row only
 * when the guess is right, an order leaks the comparative value) and a group
 * key or aggregation operand IS the value, so those positions are REFUSED
 * rather than evaluated: ADR-0112 `INVALID_FIELD` / 400, located at the
 * object, the field and the position.
 *
 * ## Two ways in, one judgement
 *
 *  - {@link rejectInternalFieldEvaluation} — the engine's own read path
 *    (`find`, `findOne`, `count`, `aggregate`), for every caller but a SYSTEM
 *    context. It is what makes the refusal independent of the `protocol`
 *    service: a host that registers none, or a protocol other than the
 *    shipped one, still refuses, on every transport that hands a caller's
 *    query to the engine (the MCP stdio bridge, `callData`'s fallbacks).
 *  - {@link assertNoInternalFieldEvaluated} — the same judgement for every
 *    caller, system included, served as `ObjectQL#assertNoInternalFieldEvaluated`
 *    (`QueryEvaluationGate` in `@objectstack/spec/contracts`). The data door
 *    asks it before the engine runs, with its relation-target exposure
 *    question hooked in at each hop, so its answer and its order are the ones
 *    it always gave; `callData`'s `aggregate` arm asks it for the system
 *    callers that arm admits.
 *
 * ## Who it binds on the engine path
 *
 * Every caller except `context.isSystem === true`, the credential guard's line
 * ({@link rejectCredentialEvaluation}). The server's own consumers that match
 * on a flagged column without ever returning it — the API-key verifier's
 * `where: { key }`, the share-link, SCIM-credential and approval-token
 * lookups, the better-auth adapter — all run as system, and the
 * security/sharing middlewares and `beforeFind` hooks inject their filters
 * after this judgement, so none of them is judged here.
 *
 * ## Positions
 *
 *  - `where` (and a direct bag's `filter` alias) and each
 *    `aggregations[i].filter` — every column a filter READS: each key's head
 *    and every cross-field `{ $field }` comparand, at any depth;
 *  - a NESTED-RELATION condition inside any of those
 *    (`{ LOOKUP: { RELATED_FIELD: … } }`), judged against the RELATED object's
 *    own flagged fields at `PARAM.LOOKUP`;
 *  - `orderBy` (`sort`), `groupBy`, and `aggregations[i].field`;
 *  - every `expand` entry's own `where` / `orderBy`, at every depth, judged
 *    against that level's TARGET object.
 *
 * An object with no usable field map (none, an array, an empty one) is judged
 * on nothing, and its relation sites are not found: there is no declaration
 * to read a flag from.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { REFERENCE_VALUE_TYPES, isFilterAST, parseFilterAST, referenceTargetOf } from '@objectstack/spec/data';
import type { InternalFieldEvaluationOptions, InternalFieldEvaluationQuery } from '@objectstack/spec/contracts';
import { relationConditionSites } from '@objectstack/core';
import { collectInternalReadFields } from './secret-fields.js';

/** A backstop against a self-referential in-process value. */
const INTERNAL_FIELD_WALK_DEPTH = 8;

/** The slice of an execution context the engine path reads. */
interface InternalFieldEvaluationContext {
  isSystem?: unknown;
}

/** How the walk reads an object's declaration by name. */
type SchemaOf = (name: string) => unknown;

interface ObjectGate {
  fields: Record<string, any>;
  internal: ReadonlySet<string>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function headSegment(name: string): string {
  const dot = name.indexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

function gateOf(schemaOf: SchemaOf, object: string): ObjectGate | null {
  const schema = schemaOf(object) as { fields?: unknown } | undefined | null;
  const fields = schema?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  if (Object.keys(fields).length === 0) return null;
  return { fields: fields as Record<string, any>, internal: new Set(collectInternalReadFields(schema as never)) };
}

/**
 * Every column a filter READS: each condition key's head and every `{ $field }`
 * comparand's head, at any depth, combinators and operator bags descended.
 */
function collectFilterReads(root: unknown, out: Set<string>): void {
  const seenAsCondition = new WeakSet<object>();
  const seenAsComparand = new WeakSet<object>();
  const pending: Array<{ node: unknown; condition: boolean }> = [{ node: root, condition: true }];
  while (pending.length > 0) {
    const { node, condition } = pending.pop() as { node: unknown; condition: boolean };
    if (node === null || typeof node !== 'object') continue;
    const seen = condition ? seenAsCondition : seenAsComparand;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const member of node) pending.push({ node: member, condition });
      continue;
    }
    const record = node as Record<string, unknown>;
    if (!condition && typeof record.$field === 'string') out.add(headSegment(record.$field));
    for (const [key, value] of Object.entries(record)) {
      if (condition && !key.startsWith('$')) {
        out.add(headSegment(key));
        pending.push({ node: value, condition: false });
      } else {
        pending.push({ node: value, condition });
      }
    }
  }
}

/** The fields an `orderBy` names (string or `{ field }` entries), head segment only. */
function orderByFieldNames(orderBy: unknown): string[] {
  if (!Array.isArray(orderBy)) return [];
  return orderBy
    .map((e) => (typeof e === 'string' ? e : (e as { field?: unknown })?.field))
    .filter((f): f is string => typeof f === 'string' && f.length > 0)
    .map((f) => headSegment(f));
}

/** The fields a `groupBy` names (string or `{ field }` bucket entries), head segment only. */
function groupByFieldNames(groupBy: unknown): string[] {
  if (!Array.isArray(groupBy)) return [];
  return groupBy
    .map((e) => (typeof e === 'string' ? e : (e as { field?: unknown })?.field))
    .filter((f): f is string => typeof f === 'string' && f.length > 0)
    .map((f) => headSegment(f));
}

/** Throw the refusal for the first of `names` that `internal` holds, or return. */
function refuseInternalNames(object: string, names: readonly string[], internal: ReadonlySet<string>, param: string): void {
  const hit = names.filter((n) => internal.has(n));
  if (hit.length === 0) return;
  const first = hit[0] as string;
  const verb = param.endsWith('sort') ? 'sort' : param === 'groupBy' ? 'group' : param.includes('filter') ? 'filter' : 'query';
  const err = new Error(
    `Cannot ${verb} '${object}' by '${first}' (${param}): the query was not run. The ${first} field `
    + 'is declared `internal: true`, so its value is never returned on a generic data exit — the engine '
    + 'omits it from every row. '
    + (verb === 'sort'
      ? 'A sort on it orders by that withheld value'
      : verb === 'group'
        ? 'A group key would be the withheld value, served as the key'
        : 'A filter on it confirms a guessed value by whether the row comes back')
    + ', so it is refused rather than evaluated. Use another field.',
  ) as Error & {
    code?: string; status?: number; httpStatus?: number; field?: string; fields?: string[]; object?: string; param?: string;
  };
  // ADR-0112 envelope: `status` for the HTTP doors, `httpStatus` for a
  // consumer holding the thrown error.
  err.code = StandardErrorCode.enum.INVALID_FIELD;
  err.status = 400;
  err.httpStatus = 400;
  err.field = first;
  err.fields = hit;
  err.object = object;
  err.param = param;
  throw err;
}

function judgeFilter(
  object: string,
  where: unknown,
  param: string,
  depth: number,
  schemaOf: SchemaOf,
  options: InternalFieldEvaluationOptions | undefined,
): void {
  if (where == null || depth > INTERNAL_FIELD_WALK_DEPTH) return;
  const gate = gateOf(schemaOf, object);
  if (!gate) return;
  const condition = isFilterAST(where) ? parseFilterAST(where) : where;
  if (gate.internal.size > 0) {
    const reads = new Set<string>();
    collectFilterReads(condition, reads);
    refuseInternalNames(object, [...reads], gate.internal, param);
  }
  for (const site of relationConditionSites(gate.fields, condition)) {
    const position = `${param}.${site.field}`;
    options?.beforeRelationTarget?.(site.target, position);
    judgeFilter(site.target, site.condition, position, depth + 1, schemaOf, options);
  }
}

function judgeExpand(
  source: string,
  expand: unknown,
  prefix: string,
  depth: number,
  schemaOf: SchemaOf,
  options: InternalFieldEvaluationOptions | undefined,
): void {
  if (!isPlainRecord(expand) || depth > INTERNAL_FIELD_WALK_DEPTH) return;
  const gate = gateOf(schemaOf, source);
  if (!gate) return;
  for (const [rel, entry] of Object.entries(expand)) {
    if (!isPlainRecord(entry)) continue;
    const sourceField = gate.fields[rel];
    const target = sourceField != null && REFERENCE_VALUE_TYPES.has(sourceField.type)
      ? referenceTargetOf(sourceField)
      : undefined;
    if (!target) continue;
    const path = `${prefix}['${rel}']`;
    judgeFilter(target, entry.where, `${path}.filter`, 0, schemaOf, options);
    const targetGate = gateOf(schemaOf, target);
    if (targetGate) refuseInternalNames(target, orderByFieldNames(entry.orderBy), targetGate.internal, `${path}.sort`);
    judgeExpand(target, entry.expand, `${path}.expand`, depth + 1, schemaOf, options);
  }
}

/**
 * Refuse a read whose filter, sort, group key, aggregation operand,
 * per-aggregation filter or `expand` tree evaluates a field declared
 * `internal: true` — for EVERY caller. See the module header for positions.
 */
export function assertNoInternalFieldEvaluated(
  object: string,
  query: InternalFieldEvaluationQuery | undefined,
  schemaOf: SchemaOf,
  options?: InternalFieldEvaluationOptions,
): void {
  if (!query) return;
  const gate = gateOf(schemaOf, object);
  if (!gate) return;
  judgeFilter(object, query.where, 'filter', 0, schemaOf, options);
  judgeFilter(object, query.filter, 'filter', 0, schemaOf, options);
  refuseInternalNames(object, orderByFieldNames(query.orderBy), gate.internal, 'sort');
  refuseInternalNames(object, groupByFieldNames(query.groupBy), gate.internal, 'groupBy');
  if (Array.isArray(query.aggregations)) {
    query.aggregations.forEach((agg: unknown, i: number) => {
      const field = isPlainRecord(agg) ? agg.field : undefined;
      if (typeof field === 'string' && field !== '*') {
        refuseInternalNames(object, [field], gate.internal, `aggregations[${i}].field`);
      }
      judgeFilter(object, isPlainRecord(agg) ? agg.filter : undefined, `aggregations[${i}].filter`, 0, schemaOf, options);
    });
  }
  judgeExpand(object, query.expand, 'expand', 0, schemaOf, options);
}

/**
 * The engine read path's call: {@link assertNoInternalFieldEvaluated} for every
 * caller but a system context. Called by `find`, `findOne`, `count` and
 * `aggregate` right after the `where` array-form lowering, before the
 * credential guard, any `search` expansion, token resolution, middleware or
 * driver.
 */
export function rejectInternalFieldEvaluation(
  object: string,
  query: InternalFieldEvaluationQuery | undefined,
  context: InternalFieldEvaluationContext | undefined,
  schemaOf: SchemaOf,
): void {
  if (!query || context?.isSystem === true) return;
  assertNoInternalFieldEvaluated(object, query, schemaOf);
}
