// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32250, ADR-0150 D5] The single-record `/data` door's classification
 * (`mapDataError`) answers a package-scoped refusal's `409 RESOURCE_CONFLICT`
 * with its candidates in `details.candidates`, beside the `error`, `code` and
 * `object` it already answered. Every other 409 answers as before (CONTROL).
 * The wire pins over the real routes are `@objectstack/rest`'s
 * `data-package-scoped-refusal-candidates.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { mapDataError } from './data-error-classification.js';

const CANDIDATES = [
    { kind: 'package', packageId: 'com.acme.crm' },
    { kind: 'package', packageId: 'com.acme.sales' },
];
const MESSAGE = 'The permission set "sales_rep" is held by 2 packages in this environment.';
const REFUSAL = {
    status: 'refused', reason: 'ambiguous-in-environment', type: 'permission', name: 'sales_rep',
    callerPackageId: null, candidates: CANDIDATES, message: MESSAGE,
};

describe('[#32250] mapDataError names a package-scoped refusal\'s candidates', () => {
    it('answers 409 RESOURCE_CONFLICT with details.candidates', () => {
        const thrown = Object.assign(new Error(MESSAGE), { code: 'RESOURCE_CONFLICT', status: 409, refusal: REFUSAL });
        expect(mapDataError(thrown, 'acct')).toEqual({
            status: 409,
            body: { error: MESSAGE, code: 'RESOURCE_CONFLICT', object: 'acct', details: { candidates: CANDIDATES } },
        });
    });

    it('CONTROL: a RESOURCE_CONFLICT with no refusal and a declared RECORD_LOCKED answer as before', () => {
        expect(mapDataError(Object.assign(new Error('in conflict'), { code: 'RESOURCE_CONFLICT', status: 409 }), 'acct')).toEqual({
            status: 409, body: { error: 'in conflict', code: 'RESOURCE_CONFLICT', object: 'acct' },
        });
        expect(mapDataError(Object.assign(new Error('locked'), { code: 'RECORD_LOCKED', status: 409 }), 'acct').body.details).toBeUndefined();
    });
});
