// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21762] `POST /api/v1/marketplace/install-local` runs ADR-0087 D1's protocol
 * handshake, and refuses with the answer `POST /api/v1/packages` gives.
 *
 * ## The defect this file pins shut
 *
 * A manifest whose `engines.protocol` range excludes this runtime's major
 * (`^16` on protocol 17) answered `200` here: it was registered, its ledger
 * file was written and `syncSchemas` ran, with no protocol warning at all. The
 * other package-install door refused the same manifest with
 * `422 OS_PROTOCOL_INCOMPATIBLE` and the structured diagnostic. ADR-0087 D1
 * names "the package installer" with no door-specific exception.
 *
 * ## What these cases pin
 *
 *   - the refusal, on both install branches (inline manifest and cloud
 *     snapshot): `422`, `OS_PROTOCOL_INCOMPATIBLE`, the declared envelope, and
 *     exactly the five diagnostic members in `error.details`;
 *   - nothing is registered, no ledger file is written or overwritten, and no
 *     schema is synced;
 *   - the `^17` control still installs;
 *   - the two doors give the SAME answer for the same manifest: status, code,
 *     message and `details`, byte-compared. Both answer through one helper,
 *     `protocolIncompatibleAnswer` in `@objectstack/metadata-core`;
 *   - the `kernel:ready` rehydrate of an incompatible ledger entry, as
 *     measured: on `origin/main` before this change it registered the package,
 *     ran `syncSchemas` and logged only `info` "rehydrated". Now it is NOT
 *     loaded, one `error` line names the code, the package and the replay
 *     command, the boot continues, and the entry can still be removed or
 *     replaced.
 *
 * The ranges are derived from the running protocol, never written as literals,
 * so the file keeps meaning the same thing after the next major.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaseResponseSchema, ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from '@objectstack/spec/kernel';
// An install and a rehydrate bind the package's handlers through
// `@objectstack/runtime` (a lazy `import()` inside the plugin). Its first load
// is paid here, at module top, never inside a clocked `it`. The parity case
// also drives the packages door's real dispatcher from it.
import { HttpDispatcher } from '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';

/** A major this runtime no longer accepts, derived from the runtime. */
const OLD_MAJOR = PROTOCOL_MAJOR - 1;
const OLD_RANGE = `^${OLD_MAJOR}`;
const CURRENT_RANGE = `^${PROTOCOL_MAJOR}`;

/** The card's reproduction. */
const OLD_ID = 'com.example.qaold';
const INCOMPATIBLE = {
    id: OLD_ID, name: 'Old', version: '1.0.0', scope: 'project', type: 'app',
    engines: { protocol: OLD_RANGE },
};
/** The lit control: the same manifest under a range this runtime admits. */
const COMPATIBLE = { ...INCOMPATIBLE, id: 'com.example.qacurrent', engines: { protocol: CURRENT_RANGE } };

/** The five diagnostic members the wire carries: a CLOSED set. */
const DETAILS = {
    requiredRange: OLD_RANGE,
    rangeSource: 'engines.protocol',
    protocolVersion: PROTOCOL_VERSION,
    targetMajor: OLD_MAJOR,
    migrateCommand: `objectstack migrate meta --from ${OLD_MAJOR}`,
};

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
async function mount(dir: string, opts: { controlPlaneUrl?: string } = {}) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const registry: any[] = [];
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
        logger,
        install: (body: unknown) => rawApp.routes.get(`POST ${ROUTE}`)!(makeC(body)),
        installRegistrations: () => register.mock.calls.slice(registeredAtBoot).map((call) => call[0]),
        installSyncs: () => syncSchemas.mock.calls.length - syncedAtBoot,
        bootRegistrations: () => register.mock.calls.slice(0, registeredAtBoot).map((call) => call[0]),
        bootSyncs: syncedAtBoot,
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

/** The refusal: the declared envelope, the code and status, and the five members. */
function expectProtocolRefusal(res: { payload: any; status: number }) {
    expect(res.status, JSON.stringify(res.payload)).toBe(422);
    expect(BaseResponseSchema.safeParse(res.payload).success).toBe(true);
    expect(envelopeViolations(res.payload)).toEqual([]);
    expect(ApiErrorSchema.safeParse(res.payload.error).success).toBe(true);
    expect(res.payload.success).toBe(false);
    const { error } = res.payload;
    expect(error.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
    // Exactly the five members: `code` is in `error.code` (ADR-0112 D5), never
    // in `error.details.code`, and nothing beyond the ruled set leaks.
    expect(error.details).toEqual(DETAILS);
    expect(Object.keys(error.details).sort()).toEqual(Object.keys(DETAILS).sort());
    // Each member equals what the prose states, so the two channels cannot drift.
    expect(error.message).toContain(`targets protocol ${OLD_RANGE} (engines.protocol)`);
    expect(error.message.endsWith(`Run: ${DETAILS.migrateCommand}`)).toBe(true);
}

/** A refused install leaves the runtime exactly as it found it. */
function expectNothingWritten(h: { installRegistrations: () => unknown[]; installSyncs: () => number }, files: string[] = []) {
    expect(h.installRegistrations()).toEqual([]);
    expect(h.installSyncs()).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(files);
}

function seedEntry(manifest: { id: string; version: string }) {
    new LocalManifestSource(dir).write({
        packageId: manifest.id,
        versionId: manifest.version,
        manifestId: manifest.id,
        version: manifest.version,
        manifest,
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'admin',
        withSampleData: false,
    });
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-protocol-')); });
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('POST install-local: an incompatible protocol range is refused, and nothing is installed', () => {
    it(`refuses ${OLD_RANGE} on protocol ${PROTOCOL_MAJOR} (inline manifest): 422 with the five diagnostic fields`, async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: INCOMPATIBLE });
        expectProtocolRefusal(res);
        expectNothingWritten(h);
    });

    it('refuses a cloud snapshot the same way: 422, not the 502 of an upstream fault', async () => {
        vi.stubEnv('OS_MARKETPLACE_PUBLIC_BASE_URL', 'off');
        // A non-empty service key, so the credential read never reaches the
        // developer's own on-disk binding.
        vi.stubEnv('OS_CLOUD_API_KEY', 'svc-test-key');
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify({ data: { manifest: INCOMPATIBLE, version: '1.0.0', version_id: 'ver_1' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
        vi.stubGlobal('fetch', fetchMock);
        const h = await mount(dir, { controlPlaneUrl: 'http://cloud.test' });
        const res = await h.install({ packageId: 'pkg_qaold' });
        // Identity: the refusal came from the snapshot the door fetched.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expectProtocolRefusal(res);
        expectNothingWritten(h);
    });

    it('judges the range BEFORE the package\'s code: an incompatible package with an unrunnable job answers the protocol refusal', async () => {
        // The unrunnable-code judgement reads jobs with THIS runtime's binder;
        // ADR-0087 D1 checks before loading a package's metadata.
        const jobs = [{ name: 'qa_tick_handler', schedule: { type: 'interval', intervalMs: 1000 }, handler: 'tick' }];
        const h = await mount(dir);
        // Control: under a range this runtime admits, this job IS refused, by
        // the unrunnable-code gate, so the case below is not vacuous.
        const control = await h.install({ manifest: { ...COMPATIBLE, jobs } });
        expect(control.status, JSON.stringify(control.payload)).toBe(422);
        expect(control.payload.error.code).toBe('VALIDATION_ERROR');

        const res = await h.install({ manifest: { ...INCOMPATIBLE, jobs } });
        expectProtocolRefusal(res);
        expectNothingWritten(h);
    });

    it('a refused upgrade leaves the installed version exactly as it was', async () => {
        seedEntry({ id: OLD_ID, version: '0.9.0', engines: { protocol: CURRENT_RANGE } } as any);
        const before = readFileSync(join(dir, `${OLD_ID}.json`), 'utf8');
        const h = await mount(dir);
        const res = await h.install({ manifest: INCOMPATIBLE });
        expectProtocolRefusal(res);
        expectNothingWritten(h, [`${OLD_ID}.json`]);
        expect(readFileSync(join(dir, `${OLD_ID}.json`), 'utf8')).toBe(before);
    });

    it(`lit control: ${CURRENT_RANGE} still installs, registered, written and synced`, async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: COMPATIBLE });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(res.payload.data.manifestId).toBe(COMPATIBLE.id);
        expect(h.installRegistrations().map((m) => m.id)).toEqual([COMPATIBLE.id]);
        expect(h.installSyncs()).toBe(1);
        expect(readdirSync(dir)).toEqual([`${COMPATIBLE.id}.json`]);
        expect(h.logger.warn.mock.calls.filter(([m]) => String(m).includes('[protocol]'))).toEqual([]);
    });

    it('lit control: a manifest with no range is admitted, with the handshake\'s one warning on this plugin\'s logger', async () => {
        const { engines: _omitted, ...noRange } = COMPATIBLE;
        const h = await mount(dir);
        const res = await h.install({ manifest: noRange });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.installRegistrations().map((m) => m.id)).toEqual([COMPATIBLE.id]);
        const warned = h.logger.warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('[protocol]'));
        expect(warned).toHaveLength(1);
        expect(warned[0]).toContain(COMPATIBLE.id);
    });
});

describe('the two package-install doors give the same answer for the same manifest', () => {
    /**
     * `POST /api/v1/packages` through the runtime's real dispatcher, on its
     * no-protocol-service arm (which runs the same handshake as the composed
     * arm; `packages-install-protocol-incompatible.test.ts` holds the two arms
     * equal). The registry is a stub: the refusal comes before any install.
     */
    async function packagesDoor(manifest: unknown) {
        const registry = { getPackage: () => undefined, installPackage: vi.fn() };
        const ql: any = { registry, manifests: new Map() };
        const kernel: any = {
            getService: (name: string) => (name === 'objectql' ? Promise.resolve(ql) : null),
            context: { getService: (name: string) => (name === 'objectql' ? ql : null) },
        };
        const r: any = await new HttpDispatcher(kernel).handlePackages('', 'POST', { manifest }, {}, {
            request: {},
            environmentId: 'install-door-parity',
            executionContext: { userId: 'u_admin', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
        } as any);
        expect(registry.installPackage).not.toHaveBeenCalled();
        return { status: r.response.status, error: r.response.body.error };
    }

    it('status, code, message and details are byte-identical', async () => {
        const viaPackages = await packagesDoor(INCOMPATIBLE);
        const h = await mount(dir);
        const res = await h.install({ manifest: INCOMPATIBLE });
        const viaInstallLocal = { status: res.status, error: res.payload.error };

        const carrier = (a: { status: number; error: any }) => JSON.stringify({
            status: a.status, code: a.error.code, message: a.error.message, details: a.error.details,
        });
        expect(viaPackages.status).toBe(422);
        expect(carrier(viaInstallLocal)).toBe(carrier(viaPackages));
        expectProtocolRefusal(res);
    });
});

describe('kernel:ready rehydrate of an already-ledgered incompatible entry', () => {
    const errors = (h: { logger: { error: { mock: { calls: unknown[][] } } } }) =>
        h.logger.error.mock.calls.map(([m]) => String(m));

    it('is NOT loaded: nothing registered or synced for it, one error line naming the code, the package and the replay command', async () => {
        seedEntry(INCOMPATIBLE);
        const h = await mount(dir);
        expect(h.bootRegistrations().map((m) => m.id)).not.toContain(OLD_ID);
        expect(h.bootSyncs).toBe(0);
        const said = errors(h);
        expect(said).toHaveLength(1);
        expect(said[0]).toContain('OS_PROTOCOL_INCOMPATIBLE');
        expect(said[0]).toContain(`${OLD_ID}@1.0.0`);
        expect(said[0]).toContain(DETAILS.migrateCommand);
        expect(h.logger.info.mock.calls.map(([m]) => String(m))).not.toContain(
            `[MarketplaceInstallLocal] rehydrated ${OLD_ID}@1.0.0`,
        );
    });

    it('the boot continues: a compatible entry still rehydrates, and the routes are mounted', async () => {
        seedEntry(INCOMPATIBLE);
        seedEntry(COMPATIBLE);
        const h = await mount(dir);
        const rehydrated = h.bootRegistrations().map((m) => m.id).filter((id) => id === OLD_ID || id === COMPATIBLE.id);
        expect(rehydrated).toEqual([COMPATIBLE.id]);
        expect(h.bootSyncs).toBe(1);
        expect([...h.routes.keys()]).toContain(`POST ${ROUTE}`);
        expect([...h.routes.keys()]).toContain(`DELETE ${ROUTE}/:manifestId`);
    });

    it('the entry is kept, so DELETE still removes it', async () => {
        seedEntry(INCOMPATIBLE);
        const h = await mount(dir);
        expect(readdirSync(dir)).toEqual([`${OLD_ID}.json`]);
        const res = await h.routes.get(`DELETE ${ROUTE}/:manifestId`)!(makeC(undefined, { manifestId: OLD_ID }));
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.manifestId).toBe(OLD_ID);
        expect(new LocalManifestSource(dir).has(OLD_ID)).toBe(false);
    });

    it('a compatible version replaces it through the install door', async () => {
        seedEntry(INCOMPATIBLE);
        const h = await mount(dir);
        const res = await h.install({ manifest: { ...INCOMPATIBLE, version: '2.0.0', engines: { protocol: CURRENT_RANGE } } });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.installRegistrations().map((m) => m.id)).toEqual([OLD_ID]);
        expect(new LocalManifestSource(dir).read(OLD_ID).entry?.version).toBe('2.0.0');
    });
});
