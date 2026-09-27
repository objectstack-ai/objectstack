// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { applyMappingToRows, refuseUnknownMappingTargets, type MappingArtifactLike } from './import-mapping';

const artifact = (fieldMapping: MappingArtifactLike['fieldMapping']): MappingArtifactLike => ({
    name: 'm', targetObject: 'o', fieldMapping,
});

describe('applyMappingToRows — transform semantics', () => {
    it('none renames; output is a strict projection (unmapped columns drop)', () => {
        const r = applyMappingToRows(
            [{ A: '1', Junk: 'x' }],
            artifact([{ source: 'A', target: 'a', transform: 'none' }]),
        );
        expect(r).toEqual({ ok: true, rows: [{ a: '1' }] });
    });

    it('constant writes params.value regardless of the source cell', () => {
        const r = applyMappingToRows(
            [{ A: 'whatever' }],
            artifact([{ source: 'A', target: 'tier', transform: 'constant', params: { value: 'gold' } }]),
        );
        expect(r).toEqual({ ok: true, rows: [{ tier: 'gold' }] });
    });

    it('map translates known values and passes unknown ones through', () => {
        const r = applyMappingToRows(
            [{ S: 'Open' }, { S: 'Weird' }],
            artifact([{ source: 'S', target: 's', transform: 'map', params: { valueMap: { Open: 'draft' } } }]),
        );
        expect(r).toEqual({ ok: true, rows: [{ s: 'draft' }, { s: 'Weird' }] });
    });

    it('split fans one column into positional targets (missing parts → undefined)', () => {
        const r = applyMappingToRows(
            [{ Name: 'John Doe' }, { Name: 'Cher' }],
            artifact([{ source: 'Name', target: ['first', 'last'], transform: 'split', params: { separator: ' ' } }]),
        );
        expect(r).toEqual({ ok: true, rows: [{ first: 'John', last: 'Doe' }, { first: 'Cher', last: undefined }] });
    });

    it('join concatenates source columns, skipping empties', () => {
        const r = applyMappingToRows(
            [{ City: 'Berlin', Street: 'Unter den Linden' }, { City: 'Rome', Street: '' }],
            artifact([{ source: ['City', 'Street'], target: 'address', transform: 'join', params: { separator: ', ' } }]),
        );
        expect(r).toEqual({ ok: true, rows: [{ address: 'Berlin, Unter den Linden' }, { address: 'Rome' }] });
    });

    it('lookup copies the raw value through (metaMap resolves it downstream)', () => {
        const r = applyMappingToRows(
            [{ Owner: '张三' }],
            artifact([{ source: 'Owner', target: 'owner', transform: 'lookup' }]),
        );
        expect(r).toEqual({ ok: true, rows: [{ owner: '张三' }] });
    });

    it('rejects an unknown transform loudly', () => {
        const r = applyMappingToRows(
            [{ A: '1' }],
            artifact([{ source: 'A', target: 'a', transform: 'zip' as never }]),
        );
        expect(r).toMatchObject({ ok: false, status: 400, code: 'UNSUPPORTED_TRANSFORM' });
    });
});

describe('refuseUnknownMappingTargets — the door verdict (#20150)', () => {
    const object = { name: 'o', fields: { a: { type: 'text' }, first: { type: 'text' } } };

    it('refuses a target that names no field with the commit\'s own code and status', () => {
        const r = refuseUnknownMappingTargets(
            artifact([{ source: 'A', target: 'a' }, { source: 'B', target: 'b' }]),
            'o',
            object,
        );
        expect(r).toMatchObject({ ok: false, status: 400, code: 'INVALID_FIELD' });
        expect(r?.error).toContain("Unknown field 'b' on object 'o'");
        expect(r?.error).toContain('fieldMapping[1].target "b"');
    });

    it('names every target that misses, split elements included', () => {
        const r = refuseUnknownMappingTargets(
            artifact([{ source: 'N', target: ['first', 'last'], transform: 'split' }, { source: 'Z', target: 'zz' }]),
            'o',
            object,
        );
        expect(r?.error).toContain('fieldMapping[0].target[1] "last"');
        expect(r?.error).toContain('fieldMapping[1].target "zz"');
    });

    it('passes a mapping whose targets resolve, provisioned columns included', () => {
        expect(refuseUnknownMappingTargets(
            artifact([{ source: 'A', target: 'a' }, { source: 'O', target: 'owner_id' }, { source: 'I', target: 'id' }]),
            'o',
            object,
        )).toBeUndefined();
    });

    it('has no opinion when the object definition did not resolve or declares no fields', () => {
        const bad = artifact([{ source: 'B', target: 'b' }]);
        expect(refuseUnknownMappingTargets(bad, 'o', undefined)).toBeUndefined();
        expect(refuseUnknownMappingTargets(bad, 'o', { name: 'o', fields: {} })).toBeUndefined();
    });
});

// [#20149] A target may name a declared part of a compound field; the parts
// one row maps are assembled into ONE value under the field's key, before the
// engine sees the row. The verdict is the spec's; this pins the assembly rule.
describe('applyMappingToRows — compound-field part assembly (#20149)', () => {
    const contact = {
        name: 'crm_contact',
        fields: {
            full_name: { type: 'text' },
            mailing_address: { type: 'address' },
            billing_address: { type: 'address' },
        },
    };
    const addressFeed = artifact([
        { source: 'Name', target: 'full_name' },
        { source: 'Street', target: 'mailing_address.street' },
        { source: 'City', target: 'mailing_address.city' },
        { source: 'State', target: 'mailing_address.state' },
        { source: 'Zip', target: 'mailing_address.postalCode' },
        { source: 'Country', target: 'mailing_address.country' },
    ]);

    it('assembles the five address columns into one value under the field key — no dotted key survives', () => {
        const r = applyMappingToRows(
            [{ Name: 'Ada', Street: '1 Main St', City: 'Springfield', State: 'IL', Zip: '62701', Country: 'USA' }],
            addressFeed,
            { objectSchema: contact },
        );
        expect(r).toEqual({
            ok: true,
            rows: [{
                full_name: 'Ada',
                mailing_address: { street: '1 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'USA' },
            }],
        });
        expect(Object.keys((r as { rows: Array<Record<string, unknown>> }).rows[0]).sort()).toEqual(['full_name', 'mailing_address']);
    });

    it('drops a blank part (empty, whitespace, a nullValues token) and trims the rest; an all-blank address stays unset', () => {
        const r = applyMappingToRows(
            [
                { Name: 'Partial', Street: '  2 Side St ', City: 'Shelbyville', State: '', Zip: '   ', Country: 'N/A' },
                { Name: 'Blank', Street: '', City: '', State: '', Zip: '', Country: '' },
            ],
            addressFeed,
            { objectSchema: contact, nullValues: ['N/A'] },
        );
        expect(r).toEqual({
            ok: true,
            rows: [
                { full_name: 'Partial', mailing_address: { street: '2 Side St', city: 'Shelbyville' } },
                { full_name: 'Blank' },
            ],
        });
    });

    it('honours trimWhitespace: false, as a flat text cell does', () => {
        const r = applyMappingToRows(
            [{ Street: '  3 Pad St ' }],
            artifact([{ source: 'Street', target: 'mailing_address.street' }]),
            { objectSchema: contact, trimWhitespace: false },
        );
        expect(r).toEqual({ ok: true, rows: [{ mailing_address: { street: '  3 Pad St ' } }] });
    });

    it('fills parts from every transform — split elements, constant, join, map — and keeps two compound fields apart', () => {
        const r = applyMappingToRows(
            [{ Where: 'Rome / Lazio', Line1: 'Via Roma 1', Line2: 'Int. 3', Kind: 'IT', BillStreet: 'PO Box 9' }],
            artifact([
                { source: 'Where', target: ['mailing_address.city', 'mailing_address.state'], transform: 'split', params: { separator: '/' } },
                { source: 'x', target: 'mailing_address.country', transform: 'constant', params: { value: 'Italy' } },
                { source: ['Line1', 'Line2'], target: 'mailing_address.formatted', transform: 'join', params: { separator: ', ' } },
                { source: 'Kind', target: 'mailing_address.countryCode', transform: 'map', params: { valueMap: { IT: 'IT' } } },
                { source: 'BillStreet', target: 'billing_address.street' },
            ]),
            { objectSchema: contact },
        );
        expect(r).toEqual({
            ok: true,
            rows: [{
                mailing_address: { city: 'Rome', state: 'Lazio', country: 'Italy', formatted: 'Via Roma 1, Int. 3', countryCode: 'IT' },
                billing_address: { street: 'PO Box 9' },
            }],
        });
    });

    it('control: without the object definition no target is read as a part (the door judged nothing either)', () => {
        const r = applyMappingToRows([{ Street: 'x' }], artifact([{ source: 'Street', target: 'mailing_address.street' }]));
        expect(r).toEqual({ ok: true, rows: [{ 'mailing_address.street': 'x' }] });
    });
});

describe('refuseUnknownMappingTargets — compound-field parts (#20149)', () => {
    const contact = {
        name: 'crm_contact',
        fields: {
            full_name: { type: 'text' },
            mailing_address: { type: 'address' },
            account: { type: 'lookup', reference: 'crm_account' },
        },
    };
    const PARTS = 'street, city, state, postalCode, country, countryCode, formatted';

    it('passes a mapping that names declared parts', () => {
        expect(refuseUnknownMappingTargets(
            artifact([{ source: 'S', target: 'mailing_address.street' }, { source: 'C', target: 'mailing_address.city' }]),
            'crm_contact',
            contact,
        )).toBeUndefined();
    });

    it('refuses an unknown part with the commit\'s code and status, naming the declared parts', () => {
        const r = refuseUnknownMappingTargets(
            artifact([{ source: 'S', target: 'mailing_address.stret' }]),
            'crm_contact',
            contact,
        );
        expect(r).toMatchObject({ ok: false, status: 400, code: 'INVALID_FIELD' });
        expect(r?.error).toContain("Unknown field 'mailing_address.stret' on object 'crm_contact'");
        expect(r?.error).toContain(`fieldMapping[0].target "mailing_address.stret" (the address field "mailing_address" declares the parts ${PARTS})`);
        expect(r?.error).toContain(`or at a declared part of a compound field as field.part (mailing_address: ${PARTS})`);
    });

    it('refuses a dotted path on a field with no parts, and never as a lookup traversal', () => {
        const r = refuseUnknownMappingTargets(
            artifact([{ source: 'F', target: 'full_name.first' }, { source: 'A', target: 'account.name' }]),
            'crm_contact',
            contact,
        );
        expect(r).toMatchObject({ status: 400, code: 'INVALID_FIELD' });
        expect(r?.error).toContain('fieldMapping[0].target "full_name.first" (the text field "full_name" has no parts)');
        expect(r?.error).toContain('(the lookup field "account" has no parts: a dotted target never traverses a reference');
        expect(r?.error).toContain(`mailing_address: ${PARTS}`);
    });

    it('refuses a part of a field the same mapping also writes whole', () => {
        const r = refuseUnknownMappingTargets(
            artifact([{ source: 'J', target: 'mailing_address' }, { source: 'S', target: 'mailing_address.street' }]),
            'crm_contact',
            contact,
        );
        expect(r).toMatchObject({ ok: false, status: 400, code: 'INVALID_FIELD' });
        expect(r?.error).toContain(
            'writes a compound field both whole and by part (fieldMapping[1].target "mailing_address.street", '
            + 'with the whole field at fieldMapping[0].target)',
        );
        expect(r?.error).toContain('refused before any row, on the dry run and the commit alike');
        // A collision-only refusal lists the legal parts too (ruling item 3).
        expect(r?.error).toContain(`or at a declared part of a compound field as field.part (mailing_address: ${PARTS})`);
    });
});
