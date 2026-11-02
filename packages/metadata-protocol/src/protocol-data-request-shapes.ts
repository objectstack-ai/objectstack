// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim: the by-id
// update record and the malformed filter-array refusal.
//
// A MOVE, not a redesign: every declaration below is byte-identical to the text that stood
// above `ObjectStackProtocolImplementation`; only the imports and the export list at the foot
// are new. `protocol.ts` re-exports what it exported.
import {
    VALID_AST_OPERATORS,
} from '@objectstack/spec/data';

/**
 * The RECORD limb of `IDataEngine.update`'s declared result, for the four
 * ingresses in this file whose call is BY-ID by construction (#16231).
 *
 * `update()` used to declare `Promise<any>` and now declares the union its two
 * dispatch paths actually answer: a record (or `null`) from the by-id exit
 * (`driver.update`), or the affected-row COUNT from the predicate exit
 * (`driver.updateMany`, #4639). Every call site below hands the engine a
 * `where` naming exactly one primary key — or folds the row's id into the
 * payload — with no `multi`, which `resolveEngineUpdateDispatch` resolves
 * `by-id`. So the count limb is unreachable from here, and it is REFUSED
 * loudly rather than cast away: a dispatch change that started routing these
 * calls through `updateMany` would otherwise drop an affected count into a
 * per-row receipt's `record` / `data` slot, where every consumer reads it as a
 * row.
 *
 * The `null` limb is NOT refused and NOT narrowed away — it is passed through
 * exactly as it was while the declaration said `any`. `update()`'s by-id exit
 * answers `null` when the post-write readback leaves the caller's row scope
 * (see `updateData`'s own note on that), while `DataProtocol`'s row receipts
 * declare `record` / `data` non-null. That disagreement pre-dates this change,
 * and this file preserves it rather than widening a shipped response shape as
 * a rider; the assertion below is the one place it is written down.
 */
export function byIdUpdateRecord(result: Record<string, any> | number | null): Record<string, any> {
    if (typeof result === 'number') {
        throw new Error(
            `A by-id update resolved an affected-row count (${result}) instead of a record. ` +
            `This ingress addresses exactly one row, so the engine's predicate dispatch ` +
            `(driver.updateMany) is not reachable from it — the dispatch ladder or this ` +
            `call site changed.`,
        );
    }
    return result as Record<string, any>;
}

/**
 * A 400 for a `$filter` ARRAY that looks like a filter AST but is not one.
 *
 * The message has to be *actionable from the request*, which is the whole point
 * of rejecting here rather than letting a driver fail later: the caller sent a
 * query parameter, so the error names the offending element and the vocabulary
 * it was checked against — not a driver-internal builder state.
 *
 * Diagnoses the three shapes `isFilterAST` refuses, in the order they occur in
 * practice. #4121. Sibling of {@link unusableFilterError}, which covers the
 * non-array ways a filter fails to become one (#4181); both emit
 * `INVALID_FILTER` so the condition has one wire code however it was reached.
 */
function malformedFilterArrayError(filter: unknown[]): Error {
    const detail = describeMalformedFilter(filter);
    const err: any = new Error(
        `Malformed $filter: ${detail} A filter array is a comparison ` +
        `[field, operator, value], a logical node ["and"|"or", ...conditions], or a ` +
        `list of those. Recognised operators: ${[...VALID_AST_OPERATORS].sort().join(', ')}.`,
    );
    err.status = 400;
    err.code = 'INVALID_FILTER';
    return err;
}

/** The specific reason a filter array failed `isFilterAST`, for the message above. */
function describeMalformedFilter(filter: unknown[]): string {
    const [first, second] = filter;
    const isKeyword = typeof first === 'string' && ['and', 'or'].includes(first.toLowerCase());

    // `["and"]` / `["or"]` with nothing to join. The one shape that still
    // returned every row silently after #3948: the driver sets its join mode,
    // matches no element, and emits no predicate.
    if (isKeyword && filter.length < 2) {
        return `logical node ["${String(first)}"] has no conditions to join.`;
    }
    // A bare triple whose operator is outside the AST vocabulary — the original
    // `before` / `after` / `'not in'` case.
    if (typeof first === 'string' && !isKeyword && typeof second === 'string'
        && !VALID_AST_OPERATORS.has(second.toLowerCase())) {
        return `unrecognised operator "${second}" in [${JSON.stringify(first)}, ...].`;
    }
    // An element that is neither a join keyword nor a nested condition.
    const badIndex = filter.findIndex(
        (item) => !Array.isArray(item)
            && !(typeof item === 'string' && ['and', 'or'].includes(item.toLowerCase())),
    );
    if (badIndex >= 0 && filter.some((item) => Array.isArray(item))) {
        const bad = filter[badIndex];
        return `element ${badIndex} is ${bad === null ? 'null' : typeof bad}, ` +
            `expected a condition array or a logical keyword.`;
    }
    return `${JSON.stringify(filter)} is not a recognised filter shape.`;
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { malformedFilterArrayError };
