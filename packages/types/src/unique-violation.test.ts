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
import { isUniqueViolationError, uniqueViolationColumn } from './unique-violation.js';

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

/* ------------------------------------------------------------------------- *
 *  #6544 — uniqueViolationColumn
 *
 *  Same division of labour as above: the DIALECT VOCABULARY (which driver text
 *  names a column and which names an index, per dialect, with its negatives)
 *  lives in exactly one place — `@objectstack/rest`'s
 *  `import-runner-error-sanitize.test.ts`, where it is driven through this
 *  export AND through `sanitizeRowError` in the same run. Restating it here
 *  would rebuild the fork these exports exist to retire.
 *
 *  What this file covers is what a table of flat driver messages cannot: the
 *  SHAPES a caller hands in, the channels an error object carries, and the
 *  boundaries of the search.
 * ------------------------------------------------------------------------- */

describe('uniqueViolationColumn — input shapes', () => {
    it('accepts a bare string, for callers that already unwrapped `err.message`', () => {
        expect(uniqueViolationColumn('UNIQUE constraint failed: sys_user.email')).toBe('email');
    });

    it('reads an Error object on the message channel', () => {
        expect(uniqueViolationColumn(new Error('UNIQUE constraint failed: sys_user.email'))).toBe(
            'email',
        );
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['a number', 42],
        ['a boolean', false],
        ['an empty object', {}],
        ['an error with no message', new Error()],
    ])('names no column: %s', (_label, value) => {
        expect(uniqueViolationColumn(value)).toBeUndefined();
    });
});

describe('uniqueViolationColumn — the channels an error object carries', () => {
    /**
     * node-postgres keeps the `DETAIL:` line off `message` and on its own
     * `detail` field, so for the Postgres driver we actually ship, the column
     * is in neither the message nor any code — reading `detail` is what makes
     * the export answer at all there.
     */
    it("reads node-postgres' `detail` field when the message names only the index", () => {
        const err = Object.assign(
            new Error('duplicate key value violates unique constraint "sys_user_email_key"'),
            { code: '23505', detail: 'Key (email)=(acme@example.com) already exists.' },
        );
        expect(uniqueViolationColumn(err)).toBe('email');
    });

    it('prefers the message when both channels name a column', () => {
        const err = Object.assign(new Error('UNIQUE constraint failed: sys_user.email'), {
            detail: 'Key (other_column)=(x) already exists.',
        });
        expect(uniqueViolationColumn(err)).toBe('email');
    });

    it('a `detail` that is not a string is ignored rather than thrown on', () => {
        const err = Object.assign(new Error('duplicate key value violates unique constraint "i"'), {
            code: '23505',
            detail: { key: 'email' },
        });
        expect(uniqueViolationColumn(err)).toBeUndefined();
    });
});

describe('uniqueViolationColumn — the `cause` chain', () => {
    const nest = (depth: number): unknown => {
        let err: unknown = new Error('UNIQUE constraint failed: sys_user.email');
        for (let i = 0; i < depth; i += 1) err = Object.assign(new Error('Write failed'), { cause: err });
        return err;
    };

    it.each([1, 2, 3, 4])('finds the column wrapped %i level(s) deep', (depth) => {
        expect(uniqueViolationColumn(nest(depth))).toBe('email');
    });

    it('stops rather than walking an unbounded chain', () => {
        expect(uniqueViolationColumn(nest(5))).toBeUndefined();
    });

    it('a self-referential `cause` terminates instead of recursing forever', () => {
        const err: { message: string; cause?: unknown } = { message: 'Write failed' };
        err.cause = err;
        expect(uniqueViolationColumn(err)).toBeUndefined();
    });
});

describe('uniqueViolationColumn — gated on the predicate', () => {
    /**
     * The gate is what keeps SQLite's sibling failures out: `NOT NULL
     * constraint failed: sys_user.email` has the same `table.column` shape as
     * the unique positive, and is refused because it is not a conflict — not
     * because a pattern happened to miss it.
     */
    it.each([
        ['NOT NULL constraint failed: sys_user.email'],
        ['CHECK constraint failed: sys_user_age_check'],
        ['FOREIGN KEY constraint failed'],
        ['null value in column "email" of relation "sys_user" violates not-null constraint'],
    ])('names no column for a non-conflict: %s', (message) => {
        expect(isUniqueViolationError(message)).toBe(false);
        expect(uniqueViolationColumn(message)).toBeUndefined();
    });

    it('a conflict the predicate recognises may still name no column', () => {
        // The two answers are independent: yes/no is wider than which-column,
        // deliberately (#6544's ruling). A caller must handle `true` + `undefined`.
        const mysql = "ER_DUP_ENTRY: Duplicate entry 'a@b.com' for key 'idx_email_unique'";
        expect(isUniqueViolationError(mysql)).toBe(true);
        expect(uniqueViolationColumn(mysql)).toBeUndefined();
    });
});
