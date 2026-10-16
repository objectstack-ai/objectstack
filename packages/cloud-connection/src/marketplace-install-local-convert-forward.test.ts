// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The marketplace install's two loads of a package body — the install and the
 * boot rehydrate — convert the body forward ONCE (ADR-0087 D2) and hand that
 * one converted body to every reader of the load: `manifest.register`, the
 * handler binder (`bindArtifactHandlers`), the side effects
 * (`applySideEffects`: translations and seed datasets) and the rehydrate's
 * sample-data heal. Before, `register` converted its own copy while the three
 * side readers read the raw ledger entry.
 *
 * The converter and the judge are REAL: an `ObjectKernel` with `ObjectQLPlugin`
 * supplies the engine's `convertPackageBodyForward` and the `manifest` service
 * over the real `SchemaRegistry` (a stubbed registry cannot refuse, so it could
 * not tell the CONTROL below from the converting case). The side readers are
 * replaced by recorders, because what is pinned is WHICH body they receive.
 *
 * The body is HotCRM 4.0.1's (`__fixtures__/hotcrm-4.0.1-published-pages.artifact.json`
 * in `@objectstack/objectql`): a `type: 'home'` page with `isDefault: true`,
 * declared floor 17.7.0. As published it declares `^17.7.0`, which this
 * runtime's ADR-0087 D1 handshake refuses before any load (the protocol
 * handshake suite pins that), so the converting cases restamp the same body
 * `>=17.7.0`: same floor, same pages, a range this runtime admits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The plugin reaches `@objectstack/runtime` through a lazy `import()`; its first
// load is paid here, at module top, never inside a clocked `it`.
import '@objectstack/runtime';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(HERE, '../../objectql/src/__fixtures__/hotcrm-4.0.1-published-pages.artifact.json');

type Bag = Record<string, any>;
type Handler = (c: any) => Promise<any>;

const HOTCRM_ID = 'app.objectstack.hotcrm';
const IS_DEFAULT_CONVERSION = 'page-is-default-off-record-page-removed';
const ROUTE = '/api/v1/marketplace/install-local';

/** HotCRM 4.0.1's body under a range this runtime admits, from the same 17.7.0 floor. */
const hotcrmBody = (): Bag => {
    const artifact = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const body = artifact.packages.find((e: Bag) => e.manifest.id === HOTCRM_ID).manifest;
    return { ...body, engines: { protocol: '>=17.7.0' } };
};
/** The same body as a plugin builds it in code: NO declared range. */
const codeBuiltBody = (): Bag => {
    const { engines: _engines, ...rest } = hotcrmBody();
    return rest;
};
const homePage = (body: Bag) => (body.pages as Bag[]).find((p) => p.name === 'sales_home_page');

let dir: string;
const kernels: ObjectKernel[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-convert-forward-')); });
afterEach(async () => {
    while (kernels.length) {
        const k = kernels.pop()!;
        if (k.getState() === 'running') await k.shutdown();
    }
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

function seedLedger(manifest: Bag): void {
    new LocalManifestSource(dir).write({
        packageId: HOTCRM_ID,
        versionId: 'local',
        manifestId: HOTCRM_ID,
        version: manifest.version,
        manifest,
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'admin',
        withSampleData: false,
    });
}

/**
 * The plugin over a REAL engine's converter and `manifest` service, booted to
 * `kernel:ready` (which runs the rehydrate). Every reader of a load records the
 * body it was handed, in one ordered list.
 */
async function bootPlugin() {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';
    const conversionWarnings: string[] = [];
    (ql as unknown as { logger: { warn: (line: unknown) => void } }).logger.warn = (line: unknown) => {
        if (String(line).includes('ADR-0087 conversion')) conversionWarnings.push(String(line));
    };

    const handed: Array<{ reader: string; body: Bag }> = [];
    const realManifest = kernel.getService<{ register(m: unknown): unknown }>('manifest');
    const manifest = {
        register: async (body: Bag) => {
            // The plugin also registers its own Setup UI bundle at
            // `kernel:ready`; only the package under test is recorded.
            if (body?.id === HOTCRM_ID) handed.push({ reader: 'register', body });
            await realManifest.register(body);
        },
    };
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const hooks = new Map<string, () => Promise<void>>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const services: Record<string, unknown> = {
        manifest,
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
    const recorder = (reader: string) => async (...args: unknown[]) => {
        handed.push({ reader, body: (reader === 'heal' ? args[2] : args[1]) as Bag });
        return { seeded: { mode: 'none' } };
    };
    const p = plugin as unknown as Record<string, unknown>;
    p.bindArtifactHandlers = recorder('bindArtifactHandlers');
    p.applySideEffects = recorder('applySideEffects');
    p.maybeHealSampleData = recorder('heal');

    await plugin.start(ctx as never);
    await hooks.get('kernel:ready')?.();

    const install = async (body: Bag) => {
        const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
        return routes.get(`POST ${ROUTE}`)!({
            req: {
                url: `http://localhost:3000${ROUTE}`,
                raw: new Request('http://localhost:3000/x'),
                json: async () => ({ manifest: body }),
                param: () => undefined,
            },
            json,
        });
    };
    return { ql, handed, conversionWarnings, logger, install };
}

/** Every reader received the SAME converted object, and the flag is gone from it. */
function expectOneConvertedBody(handed: Array<{ reader: string; body: Bag }>, readers: string[]) {
    expect(handed.map((h) => h.reader)).toEqual(readers);
    const [first] = handed;
    for (const h of handed) expect(h.body, `${h.reader} read a different body`).toBe(first.body);
    expect(homePage(first.body)).toMatchObject({ type: 'home' });
    expect(homePage(first.body)).not.toHaveProperty('isDefault');
}

describe('the marketplace install converts a body once and every reader of the load reads that body', () => {
    it('rehydrate — register, the binder, the side effects and the heal all receive the converted body', async () => {
        seedLedger(hotcrmBody());
        const { ql, handed, conversionWarnings } = await bootPlugin();

        expectOneConvertedBody(handed, ['register', 'bindArtifactHandlers', 'applySideEffects', 'heal']);
        expect(ql.registry.getPackage(HOTCRM_ID)).toBeDefined();
        // Converted once: `register` met the entry point again with the
        // converted body, and no second warning was printed.
        expect(conversionWarnings.filter((w) => w.includes(`conversion '${IS_DEFAULT_CONVERSION}'`))).toHaveLength(1);
        // The ledger keeps the body as installed: data at rest replays at every load.
        expect(homePage(new LocalManifestSource(dir).read(HOTCRM_ID).entry!.manifest as Bag)).toMatchObject({ isDefault: true });
    });

    it('install — register, the binder and the side effects all receive the converted body', async () => {
        const { ql, handed, conversionWarnings, install } = await bootPlugin();

        const res = await install(hotcrmBody());

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expectOneConvertedBody(handed, ['register', 'bindArtifactHandlers', 'applySideEffects']);
        expect(ql.registry.getPackage(HOTCRM_ID)).toBeDefined();
        expect(conversionWarnings.filter((w) => w.includes(`conversion '${IS_DEFAULT_CONVERSION}'`))).toHaveLength(1);
        expect(homePage(new LocalManifestSource(dir).read(HOTCRM_ID).entry!.manifest as Bag)).toMatchObject({ isDefault: true });
    });
});

describe('CONTROL — a body with no declared range meets the registry\'s refusal exactly as before', () => {
    const expectMisplacedDefault = (message: string) =>
        expect(message).toContain(`Page "sales_home_page" of package "${HOTCRM_ID}": \`isDefault: true\` is refused on a \`type: 'home'\` page`);

    it('install — refused at register (422 PLUGIN_REGISTER_FAILED), nothing converted, no side reader runs', async () => {
        const { ql, handed, conversionWarnings, install } = await bootPlugin();

        const res = await install(codeBuiltBody());

        expect(res.status).toBe(422);
        expect(res.payload.error.code).toBe('PLUGIN_REGISTER_FAILED');
        expectMisplacedDefault(res.payload.error.message);
        expect(handed.map((h) => h.reader)).toEqual(['register']);
        expect(homePage(handed[0].body)).toMatchObject({ isDefault: true });
        expect(conversionWarnings).toEqual([]);
        expect(ql.registry.getPackage(HOTCRM_ID)).toBeUndefined();
    });

    it('rehydrate — refused at register and reported for that entry, no side reader runs', async () => {
        seedLedger(codeBuiltBody());
        const { ql, handed, conversionWarnings, logger } = await bootPlugin();

        expect(handed.map((h) => h.reader)).toEqual(['register']);
        expect(homePage(handed[0].body)).toMatchObject({ isDefault: true });
        expect(conversionWarnings).toEqual([]);
        expect(ql.registry.getPackage(HOTCRM_ID)).toBeUndefined();
        const failed = logger.error.mock.calls.filter((c: unknown[]) => String(c[0]) === `[MarketplaceInstallLocal] rehydrate failed for ${HOTCRM_ID}`);
        expect(failed).toHaveLength(1);
        const refusal = failed[0][1] as Error & { code?: string; status?: number };
        expect({ name: refusal.name, code: refusal.code, status: refusal.status })
            .toEqual({ name: 'MisplacedDefaultPageError', code: 'INVALID_METADATA', status: 422 });
        expectMisplacedDefault(refusal.message);
    });
});
