// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ⛔ [#8976] THIS FILE IS NOT AN AUTHORIZATION TEST. Do not read it as one.
//
// "tenancy posture" here selects WHICH SEEDING PATH runs — inline versus the
// per-org replay — and how the resulting rows are scoped. It never asks who the
// caller is or what they may do; a caller with no session at all reached every
// assertion in this file unchanged, which is exactly what #8976 measured and
// closed. `postureEnforcesWall` is about DATA scope, not admission.
//
// Auditing whether install-local is gated? The file that answers that is
// `marketplace-install-local-capability-enumeration.test.ts` — every mutating
// route, derived from the plugin's own route table, against three principals.
// The final `describe` in this file asserts that companion still exists, so
// this pointer cannot quietly rot into a wrong answer.
//
// #5262 — the marketplace local-install plugin's two seeding decisions ask
// whether an organization wall is IN FORCE, never the demoted
// `OS_MULTI_ORG_ENABLED` boolean.
//
// ADR-0105 D1 made `OS_TENANCY_POSTURE` the canonical knob and demoted
// `OS_MULTI_ORG_ENABLED` to a back-compat INPUT of `resolveTenancyPosture()`.
// Both sites kept calling `resolveMultiOrgEnabled()`, so on a deployment
// configured the documented way (posture knob only):
//
//   • the INSTALL-TIME seed (`applySideEffects`, the write path) never resolved
//     an active organization and wrote every sample row with NO
//     `organization_id` — landing the whole app's data outside the wall that
//     every subsequent read applies. The rows exist and nobody can see them.
//   • the REHYDRATE-TIME heal re-ran the bundled datasets on a walled
//     deployment instead of leaving them to the per-org replay, adding more of
//     the same NULL-org rows on every cold boot.
//
// Same shape as cloud#1020 and #5233, two sites over.
//
// The judge is the EFFECTIVE posture (the `tenancy` service), not the requested
// one: both sites are really asking "will the per-org replay own this instead
// of me?", and on a DEGRADED boot that replay does not exist. The degraded
// scenarios below pin that, and they are what separate this from a
// requested-posture fix.
//
// Real plugin, real routes, real ledger on a real temp dir, real env resolution.
// Only `SeedLoaderService` is substituted (the same seam the sibling suites in
// this package use) so the assertions can read what the seeder was ASKED to do.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let seedResult: any = { summary: { totalInserted: 2, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
let loadCalls: any[] = [];

vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load(request: any) { loadCalls.push(request); return seedResult; }
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

/**
 * @param effectivePosture the `tenancy` service's posture IN FORCE, as
 *   plugin-auth registers it, or `undefined` for a lean embedding with no such
 *   service — which exercises the requested-posture fallback.
 */
function makeCtx(rawApp: any, services: Record<string, any>, effectivePosture?: string) {
    const hooks = new Map<string, any>();
    return {
        ctx: {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => rawApp };
                if (name === 'tenancy') {
                    if (!effectivePosture) throw new Error('no tenancy');
                    return { posture: effectivePosture };
                }
                const svc = services[name];
                if (svc === undefined) throw new Error(`no ${name}`);
                return svc;
            },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        },
        fire: async () => { await hooks.get('kernel:ready')?.(); },
    };
}

function makeC(body: any, manifestId?: string) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: (k: string) => (k === 'manifestId' ? manifestId : undefined),
            header: () => undefined,
        },
        json,
    };
}

const MANIFEST = {
    id: 'app.test.crm',
    version: '1.0.0',
    objects: [{ name: 'crm_x', fields: { name: { type: 'text' } } }],
    data: [{ object: 'crm_x', records: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] }],
};

/** No `sys_organization` rows and no active org on the request. */
const SERVICES = (findRows: Record<string, any[]> = {}) => ({
    manifest: { register: vi.fn() },
    auth: installerAuthService(),
    objectql: withInstallerGrants({
        syncSchemas: async () => undefined,
        find: vi.fn(async (object: string) => findRows[object] ?? []),
    }),
    metadata: {},
    driver: { delete: vi.fn(async () => true) },
});

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_LEGACY = process.env.OS_MULTI_ORG_ENABLED;

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-posture-'));
    seedResult = { summary: { totalInserted: 2, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
    loadCalls = [];
    delete process.env.OS_TENANCY_POSTURE;
    delete process.env.OS_MULTI_ORG_ENABLED;
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
    if (OLD_LEGACY === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = OLD_LEGACY;
    vi.restoreAllMocks();
});

const setEnv = (env: { posture?: string; legacy?: string }) => {
    if (env.posture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = env.posture;
    if (env.legacy === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = env.legacy;
};

// ───────────────────────────────────────────────────────────────────────────
// Site B — install-time seeding (the WRITE path)
// ───────────────────────────────────────────────────────────────────────────

/** Install the manifest with `seedNow`, and report what the seeder was asked. */
async function installUnder(
    env: { posture?: string; legacy?: string },
    effectivePosture?: string,
) {
    setEnv(env);
    const rawApp = makeRawApp();
    const { ctx, fire } = makeCtx(rawApp, SERVICES(), effectivePosture);
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await fire();

    const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(
        makeC({ manifest: MANIFEST }),
    );
    return { res, ctx, seeded: res.payload?.data?.seeded ?? res.payload?.data };
}

describe('#5262 — install-time seeding respects the organization wall in force', () => {
    it('posture-only walled deployment does NOT inline-seed NULL-org rows', async () => {
        // THE regression on the write path. With no active organization
        // resolvable, a walled deployment must SKIP rather than write rows that
        // land outside its own wall. Before the fix the demoted boolean read
        // false and these rows were written org-less.
        const { ctx } = await installUnder({ posture: 'isolated' }, 'isolated');

        expect(loadCalls).toHaveLength(0);
        expect(
            (ctx.logger.warn as any).mock.calls.some((c: any[]) =>
                String(c[0]).includes('no active org'),
            ),
        ).toBe(true);
    });

    it('`group` is a walled posture too', async () => {
        await installUnder({ posture: 'group' }, 'group');
        expect(loadCalls).toHaveLength(0);
    });

    it('falls back to the requested posture with no tenancy service wired', async () => {
        await installUnder({ posture: 'isolated' });
        expect(loadCalls).toHaveLength(0);
    });

    it('DEGRADED boot seeds inline — there is no per-org replay to defer to', async () => {
        // A wall was requested, the enterprise runtime is absent, the operator
        // opted in. Nothing isolates this deployment's data, so the rows land
        // inline with no organization — which is what every row looks like on an
        // unwalled stack. Deferring would leave the installed app permanently
        // empty. This is the assertion a requested-posture fix fails.
        await installUnder({ posture: 'isolated' }, 'single');

        expect(loadCalls).toHaveLength(1);
        expect(loadCalls[0].config.organizationId).toBeUndefined();
    });

    it('legacy-boolean-only deployment keeps working — back-compat', async () => {
        await installUnder({ legacy: 'true' });
        expect(loadCalls).toHaveLength(0);
    });

    it('single-org deployments still seed inline, org-less', async () => {
        await installUnder({ posture: 'single' }, 'single');
        expect(loadCalls).toHaveLength(1);
        expect(loadCalls[0].config.organizationId).toBeUndefined();
    });

    it('an explicit legacy `false` does not veto the authoritative posture', async () => {
        await installUnder({ posture: 'isolated', legacy: 'false' });
        expect(loadCalls).toHaveLength(0);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Site A — rehydrate-time sample-data heal
// ───────────────────────────────────────────────────────────────────────────

/** Pre-write a ledger entry, then boot a fresh plugin so rehydrate runs. */
async function rehydrateUnder(
    env: { posture?: string; legacy?: string },
    effectivePosture?: string,
) {
    setEnv(env);
    new LocalManifestSource(dir).write({
        packageId: 'pkg_1',
        versionId: 'pkgv_1',
        manifestId: MANIFEST.id,
        version: MANIFEST.version,
        manifest: MANIFEST,
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'admin',
        withSampleData: false,
    } as any);
    const rawApp = makeRawApp();
    // Every seeded object empty → the healer WOULD run, if the posture let it.
    const { ctx, fire } = makeCtx(rawApp, SERVICES({ crm_x: [] }), effectivePosture);
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await fire();
    return { ctx };
}

describe('#5262 — rehydrate heal leaves walled deployments to the per-org replay', () => {
    it('posture-only walled deployment does NOT heal', async () => {
        // THE regression on the heal path: before the fix a walled posture-only
        // deployment re-seeded org-less rows on every cold boot.
        const { ctx } = await rehydrateUnder({ posture: 'isolated' }, 'isolated');

        expect(loadCalls).toHaveLength(0);
        expect(
            (ctx.logger.info as any).mock.calls.some((c: any[]) =>
                String(c[0]).includes('left to per-org replay'),
            ),
        ).toBe(true);
    });

    it('`group` is a walled posture too', async () => {
        await rehydrateUnder({ posture: 'group' }, 'group');
        expect(loadCalls).toHaveLength(0);
    });

    it('falls back to the requested posture with no tenancy service wired', async () => {
        await rehydrateUnder({ posture: 'isolated' });
        expect(loadCalls).toHaveLength(0);
    });

    it('DEGRADED boot DOES heal — same reasoning as the install path', async () => {
        await rehydrateUnder({ posture: 'isolated' }, 'single');
        expect(loadCalls).toHaveLength(1);
    });

    it('legacy-boolean-only deployment keeps working — back-compat', async () => {
        await rehydrateUnder({ legacy: 'true' });
        expect(loadCalls).toHaveLength(0);
    });

    it('single-org deployments still heal', async () => {
        await rehydrateUnder({ posture: 'single' }, 'single');
        expect(loadCalls).toHaveLength(1);
    });
});

/**
 * [#8976] The scope disclaimer at the top of this file, made EXECUTABLE.
 *
 * A prose pointer to "the file that actually pins authorization" is worth
 * exactly as much as its target's continued existence, and nothing warns you
 * when a rename or a delete turns it into a confident wrong answer — which is
 * the precise failure this whole card is about: a green test that reads as
 * coverage it does not provide. So the pointer is asserted, not merely written.
 * If the enumeration pin moves, this goes red and the sentence above gets
 * corrected instead of quietly lying to the next auditor.
 */
describe('#8976 — what this file does NOT cover', () => {
    it('points at the companion that DOES pin authorization, and it still exists', () => {
        expect(existsSync(new URL('./marketplace-install-local-capability-enumeration.test.ts', import.meta.url)))
            .toBe(true);
    });
});
