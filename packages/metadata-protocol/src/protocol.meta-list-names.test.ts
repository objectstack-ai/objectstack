// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29236, ruling 6580261740 letter A] `getMetaItems({ type, names })` — the
 * list door's `?names=a,b` pushed down to the store read
 * (`GetMetaItemsRequestSchema.names`).
 *
 * The protocol keeps the items of those names once every source is merged,
 * BEFORE the per-item work after the merge (the app nav contributions, the lock
 * selection, the governance, the serving decorations), so that work runs on the
 * named items alone. A name that matches nothing is simply absent.
 *
 * The engine is the shape `get-meta-items-package-writable.test.ts` drives: the
 * registry surface the list read touches and a `find` that answers the overlay
 * query with nothing.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const APPS = ['crm', 'helpdesk', 'payroll'].map((name) => ({ name, label: name.toUpperCase(), navigation: [] }));
const OBJECTS = ['account', 'contact', 'lead'].map((name) => ({ name, label: name, fields: { name: { type: 'text' } } }));

function make() {
    const contributedTo: string[] = [];
    const engine: any = {
        manifests: new Map(),
        find: async () => [],
        registry: {
            listItems: (type: string) => structuredClone(type === 'app' ? APPS : type === 'object' ? OBJECTS : []),
            getPackage: () => undefined,
            getItem: () => undefined,
            getObject: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: any) => {
                contributedTo.push(app?.name);
                return app;
            },
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    return { protocol, contributedTo };
}

const namesOf = (res: any): string[] => (res.items as any[]).map((it) => it.name);

describe('getMetaItems — `names` narrows the served list (#29236)', () => {
    it('keeps only the named items, on `object` and on `app`', async () => {
        const { protocol } = make();
        expect(namesOf(await protocol.getMetaItems({ type: 'object', names: ['lead', 'account'] }))).toEqual(['account', 'lead']);
        expect(namesOf(await protocol.getMetaItems({ type: 'app', names: ['helpdesk'] }))).toEqual(['helpdesk']);
    });

    it('narrows BEFORE the per-item work after the merge: only the named apps get their nav contributions', async () => {
        const { protocol, contributedTo } = make();
        await protocol.getMetaItems({ type: 'app', names: ['payroll', 'crm'] });
        expect(contributedTo.sort()).toEqual(['crm', 'payroll']);
    });

    it('a name that matches nothing is simply absent', async () => {
        const { protocol } = make();
        expect(namesOf(await protocol.getMetaItems({ type: 'object', names: ['account', 'nope'] }))).toEqual(['account']);
        expect(namesOf(await protocol.getMetaItems({ type: 'object', names: ['nope'] }))).toEqual([]);
    });

    it('serves each named item exactly as the whole list serves it', async () => {
        const { protocol } = make();
        const whole = await protocol.getMetaItems({ type: 'object' });
        const named = await protocol.getMetaItems({ type: 'object', names: ['contact'] });
        expect(named.items).toEqual((whole.items as any[]).filter((it) => it.name === 'contact'));
    });

    it('control: absent `names` lists every item, and every app gets its contributions', async () => {
        const { protocol, contributedTo } = make();
        expect(namesOf(await protocol.getMetaItems({ type: 'object' }))).toEqual(['account', 'contact', 'lead']);
        await protocol.getMetaItems({ type: 'app' });
        expect(contributedTo.sort()).toEqual(['crm', 'helpdesk', 'payroll']);
    });
});
