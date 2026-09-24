// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/marketplace/install-local` parses the package id it installs
 * through its declaration — `ManifestSchema.shape.id`, by reference.
 *
 * ## What was wrong
 *
 * This door derived the id as `String(manifest?.id ?? manifest?.name ?? '')`
 * and parsed nothing, so an id `MANIFEST_ID_PATTERN` refuses (`late-app`,
 * `com.example.my_erp`, a manifest carrying only a `name`, a number) installed
 * cleanly and was then used as the key for the ledger file and the
 * `:manifestId` routes. The other two package-install doors — the HTTP
 * `POST /api/v1/packages` door and the protocol install primitive — already
 * refuse the same ids with the declaration's own sentence. This door is a
 * separate path (it never calls the protocol primitive), so neither of their
 * gates ever covered it.
 *
 * ## What these cases pin
 *
 * Both directions, on both install branches (the inline manifest and the
 * cloud-fetched snapshot) and on the compiled-bundle shape:
 *
 *   - a refused id answers `PLUGIN_MANIFEST_INVALID` in the declared envelope —
 *     `400` for caller input, `502` for an upstream snapshot, the same split the
 *     door already makes for an invalid manifest — carrying the declaration's
 *     own sentence, and NOTHING is written: no ledger file, no
 *     `manifest.register`, no `syncSchemas`;
 *   - a conforming id still installs (the lit control);
 *   - an entry ALREADY in the ledger under a non-conforming id — installed
 *     before this gate existed — still rehydrates at boot and can still be
 *     removed, because only the install POST is gated.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { manifestIdRefusal } from '@objectstack/spec/kernel';
import { BaseResponseSchema, ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

/**
 * Mount the plugin through its real lifecycle (`start()` + `kernel:ready`) and
 * hand back every writer the install path can reach, so a refusal can be
 * checked for having written nothing at all.
 */
async function mount(dir: string, opts: { controlPlaneUrl?: string; registry?: any[] } = {}) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const registry = opts.registry ?? [];
    const register = vi.fn((m: any) => { registry.push({ manifest: m }); });
    const syncSchemas = vi.fn(async () => undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas, registry: { getAllPackages: () => registry } }),
    };
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
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: opts.controlPlaneUrl ?? 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    // `kernel:ready` registers the plugin's own "Installed Apps" UI bundle and
    // rehydrates the ledger; count only what the request under test does.
    const registeredAtBoot = register.mock.calls.length;
    const syncedAtBoot = syncSchemas.mock.calls.length;
    return {
        routes: rawApp.routes,
        register,
        syncSchemas,
        logger,
        installRegistrations: () => register.mock.calls.slice(registeredAtBoot).map((call) => call[0]),
        installSyncs: () => syncSchemas.mock.calls.length - syncedAtBoot,
        bootRegistrations: () => register.mock.calls.slice(0, registeredAtBoot).map((call) => call[0]),
    };
}

function makeC(body: any, params: Record<string, string> = {}) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: `http://localhost:3000${ROUTE}`,
            raw: new Request(`http://localhost:3000${ROUTE}`),
            json: async () => body,
            param: (k: string) => params[k],
        },
        json,
    };
}

/** The refusal is the DECLARED envelope, not merely a body with a `code` on it. */
function expectDeclaredRefusal(res: { payload: any; status: number }, status: number) {
    expect(res.status).toBe(status);
    expect(BaseResponseSchema.safeParse(res.payload).success).toBe(true);
    expect(envelopeViolations(res.payload)).toEqual([]);
    expect(ApiErrorSchema.safeParse(res.payload.error).success).toBe(true);
    expect(res.payload.success).toBe(false);
    expect(res.payload.error.code).toBe('PLUGIN_MANIFEST_INVALID');
}

/** A refused install leaves the runtime exactly as it found it. */
function expectNothingWritten(h: { installRegistrations: () => unknown[]; installSyncs: () => number }) {
    expect(h.installRegistrations()).toEqual([]);
    expect(h.installSyncs()).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-id-gate-')); });
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/**
 * Ids the declaration refuses, each for a different reason. The sentence each
 * one must carry is `manifestIdRefusal('manifest.id', id)` itself, so a door
 * that reworded the declaration's refusal would fail here.
 */
const REFUSED_STRINGS: ReadonlyArray<readonly [string, string]> = [
    ['a bare word (the card\'s probe)', 'late-app'],
    ['an underscore inside a segment', 'com.example.my_erp'],
    ['a digit-initial segment', 'com.1acme.crm'],
    ['upper case', 'Com.Acme.Crm'],
    ['a whitespace-padded conforming id (the RAW value is parsed)', '  com.acme.crm  '],
    ['the empty string', ''],
];

describe('install-local parses the inline manifest\'s `id` through its declaration', () => {
    for (const [why, id] of REFUSED_STRINGS) {
        it(`refuses ${why} (${JSON.stringify(id)}) — 400, the declaration's sentence, nothing written`, async () => {
            const h = await mount(dir);
            const res = await h.routes.get(`POST ${ROUTE}`)!(
                makeC({ manifest: { id, name: 'Acme CRM', version: '1.0.0', objects: [] } }),
            );
            expectDeclaredRefusal(res, 400);
            expect(res.payload.error.message).toBe(manifestIdRefusal('manifest.id', id));
            expectNothingWritten(h);
        });
    }

    it('refuses a manifest carrying only a `name` — `name` is not the id, and the refusal names `manifest.id`', async () => {
        const h = await mount(dir);
        const res = await h.routes.get(`POST ${ROUTE}`)!(
            makeC({ manifest: { name: 'crm', version: '1.0.0', objects: [] } }),
        );
        expectDeclaredRefusal(res, 400);
        expect(res.payload.error.message).toBe(manifestIdRefusal('manifest.id', undefined));
        expect(res.payload.error.message).toContain('`manifest.id`');
        expectNothingWritten(h);
    });

    it('refuses a manifest with neither `id` nor `name`, with the same sentence', async () => {
        const h = await mount(dir);
        const res = await h.routes.get(`POST ${ROUTE}`)!(makeC({ manifest: { version: '1.0.0' } }));
        expectDeclaredRefusal(res, 400);
        expect(res.payload.error.message).toBe(manifestIdRefusal('manifest.id', undefined));
        expectNothingWritten(h);
    });

    it('refuses a non-string `id` rather than stringifying it into a key', async () => {
        const h = await mount(dir);
        const res = await h.routes.get(`POST ${ROUTE}`)!(makeC({ manifest: { id: 123, version: '1.0.0' } }));
        expectDeclaredRefusal(res, 400);
        expect(res.payload.error.message).toBe(manifestIdRefusal('manifest.id', 123));
        expectNothingWritten(h);
    });

    it('carries the declaration\'s mechanical repair, not only its rule', async () => {
        const h = await mount(dir);
        const res = await h.routes.get(`POST ${ROUTE}`)!(
            makeC({ manifest: { id: 'com.example.my_erp', version: '1.0.0' } }),
        );
        expect(res.payload.error.message).toContain("'com.example.my-erp'");
    });

    it('refuses a COMPILED bundle whose nested `manifest.id` is refused — the parse runs after normalization', async () => {
        const h = await mount(dir);
        const res = await h.routes.get(`POST ${ROUTE}`)!(makeC({
            manifest: { manifest: { id: 'late-app', namespace: 'late', version: '1.0.0', type: 'app' }, objects: [] },
        }));
        expectDeclaredRefusal(res, 400);
        expect(res.payload.error.message).toBe(manifestIdRefusal('manifest.id', 'late-app'));
        expectNothingWritten(h);
    });

    it('answers validity BEFORE collision: a refused id that local code also registered is a 400, not a 409', async () => {
        // A plugin that calls `manifest.register` directly is never parsed, so
        // local code CAN hold an id the declaration refuses.
        const h = await mount(dir, { registry: [{ manifest: { id: 'late-app', objects: [] } }] });
        const res = await h.routes.get(`POST ${ROUTE}`)!(makeC({ manifest: { id: 'late-app', version: '1.0.0' } }));
        expectDeclaredRefusal(res, 400);
        expect(res.payload.error.message).toBe(manifestIdRefusal('manifest.id', 'late-app'));
        expectNothingWritten(h);
    });

    for (const id of ['com.example.crm', 'com.example.my-erp', 'org.apache.superset']) {
        it(`lit control — '${id}' still installs, keyed by the id as written`, async () => {
            const h = await mount(dir);
            const res = await h.routes.get(`POST ${ROUTE}`)!(
                makeC({ manifest: { id, version: '1.0.0', objects: [] } }),
            );
            expect(res.status).toBe(200);
            expect(res.payload.success).toBe(true);
            expect(res.payload.data.manifestId).toBe(id);
            expect(h.installRegistrations().map((m) => m.id)).toEqual([id]);
            expect(readdirSync(dir)).toEqual([`${id}.json`]);
            expect(new LocalManifestSource(dir).read(id).entry?.packageId).toBe(id);
        });
    }

    it('lit control — a compiled bundle with a conforming nested id still installs', async () => {
        const h = await mount(dir);
        const res = await h.routes.get(`POST ${ROUTE}`)!(makeC({
            manifest: { manifest: { id: 'com.example.crm', namespace: 'crm', version: '2.0.0', type: 'app' }, objects: [] },
        }));
        expect(res.status).toBe(200);
        expect(res.payload.data.manifestId).toBe('com.example.crm');
        expect(readdirSync(dir)).toEqual(['com.example.crm.json']);
    });
});

describe('install-local parses the cloud snapshot\'s `id` through the same declaration', () => {
    /** Serve one manifest snapshot from the cloud leg; the public fast-path is off. */
    function serveSnapshot(manifest: unknown) {
        vi.stubEnv('OS_MARKETPLACE_PUBLIC_BASE_URL', 'off');
        // A non-empty service key, so the credential read never reaches the
        // developer's own on-disk binding.
        vi.stubEnv('OS_CLOUD_API_KEY', 'svc-test-key');
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify({ data: { manifest, version: '1.0.0', version_id: 'ver_1' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    it('refuses a snapshot whose id the declaration refuses — 502 (an upstream payload), nothing written', async () => {
        const fetchMock = serveSnapshot({ id: 'late-app', version: '1.0.0', objects: [] });
        const h = await mount(dir, { controlPlaneUrl: 'http://cloud.test' });
        const res = await h.routes.get(`POST ${ROUTE}`)!(makeC({ packageId: 'pkg_late' }));
        // Identity: the refusal came from the snapshot, not from a request the
        // door turned away before fetching.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expectDeclaredRefusal(res, 502);
        expect(res.payload.error.message).toBe(manifestIdRefusal('manifest.id', 'late-app'));
        expectNothingWritten(h);
    });

    it('refuses a name-only snapshot the same way', async () => {
        serveSnapshot({ name: 'crm', version: '1.0.0', objects: [] });
        const h = await mount(dir, { controlPlaneUrl: 'http://cloud.test' });
        const res = await h.routes.get(`POST ${ROUTE}`)!(makeC({ packageId: 'pkg_crm' }));
        expectDeclaredRefusal(res, 502);
        expect(res.payload.error.message).toBe(manifestIdRefusal('manifest.id', undefined));
        expectNothingWritten(h);
    });

    it('lit control — a snapshot with a conforming id still installs, keyed by the manifest id', async () => {
        serveSnapshot({ id: 'com.example.crm', version: '1.0.0', objects: [] });
        const h = await mount(dir, { controlPlaneUrl: 'http://cloud.test' });
        const res = await h.routes.get(`POST ${ROUTE}`)!(makeC({ packageId: 'pkg_crm' }));
        expect(res.status).toBe(200);
        expect(res.payload.data.manifestId).toBe('com.example.crm');
        expect(h.installRegistrations().map((m) => m.id)).toEqual(['com.example.crm']);
        // The catalog key and the manifest id are different things on this
        // branch; the ledger records both, keyed by the manifest id.
        const entry = new LocalManifestSource(dir).read('com.example.crm').entry;
        expect(entry?.packageId).toBe('pkg_crm');
        expect(entry?.manifestId).toBe('com.example.crm');
    });
});

describe('an entry installed BEFORE the gate is not stranded by it', () => {
    /** A ledger entry under an id the gate now refuses, as an older install left it. */
    function seedLegacyEntry(id: string) {
        new LocalManifestSource(dir).write({
            packageId: id,
            versionId: '1.0.0',
            manifestId: id,
            version: '1.0.0',
            manifest: { id, version: '1.0.0', objects: [] },
            installedAt: '2026-01-01T00:00:00.000Z',
            installedBy: 'admin',
            withSampleData: false,
        });
    }

    it('still rehydrates at kernel:ready — rehydrate is not an install door', async () => {
        seedLegacyEntry('late-app');
        const h = await mount(dir);
        expect(h.bootRegistrations().map((m) => m.id)).toContain('late-app');
        expect(h.logger.error).not.toHaveBeenCalled();
    });

    it('can still be removed through DELETE /:manifestId', async () => {
        seedLegacyEntry('late-app');
        const h = await mount(dir);
        const res = await h.routes.get(`DELETE ${ROUTE}/:manifestId`)!(makeC(undefined, { manifestId: 'late-app' }));
        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(res.payload.data.manifestId).toBe('late-app');
        expect(new LocalManifestSource(dir).has('late-app')).toBe(false);
    });

    it('cannot be RE-installed under the refused id — the door answers the declaration instead', async () => {
        seedLegacyEntry('late-app');
        const h = await mount(dir);
        const res = await h.routes.get(`POST ${ROUTE}`)!(makeC({ manifest: { id: 'late-app', version: '1.0.1' } }));
        expectDeclaredRefusal(res, 400);
        expect(res.payload.error.message).toBe(manifestIdRefusal('manifest.id', 'late-app'));
        // Nothing registered past boot, and the existing entry is left exactly as it was.
        expect(h.installRegistrations()).toEqual([]);
        expect(h.installSyncs()).toBe(0);
        expect(readdirSync(dir)).toEqual(['late-app.json']);
        expect(new LocalManifestSource(dir).read('late-app').entry?.version).toBe('1.0.0');
    });
});
