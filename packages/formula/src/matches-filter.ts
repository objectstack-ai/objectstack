// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * matchesFilterCondition — evaluate a Mongo-style {@link FilterCondition} against
 * ONE in-memory record (ADR-0058 D4/D6).
 *
 * This is the third backend for the canonical filter shape, completing the
 * round-trip: `compileCelToFilter` lowers CEL → FilterCondition; the engine runs
 * it as a `where`; `read-scope-sql` lowers it to SQL; and THIS evaluates it
 * against a single record for write-side validation — the RLS `check` clause
 * (post-image of an insert/update), where there is no query to push down to.
 *
 * Security posture: **fail closed.** Anything it cannot evaluate — a malformed
 * node, an unknown operator, a nested relation object a flat record can't
 * satisfy — returns `false` (the write is denied), never `true`. The operator
 * vocabulary mirrors `read-scope-sql.ts` so the in-memory and SQL backends agree.
 */

import type { FilterCondition } from '@objectstack/spec/data';

/** True iff `record` satisfies `filter`. A null/empty filter matches everything. */
export function matchesFilterCondition(record: Record<string, unknown>, filter: FilterCondition | null | undefined): boolean {
  if (filter == null) return true;
  if (typeof filter !== 'object' || Array.isArray(filter)) return false;
  return evalNode(record, filter as Record<string, unknown>);
}

function evalNode(record: Record<string, unknown>, node: Record<string, unknown>): boolean {
  // A node is the AND of all its entries.
  for (const [key, val] of Object.entries(node)) {
    if (key === '$and') {
      if (!Array.isArray(val) || !val.every((c) => evalNode(record, c as Record<string, unknown>))) return false;
    } else if (key === '$or') {
      if (!Array.isArray(val) || val.length === 0 || !val.some((c) => evalNode(record, c as Record<string, unknown>))) return false;
    } else if (key === '$not') {
      if (val == null || typeof val !== 'object') return false;
      if (evalNode(record, val as Record<string, unknown>)) return false;
    } else if (key.startsWith('$')) {
      return false; // unknown top-level operator → fail closed
    } else {
      if (!evalField(record, key, val)) return false;
    }
  }
  return true;
}

function evalField(record: Record<string, unknown>, field: string, spec: unknown): boolean {
  const actual = getPath(record, field);
  // `{ field: null }` → IS NULL.
  if (spec === null) return actual == null;
  // Scalar / Date → implicit equality.
  if (typeof spec !== 'object' || spec instanceof Date) return looseEq(actual, spec);
  // A bare array value is not a valid field spec (must be `{ $in: [...] }`).
  if (Array.isArray(spec)) return false;

  const ops = spec as Record<string, unknown>;
  const keys = Object.keys(ops);
  // Must be all-operators; a non-`$` key means a nested relation a flat record
  // cannot satisfy → fail closed.
  if (keys.length === 0 || keys.some((k) => !k.startsWith('$'))) return false;
  for (const op of keys) {
    if (!evalOp(actual, op, ops[op], record)) return false;
  }
  return true;
}

function evalOp(actual: unknown, op: string, raw: unknown, record: Record<string, unknown>): boolean {
  const v = resolveValue(raw, record);
  switch (op) {
    case '$eq': return v === null ? actual == null : looseEq(actual, v);
    case '$ne': return v === null ? actual != null : !looseEq(actual, v);
    case '$gt': return actual != null && v != null && (actual as never) > (v as never);
    case '$gte': return actual != null && v != null && (actual as never) >= (v as never);
    case '$lt': return actual != null && v != null && (actual as never) < (v as never);
    case '$lte': return actual != null && v != null && (actual as never) <= (v as never);
    case '$in': return Array.isArray(v) && v.some((x) => looseEq(actual, x));
    case '$nin': return Array.isArray(v) && !v.some((x) => looseEq(actual, x));
    case '$between':
      return Array.isArray(v) && v.length === 2 && actual != null
        && (actual as never) >= (v[0] as never) && (actual as never) <= (v[1] as never);
    case '$contains': return typeof actual === 'string' && typeof v === 'string' && actual.includes(v);
    case '$notContains': return !(typeof actual === 'string' && typeof v === 'string' && actual.includes(v));
    case '$startsWith': return typeof actual === 'string' && typeof v === 'string' && actual.startsWith(v);
    case '$endsWith': return typeof actual === 'string' && typeof v === 'string' && actual.endsWith(v);
    case '$null': return v === true ? actual == null : actual != null;
    case '$exists': return v === true ? actual !== undefined : actual === undefined;
    default: return false; // unknown operator → fail closed
  }
}

/** Resolve a `{ $field: 'path' }` reference against the record; else passthrough. */
function resolveValue(raw: unknown, record: Record<string, unknown>): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && '$field' in (raw as Record<string, unknown>)) {
    return getPath(record, String((raw as Record<string, unknown>).$field));
  }
  return raw;
}

function getPath(record: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return record[path];
  let cur: unknown = record;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Equality that treats Dates by time-value; otherwise strict. */
function looseEq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && (typeof b === 'string' || typeof b === 'number')) return a.getTime() === new Date(b).getTime();
  if (b instanceof Date && (typeof a === 'string' || typeof a === 'number')) return new Date(a).getTime() === b.getTime();
  return a === b;
}
