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
// `$not` composition. Operator semantics follow the Filter Protocol, with TWO
// deliberate divergences from driver-memory's matcher — the face this module
// was originally written against:
//
// 1. AN UNKNOWN OPERATOR THROWS. The memory matcher ignores operators it does
//    not know; here an ignored operator would silently return UNFILTERED
//    aggregates — the precise failure mode (#4286, ADR-0078) this module exists
//    to end. The rejection names the operator and the supported set.
//
// 2. [#5905] THE NEGATION-CARRYING OPERATORS ARE NULL-SAFE. `$ne` / `$nin` /
//    `$notContains` are satisfied by a row whose column HAS NO VALUE — "the
//    column has no value" satisfies a test for "not this value". That is the
//    ruling the maintainer took on #5298 (option A, 2026-08-06), landed by
//    PR #5962 across driver-sql, formula, service-analytics and the
//    `FILTER_LOGIC_*` conformance table. HAVING is the FIFTH evaluation face of
//    the same vocabulary and was not in that PR's inventory, which left this
//    file as the lone holdout (#5905) — and the only face no conformance table
//    covers, since `FILTER_LOGIC_CASES` does not drive the HAVING path.
//    driver-memory / driver-mongodb still answer the old way only because
//    #5499 freezes them; the divergence is against a frozen face, not against
//    the ruling.

import type { FilterCondition } from '@objectstack/spec/data';
// [#5702] The retired operators and the prescription a refusal prints. HAVING is
// the fifth of the five refusal sites `RETIRED_FILTER_OPERATORS`' own doc names,
// and reads the table for the same reason the four driver sites do: one
// retirement, one sentence.
import { RETIRED_FILTER_OPERATORS } from '@objectstack/spec/data';
// [#6520] `$icontains`' ASCII-only fold. HAVING is the sixth JS evaluation face
// of one vocabulary, and it reads the fold from the spec for the same reason it
// reads the retirement prescriptions from there: one rule, one definition.
import { asciiCaseInsensitiveContains } from '@objectstack/spec/data';

const LOGICAL_OPERATORS = ['$and', '$or', '$not'] as const;

// [#5702] `$regex` is GONE from this vocabulary. Its arm below ran a real
// `RegExp` over the aggregated value and answered an ILLEGAL pattern with
// `return false` — "no rows", silently — which is the pair of defects #4706
// retired the operator over, on the one evaluation face no conformance table
// covers.
//
// [#6520] `$icontains` IS here now, and the sentence this comment used to carry
// — "this face would need its own ASCII-only fold" — is what stopped being true:
// the fold is the spec's `asciiCaseInsensitiveContains`, one definition shared
// by all six JS evaluation faces, so this face needs no fold of its own. The
// #5499 freeze was lifted for this operator as a sanctioned one-off (maintainer
// ruling, 2026-08-08), strictly for semantic parity.
const CONDITION_OPERATORS = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$between',
  '$in', '$nin', '$exists', '$null',
  '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains',
] as const;

function unknownOperator(
  op: string,
  where: 'logical' | 'condition',
  siblings: readonly string[] = [],
): Error {
  // [#5702] A RETIRED spelling gets the spec's prescription rather than the
  // vocabulary list — its author wrote a name this face ANSWERED until #4706,
  // and needs to know what replaces it, not what else exists. Retired siblings
  // are named too: `{ $regex, $options }` is one mistake with one fix.
  const retired = RETIRED_FILTER_OPERATORS[op];
  if (retired && where === 'condition') {
    const replacement = retired.to ? ` Write "${retired.to}" instead.` : '';
    const alsoRetired = siblings.filter((key) => key !== op && RETIRED_FILTER_OPERATORS[key]);
    const also = alsoRetired.length
      ? ` The same condition also carries the retired `
        + `${alsoRetired.map((key) => `'${key}'`).join(', ')} — one '${retired.to}' replaces the `
        + `whole shape, so this is ONE mistake with ONE fix, not one per key.`
      : '';
    return new Error(
      `Filter operator '${op}' in \`having\` is RETIRED and is no longer evaluated.${replacement} `
      + `${retired.why}${also}`,
    );
  }
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
 * [#5905] Operators whose answer for a column with NO VALUE is decided by the
 * operator's own arm below, not by the early exit in {@link checkCondition}.
 *
 * That exit exists so a POSITIVE test (`$gt`, `$in`, `$contains`, …) can never
 * be accidentally satisfied by a column the aggregated row does not carry. The
 * operators listed here are the ones for which "no value" is a real answer
 * rather than an accident:
 *
 * - `$exists` / `$null` — answering about absence IS their whole job;
 * - `$ne` / `$nin` / `$notContains` — they carry their own negation, and #5298
 *   ruled (option A) that a value-less column satisfies them, on every backend.
 *
 * `$nin` and `$notContains` were missing from this list, which is the defect
 * #5905 records: the exit fired first and answered FALSE for them, so the arms
 * below — which would have answered TRUE — were never reached.
 */
const NO_VALUE_ANSWERED_BY_OPERATOR: ReadonlySet<string> = new Set([
  '$exists', '$ne', '$null', '$nin', '$notContains',
]);

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
    // [#5702] The `if (op === '$options') continue` that stood here is GONE. It
    // skipped the key because `$regex` consumed it as its flags; with `$regex`
    // retired, `$options` is a key nothing consumes, and skipping it would mean
    // silently ignoring a constraint the author wrote — the exact widening this
    // file refuses unknown operators to avoid. It now falls to `default:` and is
    // refused with the spec's prescription.
    const target = (condition as Record<string, any>)[op];
    if (value === undefined && !NO_VALUE_ANSWERED_BY_OPERATOR.has(op)) return false;
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
      // [#5905] The mirror of `$contains`, NOT its copy-with-a-negated-test.
      // `$contains` fails a non-string value because "contains" cannot hold for
      // something that is not text; `$notContains` SUCCEEDS for the same value
      // for the same reason — it cannot contain the substring. Reusing the
      // `typeof value !== 'string' ⇒ false` guard here (what this line used to
      // do) made a value-less column fail BOTH an operator and its negation,
      // the two-valued reading #5298 ruled out. This is `formula`'s shape
      // (`matches-filter.ts`: `!(typeof actual === 'string' && …)`), which
      // driver-sql's polarity table already follows for the same operator.
      case '$notContains': if (typeof value === 'string' && value.includes(target)) return false; break;
      case '$startsWith': if (typeof value !== 'string' || !value.startsWith(target)) return false; break;
      case '$endsWith': if (typeof value !== 'string' || !value.endsWith(target)) return false; break;
      // [#6520] `$contains`' case-INSENSITIVE twin, over ASCII case only. Same
      // non-string guard as `$contains` — a value that is not text cannot
      // contain a substring — and the same fold every other JS face uses, from
      // the spec, so an aggregate filtered HERE and the same predicate run as a
      // `where` on any driver select the same rows.
      case '$icontains':
        if (typeof value !== 'string' || typeof target !== 'string'
          || !asciiCaseInsensitiveContains(value, target)) return false;
        break;
      // [#5702] The `$regex` arm is GONE. It built `new RegExp(target, $options)`
      // and, on an illegal pattern, `return false` — an unrunnable filter
      // answered as "this row does not match", i.e. a silent empty result rather
      // than an error. Retired by #4706; refused by `default:` below.
      default:
        throw unknownOperator(op, 'condition', keys);
    }
  }
  return true;
}
