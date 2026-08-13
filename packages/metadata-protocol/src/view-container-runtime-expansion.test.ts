// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7736 — a `defineView` container authored through the RUNTIME door is served,
 * not merely stored.
 *
 * "Object has-many View" (ADR-0017 §2, §3.2) makes container ingestion
 * dual-read: the container is registered under the bare `<object>` key, and
 * every named view is ALSO registered as an independent ViewItem under
 * `<object>.<viewKey>`. Only the expanded items carry the `viewKind` + `object`
 * pair that the object-bound read paths filter on, so the expanded layer — not
 * the container — is what `GET /meta/view?object=`, `getViewsByObject()` and
 * the view switcher actually read.
 *
 * Both SOURCE registrars do this (the ObjectQL boot loop and the metadata
 * artifact/HMR loader). The RUNTIME door did not. Measured before the fix, on
 * the card's own repro: the write is accepted, the body is stored verbatim
 * carrying neither `object` nor `viewKind`, `getMetaItem` by name serves it
 * badged `_diagnostics.valid: true` — and the enumerating read answers ZERO,
 * because `getMetaItems` drops containers from enumeration on the stated
 * assumption that "the registrar expands it into independent ViewItems", which
 * for a runtime-written row never happened.
 *
 * The pin is at the protocol, not at either read exit, because there are two
 * independent object-bound readers (the REST route reads through
 * `getMetaItems`; `getViewsByObject()` reads `MetadataManager.list`) and a fix
 * at one leaves the other empty. `hydrateOverlayIntoRegistry` is the single
 * choke point all three runtime hydration callers share.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './index.js';

interface Row {
    id: string; type: string; name: string; organization_id: string | null;
    package_id: string | null; state: string; metadata: string; checksum?: string; version?: number;
}

function matches(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/**
 * A registry stub that actually STORES what `registerItem` hands it and returns
 * it from `listItems` — the two halves this card turns on. A no-op registry
 * would pass every assertion below vacuously.
 */
function makeStubEngine() {
    const rows = new Map<string, Row>();
    const registered = new Map<string, Map<string, any>>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) { return findRow(opts.where)?.row ?? null; },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => matches(r, opts.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table !== 'sys_metadata') return { id: 'side_table' };
            const row = { id: `r_${++nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key); rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts?: Record<string, unknown>) { assertEngineDeleteDispatch(opts); return { deleted: 0 }; },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> { return cb(undefined, { owned: true }); },
        async syncObjectSchema() { },
        registry: {
            listItems: (type: string) => Array.from(registered.get(type)?.values() ?? []),
            isPackageDisabled: () => false,
            getItem: (type: string, name: string) => registered.get(type)?.get(name),
            registerItem: (type: string, item: any) => {
                if (!registered.has(type)) registered.set(type, new Map());
                registered.get(type)!.set(item?.name, item);
            },
            registerObject: () => { },
            getPackage: () => undefined,
        },
    };
    return { engine, rows, registered };
}

/** The card's repro body: a `defineView` container, as `defineView` emits it. */
const leadContainer = {
    list: {
        label: 'All Leads',
        type: 'grid',
        data: { provider: 'object', object: 'crm_lead' },
        columns: [{ field: 'name' }, { field: 'company' }],
    },
    listViews: {
        pipeline: {
            label: 'Lead Pipeline',
            type: 'grid',
            data: { provider: 'object', object: 'crm_lead' },
            columns: [{ field: 'name' }],
        },
    },
};

/** The object-bound predicate BOTH read exits filter on, verbatim. */
const switcherMatches = (items: any[], object: string) =>
    items.filter((v: any) => v && typeof v === 'object' && v.viewKind && v.object === object);

describe('#7736 a runtime-authored view container is served', () => {
    it('serves the expanded ViewItems the object-bound read paths filter on', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: leadContainer });

        const list: any = await protocol.getMetaItems({ type: 'view' });
        const served = switcherMatches(list.items, 'crm_lead');

        expect(
            served.map((v: any) => v.name).sort(),
            'A runtime-authored container must expand into the independent ViewItems '
            + 'the switcher reads, exactly as the two source registrars do.',
        ).toEqual(['crm_lead.default', 'crm_lead.pipeline']);
        for (const v of served) expect(v.viewKind).toBe('list');
    });

    it('…and what it serves is the STORED container, not a default', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: leadContainer });
        const list: any = await protocol.getMetaItems({ type: 'view' });
        const byName = Object.fromEntries(list.items.map((v: any) => [v.name, v]));

        // The authored payload survives expansion — label and columns are the
        // ones this test wrote, so the served view cannot be a stand-in.
        expect(byName['crm_lead.pipeline'].label).toBe('Lead Pipeline');
        expect(byName['crm_lead.pipeline'].config.columns).toEqual([{ field: 'name' }]);
        expect(byName['crm_lead.default'].label).toBe('All Leads');
        expect(byName['crm_lead.default'].config.columns).toEqual([{ field: 'name' }, { field: 'company' }]);
    });

    it('still never surfaces the aggregated container itself (ADR-0017 canonical shape)', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: leadContainer });
        const list: any = await protocol.getMetaItems({ type: 'view' });

        // The bare `<object>` key is a back-compat single-item read, never an
        // enumeration entry — loosening that filter was the tempting fix and is
        // not the one taken.
        expect(list.items.some((v: any) => v?.name === 'crm_lead')).toBe(false);
        const byName: any = await protocol.getMetaItem({ type: 'view', name: 'crm_lead' });
        expect(byName.item).toBeTruthy();
        expect(byName.item.listViews).toBeDefined();
    });

    /**
     * ANTI-VACUITY. The suite above would pass just as well against a change
     * that served "whatever exists" for every object. These two cases prove the
     * fixtures actually distinguish an authored container from no container.
     */
    describe('anti-vacuity — absence still reads as absence', () => {
        it('an object with NO view container serves nothing for that object', async () => {
            const { engine } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            // A container authored for crm_lead must not make crm_account —
            // an object nobody authored a view for — start answering non-empty.
            await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: leadContainer });

            const list: any = await protocol.getMetaItems({ type: 'view' });
            expect(switcherMatches(list.items, 'crm_account')).toEqual([]);
            expect(switcherMatches(list.items, 'crm_lead')).toHaveLength(2);
        });

        it('with no view written at all, the view read is empty', async () => {
            const { engine } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            const list: any = await protocol.getMetaItems({ type: 'view' });
            expect(list.items).toEqual([]);
            expect(switcherMatches(list.items, 'crm_lead')).toEqual([]);
        });
    });

    /**
     * The path must not have become "expand anything". A view that is already an
     * independent ViewItem, and a non-view type, go through the same hydration
     * choke point and must come back byte-identical to their pre-fix behaviour.
     */
    describe('the untouched arms', () => {
        it('an already-independent ViewItem is served exactly once, unchanged', async () => {
            const { engine } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            const record = {
                name: 'crm_lead.mine', object: 'crm_lead', viewKind: 'list', label: 'My Leads',
                config: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: [{ field: 'name' }] },
            };
            await protocol.saveMetaItem({ type: 'view', name: 'crm_lead.mine', item: record });

            const list: any = await protocol.getMetaItems({ type: 'view' });
            const served = switcherMatches(list.items, 'crm_lead');
            expect(served).toHaveLength(1);
            expect(served[0].name).toBe('crm_lead.mine');
            expect(served[0].config).toEqual(record.config);
        });

        it('a non-view type stores and serves a byte-identical body', async () => {
            const { engine, rows } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            const authored = { name: 'crm_invoice', label: 'Invoice', fields: { amount: { type: 'currency', label: 'Amount' } } };
            await protocol.saveMetaItem({ type: 'object', name: 'crm_invoice', item: authored });

            const stored = Array.from(rows.values()).find((r) => r.name === 'crm_invoice')!;
            expect(JSON.parse(stored.metadata)).toEqual(authored);
        });

        it('a view container stores a byte-identical body — expansion is derived, never persisted', async () => {
            const { engine, rows } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: leadContainer });

            // Exactly ONE row: the container as authored (plus the `name` the
            // write door has always stamped). No expanded rows are persisted, so
            // there is nothing to go stale when the container is next edited.
            const viewRows = Array.from(rows.values()).filter((r) => r.type === 'view');
            expect(viewRows).toHaveLength(1);
            expect(JSON.parse(viewRows[0].metadata)).toEqual({ ...leadContainer, name: 'crm_lead' });
        });
    });
});
