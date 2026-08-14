// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4521 — a just-saved overlay must be DISPATCHABLE, not just listable.
 *
 * The v17 verification (#4432, F1) reported that immediately after a
 * successful `PUT /api/v1/meta/action/<name>`, `GET /api/v1/meta/action`
 * already listed the overlay while `POST /api/v1/actions/<object>/<name>`
 * answered the ADR-0110 "has no declaration" 404 — and a later POST
 * succeeded. Nothing expired in between: the *listing* is what repaired it.
 *
 * The lagging cache is the engine's `SchemaRegistry`. `resolveRouteActionDeclaration`
 * reads it as source 2, but the WRITE only wrote through it for `object`
 * (`applyObjectRegistryMutation` returns early for every other type). Every
 * other overlay type reached the registry solely via the READ-side hydration
 * inside `getMetaItems` / `loadMetaFromDb` — so "has this been listed yet?"
 * silently decided whether a saved action could be invoked.
 *
 * These tests drive the exact repro through the real seam: the real
 * `ObjectStackProtocolImplementation.saveMetaItem`, the real `SchemaRegistry`,
 * and the real `resolveRouteActionDeclaration` — with NO listing call in
 * between. They fail if the write-through is removed, and they pin the two
 * boundaries the fix must not cross: a genuinely absent declaration still
 * resolves to nothing (ADR-0110's 404 stands), and a `draft` save is still
 * not live.
 *
 * ── #5079 — the same invariant in the DELETE direction ──
 *
 * The second describe block below is the mirror image, and it lives in this
 * file on purpose: the two directions are one invariant ("every surface in
 * agreement", #4432), and splitting them across two suites is how they drift.
 * #5079 measured the residual on `origin/main`: after `DELETE
 * /api/v1/meta/action/<name>` of a runtime-CREATED overlay, the row was gone
 * from `sys_metadata` and yet `GET /meta/action` kept listing it, `GET
 * /meta/action/<name>` kept serving its body, and `resolveRouteActionDeclaration`
 * kept resolving it — for the life of the process, no TTL involved.
 *
 * The lagging cache is the same `SchemaRegistry`, from the other end: #4521's
 * write-through puts a runtime-created overlay under the PLAIN key, and the
 * delete's registry heal (`restoreArtifactRegistryView`) only knew how to
 * un-shadow a packaged artifact — `removeRuntimeShadow` declines when there
 * is none, which for a runtime-created item is always. Nothing else ever
 * removed the entry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SchemaRegistry, assertEngineUpdateDispatch, assertEngineDeleteDispatch } from '@objectstack/objectql';
import { resolveRouteActionDeclaration, type ActionExecutionDeps } from './action-execution.js';

/**
 * A `sys_metadata`-shaped fake engine. Rows live in a plain array so the
 * repository write path (insert/update) and every read see one store — the
 * same double #4432's canonicalization test uses.
 */
function makeEngine(registry: SchemaRegistry) {
    let rows: any[] = [];
    let nextId = 1;
    const matches = (r: any, w: Record<string, unknown>): boolean =>
        Object.entries(w).every(([k, v]) => {
            if (v === undefined) return true;
            if (v !== null && typeof v === 'object') return true; // operator clause — not exercised here
            return r[k] === v;
        });
    const engine: any = {
        registry,
        find: vi.fn(async (_table: string, opts: any) => rows.filter((r) => matches(r, opts?.where ?? {}))),
        findOne: vi.fn(async (table: string, opts: any) => (await engine.find(table, opts))[0] ?? null),
        insert: vi.fn(async (_table: string, data: any) => {
            const row = { id: data.id ?? `row_${nextId++}`, ...data };
            rows.push(row);
            return row;
        }),
        update: vi.fn(async (_table: string, data: any, opts: any) => {
            assertEngineUpdateDispatch(data, opts);
            const target = rows.find((r) => matches(r, opts?.where ?? {}));
            if (target) Object.assign(target, data);
            return target ?? null;
        }),
        delete: vi.fn(async (_table: string, opts: any) => {
            assertEngineDeleteDispatch(opts);
            const before = rows.length;
            rows = rows.filter((r) => !matches(r, opts?.where ?? {}));
            return { deleted: before - rows.length };
        }),
        count: vi.fn(async (_table: string, opts: any) => rows.filter((r) => matches(r, opts?.where ?? {})).length),
        aggregate: vi.fn(async () => []),
        execute: vi.fn(async () => undefined),
        getRows: () => rows,
    };
    return engine;
}

/** The routed object the showcase repro dispatched against. */
const OBJECT_DEF = { name: 'showcase_task', label: 'Task', fields: {}, actions: [] };

describe('#4521 — read-your-writes between saveMeta and the dispatch path', () => {
    let registry: SchemaRegistry;
    let engine: any;
    let protocol: ObjectStackProtocolImplementation;
    let ql: any;
    let deps: ActionExecutionDeps;
    let requestContext: any;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        registry.registerObject(OBJECT_DEF as any, 'showcase');
        engine = makeEngine(registry);
        protocol = new ObjectStackProtocolImplementation(engine);
        ql = {
            registry,
            getSchema: (name: string) => (name === OBJECT_DEF.name ? OBJECT_DEF : undefined),
        };
        // No metadata service at all: the declaration must be resolvable from
        // what the WRITE left behind, not from a second store that happens to
        // be reachable. `resolveService` answering `undefined` is the ordinary
        // "no metadata plane bound" case, not a degraded one.
        deps = {
            resolveService: (async () => undefined) as any,
            getObjectQL: async () => ql,
        } as ActionExecutionDeps;
        // [#5155] The request whose kernel these lookups resolve against.
        requestContext = { request: {} } as any;
    });

    const saveAction = (item: any, mode?: 'draft' | 'publish') =>
        protocol.saveMetaItem({
            type: 'action',
            name: item.name,
            item,
            ...(mode ? { mode } : {}),
        });

    const resolve = (actionName: string) =>
        resolveRouteActionDeclaration(deps, requestContext, {
            ql,
            objectName: OBJECT_DEF.name,
            actionName,
        });

    it('dispatches an overlay saved in the SAME request sequence — no listing call in between', async () => {
        // The exact #4432 F1 repro: PUT, then POST. Nothing reads the list.
        const saved = await saveAction({
            name: 'rc1_probe',
            label: 'Probe',
            objectName: 'showcase_task',
            type: 'script',
            target: 'showcase.probe',
        });
        expect(saved.success).toBe(true);

        const { action, degraded } = await resolve('rc1_probe');

        // Pre-fix this is `undefined` → the route answers the ADR-0110
        // "has no declaration" 404 for a just-saved, already-listed overlay.
        expect(action).toBeDefined();
        expect(action?.name).toBe('rc1_probe');
        expect(action?.type).toBe('script');
        // A miss and an outage are different facts (ADR-0110 D3): this is a hit.
        expect(degraded).toBeFalsy();
    });

    it('object-less overlays are dispatchable immediately too', async () => {
        await saveAction({ name: 'global_probe', label: 'Global', type: 'script', target: 'showcase.probe' });
        const { action } = await resolve('global_probe');
        expect(action?.name).toBe('global_probe');
    });

    it('listing FIRST is not what makes it dispatchable (the pre-fix crutch is gone)', async () => {
        // Revert-proof: pre-fix, this test passed ONLY because `getMetaItems`
        // hydrated the registry. Assert the write already did it — the list
        // read must be an observation, not a repair.
        await saveAction({ name: 'order_probe', label: 'Order', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' });
        const hydratedByWrite = registry.getItem('action', 'order_probe');
        expect(hydratedByWrite).toBeDefined();
        expect((hydratedByWrite as any)?.label).toBe('Order');
    });

    it('a second save is visible immediately (the overlay UPDATE path, not just insert)', async () => {
        await saveAction({ name: 'rc1_probe', label: 'V1', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' });
        await saveAction({ name: 'rc1_probe', label: 'V2', objectName: 'showcase_task', type: 'flow', target: 'wf' });
        const { action } = await resolve('rc1_probe');
        expect(action?.label).toBe('V2');
        // #3915 — the declared TYPE is what the route dispatches on, so a
        // stale registry entry would send the call to the wrong executor.
        expect(action?.type).toBe('flow');
    });

    it('a name that was never declared still resolves to NOTHING (ADR-0110 404 preserved)', async () => {
        await saveAction({ name: 'rc1_probe', label: 'Probe', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' });
        const { action, degraded } = await resolve('never_declared');
        expect(action).toBeUndefined();
        expect(degraded).toBeFalsy();
    });

    it('the write-through SHADOWS the packaged artifact — DELETE still restores it', async () => {
        // The hazard the pre-#4521 "saveMetaItem must not touch the registry"
        // rule was guarding: if the write overwrote the artifact IN PLACE,
        // `deleteMetaItem` ("reset to artifact default") would have nothing to
        // restore. It does not — the artifact lives under the composite
        // `<packageId>:<name>` key and the overlay is a plain-key shadow, which
        // `restoreArtifactRegistryView` removes on delete. Pinned here because
        // the write-through is what makes that separation load-bearing.
        //
        // #6483 rolled `action`'s `allowOrgOverride` back to `false`
        // (ADR-0005: page/app/action are ❌ in the amendment table), so
        // overriding this PACKAGED action needs the one documented door that
        // remains — the `OS_METADATA_WRITABLE` operator escape hatch. The
        // shadow/restore machinery pinned here is exactly what an operator
        // behind the hatch exercises. (Every other case in this file writes
        // brand-new names, which ride `allowRuntimeCreate` untouched.)
        process.env.OS_METADATA_WRITABLE = 'action';
        (ObjectStackProtocolImplementation as any).resetEnvWritableCache();
        resetEnvWritableMetadataTypes();

        registry.registerItem('action', { name: 'shipped_probe', label: 'Shipped', type: 'script', target: 'showcase.shipped' }, 'name', 'showcase');
        expect((await resolve('shipped_probe')).action?.label).toBe('Shipped');

        await saveAction({ name: 'shipped_probe', label: 'Customized', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' });
        expect((await resolve('shipped_probe')).action?.label).toBe('Customized');

        await protocol.deleteMetaItem({ type: 'action', name: 'shipped_probe' });
        expect((await resolve('shipped_probe')).action?.label).toBe('Shipped');
    });

    afterEach(() => {
        // The escape-hatch case must not leak `action` writability into its
        // neighbours — both memoised caches, or the next case lies.
        delete process.env.OS_METADATA_WRITABLE;
        (ObjectStackProtocolImplementation as any).resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    });

    it('a DRAFT save is not dispatchable — drafts never leak into the live registry', async () => {
        const saved = await saveAction(
            { name: 'draft_probe', label: 'Draft', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' },
            'draft',
        );
        expect(saved.success).toBe(true);
        expect(saved.state).toBe('draft');
        const { action } = await resolve('draft_probe');
        expect(action).toBeUndefined();
        expect(registry.getItem('action', 'draft_probe')).toBeUndefined();
    });
});

describe('#5079 — list / get / dispatch agree immediately after deleteMeta', () => {
    let registry: SchemaRegistry;
    let engine: any;
    let protocol: ObjectStackProtocolImplementation;
    let ql: any;
    let deps: ActionExecutionDeps;
    let requestContext: any;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        registry.registerObject(OBJECT_DEF as any, 'showcase');
        engine = makeEngine(registry);
        protocol = new ObjectStackProtocolImplementation(engine);
        ql = {
            registry,
            getSchema: (name: string) => (name === OBJECT_DEF.name ? OBJECT_DEF : undefined),
        };
        deps = {
            resolveService: (async () => undefined) as any,
            getObjectQL: async () => ql,
        } as ActionExecutionDeps;
        requestContext = { request: {} } as any;
    });

    const saveAction = (item: any, mode?: 'draft' | 'publish') =>
        protocol.saveMetaItem({
            type: 'action',
            name: item.name,
            item,
            ...(mode ? { mode } : {}),
        });

    /** The three surfaces #4432 requires to agree, read in one go. */
    const surfaces = async (actionName: string) => {
        const listed = await protocol.getMetaItems({ type: 'action' });
        const fetched = await protocol.getMetaItem({ type: 'action', name: actionName });
        const dispatch = await resolveRouteActionDeclaration(deps, requestContext, {
            ql,
            objectName: OBJECT_DEF.name,
            actionName,
        });
        return {
            listedNames: (listed.items as any[]).map((i) => i?.name),
            item: fetched.item as any,
            declaration: dispatch.action as any,
            degraded: dispatch.degraded,
        };
    };

    it('a runtime-created overlay vanishes from list AND get AND dispatch in the same step', async () => {
        // The #5079 repro, protocol-level: PUT a name nothing ships, confirm
        // all three surfaces agree it EXISTS, delete it, confirm all three
        // agree it does not — with no listing call, no reload and no TTL wait
        // in between.
        await saveAction({
            name: 'rg_clean',
            label: 'RG Clean',
            objectName: 'showcase_task',
            type: 'script',
            target: 'showcase.probe',
        });

        const before = await surfaces('rg_clean');
        expect(before.listedNames).toContain('rg_clean');
        expect(before.item?.label).toBe('RG Clean');
        expect(before.declaration?.name).toBe('rg_clean');

        const deleted = await protocol.deleteMetaItem({ type: 'action', name: 'rg_clean' });
        expect(deleted.success).toBe(true);
        expect(deleted.reset).toBe(true);
        // #5927 — nothing is shipped under this name, so the receipt says the
        // item is gone rather than "reset to artifact default". The registry
        // must now make the same statement.
        expect(deleted.message).toContain('no longer exists');

        const after = await surfaces('rg_clean');
        // Pre-fix ALL THREE of these still carried the deleted overlay: the
        // listing enumerated it, the single-item read served its body, and the
        // ADR-0110 D3 gate resolved a declaration for it — so `POST
        // /actions/showcase_task/rg_clean` 404ed with the handler-miss wording
        // ("… not found") instead of "has no declaration".
        expect(after.listedNames).not.toContain('rg_clean');
        expect(after.item).toBeUndefined();
        expect(after.declaration).toBeUndefined();
        // A miss, not an outage (ADR-0110 D3) — the store answered.
        expect(after.degraded).toBeFalsy();
        // And the row really is gone, so the surfaces are not merely agreeing
        // with each other about a stale copy. (`state` is a `sys_metadata`
        // column the append-only history rows do not carry, so this counts
        // live overlays only.)
        const overlayRows = await engine.find('sys_metadata', {
            where: { type: 'action', name: 'rg_clean', state: 'active' },
        });
        expect(overlayRows).toHaveLength(0);
    });

    it('deleting the LAST overlay of a type leaves an empty listing, not a ghost', async () => {
        await saveAction({ name: 'only_one', label: 'Only', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' });
        expect((await surfaces('only_one')).listedNames).toEqual(['only_one']);

        await protocol.deleteMetaItem({ type: 'action', name: 'only_one' });
        expect((await surfaces('only_one')).listedNames).toEqual([]);
    });

    afterEach(() => {
        // The escape-hatch case below must not leak `action` writability into
        // its neighbours — both memoised caches, or the next case lies.
        delete process.env.OS_METADATA_WRITABLE;
        (ObjectStackProtocolImplementation as any).resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    });

    it('an ARTIFACT-backed delete resets to the shipped value — it does not retire the name', async () => {
        // The boundary the #5079 fix must not cross. `removeRuntimeShadow`
        // still owns this case; `removeOverlayEntry` must never reach it, or a
        // "reset to artifact default" would delete the artifact instead of
        // revealing it.
        //
        // #6483 rolled `action`'s `allowOrgOverride` back to `false`
        // (ADR-0005: page/app/action are ❌ in the amendment table), so
        // overriding this PACKAGED action needs the one documented door that
        // remains — the `OS_METADATA_WRITABLE` operator escape hatch, exactly
        // as the sibling `#4521` case above does. (Every other case in this
        // block writes brand-new names, which ride `allowRuntimeCreate`
        // untouched, so only this one needs the hatch.)
        process.env.OS_METADATA_WRITABLE = 'action';
        (ObjectStackProtocolImplementation as any).resetEnvWritableCache();
        resetEnvWritableMetadataTypes();

        registry.registerItem(
            'action',
            { name: 'shipped_probe', label: 'Shipped', type: 'script', target: 'showcase.shipped' },
            'name',
            'showcase',
        );
        await saveAction({ name: 'shipped_probe', label: 'Customized', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' });
        expect((await surfaces('shipped_probe')).item?.label).toBe('Customized');

        const deleted = await protocol.deleteMetaItem({ type: 'action', name: 'shipped_probe' });
        expect(deleted.message).toContain('reset to artifact default');

        const after = await surfaces('shipped_probe');
        expect(after.listedNames).toContain('shipped_probe');
        expect(after.item?.label).toBe('Shipped');
        expect(after.declaration?.label).toBe('Shipped');
    });

    it('discarding a DRAFT leaves the live overlay listed and dispatchable', async () => {
        // A draft discard is not a retirement. `restoreArtifactRegistryView`
        // is skipped for `state: 'draft'`, so the active entry must survive —
        // pinned because the #5079 step 3 is the first thing in this method
        // that can make an entry disappear entirely.
        await saveAction({ name: 'live_probe', label: 'Live', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' });
        await saveAction({ name: 'live_probe', label: 'Pending', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' }, 'draft');

        await protocol.deleteMetaItem({ type: 'action', name: 'live_probe', state: 'draft' });

        const after = await surfaces('live_probe');
        expect(after.listedNames).toContain('live_probe');
        expect(after.item?.label).toBe('Live');
        expect(after.declaration?.label).toBe('Live');
    });

    it('deleting one overlay does not retire its namesake in another type', async () => {
        // `removeOverlayEntry` is addressed by (type, name); a `flow` named
        // `twin` must survive the delete of the `action` named `twin`.
        await saveAction({ name: 'twin', label: 'Action Twin', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' });
        await protocol.saveMetaItem({
            type: 'flow',
            name: 'twin',
            item: { name: 'twin', label: 'Flow Twin', type: 'autolaunched', nodes: [], edges: [] },
        });

        await protocol.deleteMetaItem({ type: 'action', name: 'twin' });

        expect((await protocol.getMetaItems({ type: 'action' })).items).toHaveLength(0);
        expect(((await protocol.getMetaItems({ type: 'flow' })).items as any[]).map((i) => i?.name)).toContain('twin');
    });

    it('deleting a name that was never written removes nothing it did not own', async () => {
        // The `!current` self-heal branch calls the same registry heal. A
        // no-op delete must stay a no-op for every other item.
        await saveAction({ name: 'keeper', label: 'Keeper', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' });

        const deleted = await protocol.deleteMetaItem({ type: 'action', name: 'never_written' });
        expect(deleted.success).toBe(true);
        expect(deleted.reset).toBe(false);

        expect((await surfaces('keeper')).listedNames).toEqual(['keeper']);
    });
});
