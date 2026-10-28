// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the fake engine below
// cannot accept a call ObjectQL refuses (`check:engine-double-contract`).
// Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * [#26708, ADR-0070 D1] The named-base rule holds for EVERY type the `/meta`
 * save door writes, not only `flow`: a save naming, as its base, a package id
 * no installed package has is refused `WRITABLE_PACKAGE_REQUIRED` / 422 —
 * draft and active alike — before anything is written or registered.
 *
 * Measured through the wire before the fix (stock showcase, signed in as the
 * seeded admin): `PUT /api/v1/meta/object/ghost_two?mode=draft&package=…nosuch`
 * answered 200 `state=draft`, the same save with no `mode` answered 200
 * `state=active`, and dashboard and page bodies did the same. With no manifest
 * there is no namespace, so the object prefix rule (ADR-0129 D2) was skipped
 * too, and `publish-drafts` on that id served the draft live.
 *
 * One rule, ⛔ no second copy: the flow arm (`tenantAuthoredWriteRefusal`,
 * #20863) and this door ask the same helper, so the flow's sentence is the
 * other types' sentence with the type substituted. The controls: an installed
 * package, the `sys_metadata` sentinel and a save naming no package still save;
 * the two server-stated rewrites (`migrate-stored`, `package-duplicate`) are
 * not authoring writes and are not asked.
 */

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/** Does row `r` satisfy `where` (top-level eq + `$or`)? */
function matchesMetadataWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            if (!(v as Array<Record<string, unknown>>).some((c) => matchesMetadataWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            const op = v as Record<string, unknown>;
            if ('$in' in op) {
                if (!(op.$in as unknown[]).includes((r as any)[k])) return false;
                continue;
            }
            if ('$ne' in op) {
                if ((r as any)[k] === op.$ne) return false;
                continue;
            }
        }
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

/** An installed writable base that declares no namespace. */
const INSTALLED = 'com.tenant.base';
/** A package id no installed package has. */
const PHANTOM = 'com.example.nosuch';

function makeStubEngine() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) if (matchesMetadataWhere(r, w)) return { key: k, row: r };
        return null;
    };
    const registerItem = vi.fn();
    const insert = vi.fn(async (table: string, data: Record<string, unknown>) => {
        nextId += 1;
        if (table !== 'sys_metadata') return { id: `x_${nextId}` };
        const row = { id: `r_${nextId}`, ...(data as any) } as Row;
        rows.set(keyOf(data), row);
        return { id: row.id };
    });
    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = Array.from(rows.values()).filter((r) => matchesMetadataWhere(r, opts.where ?? {}));
            // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
        },
        insert,
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            if (table !== 'sys_metadata') return { deleted: 0 };
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        registry: {
            registerItem,
            registerObject: () => {},
            getPackage: (id: string) => (id === INSTALLED ? { manifest: { id: INSTALLED } } : undefined),
        },
    };
    return { engine, rows, insert, registerItem };
}

/** One body per type the card measured, each one the per-type parse accepts. */
const BODIES: Record<string, (name: string) => Record<string, unknown>> = {
    object: (name) => ({
        name,
        label: `Object ${name}`,
        // [#8308] Authored OWD — the authoring gate refuses an OWD-less custom object.
        sharingModel: 'private',
        fields: { title: { type: 'text', label: 'Title' } },
    }),
    dashboard: (name) => ({ name, label: `Dashboard ${name}`, widgets: [] }),
    page: (name) => ({ name, label: `Page ${name}`, type: 'app', regions: [] }),
};

const rowsFor = (rows: Map<string, Row>, type: string, name: string) =>
    Array.from(rows.values())
        .filter((r) => r.type === type && r.name === name)
        .map((r) => ({ state: r.state, package_id: r.package_id }));

const save = (protocol: ObjectStackProtocolImplementation, request: Record<string, unknown>) =>
    protocol.saveMetaItem(request as never).then(() => 'saved' as const, (e: unknown) => e as any);

describe('[#26708] a save naming a package no installed package has is refused, for every type', () => {
    for (const type of Object.keys(BODIES)) {
        for (const mode of ['draft', undefined] as const) {
            it(`${type}, ${mode ?? 'active'}: WRITABLE_PACKAGE_REQUIRED / 422 naming the id, nothing written or registered`, async () => {
                const { engine, rows, insert, registerItem } = makeStubEngine();
                const protocol = new ObjectStackProtocolImplementation(engine);

                const thrown = await save(protocol, {
                    type, name: 'ghost_two', item: BODIES[type]('ghost_two'), packageId: PHANTOM,
                    ...(mode ? { mode } : {}),
                });

                expect({ code: thrown?.code, status: thrown?.status }).toEqual({ code: 'WRITABLE_PACKAGE_REQUIRED', status: 422 });
                expect(thrown.packageId).toBe(PHANTOM);
                expect(thrown.message).toMatch(new RegExp(
                    `^Cannot save ${type} 'ghost_two' into package '${PHANTOM.replace(/\./g, '\\.')}': no package with that id is installed`,
                ));
                expect(rowsFor(rows, type, 'ghost_two')).toEqual([]);
                expect(insert).not.toHaveBeenCalled();
                expect(registerItem).not.toHaveBeenCalled();
            });
        }
    }

    it('the flow arm answers the same rule with the same envelope and its own sentence, byte for byte', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const refusal: any = await protocol.tenantAuthoredWriteRefusal({
            type: 'flow', name: 'orphan_flow', item: { name: 'orphan_flow' }, packageId: PHANTOM,
        });
        expect({ code: refusal?.code, status: refusal?.status, packageId: refusal?.packageId })
            .toEqual({ code: 'WRITABLE_PACKAGE_REQUIRED', status: 422, packageId: PHANTOM });
        expect(refusal.message).toBe(
            `Cannot save flow 'orphan_flow' into package '${PHANTOM}': no package with that id is `
            + `installed in this deployment, so the flow would be stored bound to a package that does not `
            + `exist. Name an installed writable package as the flow's base (or create one first), or save `
            + `the flow without naming a package. Nothing was written.`,
        );
    });

    it('a plural type spelling cannot address around it', async () => {
        const { engine, insert } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const thrown = await save(protocol, {
            type: 'objects', name: 'ghost_two', item: BODIES.object('ghost_two'), packageId: PHANTOM,
        });
        expect({ code: thrown?.code, status: thrown?.status }).toEqual({ code: 'WRITABLE_PACKAGE_REQUIRED', status: 422 });
        expect(insert).not.toHaveBeenCalled();
    });
});

describe('[#26708] controls — the saves the rule does not judge are unchanged', () => {
    for (const type of Object.keys(BODIES)) {
        it(`${type}: a save into an installed package still stores the row bound to it, draft and active`, async () => {
            const { engine, rows } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            expect(await save(protocol, { type, name: 'real_one', item: BODIES[type]('real_one'), packageId: INSTALLED, mode: 'draft' })).toBe('saved');
            expect(await save(protocol, { type, name: 'real_two', item: BODIES[type]('real_two'), packageId: INSTALLED })).toBe('saved');

            expect(rowsFor(rows, type, 'real_one')).toEqual([{ state: 'draft', package_id: INSTALLED }]);
            expect(rowsFor(rows, type, 'real_two')).toEqual([{ state: 'active', package_id: INSTALLED }]);
        });
    }

    it('a save naming the sys_metadata sentinel, or no package at all, still stores its row as before', async () => {
        for (const packageId of ['sys_metadata', null, undefined]) {
            const { engine, rows } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);
            expect(await save(protocol, { type: 'object', name: 'plain_obj', item: BODIES.object('plain_obj'), packageId }), String(packageId)).toBe('saved');
            expect(rowsFor(rows, 'object', 'plain_obj'), String(packageId))
                .toEqual([{ state: 'active', package_id: packageId === 'sys_metadata' ? 'sys_metadata' : null }]);
        }
    });

    it('the two server-stated rewrites of stored rows are not asked — only an authoring save is', async () => {
        for (const request of [{ source: 'migrate-stored' }, { writeFace: 'package-duplicate' }]) {
            const { engine } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);
            const outcome = await save(protocol, {
                type: 'object', name: 'stored_obj', item: BODIES.object('stored_obj'), packageId: PHANTOM, ...request,
            });
            expect(outcome, JSON.stringify(request)).toBe('saved');
        }
    });
});
