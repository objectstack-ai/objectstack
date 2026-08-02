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
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
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
            const target = rows.find((r) => matches(r, opts?.where ?? {}));
            if (target) Object.assign(target, data);
            return target ?? null;
        }),
        delete: vi.fn(async (_table: string, opts: any) => {
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
    });

    const saveAction = (item: any, mode?: 'draft' | 'publish') =>
        protocol.saveMetaItem({
            type: 'action',
            name: item.name,
            item,
            ...(mode ? { mode } : {}),
        });

    const resolve = (actionName: string) =>
        resolveRouteActionDeclaration(deps, {
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
        registry.registerItem('action', { name: 'shipped_probe', label: 'Shipped', type: 'script', target: 'showcase.shipped' }, 'name', 'showcase');
        expect((await resolve('shipped_probe')).action?.label).toBe('Shipped');

        await saveAction({ name: 'shipped_probe', label: 'Customized', objectName: 'showcase_task', type: 'script', target: 'showcase.probe' });
        expect((await resolve('shipped_probe')).action?.label).toBe('Customized');

        await protocol.deleteMetaItem({ type: 'action', name: 'shipped_probe' });
        expect((await resolve('shipped_probe')).action?.label).toBe('Shipped');
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
