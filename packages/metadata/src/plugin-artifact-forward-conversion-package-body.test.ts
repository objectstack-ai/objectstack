// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23027] An option-B artifact built before a retirement boots at the
 * metadata door, and the boot log names the package body that carried it.
 *
 * A multi-package artifact (ADR-0130 D4, option B) carries its collections in
 * `packages[i].manifest`. The door's strict parse (`ObjectStackDefinitionSchema`)
 * gates every body, so a dashboard still spelled `refreshInterval` inside a body
 * refused the whole artifact (`invalid_type` at
 * `packages.1.manifest.dashboards.0.refreshInterval`) while the same dashboard
 * in the definition's own `dashboards` converted. The conversion now runs the
 * same walk over each body (`applyArtifactForwardConversions`,
 * `@objectstack/metadata-core`), where the reach, the window and the whole
 * step over a body are pinned with injected labels. This file pins the real
 * door on this tree's installed label.
 *
 * The fixture is the shape `os build` writes for `examples/app-multi-package`:
 * the artifact's own `manifest` is its last package's, both packages declare
 * `engines.protocol: '^18'`, and every collection sits in a body.
 */

import { describe, it, expect, vi } from 'vitest';
import { ALL_CONVERSIONS } from '@objectstack/spec';
import { resolveInstalledSpecVersion } from '@objectstack/metadata-core';
import { MetadataPlugin } from './plugin.js';

const SUBJECT = 'dashboard-refresh-interval-to-refresh-interval-seconds';
const CORE_ID = 'com.example.ob.core';
const ORDERS_ID = 'com.example.ob.orders';

const core = (range: string) => ({
    id: CORE_ID, namespace: 'ob', name: 'ob_core', version: '1.0.0', type: 'app', engines: { protocol: range },
});
const orders = (range: string) => ({
    id: ORDERS_ID, namespace: 'ob', name: 'ob_orders', version: '2.0.0', type: 'module', engines: { protocol: range },
    dependencies: { [CORE_ID]: '^1.0.0' },
});
const dashboard = (name: string, refresh: Record<string, number>) => ({ name, label: name, widgets: [], ...refresh });

/** An option-B artifact; `ordersDashboard` adds a second body's dashboard. */
function artifact(range: string, refresh: Record<string, number>, ordersDashboard = false): any {
    return {
        manifest: core(range),
        packages: [
            { manifest: { ...orders(range), ...(ordersDashboard ? { dashboards: [dashboard('ob_orders_overview', { refreshInterval: 120 })] } : {}) } },
            { manifest: { ...core(range), dashboards: [dashboard('ob_overview', refresh)] } },
        ],
    };
}

function fakeCtx() {
    return {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn(() => undefined),
        trigger: vi.fn(),
    } as any;
}

function newPlugin(): any {
    return new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' } });
}

/** The conversion summary lines the door logged, keyed by conversion id. */
function conversionWarns(ctx: any): Map<string, string[]> {
    const byId = new Map<string, string[]>();
    for (const [line] of ctx.logger.warn.mock.calls as [string][]) {
        const id = /ADR-0087 conversion '([a-z0-9-]+)'/.exec(String(line))?.[1];
        if (!id) continue;
        byId.set(id, [...(byId.get(id) ?? []), String(line)]);
    }
    return byId;
}

const triple = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10));
function compareVersions(a: string, b: string): number {
    const [x, y] = [triple(a), triple(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
    return 0;
}

describe('[#23027] artifact door — an option-B artifact built before a retirement boots', () => {
    it('boots: the body\'s dashboard registers as `refreshIntervalSeconds: 300`, owned by its package', async () => {
        const plugin = newPlugin();
        const total = await plugin._parseAndRegisterArtifact(fakeCtx(), artifact('^18', { refreshInterval: 300 }), 'option-b');
        expect(total).toBeGreaterThan(0);

        const registered = (await plugin.manager.get('dashboard', 'ob_overview')) as any;
        expect(registered, 'the dashboard registers').toBeDefined();
        expect(registered.refreshIntervalSeconds).toBe(300);
        expect(registered).not.toHaveProperty('refreshInterval');
        expect(registered._packageId).toBe(CORE_ID);
    });

    it('converts per body: each package\'s dashboard registers converted under its own package', async () => {
        const plugin = newPlugin();
        await plugin._parseAndRegisterArtifact(fakeCtx(), artifact('^18', { refreshInterval: 300 }, true), 'option-b-multi');

        const overview = (await plugin.manager.get('dashboard', 'ob_overview')) as any;
        const ordersOverview = (await plugin.manager.get('dashboard', 'ob_orders_overview')) as any;
        expect([overview.refreshIntervalSeconds, overview._packageId]).toEqual([300, CORE_ID]);
        expect([ordersOverview.refreshIntervalSeconds, ordersOverview._packageId]).toEqual([120, ORDERS_ID]);
        expect(ordersOverview).not.toHaveProperty('refreshInterval');
    });

    it('logs one summary per conversion, counting every body\'s sites and naming the first body\'s path', async () => {
        const plugin = newPlugin();
        const ctx = fakeCtx();
        await plugin._parseAndRegisterArtifact(ctx, artifact('^18', { refreshInterval: 300 }, true), 'option-b-multi');

        const warns = conversionWarns(ctx);
        expect([...warns.keys()]).toEqual([SUBJECT]);
        expect(warns.get(SUBJECT)).toHaveLength(1);
        const [line] = warns.get(SUBJECT)!;
        expect(line).toContain('2 site(s)');
        expect(line).toContain('first at packages[0].manifest.dashboards[0].refreshIntervalSeconds');
        expect(line).toContain(' at packages[0].manifest.dashboards[0].refreshIntervalSeconds: ');
    });

    it('the same artifact built after the rename boots with nothing converted and nothing logged', async () => {
        const plugin = newPlugin();
        const ctx = fakeCtx();
        await plugin._parseAndRegisterArtifact(ctx, artifact('^18', { refreshIntervalSeconds: 300 }), 'option-b-current');
        expect([...conversionWarns(ctx).keys()]).toEqual([]);
        expect(((await plugin.manager.get('dashboard', 'ob_overview')) as any).refreshIntervalSeconds).toBe(300);
    });

    it('WINDOW SHUT — an artifact authored past every retirement still meets the tombstone inside its body', async () => {
        // The first `x.y.z` past the installed label and every `retiredAfter`:
        // a floor no window opens for, whatever label the version pass sets.
        const installed = resolveInstalledSpecVersion();
        expect(installed).toMatch(/^\d+\.\d+\.\d+/);
        const stamps = [installed!, ...ALL_CONVERSIONS.flatMap((c) => (c.retiredFromLoadPath === true ? [c.retiredAfter] : []))];
        const top = [...stamps].sort(compareVersions)[stamps.length - 1]!;
        const [major, minor, patch] = triple(top);
        const current = `^${major}.${minor}.${patch! + 1}`;

        const refusal = await newPlugin()
            ._parseAndRegisterArtifact(fakeCtx(), artifact(current, { refreshInterval: 300 }), 'option-b-current-floor')
            .then(() => undefined, (e: any) => e);
        expect(refusal, 'the strict parse refuses').toBeDefined();
        expect((refusal.issues as { path: (string | number)[] }[]).map((i) => i.path.join('.')))
            .toEqual(['packages.1.manifest.dashboards.0.refreshInterval']);
    });
});
