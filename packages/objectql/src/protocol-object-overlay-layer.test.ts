// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
// [#4550 / #5480] The producer's OWN write-verb dispatch decisions, so the
// engine double below cannot accept a call `ObjectQL.delete` / `ObjectQL.update`
// refuses — a double looser than the implementation is no test at all.
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

/**
 * ADR-0029 D9, end to end — a tenant overlay of an object registers as its own
 * contributor LAYER, and the two gates that read `isArtifactBacked` stop being
 * silently disarmed.
 *
 * ## What this file used to pin, and why it does not any more
 *
 * It was #7012's file: tier 3 of the delete heal decided on the PACKAGE BINDING
 * instead of on `isArtifactBacked`, because the predicate had been falsified.
 * `SchemaRegistry.registerObject` spliced out the same-package `own`
 * contributor, so hydrating an overlay row whose `package_id` equalled the
 * packaged owner's id DESTROYED the packaged definition — no second copy
 * anywhere — and `loadMetaFromDb` replayed that on every boot, silently:
 *
 * ```
 * loadMetaFromDb -> {"loaded":1,"errors":0,"invalid":0}   warnings: []
 * DELETE         -> {"success":true,"reset":true}
 * objectContributors: []   getObject: null
 * data CRUD: OBJECT_NOT_FOUND / 404   (while the table still holds the rows)
 * ```
 *
 * D9 removes the falsification at its source, so the guard is RETIRED here and
 * this file pins the model that subsumes it. The first case below is the direct
 * inversion of the old premise test: the packaged definition survives the boot
 * replay. `isArtifactBacked` is then honest, which covers the case the guard
 * protected without a second predicate — and the guard's own remaining reach
 * was only its ACCEPTED COST (a package-bound RUNTIME-authored object kept
 * listable-but-rowless until restart), which is no longer the cheap direction
 * but simply the wrong answer. Both directions are pinned below.
 *
 * ## The cost D9.6 declares, and the second gate it also reaches
 *
 * With the predicate honest, `object`'s `allowOrgOverride: false` is enforced
 * CONSISTENTLY rather than only on the first write. D9.6 states that for
 * `saveMetaItem`; the same predicate feeds `deleteMetaItem`'s two-tier
 * authorization and `SysMetadataRepository.assertAllowed`, so a tenant overlay
 * of a PACKAGED object can no longer be re-saved or reset without the
 * documented operator hatch either. That is not softened here — it is pinned,
 * because a fixture encoding the old leniency would be encoding the defect.
 */

const APP_PKG = 'app.myapp';
const OTHER_PKG = 'app.otherapp';
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
    // [#8310] The runtime object door requires an authored OWD. `private`
    // matches (does not widen) the packaged baseline, so R1 stays silent and
    // each case keeps refusing/passing for its ORIGINAL reason.
    sharingModel: 'private',
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

/** [ADR-0005 / D9.6] The documented operator hatch — the ONE door, for the LIFE of the customization. */
function withObjectWritable<T>(run: () => T): T {
    const previous = process.env.OS_METADATA_WRITABLE;
    process.env.OS_METADATA_WRITABLE = 'object';
    // Two memoised readers of the same env var — the protocol's gate and the
    // repository's `assertAllowed`. Both must be reset or the second answers
    // from a stale parse.
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
    const restore = () => {
        if (previous === undefined) delete process.env.OS_METADATA_WRITABLE;
        else process.env.OS_METADATA_WRITABLE = previous;
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    };
    try {
        const out = run();
        return (out as any) instanceof Promise
            ? ((out as any).finally(restore) as T)
            : (restore(), out);
    } catch (e) {
        restore();
        throw e;
    }
}

/** A booted kernel: the package registers its objects, then the DB hydrates. */
async function bootWithPackage(seed: any[], opts: { controlPlane?: boolean; install?: boolean } = {}) {
    const s = makeSession({ seed, ...(opts.controlPlane ? { controlPlane: true } : {}) });
    if (opts.install !== false) installPackage(s.registry, APP_PKG);
    s.registry.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);
    const res = await s.protocol.loadMetaFromDb();
    return { ...s, res };
}

const kinds = (registry: SchemaRegistry, name: string) =>
    registry.getObjectContributors(name).map((c) => c.ownership);

describe('ADR-0029 D9 — the boot replay LAYERS the tenant row instead of destroying the package', () => {
    /**
     * The direct inversion of this file's old premise test, which asserted
     * `getArtifactItem(...)` was `undefined` and `packaged_only` was gone. Both
     * flip here, and that flip is the whole card.
     */
    it('after hydration the packaged definition is still there, underneath', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { registry, res } = await bootWithPackage(seed);

        expect(res).toMatchObject({ loaded: 1, errors: 0, invalid: 0 });

        // Two layers, not one — and the owner is the package, not the tenant.
        expect(kinds(registry, 'myapp_invoice')).toEqual(['own', 'overlay']);
        expect(ownerPackageId(registry, 'myapp_invoice')).toBe(APP_PKG);
        const owner = registry.getObjectOwner('myapp_invoice')!;
        expect(Object.keys((owner.definition as any).fields)).toContain('packaged_only');
        expect((owner.definition as any)._provenance).toBe('package');

        // The RESOLVED object does not move: still the tenant's body, still
        // stamped `org`. Bit-for-bit what the splice used to produce.
        expect(fieldNames(registry, 'myapp_invoice')).toContain('overlay_only');
        expect(fieldNames(registry, 'myapp_invoice')).not.toContain('packaged_only');
        expect((registry.getObject('myapp_invoice') as any)._provenance).toBe('org');

        // …and the predicate both gates read is honest again.
        expect(registry.getArtifactItem('object', 'myapp_invoice')).toBeDefined();
    });

    it('the hydration is idempotent across boots — one layer, not a stack', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry } = await bootWithPackage(seed);
        await protocol.loadMetaFromDb();
        await protocol.loadMetaFromDb();
        expect(kinds(registry, 'myapp_invoice')).toEqual(['own', 'overlay']);
    });
});

describe('ADR-0029 D9.6 — the declared contract, enforced consistently', () => {
    /**
     * The cost the record already accepts, measured. Today the FIRST write is
     * refused and, by destroying the evidence, admits every later one through
     * the `allowRuntimeCreate` tier. Asserted by refusal IDENTITY (code AND
     * status), not by `toThrow` — a bare throw assertion carries one bit where
     * the defect has two.
     */
    it('an overlay write to a PACKAGED object is refused EVERY time, not only the first', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry } = await bootWithPackage(seed);

        for (const attempt of [1, 2, 3]) {
            const err = await protocol.saveMetaItem({
                type: 'object', name: 'myapp_invoice', packageId: APP_PKG, item: overlayBody('myapp_invoice'),
            }).then(() => null, (e: any) => e);
            expect(err, `attempt ${attempt}`).toBeInstanceOf(Error);
            expect(err.code, `attempt ${attempt}`).toBe('NOT_OVERRIDABLE');
            expect(err.status, `attempt ${attempt}`).toBe(403);
        }

        // The refusal costs the packaged definition nothing.
        expect(registry.getArtifactItem('object', 'myapp_invoice')).toBeDefined();
        expect(kinds(registry, 'myapp_invoice')).toEqual(['own', 'overlay']);
    });

    /**
     * The SECOND gate that reads the same predicate, which D9.6 does not
     * enumerate: `deleteMetaItem`'s two-tier authorization. Pinned rather than
     * softened — the reset of a customization the type never allowed is the
     * same declaration, on the other verb, and it is exactly the delete whose
     * unchecked version took the object off the data plane (#7012).
     */
    it('…and so is the RESET of one: deleteMetaItem answers NOT_OVERRIDABLE / 403', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol } = await bootWithPackage(seed);

        const err = await protocol
            .deleteMetaItem({ type: 'object', name: 'myapp_invoice' })
            .then(() => null, (e: any) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('NOT_OVERRIDABLE');
        expect(err.status).toBe(403);
    });

    /**
     * Guard against over-refusal: a RUNTIME-authored object — no package layer
     * — is untouched by the honest predicate and stays editable. This is
     * cloud#970's counter-example, and it is why D9.6 reads the OWNER
     * contributor rather than simply trusting a package id.
     */
    it('a runtime-authored object stays editable — no code layer, no refusal', async () => {
        const seed = await persistOverlayRow('myapp_note', APP_PKG);
        const { protocol, registry } = makeSession({ seed });
        installPackage(registry, APP_PKG);
        await protocol.loadMetaFromDb();

        expect(registry.getArtifactItem('object', 'myapp_note')).toBeUndefined();
        const evolved = overlayBody('myapp_note');
        (evolved.fields as any).due_date = { name: 'due_date', type: 'date', label: 'Due' };
        const res = await protocol.saveMetaItem({
            type: 'object', name: 'myapp_note', packageId: APP_PKG, item: evolved,
        });
        expect(res.success).toBe(true);
        expect(fieldNames(registry, 'myapp_note')).toContain('due_date');
    });
});

describe('ADR-0029 D9.7 — the delete is a SUBTRACTION, and #7012\'s guard is retired', () => {
    /**
     * THE RESTORATION THAT IS NOT A RE-REGISTRATION. Under the hatch — the one
     * door D9.6 names, which now has to stay open for the life of the
     * customization — the delete removes the tenant's LAYER and the packaged
     * owner, which was never destroyed, is served again. Pre-D9 the same delete
     * emptied `objectContributors` and 404'd the data plane.
     */
    it('removes the overlay layer and serves the packaged owner again, data plane up throughout', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry, rows, dataRows } = await bootWithPackage(seed);

        // The data plane works before the delete, so "works after" cannot be
        // green for the empty reason.
        expect((await protocol.createData({ object: 'myapp_invoice', data: { name: 'INV-1' } })).id).toBeTruthy();

        const res = await withObjectWritable(() =>
            protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' }));

        expect(res.success).toBe(true);
        expect(storedRows(rows, 'myapp_invoice')).toHaveLength(0);

        // The layer is gone; the package's own definition is back, in full.
        expect(kinds(registry, 'myapp_invoice')).toEqual(['own']);
        expect(ownerPackageId(registry, 'myapp_invoice')).toBe(APP_PKG);
        expect(fieldNames(registry, 'myapp_invoice')).toContain('packaged_only');
        expect(fieldNames(registry, 'myapp_invoice')).not.toContain('overlay_only');
        expect((registry.getObject('myapp_invoice') as any)._provenance).toBe('package');

        // …and CRUD never stopped dispatching.
        expect((await protocol.createData({ object: 'myapp_invoice', data: { name: 'INV-2' } })).id).toBeTruthy();
        expect(dataRows).toHaveLength(2);
    });

    it('the plural `objects` spelling reaches the same subtraction', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry } = await bootWithPackage(seed);

        await withObjectWritable(() => protocol.deleteMetaItem({ type: 'objects', name: 'myapp_invoice' }));

        expect(kinds(registry, 'myapp_invoice')).toEqual(['own']);
        expect(fieldNames(registry, 'myapp_invoice')).toContain('packaged_only');
    });

    /**
     * A CONTROL-PLANE kernel skips `deleteMetaItem`'s two-tier authorization
     * entirely (`environmentId === undefined`) — but not the repository's
     * `assertAllowed`, which is topology-independent and refuses an
     * `override-artifact` delete of a type without `allowOrgOverride`. Pinned
     * so "the tenant gate is skipped" is never mistaken for "ungated".
     */
    it('a control-plane kernel refuses at the repository, and subtracts under the hatch', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const a = await bootWithPackage(seed, { controlPlane: true });
        const refused = await a.protocol
            .deleteMetaItem({ type: 'object', name: 'myapp_invoice' })
            .then(() => null, (e: any) => e);
        expect(refused).toBeInstanceOf(Error);
        expect(refused.code).toBe('NOT_OVERRIDABLE');
        expect(refused.status).toBe(403);

        const b = await bootWithPackage(seed, { controlPlane: true });
        await withObjectWritable(() => b.protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' }));
        expect(kinds(b.registry, 'myapp_invoice')).toEqual(['own']);
    });

    /**
     * #7012'S RETIREMENT, THE DIRECTION THAT CHANGES. This is the object the
     * binding guard kept alive: a package-bound RUNTIME-authored object
     * (Studio's package workspace, #4636) whose package IS installed. Nothing
     * ships the name — `getPackagedObjectOwner` answers `undefined`, so the row
     * registered as `own` and `isArtifactBacked` is honestly `false` — so the
     * row WAS the item and the operator's delete now means what it says.
     *
     * Under the retired guard this was "listable but rowless until restart":
     * `getObject` kept answering and data CRUD kept writing into a table whose
     * metadata the operator had just deleted.
     */
    it('a package-bound RUNTIME-authored object is retired, and its data plane closes', async () => {
        const seed = await persistOverlayRow('myapp_note', APP_PKG);
        const { protocol, registry, dataRows } = makeSession({ seed });
        installPackage(registry, APP_PKG);       // the package record exists…
        await protocol.loadMetaFromDb();         // …but ships no object of this name

        expect(registry.getPackage(APP_PKG)).toBeDefined();
        expect(ownerPackageId(registry, 'myapp_note')).toBe(APP_PKG);
        expect(registry.getArtifactItem('object', 'myapp_note')).toBeUndefined();
        expect((await protocol.createData({ object: 'myapp_note', data: { name: 'N-1' } })).id).toBeTruthy();

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
     * The two directions the guard already answered correctly, carried over
     * verbatim in intent. Green BEFORE and AFTER the retirement — guards that
     * the retirement did not open a hole, not evidence for it.
     */
    it('a package-LESS runtime object is still retired', async () => {
        const seed = await persistOverlayRow('myapp_note');
        const { protocol, registry } = makeSession({ seed });
        await protocol.loadMetaFromDb();

        expect(ownerPackageId(registry, 'myapp_note')).toBe(SENTINEL);
        await protocol.deleteMetaItem({ type: 'object', name: 'myapp_note' });
        expect(registry.getObject('myapp_note')).toBeUndefined();
    });

    it('a binding naming a package that is NOT installed is still retired', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry } = makeSession({ seed });
        await protocol.loadMetaFromDb();

        expect(ownerPackageId(registry, 'myapp_invoice')).toBe(APP_PKG);
        expect(registry.getPackage(APP_PKG)).toBeUndefined();
        await protocol.deleteMetaItem({ type: 'object', name: 'myapp_invoice' });
        expect(registry.getObject('myapp_invoice')).toBeUndefined();
    });
});

describe('ADR-0029 D9.9 / #6995 — the row\'s package_id is provenance, never an ownership claim', () => {
    /** `P == O`: the normal case. One overlay layer over the owner's object. */
    it('same package — a normal layer, no error, no warning', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let warned: string[] = [];
        let res: any;
        try {
            res = (await bootWithPackage(seed)).res;
        } finally {
            warned = warn.mock.calls.map((c) => String(c[0]));
            warn.mockRestore();
        }
        expect(res).toMatchObject({ loaded: 1, errors: 0 });
        expect(warned.filter((m) => m.includes('myapp_invoice'))).toEqual([]);
    });

    /**
     * `P` absent — the `'sys_metadata'` sentinel. ACCEPTED. Today this THROWS
     * `already owned by package "app.myapp"` into `loadMetaFromDb`'s per-record
     * catch (#6995, measured as P2); that refusal was an artefact of the
     * borrowed `own` slot, not a decision. A package-less env-wide overlay is
     * ADR-0005's platform-global shape: the row addresses the object by name
     * and the registry knows who owns it.
     */
    it('package-LESS row over a packaged object — accepted as the layer, not refused', async () => {
        const seed = await persistOverlayRow('myapp_invoice');
        const { registry, res } = await bootWithPackage(seed);

        expect(res).toMatchObject({ loaded: 1, errors: 0 });
        expect(kinds(registry, 'myapp_invoice')).toEqual(['own', 'overlay']);
        // The layer carries the sentinel as its own provenance; ownership is
        // untouched, and still the package's.
        expect(registry.getObjectContributors('myapp_invoice')[1].packageId).toBe(SENTINEL);
        expect(ownerPackageId(registry, 'myapp_invoice')).toBe(APP_PKG);
        expect(fieldNames(registry, 'myapp_invoice')).toContain('overlay_only');
    });

    /**
     * `P == Q`: REFUSED AT THE PRODUCER, loudly — the half #6995 was filed
     * about. Pre-D9 `saveMetaItem` returned `success: true` while
     * `registerObject`'s throw went to a best-effort `console.warn`: a receipt
     * for a write the runtime had discarded.
     *
     * Asserted by refusal identity (code AND status), because "refused with the
     * wrong envelope" and "not refused at all" are the two defects here and a
     * bare `toThrow` cannot separate them.
     */
    it('different package — the WRITE is refused with an ADR-0112 envelope, and nothing is persisted', async () => {
        const seed = await persistOverlayRow('myapp_invoice', APP_PKG);
        const { protocol, registry, rows } = await bootWithPackage(seed);

        const err = await withObjectWritable(() => protocol.saveMetaItem({
            type: 'object', name: 'myapp_invoice', packageId: OTHER_PKG, item: overlayBody('myapp_invoice'),
        }).then(() => null, (e: any) => e));

        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('OBJECT_OVERLAY_PACKAGE_MISMATCH');
        expect(err.status).toBe(422);
        expect(String(err.message)).toContain(OTHER_PKG);
        expect(String(err.message)).toContain(APP_PKG);

        // No success receipt, and no row for the mis-bound package.
        expect(storedRows(rows, 'myapp_invoice').filter((r) => r.package_id === OTHER_PKG)).toHaveLength(0);
        // The registry is untouched: one owner, one layer, still the right ones.
        expect(kinds(registry, 'myapp_invoice')).toEqual(['own', 'overlay']);
        expect(ownerPackageId(registry, 'myapp_invoice')).toBe(APP_PKG);
    });

    /**
     * …and the BOOT side of the same fact: the row is not layered and is
     * counted in `loadMetaFromDb`'s per-record `errors` with its reason, which
     * is why #6995 is a write-path divergence and not a boot-path one.
     */
    it('different package — the BOOT counts it in `errors` and leaves the package alone', async () => {
        const seed = await persistOverlayRow('myapp_invoice', OTHER_PKG);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let warned: string[] = [];
        let booted: any;
        try {
            booted = await bootWithPackage(seed);
        } finally {
            warned = warn.mock.calls.map((c) => String(c[0]));
            warn.mockRestore();
        }

        expect(booted.res).toMatchObject({ loaded: 0, errors: 1 });
        expect(warned.join('\n')).toContain('object_overlay_package_mismatch');

        // The packaged definition is served, untouched — no half-applied layer.
        expect(kinds(booted.registry, 'myapp_invoice')).toEqual(['own']);
        expect(fieldNames(booted.registry, 'myapp_invoice')).toContain('packaged_only');
        expect(booted.registry.getArtifactItem('object', 'myapp_invoice')).toBeDefined();
    });

    /**
     * Guard: the mismatch refusal is about `object` only. Every other type can
     * legitimately hold two rows for one name bound to two packages, and the
     * registry can represent that — so nothing here narrows them.
     */
    it('a non-object type with a different binding is untouched by the rule', async () => {
        const { protocol } = makeSession();
        const res = await protocol.saveMetaItem({
            type: 'view', name: 'shared_grid', packageId: OTHER_PKG,
            item: { name: 'shared_grid', type: 'grid', columns: ['name'], object: 'task', viewKind: 'list' }, // [#7741] the inline arm requires the object binding pair
        });
        expect(res.success).toBe(true);
    });
});
