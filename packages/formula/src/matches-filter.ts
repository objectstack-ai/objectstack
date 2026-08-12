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
 *
 * ## The unknown-operator posture: silent `false`, DECIDED not inherited (#6520)
 *
 * The #6993 census measured that this face answers an operator it does not know
 * with a silent `false` — no throw, no `code`, no message — where the other five
 * JS evaluation faces (`driver-memory`'s three surfaces, `driver-mongodb`,
 * objectql's `having`) all REFUSE with `INVALID_FILTER` / 400. #6520 was asked
 * to decide whether to keep that or upgrade it, and KEPT it. The reasons, in the
 * order they carry weight:
 *
 * 1. **The direction of the error is opposite here.** Those five faces compile
 *    READ predicates, where dropping a constraint WIDENS the result set — on an
 *    RLS read scope that is a permission bypass (#3948), so they must be loud.
 *    This one evaluates a WRITE-side `check`: an unevaluable condition denies the
 *    write. Silence costs a diagnostic, not a boundary.
 * 2. **Callers depend on this being TOTAL.** `plugin-security`'s `explain-engine`
 *    calls it per record to answer "does THIS row satisfy the filter?", and
 *    several driver doubles use it as a list filter. Throwing turns a per-record
 *    verdict into an aborted operation for those callers — a real behaviour
 *    change on the read/explain path, which is not what a `$icontains` parity PR
 *    should be deciding.
 * 3. **The measured defect is gone without it.** The census's actual complaint
 *    was that a spec-DECLARED operator (`$icontains`) got the silent `false`.
 *    Every operator in `FILTER_OPERATORS` now has an arm in {@link evalOp}, so
 *    the silent answer is reachable only for a name the protocol does not
 *    declare or has retired. [#7536] That claim is maintained rather than
 *    merely inherited: `$like` / `$ilike` are DECLARED by
 *    `StringOperatorSchema` while deliberately staged out of
 *    `FILTER_OPERATORS`, and they got arms here in the PR that declared them —
 *    the test is "can an author write it", not "is it in the allowlist", and by
 *    that test a silent `false` for `$like` would have been the same defect
 *    under a new name.
 *
 * What stays open, deliberately and on the record: a RETIRED spelling
 * (`$regex` / `$options`) still gets the silent `false` here while the other five
 * faces print `RETIRED_FILTER_OPERATORS`' prescription naming `$icontains`. That
 * is the residue of #4706's second indictment on this face. It is a narrower
 * question than the one this section answers and it changes an accept/reject
 * surface, so #6520 left it to the maintainer rather than folding it into a
 * parity PR.
 *
 * ONE shape is refused instead of answered (#5240): `{ field: {} }`, a field
 * constrained by zero operators, throws `INVALID_FILTER` rather than returning
 * `false`. It is the shape the four backends could not agree on, so no answer
 * here is defensible; the operation fails, which is the #4775 posture for a
 * `check` that cannot be evaluated. Note this is not merely a louder denial:
 * where such a constraint sat under an `$or` beside a satisfied branch, or under
 * a `$not`, the old `false` was ABSORBED and the write was allowed. Those writes
 * now fail. See {@link emptyFieldConstraintError}.
 */

import type { FilterCondition } from '@objectstack/spec/data';
// [#6520] `asciiCaseInsensitiveContains` is `$icontains`' fold, defined once in
// the spec and shared by every JS evaluation face — so a `check` evaluated here
// and the same predicate compiled to SQL by `read-scope-sql.ts` fold the same
// domain.
import { nextUtcCalendarDay, utcInstantMs, asciiCaseInsensitiveContains } from '@objectstack/spec/data';
// [#7536] `$like`/`$ilike`'s pattern language, likewise defined once in the
// spec: this face evaluates the pattern in JS, `driver-sql` compiles the same
// one to `LIKE`/`GLOB`, and a translation written twice would agree on the day
// it was typed and never again.
import { matchesLikePattern } from '@objectstack/spec/data';
import { StandardErrorCode } from '@objectstack/spec/api';

/**
 * [#5240] `{ field: {} }` — a field constrained by ZERO operators — is REFUSED,
 * not evaluated, and this is the ONE place this fail-closed evaluator throws.
 *
 * The shape had three answers in the repo: `driver-sql` refused it at the top
 * level but dropped it inside `$and`/`$or`/`$not` (a predicate that emits
 * nothing matches every row), `driver-memory` answered "matches nothing" by
 * accident of structural equality, and THIS evaluator answered `false` from the
 * explicit `keys.length === 0` arm below. Ruled on #5240: refused in all four
 * backends, with the same `INVALID_FILTER` code, so an authoring accident — a
 * filter builder that recorded a field and never its operator — fails loudly at
 * the producer instead of quietly changing a row count per backend.
 *
 * # Why this one throw does not weaken the fail-closed posture
 *
 * "Fail closed" is about what an UNEVALUABLE condition does to an ANSWER: it
 * must never widen access. Throwing is the strongest form of that — there is no
 * answer to widen — and it lands on the posture #4775 already settled for this
 * surface: a `check` that cannot be evaluated fails the operation. What changes
 * is the shape of the failure, and one case where the outcome flips outright:
 * a `check` whose broken constraint sat under an `$or` beside a satisfied
 * branch, or under a `$not`, used to evaluate to ALLOW. Those writes now fail.
 * That is a real, observable behaviour change and it is the point of the ruling
 * — the alternative is a permission rule whose meaning depends on which of four
 * backends evaluated it.
 */
function emptyFieldConstraintError(field: string, path: string): Error {
  const err = new Error(
    `Field constraint at ${path} carries zero operators ({ "${field}": {} }). A field constraint ` +
      `must name at least one operator (e.g. { "${field}": { "$eq": "value" } }) or be a direct ` +
      `comparand (e.g. { "${field}": "value" }). It is refused rather than evaluated because the ` +
      `backends disagreed on what it means — driver-sql dropped it inside $and/$or/$not (matching ` +
      `EVERY row) while refusing it at the top level, and driver-memory / this evaluator ` +
      `answered "matches nothing". #5240.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/** True iff `record` satisfies `filter`. A null/empty filter matches everything. */
export function matchesFilterCondition(record: Record<string, unknown>, filter: FilterCondition | null | undefined): boolean {
  if (filter == null) return true;
  if (typeof filter !== 'object' || Array.isArray(filter)) return false;
  // [#5240] Shape first, then evaluate. The refusal is raised by a walk of the
  // WHOLE tree, up front, rather than from inside `evalField` — because the
  // evaluator short-circuits (`every`/`some`, and a node returns on its first
  // false entry), so a refusal raised mid-evaluation would fire or not fire
  // depending on the RECORD being tested. A malformed permission rule must be
  // refused for every record or none. Evaluation below is untouched.
  assertFilterShape(filter as Record<string, unknown>, 'filter');
  return evalNode(record, filter as Record<string, unknown>);
}

/**
 * [#5240] Walk the whole condition tree and refuse any zero-operator field
 * constraint. Shapes this evaluator already answers fail-closed (a non-node
 * `$and` element, an unknown `$`-operator, a bare array field spec) are left to
 * it — this walk adds exactly one refusal and changes nothing else.
 */
function assertFilterShape(node: unknown, path: string): void {
  if (node == null || typeof node !== 'object' || Array.isArray(node)) return;
  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      if (Array.isArray(val)) val.forEach((child, i) => assertFilterShape(child, `${here}[${i}]`));
      continue;
    }
    if (key === '$not') {
      assertFilterShape(val, here);
      continue;
    }
    if (key.startsWith('$')) continue;
    if (isEmptyFieldConstraint(val)) throw emptyFieldConstraintError(key, here);
  }
}

/**
 * [#5240] Is this field spec `{}` — a field constrained by ZERO operators?
 *
 * A plain object with no own enumerable keys, and nothing else: a `Date` also
 * enumerates to nothing but is a COMPARAND (`evalField` treats it as implicit
 * equality), not a constraint.
 */
function isEmptyFieldConstraint(spec: unknown): boolean {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec) || spec instanceof Date) return false;
  const proto = Object.getPrototypeOf(spec);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.keys(spec as Record<string, unknown>).length === 0;
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
  //
  // [#5240] `keys.length === 0` no longer reaches this arm on the public entry
  // point: `assertFilterShape` refuses `{ field: {} }` before evaluation starts.
  // The clause stays because this function is also reachable from a recursive
  // `evalNode` on a subtree, and a total function must stay total — but it is a
  // floor, no longer this backend's ANSWER to the shape.
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
    case '$gt': return actual != null && v != null && order(actual, v, (a, b) => a > b);
    case '$gte': return actual != null && v != null && order(actual, v, (a, b) => a >= b);
    case '$lt': return actual != null && v != null && order(actual, v, (a, b) => a < b);
    case '$lte': return actual != null && v != null && lteBound(actual, v);
    case '$in': return Array.isArray(v) && v.some((x) => looseEq(actual, x));
    case '$nin': return Array.isArray(v) && !v.some((x) => looseEq(actual, x));
    case '$between':
      return Array.isArray(v) && v.length === 2 && actual != null && v[0] != null && v[1] != null
        && order(actual, v[0], (a, b) => a >= b) && lteBound(actual, v[1]);
    case '$contains': return typeof actual === 'string' && typeof v === 'string' && actual.includes(v);
    /**
     * [#6520] `$contains`' case-INSENSITIVE twin, folding ASCII case and nothing
     * else — `asciiCaseInsensitiveContains` is the spec's shared definition, the
     * same one `driver-memory`'s matcher and objectql's `having` call.
     *
     * NOT `actual.toLowerCase().includes(v.toLowerCase())`, which is the obvious
     * line and the wrong one: it folds the whole Unicode range, so an RLS
     * `check` written with `$icontains` would ALLOW a write here that the read
     * scope's SQL — folding ASCII only — then hides. One predicate, two answers,
     * across the write gate and the read gate, is the #3948 shape reached
     * through case folding (#4706 Q1 = A).
     */
    case '$icontains':
      return typeof actual === 'string' && typeof v === 'string' && v !== ''
        && asciiCaseInsensitiveContains(actual, v);
    /**
     * [#7536] `$like` / `$ilike` — the caller's own SQL `LIKE` pattern, matched
     * against the WHOLE value. `matchesLikePattern` is the spec's one
     * translation of that pattern language, the same one `driver-sql` and
     * `driver-turso` compile to `LIKE` / `GLOB`.
     *
     * Answered here rather than left to the `default: return false` below, and
     * that is a decision this face had to make rather than inherit. The silent
     * default is fail-CLOSED and correct for a spelling the protocol does not
     * have — but `$like` IS declared now, and a declared operator that silently
     * denies is the defect the #6993 census measured for `$icontains`: an RLS
     * write-side `check` written with `$like` would deny every write while the
     * read scope's SQL happily matched rows. One predicate, two answers, across
     * the write gate and the read gate — the #3948 shape.
     *
     * A malformed pattern (a dangling trailing escape) makes
     * `matchesLikePattern` throw. It is caught and answered FALSE here, not
     * propagated: this evaluator is total by contract (its header's
     * "unknown-operator posture"), and on a write-side `check` the fail-closed
     * answer is the safe one. The driver faces refuse that same pattern loudly
     * at authoring time, which is where a caller can act on it.
     */
    case '$like':
    case '$ilike':
      if (typeof actual !== 'string' || typeof v !== 'string') return false;
      try {
        return matchesLikePattern(actual, v, op === '$ilike');
      } catch {
        return false;
      }
    case '$notContains': return !(typeof actual === 'string' && typeof v === 'string' && actual.includes(v));
    case '$startsWith': return typeof actual === 'string' && typeof v === 'string' && actual.startsWith(v);
    case '$endsWith': return typeof actual === 'string' && typeof v === 'string' && actual.endsWith(v);
    case '$null': return v === true ? actual == null : actual != null;
    /**
     * [#5298/#5369] `$exists` means "the field HAS A VALUE", not "the key is
     * present" — so it is the exact mirror of `$null` and reads `!= null`, not
     * `!== undefined`.
     *
     * This used to read `actual !== undefined`, which made `{ x: null }` answer
     * TRUE for `$exists: true` while `driver-sql` compiled the same operator to
     * `IS NOT NULL` and answered FALSE. On an RLS rule that is one `check`
     * clause allowing a write the read side would then hide.
     *
     * The ruling picked "has a value" over "key is present" for a reason the SQL
     * side makes unavoidable: a column IS the schema, so there is no such thing
     * as an absent key in a row, and a backend cannot honour a semantics its
     * storage model has no way to represent. Field existence is a property of
     * the SCHEMA, not of the record — so the record-level operator can only be
     * asking about the value. Declaring "key is present" would be the spec
     * promising something two of its backends can never deliver.
     *
     * With that, `$exists` and `$null` are strict complements on every backend:
     * `$exists: true` ≡ `$null: false`, `$exists: false` ≡ `$null: true`. A
     * missing key and an explicit `null` are the same fact here, which is also
     * what `getPath` already returns for both (`undefined`).
     */
    case '$exists': return v === true ? actual != null : actual == null;
    /**
     * An operator this evaluator does not know answers `false` — the write is
     * DENIED — rather than throwing. [#6520] examined this arm and KEPT it; the
     * reasoning is on this module's header under "the unknown-operator posture",
     * because it is a decision rather than an omission.
     *
     * What #6520 did change is the arm's REACH: every operator `FILTER_OPERATORS`
     * declares now has a case above it, so this line is only reachable for a
     * spelling the protocol does not have (a typo) or one it retired
     * (`$regex` / `$options`). No DECLARED operator is answered silently here
     * any more, which was the defect the #6993 census measured.
     */
    default: return false; // unknown operator → fail closed
  }
}

/**
 * The inclusive-upper-bound comparison, with the calendar-day rule the rest of
 * the platform applies (ADR-0053 D-D, #3777): a bare `YYYY-MM-DD` bound means
 * "through that whole day", so it is evaluated half-open against the next day
 * rather than against that day's midnight.
 *
 * Without this, a `check` policy of the shape `{ signed_on: { $lte: '{today}' } }`
 * evaluated on a `datetime` post-image **denied every write made after 00:00** —
 * the write-side twin of the read-side data loss #3777 fixed, and the reason
 * this evaluator had to stop being the one backend that disagreed. The four
 * other backends (SQL compiler, memory, mongo, the analytics preview) already
 * share this rule via the same primitive.
 *
 * String ordering makes `< nextDay` equivalent to `<= day` for a plain
 * `YYYY-MM-DD` value, so no field-type lookup is needed — which matters here,
 * because this evaluator sees a bare record and has no schema to consult.
 * A full-ISO or non-string bound keeps exact-instant semantics.
 */
function lteBound(actual: unknown, bound: unknown): boolean {
  if (bound == null) return false;
  const nextDay = nextUtcCalendarDay(bound);
  if (nextDay != null) return order(actual, nextDay, (a, b) => a < b);
  return order(actual, bound, (a, b) => a <= b);
}

/**
 * Apply an ordering comparison, lifting the pair to instants when exactly one
 * side is a JS `Date` — the cross-type case JS relational operators answer
 * `false` to unconditionally (they coerce with hint `number`, so the `Date`
 * becomes its epoch and the ISO string becomes `NaN`).
 *
 * This is not a hypothetical pairing on this surface: the RLS `check`
 * post-image is the caller's RAW write payload (`{ ...opCtx.data }` in
 * `plugin-security`, built before any driver `formatInput` converges it), so an
 * SDK write of `new Date()` lands here as a `Date` while the policy's comparand
 * is the platform's wire text — and the mirror pairing arrives too, because a
 * CEL `today()` lowers to a `Date` against a record holding canonical text.
 * Measured against the shared matrix, 10 of 16 cases dropped every
 * `Date`-valued row; fail-closed makes that a **denied write**, the write-side
 * twin of #4047's missing rows and the same failure direction D-D2 recorded
 * for the bare-day upper bound.
 *
 * Deliberately narrow. The lift triggers only when one operand is a `Date`
 * AND {@link utcInstantMs} can read both as instants, so every comparison that
 * worked before is byte-identical: string-vs-string keeps ISO lexicographic
 * ordering, number-vs-number stays numeric, and a `Field.time` wall clock —
 * which denotes no instant — is left alone rather than being given an invented
 * calendar day. Anything that cannot be lifted falls through to the original
 * comparison, so the security posture never becomes more permissive than the
 * operands actually justify.
 */
function order(actual: unknown, bound: unknown, cmp: (a: never, b: never) => boolean): boolean {
  if (actual instanceof Date || bound instanceof Date) {
    const a = utcInstantMs(actual);
    const b = utcInstantMs(bound);
    if (a !== null && b !== null) return cmp(a as never, b as never);
  }
  return cmp(actual as never, bound as never);
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
