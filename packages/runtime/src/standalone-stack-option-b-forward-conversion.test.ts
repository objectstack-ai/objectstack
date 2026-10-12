// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23027] An option-B artifact built before a retirement boots through the
 * runtime's own loader, the composition `os dev -a` and `os start` use.
 *
 * A multi-package artifact (ADR-0130 D4, option B) carries its collections in
 * `packages[i].manifest`, and every runtime reader parses each body strictly
 * (`resolveArtifactPackageOrder`, reached through `resolveArtifactCollections`
 * and the `manifest` service). The first of them, `createStandaloneStack`'s
 * surfaced stack, refused a body still spelling a retired key before the
 * metadata door's own conversion could run. Measured at `os dev -a … --fresh`:
 * health `000`, "`packages[1]` is not a package entry (ADR-0130 D4):
 * manifest.dashboards.0.refreshInterval". `loadArtifactBundle` now converts the
 * loaded bundle once (`convertArtifactAtLoad`), so every reader is handed the
 * converted bodies; the database resolver, which reads the file itself, calls
 * the same function.
 *
 * The reach, the window and the whole step over a body are pinned in
 * `@objectstack/metadata-core` (`artifact-forward-conversion-package-body.test.ts`),
 * and the metadata door in `@objectstack/metadata`. This file pins the boot.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALL_CONVERSIONS } from '@objectstack/spec';
import { applyArtifactForwardConversions, resolveInstalledSpecVersion } from '@objectstack/metadata-core';
import { Runtime } from './runtime.js';
import { createStandaloneStack } from './standalone-stack.js';
import { loadArtifactBundle } from './load-artifact-bundle.js';
import { resolveProjectDatabaseUrl } from './resolve-project-database.js';

// [#10126] Pay the first transform of the dist-resolved workspace deps the boot
// reaches through a dynamic `import()` at MODULE LOAD, never inside a clocked `it`.
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const BOOT_TIMEOUT = 120_000;
const ORDERS_ID = 'com.test.ob.orders';
const CORE_ID = 'com.test.ob.core';

type Bag = Record<string, any>;

const orders = (range: string): Bag => ({
    id: ORDERS_ID, namespace: 'ob', name: 'ob_orders', version: '2.0.0', type: 'module', engines: { protocol: range },
    dependencies: { [CORE_ID]: '^1.0.0' },
});
const core = (range: string): Bag => ({
    id: CORE_ID, namespace: 'ob', name: 'ob_core', version: '1.0.0', type: 'app', engines: { protocol: range },
});
const dashboard = (name: string, refresh: Record<string, number>) => ({ name, label: name, widgets: [], ...refresh });

/**
 * The shape `os build` writes for a two-package project: the artifact's own
 * `manifest` is its last package's, every collection sits in a body.
 */
function optionB(range: string, ordersBody: Bag, coreBody: Bag = {}): Bag {
    return {
        manifest: core(range),
        packages: [
            { manifest: { ...orders(range), ...ordersBody } },
            { manifest: { ...core(range), ...coreBody } },
        ],
    };
}

/** The first `x.y.z` past the installed label and every `retiredAfter`: a floor no window opens for. */
function currentSurfaceRange(): string {
    const triple = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10));
    const compare = (a: string, b: string) => {
        const [x, y] = [triple(a), triple(b)];
        for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
        return 0;
    };
    const installed = resolveInstalledSpecVersion();
    if (!installed) throw new Error('the installed @objectstack/spec version is unresolvable');
    const stamps = [installed, ...ALL_CONVERSIONS.flatMap((c) => (c.retiredFromLoadPath === true ? [c.retiredAfter] : []))];
    const [major, minor, patch] = triple([...stamps].sort(compare)[stamps.length - 1]!);
    return `^${major}.${minor}.${patch! + 1}`;
}

const dirs: string[] = [];

/** Write `artifact` as `objectstack.json` in a fresh project directory. */
function writeArtifact(tag: string, artifact: unknown): { dir: string; artifactPath: string } {
    const dir = mkdtempSync(join(tmpdir(), `os-23027-${tag}-`));
    dirs.push(dir);
    const artifactPath = join(dir, 'objectstack.json');
    writeFileSync(artifactPath, JSON.stringify(artifact), 'utf-8');
    return { dir, artifactPath };
}

/** Boot `artifact` the way `os dev -a` composes it. */
async function bootArtifact(tag: string, artifact: unknown): Promise<any> {
    const { dir, artifactPath } = writeArtifact(tag, artifact);
    const stack = await createStandaloneStack({
        artifactPath,
        projectRoot: dir,
        databaseUrl: ':memory:',
        skipSeedData: true,
        runPlatformMigrations: false,
    });
    const kernel = new Runtime({ cluster: false }).getKernel();
    for (const p of stack.plugins) await kernel.use(p as any);
    await kernel.bootstrap();
    return kernel;
}

/** The one dashboard named `name` that `GET /meta/dashboard` lists. */
async function listed(kernel: any, name: string): Promise<Bag> {
    const answer = await kernel.getService('protocol').getMetaItems({ type: 'dashboard' });
    const hits = (answer?.items as Bag[] | undefined)?.filter((i) => i?.name === name) ?? [];
    expect(hits, `GET /meta/dashboard must list exactly one ${name}`).toHaveLength(1);
    return hits[0]!;
}

/** The dashboard `GET /meta/dashboard/NAME` serves. */
async function served(kernel: any, name: string): Promise<Bag> {
    const answer = await kernel.getService('protocol').getMetaItem({ type: 'dashboard', name });
    expect(answer?.item, `GET /meta/dashboard/${name} must serve an item`).toBeDefined();
    return answer.item as Bag;
}

/** Both reads serve `name` as `refreshIntervalSeconds: seconds`, valid, owned by `packageId`. */
async function expectServedConverted(kernel: any, name: string, seconds: number, packageId: string) {
    for (const item of [await listed(kernel, name), await served(kernel, name)]) {
        expect(item.refreshIntervalSeconds).toBe(seconds);
        expect(item).not.toHaveProperty('refreshInterval');
        expect(item._diagnostics).toEqual({ valid: true });
        expect(item._packageId).toBe(packageId);
    }
}

afterAll(() => {
    for (const d of dirs.splice(0)) {
        try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
    }
});

describe('[#23027] the runtime\'s artifact load converts every package body once', () => {
    it('loadArtifactBundle hands back the converted body, and a second conversion (the metadata door\'s) finds nothing left', async () => {
        const { artifactPath } = writeArtifact('loader', optionB('^18', { dashboards: [dashboard('ob_overview', { refreshInterval: 300 })] }));
        const loaded = (await loadArtifactBundle(artifactPath, { unwrapEnvelope: true })) as Bag;

        expect(loaded.packages[0].manifest.dashboards).toEqual([dashboard('ob_overview', { refreshIntervalSeconds: 300 })]);
        // Idempotence, pinned once: what the door converts again on these bytes
        // comes back by reference, with no notice to print a second time.
        const again = applyArtifactForwardConversions(loaded);
        expect(again.verdict, 'the window is open on this input').not.toBe('authored-current');
        expect(again.notices).toEqual([]);
        expect(again.definition).toBe(loaded);
    });

    describe('boots: the body\'s dashboard is served as `refreshIntervalSeconds: 300` under its own package', () => {
        let kernel: any;
        beforeAll(async () => {
            kernel = await bootArtifact('subject', optionB('^18', { dashboards: [dashboard('ob_overview', { refreshInterval: 300 })] }));
        }, BOOT_TIMEOUT);
        afterAll(async () => { try { await kernel?.shutdown(); } catch { /* noop */ } });

        it('GET /meta/dashboard and GET /meta/dashboard/NAME serve the converted copy, valid, owned by the orders package', async () => {
            await expectServedConverted(kernel, 'ob_overview', 300, ORDERS_ID);
        });
    });

    describe('a multi-package artifact converts per body', () => {
        let kernel: any;
        beforeAll(async () => {
            kernel = await bootArtifact('multi', optionB(
                '^18',
                { dashboards: [dashboard('ob_overview', { refreshInterval: 300 })] },
                { dashboards: [dashboard('ob_core_overview', { refreshInterval: 120 })] },
            ));
        }, BOOT_TIMEOUT);
        afterAll(async () => { try { await kernel?.shutdown(); } catch { /* noop */ } });

        it('each body\'s dashboard is served converted under its own package', async () => {
            await expectServedConverted(kernel, 'ob_overview', 300, ORDERS_ID);
            await expectServedConverted(kernel, 'ob_core_overview', 120, CORE_ID);
        });
    });

    describe('CONTROL — a definition-collection artifact (no packages[]) is served exactly as before', () => {
        let kernel: any;
        beforeAll(async () => {
            kernel = await bootArtifact('control', {
                manifest: core('^18'),
                dashboards: [dashboard('ob_overview', { refreshInterval: 300 })],
            });
        }, BOOT_TIMEOUT);
        afterAll(async () => { try { await kernel?.shutdown(); } catch { /* noop */ } });

        it('GET /meta/dashboard and GET /meta/dashboard/NAME serve the converted copy, valid, owned by the artifact\'s package', async () => {
            await expectServedConverted(kernel, 'ob_overview', 300, CORE_ID);
        });
    });

    it('WINDOW SHUT — an artifact authored past every retirement is still refused, at the first reader, naming the body\'s site', async () => {
        const { dir, artifactPath } = writeArtifact('shut', optionB(currentSurfaceRange(), { dashboards: [dashboard('ob_overview', { refreshInterval: 300 })] }));
        const refusal = await createStandaloneStack({
            artifactPath,
            projectRoot: dir,
            databaseUrl: ':memory:',
            skipSeedData: true,
            runPlatformMigrations: false,
        }).then(() => undefined, (e: any) => e);

        expect(refusal, 'the boot is refused').toBeDefined();
        expect(refusal.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
        expect(refusal.status).toBe(422);
        expect(String(refusal.message)).toContain('packages[0]');
        expect(String(refusal.message)).toContain('manifest.dashboards.0.refreshInterval');
    });

    it('the database resolver, which reads the artifact file itself, resolves the declared default the body names', () => {
        // Before the resolver called the loader's conversion, this body was
        // refused there and the lookup DECLINED, while the loader converted the
        // same body and booted it, against the unified default database.
        const declared = {
            datasources: [{ name: 'ob_db', label: 'OB DB', driver: 'sqlite', config: { filename: './ob.db' } }],
            datasourceMapping: [{ default: true, datasource: 'ob_db' }],
        };
        for (const refresh of [{ refreshInterval: 300 }, { refreshIntervalSeconds: 300 }]) {
            const { dir, artifactPath } = writeArtifact('db', optionB('^18', { ...declared, dashboards: [dashboard('ob_overview', refresh)] }));
            const resolved = resolveProjectDatabaseUrl({ artifactPath, projectRoot: dir, env: {} });
            expect([resolved.source, resolved.url, resolved.datasourceName], JSON.stringify(refresh))
                .toEqual(['config-datasource', `file:${join(dir, 'ob.db')}`, 'ob_db']);
        }
    });
});
