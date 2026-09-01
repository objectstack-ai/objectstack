// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.


/**
 * Simple In-Memory Query Matcher
 *
 * Implements a subset of the ObjectStack Filter Protocol (MongoDB-compatible)
 * for evaluating conditions against in-memory JavaScript objects.
 *
 * It answers a boolean for every filter it accepts. What it REFUSES — throwing
 * `INVALID_FILTER` / 400 instead of answering — is decided by
 * `assertFilterConditionShape` in `filter-refusal.ts`, the same gate
 * `InMemoryDriver.find` runs, so this face and the live query path cannot
 * disagree about which filters are evaluable: `{ field: {} }` (#5240), an
 * operator outside the declared vocabulary (#5324), and a `$between` whose
 * comparand is not `[min, max]` (#5328).
 */

// [#5659] The Filter Protocol's boolean identity reduction, shared with
// driver-sql, driver-mongodb and the flow linter. See `evaluate` for why a
// record-at-a-time matcher consults a record-INDEPENDENT verdict first.
// [#6520] `$icontains`' ASCII-only fold, defined once in the spec and shared by
// every JS evaluation face — see `foldAsciiCase`'s docblock for why it is not
// re-implemented per package.
// [#7536] `$like`/`$ilike`'s pattern language, likewise the spec's one
// definition — shared with this package's query path, `formula`, and the SQL
// family's emitters.
import { reduceFilterVerdict, asciiCaseInsensitiveContains, matchesLikePattern } from '@objectstack/spec/data';

import { assertFilterConditionShape } from './filter-refusal.js';

type RecordType = Record<string, any>;

/**
 * matches - Check if a record matches a filter criteria
 * @param record The data record to check
 * @param filter The filter condition (where clause)
 */
export function match(record: RecordType, filter: any): boolean {
    // [#5240] Shape first, then evaluate. The refusal is raised by a walk of the
    // WHOLE tree rather than from inside the field loop below, because that loop
    // short-circuits (`every`/`some`, and the loop returns on its first failing
    // key) — a refusal raised mid-evaluation would fire or not fire depending on
    // the RECORD being tested. Evaluation below is untouched.
    //
    // [#5324/#5328] The walk itself now lives in `filter-refusal.ts` and is the
    // SAME function `InMemoryDriver.find` runs before handing a filter to mingo.
    // It used to be a copy that refused one shape; a copy is how this face and
    // the live one came to answer a malformed `$between` with EVERY row and NO
    // row respectively.
    assertFilterConditionShape(filter, 'filter');
    return evaluate(record, filter);
}

/**
 * [#5659] The boolean identities come from the SHARED reduction; everything
 * record-dependent is still decided here.
 *
 * This matcher used to answer `{ $and: [] }`, `{ $or: [] }`, `{}` and
 * `{ $not: {} }` as a by-product of the JS it happens to be written in —
 * `every` over an empty array is `true`, `some` is `false`, an empty node falls
 * through to the trailing `return true`. Those four answers are not an accident
 * of `Array.prototype`, they are a ruling (#5322/#5134) that `driver-sql` and
 * `driver-mongodb` each spell out in a `reduceFilterNode` of their own, and
 * "emergent from the evaluator" is not a place a ruling can be read from or
 * held to. Asking the shared predicate makes this backend's identity answers
 * the same OBJECT as theirs rather than a third agreeing coincidence.
 *
 * It is a pre-pass and not a rewrite of the loops below, because the verdict is
 * record-independent by construction and the evaluation is not: `'clause'` —
 * the answer for every filter that carries a real predicate — falls straight
 * through to the untouched code. And a `'true'` verdict can only be reached by
 * a filter whose keys are ALL combinators that resolved (a field key always
 * contributes `'clause'`), so returning early on it skips no field constraint.
 */
function evaluate(record: RecordType, filter: any): boolean {
    if (!filter || Object.keys(filter).length === 0) return true;

    const verdict = reduceFilterVerdict(filter);
    if (verdict === 'true') return true;
    if (verdict === 'false') return false;

    // 1. Handle Top-Level Logical Operators ($and, $or, $not)
    // These usually appear at the root or nested.
    
    // $and: [ { ... }, { ... } ]
    if (Array.isArray(filter.$and)) {
        if (!filter.$and.every((f: any) => evaluate(record, f))) {
            return false;
        }
    }

    // $or: [ { ... }, { ... } ]
    if (Array.isArray(filter.$or)) {
        if (!filter.$or.some((f: any) => evaluate(record, f))) {
            return false;
        }
    }

    // $not: { ... }
    if (filter.$not) {
        if (evaluate(record, filter.$not)) {
            return false;
        }
    }

    // 2. Iterate over field constraints
    for (const key of Object.keys(filter)) {
        // Skip logical operators we already handled (or future ones)
        if (key.startsWith('$')) continue;

        const condition = filter[key];
        const value = getValueByPath(record, key);

        if (!checkCondition(value, condition)) {
            return false;
        }
    }
    
    return true;
}

/**
 * Access nested properties via dot-notation (e.g. "user.name")
 */
export function getValueByPath(obj: any, path: string): any {
    if (!path.includes('.')) return obj[path];
    return path.split('.').reduce((o, i) => (o ? o[i] : undefined), obj);
}

/**
 * [#13166] Does a row whose field has NO VALUE satisfy this operator?
 *
 * The platform's settled answer for the negation-carrying operators is YES —
 * the INCLUDE direction. #5146 made `$not` NULL-safe and ruled THIS matcher's
 * answer canonical (`driver-sql` was rewritten to match it, not the other way
 * round); #5298 option A extended the same answer to the non-negated `$ne` /
 * `$nin` / `$notContains`. A ruling on 2026-08-10 briefly reversed it in favour
 * of SQL's native three-valued logic and was WITHDRAWN the same day, once the
 * cross-backend cost had been priced; include was re-affirmed.
 *
 * Ten other surfaces already answer this way, which is why aligning this one
 * moves nothing on the SQL side: the four SQL compilers reach it through
 * `nullSafeNegative` and their four copies of `nullValueSatisfiesOperator`
 * (`$nin` → true, `$notContains` → true), `formula`'s `matchesFilterCondition`
 * answers it directly, and `driver-mongodb` passes `$nin` through and compiles
 * `$notContains` to `{ $not: { $regex } }` — both of which match a missing or
 * null field in MongoDB.
 *
 * ⚠️ `$exists` is deliberately NOT here. It is not tolerant of an absent value,
 * it is a question ABOUT one, and its own cell is a different, still-open
 * divergence (#13195): this package's live mingo path and `driver-mongodb` read
 * it as key-presence where this matcher and `formula` read it as has-value.
 * `$null` is excluded for the same reason.
 *
 * Named rather than inlined because BOTH causes of the #13166 divergence have
 * to answer the same question, and they sit in different places — a
 * pre-switch guard that only sees `undefined`, and the `$notContains` arm that
 * only sees `null`. Two spellings of one ruling is how they came apart.
 */
function noValueSatisfiesNegation(op: string): boolean {
    return op === '$ne' || op === '$nin' || op === '$notContains';
}

/**
 * [#13553] The four ORDERING operators — the ones whose arm answers a
 * RELATIONAL comparison between the stored value and a comparand.
 *
 * A set, and consulted from the pre-switch guard, because what it selects is a
 * RULING and not an implementation detail: a row whose field has NO VALUE is
 * not inside `$gt` / `$gte` / `$lt` / `$lte`. Two independent authorities
 * decide that and agree — this package's live mingo path excludes such a row
 * (runtime truth, measured), and the platform's settled reading admits a
 * no-value row only for the operators that carry a negation (`$ne` / `$nin` /
 * `$notContains`, #5298 option A, re-affirmed 2026-08-10; see
 * {@link noValueSatisfiesNegation}, whose membership is this set's exact
 * complement on this question).
 *
 * ⚠️ `$between` is deliberately NOT a member, though it is a relational
 * comparison too. It decides the no-value case itself, in
 * {@link valueWithinRange}, and its answer is not this one: the degenerate
 * range whose BOTH ends are no value SELECTS the no-value rows. Adding
 * `$between` here would return `false` before that function ran and silently
 * move a cell #13495 ruled.
 */
const ORDERING_OPERATORS: ReadonlySet<string> = new Set(['$gt', '$gte', '$lt', '$lte']);

/**
 * [#13495/#13549] Is `value` inside the closed range `[min, max]`?
 *
 * `$between` is the conjunction of `$gte min` and `$lte max`. That is not an
 * interpretation of the operator, it is what this package's LIVE path compiles
 * it to — `memory-driver.ts`'s `$between` arm writes `$gte`/`$lte` and hands
 * them to mingo — so this face has to compute the same predicate.
 *
 * The arm used to be written the other way round, as an EXCLUSION test:
 * `if (value < min || value > max) return false`. The two are equivalent only
 * while both comparisons are MEANINGFUL, and against a null they are not: JS
 * answers a relational comparison between a null and a string `false` in both
 * directions (`null` coerces to `0`, the string to `NaN`). Neither disjunct
 * fired, nothing returned false, and a bounded range silently stopped bounding
 * — the WIDENING direction, which on an RLS read scope is a permission bypass
 * rather than a degraded filter (#3948, and the identical notes this file
 * already carries for the malformed `$between` shape and for `$null`). Two
 * cards measured the two ways in:
 *
 * - #13495, the COMPARAND axis: `{$between: [null, null]}` matched every
 *   VALUED row, because `'a' < null` and `'a' > null` are both false.
 * - #13549, the VALUE axis: a null-valued row sat inside a well-formed bounded
 *   range, because `null < '2026-07-01'` and `null > '2026-07-15'` are both
 *   false.
 *
 * ⚠️ Flipping the test to `!(value >= min && value <= max)` repairs the
 * string cells and NOT the numeric ones — measured, not reasoned: `null`
 * coerces to `0`, so `null >= -1 && null <= 1` is `true` and a null-valued row
 * stays inside a numeric range while looking repaired on every string fixture
 * the cards used. Comparability has to be decided BEFORE the comparison, which
 * is what this function does:
 *
 * - a no-value row is not inside a range with a real bound, and a valued row is
 *   not inside a range whose bound is no value — that comparison is not
 *   meaningful, and JS answers it anyway;
 * - the degenerate range whose BOTH ends are no value selects the no-value
 *   rows, and only those.
 *
 * Every one of those answers is the one this package's live mingo path already
 * gives, cell for cell — the tie-break this file has used since #5240, #5324,
 * #5328 and #5374, each of which closed a "this face and the live one answer
 * one filter two ways" divergence. No new reading of "no value" is asserted
 * here: what a stored null MEANS is #13357's question and it is the
 * maintainer's.
 */
function valueWithinRange(value: any, min: any, max: any): boolean {
    const valueIsNoValue = value === null || value === undefined;
    const minIsNoValue = min === null || min === undefined;
    const maxIsNoValue = max === null || max === undefined;

    // Mixed: one side is a value and the other is an absence. Not comparable.
    if (valueIsNoValue !== minIsNoValue || valueIsNoValue !== maxIsNoValue) return false;

    // Both ends and the value are absences: the degenerate null-to-null range.
    if (valueIsNoValue) return true;

    return value >= min && value <= max;
}

/**
 * Evaluate a specific condition against a value
 */
function checkCondition(value: any, condition: any): boolean {
    // Case A: Implicit Equality (e.g. status: 'active')
    // If condition is a primitive or Date/Array (exact match), treat as equality.
    if (
        typeof condition !== 'object' || 
        condition === null || 
        condition instanceof Date ||
        Array.isArray(condition)
    ) {
        // Loose equality to handle undefined/null mismatch or string/number coercion if desired.
        // But stick to == for JS loose equality which is often convenient in weakly typed queries.
        return value == condition;
    }
    
    // Case B: Operator Object (e.g. { $gt: 10, $lt: 20 })
    const keys = Object.keys(condition);
    const isOperatorObject = keys.some(k => k.startsWith('$'));
    
    if (!isOperatorObject) {
         // It's just a nested object comparison or implicit equality against an object
         // Simplistic check:
         // [#5240] `condition` is never `{}` here — the caller refuses the
         // zero-operator constraint before this point. That matters, because
         // this arm answering `false` for `{}` was the whole of this backend's
         // "FALSE" verdict on the shape: an accident of structural equality, not
         // a semantic ruling anyone had made.
         return JSON.stringify(value) === JSON.stringify(condition);
    }

    // Iterate operators
    for (const op of keys) {
        const target = condition[op];
        
        // Handle undefined values
        //
        // [#13166] The allowlist is {@link noValueSatisfiesNegation} plus the
        // two operators that are ABOUT the absence rather than tolerant of it
        // (`$exists` / `$null`), and it used to name `$ne` alone out of the
        // three negative ones. That is why a MISSING key short-circuited to "no
        // match" for `$nin` and `$notContains` before their arms ever ran — one
        // of the two independent causes of the divergence #13166 measured, and
        // the only one this guard can reach.
        //
        // [#13494] `$eq` joins them, and for the SAME reason its complement
        // `$ne` was already here: its arm decides the no-value case itself,
        // in one place, with the loose `!=` that reads `undefined` and `null`
        // as one absence. This guard was deciding it FIRST and differently, so
        // one operator answered the two readings of "no value" two ways — a
        // NULLED row reached the arm and matched `$eq: null`, a MISSING row
        // short-circuited to "no match" before the arm ever ran. #5332 ruled
        // that `$eq: null` IS the null predicate, and every other surface that
        // can express the MISSING reading already answers it so — including
        // this package's own live mingo path, measured: `['3']` where this
        // face said `[]`.
        //
        // A non-null comparand keeps the answer it had, because the arm
        // reaches the same verdict the guard did: `undefined != 'a'` is true,
        // so the row is excluded one line further down.
        //
        // ⚠️ `$eq` ONLY, deliberately. The exemption is written over the
        // OPERATOR and not over "the comparand is null", because the latter
        // spelling would have moved `$in: [null]` / `$nin: [null]` with it —
        // and those are #13357's cells, `needs-user-decision`, held for the
        // maintainer. They are measured byte-identical across this change.
        if (value === undefined && op !== '$exists' && op !== '$null' && op !== '$eq'
            && !noValueSatisfiesNegation(op)) {
            return false; 
        }

        // [#13553] The OTHER reading of "no value" — the key is present and
        // holds `null` — on the four {@link ORDERING_OPERATORS}. It is decided
        // here, beside the reading above, because the two readings have to land
        // on ONE answer and this file's recurring defect is that they do not:
        // the guard above sees only `undefined`, so a stored `null` used to
        // reach the arm and be COMPARED.
        //
        // ⚠️ Being compared is the whole defect, and it is measured rather than
        // reasoned: JS coerces `null` to `0` under a relational operator, so
        // `null >= -1` is a true comparison between two NUMBERS and the
        // no-value row lands inside the bound. On a STRING comparand the same
        // line looks correct — `null >= '2026-07-01'` compares `0` against
        // `NaN` and is false — which is why every fixture in #13494, #13495 and
        // #13549 showed these four arms healthy. The repair is the one
        // {@link valueWithinRange} landed for `$between`: comparability is
        // decided BEFORE the comparison, never by it.
        //
        // Written over the OPERATOR, like the `$eq` exemption above and for the
        // same reason — a rule spelled over "the value is null" alone would
        // reach arms whose no-value answer is ruled elsewhere.
        //
        // ⛔ A no-value COMPARAND is excluded from this guard, deliberately, so
        // those cells keep TODAY's answer rather than being decided here.
        // `$gt: null` is the one null-comparand position the contract still
        // ACCEPTS (measured at `parseFilterAST`): the 2026-08-31 ruling refused
        // the three siblings — `$in` / `$nin` null members and `$between`'s
        // null endpoints (#13357) — and #5332's landing had already recorded
        // this position in writing as one "no ruling covers". Deciding it in an
        // operator arm would pick a camp the platform declined to pick, and its
        // sibling was settled by REFUSING the shape rather than by answering
        // it.
        if (value === null && ORDERING_OPERATORS.has(op)
            && target !== null && target !== undefined) {
            return false;
        }

        switch (op) {
            case '$eq': 
                if (value != target) return false; 
                break;
            case '$ne': 
                if (value == target) return false; 
                break;
            
            // Numeric / Date
            case '$gt': 
                if (!(value > target)) return false; 
                break;
            case '$gte': 
                if (!(value >= target)) return false; 
                break;
            case '$lt': 
                if (!(value < target)) return false; 
                break;
            case '$lte': 
                if (!(value <= target)) return false; 
                break;
            case '$between':
                // [#5328] `target` is a two-element array — the shape gate refused
                // anything else before evaluation started. The `Array.isArray`
                // guard stays as the totality floor for a direct call, but it is
                // no longer this face's ANSWER to a malformed range: it used to
                // skip the comparison entirely, which meant "matches EVERY row"
                // — the opposite of what the live query path silently answered.
                //
                // [#13495/#13549] The comparison is {@link valueWithinRange}
                // now, and no longer an EXCLUSION test spelled with `<` and
                // `>`. Against a null comparand or a null value that test was
                // false in BOTH directions, so nothing returned false and the
                // range stopped bounding — the same widening this arm's note
                // above records for the malformed SHAPE.
                if (Array.isArray(target) && !valueWithinRange(value, target[0], target[1])) return false;
                break;

            // Sets
            case '$in': 
                if (!Array.isArray(target) || !target.includes(value)) return false; 
                break;
            case '$nin': 
                if (Array.isArray(target) && target.includes(value)) return false; 
                break;
            
            // Existence
            case '$exists':
                const exists = value !== undefined && value !== null;
                if (exists !== !!target) return false;
                break;

            // Strings
            case '$contains': 
                if (typeof value !== 'string' || !value.includes(target)) return false; 
                break;
            case '$notContains':
                // [#13166] A row with NO VALUE satisfies this — the second and
                // INDEPENDENT cause of the same divergence. The guard above
                // cannot reach this one: it only fires for `undefined`, so a
                // field that is present and `null` arrived here and failed on
                // `typeof value !== 'string'` — the TYPE test, not the
                // predicate. Answering it from {@link noValueSatisfiesNegation}
                // states which question is being answered.
                //
                // A present, non-string value keeps the answer it had: the
                // ruling moved the no-value cells, and only those.
                if (value == null) {
                    if (noValueSatisfiesNegation(op)) break;
                    return false;
                }
                if (typeof value !== 'string' || value.includes(target)) return false;
                break;
            case '$startsWith': 
                if (typeof value !== 'string' || !value.startsWith(target)) return false; 
                break;
            case '$endsWith':
                if (typeof value !== 'string' || !value.endsWith(target)) return false;
                break;
            // [#6520] The case-INSENSITIVE twin of `$contains`. ASCII case only,
            // and the fold runs on BOTH sides — `asciiCaseInsensitiveContains`
            // is the spec's own function, shared with the five other JS faces so
            // the fold cannot drift per package.
            //
            // NOT `toLowerCase()`: that folds the whole Unicode range, so `CAFÉ`
            // would match `café` on this face and not on the SQL family, which is
            // the divergence #6520 closed rather than a nicety (#4706 Q1 = A).
            case '$icontains':
                if (typeof value !== 'string' || typeof target !== 'string'
                    || !asciiCaseInsensitiveContains(value, target)) return false;
                break;
            // [#7536] `$like` / `$ilike` — the caller's own pattern, anchored to
            // the WHOLE value. `matchesLikePattern` is the spec's shared
            // translation: the same one this driver's live query path binds as a
            // regex, and the same pattern `driver-sql` hands to LIKE/GLOB — so
            // the two faces of this package cannot answer one pattern two ways
            // (the divergence #5374 fixed for `$contains` in this same file).
            //
            // A malformed pattern cannot reach here — `filter-refusal.ts`
            // refuses a dangling trailing escape on the shape walk, before
            // evaluation starts. The guard stays because `match()` is also
            // called directly by driver doubles, and a total function must stay
            // total.
            case '$like':
            case '$ilike':
                if (typeof value !== 'string' || typeof target !== 'string') return false;
                try {
                    if (!matchesLikePattern(value, target, op === '$ilike')) return false;
                } catch {
                    return false;
                }
                break;
            case '$null':
                // $null: true → value must be null/undefined; $null: false → value must not be null/undefined
                //
                // [#5347] These two conditionals are EXHAUSTIVE now: the shape
                // gate refuses a non-boolean `target` before evaluation starts.
                // They were not, and that is what the issue's fixture could not
                // see. A third value satisfied neither test, so the operator
                // matched EVERY row — while the live query path compiled the
                // same filter to IS NOT NULL and driver-sql to IS NULL. This
                // face's answer was the widening one, which on an RLS read scope
                // is a permission bypass, not a degraded filter (#3948, and the
                // identical `$between` note above).
                if (target === true && value != null) return false;
                if (target === false && value == null) return false;
                break;
            // [#5702] The `$regex` arm that stood here is GONE. It was the only
            // real regex evaluator in the repo, and the reason #4706 retired the
            // operator rather than standardising it: `new RegExp(target)` read
            // `a.b` as a pattern (so it also matched `axb`) where every SQL
            // backend read it as a literal, and its `catch { return false }`
            // answered an ILLEGAL pattern with "no rows" — a silent wrong
            // answer, not an error. Both spellings are refused by
            // `filter-refusal.ts`'s vocabulary gate before this evaluator runs;
            // `$icontains` is the replacement the refusal prescribes.
            default:
                // [#5324] Unreachable through `match`: the shape gate refuses an
                // operator this driver does not evaluate, with the same
                // `INVALID_FILTER` / 400 the live query path raises. This arm
                // read "Unknown operator, ignore or fail. Ignoring safe for
                // optional features." — and ignoring a constraint WIDENS the
                // result set, which on a read scope is a permission bypass, not
                // a degraded optional feature (#3948, and objectql's `having`
                // says the same thing over its own vocabulary).
                break;
        }
    }
    
    return true;
}
