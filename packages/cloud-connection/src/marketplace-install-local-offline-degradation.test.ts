// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8343 — what an `OS_CLOUD_URL=off` runtime gets when the CLI mounts this
 * plugin anyway.
 *
 * The CLI now mounts the local-install surface on a runtime with no control
 * plane (framework `serve.ts`), because its inline-manifest branch is the
 * documented air-gapped install path and needs no cloud. That fix rests on a
 * property of THIS plugin which nothing here asserted: with no cloud URL, the
 * CATALOG branch degrades locally instead of dialling out. Untested, the fix
 * would be one refactor away from pointing an air-gapped box at the public
 * cloud and hanging on an install it can never complete.
 *
 * So this pins the pair that makes "mount it unconditionally" safe:
 *
 *   - no inline manifest + no cloud  -> 503 MARKETPLACE_UNAVAILABLE, locally,
 *   - an inline manifest             -> served without consulting a cloud URL.
 *
 * The rejection assertion names the CODE and the STATUS (ADR-0112 envelope).
 * `expect(...).toThrow()`-shaped coverage would be blind here in both
 * directions: this handler never throws, and a 404 from an unmounted route
 * would satisfy a status-only check just as happily as the fix does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

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
        'http-server': { getRawApp: () => rawApp },
        manifest: { register: vi.fn() },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas: async () => undefined, find: vi.fn(async () => []) }),
        metadata: {},
    };
    return {
        ctx: {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: (name: string) => {
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
            header: () => undefined,
        },
        json,
    };
}

/** Boot the plugin with the cloud explicitly OFF and hand back its POST route. */
async function offlinePostRoute(dir: string): Promise<Handler> {
    const rawApp = makeRawApp();
    const { ctx, fire } = makeCtx(rawApp);
    // Exactly how the CLI constructs it on a cloud-less runtime: the `off`
    // sentinel, never '' — resolveCloudUrl() reads '' as "unset" and would
    // substitute the PUBLIC default.
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await fire();
    return rawApp.routes.get('POST /api/v1/marketplace/install-local')!;
}

let dir: string;
const OLD_CLOUD_URL = process.env.OS_CLOUD_URL;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-offline-'));
    // The measured deployment's own setting. Set explicitly so the assertions
    // cannot be carried by a stray ambient value on a developer's machine.
    process.env.OS_CLOUD_URL = 'off';
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (OLD_CLOUD_URL === undefined) delete process.env.OS_CLOUD_URL;
    else process.env.OS_CLOUD_URL = OLD_CLOUD_URL;
    vi.restoreAllMocks();
});

describe('#8343 — install-local on a runtime with no control plane', () => {
    it('mounts its routes at all (the surface the fix restores)', async () => {
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp);
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(ctx as any);
        await fire();

        // The 404 pair the customer measured was the ABSENCE of exactly these.
        expect([...rawApp.routes.keys()]).toEqual(
            expect.arrayContaining([
                'POST /api/v1/marketplace/install-local',
                'GET /api/v1/marketplace/install-local',
            ]),
        );
    });

    it('a CATALOG install degrades locally — 503 MARKETPLACE_UNAVAILABLE', async () => {
        const post = await offlinePostRoute(dir);

        // No inline manifest: this is the branch that genuinely needs a cloud.
        const res = await post(makeC({ packageId: 'app.objectstack.hotcrm' }));

        expect(res.status).toBe(503);
        expect(res.payload?.error?.code).toBe('MARKETPLACE_UNAVAILABLE');
        expect(res.payload?.success).toBe(false);
    });

    it('an INLINE manifest install is served — no cloud consulted', async () => {
        const post = await offlinePostRoute(dir);

        const res = await post(makeC({
            manifest: {
                id: 'app.objectstack.hotcrm',
                version: '1.0.0',
                objects: [{ name: 'hotcrm_lead', fields: { name: { type: 'text' } } }],
            },
        }));

        // The point is that it did NOT take the cloud branch. Asserting "not
        // 503" rather than a success envelope keeps this test about the
        // routing decision instead of re-testing the installer the sibling
        // suites already cover end to end.
        expect(res.status).not.toBe(503);
        expect(res.payload?.error?.code).not.toBe('MARKETPLACE_UNAVAILABLE');
    });
});
