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
        if (value === undefined && op !== '$exists' && op !== '$ne' && op !== '$null') {
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
                if (Array.isArray(target) && (value < target[0] || value > target[1])) return false;
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
