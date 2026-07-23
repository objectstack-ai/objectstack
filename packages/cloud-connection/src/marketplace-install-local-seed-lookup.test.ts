// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Marketplace install MUST resolve seed lookup/master_detail natural keys
 * into target record ids.
 *
 * The bug this pins: marketplace package objects are registered through the
 * `manifest` service straight into the ObjectQL registry — AFTER the boot-time
 * `bridgeObjectsToMetadataService` pass — so the metadata service never lists
 * them. The SeedLoaderService built its reference graph from the metadata
 * service only, saw no lookup/master_detail fields for crm_*, and wrote every
 * reference value verbatim: `crm_contact.crm_account = 'Acme Corporation'`
 * instead of the crm_account row's id. With `sharingModel:
 * controlled_by_parent` the dangling parent join then hid EVERY contact from
 * EVERY user (REST list total=0, single GET 404) while the rows sat in the DB.
 *
 * Unlike marketplace-install-local-reseed.test.ts, this test does NOT mock
 * @objectstack/runtime — the real SeedLoaderService runs against a faithful
 * engine stub whose `getSchema` serves exactly what `manifest.register`
 * (ql.registerApp) put into the engine registry, and a metadata service that
 * has never heard of the package's objects (the marketplace reality).
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

function makeC(body: any, manifestId?: string) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: (k: string) => (k === 'manifestId' ? manifestId : undefined),
            header: () => undefined,
        },
        json,
    };
}

/** Engine stub faithful where it matters: find() filters `where`, insert()
 *  assigns ids, and `getSchema` reads the registry that `manifest.register`
 *  fills — the exact surface the real ObjectQL engine gives the seed loader. */
function makeEngine() {
    const store: Record<string, any[]> = {};
    const registry: Record<string, any> = {};
    let idCounter = 0;
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
        insert: async (objectName: string, data: any) => {
            if (!store[objectName]) store[objectName] = [];
            if (Array.isArray(data)) {
                const records = data.map((d) => ({ id: `row-${++idCounter}`, ...d }));
                store[objectName].push(...records);
                return records;
            }
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

/** Trimmed from the shipped app.objectstack.hotcrm@2.2.2 artifact: the
 *  master_detail child under controlled_by_parent whose install corrupted. */
const HOTCRM_MANIFEST = {
    id: 'app.test.hotcrm',
    name: 'HotCRM Test',
    version: '9.9.9',
    objects: [
        {
            name: 'crm_account',
            label: 'Account',
            fields: {
                name: { type: 'text', label: 'Name', required: true },
                industry: { type: 'text', label: 'Industry' },
            },
        },
        {
            name: 'crm_contact',
            label: 'Contact',
            sharingModel: 'controlled_by_parent',
            fields: {
                last_name: { type: 'text', label: 'Last Name', required: true },
                email: { type: 'text', label: 'Email' },
                crm_account: { type: 'master_detail', label: 'Account', reference: 'crm_account', required: true },
            },
        },
        {
            name: 'crm_opportunity',
            label: 'Opportunity',
            fields: {
                name: { type: 'text', label: 'Name', required: true },
                crm_account: { type: 'lookup', label: 'Account', reference: 'crm_account', required: true },
            },
        },
    ],
    data: [
        {
            object: 'crm_account',
            externalId: 'name',
            mode: 'upsert',
            records: [
                { name: 'Acme Corporation', industry: 'technology' },
                { name: 'Globex Inc', industry: 'manufacturing' },
            ],
        },
        {
            object: 'crm_contact',
            externalId: 'email',
            mode: 'upsert',
            records: [
                { last_name: 'Smith', email: 'john.smith@acme.example.com', crm_account: 'Acme Corporation' },
                { last_name: 'Lee', email: 'maria.lee@globex.example.com', crm_account: 'Globex Inc' },
            ],
        },
        {
            object: 'crm_opportunity',
            externalId: 'name',
            mode: 'upsert',
            records: [{ name: 'Acme Expansion', crm_account: 'Acme Corporation' }],
        },
    ],
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-seed-lookup-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('marketplace install — seed lookup resolution', () => {
    it('writes target record ids (never raw externalId strings) for package objects unknown to the metadata service', async () => {
        const { engine, store, registry } = makeEngine();
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, {
            // The real wiring: manifest.register → ql.registerApp → engine
            // registry ONLY. Nothing reaches the metadata service.
            manifest: { register: (m: any) => engine.registerApp(m) },
            auth: { api: { getSession: async () => ({ user: { id: 'admin' } }) } },
            objectql: engine,
            metadata: { getObject: vi.fn(async () => undefined), list: vi.fn(async () => []) },
        });
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(ctx as any);
        await fire();

        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(
            makeC({ manifest: HOTCRM_MANIFEST }),
        );
        expect(res.payload?.success).toBe(true);
        // Objects really did register only into the engine registry.
        expect(registry.crm_contact).toBeDefined();

        // The inline seed ran and landed every row.
        expect(res.payload?.data?.seeded?.mode).toBe('inline');
        expect(res.payload?.data?.seeded?.errors).toBe(0);
        expect(store.crm_account).toHaveLength(2);
        expect(store.crm_contact).toHaveLength(2);
        expect(store.crm_opportunity).toHaveLength(1);

        // THE regression: reference columns must hold the parent row's id.
        const acme = store.crm_account.find((r) => r.name === 'Acme Corporation')!;
        const globex = store.crm_account.find((r) => r.name === 'Globex Inc')!;
        const john = store.crm_contact.find((r) => r.email === 'john.smith@acme.example.com')!;
        const maria = store.crm_contact.find((r) => r.email === 'maria.lee@globex.example.com')!;
        const opp = store.crm_opportunity[0];

        expect(john.crm_account).toBe(acme.id);
        expect(maria.crm_account).toBe(globex.id);
        expect(opp.crm_account).toBe(acme.id);

        // Belt and braces: no reference column anywhere still carries the
        // authored natural-key string.
        for (const row of [...store.crm_contact, ...store.crm_opportunity]) {
            expect(String(row.crm_account)).not.toMatch(/Acme Corporation|Globex Inc/);
        }
    });
});
