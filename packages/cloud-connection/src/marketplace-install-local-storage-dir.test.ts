// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6721 — the install POST reports WHERE it cached the manifest.
 *
 * The two endpoints of this plugin had diverged on one fact. `GET
 * /api/v1/marketplace/install-local` (the console's Installed Apps list) served
 * `storageDir: this.storageDir`; the `POST` that performs the install did not,
 * so its only consumer — `os package install`, which runs on a DIFFERENT machine
 * and never touches this host's disk — had no resolved value to quote and could
 * only describe the ledger directory by literal. That literal is the ctor's
 * default, i.e. wrong for every host that configures `storageDir`.
 *
 * The non-default-`storageDir` case below is therefore the point of this file,
 * not a variation on it: it is exactly the configuration the old literal
 * misreported, and the only one that can tell "quotes the resolved value" apart
 * from "restates the default".
 *
 * `this.storageDir` is `this.ledger.dir` — already resolved by
 * `LocalManifestSource`'s ctor — so both endpoints must keep reading that one
 * field. A second derivation is how they diverged in the first place, which is
 * why the parity case asserts POST and GET are the same string rather than
 * asserting each against a separately-computed expectation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
// [#21321] An install, and a rehydrate of a ledger entry, now bind the package's
// handlers through `@objectstack/runtime` (a lazy `import()` inside the plugin).
// Its first load is paid here, at module top — never inside a clocked `it`
// (the clocked-window rule, `scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { DEFAULT_INSTALLED_PACKAGES_DIR, FRESH_HOME_CHANNEL_ENV, LocalManifestSource } from './local-manifest-source.js';

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

function makeCtx(rawApp: any) {
    const hooks = new Map<string, any>();
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas: async () => undefined }),
    };
    return {
        ctx: {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => rawApp };
                const svc = services[name];
                if (svc === undefined) throw new Error(`no ${name}`);
                return svc;
            },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
        },
        json,
    };
}

/** Boot the plugin far enough that its routes are mounted. */
async function mount(storageDir?: string) {
    const rawApp = makeRawApp();
    const { ctx, fire } = makeCtx(rawApp);
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir });
    await plugin.start(ctx as any);
    await fire();
    return {
        install: async (manifest: any) =>
            rawApp.routes.get('POST /api/v1/marketplace/install-local')!(makeC({ manifest })),
        list: async () =>
            rawApp.routes.get('GET /api/v1/marketplace/install-local')!(makeC({})),
    };
}

const MANIFEST = { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', objects: [] };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-storage-dir-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('install-local POST response — storageDir', () => {
    it('carries the RESOLVED ledger directory of a host that configured a non-default storageDir', async () => {
        const { install } = await mount(dir);

        const res = await install(MANIFEST);

        expect(res.payload?.success).toBe(true);
        // The configured directory, resolved — not the ctor default. Both
        // halves matter: the first is the value the CLI must be able to quote,
        // the second is the assertion the old literal would have failed.
        expect(res.payload.data.storageDir).toBe(resolve(dir));
        expect(res.payload.data.storageDir).not.toContain(DEFAULT_INSTALLED_PACKAGES_DIR);
    });

    it('carries the ctor-default directory when the host configured nothing', async () => {
        // chdir into the temp dir first: with no `storageDir` the ledger
        // resolves against `process.cwd()`, and the install genuinely writes a
        // file there. Without this the case would litter the repo checkout.
        const prevCwd = process.cwd();
        process.chdir(dir);
        // [#30217] The cwd default is the `OS_HOME`-unset answer.
        vi.stubEnv('OS_HOME', '');
        try {
            const { install } = await mount(undefined);

            const res = await install(MANIFEST);

            expect(res.payload?.success).toBe(true);
            expect(res.payload.data.storageDir).toBe(resolve(process.cwd(), DEFAULT_INSTALLED_PACKAGES_DIR));
        } finally {
            process.chdir(prevCwd);
        }
    });

    it('reports the same directory as the GET listing — one field, two endpoints', async () => {
        const { install, list } = await mount(dir);

        const installed = await install(MANIFEST);
        const listed = await list();

        expect(installed.payload.data.storageDir).toBe(listed.payload.data.storageDir);
        expect(typeof installed.payload.data.storageDir).toBe('string');
        expect(installed.payload.data.storageDir.length).toBeGreaterThan(0);
    });
});

/**
 * #30217 — with no `storageDir`, the ledger follows `OS_HOME`.
 *
 * It used to resolve from the working directory alone, so `os dev --fresh` (a
 * fresh `OS_HOME`) and a second instance under another `OS_HOME` rehydrated a
 * package an earlier run installed. The installs an earlier release ledgered in
 * the working directory are copied into the new place once, so they do not
 * vanish on upgrade — except under the ephemeral home of a `--fresh` run.
 */
describe('install-local default ledger — follows OS_HOME (#30217)', () => {
    let prevCwd: string;
    let project: string;
    let home: string;
    beforeEach(() => {
        prevCwd = process.cwd();
        project = join(dir, 'project');
        home = join(dir, 'home');
        mkdirSync(project, { recursive: true });
        process.chdir(project);
    });
    afterEach(() => { process.chdir(prevCwd); });

    const legacyDir = () => join(project, DEFAULT_INSTALLED_PACKAGES_DIR);
    const homeLedger = () => join(home, 'installed-packages');

    /** A ledger entry an earlier release wrote in the working directory. */
    function writeLegacyEntry(manifestId = 'com.acme.legacy') {
        new LocalManifestSource(legacyDir()).write({
            packageId: 'pkg_legacy',
            versionId: 'pkgv_legacy',
            manifestId,
            version: '1.0.0',
            manifest: { id: manifestId, name: 'Legacy', version: '1.0.0', objects: [] },
            installedAt: '2026-01-01T00:00:00.000Z',
            installedBy: 'admin',
        });
    }

    async function boot() {
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp);
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off' });
        await plugin.start(ctx as any);
        await fire();
        const register = (ctx.getService('manifest') as any).register as ReturnType<typeof vi.fn>;
        const registered = register.mock.calls.map((call: any[]) => call[0]?.id);
        return {
            ctx,
            registered,
            install: async (manifest: any) =>
                rawApp.routes.get('POST /api/v1/marketplace/install-local')!(makeC({ manifest })),
        };
    }

    it('installs into <OS_HOME>/installed-packages, never the working directory', async () => {
        vi.stubEnv('OS_HOME', home);
        const { install } = await boot();

        const res = await install(MANIFEST);

        expect(res.payload?.success).toBe(true);
        expect(res.payload.data.storageDir).toBe(homeLedger());
        expect(readdirSync(homeLedger())).toEqual(['com.acme.crm.json']);
        expect(existsSync(legacyDir())).toBe(false);
    });

    it('a second instance under another OS_HOME does not rehydrate the first one\'s install', async () => {
        vi.stubEnv('OS_HOME', home);
        expect((await (await boot()).install(MANIFEST)).payload?.success).toBe(true);

        vi.stubEnv('OS_HOME', join(dir, 'other-home'));
        const second = await boot();

        expect(second.registered).not.toContain(MANIFEST.id);
    });

    it('adopts the working-directory ledger once, leaving the old files in place', async () => {
        writeLegacyEntry();
        vi.stubEnv('OS_HOME', home);

        const first = await boot();

        // Rehydrated from its new place, and said so.
        expect(first.registered).toContain('com.acme.legacy');
        expect(readdirSync(homeLedger())).toEqual(['com.acme.legacy.json']);
        expect(first.ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining(`from ${legacyDir()} into ${homeLedger()}`));
        // Copied, not moved: an OS_HOME pointed at a throwaway directory must
        // never take the project's installs with it.
        expect(readdirSync(legacyDir())).toEqual(['com.acme.legacy.json']);

        // Once: the ledger directory exists now, so an uninstall there sticks —
        // the old file is not read again.
        new LocalManifestSource(homeLedger()).remove('com.acme.legacy');
        const second = await boot();
        expect(second.registered).not.toContain('com.acme.legacy');
        expect(second.ctx.logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('copied'));
    });

    it('a `--fresh` home adopts nothing — the run starts without earlier installs', async () => {
        writeLegacyEntry();
        vi.stubEnv('OS_HOME', home);
        vi.stubEnv(FRESH_HOME_CHANNEL_ENV, home);

        const { registered } = await boot();

        expect(registered).not.toContain('com.acme.legacy');
        expect(existsSync(homeLedger())).toBe(false);
        expect(readdirSync(legacyDir())).toEqual(['com.acme.legacy.json']);
    });

    it('a fresh-home channel naming ANOTHER home does not stop the adoption', async () => {
        writeLegacyEntry();
        vi.stubEnv('OS_HOME', home);
        vi.stubEnv(FRESH_HOME_CHANNEL_ENV, join(dir, 'some-earlier-fresh-home'));

        const { registered } = await boot();

        expect(registered).toContain('com.acme.legacy');
    });

    it('with OS_HOME unset the ledger stays in the working directory — nothing to adopt', async () => {
        writeLegacyEntry();
        vi.stubEnv('OS_HOME', '');

        const { registered, ctx } = await boot();

        expect(registered).toContain('com.acme.legacy');
        expect(ctx.logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('copied'));
    });

    it('a copy that fails is an error naming both directories, and no half-made ledger is left', async () => {
        writeLegacyEntry();
        // OS_HOME is a FILE: the ledger directory under it can never be made.
        writeFileSync(home, 'not a directory');
        vi.stubEnv('OS_HOME', home);

        const { registered, ctx } = await boot();

        expect(registered).not.toContain('com.acme.legacy');
        expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining(`ledgered in ${legacyDir()} are NOT loaded`));
        expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining(homeLedger()));
        expect(readdirSync(legacyDir())).toEqual(['com.acme.legacy.json']);
    });
});
