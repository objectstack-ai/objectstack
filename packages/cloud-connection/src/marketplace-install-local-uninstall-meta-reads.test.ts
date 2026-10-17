// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24070 — after `DELETE /api/v1/marketplace/install-local/:manifestId` the
 * package's objects leave the `meta` reads at once, as its data route and its
 * `meta/app` / `meta/permission` listings already did.
 *
 * ## The defect, measured
 *
 * An install-local package reaches the running kernel through the `manifest`
 * service's `register`, and that one call does two things: `registerApp` puts
 * the package in the `SchemaRegistry`, and — the kernel being started — the
 * ObjectQL plugin bridges each of the package's objects into the `metadata`
 * service as a copy stamped with the package's id (`_packageId`). The DELETE
 * withdrew only the first half (`SchemaRegistry.uninstallPackage`, #21576).
 * The metadata protocol's `GET /meta/object` merges the metadata service's
 * listing into its answer and `GET /meta/object/NAME` reads that service
 * before the registry, so both kept serving every object of the uninstalled
 * package — with its `_packageId` — until a restart, while
 * `GET /data/OBJECT` already answered 404. `meta/app` and `meta/permission`
 * were right: nothing copies those types into the service.
 *
 * ## What this file pins
 *
 * The engine, its `manifest` service, the metadata protocol and the `metadata`
 * service are REAL (an `ObjectKernel` with `ObjectQLPlugin` and the kernel's
 * in-memory metadata service): a stubbed registry cannot bridge, and a stubbed
 * service cannot keep a copy, so neither could show the defect.
 *
 *   - both orders of events — a hot install, and a ledger entry the boot
 *     rehydrated — then the DELETE: the object listing and the by-name read no
 *     longer serve the package's objects, and every other type the package
 *     shipped (`app`, `permission`) is gone from its listing too, with no
 *     restart and no failed outcome on the response;
 *   - CONTROL: a same-name copy the package never bridged (one without its
 *     stamp) is not the uninstall's to remove, and stays;
 *   - a copy the service refuses to withdraw is reported on the response as a
 *     failed outcome, the way a refused registry withdrawal is, and the
 *     uninstall cleanups still run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The plugin reaches `@objectstack/runtime` through a lazy `import()`; its first
// load is paid here, at module top, never inside a clocked `it`.
import '@objectstack/runtime';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import type { IMetadataService } from '@objectstack/spec/contracts';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { INSTALLER_USER_ID, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Bag = Record<string, any>;
type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
const APP_ID = 'com.example.crmlite';
const OBJECTS = ['crmlite_account', 'crmlite_contact'];
const APP = 'crmlite_app';
const PERMISSION_SET = 'crmlite_user';

/** A package shipping two objects, an app and a permission set — the three types the card names. */
const MANIFEST: Bag = {
    id: APP_ID,
    namespace: 'crmlite',
    version: '1.0.0',
    type: 'app',
    name: 'CRM Lite',
    objects: OBJECTS.map((name) => ({
        name,
        label: name,
        fields: { name: { type: 'text', label: 'Name' } },
    })),
    apps: [{ name: APP, label: 'CRM Lite', navigation: [] }],
    permissions: [{
        name: PERMISSION_SET,
        label: 'CRM Lite User',
        objects: { crmlite_account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
    }],
};

/** A driver holding no row of anything — the stored-row layer, empty. */
const EMPTY_STORE = {
    name: 'empty-store',
    version: '0.0.0',
    supports: {},
    connect: async () => undefined,
    disconnect: async () => undefined,
    find: async () => [],
    findOne: async () => null,
    count: async () => 0,
};

let dir: string;
const kernels: ObjectKernel[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-meta-reads-')); });
afterEach(async () => {
    while (kernels.length) {
        const k = kernels.pop()!;
        if (k.getState() === 'running') await k.shutdown();
    }
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

function seedLedger(): void {
    new LocalManifestSource(dir).write({
        packageId: APP_ID,
        versionId: 'local',
        manifestId: APP_ID,
        version: MANIFEST.version,
        manifest: MANIFEST,
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: INSTALLER_USER_ID,
        withSampleData: false,
    });
}

function makeC(url: string, opts: { body?: unknown; manifestId?: string } = {}) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url,
            raw: new Request(url),
            json: async () => opts.body ?? {},
            param: (name: string) => (name === 'manifestId' ? opts.manifestId : undefined),
        },
        json,
    };
}

/**
 * The plugin over a REAL kernel's engine, `manifest` service, metadata protocol
 * and `metadata` service, booted to `kernel:ready` (which runs the rehydrate).
 * `refuseUnregister` makes the metadata service refuse to withdraw a copy.
 */
async function bootPlugin(opts: { refuseUnregister?: string; before?: (metadata: IMetadataService) => Promise<void> } = {}) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';
    // The protocol's reads consult the stored rows (`sys_metadata`) besides the
    // registry and the metadata service. An install-local install writes no
    // such row — it registers in memory and keeps its ledger on disk — so the
    // store holds none here, and every answer below comes from the two
    // in-memory layers.
    ql.registerDriver(EMPTY_STORE as never, true);
    const protocol = kernel.getService<any>('protocol');
    const metadata = kernel.getService<IMetadataService>('metadata');
    if (opts.refuseUnregister !== undefined) {
        const reason = opts.refuseUnregister;
        metadata.unregister = async () => { throw new Error(reason); };
    }
    await opts.before?.(metadata);

    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const hooks = new Map<string, () => Promise<void>>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const services: Record<string, unknown> = {
        manifest: kernel.getService('manifest'),
        protocol,
        metadata,
        auth: installerAuthService(),
        // The engine's own door, bound to the real engine; the rest of the
        // surface this plugin reads off `objectql` is the registry's.
        objectql: withInstallerGrants({
            convertPackageBodyForward: (body: unknown) => ql.convertPackageBodyForward(body),
            registry: ql.registry,
            syncSchemas: async () => undefined,
        }),
    };
    const ctx = {
        hook: (e: string, h: () => Promise<void>) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as never);
    await hooks.get('kernel:ready')?.();

    const install = (manifest: Bag = MANIFEST) => routes.get(`POST ${ROUTE}`)!(makeC(`http://localhost:3000${ROUTE}`, { body: { manifest } }));
    const uninstall = (id: string = APP_ID) => routes.get(`DELETE ${ROUTE}/:manifestId`)!(
        makeC(`http://localhost:3000${ROUTE}/${id}`, { manifestId: id }),
    );
    /** The uninstall's own warnings: each one opens with `uninstalled <id>`. */
    const warnings = () => logger.warn.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .filter((line) => line.includes(`uninstalled ${APP_ID}`));
    /** The metadata service's copy of an object — what the object reads serve besides the registry. */
    const copyOf = async (name: string) => (await metadata.getObject(name)) as Bag | undefined;
    return { install, uninstall, protocol, copyOf, ql, warnings };
}

/** The names a `GET /meta/:type` listing serves for `type`, read through the protocol the route calls. */
async function listed(protocol: any, type: string): Promise<string[]> {
    const res = await protocol.getMetaItems({ type });
    const items: any[] = Array.isArray(res) ? res : res?.items ?? [];
    return items.map((it) => it?.name).filter((n): n is string => typeof n === 'string');
}

/** What `GET /meta/object/NAME` answers: the served item's name, or the refusal's status. */
async function byName(protocol: any, name: string): Promise<{ served?: string; status?: number }> {
    try {
        const res = await protocol.getMetaItem({ type: 'object', name });
        const item = res?.item;
        return item === undefined || item === null ? { status: 404 } : { served: item.name };
    } catch (err: any) {
        return { status: err?.status ?? err?.statusCode ?? 500 };
    }
}

/** Every `meta` read this file pins, at one moment. */
async function readMeta(protocol: any) {
    const objects = await listed(protocol, 'object');
    return {
        objects: OBJECTS.filter((n) => objects.includes(n)),
        byName: await Promise.all(OBJECTS.map((n) => byName(protocol, n))),
        apps: (await listed(protocol, 'app')).filter((n) => n === APP),
        permissions: (await listed(protocol, 'permission')).filter((n) => n === PERMISSION_SET),
    };
}

const SERVED = {
    objects: OBJECTS,
    byName: OBJECTS.map((n) => ({ served: n })),
    apps: [APP],
    permissions: [PERMISSION_SET],
};
const WITHDRAWN = {
    objects: [],
    byName: OBJECTS.map(() => ({ status: 404 })),
    apps: [],
    permissions: [],
};

describe('#24070: an install-local uninstall withdraws the package from every meta read at once', () => {
    it('hot install → DELETE: no meta read serves the package\'s objects, app or permission set any more', async () => {
        const h = await bootPlugin();
        const installed = await h.install();
        expect(installed.status, JSON.stringify(installed.payload)).toBe(200);
        expect(installed.payload.data.hotLoaded).toBe(true);
        // Identity: the install's register bridged the objects into the
        // metadata service as the package's own copies — the store the
        // object reads consult besides the registry.
        for (const name of OBJECTS) expect((await h.copyOf(name))?._packageId).toBe(APP_ID);
        expect(await readMeta(h.protocol)).toEqual(SERVED);

        const res = await h.uninstall();

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        // Nothing failed: no withdrawal outcome rides on the response.
        expect(res.payload.data.cleanups).toEqual([]);
        expect(await readMeta(h.protocol)).toEqual(WITHDRAWN);
        for (const name of OBJECTS) expect(await h.copyOf(name)).toBeUndefined();
        expect(h.warnings()).toEqual([]);
    });

    it('install → restart (the ledger rehydrate) → DELETE: the same, for a package the boot registered', async () => {
        seedLedger();
        const h = await bootPlugin();
        for (const name of OBJECTS) expect((await h.copyOf(name))?._packageId).toBe(APP_ID);
        expect(await readMeta(h.protocol)).toEqual(SERVED);

        const res = await h.uninstall();

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.cleanups).toEqual([]);
        expect(await readMeta(h.protocol)).toEqual(WITHDRAWN);
        expect(h.warnings()).toEqual([]);
    });

    it('CONTROL — a same-name copy the package did not bridge is not the uninstall\'s to remove', async () => {
        const authored = { name: OBJECTS[0], label: 'Authored, not the package\'s' };
        const h = await bootPlugin({
            before: async (metadata) => { await metadata.register('object', OBJECTS[0], authored); },
        });
        const installed = await h.install();
        expect(installed.status, JSON.stringify(installed.payload)).toBe(200);
        // The bridge left the copy it did not make alone; it bridged the other.
        expect(await h.copyOf(OBJECTS[0])).toEqual(authored);
        expect((await h.copyOf(OBJECTS[1]))?._packageId).toBe(APP_ID);

        const res = await h.uninstall();

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.cleanups).toEqual([]);
        expect(await h.copyOf(OBJECTS[0])).toEqual(authored);
        expect(await h.copyOf(OBJECTS[1])).toBeUndefined();
    });

    it('a copy the metadata service refuses to withdraw is a failed outcome on the response, and the cleanups still run', async () => {
        const h = await bootPlugin({ refuseUnregister: 'metadata store is read-only' });
        const runCleanups = vi.spyOn(h.protocol, 'runUninstallCleanups');
        const installed = await h.install();
        expect(installed.status, JSON.stringify(installed.payload)).toBe(200);

        const res = await h.uninstall();

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(res.payload.data.cleanups).toEqual([{
            name: 'metadata.unregister',
            success: false,
            removed: 0,
            error: expect.any(String),
        }]);
        // The cause goes to the operator log, never onto the wire.
        expect(JSON.stringify(res.payload)).not.toContain('read-only');
        expect(runCleanups).toHaveBeenCalledTimes(1);
        // The registry half still withdrew: the copies are what remains.
        expect(h.ql.registry.getPackage(APP_ID)).toBeUndefined();
        const warned = h.warnings();
        expect(warned).toHaveLength(1);
        expect(warned[0]).toContain('metadata store is read-only');
        expect(warned[0]).toContain(OBJECTS[0]);
    });
});

/** [#24182] A package whose only content is a field on another package's object. */
const EXTENDER_ID = 'com.example.crmliteext';
const EXTENDER: Bag = {
    id: EXTENDER_ID,
    version: '1.0.0',
    type: 'app',
    name: 'CRM Lite Score',
    objectExtensions: [{ extend: OBJECTS[0], fields: { ext_score: { type: 'number', label: 'Score' } } }],
};

/** The field names `GET /meta/object/NAME` serves for `name`, read through the protocol the route calls. */
async function servedFields(protocol: any, name: string): Promise<string[]> {
    const res = await protocol.getMetaItem({ type: 'object', name });
    return Object.keys(res?.item?.fields ?? {});
}

describe('#24182: an install-local uninstall of an extender restores the owner\'s object at the by-name read', () => {
    it('owner + extender installed → DELETE the extender: the by-name read serves the owner\'s body without the field', async () => {
        const h = await bootPlugin();
        expect((await h.install()).status).toBe(200);
        const extended = await h.install(EXTENDER);
        expect(extended.status, JSON.stringify(extended.payload)).toBe(200);
        // Identity: the extender's bridge rewrote the OWNER's copy, which the
        // by-name read serves before the registry.
        expect((await h.copyOf(OBJECTS[0]))?._packageId).toBe(APP_ID);
        expect(await servedFields(h.protocol, OBJECTS[0])).toEqual(expect.arrayContaining(['name', 'ext_score']));

        const res = await h.uninstall(EXTENDER_ID);

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.cleanups).toEqual([]);
        const fields = await servedFields(h.protocol, OBJECTS[0]);
        expect(fields).not.toContain('ext_score');
        expect(fields).toEqual(Object.keys(h.ql.registry.getObject(OBJECTS[0])!.fields ?? {}));
        // CONTROL: the owner's own field, its copy's stamp and its package stay.
        expect(fields).toContain('name');
        expect((await h.copyOf(OBJECTS[0]))?._packageId).toBe(APP_ID);
        expect(await listed(h.protocol, 'object')).toEqual(expect.arrayContaining(OBJECTS));
    });
});
