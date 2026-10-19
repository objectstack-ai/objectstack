// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#10757 leg 6] The served by-name read (`getMetaItem`) takes the item's
// active rows through the overlay cache (#11967), so the REST API-exposure
// gate — which reads the object by name on every `/data` request — stops
// paying one `sys_metadata` round trip per request on a warm engine.
//
// Every hit assertion is paired with a staleness assertion on the same engine
// (the convention `meta-overlay-cache.test.ts` states: either half alone passes
// on a degenerate cache), and the AUTHORING read is pinned to keep reading the
// store, because the protocol's own save checks call it.
//
// Test-path resolution: both subjects are imported by relative specifier, so
// vitest resolves them from this package's source; nothing ablated here
// crosses a package boundary.

import { describe, it, expect } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { metaOverlayCacheEntryCount } from './meta-overlay-cache.js';

type Row = Record<string, unknown>;

const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`store double: unsupported combinator ${k}`);
    if (v !== null && typeof v === 'object') {
        const set = (v as { $in?: unknown }).$in;
        if (!Array.isArray(set)) throw new Error(`store double: unsupported operator in ${JSON.stringify(v)}`);
        return set.includes(row[k] ?? null);
    }
    return v === undefined || (row[k] ?? null) === (v ?? null);
});

/** A minimal `{ current, bump, subscribe }` seam — the shape the engine ships. */
function makeEpochSeam() {
    let epoch = 0;
    return {
        get current() {
            return epoch;
        },
        bump(): number {
            epoch += 1;
            return epoch;
        },
        subscribe(): () => void {
            return () => {};
        },
    };
}

const storedObject = (enable: Row): Row => ({
    id: 'r_widget', type: 'object', name: 'widget', state: 'active', package_id: null,
    metadata: JSON.stringify({ name: 'widget', label: 'Widget', fields: {}, enable }),
});

function harness(rows: Row[], opts: { epoch?: boolean } = {}) {
    const reads: Row[] = [];
    const seam = makeEpochSeam();
    const engine: Record<string, unknown> = {
        // A registry holding nothing: the code layer answers no item.
        registry: {
            getItem: () => undefined,
            getObject: () => undefined,
            listItems: () => [],
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
            registerItem: () => undefined,
            registerObject: () => undefined,
            applyNavContributions: (app: unknown) => app,
        },
        find: async (table: string, q: { where?: Row; limit?: number } = {}) => {
            if (table !== 'sys_metadata') return [];
            reads.push(structuredClone(q.where ?? {}));
            const hits = rows.filter((r) => matches(r, q.where));
            return typeof q.limit === 'number' ? hits.slice(0, q.limit) : hits;
        },
        findOne: async (table: string, q: { where?: Row } = {}) => {
            assertEngineFindOnePredicate(table, q as never);
            if (table !== 'sys_metadata') return null;
            reads.push(structuredClone(q.where ?? {}));
            return rows.find((r) => matches(r, q.where)) ?? null;
        },
    };
    if (opts.epoch !== false) engine.writeEpoch = seam;
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map()) as any;
    /** A write as the engine makes one: the epoch moves ahead of the row. */
    const write = (apply: () => void) => {
        seam.bump();
        apply();
    };
    return { protocol, engine, reads, write };
}

const byNameReads = (reads: Row[]) =>
    reads.filter((w) => w.name === 'widget' && JSON.stringify(w.type) === JSON.stringify({ $in: ['object', 'objects'] }));

describe('[#10757 leg 6] the served by-name read goes through the overlay cache', () => {
    it('⭐ a repeat reads ZERO active rows from the store and serves an equal answer', async () => {
        const h = harness([storedObject({ apiMethods: ['get'] })]);
        const first = await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
        expect(byNameReads(h.reads)).toHaveLength(1);
        const second = await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
        expect(byNameReads(h.reads)).toHaveLength(1);
        expect(second).toEqual(first);
        expect(first.item.enable).toEqual({ apiMethods: ['get'] });
    });

    it('a write retires it: the next served read reads the store and serves the new row', async () => {
        const rows = [storedObject({ apiMethods: ['get'] })];
        const h = harness(rows);
        await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
        await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
        expect(byNameReads(h.reads)).toHaveLength(1);
        h.write(() => {
            rows[0] = storedObject({ apiMethods: ['get', 'list'] });
        });
        const after = await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
        expect(after.item.enable).toEqual({ apiMethods: ['get', 'list'] });
        expect(byNameReads(h.reads)).toHaveLength(2);
    });

    it('a code object with NO stored row caches the empty row set too', async () => {
        const h = harness([]);
        await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
        await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
        expect(byNameReads(h.reads)).toHaveLength(1);
        // ...and a newly published row appears promptly: the epoch, never the timer.
        const rows: Row[] = [];
        const g = harness(rows);
        expect((await g.protocol.getMetaItem({ type: 'object', name: 'widget' })).item).toBeUndefined();
        g.write(() => rows.push(storedObject({ apiMethods: ['get'] })));
        expect((await g.protocol.getMetaItem({ type: 'object', name: 'widget' })).item?.enable)
            .toEqual({ apiMethods: ['get'] });
    });

    it('two items, and the by-name and list reads, never share an entry', async () => {
        const rows = [storedObject({ apiMethods: ['get'] }), { ...storedObject({}), id: 'r_gadget', name: 'gadget',
            metadata: JSON.stringify({ name: 'gadget', label: 'Gadget', fields: {} }) }];
        const h = harness(rows);
        expect((await h.protocol.getMetaItem({ type: 'object', name: 'widget' })).item.name).toBe('widget');
        expect((await h.protocol.getMetaItem({ type: 'object', name: 'gadget' })).item.name).toBe('gadget');
        expect(metaOverlayCacheEntryCount(h.engine)).toBe(2);
    });

    it('⛔ the AUTHORING read keeps reading the store on every call', async () => {
        // The private body the protocol's own save checks call (the
        // destructive-change gate before an object save among them).
        const h = harness([storedObject({ apiMethods: ['get'] })]);
        await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
        await h.protocol.readMetaItem({ type: 'object', name: 'widget' });
        await h.protocol.readMetaItem({ type: 'object', name: 'widget' });
        expect(byNameReads(h.reads)).toHaveLength(3);
    });

    it('an engine with no write-epoch seam reads per call, exactly as before', async () => {
        const h = harness([storedObject({ apiMethods: ['get'] })], { epoch: false });
        await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
        await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
        expect(byNameReads(h.reads)).toHaveLength(2);
        expect(metaOverlayCacheEntryCount(h.engine)).toBe(0);
    });

    it('TTL 0 is a real path: the served read reads per call', async () => {
        const saved = process.env.OS_METADATA_OVERLAY_CACHE_TTL_MS;
        process.env.OS_METADATA_OVERLAY_CACHE_TTL_MS = '0';
        try {
            const h = harness([storedObject({ apiMethods: ['get'] })]);
            await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
            await h.protocol.getMetaItem({ type: 'object', name: 'widget' });
            expect(byNameReads(h.reads)).toHaveLength(2);
        } finally {
            if (saved === undefined) delete process.env.OS_METADATA_OVERLAY_CACHE_TTL_MS;
            else process.env.OS_METADATA_OVERLAY_CACHE_TTL_MS = saved;
        }
    });
});
