// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the fake engine below
// cannot accept a call ObjectQL refuses (`check:engine-double-contract`).
// Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * [#26921, #26708, ADR-0070 D1] The named-base rule reaches the two doors
 * that still extended or published a row ALREADY bound to a package this
 * deployment has not installed (stored before the save door refused such a
 * binding):
 *
 *  - the per-item publish, named (`?package=ID`) or not: promoting the draft
 *    served it live, bound to a package that does not exist;
 *  - a save naming NO package, draft or active, whose address the item's
 *    stored rows give (#11087 / ADR-0048): it kept the phantom binding.
 *
 * Measured through the wire before the fix (showcase, a database written
 * before the save door refused the binding, signed in as the seeded admin):
 * `PUT /api/v1/meta/dashboard/NAME` naming no package answered 200 with
 * `package=com.example.nosuch` in its receipt, and
 * `POST /api/v1/meta/dashboard/NAME/publish?package=com.example.nosuch`
 * answered 200 and served the draft.
 *
 * One rule, ⛔ no second copy: both doors ask `uninstalledNamedBaseRefusal`,
 * the helper the save door and the flow arm ask, so the envelope is the same
 * (`WRITABLE_PACKAGE_REQUIRED` / 422 / `packageId`). The rows stay as they
 * are: nothing is migrated or deleted, and the refusal names the way out.
 *
 * The rows are written the way they were in production: saved while the
 * package was installed, then the package is gone from the registry (an
 * install that never existed in this deployment reads the same).
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
/** The package the stored rows are bound to, installed only while they are written. */
const PHANTOM = 'com.example.nosuch';

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const installed = new Set<string>([INSTALLED, PHANTOM]);
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
            getPackage: (id: string) => (installed.has(id) ? { manifest: { id } } : undefined),
        },
    };
    /** The phantom package leaves the registry; its rows stay stored. */
    const forgetPhantom = () => {
        installed.delete(PHANTOM);
        insert.mockClear();
        registerItem.mockClear();
    };
    return { engine, rows, insert, registerItem, forgetPhantom };
}

/** One body per type, each one the per-type parse accepts. */
const BODIES: Record<string, (name: string, label?: string) => Record<string, unknown>> = {
    dashboard: (name, label = `Dashboard ${name}`) => ({ name, label, widgets: [] }),
    page: (name, label = `Page ${name}`) => ({ name, label, type: 'app', regions: [] }),
};

const rowsFor = (rows: Map<string, Row>, type: string, name: string) =>
    Array.from(rows.values())
        .filter((r) => r.type === type && r.name === name)
        .map((r) => ({ state: r.state, package_id: r.package_id, label: JSON.parse(r.metadata).label }))
        .sort((a, b) => a.state.localeCompare(b.state));

const save = (protocol: ObjectStackProtocolImplementation, request: Record<string, unknown>) =>
    protocol.saveMetaItem(request as never).then(() => 'saved' as const, (e: unknown) => e as any);

const publish = (protocol: ObjectStackProtocolImplementation, request: Record<string, unknown>) =>
    protocol.publishMetaItem(request as never).then(() => 'published' as const, (e: unknown) => e as any);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function expectRefused(thrown: any, firstSentence: string) {
    expect({ code: thrown?.code, status: thrown?.status, packageId: thrown?.packageId })
        .toEqual({ code: 'WRITABLE_PACKAGE_REQUIRED', status: 422, packageId: PHANTOM });
    expect(thrown.message).toMatch(new RegExp(`^${escape(firstSentence)}`));
}

describe('[#26921] the per-item publish refuses a draft bound to a package that is not installed', () => {
    for (const type of Object.keys(BODIES)) {
        it(`${type}: named (?package=ID) — refused naming the id, the draft stays a draft, nothing goes live`, async () => {
            const { engine, rows, registerItem, forgetPhantom } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);
            expect(await save(protocol, { type, name: 'ghost', item: BODIES[type]('ghost', 'Draft'), packageId: PHANTOM, mode: 'draft' })).toBe('saved');
            forgetPhantom();

            const thrown = await publish(protocol, { type, name: 'ghost', packageId: PHANTOM });

            expectRefused(thrown, `Cannot publish ${type} 'ghost' into package '${PHANTOM}': no package with that id is installed`);
            expect(rowsFor(rows, type, 'ghost')).toEqual([{ state: 'draft', package_id: PHANTOM, label: 'Draft' }]);
            expect(registerItem).not.toHaveBeenCalled();
        });
    }

    it('naming no package, over a draft bound to the id (the draft the address gives) — refused the same way', async () => {
        const { engine, rows, registerItem, forgetPhantom } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        expect(await save(protocol, { type: 'dashboard', name: 'ghost', item: BODIES.dashboard('ghost', 'Draft'), packageId: PHANTOM, mode: 'draft' })).toBe('saved');
        forgetPhantom();

        const thrown = await publish(protocol, { type: 'dashboard', name: 'ghost' });

        expectRefused(thrown, `Cannot publish dashboard 'ghost' into package '${PHANTOM}': no package with that id is installed`);
        expect(rowsFor(rows, 'dashboard', 'ghost')).toEqual([{ state: 'draft', package_id: PHANTOM, label: 'Draft' }]);
        expect(registerItem).not.toHaveBeenCalled();
    });

    it('naming no package, over an active row bound to the id — the promotion would land in it, so it is refused', async () => {
        const { engine, rows, forgetPhantom } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        expect(await save(protocol, { type: 'dashboard', name: 'ghost', item: BODIES.dashboard('ghost', 'Live'), packageId: PHANTOM })).toBe('saved');
        expect(await save(protocol, { type: 'dashboard', name: 'ghost', item: BODIES.dashboard('ghost', 'Draft'), packageId: PHANTOM, mode: 'draft' })).toBe('saved');
        forgetPhantom();

        const thrown = await publish(protocol, { type: 'dashboard', name: 'ghost' });

        expectRefused(thrown, `Cannot publish dashboard 'ghost' into package '${PHANTOM}': no package with that id is installed`);
        expect(rowsFor(rows, 'dashboard', 'ghost')).toEqual([
            { state: 'active', package_id: PHANTOM, label: 'Live' },
            { state: 'draft', package_id: PHANTOM, label: 'Draft' },
        ]);
    });

    it('the refusal names the way out: create the package, or remove the rows bound to it and save again', async () => {
        const { engine, forgetPhantom } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        expect(await save(protocol, { type: 'dashboard', name: 'ghost', item: BODIES.dashboard('ghost'), packageId: PHANTOM, mode: 'draft' })).toBe('saved');
        forgetPhantom();
        const thrown = await publish(protocol, { type: 'dashboard', name: 'ghost', packageId: PHANTOM });
        expect(thrown.message).toMatch(/Create a package with that id first, or remove/);
        expect(thrown.message).toMatch(/discard its drafts there/);
        expect(thrown.message).toMatch(/Nothing was published\.$/);
    });
});

describe('[#26921] a save naming no package does not extend a binding to a package that is not installed', () => {
    for (const type of Object.keys(BODIES)) {
        for (const mode of ['draft', undefined] as const) {
            it(`${type}, ${mode ?? 'active'}: over an active row bound to the id — refused naming it, nothing written`, async () => {
                const { engine, rows, insert, registerItem, forgetPhantom } = makeStubEngine();
                const protocol = new ObjectStackProtocolImplementation(engine);
                expect(await save(protocol, { type, name: 'ghost', item: BODIES[type]('ghost', 'Live'), packageId: PHANTOM })).toBe('saved');
                forgetPhantom();

                const thrown = await save(protocol, {
                    type, name: 'ghost', item: BODIES[type]('ghost', 'Edited'), ...(mode ? { mode } : {}),
                });

                expectRefused(thrown, `Cannot save ${type} 'ghost' without naming a package: its stored rows are bound to package '${PHANTOM}', and no package with that id is installed`);
                expect(rowsFor(rows, type, 'ghost')).toEqual([{ state: 'active', package_id: PHANTOM, label: 'Live' }]);
                expect(insert).not.toHaveBeenCalled();
                expect(registerItem).not.toHaveBeenCalled();
            });
        }
    }

    it('a draft save over a lone draft bound to the id (no active row) — refused, the draft is unchanged', async () => {
        const { engine, rows, forgetPhantom } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        expect(await save(protocol, { type: 'dashboard', name: 'ghost', item: BODIES.dashboard('ghost', 'Draft'), packageId: PHANTOM, mode: 'draft' })).toBe('saved');
        forgetPhantom();

        const thrown = await save(protocol, { type: 'dashboard', name: 'ghost', item: BODIES.dashboard('ghost', 'Edited'), mode: 'draft' });

        expectRefused(thrown, `Cannot save dashboard 'ghost' without naming a package: its stored rows are bound to package '${PHANTOM}'`);
        expect(rowsFor(rows, 'dashboard', 'ghost')).toEqual([{ state: 'draft', package_id: PHANTOM, label: 'Draft' }]);
    });

    it('the refusal names the way out and that nothing was written', async () => {
        const { engine, forgetPhantom } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        expect(await save(protocol, { type: 'dashboard', name: 'ghost', item: BODIES.dashboard('ghost'), packageId: PHANTOM })).toBe('saved');
        forgetPhantom();
        const thrown = await save(protocol, { type: 'dashboard', name: 'ghost', item: BODIES.dashboard('ghost') });
        expect(thrown.message).toMatch(/Create a package with that id first, or remove/);
        expect(thrown.message).toMatch(/Nothing was written\.$/);
    });
});

describe('[#26921] controls — doors over rows the rule does not judge are unchanged', () => {
    it('a save naming no package over a row bound to an INSTALLED package still saves into it, draft and active', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        expect(await save(protocol, { type: 'dashboard', name: 'real', item: BODIES.dashboard('real', 'Live'), packageId: INSTALLED })).toBe('saved');

        expect(await save(protocol, { type: 'dashboard', name: 'real', item: BODIES.dashboard('real', 'Edited') })).toBe('saved');
        expect(await save(protocol, { type: 'dashboard', name: 'real', item: BODIES.dashboard('real', 'Draft'), mode: 'draft' })).toBe('saved');

        expect(rowsFor(rows, 'dashboard', 'real')).toEqual([
            { state: 'active', package_id: INSTALLED, label: 'Edited' },
            { state: 'draft', package_id: INSTALLED, label: 'Draft' },
        ]);
    });

    it('a save naming no package for an item with no binding still saves package-less, draft and active', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        expect(await save(protocol, { type: 'dashboard', name: 'plain', item: BODIES.dashboard('plain', 'Live') })).toBe('saved');
        expect(await save(protocol, { type: 'dashboard', name: 'plain', item: BODIES.dashboard('plain', 'Draft'), mode: 'draft' })).toBe('saved');
        expect(rowsFor(rows, 'dashboard', 'plain')).toEqual([
            { state: 'active', package_id: null, label: 'Live' },
            { state: 'draft', package_id: null, label: 'Draft' },
        ]);
    });

    it('the per-item publish of a draft bound to an INSTALLED package, named or not, still promotes it', async () => {
        for (const named of [true, false]) {
            const { engine, rows } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);
            expect(await save(protocol, { type: 'dashboard', name: 'real', item: BODIES.dashboard('real', 'Draft'), packageId: INSTALLED, mode: 'draft' })).toBe('saved');

            expect(await publish(protocol, { type: 'dashboard', name: 'real', ...(named ? { packageId: INSTALLED } : {}) }), String(named)).toBe('published');
            expect(rowsFor(rows, 'dashboard', 'real'), String(named)).toEqual([{ state: 'active', package_id: INSTALLED, label: 'Draft' }]);
        }
    });

    it('the per-item publish of a package-less draft still promotes it', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        expect(await save(protocol, { type: 'dashboard', name: 'plain', item: BODIES.dashboard('plain', 'Draft'), mode: 'draft' })).toBe('saved');
        expect(await publish(protocol, { type: 'dashboard', name: 'plain' })).toBe('published');
        expect(rowsFor(rows, 'dashboard', 'plain')).toEqual([{ state: 'active', package_id: null, label: 'Draft' }]);
    });

    it('the delete naming the id still removes a row bound to it (the way out the refusal names)', async () => {
        const { engine, rows, forgetPhantom } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        expect(await save(protocol, { type: 'dashboard', name: 'ghost', item: BODIES.dashboard('ghost'), packageId: PHANTOM })).toBe('saved');
        forgetPhantom();
        await protocol.deleteMetaItem({ type: 'dashboard', name: 'ghost', packageId: PHANTOM });
        expect(rowsFor(rows, 'dashboard', 'ghost')).toEqual([]);
    });
});
