// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24715] The classification's half of a NOT NULL refusal named by its field's
 * label: the site it recognises, the relabel it hands the caller that holds the
 * field map, and the hint that has to hold when nobody relabels.
 *
 * The door half — `@objectstack/rest`'s `/data` create and update, on a real
 * driver — is pinned in `packages/rest/src/data-not-null-field-label-24715.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { mapDataError, notNullRefusalSite, relabelNotNullRefusal } from './data-error-classification.js';
import { validationFailure } from './validation-failure.js';

const driverError = (message: string, code: string | number) => Object.assign(new Error(message), { code });

const SQLITE = driverError(
    'update [statement and bound values redacted] - NOT NULL constraint failed: line_item.unit_price',
    'SQLITE_CONSTRAINT_NOTNULL',
);
const POSTGRES = driverError(
    'null value in column "unit_price" of relation "line_item" violates not-null constraint',
    '23502',
);
const POSTGRES_NO_RELATION = driverError('null value in column "unit_price" violates not-null constraint', '23502');
const MYSQL = driverError("ER_BAD_NULL_ERROR: Column 'unit_price' cannot be null", 'ER_BAD_NULL_ERROR');

describe('[#24715] notNullRefusalSite — the NOT NULL branch\'s own answer, and no other', () => {
    it.each([
        ['SQLite', SQLITE, { column: 'unit_price', table: 'line_item' }],
        ['Postgres, naming the relation', POSTGRES, { column: 'unit_price', table: 'line_item' }],
        ['Postgres, naming none', POSTGRES_NO_RELATION, { column: 'unit_price' }],
        ['MySQL, which never names the table', MYSQL, { column: 'unit_price' }],
    ])('%s: the column the sentence always named, and the table where the dialect says it', (_dialect, error, site) => {
        const answer = mapDataError(error, 'line_item');
        expect(answer.body.fields).toEqual([{ field: 'unit_price', code: 'required', message: 'unit_price is required' }]);
        expect(notNullRefusalSite(answer)).toEqual(site);
    });

    it('a record validator\'s `required` refusal is the same envelope and is NOT recognised', () => {
        const answer = mapDataError(
            validationFailure('unit_price is required', [{ field: 'unit_price', code: 'required', message: 'unit_price is required' }]),
            'line_item',
        );
        expect(answer).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
        expect(notNullRefusalSite(answer)).toBeUndefined();
    });

    it('a copy of the branch\'s body is not the branch\'s answer', () => {
        const answer = mapDataError(SQLITE, 'line_item');
        expect(notNullRefusalSite({ body: { ...answer.body } })).toBeUndefined();
    });
});

describe('[#24715] the classification\'s hint holds for both ways in, and prescribes no declaration', () => {
    it('leads with the value, never with `required`, and names drift only as a condition', () => {
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

describe('[#24715] relabelNotNullRefusal — only the text moves', () => {
    const MESSAGE = 'Sales Price is required';

    it('a field declared `storage.notNull`: the label in both sentences, the declared column\'s hint', () => {
        const answer = mapDataError(SQLITE, 'line_item');
        const relabelled = relabelNotNullRefusal(answer, { message: MESSAGE, declaresNotNull: true });

        expect(relabelled.status).toBe(400);
        expect(relabelled.body).toMatchObject({
            error: MESSAGE,
            code: 'VALIDATION_FAILED',
            fields: [{ field: 'unit_price', code: 'required', message: MESSAGE }],
            object: 'line_item',
        });
        expect(Object.keys(relabelled.body)).toEqual(Object.keys(answer.body));
        expect(Object.keys((relabelled.body.fields as object[])[0])).toEqual(['field', 'code', 'message']);
        const hint = String(relabelled.body.hint);
        expect(hint).toContain("'unit_price'");
        expect(hint).toContain('`storage: { notNull: true }`');
        expect(hint).not.toContain('`required`');
        expect(hint).not.toMatch(/drift|os migrate/);
        // The classification's own answer is not mutated.
        expect(answer.body.error).toBe('unit_price is required');
    });

    it('a field that does not declare it: the label, and the classification\'s hint, drift remedy included', () => {
        const answer = mapDataError(SQLITE, 'line_item');
        const relabelled = relabelNotNullRefusal(answer, { message: MESSAGE, declaresNotNull: false });

        expect(relabelled.body.error).toBe(MESSAGE);
        expect((relabelled.body.fields as any[])[0].message).toBe(MESSAGE);
        expect(relabelled.body.hint).toBe(answer.body.hint);
        expect(String(relabelled.body.hint)).toMatch(/os migrate/);
    });

    it('any other answer is handed back as it came', () => {
        const answer = mapDataError(
            validationFailure('unit_price is required', [{ field: 'unit_price', code: 'required', message: 'unit_price is required' }]),
            'line_item',
        );
        expect(relabelNotNullRefusal(answer, { message: MESSAGE, declaresNotNull: true })).toBe(answer);
    });
});
