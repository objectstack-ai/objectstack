// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A corrupt ledger entry is REPORTED by both runtime consumers (#5413).
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `LocalManifestSource.list()` dropped unparseable files in an un-bound
 * per-file `catch` and returned a bare array, so a short list was
 * indistinguishable from a complete one — no difference in the return value,
 * no log, no count. The two consumers in this file both gave a confidently
 * wrong answer:
 *
 *   • `rehydrate()` — the installed app was never registered with the kernel.
 *     It vanished from the runtime (absent from the app switcher, its objects
 *     nonexistent) and not one line was written about it. The function warns
 *     when it cannot get the `manifest` service, but said nothing about
 *     reading fewer entries than the ledger holds.
 *   • `handleList()` — the console's "Installed Apps" list came back short,
 *     with `success: true`.
 *
 * Skipping the file was always right — one truncated manifest must not stop a
 * runtime booting the packages that are fine. Skipping it SILENTLY was the
 * defect.
 *
 * ── What is pinned here ──────────────────────────────────────────────────
 *
 * That each consumer names the file and quotes the cause, that the wire shape
 * of `handleList()` is UNCHANGED (reporting the skip in the response body is a
 * separate decision about that endpoint's schema, deliberately not made), and
 * that an all-corrupt ledger — the worst case, every app missing — is not the
 * one case that stays quiet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The heal path pulls in the seed loader; stub it exactly as the heal suite
// does so these tests exercise rehydrate's reporting, not seeding.
vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load() { return { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 }, errors: [] }; }
    },
    recordSeedOutcome: vi.fn(),
}));
vi.mock('@objectstack/spec/data', () => ({
    SeedLoaderRequestSchema: { parse: (x: any) => x },
}));

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

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
        objectql: withInstallerGrants({ syncSchemas: async () => undefined, find: vi.fn(async () => [{ id: 'x' }]) }),
        metadata: {},
        // #5426's two handlers authenticate first; without this they answer 401
        // and never reach the ledger read under test.
        auth: installerAuthService(),
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

/** A Hono-ish context. `manifestId` carries the `:manifestId` route value. */
function makeC(manifestId?: string) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => ({}),
            param: (k: string) => (k === 'manifestId' ? manifestId : undefined),
            header: () => undefined,
        },
        json,
    };
}

const GOOD_MANIFEST = {
    id: 'app.test.crm',
    version: '1.0.0',
    objects: [{ name: 'crm_x', fields: { name: { type: 'text' } } }],
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-corrupt-')); });
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

function writeGoodEntry(manifestId = GOOD_MANIFEST.id) {
    new LocalManifestSource(dir).write({
        packageId: 'pkg_1',
        versionId: 'pkgv_1',
        manifestId,
        version: GOOD_MANIFEST.version,
        manifest: { ...GOOD_MANIFEST, id: manifestId },
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'admin',
    });
}

/** The issue's repro verbatim — truncated mid-object. */
function writeBrokenEntry(file = 'broken.json') {
    writeFileSync(join(dir, file), '{"manifestId":"broken","manifest":{"objects":[{"name":"acct"', 'utf8');
}

/**
 * #5426's repro: a truncated file at the ledger path a given manifest id maps
 * to — so `has()` answers TRUE and `read()` cannot parse it, which is exactly
 * the state reseed and purge walked into.
 */
function writeCorruptEntryFor(manifestId: string) {
    writeFileSync(join(dir, `${manifestId}.json`), `{"manifestId":"${manifestId}","manifest":{"data":[`, 'utf8');
}

/** Boot a fresh plugin so `kernel:ready` runs rehydrate + mounts the routes. */
async function boot() {
    const rawApp = makeRawApp();
    const { ctx, fire } = makeCtx(rawApp);
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await fire();
    return { rawApp, ctx };
}

const warnings = (ctx: any): string[] => ctx.logger.warn.mock.calls.map((c: any[]) => String(c[0]));

describe('rehydrate() — an installed app that disappears now says so', () => {
    it('warns per corrupt entry, naming the file and quoting the cause', async () => {
        writeGoodEntry();
        writeBrokenEntry();

        const { ctx } = await boot();
        const said = warnings(ctx);

        // ① THE assertion of this issue. Before #5413 no line existed under any
        // log level: the thrown object was discarded where it was caught.
        const row = said.find((s) => s.includes('broken.json'));
        expect(row).toBeDefined();
        // ② The consequence, stated — an app is missing from this runtime.
        expect(row).toContain('NOT registered in this runtime');
        // ③ The cause, quoted from the thrower rather than paraphrased.
        expect(row).toMatch(/JSON/i);
        // ④ The fix: the absolute path of the file to repair or delete.
        expect(row).toContain(join(dir, 'broken.json'));
    });

    it('still registers the entries that ARE readable', async () => {
        // Skipping stays deliberate: one bad file must not cost the good apps.
        writeGoodEntry();
        writeBrokenEntry();

        const { ctx } = await boot();

        // Counted over LEDGER manifests only: this plugin also registers its
        // own "Installed Apps" Setup nav bundle at `kernel:ready`, which is not
        // a rehydration and would make a bare call count read 2.
        const rehydrated = ctx.getService('manifest').register.mock.calls
            .map((c: any[]) => c[0]?.id)
            .filter((id: unknown) => id === GOOD_MANIFEST.id);
        expect(rehydrated).toEqual([GOOD_MANIFEST.id]);
    });

    it('warns even when EVERY entry is corrupt — the worst case, not the quiet one', async () => {
        // `rehydrate()` returns early on an empty entry list. Reporting after
        // that return would leave the total-loss case as the single path that
        // still said nothing at all.
        writeBrokenEntry('a.json');
        writeBrokenEntry('b.json');

        const { ctx } = await boot();
        const said = warnings(ctx);

        expect(said.some((s) => s.includes('a.json'))).toBe(true);
        expect(said.some((s) => s.includes('b.json'))).toBe(true);
    });

    it('says nothing about the ledger when every entry is intact', async () => {
        // The row is a FINDING, not a status line — a clean ledger must leave
        // the boot log as it was.
        writeGoodEntry();

        const { ctx } = await boot();

        expect(warnings(ctx).some((s) => s.includes('unreadable ledger entry'))).toBe(false);
    });

    it('reports an unreadable file, not only an unparseable one', async () => {
        // A directory named `*.json`: `readFileSync` throws EISDIR. Same silent
        // drop before #5413, different repair — which is why the cause travels.
        mkdirSync(join(dir, 'notafile.json'));

        const { ctx } = await boot();

        expect(warnings(ctx).some((s) => s.includes('notafile.json') && s.includes('EISDIR'))).toBe(true);
    });
});

describe('handleList() — the console list that looked complete', () => {
    it('reports the skipped entry in the log', async () => {
        writeGoodEntry();
        writeBrokenEntry();

        const { rawApp, ctx } = await boot();
        ctx.logger.warn.mockClear(); // isolate the GET from rehydrate's own warns
        const c = makeC();
        await rawApp.routes.get('GET /api/v1/marketplace/install-local')!(c);

        const row = warnings(ctx).find((s) => s.includes('broken.json'));
        expect(row).toBeDefined();
        // Named for what the CONSUMER lost, not for what the producer did.
        expect(row).toContain('MISSING from the installed-apps list');
    });
});

/**
 * #5426 — the OTHER return contract in the same file: `read()`.
 *
 * These two handlers already branch on the null (unlike `list()`'s short array,
 * which nobody could see), so the defect here is lighter — but the answer they
 * could give was `500 Failed to read manifest cache.` and nothing else, after
 * `has()` had just confirmed the file exists.
 */
describe('handleReseed() / handlePurge() — the 500 that pointed at itself', () => {
    it.each([
        ['reseed', 'reseed-sample-data', 'reseed sample data'],
        ['purge', 'purge-sample-data', 'purge sample data'],
    ])('%s: the 500 names the file and quotes the cause (#5426)', async (_label, route, attempted) => {
        // ── The defect ───────────────────────────────────────────────────
        // Both handlers call `has()` (true — the file IS there) and then
        // `read()`, which answered `null` for "absent OR unreadable" and threw
        // the reason away in an un-bound `catch`. The operator got
        // `500 Failed to read manifest cache.` — a sentence whose only content
        // is that the thing it just did failed, with `has()` having just said
        // the opposite one line earlier, and nothing in the server log.
        writeCorruptEntryFor('app.test.crm');
        const { rawApp, ctx } = await boot();
        ctx.logger.warn.mockClear(); // isolate from rehydrate's own warns

        const c = makeC('app.test.crm');
        const res = await rawApp.routes.get(`POST /api/v1/marketplace/install-local/:manifestId/${route}`)!(c);

        // ① The wire CODE is unchanged — the same failure, newly explained. A
        //    client branching on the code must not have to change.
        expect(res.status).toBe(500);
        expect(res.payload.error.code).toBe('MARKETPLACE_STORAGE_FAILED');
        // ② THE assertion of this issue: the thrower's own words reach the
        //    operator holding the failed response.
        expect(res.payload.error.message).toMatch(/JSON/i);
        // ③ …together with the file to repair. Self-reference → an address.
        expect(res.payload.error.message).toContain(join(dir, 'app.test.crm.json'));
        expect(res.payload.error.message).toContain('app.test.crm');
        // ④ And a durable copy in the server log, for whoever reads it later
        //    instead of the HTTP response.
        const row = warnings(ctx).find((s) => s.includes('app.test.crm.json'));
        expect(row).toBeDefined();
        expect(row).toContain(`cannot ${attempted}`);
        expect(row).toMatch(/JSON/i);
    }, 60_000);

    it('reseed: an unreadable file, not only an unparseable one, is explained', async () => {
        // EISDIR, not a parse error — a different repair, which is exactly why
        // the cause travels unwrapped instead of being summarised at the catch.
        mkdirSync(join(dir, 'app.test.crm.json'));
        const { rawApp } = await boot();

        const c = makeC('app.test.crm');
        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data')!(c);

        expect(res.status).toBe(500);
        expect(res.payload.error.code).toBe('MARKETPLACE_STORAGE_FAILED');
        expect(res.payload.error.message).toContain('EISDIR');
    }, 60_000);

    it('reseed: a package that was never installed still gets 404, not the storage 500', async () => {
        // The other half of the split. `read()` distinguishing the two nulls
        // must not make "never installed" start reading as "corrupt": that
        // answer belongs to `has()` and stays a 404.
        const { rawApp } = await boot();

        const c = makeC('app.test.nope');
        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data')!(c);

        expect(res.status).toBe(404);
        expect(res.payload.error.code).toBe('RESOURCE_NOT_FOUND');
    }, 60_000);
});

describe('handleList() — the wire shape it kept', () => {
    it('leaves the wire shape untouched — the readable entries, as before', async () => {
        // ⛔ Deliberate: the skip is NOT added to the response body. Changing
        // this endpoint's schema is a separate decision (see the handler's
        // comment); #5413 only removes the case where nobody could have known.
        writeGoodEntry();
        writeBrokenEntry();

        const { rawApp } = await boot();
        const c = makeC();
        await rawApp.routes.get('GET /api/v1/marketplace/install-local')!(c);

        const [payload, status] = c.json.mock.calls[0]!;
        expect(status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.data.items).toHaveLength(1);
        expect(payload.data.items[0].manifestId).toBe(GOOD_MANIFEST.id);
        expect(payload.data.total).toBe(1);
        // No new key smuggled into the response under cover of the fix.
        expect(Object.keys(payload.data).sort()).toEqual(['items', 'storageDir', 'total']);
    });
});
