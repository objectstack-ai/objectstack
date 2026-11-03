// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28534] Every package the install-local door registers is registered as
 * `'marketplace'` — every member of a `packages[]` bundle included, whatever
 * its entry states — at the install and at the restart's rehydrate.
 *
 * ## The defect, read before the fix
 *
 * The door handed the bundle to the `manifest` service with
 * `{ source: 'marketplace' }`, and the service stamps an entry's own `source`
 * over the door's (`ArtifactPackageSchema.source`, pinned for a merged boot
 * artifact by `@objectstack/objectql`'s `package-source-stamp.test.ts`). So an
 * installed bundle whose member said `source: 'code'` landed a `'code'` row,
 * and every reader of a package's origin — the connector materializer judging
 * whose root a file ref resolves against among them — read that installed
 * member as the host's own code.
 *
 * The door, not the service, now says what it registers
 * (`asMarketplaceRegistration`), so the boot's merged-artifact precedence is
 * untouched. The engine and its `manifest` service are REAL (an
 * `ObjectKernel` with `ObjectQLPlugin`): the row's `source` is what is pinned.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The plugin reaches `@objectstack/runtime` through a lazy `import()`; its first
// load is paid here, at module top, never inside a clocked `it`.
import '@objectstack/runtime';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { MarketplaceInstallLocalPlugin, asMarketplaceRegistration } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Bag = Record<string, any>;
type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
const BUNDLE = 'com.probe.membersource';
const MEMBER = 'com.probe.membersource.extra';

const body = (id: string, namespace: string) => ({ id, name: namespace, namespace, version: '1.0.0', type: 'app' });
/** A two-member bundle: the wrapper's own id is one member's, the other member states `source: 'code'`. */
const bundle = (): Bag => ({
    ...body(BUNDLE, 'probems'),
    packages: [
        { manifest: body(BUNDLE, 'probems') },
        { manifest: body(MEMBER, 'probemsx'), source: 'code' },
    ],
});

let dir: string;
const kernels: ObjectKernel[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-member-source-')); });
afterEach(async () => {
    while (kernels.length) {
        const k = kernels.pop()!;
        if (k.getState() === 'running') await k.shutdown();
    }
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/** The plugin over a REAL engine and `manifest` service, booted to `kernel:ready` (which runs the rehydrate). */
async function bootPlugin() {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';
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
    const ctx = {
        hook: (e: string, h: () => Promise<void>) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    // Side readers that need services this harness does not carry; what is pinned is the row.
    const p = plugin as unknown as Record<string, unknown>;
    p.bindArtifactHandlers = async () => undefined;
    p.applySideEffects = async () => ({ seeded: { mode: 'none' } });
    p.maybeHealSampleData = async () => ({ seeded: { mode: 'none' } });
    await plugin.start(ctx as never);
    await hooks.get('kernel:ready')?.();
    const install = async (manifest: Bag) => {
        const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
        return routes.get(`POST ${ROUTE}`)!({
            req: {
                url: `http://localhost:3000${ROUTE}`,
                raw: new Request('http://localhost:3000/x'),
                json: async () => ({ manifest }),
                param: () => undefined,
            },
            json,
        });
    };
    return { ql, install };
}

const sourceOf = (ql: ObjectQL, id: string) => (ql.registry.getPackage(id) as { source?: unknown } | undefined)?.source;

describe('[#28534] install-local registers every member of a bundle as marketplace, whatever its entry states', () => {
    it('install: the member whose entry states `code` records `marketplace`, beside its sibling', async () => {
        const { ql, install } = await bootPlugin();
        const answer = await install(bundle());
        expect(answer.status, JSON.stringify(answer.payload)).toBe(200);
        expect([sourceOf(ql, BUNDLE), sourceOf(ql, MEMBER)]).toEqual(['marketplace', 'marketplace']);
    });

    it('rehydrate: a ledger entry written before this rule, with a member stating `code`, records `marketplace` after the restart', async () => {
        new LocalManifestSource(dir).write({
            packageId: BUNDLE,
            versionId: 'local',
            manifestId: BUNDLE,
            version: '1.0.0',
            manifest: bundle(),
            installedAt: '2026-01-01T00:00:00.000Z',
            installedBy: 'admin',
            withSampleData: false,
        });
        const { ql } = await bootPlugin();
        expect([sourceOf(ql, BUNDLE), sourceOf(ql, MEMBER)]).toEqual(['marketplace', 'marketplace']);
    });
});

describe('asMarketplaceRegistration', () => {
    it('restates every entry whose source is not marketplace, on a copy; the caller\'s artifact is untouched', () => {
        const artifact = bundle();
        const out = asMarketplaceRegistration(artifact);
        expect(out).not.toBe(artifact);
        expect(out.packages.map((e: Bag) => e.source)).toEqual([undefined, 'marketplace']);
        expect(out.packages[0], 'an entry stating none is handed through as received').toBe(artifact.packages[0]);
        expect(artifact.packages[1].source).toBe('code');
    });

    it('CONTROL: an artifact with nothing to restate — no `packages[]`, or entries stating none or marketplace — is handed back by reference', () => {
        const single = body(BUNDLE, 'probems');
        const quiet = { ...single, packages: [{ manifest: single }, { manifest: body(MEMBER, 'x'), source: 'marketplace' }] };
        expect(asMarketplaceRegistration(single)).toBe(single);
        expect(asMarketplaceRegistration(quiet)).toBe(quiet);
    });
});
