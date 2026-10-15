// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `metadata` service's copy of a RUNTIME-AUTHORED object follows the
 * registry after boot: re-saved, it says what the save said; created after
 * boot, it exists; deleted, it is gone and no longer listed.
 *
 * ## The defect
 *
 * On a kernel with no `environmentId`, `ObjectQLPlugin.start()` copies every
 * object the registry holds into the `metadata` service
 * (`bridgeObjectsToMetadataService`) and nothing writes to that service again:
 * a runtime save goes to `sys_metadata` and the registry, never the service.
 * So the service answered the boot body for a re-saved object, answered
 * NOTHING for an object created afterwards, and kept answering for a deleted
 * one. Every reader of `getObject` / `listObjects` inherits that. One of them
 * decides exposure: the MCP stdio door gates each data verb on the copy's
 * `enable.apiEnabled` and reads an absent copy as "no declaration". Its
 * door-level pin is `packages/qa/dogfood/test/mcp-stdio-runtime-object-exposure.test.ts`;
 * this file pins the producer's side of it, which every other reader shares.
 *
 * ## Why a real kernel, with `MetadataPlugin`
 *
 * The copy lives in the `metadata` service `MetadataPlugin` provides (a
 * `NodeMetadataManager`, `watch: false`), the boot half is `loadMetaFromDb`'s,
 * and the authoring half is the real protocol's `saveMetaItem` /
 * `deleteMetaItem`. A second kernel over the same store is the boot.
 *
 * ## The pins
 *
 *  - toggled off after boot, the copy says `apiEnabled: false` BEFORE the save
 *    returns (a refresh through `registerInMemory` is synchronous), and the
 *    listing agrees;
 *  - created after boot, the object has a copy at once;
 *  - deleted, the copy and its listing entry are gone, and a code package's
 *    copy is the very entry the bridge wrote;
 *  - deleted and created again while the removal is still awaiting the
 *    service, the new object keeps its copy;
 *  - CONTROL (green with the follow removed, by design): a code package's copy
 *    is left exactly as the bridge made it by runtime edits and by a delete
 *    naming the package's own object (which restores the baseline and removes
 *    nothing), and a runtime object that stays exposed keeps saying so.
 *
 * The negative control (red with the follow removed) is a one-time ablation,
 * cited in the PR, not a permanent case.
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `protocol-delete-boot-hydrated-object-heal.test.ts`; equality-only WHERE. */
function makeMemoryDriver(stores: Stores) {
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const rowVal = row[k];
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            const id = (data.id as string) ?? `r_${randomUUID()}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
        async dropTable(object: string) { stores.delete(object); },
    };
    return driver;
}

const NAME = 'qa_probe_gadget';
const OTHER = 'qa_probe_other';
const SHIPPED_PKG = 'com.qa.shipped';
const SHIPPED = 'qa_shipped_widget';

/** A runtime object body; `label` tells the writes apart, `enable` is the exposure under test. */
const objectBody = (name: string, label: string, enable?: Record<string, unknown>) => ({
    name,
    label,
    // [#8310] The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: {
        name: { name: 'name', type: 'text', label: 'Name' },
    },
    ...(enable ? { enable } : {}),
});

interface Booted {
    kernel: ObjectKernel;
    engine: ObjectQL;
    protocol: any;
    metadata: any;
}

describe('the metadata service\'s copy of a runtime-authored object follows the registry after boot', () => {
    const live: ObjectKernel[] = [];
    const roots: string[] = [];
    afterEach(async () => {
        while (live.length) {
            const kernel = live.pop()!;
            if (kernel.getState() === 'running') await kernel.shutdown();
        }
        while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
    });

    /**
     * One boot over `stores`: `MetadataPlugin` provides the `metadata` service
     * (an empty temp root, so it scans nothing), and `ObjectQLPlugin` with no
     * `environmentId` hydrates `sys_metadata` and runs the boot bridge.
     * `beforeBoot` registers what a code package ships, ahead of the bridge.
     */
    async function boot(stores: Stores, beforeBoot?: (engine: ObjectQL) => void): Promise<Booted> {
        // `logger.level` is the real config key, and gracefulShutdown:false keeps
        // process signal handlers out of vitest's fork workers (#4250).
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        live.push(kernel);
        const root = mkdtempSync(join(tmpdir(), 'os-23661-'));
        roots.push(root);
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores), true);
        await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        beforeBoot?.(engine);
        await kernel.bootstrap();
        return {
            kernel,
            engine,
            protocol: kernel.getService('protocol'),
            metadata: kernel.getService('metadata'),
        };
    }

    const save = (k: Booted, name: string, label: string, enable?: Record<string, unknown>) =>
        k.protocol.saveMetaItem({ type: 'object', name, item: objectBody(name, label, enable) });

    /** The copy as the service answers it, and the entry the listing carries for the name. */
    async function copyOf(k: Booted, name: string) {
        const listed = ((await k.metadata.listObjects()) as Array<{ name?: string }>).find((o) => o?.name === name);
        return { copy: await k.metadata.getObject(name), listed };
    }

    /** What a code package ships, registered ahead of the bridge. */
    const withShippedPackage = (engine: ObjectQL) => {
        engine.registerApp({
            id: SHIPPED_PKG, name: SHIPPED_PKG, version: '1.0.0', type: 'app',
            objects: [objectBody(SHIPPED, 'Shipped')],
        });
    };

    /** The object saved exposed, two boots ago: the second kernel hydrates it and the bridge copies it. */
    async function bootHydrated(stores: Stores, beforeBoot?: (engine: ObjectQL) => void): Promise<Booted> {
        const k1 = await boot(stores, beforeBoot);
        expect((await save(k1, NAME, 'Gadget', { apiEnabled: true })).success).toBe(true);
        expect((await save(k1, OTHER, 'Other', { apiEnabled: true })).success).toBe(true);
        await k1.kernel.shutdown();

        const k2 = await boot(stores, beforeBoot);
        // The defect's ingredient: the boot bridge's copy of the hydrated row.
        // Without it the pins below would pass for an empty reason.
        expect(await k2.metadata.getObject(NAME))
            .toMatchObject({ label: 'Gadget', enable: { apiEnabled: true }, _provenance: 'org' });
        expect(await k2.metadata.getObject(OTHER))
            .toMatchObject({ label: 'Other', enable: { apiEnabled: true }, _provenance: 'org' });
        return k2;
    }

    it('toggled off after boot: the copy says so before the save returns, and so does the listing', async () => {
        const stores: Stores = new Map();
        const k = await bootHydrated(stores);

        expect((await save(k, NAME, 'Gadget Q', { apiEnabled: false })).success).toBe(true);

        // No wait: the refresh is synchronous, so it landed before `save` resolved.
        const { copy, listed } = await copyOf(k, NAME);
        expect(copy).toMatchObject({ label: 'Gadget Q', enable: { apiEnabled: false }, _provenance: 'org' });
        expect(listed).toMatchObject({ label: 'Gadget Q', enable: { apiEnabled: false } });
        // …which is what the registry the data door dispatches on says.
        expect(k.engine.registry.getObject(NAME)).toMatchObject({ label: 'Gadget Q', enable: { apiEnabled: false } });
    });

    it('created after boot: the object has a copy at once, carrying its declaration (it had none)', async () => {
        const stores: Stores = new Map();
        const k = await boot(stores);
        expect(await k.metadata.getObject(NAME)).toBeUndefined();

        expect((await save(k, NAME, 'Gadget', { apiEnabled: false })).success).toBe(true);

        const { copy, listed } = await copyOf(k, NAME);
        expect(copy).toMatchObject({ label: 'Gadget', enable: { apiEnabled: false }, _provenance: 'org' });
        expect(listed).toBeDefined();
    });

    it('deleted: the copy is gone and the listing no longer names the object, and a code package\'s copy is the one it was', async () => {
        const stores: Stores = new Map();
        const k = await bootHydrated(stores, withShippedPackage);
        const shipped = await k.metadata.getObject(SHIPPED);
        expect(shipped).toMatchObject({ label: 'Shipped', _packageId: SHIPPED_PKG, _provenance: 'package' });

        const del = await k.protocol.deleteMetaItem({ type: 'object', name: NAME });

        expect(del).toMatchObject({ success: true, reset: true });
        expect(k.engine.registry.getObject(NAME)).toBeUndefined();
        // The removal awaits the service, so it settles after the delete answers.
        await vi.waitFor(async () => {
            const { copy, listed } = await copyOf(k, NAME);
            expect(copy).toBeUndefined();
            expect(listed).toBeUndefined();
        });
        // The very entry the bridge wrote: same object, not an equal one.
        expect(await k.metadata.getObject(SHIPPED)).toBe(shipped);
    });

    it('deleted, then created again while the removal is still awaiting the service: the new object keeps its copy', async () => {
        const stores: Stores = new Map();
        const k = await bootHydrated(stores);
        // Hold the removal where a loader round trip would: at the service's `unregister`.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const unregister = k.metadata.unregister.bind(k.metadata);
        const unregistered: string[] = [];
        k.metadata.unregister = async (...args: unknown[]) => {
            unregistered.push(String(args[1]));
            await gate;
            return unregister(...args);
        };

        expect((await k.protocol.deleteMetaItem({ type: 'object', name: NAME })).success).toBe(true);
        await vi.waitFor(() => expect(unregistered).toEqual([NAME]));
        expect((await save(k, NAME, 'Gadget Reborn', { apiEnabled: false })).success).toBe(true);
        // Released: the removal now drops the in-memory entry the re-creation just wrote.
        release();

        await vi.waitFor(async () => {
            expect((await copyOf(k, NAME)).copy)
                .toMatchObject({ label: 'Gadget Reborn', enable: { apiEnabled: false } });
        });
    });

    it('CONTROL: a code package\'s copy is left as the bridge made it, and a runtime object that stays exposed keeps saying so', async () => {
        const stores: Stores = new Map();
        const k = await bootHydrated(stores, withShippedPackage);
        const shipped = await k.metadata.getObject(SHIPPED);
        expect(shipped).toMatchObject({ label: 'Shipped', _packageId: SHIPPED_PKG, _provenance: 'package' });

        // Runtime edits, and a delete naming the package's own object (no stored
        // row: it restores the baseline and removes nothing).
        expect((await save(k, NAME, 'Gadget Q', { apiEnabled: false })).success).toBe(true);
        expect((await save(k, OTHER, 'Other Q', { apiEnabled: true })).success).toBe(true);
        expect(await k.protocol.deleteMetaItem({ type: 'object', name: SHIPPED }))
            .toMatchObject({ success: true, reset: false });
        // Nothing is expected to change, so there is no signal to wait for: a
        // bounded quiet period lets any change the follow would wrongly make land.
        await new Promise((resolve) => setTimeout(resolve, 150));

        // The very entry the bridge wrote: same object, not an equal one.
        expect(await k.metadata.getObject(SHIPPED)).toBe(shipped);
        expect(k.engine.registry.getObject(SHIPPED)).toMatchObject({ label: 'Shipped' });
        // The runtime object nobody turned off still says it is exposed.
        expect((await copyOf(k, OTHER)).copy).toMatchObject({ enable: { apiEnabled: true } });
    });
});

/**
 * The same copy on a kernel with an `environmentId` that hydrates its own
 * `sys_metadata`: `createStandaloneStack`'s composition (`os dev` as
 * `env_local`, `os serve`, `os start`) and the cloud single-environment
 * runtime. Its `metadata` service is sourced from the artifact and the boot
 * bridge does not run, so before the fix a runtime-authored object had NO copy
 * there, exposed or not, and both MCP exposure gates served one saved with
 * `apiEnabled: false` (measured through the real `os dev`).
 */
describe('on a kernel with an environmentId, a runtime-authored object has a copy that follows the registry', () => {
    const ENV = 'env_local';
    const live: ObjectKernel[] = [];
    const roots: string[] = [];
    afterEach(async () => {
        while (live.length) {
            const kernel = live.pop()!;
            if (kernel.getState() === 'running') await kernel.shutdown();
        }
        while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
    });

    /**
     * One boot over `stores`, with `createStandaloneStack`'s two options:
     * `MetadataPlugin` reading an (empty) artifact under the environment, and
     * `ObjectQLPlugin` with the `environmentId` and `hydrateMetadataFromDb`.
     */
    async function boot(stores: Stores, beforeBoot?: (engine: ObjectQL) => void): Promise<Booted> {
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        live.push(kernel);
        const root = mkdtempSync(join(tmpdir(), 'os-23689-'));
        roots.push(root);
        const artifact = join(root, 'objectstack.json');
        writeFileSync(artifact, JSON.stringify({
            manifest: { id: 'com.qa.empty', name: 'empty', version: '0.0.0', type: 'app' },
            objects: [], views: [], apps: [], flows: [], requires: [],
        }));
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores), true);
        await kernel.use(new MetadataPlugin({
            watch: false, artifactWatch: false, environmentId: ENV,
            artifactSource: { mode: 'local-file', path: artifact }, rootDir: root,
        }));
        await kernel.use(new ObjectQLPlugin({ ql: engine, environmentId: ENV, hydrateMetadataFromDb: true }));
        beforeBoot?.(engine);
        await kernel.bootstrap();
        return { kernel, engine, protocol: kernel.getService('protocol'), metadata: kernel.getService('metadata') };
    }

    const save = (k: Booted, name: string, label: string, enable?: Record<string, unknown>) =>
        k.protocol.saveMetaItem({ type: 'object', name, item: objectBody(name, label, enable) });

    async function copyOf(k: Booted, name: string) {
        const listed = ((await k.metadata.listObjects()) as Array<{ name?: string }>).find((o) => o?.name === name);
        return { copy: await k.metadata.getObject(name), listed };
    }

    const withShippedPackage = (engine: ObjectQL) => {
        engine.registerApp({
            id: SHIPPED_PKG, name: SHIPPED_PKG, version: '1.0.0', type: 'app',
            objects: [objectBody(SHIPPED, 'Shipped')],
        });
    };

    it('created after boot with exposure off: a copy at once, carrying its declaration', async () => {
        const k = await boot(new Map());
        expect((await save(k, NAME, 'Gadget', { apiEnabled: false })).success).toBe(true);

        const { copy, listed } = await copyOf(k, NAME);
        expect(copy).toMatchObject({ label: 'Gadget', enable: { apiEnabled: false }, _provenance: 'org' });
        expect(listed).toBeDefined();
    });

    it('saved exposed, then turned off: the copy says so before the save returns', async () => {
        const k = await boot(new Map());
        expect((await save(k, NAME, 'Gadget', { apiEnabled: true })).success).toBe(true);
        expect((await save(k, NAME, 'Gadget Q', { apiEnabled: false })).success).toBe(true);

        expect((await copyOf(k, NAME)).copy)
            .toMatchObject({ label: 'Gadget Q', enable: { apiEnabled: false }, _provenance: 'org' });
    });

    it('saved with exposure off, then a restart: the boot gives the hydrated object its copy (no mutation fires for it)', async () => {
        const stores: Stores = new Map();
        const k1 = await boot(stores);
        expect((await save(k1, NAME, 'Gadget', { apiEnabled: false })).success).toBe(true);
        expect((await save(k1, OTHER, 'Other', { apiEnabled: true })).success).toBe(true);
        await k1.kernel.shutdown();

        const k2 = await boot(stores);
        expect(k2.engine.registry.getObject(NAME)).toMatchObject({ enable: { apiEnabled: false } });
        expect((await copyOf(k2, NAME)).copy)
            .toMatchObject({ label: 'Gadget', enable: { apiEnabled: false }, _provenance: 'org' });
        expect((await copyOf(k2, OTHER)).copy).toMatchObject({ enable: { apiEnabled: true } });
    });

    it('deleted: the copy is gone and the listing no longer names it', async () => {
        const stores: Stores = new Map();
        const k1 = await boot(stores);
        expect((await save(k1, NAME, 'Gadget', { apiEnabled: true })).success).toBe(true);
        await k1.kernel.shutdown();
        const k = await boot(stores);
        expect((await copyOf(k, NAME)).copy).toBeDefined();

        expect(await k.protocol.deleteMetaItem({ type: 'object', name: NAME })).toMatchObject({ success: true, reset: true });

        await vi.waitFor(async () => {
            const { copy, listed } = await copyOf(k, NAME);
            expect(copy).toBeUndefined();
            expect(listed).toBeUndefined();
        });
    });

    it('CONTROL: a code package\'s object gets no copy from the boot pass or from a runtime edit beside it', async () => {
        const stores: Stores = new Map();
        const k1 = await boot(stores, withShippedPackage);
        expect((await save(k1, NAME, 'Gadget', { apiEnabled: true })).success).toBe(true);
        await k1.kernel.shutdown();

        const k = await boot(stores, withShippedPackage);
        expect(k.engine.registry.getObject(SHIPPED)).toMatchObject({ label: 'Shipped' });
        // The code package's objects reach this service from the artifact, never from this pass.
        expect(await k.metadata.getObject(SHIPPED)).toBeUndefined();
        expect((await save(k, NAME, 'Gadget Q', { apiEnabled: false })).success).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(await k.metadata.getObject(SHIPPED)).toBeUndefined();
        expect((await copyOf(k, NAME)).copy).toMatchObject({ enable: { apiEnabled: false } });
    });
});
