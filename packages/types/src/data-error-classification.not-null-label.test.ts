// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24768] The classification's half of a NOT NULL refusal: the site a driver
 * error names (`notNullViolationSite`, which the engine asks at its write doors
 * before it names the field by its label), and the hint `mapDataError` gives a
 * refusal nothing translated — a column no field declares.
 *
 * The engine half is pinned in `packages/objectql/src/engine-not-null-refusal.test.ts`;
 * the doors, on a real driver, in `packages/runtime/src/dispatcher-not-null-refusal-24768.test.ts`
 * and `packages/rest/src/data-not-null-field-label-24715.test.ts`.
 *
 * The driver shapes below are the ones measured on each client (the codes table
 * on `notNullViolationSite`): better-sqlite3 through knex, libsql, node-postgres
 * and mysql2. sql.js states no code, so its error is the bare text.
 */

import { describe, it, expect } from 'vitest';
import { mapDataError, notNullViolationSite, driverNotNullRefusalAnswer } from './data-error-classification.js';

const driverError = (message: string, fields: Record<string, unknown>) => Object.assign(new Error(message), fields);

const SQLITE = driverError(
    'update [statement and bound values redacted] - NOT NULL constraint failed: line_item.unit_price',
    { code: 'SQLITE_CONSTRAINT_NOTNULL' },
);
const LIBSQL = driverError('SQLITE_CONSTRAINT: NOT NULL constraint failed: line_item.unit_price', {
    code: 'SQLITE_CONSTRAINT', extendedCode: 'SQLITE_CONSTRAINT_NOTNULL', rawCode: 1299,
});
const SQLJS = new Error('NOT NULL constraint failed: line_item.unit_price');
const POSTGRES = driverError(
    'null value in column "unit_price" of relation "line_item" violates not-null constraint',
    { code: '23502' },
);
const POSTGRES_NO_RELATION = driverError('null value in column "unit_price" violates not-null constraint', { code: '23502' });
/** node-postgres keeps the column and the table on fields of their own; a wrapper may cut the text. */
const POSTGRES_FIELDS_ONLY = driverError('insert failed', { code: '23502', column: 'unit_price', table: 'line_item' });
const MYSQL = driverError("ER_BAD_NULL_ERROR: Column 'unit_price' cannot be null", { code: 'ER_BAD_NULL_ERROR', errno: 1048 });

describe('[#24768] notNullViolationSite — the column, and the table where the dialect says it', () => {
    it.each([
        ['better-sqlite3', SQLITE, { column: 'unit_price', table: 'line_item' }],
        ['libsql', LIBSQL, { column: 'unit_price', table: 'line_item' }],
        ['sql.js, text only', SQLJS, { column: 'unit_price', table: 'line_item' }],
        ['Postgres, naming the relation', POSTGRES, { column: 'unit_price', table: 'line_item' }],
        ['Postgres, naming none', POSTGRES_NO_RELATION, { column: 'unit_price' }],
        ['Postgres, its own fields', POSTGRES_FIELDS_ONLY, { column: 'unit_price', table: 'line_item' }],
        ['MySQL, which never names the table', MYSQL, { column: 'unit_price' }],
    ])('%s', (_driver, error, site) => {
        expect(notNullViolationSite(error)).toEqual(site);
    });

    it('one step down a `cause` chain, as pool and query-builder layers wrap', () => {
        expect(notNullViolationSite(Object.assign(new Error('write failed'), { cause: SQLITE })))
            .toEqual({ column: 'unit_price', table: 'line_item' });
    });

    it('a code naming another refusal is not read for NOT NULL text: a bound value can spell anything', () => {
        const check = driverError(
            "insert into t values ('NOT NULL constraint failed: line_item.unit_price') - CHECK constraint failed: t",
            { code: 'SQLITE_CONSTRAINT_CHECK' },
        );
        expect(notNullViolationSite(check)).toBeUndefined();
        expect(notNullViolationSite(driverError('Column \'unit_price\' cannot be null', { code: 'ER_DUP_ENTRY', errno: 1062 })))
            .toBeUndefined();
    });

    it('a NOT NULL code whose column cannot be determined, and every other error: undefined', () => {
        expect(notNullViolationSite(driverError('insert failed', { code: '23502' }))).toBeUndefined();
        expect(notNullViolationSite(driverError('UNIQUE constraint failed: line_item.email', { code: 'SQLITE_CONSTRAINT_UNIQUE' })))
            .toBeUndefined();
        expect(notNullViolationSite(new Error('connection refused'))).toBeUndefined();
        expect(notNullViolationSite(undefined)).toBeUndefined();
    });
});

describe('[#24715] the classification\'s answer for a column no field declares', () => {
    it.each([
        ['SQLite', SQLITE], ['Postgres', POSTGRES], ['MySQL', MYSQL],
    ])('%s: the column\'s sentence, as it always was', (_dialect, error) => {
        const answer = mapDataError(error, 'line_item');
        expect(answer.status).toBe(400);
        expect(answer.body).toMatchObject({ code: 'VALIDATION_FAILED', error: 'unit_price is required', object: 'line_item' });
        expect(answer.body.fields).toEqual([{ field: 'unit_price', code: 'required', message: 'unit_price is required' }]);
    });

    it('the hint leads with the value, never with `required`, and names drift only as a condition', () => {
        const hint = String(mapDataError(SQLITE, 'line_item').body.hint);
        const sentences = hint.trim().split(/(?<=\.)\s+/);
        expect(sentences[0], hint).toMatch(/requires a value/);
        expect(hint).not.toMatch(/declare the field/);
        // `required` appears once, inside the drift sentence's condition.
        expect(hint.split('`required`')).toHaveLength(2);
        const drift = sentences.filter((s) => /os migrate/.test(s));
        expect(drift, hint).toHaveLength(1);
        expect(drift[0], hint).toMatch(/^If the object declares neither `required` nor `storage: \{ notNull: true \}`/);
    });
});

describe('[#26031] driverNotNullRefusalAnswer — the NOT NULL arm\'s answer, exactly where classification gives it', () => {
    it.each([
        ['better-sqlite3', SQLITE], ['libsql', LIBSQL], ['sql.js', SQLJS],
        ['Postgres', POSTGRES], ['Postgres, naming no relation', POSTGRES_NO_RELATION], ['MySQL', MYSQL],
    ])('%s: mapDataError\'s answer, the same body', (_driver, error) => {
        const answer = driverNotNullRefusalAnswer(error, 'line_item');
        expect(answer).toEqual(mapDataError(error, 'line_item'));
        expect(answer?.body.code).toBe('VALIDATION_FAILED');
        expect(typeof answer?.body.hint).toBe('string');
    });

    it('with no object, the body names none, as mapDataError\'s does', () => {
        expect(driverNotNullRefusalAnswer(SQLITE)).toEqual(mapDataError(SQLITE));
        expect(driverNotNullRefusalAnswer(SQLITE)?.body).not.toHaveProperty('object');
    });

    it('every other arm answers undefined, the NOT NULL text in its message notwithstanding', () => {
        const text = 'NOT NULL constraint failed: line_item.unit_price';
        // The engine's own refusal on a declared field: the validation arm answers it.
        const declared = Object.assign(new Error('Sales Price is required'), {
            name: 'ValidationError', code: 'VALIDATION_FAILED',
            fields: [{ field: 'unit_price', code: 'required', message: 'Sales Price is required' }],
            cause: SQLITE,
        });
        // A throw that declares its own status: the declared-status arm answers it.
        const declaredStatus = Object.assign(new Error(text), { status: 409, code: 'CONFLICT' });
        // A sandboxed body's deliberate throw: the unwrap answers it.
        const sandboxed = Object.assign(new Error(`action 'x' threw: ${text}`), { innerMessage: text });
        // node-postgres's fields with no NOT NULL text: classification never reaches the arm.
        for (const error of [declared, declaredStatus, sandboxed, POSTGRES_FIELDS_ONLY]) {
            expect(mapDataError(error, 'line_item').body.hint, String(error)).toBeUndefined();
            expect(driverNotNullRefusalAnswer(error, 'line_item'), String(error)).toBeUndefined();
        }
        expect(driverNotNullRefusalAnswer(driverError('UNIQUE constraint failed: line_item.email', { code: 'SQLITE_CONSTRAINT_UNIQUE' })))
            .toBeUndefined();
        expect(driverNotNullRefusalAnswer(new Error('connection refused'))).toBeUndefined();
        expect(driverNotNullRefusalAnswer(undefined)).toBeUndefined();
    });
});
