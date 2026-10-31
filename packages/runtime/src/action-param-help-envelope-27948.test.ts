// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27948 (ruling A, step 2): a param's `helpText` becomes an ADR-0032
 * `template` slot, so a parsed declaration carries
 * `{ dialect: 'template', source }` where it carried a string.
 * `summarizeActionParams` joins the help into the agent-facing param
 * description; read as a plain value, the envelope printed
 * `Reason — [object Object]`. It reads the slot's text, the same sentence the
 * bare string gives.
 */

import { describe, it, expect } from 'vitest';

import { summarizeActionParams } from './action-execution.js';

const NO_DEPS: any = {};
const SOURCE = 'Why pause {{ record.name }}?';

const actionWith = (helpText: unknown): any => ({
    name: 'pause_account',
    type: 'script',
    params: [{ name: 'reason', label: 'Reason', type: 'text', helpText }],
});

describe('summarizeActionParams reads a template-envelope helpText (#27948)', () => {
    it('the envelope gives the same param description as the bare string', () => {
        const fromString = summarizeActionParams(NO_DEPS, actionWith(SOURCE), undefined);
        const fromEnvelope = summarizeActionParams(NO_DEPS, actionWith({ dialect: 'template', source: SOURCE }), undefined);
        expect(fromString[0].description).toBe(`Reason — ${SOURCE}`);
        expect(fromEnvelope).toEqual(fromString);
    });

    it('an envelope with no source falls back to the bound field description, as an absent helpText does', () => {
        const obj = { fields: { reason: { label: 'Reason', type: 'text', description: 'The field help' } } };
        const action = (helpText: unknown): any => ({
            name: 'pause_account',
            params: [{ field: 'reason', ...(helpText === undefined ? {} : { helpText }) }],
        });
        const absent = summarizeActionParams(NO_DEPS, action(undefined), obj);
        expect(absent[0].description).toBe('Reason — The field help');
        expect(summarizeActionParams(NO_DEPS, action({ dialect: 'template' }), obj)).toEqual(absent);
    });
});
