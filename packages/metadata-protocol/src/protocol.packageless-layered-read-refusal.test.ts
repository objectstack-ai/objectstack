// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28337, ADR-0048] `packagelessLayeredReadRefusal`: the layered view's door
 * refusal for a name two or more packages hold, asked with no package. It is
 * the refusal the package-less save and delete answer for the same rows
 * (`packagelessAddressAmbiguityRefusal`, `409 RESOURCE_CONFLICT`, the holders
 * sorted and the `?package=` prescription), over the same resolution
 * (`packagelessAddress` at `active`).
 *
 * The layered read itself is unchanged: its in-process resolution readers
 * (the security catalog echo, the packaged-permission-set lock gate,
 * `/published`) read a name's layers with no package and keep the answer they
 * had. The door asks the judge (`createMetaLayeredAnswer` in `@objectstack/rest`).
 */

import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const PKG_A = 'app.alpha_demo';
const PKG_B = 'app.beta_demo';

type Row = Record<string, any>;

const rowKey = (w: Row) =>
    [w.type, w.name, w.organization_id ?? '', w.package_id ?? '', w.state ?? 'active'].join('|');

const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

const matchesWhere = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null) return row[k] === null || row[k] === undefined;
        return whereValueMatches(row[k], v);
    });

/** An in-memory `sys_metadata` behind the REAL protocol, with no registry items. */
function makeProtocol() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Row) => {
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };
    const registry: any = {
        getItem: () => undefined,
        getArtifactItem: () => undefined,
        listItems: () => [],
        getObject: () => undefined,
        isPackageDisabled: () => false,
        isObjectPackageDisabled: () => false,
        getAllPackages: () => [{ manifest: { id: PKG_A } }, { manifest: { id: PKG_B } }],
        getPackage: (id: string) => ({ manifest: { id } }),
    };
    const engine: any = {
        registry,
        async findOne(table: string, o: { where: Row }) {
            assertEngineFindOnePredicate(table, o);
            if (table !== 'sys_metadata') return null;
            return findRow(o.where)?.row ?? null;
        },
        async find(table: string, o: { where: Row; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = Array.from(rows.values()).filter((r) => matchesWhere(r, o.where));
            return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
        },
        async insert(table: string, data: Row) {
            if (table !== 'sys_metadata') return { id: `rec_${++nextId}` };
            const row = { id: `r_${++nextId}`, ...data };
            rows.set(rowKey(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Row, o: { where: Row }) {
            assertEngineUpdateDispatch(data, o);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(o.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...data };
            rows.delete(found.key);
            rows.set(rowKey(merged), merged);
            return { id: merged.id };
        },
        async delete(table: string, o?: Row) {
            assertEngineDeleteDispatch(o);
            if (table !== 'sys_metadata') return { deleted: 0 };
            const found = findRow((o?.where ?? {}) as Row);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async syncObjectSchema() { /* no physical storage in this double */ },
    };
    return new ObjectStackProtocolImplementation(engine, undefined, 'env_test');
}

/** Store one dashboard row per package named (`null`: the package-unbound row). */
async function store(protocol: ObjectStackProtocolImplementation, name: string, packages: Array<string | null>) {
    for (const pkg of packages) {
        await protocol.saveMetaItem({
            type: 'dashboard', name, item: { name, label: `${pkg ?? 'local'} copy`, widgets: [] },
            ...(pkg ? { packageId: pkg } : {}),
        } as any);
    }
}

/** What a rejected promise threw. */
const thrown = async (p: Promise<unknown>): Promise<any> => {
    try {
        await p;
    } catch (e) {
        return e;
    }
    throw new Error('expected a refusal; the call resolved');
};

describe('[#28337] packagelessLayeredReadRefusal', () => {
    it('a name two packages hold: the package-less save\'s refusal, worded for the layered read', async () => {
        const protocol = makeProtocol();
        await store(protocol, 'twin_dash', [PKG_B, PKG_A]);
        const refusal = await protocol.packagelessLayeredReadRefusal({ type: 'dashboard', name: 'twin_dash' });
        const saveRefusal = await thrown(protocol.saveMetaItem({
            type: 'dashboard', name: 'twin_dash', item: { name: 'twin_dash', label: 'edited', widgets: [] },
        } as any));
        expect(refusal).toBeInstanceOf(Error);
        expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: saveRefusal.code, status: saveRefusal.status });
        expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'RESOURCE_CONFLICT', status: 409 });
        expect(refusal!.message).toBe(
            'Name the package this layered read is for, then send it again: on the REST door add ?package= with the '
            + 'package id, in process pass packageId. Nothing was served. dashboard \'twin_dash\' belongs to 2 packages '
            + `('${PKG_A}', '${PKG_B}'), and a layered read that names none has no single row to show.`,
        );
        // The holder list is the save's, sorted.
        expect(saveRefusal.message).toContain(`('${PKG_A}', '${PKG_B}')`);
        // The plural URL spelling is the same item.
        expect((await protocol.packagelessLayeredReadRefusal({ type: 'dashboards', name: 'twin_dash' }))?.message)
            .toBe(refusal!.message);
    });

    it('no refusal where the package-less writes take an address: one package, the package-unbound row beside it, or none', async () => {
        const protocol = makeProtocol();
        await store(protocol, 'solo_dash', [PKG_A]);
        await store(protocol, 'local_beside', [PKG_A, null]);
        await store(protocol, 'local_dash', [null]);
        for (const name of ['solo_dash', 'local_beside', 'local_dash', 'no_such_dash']) {
            expect(await protocol.packagelessLayeredReadRefusal({ type: 'dashboard', name }), name).toBeUndefined();
        }
    });

    it('the layered read itself still serves its in-process readers a name two packages hold', async () => {
        const protocol = makeProtocol();
        await store(protocol, 'twin_dash', [PKG_A, PKG_B]);
        const layered = await protocol.getMetaItemLayered({ type: 'dashboard', name: 'twin_dash' });
        expect(layered.overlay).toMatchObject({ name: 'twin_dash' });
        for (const pkg of [PKG_A, PKG_B]) {
            const scoped = await protocol.getMetaItemLayered({ type: 'dashboard', name: 'twin_dash', packageId: pkg });
            expect(scoped.overlay).toMatchObject({ name: 'twin_dash', label: `${pkg} copy` });
        }
    });
});
