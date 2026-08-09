// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
// [#4550 / #5480] The producer's OWN write-verb dispatch decisions, so the
// engine double below cannot accept a call `ObjectQL.delete` / `ObjectQL.update`
// refuses — a double looser than the implementation is no test at all.
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

/**
 * #7012 — tier 3 of the delete heal must not unregister an object whose owner
 * contributor is bound to a package this process has INSTALLED.
 *
 * ## The outage, measured end to end (#6853 dev report P3/P6)
 *
 * On a tenant kernel, with no escape hatch and no operator action, a stored
 * `sys_metadata` object row bound to a code package's id takes the object off
 * the whole data plane on the next `DELETE /meta/object/:name`:
 *
 * ```
 * loadMetaFromDb   -> {"loaded":1,"errors":0,"invalid":0}   boot warnings: []
 * after hydration  -> contributor provenance flips package -> org
 *                     isArtifactBacked -> false
 * DELETE /meta/object/:name
 *                  -> {"success":true,"reset":true}
 *                  -> objectContributors: []      getObject: null
 *                  -> data CRUD: OBJECT_NOT_FOUND / 404
 * ```
 *
 * The mechanism is a WRITE-time destruction, not a shadow.
 * `SchemaRegistry.registerObject` splices out the same-package `own`
 * contributor before pushing the new one, so hydrating an overlay row whose
 * `package_id` equals the packaged owner's id DESTROYS the packaged
 * definition — there is no second copy anywhere in the registry.
 * `loadMetaFromDb` replays that replacement on EVERY boot, silently.
 *
 * Tier 3's "AND IT NEVER RETIRES A CODE-SHIPPED OBJECT" guard then reads
 * `isArtifactBacked`, which for an `object` resolves to
 * `SchemaRegistry.getArtifactItem` -> `_provenance !== 'org'`. The hydration
 * stamps `_provenance: 'org'` server-side (deliberately, cloud#970), so the
 * guard is asking the ONE predicate the overwrite falsified, and it answers
 * "not shipped" for an object the package still ships.
 *
 * ## What this file pins
 *
 * The package BINDING survives the overwrite (`registerObject` replaces only
 * when the two package ids MATCH, so the surviving contributor provably carries
 * the packaged owner's id), and an installed-package record is a fact about the
 * process rather than about the destroyed body. So tier 3 decides on that pair
 * instead, in BOTH directions:
 *
 *   - a package-bound object whose package is installed SURVIVES the delete;
 *   - an object that genuinely should be retired still IS — both the
 *     package-less (`sys_metadata` sentinel) shape and the shape whose binding
 *     names a package this process never installed.
 *
 * ## The accepted cost (maintainer ruling 2026-08-09 on #6853, option C)
 *
 * A package-bound RUNTIME-authored object (Studio's package workspace, #4636)
 * is indistinguishable from a package-shipped one by binding alone, so some
 * genuinely deleted objects stay registered until restart — listable but
 * rowless. Per the heal's own REGISTER WIDE / RETIRE NARROW argument that is
 * the cheap direction: a surplus entry degrades to "listable but rowless",
 * a wrongly retired one 404s the whole data plane. The honest fix for the
 * distinguishability itself is #6853's direction B (the overlay registers as
 * its own contributor layer), which is a separate ADR-0029 card.
 */

const APP_PKG = 'app.myapp';
/** The key an overlay row bound to NO package keeps. */
const SENTINEL = 'sys_metadata';

/** The package's own body — carries a field the overlay does NOT. */
const packagedBody = (name: string) => ({
    name,
    label: 'Invoice',
    fields: {
        name: { name: 'name', type: 'text', label: 'Name' },
        amount: { name: 'amount', type: 'number', label: 'Amount' },
        packaged_only: { name: 'packaged_only', type: 'text', label: 'Packaged only' },
    },
});

/** The tenant's overlay body — carries a field the package does NOT. */
const overlayBody = (name: string) => ({
    name,
    label: 'Invoice (customized)',
    fields: {
        name: { name: 'name', type: 'text', label: 'Name' },
        overlay_only: { name: 'overlay_only', type: 'text', label: 'Overlay only' },
    },
});

/** ADR-0048: the overlay key includes `package_id`, so the double keys on it too. */
const rowKey = (w: Record<string, unknown>) =>
    [w.type, w.name, w.organization_id ?? '', w.package_id ?? '', w.state ?? 'active'].join('|');

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => {
        if (v === null) return row[k] === null || row[k] === undefined;
        return row[k] === v;
    });

/**
 * One kernel process: a fresh `SchemaRegistry` + protocol over an in-memory
 * `sys_metadata` / `sys_metadata_history` pair, plus a data-plane `insert` so
 * the CRUD assertions measure writes that genuinely dispatched.
 *
 * `seed` is how a RESTART is expressed — the rows a previous process persisted,
 * handed to a registry that knows nothing about them until `loadMetaFromDb`
 * runs. That two-session shape is what makes this probe need NO escape hatch:
 * session 1 writes the overlay before any package ships the name (so the
 * two-tier gate has nothing to refuse), session 2 boots the package first and
 * hydrates second, which is the real boot order.
 */
function makeSession(opts: { controlPlane?: boolean; seed?: any[] } = {}) {
    const environmentId: string | undefined = opts.controlPlane === true ? undefined : 'env_test';
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    const rows = new Map<string, any>();
    for (const r of opts.seed ?? []) rows.set(rowKey(r), { ...r });
    const historyRows: any[] = [];
    const dataRows: any[] = [];
    let nextId = 0;

    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const engine: any = {
        registry,
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') return historyRows.find((h) => matchesWhere(h, o.where)) ?? null;
            if (table !== 'sys_metadata') return null;
            return findRow(o.where)?.row ?? null;
        },
        async find(table: string, o: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') return historyRows.filter((h) => matchesWhere(h, o.where));
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values()).filter((r) => matchesWhere(r, o.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                const h = { id: `h_${++nextId}`, ...(data as any) };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') {
                const rec = { id: `rec_${++nextId}`, ...(data as any) };
                if (!table.startsWith('sys_')) dataRows.push({ object: table, ...rec });
                return rec;
            }
            const row = { id: `r_${++nextId}`, ...(data as any) };
            rows.set(rowKey(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(o.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(rowKey(merged), merged);
            return { id: merged.id };
        },
        async delete(table: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            if (table !== 'sys_metadata') return { deleted: 0 };
            const found = findRow(((o as any)?.where ?? {}) as Record<string, unknown>);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async syncObjectSchema() { /* no physical storage in this double */ },
    };

    const protocol = new ObjectStackProtocolImplementation(engine, undefined, environmentId);
    return { protocol, engine, registry, rows, dataRows };
}

/**
 * Session 1: persist the overlay row, on a kernel where nothing ships the name
 * yet. Returns the raw rows so a second session can boot on top of them.
 *
 * This is the precondition #6853 P6 names — "a row that already exists
 * (authored once under the hatch, seeded, imported, or predating the gates)" —
 * expressed the way the platform itself produces one, so the probe never has to
 * hand-forge a checksum.
 */
async function persistOverlayRow(name: string, packageId?: string): Promise<any[]> {
    const s = makeSession();
    await s.protocol.saveMetaItem({
        type: 'object',
        name,
        ...(packageId ? { packageId } : {}),
        item: overlayBody(name),
    });
    return Array.from(s.rows.values()).map((r) => ({ ...r }));
}

/** The installed-package record `registerApp` writes before it registers the objects. */
const installPackage = (registry: SchemaRegistry, id: string) =>
    registry.installPackage({ id, name: 'My App', version: '1.0.0' } as any);

const ownerPackageId = (registry: SchemaRegistry, name: string) =>
    registry.getObjectOwner(name)?.packageId;

const fieldNames = (registry: SchemaRegistry, name: string) =>
    Object.keys((registry.getObject(name) as any)?.fields ?? {});

const storedRows = (rows: Map<string, any>, name: string) =>
    Array.from(rows.values()).filter((r) => r.name === name);

describe('#7012 — tier 3 refuses to unregister an object bound to an installed package', () => {
    /**
     * The precondition every assertion below rests on, measured rather than
     * assumed: hydrating the overlay does not SHADOW the packaged contributor,
     * it DESTROYS it, and the two predicates then disagree — the binding still
     * names the package, `isArtifactBacked` says nothing is shipped.
     *
     * Green in both directions (it describes the pre-existing overwrite, which
     * this card does not change) — reported as a guard on the premise, not as
     * evidence for the fix.
     */
    it('the boot replay destroys the packaged definition while the package BINDING survives', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry } = makeSession({ seed });

        // Real boot order: the package registers its objects, then the DB hydrates.
        installPackage(registry, APP_PKG);
        registry.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);
        expect((registry.getObject('myapp_invoice') as any)._provenance).toBe('package');
        expect(fieldNames(registry, 'myapp_invoice')).toContain('packaged_only');
        expect(registry.getArtifactItem('object', 'myapp_invoice')).toBeDefined();

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let res: any;
        let warned: string[];
        try {
            res = await protocol.loadMetaFromDb();
        } finally {
            warned = warn.mock.calls.map((c) => String(c[0]));
            warn.mockRestore();
        }

        // Silently, with a clean receipt — nothing tells an operator the
        // packaged definition has just been replaced.
        expect(res).toMatchObject({ loaded: 1, errors: 0, invalid: 0 });
        expect(warned.filter((m) => m.includes('myapp_invoice'))).toEqual([]);

        // The definition is GONE (not shadowed): no copy of it survives.
        expect(fieldNames(registry, 'myapp_invoice')).not.toContain('packaged_only');
        expect(fieldNames(registry, 'myapp_invoice')).toContain('overlay_only');
        expect((registry.getObject('myapp_invoice') as any)._provenance).toBe('org');
        // …so the predicate tier 3 used to consult now answers "not shipped".
        expect(registry.getArtifactItem('object', 'myapp_invoice')).toBeUndefined();
        // …while the BINDING, which the replacement rule could not change (it
        // replaces only when the ids match), still names the package.
        expect(ownerPackageId(registry, 'myapp_invoice')).toBe(APP_PKG);
        expect(registry.getPackage(APP_PKG)).toBeDefined();
    });

    /**
     * THE OUTAGE, and the direction this card closes. Pre-fix every assertion
     * after the delete was the opposite: contributors emptied, `getObject`
     * null, and the data plane 404ing on a table that still holds the rows.
     *
     * Asserted by REFUSAL IDENTITY where a refusal is the subject — a bare
     * `toThrow` would pass for any unrelated throw, and the whole point here is
     * WHICH error the data plane answers.
     */
    it('a package-bound object SURVIVES the delete, and its data plane stays up', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry, rows, dataRows } = makeSession({ seed });
        installPackage(registry, APP_PKG);
        registry.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);
        await protocol.loadMetaFromDb();

        // The data plane works before the delete, so "works after" cannot be
        // green for the empty reason.
        const created = await protocol.createData({
            object: 'myapp_invoice', data: { name: 'INV-1' },
        });
        expect(created.id).toBeTruthy();
        expect(dataRows).toHaveLength(1);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let res: any;
        let warned: string[];
        try {
            res = await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });
        } finally {
            warned = warn.mock.calls.map((c) => String(c[0]));
            warn.mockRestore();
        }

        // The delete itself is unchanged: the tenant's overlay row really is gone.
        expect(res.success).toBe(true);
        expect(res.reset).toBe(true);
        expect(storedRows(rows, 'myapp_invoice')).toHaveLength(0);

        // THE LINES THAT WERE RED: the object stays registered, owned by the
        // package that ships it.
        expect(registry.getObject('myapp_invoice')).toBeDefined();
        expect(registry.getObjectContributors('myapp_invoice')).toHaveLength(1);
        expect(ownerPackageId(registry, 'myapp_invoice')).toBe(APP_PKG);

        // …and the consequence an operator actually feels: data CRUD still
        // dispatches. Pre-fix this threw OBJECT_NOT_FOUND / 404 while the table
        // still held row 1.
        const after = await protocol.createData({
            object: 'myapp_invoice', data: { name: 'INV-2' },
        });
        expect(after.id).toBeTruthy();
        expect(dataRows).toHaveLength(2);

        // The divergence between the store and the runtime is STATED, not
        // inferred later from a registry that disagrees with `sys_metadata` —
        // the same discipline the ADR-0029 extender refusal one line up carries.
        const refusals = warned.filter((m) => m.includes('stays registered'));
        expect(refusals).toHaveLength(1);
        expect(refusals[0]).toContain('myapp_invoice');
        expect(refusals[0]).toContain(APP_PKG);
    });

    /**
     * THE OTHER DIRECTION — the guard is a guard, not a blanket refusal. A
     * runtime-authored object with no package binding at all keeps the
     * `'sys_metadata'` sentinel, which names no installed package, so tier 3
     * retires it exactly as before and the data plane closes behind it.
     *
     * Green BEFORE and AFTER the change: it never depended on the new conjunct.
     * Reported as a guard against over-refusal, not as evidence for the fix.
     */
    it('a package-LESS runtime object is still retired, and its data plane closes', async () => {
        const seed = await persistOverlayRow('myapp_note');
        const { protocol, registry, dataRows } = makeSession({ seed });
        await protocol.loadMetaFromDb();

        expect(ownerPackageId(registry, 'myapp_note')).toBe(SENTINEL);
        expect(registry.getPackage(SENTINEL)).toBeUndefined();
        const created = await protocol.createData({ object: 'myapp_note', data: { name: 'N-1' } });
        expect(created.id).toBeTruthy();

        await protocol.deleteMetaItem({ type: 'object', name: 'myapp_note' });

        expect(registry.getObject('myapp_note')).toBeUndefined();
        expect(registry.getItem('object', 'myapp_note')).toBeUndefined();
        const err = await protocol
            .createData({ object: 'myapp_note', data: { name: 'N-2' } })
            .then(() => null, (e: any) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('OBJECT_NOT_FOUND');
        expect(err.status).toBe(404);
        expect(dataRows).toHaveLength(1);
    });

    /**
     * The BOUNDARY of the new predicate, and the reason it is "installed
     * package" and not "has a package id". A binding naming a package this
     * process never installed is a dangling reference — nothing ships that
     * name here, so nothing is protected by keeping the entry, and the walk's
     * tier-3 verdict ("no layer serves this name") stands.
     *
     * This is also the shape every pre-existing pin in
     * `protocol-delete-object-registry-heal.test.ts` uses, which is why they
     * stay green: those seed `packageId: 'app.myapp'` without ever installing
     * a package record for it.
     *
     * Green BEFORE and AFTER — a guard, not evidence.
     */
    it('a binding naming a package that is NOT installed is still retired', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry } = makeSession({ seed });
        await protocol.loadMetaFromDb();

        expect(ownerPackageId(registry, 'myapp_invoice')).toBe(APP_PKG);
        expect(registry.getPackage(APP_PKG)).toBeUndefined();

        await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });

        expect(registry.getObject('myapp_invoice')).toBeUndefined();
        expect(registry.getItem('object', 'myapp_invoice')).toBeUndefined();
    });

    /**
     * A DISABLED package still counts as installed. `disablePackage` flips
     * `enabled`/`status` on the record and touches no contributor — the objects
     * stay in `objectContributors` and the data plane keeps dispatching on
     * them — so reading the lifecycle flag here would unregister a definition
     * nothing else removes, which is the outage again through a second door.
     * The predicate is deliberately "is there an installed-package record",
     * never "is that package enabled".
     */
    it('a DISABLED installed package still protects its object', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry } = makeSession({ seed });
        installPackage(registry, APP_PKG);
        registry.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);
        await protocol.loadMetaFromDb();
        registry.disablePackage(APP_PKG);
        expect(registry.getPackage(APP_PKG)?.enabled).toBe(false);
        // The lifecycle flag removed nothing — the object is still served.
        expect(registry.getObject('myapp_invoice')).toBeDefined();

        await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });

        expect(registry.getObject('myapp_invoice')).toBeDefined();
        expect(ownerPackageId(registry, 'myapp_invoice')).toBe(APP_PKG);
    });

    /**
     * The plural `objects` spelling reaches the same limb.
     * `canonicalizeMetaRequestType` folds it at the top of `deleteMetaItem` and
     * the heal re-folds through `PLURAL_TO_SINGULAR`; the guard keys off the
     * SINGULAR, so neither spelling can miss it (#4432's "every surface in
     * agreement").
     */
    it('the plural `objects` spelling is guarded identically', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry } = makeSession({ seed });
        installPackage(registry, APP_PKG);
        registry.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);
        await protocol.loadMetaFromDb();

        await protocol.deleteMetaItem({ type: 'objects', name: 'myapp_invoice' });

        expect(registry.getObject('myapp_invoice')).toBeDefined();
        expect(ownerPackageId(registry, 'myapp_invoice')).toBe(APP_PKG);
    });

    /**
     * The control-plane kernel reaches this walk through a different door —
     * `deleteMetaItem`'s two-tier authorization is skipped entirely when
     * `environmentId === undefined`, and `revertCommit`'s soft-remove limb
     * arrives here without it either. Pinned so the guard is not mistaken for
     * something only the tenant path exercises.
     */
    it('a control-plane kernel is guarded too', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry } = makeSession({ seed, controlPlane: true });
        installPackage(registry, APP_PKG);
        registry.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);
        await protocol.loadMetaFromDb();

        await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });

        expect(registry.getObject('myapp_invoice')).toBeDefined();
        expect(ownerPackageId(registry, 'myapp_invoice')).toBe(APP_PKG);
    });
});
