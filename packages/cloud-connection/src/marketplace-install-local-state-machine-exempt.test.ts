// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Marketplace install of a template whose objects declare a `state_machine`
 * with `initialStates` MUST NOT drop the mid-lifecycle seed rows (framework#3433).
 *
 * A marketplace template is a curated snapshot: its seed almost always contains
 * rows past the FSM entry point — a `closed_won` opportunity, a `closed` case, a
 * `completed` project. #3165 made `initialStates` reject any INSERT outside the
 * entry set, which would silently drop every such row on install / rehydrate-heal
 * / per-org replay ("installed but no data"). #3433 fixed it at the platform:
 * `SeedLoaderService.SEED_OPTIONS` carries `seedReplay`, and the engine skips the
 * `state_machine` rule for those writes.
 *
 * This test drives the REAL marketplace install path (the plugin's HTTP handler
 * → dynamic import of the real runtime SeedLoaderService → runInlineSeed) against
 * an engine stub that FAITHFULLY reproduces the #3165 guard: an insert whose
 * state ∉ `initialStates` is rejected UNLESS the write carries
 * `context.seedReplay`. So the assertion below is exactly the #3433 contract on
 * the marketplace seam — remove the flag from `SEED_OPTIONS` and this goes red
 * (3 of 4 deals dropped, `seeded.errors` > 0).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';

type Handler = (c: any) => Promise<any>;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeCtx(rawApp: any, services: Record<string, any>) {
    const hooks = new Map<string, any>();
    return {
        ctx: {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => rawApp };
                const svc = services[name];
                if (svc === undefined) throw new Error(`no ${name}`);
                return svc;
            },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        },
        fire: async () => { await hooks.get('kernel:ready')?.(); },
    };
}

function makeC(body: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
            header: () => undefined,
        },
        json,
    };
}

/**
 * Engine stub that reproduces the #3165 insert-time `initialStates` guard the
 * REAL ObjectQL engine applies — and honors the #3433 `seedReplay` exemption.
 * Everything else mirrors the faithful stub in the seed-lookup test.
 */
function makeEngine() {
    const store: Record<string, any[]> = {};
    const registry: Record<string, any> = {};
    let idCounter = 0;

    const enforceInitialState = (objectName: string, rec: any, opts: any) => {
        if (opts?.context?.seedReplay === true) return; // #3433 exemption
        const schema = registry[objectName];
        const sm = (schema?.validations ?? []).find(
            (v: any) => v?.type === 'state_machine' && Array.isArray(v.initialStates),
        );
        if (!sm) return;
        const v = rec?.[sm.field];
        if (v == null || v === '') return;
        if (!sm.initialStates.includes(String(v))) {
            const e: any = new Error(`invalid_initial_state: ${sm.field}='${String(v)}'`);
            e.code = 'VALIDATION_FAILED';
            throw e;
        }
    };

    const engine: any = {
        find: async (objectName: string, query?: any) => {
            let records = store[objectName] || [];
            if (query?.where) {
                records = records.filter((r) =>
                    Object.entries(query.where).every(([k, v]) => r[k] === v),
                );
            }
            if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
            return records;
        },
        insert: async (objectName: string, data: any, opts?: any) => {
            if (!store[objectName]) store[objectName] = [];
            if (Array.isArray(data)) {
                // Whole-array insert: a bad row throws the batch (the loader's
                // bulkWrite then degrades to per-row writeOne, exactly like the
                // real engine path).
                const records = data.map((d) => {
                    enforceInitialState(objectName, d, opts);
                    return { id: `row-${++idCounter}`, ...d };
                });
                store[objectName].push(...records);
                return records;
            }
            enforceInitialState(objectName, data, opts);
            const record = { id: `row-${++idCounter}`, ...data };
            store[objectName].push(record);
            return record;
        },
        update: async (objectName: string, data: any) => {
            const records = store[objectName] || [];
            const idx = records.findIndex((r) => r.id === data.id);
            if (idx >= 0) {
                records[idx] = { ...records[idx], ...data };
                return records[idx];
            }
            return data;
        },
        delete: async () => ({ deleted: 1 }),
        count: async (objectName: string) => (store[objectName] || []).length,
        aggregate: async () => [],
        getSchema: (name: string) => registry[name],
        syncSchemas: async () => undefined,
        registerApp: (manifest: any) => {
            for (const obj of manifest?.objects ?? []) {
                if (obj?.name) registry[obj.name] = obj;
            }
        },
    };
    return { engine, store, registry };
}

/** A template package whose `deal` object gates INSERT to `prospecting`, with a
 *  seed that deliberately spans the whole pipeline (the marketplace reality). */
const PIPELINE_MANIFEST = {
    id: 'app.test.pipeline',
    name: 'Pipeline Test',
    version: '1.0.0',
    objects: [
        {
            name: 'deal',
            label: 'Deal',
            fields: {
                name: { type: 'text', label: 'Name', required: true },
                stage: {
                    type: 'select',
                    label: 'Stage',
                    options: [
                        { value: 'prospecting' },
                        { value: 'negotiation' },
                        { value: 'closed_won' },
                        { value: 'closed_lost' },
                    ],
                },
            },
            validations: [
                {
                    type: 'state_machine',
                    name: 'deal_stage_flow',
                    field: 'stage',
                    events: ['insert', 'update'],
                    initialStates: ['prospecting'],
                    transitions: {
                        prospecting: ['negotiation', 'closed_lost'],
                        negotiation: ['closed_won', 'closed_lost'],
                    },
                    message: 'Invalid deal stage.',
                },
            ],
        },
    ],
    data: [
        {
            object: 'deal',
            externalId: 'name',
            mode: 'upsert',
            records: [
                { name: 'Acme Renewal', stage: 'prospecting' }, // the entry state
                { name: 'Globex Expansion', stage: 'negotiation' }, // mid-lifecycle
                { name: 'Initech Migration', stage: 'closed_won' }, // terminal — the killer
                { name: 'Umbrella Deal', stage: 'closed_lost' }, // terminal
            ],
        },
    ],
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-fsm-exempt-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('marketplace install — state_machine initialStates exemption (#3433)', () => {
    it('lands every mid-lifecycle seed row (no initialStates rejection on the marketplace seam)', { timeout: 30_000 }, async () => {
        const { engine, store, registry } = makeEngine();
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, {
            manifest: { register: (m: any) => engine.registerApp(m) },
            auth: { api: { getSession: async () => ({ user: { id: 'admin' } }) } },
            objectql: engine,
            metadata: { getObject: vi.fn(async () => undefined), list: vi.fn(async () => []) },
        });
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(ctx as any);
        await fire();

        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(
            makeC({ manifest: PIPELINE_MANIFEST }),
        );

        expect(res.payload?.success).toBe(true);
        // The object registered (engine registry) and the guard is armed.
        expect(registry.deal?.validations?.[0]?.initialStates).toEqual(['prospecting']);

        // The inline seed ran and landed EVERY row — including the three that
        // start past the FSM entry point. Without the #3433 exemption the stub
        // would reject negotiation/closed_won/closed_lost and this is 1, errors > 0.
        expect(res.payload?.data?.seeded?.mode).toBe('inline');
        expect(res.payload?.data?.seeded?.errors).toBe(0);
        expect(store.deal).toHaveLength(4);
        expect(store.deal.map((r) => r.stage).sort()).toEqual([
            'closed_lost',
            'closed_won',
            'negotiation',
            'prospecting',
        ]);
    });
});
