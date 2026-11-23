// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10] The arrangement judge and the save door's gate that asks it:
 * `fieldGroups` and `relatedLists` on an object extension are the base's
 * paired `.custom` package's to write. Any other package is refused once per
 * key, with the active doors' envelope (`VALIDATION_ERROR` / 400, `issues[]`
 * locating the key) and the prescription naming `place`. Each refusal is
 * paired with a CONTROL through the same call that differs by one thing.
 */

import './lint-root-preload.testkit.js';
import { describe, expect, it } from 'vitest';
import { judgeExtensionArrangement, extensionArrangementRefusalError } from './protocol-extension-arrangement.js';
import { objectExtensionItemRefusal } from './protocol-object-extension-item.js';

const BASE = 'com.vendor.crm';
const PAIR = 'com.vendor.crm.custom';
const PARTNER = 'com.acme.partner';

const GROUPS = [{ key: 'basic', label: 'Basics', fields: ['name', 'region__c'] }];
const TABS = ['crm_contact', { list: 'crm_task', hidden: true }];

describe('judgeExtensionArrangement — the rule', () => {
    it('a plain package writing `fieldGroups` is refused once, at the key, prescribing `place`', () => {
        const refusals = judgeExtensionArrangement({
            packageId: PARTNER,
            objectExtensions: [{ extend: 'crm_lead', fieldGroups: GROUPS }],
        });
        expect(refusals).toHaveLength(1);
        expect(refusals[0]).toMatchObject({
            path: 'objectExtensions[0].fieldGroups', object: 'crm_lead', key: 'fieldGroups', packageId: PARTNER,
        });
        expect(refusals[0]!.message).toContain('`place`');
        expect(refusals[0]!.message).toContain('`.custom`');
        expect(refusals[0]!.message.length).toBeLessThanOrEqual(500);
    });

    it('`relatedLists` is refused the same way; both keys are one row each, in the list\'s order', () => {
        const refusals = judgeExtensionArrangement({
            packageId: PARTNER,
            objectExtensions: [{ extend: 'crm_lead', relatedLists: TABS, fieldGroups: GROUPS }, { extend: 'crm_account', relatedLists: [] }],
            at: 'packages[1].manifest.',
        });
        expect(refusals.map((r) => r.path)).toEqual([
            'packages[1].manifest.objectExtensions[0].fieldGroups',
            'packages[1].manifest.objectExtensions[0].relatedLists',
            'packages[1].manifest.objectExtensions[1].relatedLists',
        ]);
        expect(refusals[1]!.message).toContain("place: [{ list: 'contract', after: 'opportunity' }]");
    });

    it('CONTROL: the same body in the base\'s paired `.custom` package is admitted', () => {
        expect(judgeExtensionArrangement({
            packageId: PAIR,
            objectExtensions: [{ extend: 'crm_lead', fieldGroups: GROUPS, relatedLists: TABS }],
        })).toEqual([]);
    });

    it('CONTROL: a plain package that writes neither key, and places with `place`, is admitted', () => {
        expect(judgeExtensionArrangement({
            packageId: PARTNER,
            objectExtensions: [{ extend: 'crm_lead', fields: { tier: { type: 'text' } }, place: [{ field: 'tier', group: 'basic' }] }],
        })).toEqual([]);
    });

    it.each([[undefined], [null], ['']])('a body bound to no package (%j) is not judged', (packageId) => {
        expect(judgeExtensionArrangement({ packageId, objectExtensions: [{ extend: 'crm_lead', fieldGroups: GROUPS }] })).toEqual([]);
    });

    it('the envelope: VALIDATION_ERROR / 400, the first sentence, every key located in `issues`', () => {
        const refusals = judgeExtensionArrangement({
            packageId: PARTNER,
            objectExtensions: [{ extend: 'crm_lead', fieldGroups: GROUPS, relatedLists: TABS }],
        });
        const err = extensionArrangementRefusalError(refusals);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(err.message).toContain(refusals[0]!.message);
        expect(err.message).toContain('1 more key in `issues`');
        expect(err.issues.map((i) => i.path)).toEqual(['objectExtensions[0].fieldGroups', 'objectExtensions[0].relatedLists']);
    });
});

describe('objectExtensionItemRefusal — the save, publish and restore gate asks it', () => {
    const item = (extra: Record<string, unknown>) => ({ extend: 'crm_lead', ...extra });
    const ask = (binding: string, body: Record<string, unknown>) => objectExtensionItemRefusal('object_extension', {
        item: body, name: 'crm_lead', binding, registry: undefined, scope: undefined,
    }) as (Error & { code?: string; status?: number; issues?: Array<{ path: string; message: string }> }) | undefined;

    it('an `object_extension` item written into a plain package with `fieldGroups` is refused, located at the key', () => {
        const err = ask(PARTNER, item({ fieldGroups: GROUPS }));
        expect(err?.code).toBe('VALIDATION_ERROR');
        expect(err?.status).toBe(400);
        expect(err?.issues).toHaveLength(1);
        expect(err?.issues?.[0]?.path).toBe('fieldGroups');
        expect(err?.message).toContain('`place`');
    });

    it('…and with `relatedLists`, located at that key', () => {
        const err = ask(PARTNER, item({ relatedLists: TABS }));
        expect(err?.status).toBe(400);
        expect(err?.issues?.map((i) => i.path)).toEqual(['relatedLists']);
    });

    it('CONTROL: the same item written into the paired `.custom` package is admitted', () => {
        expect(ask(PAIR, item({ fields: { region__c: { type: 'text' } }, fieldGroups: GROUPS, relatedLists: TABS }))).toBeUndefined();
    });

    it('CONTROL: the plain package\'s item without the keys is admitted', () => {
        expect(ask(PARTNER, item({ fields: { tier: { type: 'text' } }, place: [{ field: 'tier', group: 'basic' }] }))).toBeUndefined();
    });

    it(`the base (${BASE}) extending its own object is refused too: its own arrangement is the object's`, () => {
        const err = ask(BASE, item({ fieldGroups: GROUPS }));
        expect(err?.issues?.map((i) => i.path)).toEqual(['fieldGroups']);
    });
});
