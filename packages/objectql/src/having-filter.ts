// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// HAVING — the engine-side filter over AGGREGATED rows (#4286 step 3).
//
// `query.having` was declared on the request surface since AST v2 and executed
// by nothing: `engine.aggregate()` rebuilt the driver AST without it (so a
// driver implementing HAVING would never have received it), and the in-memory
// fallback had no HAVING stage — an ADR-0078 silently-inert declaration on the
// one clause every SQL-literate author (human or model) expects to work next
// to `groupBy` / `aggregations`. ADR-0049 resolved it to ENFORCE: the engine
// applies `having` itself, uniformly, AFTER aggregation — the same
// correct-first / optimize-later two-tier shape date bucketing uses. Native
// SQL pushdown can come later behind a driver capability flag without changing
// the semantics defined here.
//
// SEMANTICS. `having` filters the AGGREGATED result rows, so the namespace it
// references is the aggregated row's own columns: aggregation aliases
// (`order_count`, `total`) and groupBy projections (the field name, or the
// item's `alias` for structured entries — after date bucketing). It is an
// ordinary FilterCondition over those columns: implicit equality, the
// comparison / set / null / existence / string operators, and `$and` / `$or` /
// `$not` composition. Operator semantics mirror the Filter Protocol as
// driver-memory's matcher implements it, with ONE deliberate divergence:
//
// AN UNKNOWN OPERATOR THROWS. The memory matcher ignores operators it does not
// know; here an ignored operator would silently return UNFILTERED aggregates —
// the precise failure mode (#4286, ADR-0078) this module exists to end. The
// rejection names the operator and the supported set.

import type { FilterCondition } from '@objectstack/spec/data';

const LOGICAL_OPERATORS = ['$and', '$or', '$not'] as const;

const CONDITION_OPERATORS = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$between',
  '$in', '$nin', '$exists', '$null',
  '$contains', '$notContains', '$startsWith', '$endsWith', '$regex',
] as const;

function unknownOperator(op: string, where: 'logical' | 'condition'): Error {
  const supported = where === 'logical'
    ? `${LOGICAL_OPERATORS.join(', ')} (or a column condition)`
    : CONDITION_OPERATORS.join(', ');
  return new Error(
    `Unsupported operator '${op}' in \`having\`. HAVING filters the aggregated rows `
    + `(aggregation aliases + groupBy projections) and supports: ${supported}. `
    + `An unknown operator is refused rather than ignored — ignoring it would silently `
    + `return unfiltered aggregates (#4286, ADR-0078).`,
  );
}

/**
 * Filter aggregated rows by the query's `having` condition. An absent or empty
 * condition returns the rows unchanged (same vacuous-filter convention as
 * `where`).
 */
export function applyHaving(rows: any[], having: FilterCondition | null | undefined): any[] {
  if (!having || typeof having !== 'object' || Object.keys(having).length === 0) return rows;
  return rows.filter((row) => matchesHaving(row, having));
}

/** Evaluate one aggregated row against a HAVING FilterCondition. */
export function matchesHaving(row: Record<string, any>, cond: any): boolean {
  if (!cond || typeof cond !== 'object') return true;
  for (const [key, value] of Object.entries(cond)) {
    if (key === '$and') {
      const branches = Array.isArray(value) ? value : [value];
      if (!branches.every((c) => matchesHaving(row, c))) return false;
      continue;
    }
    if (key === '$or') {
      const branches = Array.isArray(value) ? value : [value];
      if (!branches.some((c) => matchesHaving(row, c))) return false;
      continue;
    }
    if (key === '$not') {
      if (matchesHaving(row, value)) return false;
      continue;
    }
    if (key.startsWith('$')) throw unknownOperator(key, 'logical');
    // Aggregated rows are flat (aliases + group projections) — direct access,
    // no dotted-path resolution.
    if (!checkCondition(row?.[key], value)) return false;
  }
  return true;
}

/** One column's condition — implicit equality or an operator object. */
function checkCondition(value: any, condition: any): boolean {
  // Implicit equality (primitives, null, Date, array exact-match) — loose `==`
  // to mirror the Filter Protocol's memory evaluation.
  if (
    typeof condition !== 'object'
    || condition === null
    || condition instanceof Date
    || Array.isArray(condition)
  ) {
    // eslint-disable-next-line eqeqeq
    return value == condition;
  }

  const keys = Object.keys(condition);
  const isOperatorObject = keys.some((k) => k.startsWith('$'));
  if (!isOperatorObject) {
    // Plain-object implicit equality — structural compare, as the matcher does.
    return JSON.stringify(value) === JSON.stringify(condition);
  }

  for (const op of keys) {
    if (op === '$options') continue; // consumed by $regex below
    const target = (condition as Record<string, any>)[op];
    if (value === undefined && op !== '$exists' && op !== '$ne' && op !== '$null') return false;
    switch (op) {
      // eslint-disable-next-line eqeqeq
      case '$eq': if (value != target) return false; break;
      // eslint-disable-next-line eqeqeq
      case '$ne': if (value == target) return false; break;
      case '$gt': if (!(value > target)) return false; break;
      case '$gte': if (!(value >= target)) return false; break;
      case '$lt': if (!(value < target)) return false; break;
      case '$lte': if (!(value <= target)) return false; break;
      case '$between':
        if (Array.isArray(target) && (value < target[0] || value > target[1])) return false;
        break;
      case '$in': if (!Array.isArray(target) || !target.includes(value)) return false; break;
      case '$nin': if (Array.isArray(target) && target.includes(value)) return false; break;
      case '$exists': {
        const exists = value !== undefined && value !== null;
        if (exists !== !!target) return false;
        break;
      }
      case '$null':
        if (target === true && value != null) return false;
        if (target === false && value == null) return false;
        break;
      case '$contains': if (typeof value !== 'string' || !value.includes(target)) return false; break;
      case '$notContains': if (typeof value !== 'string' || value.includes(target)) return false; break;
      case '$startsWith': if (typeof value !== 'string' || !value.startsWith(target)) return false; break;
      case '$endsWith': if (typeof value !== 'string' || !value.endsWith(target)) return false; break;
      case '$regex': {
        let re: RegExp;
        try {
          re = new RegExp(target, (condition as Record<string, any>).$options || '');
        } catch {
          return false;
        }
        if (!re.test(String(value))) return false;
        break;
      }
      default:
        throw unknownOperator(op, 'condition');
    }
  }
  return true;
}
