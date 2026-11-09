// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D2 / D3] install-local of a base's PAIRED CUSTOMIZATION PACKAGE
 * (`<base>.custom`, what `GET /packages/<base>.custom/export` writes), at the
 * plugin's own route, mounted through `start()` + `kernel:ready`.
 *
 * Registered as code, a pair served none of its overrides, listed none of
 * them and left the pair read-only, while the install answered success.
 * Pinned:
 *  - the items are written into the target's own pair: the ensure door, then
 *    one `saveMetaItem` per item in load order (`mode: 'publish'`, the pair as
 *    package, the installer as actor); nothing is registered, synced or
 *    ledgered, and the answer names the pair and every item written;
 *  - a save the door refuses answers failure with the save's own code and
 *    status, naming the item: a pair the install created is deleted again; a
 *    pair that existed is kept, and the answer lists written / not written;
 *  - a pair already read-only here — ledgered as code by an earlier install,
 *    withdrawn but still registered until a restart, or provided by code — is
 *    refused 409 before the ensure door is asked, each naming its way back;
 *  - the ensure door's refusal is relayed; a body with no item form, a pair
 *    manifest the ensure door would not write, a pair inside a multi-package
 *    artifact, and a runtime without the doors are refused before any write.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from '@objectstack/spec/kernel';
// The runtime binder the door's step 1d loads lazily — paid here, at module
// top, never inside a clocked `it` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

const ROUTE = '/api/v1/marketplace/install-local';
const INSTALLER = 'usr_installer';
const BASE = 'com.example.showcase';
const PAIR = `${BASE}.custom`;
const OVERRIDES = { package: BASE, basedOn: '0.1.0' };

type Handler = (c: any) => Promise<any>;

function makeC(body: any, id?: string) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    const url = `http://localhost:3000${ROUTE}${id ? `/${id}` : ''}`;
    return {
        req: { url, raw: new Request(url), json: async () => body, param: (n: string) => (n === 'id' ? id : undefined) },
        json,
    };
}

/** What `GET /packages/com.example.showcase.custom/export` wrote: flat, as `os package install <file>` sends it. */
function exportedPair(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        dashboards: [{ name: 'showcase_chart_gallery', label: 'Gallery (ours)', overrides: OVERRIDES }],
        viewItems: [{ name: 'showcase_task.in_progress', label: 'In progress (ours)', overrides: OVERRIDES }],
        id: PAIR,
        name: 'ObjectStack Showcase (custom)',
        version: '0.1.0',
        namespace: 'showcase_custom',
        dependencies: { [BASE]: '^0' },
        ...extra,
    };
}

interface MountOptions {
    /** `ensureCustomizationPackage`'s answer, or a throw. */
    ensure?: (request: any) => Promise<any>;
    /** `saveMetaItem`, per call. */
    save?: (request: any) => Promise<any>;
    /** Booted code packages — `engine.manifests`. */
    codePackages?: string[];
    /** Registered packages beside the base. */
    packages?: Record<string, { manifest: Record<string, unknown> }>;
    /** Leave the protocol without its pair doors. */
    noDoors?: boolean;
    /** A ledger entry written before boot, so `kernel:ready` rehydrates it. */
    ledgered?: Record<string, unknown>;
}

async function mount(dir: string, opts: MountOptions = {}) {
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    if (opts.ledgered) {
        new LocalManifestSource(dir).write({
            packageId: PAIR, versionId: 'local', manifestId: PAIR, version: '0.1.0',
            manifest: opts.ledgered, installedAt: new Date(0).toISOString(), installedBy: INSTALLER,
        });
    }
    const hooks = new Map<string, any>();
    const register = vi.fn(async () => undefined);
    const syncSchemas = vi.fn(async () => undefined);
    const ensureCustomizationPackage = vi.fn(opts.ensure ?? (async () => ({
        basePackageId: BASE, packageId: PAIR, namespace: 'showcase_custom', dependencyRange: '^0', created: true, writable: true,
    })));
    const saveMetaItem = vi.fn(opts.save ?? (async (request: any) => ({ success: true, type: request.type, name: request.name })));
    const deletePackage = vi.fn(async () => ({ success: true, deletedCount: 2, failedCount: 0 }));
    const packages: Record<string, { manifest: Record<string, unknown> }> = {
        [BASE]: { manifest: { id: BASE, namespace: 'showcase', version: '0.1.0', name: 'Showcase' } },
        ...(opts.packages ?? {}),
    };
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(INSTALLER),
        objectql: withInstallerGrants({
            syncSchemas,
            manifests: new Map((opts.codePackages ?? []).map((id) => [id, { id }])),
            registry: {
                getAllPackages: () => [],
                getNamespaceOwners: () => [],
                getPackage: (id: string) => packages[id],
            },
        }, INSTALLER),
        protocol: opts.noDoors ? {} : { ensureCustomizationPackage, saveMetaItem, deletePackage },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    register.mockClear();
    syncSchemas.mockClear();
    return {
        install: (manifest: unknown) => routes.get(`POST ${ROUTE}`)!(makeC({ manifest })),
        register,
        syncSchemas,
        ensureCustomizationPackage,
        saveMetaItem,
        deletePackage,
        logger,
        ledgerHas: (id: string) => new LocalManifestSource(dir).read(id).entry !== null,
    };
}

let dir: string;
let savedPosture: string | undefined;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-customization-pair-'));
    savedPosture = process.env.OS_TENANCY_POSTURE;
    delete process.env.OS_TENANCY_POSTURE;
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = savedPosture;
    vi.restoreAllMocks();
});

/** Nothing was registered, synced or ledgered as code. */
function expectNoCodeInstall(h: Awaited<ReturnType<typeof mount>>) {
    expect(h.register).not.toHaveBeenCalled();
    expect(h.syncSchemas).not.toHaveBeenCalled();
    expect(h.ledgerHas(PAIR)).toBe(false);
}

describe('install-local — a paired customization package is installed into the writable pair', () => {
    it('writes every item through the save door into the ensured pair, and registers nothing as code', async () => {
        const h = await mount(dir);
        const res = await h.install(exportedPair());
        expect(res.status).toBe(200);
        expect(h.ensureCustomizationPackage).toHaveBeenCalledWith({ basePackageId: BASE });
        expect(h.saveMetaItem.mock.calls.map(([r]: any[]) => r)).toEqual([
            {
                type: 'view', name: 'showcase_task.in_progress', mode: 'publish', packageId: PAIR, actor: INSTALLER,
                item: { name: 'showcase_task.in_progress', label: 'In progress (ours)', overrides: OVERRIDES },
            },
            {
                type: 'dashboard', name: 'showcase_chart_gallery', mode: 'publish', packageId: PAIR, actor: INSTALLER,
                item: { name: 'showcase_chart_gallery', label: 'Gallery (ours)', overrides: OVERRIDES },
            },
        ]);
        expect(res.payload.data).toMatchObject({
            manifestId: PAIR,
            version: '0.1.0',
            customizationPair: { basePackageId: BASE, packageId: PAIR, created: true, writable: true },
            writtenCount: 2,
            written: [{ type: 'view', name: 'showcase_task.in_progress' }, { type: 'dashboard', name: 'showcase_chart_gallery' }],
        });
        expect(res.payload.data).not.toHaveProperty('hotLoaded');
        expect(res.payload.data).not.toHaveProperty('seeded');
        expectNoCodeInstall(h);
        expect(h.deletePackage).not.toHaveBeenCalled();
    });

    it('writes into a pair that already exists, and says it was not created', async () => {
        const h = await mount(dir, {
            ensure: async () => ({ basePackageId: BASE, packageId: PAIR, namespace: 'showcase_custom', created: false, writable: true }),
        });
        const res = await h.install(exportedPair());
        expect(res.status).toBe(200);
        expect(res.payload.data.customizationPair.created).toBe(false);
        expect(h.saveMetaItem).toHaveBeenCalledTimes(2);
        expectNoCodeInstall(h);
    });

    it('reports seed `data` as not loaded, and writes the items', async () => {
        const h = await mount(dir);
        const res = await h.install(exportedPair({ data: [{ object: 'showcase_task', records: [{ title: 'First' }] }] }));
        expect(res.status).toBe(200);
        expect(res.payload.data.seeded).toMatchObject({ mode: 'skipped' });
        expect(h.saveMetaItem).toHaveBeenCalledTimes(2);
    });
});

describe('install-local — a pair item the save door refuses answers failure, never success', () => {
    const refusal = Object.assign(new Error("Field 'nope' is not a field of 'showcase_task'."), {
        status: 422, code: 'VALIDATION_ERROR',
    });

    it('deletes the pair this install created, so nothing of the package remains', async () => {
        const h = await mount(dir, {
            save: async (request: any) => { if (request.type === 'dashboard') throw refusal; return { success: true }; },
        });
        const res = await h.install(exportedPair());
        expect(res.status).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('VALIDATION_ERROR');
        expect(res.payload.error.message).toContain(
            "dashboard 'showcase_chart_gallery' (`dashboards[0]`) could not be written — Field 'nope' is not a field of 'showcase_task'. ",
        );
        expect(res.payload.error.message).toContain('was removed again');
        expect(res.payload.error.details).toMatchObject({
            failed: { type: 'dashboard', name: 'showcase_chart_gallery', path: 'dashboards[0]' },
            written: [{ type: 'view', name: 'showcase_task.in_progress' }],
            notWritten: [],
        });
        expect(h.deletePackage).toHaveBeenCalledWith({ packageId: PAIR, actor: INSTALLER });
        expectNoCodeInstall(h);
    });

    it('keeps a pair that existed before, and lists what was and was not written', async () => {
        const h = await mount(dir, {
            ensure: async () => ({ basePackageId: BASE, packageId: PAIR, created: false, writable: true }),
            save: async (request: any) => { if (request.type === 'view') throw refusal; return { success: true }; },
        });
        const res = await h.install(exportedPair());
        expect(res.status).toBe(422);
        expect(res.payload.error.message).toContain('existed before this install, so it is kept');
        expect(res.payload.error.details).toMatchObject({
            written: [],
            notWritten: [{ type: 'dashboard', name: 'showcase_chart_gallery' }],
        });
        expect(h.deletePackage).not.toHaveBeenCalled();
    });

    it('logs at error when the created pair cannot be fully removed', async () => {
        const h = await mount(dir, { save: async () => { throw refusal; } });
        h.deletePackage.mockResolvedValueOnce({ success: false, deletedCount: 0, failedCount: 1 });
        const res = await h.install(exportedPair());
        expect(res.status).toBe(422);
        expect(res.payload.error.message).toContain('could NOT be fully removed');
        expect(h.logger.error).toHaveBeenCalledWith(expect.stringContaining('was NOT fully removed'));
    });
});

describe('install-local — a pair already read-only here is refused before the ensure door', () => {
    it('ledgered as code by an earlier install: names the uninstall and the restart', async () => {
        const h = await mount(dir, { ledgered: exportedPair(), codePackages: [PAIR], packages: { [PAIR]: { manifest: exportedPair({ scope: 'cloud' }) } } });
        const res = await h.install(exportedPair());
        expect(res.status).toBe(409);
        expect(res.payload.error.code).toBe('RESOURCE_CONFLICT');
        expect(res.payload.error.message).toContain(`DELETE ${ROUTE}/${PAIR}`);
        expect(res.payload.error.message).toContain('restart this runtime');
        expect(h.ensureCustomizationPackage).not.toHaveBeenCalled();
        expect(h.saveMetaItem).not.toHaveBeenCalled();
        expect(h.register).not.toHaveBeenCalled();
    });

    it('uninstalled, but still registered as code until a restart: names the restart', async () => {
        const h = await mount(dir, { codePackages: [PAIR] });
        const res = await h.install(exportedPair());
        expect(res.status).toBe(409);
        expect(res.payload.error.message).toContain('stays in this runtime until it restarts');
        expect(h.ensureCustomizationPackage).not.toHaveBeenCalled();
        expectNoCodeInstall(h);
    });

    it('uninstalled, then recorded by its ensure door before a restart: still names the restart', async () => {
        const h = await mount(dir, {
            codePackages: [PAIR],
            packages: { [PAIR]: { manifest: { id: PAIR, namespace: 'showcase_custom', dependencies: { [BASE]: '^0' } } } },
        });
        const res = await h.install(exportedPair());
        expect(res.status).toBe(409);
        expect(res.payload.error.message).toContain('stays in this runtime until it restarts');
        expect(h.ensureCustomizationPackage).not.toHaveBeenCalled();
    });

    it('provided read-only by this runtime\'s code or an installed app', async () => {
        const h = await mount(dir, { packages: { [PAIR]: { manifest: exportedPair({ scope: 'cloud' }) } } });
        const res = await h.install(exportedPair());
        expect(res.status).toBe(409);
        expect(res.payload.error.message).toContain('is provided read-only here');
        expect(h.ensureCustomizationPackage).not.toHaveBeenCalled();
        expectNoCodeInstall(h);
    });
});

describe('install-local — a pair install refused before any write', () => {
    it('relays the ensure door\'s refusal with its own status and code', async () => {
        const h = await mount(dir, {
            ensure: async () => {
                throw Object.assign(new Error(`Package '${BASE}' is writable: customize it directly.`), { statusCode: 409, code: 'RESOURCE_CONFLICT' });
            },
        });
        const res = await h.install(exportedPair());
        expect(res.status).toBe(409);
        expect(res.payload.error.message).toContain('customize it directly');
        expect(h.saveMetaItem).not.toHaveBeenCalled();
        expectNoCodeInstall(h);
    });

    it('refuses a body with no item form, naming each key', async () => {
        const h = await mount(dir);
        const res = await h.install(exportedPair({ translations: [{ en: {} }] }));
        expect(res.status).toBe(422);
        expect(res.payload.error.details.problems).toEqual([
            '`translations` is not part of a paired customization package: its items are written as stored items of the pair, and this key has no item form',
        ]);
        expect(h.ensureCustomizationPackage).not.toHaveBeenCalled();
        expectNoCodeInstall(h);
    });

    it('refuses a pair manifest the ensure door would not write', async () => {
        const h = await mount(dir);
        const res = await h.install(exportedPair({ dependencies: {} }));
        expect(res.status).toBe(400);
        expect(res.payload.error.code).toBe('PLUGIN_MANIFEST_INVALID');
        expect(res.payload.error.message).toContain(`a dependency on '${BASE}'`);
        expect(h.ensureCustomizationPackage).not.toHaveBeenCalled();
    });

    it('refuses a pair carried inside a multi-package artifact', async () => {
        const h = await mount(dir);
        const res = await h.install({
            id: 'com.example.bundle', namespace: 'bundle', version: '1.0.0', name: 'Bundle',
            type: 'app',
            packages: [{
                manifest: { id: PAIR, type: 'app', name: 'Showcase (custom)', version: '0.1.0', namespace: 'showcase_custom', dependencies: { [BASE]: '^0' } },
            }],
        });
        expect(res.status).toBe(422);
        expect(res.payload.error.details.pairs).toEqual([PAIR]);
        expect(h.ensureCustomizationPackage).not.toHaveBeenCalled();
        expectNoCodeInstall(h);
    });

    it('answers 503 on a runtime whose protocol has no pair doors', async () => {
        const h = await mount(dir, { noDoors: true });
        const res = await h.install(exportedPair());
        expect(res.status).toBe(503);
        expect(res.payload.error.code).toBe('SERVICE_UNAVAILABLE');
        expectNoCodeInstall(h);
    });
});

describe('[#30326] a pair install the handshake admitted unchecked says so in its answer', () => {
    it('a pair export with no engines.protocol answers `protocolCheckSkipped` reason `no-range`', async () => {
        const h = await mount(dir);
        const res = await h.install(exportedPair());
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        const { message, ...machine } = res.payload.data.protocolCheckSkipped;
        expect(machine).toEqual({ reason: 'no-range', packageId: PAIR, protocolVersion: PROTOCOL_VERSION });
        expect(message).toContain(`'${PAIR}'`);
    });

    it(`control: a pair export that declares ^${PROTOCOL_MAJOR} answers no \`protocolCheckSkipped\` key`, async () => {
        const h = await mount(dir);
        const res = await h.install(exportedPair({ engines: { protocol: `^${PROTOCOL_MAJOR}` } }));
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(Object.keys(res.payload.data)).not.toContain('protocolCheckSkipped');
    });
});
