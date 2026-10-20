// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24715] `labelNotNullRefusal`'s declines, each with the source it must not
 * ask. The doors' answer on a real driver is pinned in
 * `data-not-null-field-label-24715.test.ts`; these are the cases a real
 * boot reaches only through a hook's write or a failing read.
 */

import { describe, it, expect, vi } from 'vitest';
import { mapDataError } from '@objectstack/types';
import { labelNotNullRefusal, type NotNullRefusalLabelSources } from './not-null-refusal-label.js';

const OBJECT = 'line_item';
const notNull = (table: string) =>
    mapDataError(Object.assign(new Error(`NOT NULL constraint failed: ${table}.unit_price`), { code: 'SQLITE_CONSTRAINT_NOTNULL' }), OBJECT);

function sources(overrides: Partial<NotNullRefusalLabelSources> = {}) {
    const s = {
        object: OBJECT,
        readObject: vi.fn(async () => ({
            name: OBJECT,
            fields: { unit_price: { type: 'number', label: 'Sales Price', storage: { notNull: true } } },
        })),
        locale: undefined,
        resolveI18nService: vi.fn(async () => undefined),
        ...overrides,
    };
    return s as typeof s & NotNullRefusalLabelSources;
}

describe('[#24715] labelNotNullRefusal', () => {
    it('CONTROL: the requested object\'s refusal is named by the label', async () => {
        const s = sources();
        const answer = await labelNotNullRefusal(notNull(OBJECT), s);
        expect(answer.body.error).toBe('Sales Price is required');
        expect(s.readObject).toHaveBeenCalledWith(OBJECT);
    });

    it('a refusal the driver attributes to ANOTHER table is not the requested object\'s field: unchanged, nothing read', async () => {
        const s = sources();
        const original = notNull('audit_row');
        expect(await labelNotNullRefusal(original, s)).toBe(original);
        expect(s.readObject).not.toHaveBeenCalled();
    });

    it('any other answer: unchanged, nothing read', async () => {
        const s = sources();
        const original = mapDataError(Object.assign(new Error('UNIQUE constraint failed: line_item.code'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }), OBJECT);
        expect(await labelNotNullRefusal(original, s)).toBe(original);
        expect(s.readObject).not.toHaveBeenCalled();
        expect(s.resolveI18nService).not.toHaveBeenCalled();
    });

    it('an object read that fails leaves the classification\'s answer as it is', async () => {
        const original = notNull(OBJECT);
        const s = sources({ readObject: vi.fn(async () => { throw new Error('metadata store unreachable'); }) });
        expect(await labelNotNullRefusal(original, s)).toBe(original);
    });

    it('a column the object does not declare: unchanged', async () => {
        const original = notNull(OBJECT);
        const s = sources({ readObject: vi.fn(async () => ({ name: OBJECT, fields: {} })) });
        expect(await labelNotNullRefusal(original, s)).toBe(original);
    });
});
