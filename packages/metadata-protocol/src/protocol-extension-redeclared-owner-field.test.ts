// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, second rule] The judge of an `objectExtensions[].fields`
 * entry that re-declares a field the extended object's owner declares
 * (`judgeRedeclaredOwnerFields`). The doors that ask it pin their own
 * envelopes: the `object_extension` save door in
 * `packages/runtime/src/domains/meta-object-extension-item.test.ts`,
 * `os validate` in `packages/cli/test/validate-extension-redeclared-owner-field.test.ts`
 * and the install door in
 * `packages/cloud-connection/src/marketplace-install-local-field-patch-targets.test.ts`.
 *
 * Pinned here: what counts as a change (outside the display-property
 * whitelist, after the `FieldSchema` reading), what is not judged (an added
 * field, the package's own object, an unknown owner), the location, and the
 * save doors' `VALIDATION_ERROR` / 400 envelope.
 */

import { describe, it, expect } from 'vitest';
import { BASE_FIELD_DISPLAY_WHITELIST } from '@objectstack/spec/data';
import {
    judgeRedeclaredOwnerFields,
    redeclaredFieldChanges,
    redeclaredOwnerFieldRefusalError,
    type ObjectOwnerDeclaration,
} from './protocol-extension-redeclared-owner-field.js';

const OWNER = 'com.acme.crm';
const MODULE = 'com.acme.revenue';

const OPPORTUNITY = {
    name: 'crm_opportunity',
    fields: {
        amount: { type: 'number', label: 'Amount', required: true },
        stage: {
            type: 'select', label: 'Stage',
            options: [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }],
        },
    },
};

const owners = (extra: Record<string, ObjectOwnerDeclaration> = {}) => {
    const map: Record<string, ObjectOwnerDeclaration> = { crm_opportunity: { packageId: OWNER, definition: OPPORTUNITY }, ...extra };
    return (name: string) => map[name];
};

const judge = (fields: Record<string, unknown>, packageId: string = MODULE) => judgeRedeclaredOwnerFields({
    packageId, objectExtensions: [{ extend: 'crm_opportunity', fields }], ownerOf: owners(),
});

describe('judgeRedeclaredOwnerFields — refused: a change outside the display-property whitelist', () => {
    it('a type change', () => {
        const [r, ...rest] = judge({ amount: { type: 'text', label: 'Amount', required: true } });
        expect(rest).toEqual([]);
        expect(r).toMatchObject({
            path: 'objectExtensions[0].fields.amount', object: 'crm_opportunity', field: 'amount',
            packageId: MODULE, ownerPackageId: OWNER, changed: ['type'],
        });
        expect(r!.message.split(':')[0]).toBe(
            "Extension field 'amount' on object 'crm_opportunity' re-declares the field package 'com.acme.crm' declares and changes `type`",
        );
        expect(r!.message).toContain('`fieldPatches`');
        for (const key of BASE_FIELD_DISPLAY_WHITELIST.field) expect(r!.message).toContain(`\`${key}\``);
    });

    it('a dropped `required`: the entry replaces the owner field whole, so an omitted key is a change', () => {
        expect(judge({ amount: { type: 'number', label: 'Deal size' } }).map((r) => r.changed)).toEqual([['required']]);
    });

    it('`readonly`, a formula, and a default: each one named', () => {
        const [r] = judge({ amount: { type: 'number', label: 'Amount', required: true, readonly: true, defaultValue: 0 } });
        expect(r!.changed).toEqual(['defaultValue', 'readonly']);
    });

    it('`options` membership: an added option value', () => {
        const [r] = judge({ stage: { ...OPPORTUNITY.fields.stage, options: [...OPPORTUNITY.fields.stage.options, { value: 'lost', label: 'Lost' }] } });
        expect(r!.changed).toEqual(['options']);
    });

    it('the array spelling of `fields` is located by index', () => {
        const refusals = judgeRedeclaredOwnerFields({
            packageId: MODULE,
            objectExtensions: [{ extend: 'crm_opportunity', fields: [{ name: 'amount', type: 'text', label: 'Amount', required: true }] }],
            ownerOf: owners(),
            at: 'packages[1].manifest.',
        });
        expect(refusals.map((r) => r.path)).toEqual(['packages[1].manifest.objectExtensions[0].fields[0]']);
    });
});

describe('judgeRedeclaredOwnerFields — admitted', () => {
    it('a display-only re-declaration: labels, help text and option labels', () => {
        expect(judge({
            amount: { name: 'amount', type: 'number', label: 'Deal size', description: 'd', inlineHelpText: 'h', placeholder: 'p', required: true },
            stage: { type: 'select', label: 'Phase', options: [{ value: 'won', label: 'Closed won' }, { value: 'open', label: 'Open' }] },
        })).toEqual([]);
    });

    it('a default the `FieldSchema` parse stamps is no change (`required: false` against an owner that omits it)', () => {
        const ownerOf = owners({ crm_note: { packageId: OWNER, definition: { name: 'crm_note', fields: { body: { type: 'text', label: 'Body' } } } } });
        expect(judgeRedeclaredOwnerFields({
            packageId: MODULE,
            objectExtensions: [{ extend: 'crm_note', fields: { body: { type: 'text', label: 'Note', required: false, hidden: false } } }],
            ownerOf,
        })).toEqual([]);
    });

    it('an added field: a key the owner does not declare', () => {
        expect(judge({ discount: { type: 'percent', label: 'Discount' } })).toEqual([]);
    });

    it('an extension of the package\'s own object', () => {
        expect(judge({ amount: { type: 'text', label: 'Amount' } }, OWNER)).toEqual([]);
    });

    it('an object no owner is known for at this door', () => {
        expect(judgeRedeclaredOwnerFields({
            packageId: MODULE, objectExtensions: [{ extend: 'crm_lead', fields: { amount: { type: 'text' } } }], ownerOf: owners(),
        })).toEqual([]);
    });

    it('the ADR-0010 envelope on the owner declaration is no change', () => {
        expect(redeclaredFieldChanges(
            { type: 'number', label: 'Amount', required: true },
            { type: 'number', label: 'Amount', required: true, _packageId: OWNER },
        )).toEqual([]);
    });
});

describe('redeclaredOwnerFieldRefusalError — the save doors\' envelope', () => {
    it('VALIDATION_ERROR / 400, every entry located in `issues`', () => {
        const refusals = judge({ amount: { type: 'text', label: 'Amount', required: true }, stage: { type: 'text', label: 'Stage' } });
        const err = redeclaredOwnerFieldRefusalError(refusals);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
        expect(err.issues.map((i) => i.path)).toEqual(['objectExtensions[0].fields.amount', 'objectExtensions[0].fields.stage']);
        expect(err.message).toContain('(1 more field in `issues`.)');
    });
});
