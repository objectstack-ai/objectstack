// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0130 D4] `DELETE /api/v1/marketplace/install-local/:manifestId` of a
 * COMPOSED artifact uninstalls the unit its install was: every package body
 * the install registered, extending modules before the package they extend.
 *
 * ## The defect, read before the fix
 *
 * A composed artifact (one `type: app` package and `type: module` packages, a
 * module declaring `objectExtensions` on the app's objects) installs through
 * this door as ONE ledger entry, under the artifact's id, and registers every
 * body. Its uninstall asked the registry about the app alone, and the registry
 * refused (`409 RESOURCE_CONFLICT`, ADR-0029): the module extends an object the
 * app owns. The prescribed first step had no door: the module has no ledger
 * entry of its own (`404 RESOURCE_NOT_FOUND`), and the package door refuses a
 * read-only installed package (`422 WRITABLE_PACKAGE_REQUIRED`, asked through
 * `isWritablePackage`). Nothing could be removed.
 *
 * What this file pins, on a REAL engine and `manifest` service (an
 * `ObjectKernel` with `ObjectQLPlugin`):
 *
 *   - the reporter's three doors, as they answered; the module's own two still
 *     answer so after the fix, by design — the unit is uninstalled through its
 *     install entry;
 *   - the composed uninstall answers 200 and withdraws every member, the
 *     extending module first, whatever order the artifact lists its bodies in;
 *   - an extension from a DIFFERENT install still refuses the app's uninstall,
 *     with the registry's own `409` naming that package, and nothing moves;
 *   - a single-package install withdraws itself alone, as before.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The plugin reaches `@objectstack/runtime` through a lazy `import()`; its first
// load is paid here, at module top, never inside a clocked `it`.
import '@objectstack/runtime';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { isWritablePackage } from '@objectstack/metadata-protocol';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Bag = Record<string, any>;
type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
const APP = 'com.probe.suite';
const MODULE = 'com.probe.suite.carbon';
const OTHER_MODULE = 'com.probe.suite.reports';
const ADDON = 'com.probe.addon';
const OBJECT = 'probesuite_account';

const appBody = (): Bag => ({
    id: APP, name: 'probesuite', namespace: 'probesuite', version: '1.0.0', type: 'app',
    objects: [{ name: OBJECT, label: 'Account', fields: { name: { type: 'text' } } }],
});
const moduleBody = (): Bag => ({
    id: MODULE, name: 'probecarbon', namespace: 'probecarbon', version: '1.0.0', type: 'module',
    objectExtensions: [{ extend: OBJECT, fields: { carbon_score: { type: 'number' } } }],
});
/** A module of the same artifact that extends nothing. */
const otherModuleBody = (): Bag => ({
    id: OTHER_MODULE, name: 'probereports', namespace: 'probereports', version: '1.0.0', type: 'module',
});
/**
 * The composed artifact: the app's body, an extending module, a module that
 * extends nothing. `moduleFirst` lists the extending module ahead of the app,
 * so the artifact's own order cannot be what puts it first on the way out.
 */
const composed = (opts: { moduleFirst?: boolean } = {}): Bag => ({
    ...appBody(),
    packages: opts.moduleFirst
        ? [{ manifest: moduleBody() }, { manifest: appBody() }, { manifest: otherModuleBody() }]
        : [{ manifest: appBody() }, { manifest: moduleBody() }, { manifest: otherModuleBody() }],
});
/** A package of a DIFFERENT install extending the app's object. */
const addonBody = (): Bag => ({
    id: ADDON, name: 'probeaddon', namespace: 'probeaddon', version: '1.0.0', type: 'app',
    objectExtensions: [{ extend: OBJECT, fields: { addon_flag: { type: 'boolean' } } }],
});

let dir: string;
const kernels: ObjectKernel[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-composed-uninstall-')); });
afterEach(async () => {
    while (kernels.length) {
        const k = kernels.pop()!;
        if (k.getState() === 'running') await k.shutdown();
    }
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/** The plugin over a REAL engine and `manifest` service, booted to `kernel:ready`. */
async function bootPlugin() {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';
    const withdrawn: string[] = [];
    const uninstallPackage = ql.registry.uninstallPackage.bind(ql.registry);
    vi.spyOn(ql.registry, 'uninstallPackage').mockImplementation((id: string, options?: { keepBootSeed?: boolean }) => {
        withdrawn.push(id);
        return uninstallPackage(id, options);
    });
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const hooks = new Map<string, () => Promise<void>>();
    const services: Record<string, unknown> = {
        manifest: kernel.getService('manifest'),
        auth: installerAuthService(),
        objectql: withInstallerGrants({
            convertPackageBodyForward: (b: unknown) => ql.convertPackageBodyForward(b),
            registry: ql.registry,
            syncSchemas: async () => undefined,
        }),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const ctx = {
        hook: (e: string, h: () => Promise<void>) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        logger,
        trigger: async () => undefined,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    // Side readers that need services this harness does not carry; what is pinned is the registry and the ledger.
    const p = plugin as unknown as Record<string, unknown>;
    p.bindArtifactHandlers = async () => undefined;
    p.applySideEffects = async () => ({ seeded: { mode: 'none' } });
    p.maybeHealSampleData = async () => ({ seeded: { mode: 'none' } });
    await plugin.start(ctx as never);
    await hooks.get('kernel:ready')?.();
    const request = (manifestId?: string, body?: Bag) => {
        const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
        return {
            req: {
                url: `http://localhost:3000${ROUTE}${manifestId ? `/${manifestId}` : ''}`,
                raw: new Request('http://localhost:3000/x'),
                json: async () => body ?? {},
                param: (name: string) => (name === 'manifestId' ? manifestId : undefined),
            },
            json,
        };
    };
    const install = async (manifest: Bag) => routes.get(`POST ${ROUTE}`)!(request(undefined, { manifest }));
    const uninstall = async (manifestId: string) => routes.get(`DELETE ${ROUTE}/:manifestId`)!(request(manifestId));
    const ledgerIds = () => new LocalManifestSource(dir).list().entries.map((e) => e.manifestId).sort();
    const registered = (id: string) => ql.registry.getPackage(id) !== undefined;
    const extenders = () => ql.registry.getObjectContributors(OBJECT)
        .filter((c) => c.ownership === 'extend').map((c) => String(c.packageId)).sort();
    const warnings = () => logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
    return { ql, install, uninstall, ledgerIds, registered, extenders, withdrawn, warnings };
}

async function installComposed(opts: { moduleFirst?: boolean } = {}) {
    const booted = await bootPlugin();
    const installed = await booted.install(composed(opts));
    expect(installed.status, JSON.stringify(installed.payload)).toBe(200);
    // ONE install entry, under the artifact's id, for three registered bodies.
    expect(booted.ledgerIds()).toEqual([APP]);
    expect([APP, MODULE, OTHER_MODULE].map(booted.registered)).toEqual([true, true, true]);
    expect(booted.extenders()).toEqual([MODULE]);
    return booted;
}

describe('[ADR-0130 D4] an install-local uninstall of a composed artifact uninstalls the unit its install was', () => {
    it('the module\'s own doors: no install entry of its own (404) and read-only (422\'s predicate) — and nothing moved', async () => {
        const booted = await installComposed();

        const own = await booted.uninstall(MODULE);

        expect(own.status, JSON.stringify(own.payload)).toBe(404);
        expect(own.payload.error.code).toBe('RESOURCE_NOT_FOUND');
        // `DELETE /api/v1/packages/:id` answers `422 WRITABLE_PACKAGE_REQUIRED`
        // exactly when this predicate is false: the installed module is not a
        // writable base, so the package door is not its way out.
        expect(isWritablePackage(booted.ql, MODULE)).toBe(false);
        expect(booted.ledgerIds()).toEqual([APP]);
        expect([APP, MODULE, OTHER_MODULE].map(booted.registered)).toEqual([true, true, true]);
        expect(booted.withdrawn).toEqual([]);
    });

    it('DELETE of the install entry answers 200 and withdraws every member, the extending module before the app it extends', async () => {
        const booted = await installComposed();
        const warnedBefore = booted.warnings().length;

        const res = await booted.uninstall(APP);

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(booted.ledgerIds()).toEqual([]);
        expect([APP, MODULE, OTHER_MODULE].map(booted.registered)).toEqual([false, false, false]);
        expect(booted.withdrawn).toHaveLength(3);
        expect(booted.withdrawn.indexOf(MODULE)).toBeLessThan(booted.withdrawn.indexOf(APP));
        expect(booted.ql.registry.getObjectContributors(OBJECT)).toEqual([]);
        // Every withdrawal succeeded, so none is reported as a failed outcome.
        expect(res.payload.data.cleanups).toEqual([]);
        // The uninstall itself warns of nothing (the install's own warnings are not this test's).
        expect(booted.warnings().slice(warnedBefore)).toEqual([]);
    });

    it('the extending module goes first even when the artifact lists it ahead of the app', async () => {
        const booted = await installComposed({ moduleFirst: true });

        const res = await booted.uninstall(APP);

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect([APP, MODULE, OTHER_MODULE].map(booted.registered)).toEqual([false, false, false]);
        expect(booted.withdrawn.indexOf(MODULE)).toBeLessThan(booted.withdrawn.indexOf(APP));
    });

    it('a reinstall after the uninstall registers the unit again — the recovery the stuck uninstall blocked', async () => {
        const booted = await installComposed();
        expect((await booted.uninstall(APP)).status).toBe(200);

        const again = await booted.install(composed());

        expect(again.status, JSON.stringify(again.payload)).toBe(200);
        expect(booted.ledgerIds()).toEqual([APP]);
        expect([APP, MODULE, OTHER_MODULE].map(booted.registered)).toEqual([true, true, true]);
    });
});

describe('[ADR-0029] an extension from a DIFFERENT install still refuses the app\'s uninstall', () => {
    it('409 with the registry\'s refusal naming the other install\'s package; nothing of the unit moves', async () => {
        const booted = await installComposed();
        const addon = await booted.install(addonBody());
        expect(addon.status, JSON.stringify(addon.payload)).toBe(200);
        expect(booted.extenders()).toEqual([ADDON, MODULE]);

        const res = await booted.uninstall(APP);

        expect(res.status, JSON.stringify(res.payload)).toBe(409);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('RESOURCE_CONFLICT');
        expect(res.payload.error.message).toContain(ADDON);
        expect(booted.ledgerIds()).toEqual([ADDON, APP]);
        expect([APP, MODULE, OTHER_MODULE, ADDON].map(booted.registered)).toEqual([true, true, true, true]);
        expect(booted.extenders()).toEqual([ADDON, MODULE]);
        expect(booted.withdrawn).toEqual([]);
    });

    it('CONTROL: once the other install is uninstalled, the unit\'s uninstall goes through', async () => {
        const booted = await installComposed();
        expect((await booted.install(addonBody())).status).toBe(200);
        expect((await booted.uninstall(APP)).status).toBe(409);

        expect((await booted.uninstall(ADDON)).status).toBe(200);
        const res = await booted.uninstall(APP);

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(booted.ledgerIds()).toEqual([]);
        expect([APP, MODULE, OTHER_MODULE, ADDON].map(booted.registered)).toEqual([false, false, false, false]);
    });
});

describe('a single-package install withdraws itself alone, as before', () => {
    it('one body, one withdrawal; a package of another install stays', async () => {
        const booted = await bootPlugin();
        expect((await booted.install(appBody())).status).toBe(200);
        expect((await booted.install(otherModuleBody())).status).toBe(200);

        const res = await booted.uninstall(APP);

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(booted.withdrawn).toEqual([APP]);
        expect(booted.ledgerIds()).toEqual([OTHER_MODULE]);
        expect([APP, OTHER_MODULE].map(booted.registered)).toEqual([false, true]);
        expect(existsSync(join(dir, `${APP}.json`))).toBe(false);
    });

    it('extended by another install: the registry\'s 409, as before', async () => {
        const booted = await bootPlugin();
        expect((await booted.install(appBody())).status).toBe(200);
        expect((await booted.install(addonBody())).status).toBe(200);

        const res = await booted.uninstall(APP);

        expect(res.status, JSON.stringify(res.payload)).toBe(409);
        expect(res.payload.error.code).toBe('RESOURCE_CONFLICT');
        expect(res.payload.error.message).toContain(ADDON);
        expect(booted.withdrawn).toEqual([]);
        expect(booted.registered(APP)).toBe(true);
    });
});
