// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `reseed-sample-data` door is a load of a ledger body too, so it converts
 * the body forward ONCE (ADR-0087 D2), through the entry point the install and
 * the boot rehydrate use (`ObjectQL.convertPackageBodyForward`, reached through
 * the plugin's own `convertPackageBodyForward`), and hands that converted body
 * to `applySideEffects`: the translations it reloads into i18n and the seed
 * datasets it runs. Before, the reseed handed `applySideEffects` the raw ledger
 * entry, so a body carrying a shape a conversion rewrites reloaded the raw
 * shape on reseed while the install and the rehydrate loaded it converted.
 *
 * The shape here is a pre-17.4 per-app `settings` translation group
 * (`translation-per-app-settings-removed`, retired after 17.4.0). The body
 * declares `>=17.0.0`: a range this runtime's D1 handshake admits, with a floor
 * that predates the retirement, so the door's window replays the entry and the
 * group is stripped. The neighbouring `apps` group rides through untouched.
 *
 * The converter is REAL: an `ObjectQL` engine's own `convertPackageBodyForward`,
 * counted at the seam the plugin calls. The i18n service records what it is
 * handed, and the seed run (`runInlineSeed`) records the datasets it is handed
 * and reports one row, so the route answers its ordinary success. What is
 * pinned is WHICH body the reseed reloads.
 *
 * The entry is written to the ledger after the boot: the reseed reads it from
 * the ledger itself, at the door, so the boot's rehydrate (which converts and
 * loads the same body) stays out of what is recorded.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The reseed merges its seed datasets through `@objectstack/runtime` (a lazy
// `import()` inside the plugin). Its first load is paid here, at module top,
// never inside a clocked `it`.
import '@objectstack/runtime';
import { ObjectQL } from '@objectstack/objectql';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Bag = Record<string, any>;
type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
const RESEED = `POST ${ROUTE}/:manifestId/reseed-sample-data`;
const PKG_ID = 'com.example.reseed24040';
const SETTINGS_CONVERSION = 'translation-per-app-settings-removed';

/** The group the conversion strips: keyed by a platform settings namespace. */
const SETTINGS_GROUP = { mail: { title: '邮件投递', keys: { host: { label: '主机' } } } };
/** A neighbouring group on the same bundle entry, which no conversion touches. */
const APPS_GROUP = { reseed_app: { label: '示例数据' } };
const SEED_DATA = [{ object: 'qa_reseed_account', externalId: 'name', records: [{ name: 'Acme' }] }];

/** Built under a range this runtime admits, from a floor that predates 17.4.0. */
const declaredBody = (): Bag => ({
    id: PKG_ID,
    name: 'Reseed',
    version: '1.0.0',
    type: 'app',
    scope: 'project',
    engines: { protocol: '>=17.0.0' },
    objects: [{ name: 'qa_reseed_account', fields: { name: { type: 'text' } } }],
    translations: [{ 'zh-CN': { settings: SETTINGS_GROUP, apps: APPS_GROUP } }],
    data: SEED_DATA,
});
/** The same body with NO declared range: the door replays nothing for it. */
const rangeLessBody = (): Bag => {
    const { engines: _engines, ...rest } = declaredBody();
    return rest;
};
/** Installed for the previous protocol major: the D1 handshake refuses it. */
const incompatibleBody = (): Bag => ({ ...declaredBody(), engines: { protocol: '^17.0.0' } });

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-reseed-convert-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

function writeLedger(manifest: Bag): void {
    new LocalManifestSource(dir).write({
        packageId: PKG_ID,
        versionId: 'local',
        manifestId: PKG_ID,
        version: manifest.version,
        manifest,
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'admin',
        withSampleData: false,
    });
}

/** The plugin over a REAL engine's converter, booted to `kernel:ready` over an empty ledger. */
async function bootPlugin() {
    const conversionWarnings: string[] = [];
    const ql = new ObjectQL({
        logger: {
            debug: () => undefined,
            info: () => undefined,
            error: () => undefined,
            warn: (line: unknown) => {
                if (String(line).includes('ADR-0087 conversion')) conversionWarnings.push(String(line));
            },
        },
    });
    const converted: Array<{ received: Bag; returned: Bag }> = [];
    const loaded: Array<[string, Bag]> = [];
    const services: Record<string, unknown> = {
        manifest: { register: vi.fn() },
        auth: installerAuthService(),
        objectql: withInstallerGrants({
            // The engine's own door, bound to the real engine and counted.
            convertPackageBodyForward: (body: Bag) => {
                const returned = ql.convertPackageBodyForward(body);
                converted.push({ received: body, returned });
                return returned;
            },
            syncSchemas: async () => undefined,
        }),
        metadata: {},
        i18n: { loadTranslations: (locale: string, data: Bag) => { loaded.push([locale, data]); } },
    };
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const hooks = new Map<string, () => Promise<void>>();
    const ctx = {
        hook: (e: string, h: () => Promise<void>) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        registerService: (name: string, svc: unknown) => { services[name] = svc; },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    const seeded: Bag[][] = [];
    (plugin as unknown as Record<string, unknown>).runInlineSeed = async (_ctx: unknown, datasets: Bag[]) => {
        seeded.push(datasets);
        return { inserted: 1, updated: 0, skipped: 0, errors: 0, errorList: [], droppedRefs: 0 };
    };
    await plugin.start(ctx as never);
    await hooks.get('kernel:ready')?.();

    const reseed = async () => {
        const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
        return routes.get(RESEED)!({
            req: {
                url: `http://localhost:3000${ROUTE}`,
                raw: new Request(`http://localhost:3000${ROUTE}`),
                json: async () => ({}),
                param: (k: string) => (k === 'manifestId' ? PKG_ID : undefined),
                header: () => undefined,
            },
            json,
        });
    };
    return { converted, loaded, seeded, conversionWarnings, reseed };
}

const ledgerBody = () => new LocalManifestSource(dir).read(PKG_ID).entry!.manifest as Bag;

describe('the reseed door reloads the body converted forward once, as install and rehydrate load it', () => {
    it('a declared body: the stripped `settings` group is not reloaded, through one conversion', async () => {
        const { converted, loaded, seeded, conversionWarnings, reseed } = await bootPlugin();
        writeLedger(declaredBody());

        const res = await reseed();

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data).toMatchObject({ manifestId: PKG_ID, inserted: 1, withSampleData: true });
        // i18n is handed the converted bundle: `settings` gone, `apps` intact.
        expect(loaded).toEqual([['zh-CN', { apps: APPS_GROUP }]]);
        // No conversion touches seed `data`: the run seeds the datasets as declared.
        expect(seeded).toEqual([SEED_DATA]);
        // Converted ONCE, from the body as the ledger holds it.
        expect(converted).toHaveLength(1);
        expect(converted[0].received).toEqual(declaredBody());
        expect(conversionWarnings.filter((w) => w.includes(`conversion '${SETTINGS_CONVERSION}'`))).toHaveLength(1);
        // The ledger keeps the body as installed, while the reseed rewrites the entry's flags.
        expect(ledgerBody().translations[0]['zh-CN'].settings).toEqual(SETTINGS_GROUP);
        expect(new LocalManifestSource(dir).read(PKG_ID).entry!.withSampleData).toBe(true);
    });

    it('CONTROL — a range-less body comes back by reference, unchanged, and reloads as declared', async () => {
        const { converted, loaded, seeded, conversionWarnings, reseed } = await bootPlugin();
        writeLedger(rangeLessBody());

        const res = await reseed();

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(loaded).toEqual([['zh-CN', { settings: SETTINGS_GROUP, apps: APPS_GROUP }]]);
        expect(seeded).toEqual([SEED_DATA]);
        expect(converted).toHaveLength(1);
        expect(converted[0].returned).toBe(converted[0].received);
        expect(conversionWarnings).toEqual([]);
    });

    it('the D1 handshake still judges the entry as stored, FIRST: a refused entry is never converted or reloaded', async () => {
        const { converted, loaded, seeded, conversionWarnings, reseed } = await bootPlugin();
        writeLedger(incompatibleBody());

        const res = await reseed();

        expect(res.status).toBe(422);
        expect(res.payload.error.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
        expect(converted).toEqual([]);
        expect(conversionWarnings).toEqual([]);
        expect(loaded).toEqual([]);
        expect(seeded).toEqual([]);
    });
});
