// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6250 — the predicate's own package-local pins.
 *
 * **Deliberately NOT a second dialect table.** The dialect vocabulary — every
 * Postgres / MySQL / SQLite sample, on both the code and the message channel,
 * with its negatives — lives in exactly one place,
 * `@objectstack/rest`'s `rest-unique-violation-dialects.test.ts`, where it is
 * driven through the predicate AND the REST envelope in the same run. Restating
 * it here would rebuild the very fork this predicate exists to retire: two
 * tables that can be taught a dialect independently, which is how four
 * implementations came to disagree about MySQL in the first place. (The table
 * cannot live here instead: `@objectstack/types` cannot import
 * `@objectstack/rest`.)
 *
 * What this file covers is what a table of realistic driver errors cannot
 * express — the shapes the predicate is handed by CALLERS rather than by
 * drivers, and the boundaries of its search.
 */

import { describe, it, expect } from 'vitest';
import { isUniqueViolationError } from './unique-violation.js';

describe('isUniqueViolationError — input shapes', () => {
    it('accepts a bare string, for callers that already unwrapped `err.message`', () => {
        expect(isUniqueViolationError('UNIQUE constraint failed: sys_user.email')).toBe(true);
        expect(isUniqueViolationError('NOT NULL constraint failed: sys_user.email')).toBe(false);
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['a number', 42],
        ['a boolean', false],
        ['an empty object', {}],
        ['an error with no message', new Error()],
    ])('is not a conflict: %s', (_label, value) => {
        expect(isUniqueViolationError(value)).toBe(false);
    });

    it('reads a numeric `code` as MySQL\'s errno wearing the other field\'s name', () => {
        expect(isUniqueViolationError({ code: 1062 })).toBe(true);
        expect(isUniqueViolationError({ code: 1452 })).toBe(false);
    });
});

describe('isUniqueViolationError — the `cause` chain', () => {
    /**
     * Pool and query-builder layers re-throw with the original attached, so the
     * signal is often one or more steps down. The walk is bounded: an error
     * whose `cause` chain is longer than the depth limit is not searched to the
     * end, and the conservative default (`false`) is what it falls to.
     */
    const nest = (depth: number): unknown => {
        let err: unknown = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
        for (let i = 0; i < depth; i += 1) err = Object.assign(new Error('Write failed'), { cause: err });
        return err;
    };

    it.each([1, 2, 3, 4])('finds a conflict wrapped %i level(s) deep', (depth) => {
        expect(isUniqueViolationError(nest(depth))).toBe(true);
    });

    it('stops rather than walking an unbounded chain', () => {
        expect(isUniqueViolationError(nest(5))).toBe(false);
    });

    it('a self-referential `cause` terminates instead of recursing forever', () => {
        const err: { message: string; cause?: unknown } = { message: 'Write failed' };
        err.cause = err;
        expect(isUniqueViolationError(err)).toBe(false);
    });
});

describe('isUniqueViolationError — an unrecognised error is never a conflict', () => {
    /**
     * The default has to be "not a conflict". A false positive answers 409 —
     * which an SDK will not retry — and points the user at a value that is
     * fine; a false negative costs only the generic envelope that was the
     * behaviour before this predicate existed.
     */
    it.each([
        ['a business rule from a hook', '删除被阻断:该客户下仍有未结订单'],
        ['a validation message', 'email is required'],
        ['a missing table', 'no such table: sys_user'],
        ['a syntax error', 'near "FROM": syntax error'],
        ['a connection failure', 'ECONNREFUSED 127.0.0.1:5432'],
        // Shares the words "constraint" and "failed" with SQLite's unique text.
        ['a sibling constraint failure', 'CHECK constraint failed: sys_user_age_check'],
    ])('is not a conflict: %s', (_label, message) => {
        expect(isUniqueViolationError(new Error(message))).toBe(false);
    });
});
