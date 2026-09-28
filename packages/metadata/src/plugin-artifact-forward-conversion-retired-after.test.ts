// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20390] An artifact built by the LAST release boots on unreleased `main`.
 *
 * `__fixtures__/forward-probe-17.4-built.artifact.json` is `dist/objectstack.json`
 * verbatim, as built by the published `@objectstack/cli` 17.4.0 (`os build`,
 * resolving `@objectstack/spec` 17.4.0 from npm) from a one-object source: a
 * dataset-bound bar-chart widget whose `chartConfig` carries `type`, `xAxis`
 * and `yAxis` — `type` was REQUIRED at 17.4.0 — and a page with
 * `assignedProfiles`, declaring `engines.protocol: '^17.4.0'`.
 *
 * `main` retires all four keys for 17.5.0 while `packages/spec` still carries
 * the 17.4.0 label, so before this fix the door's label-only window read the
 * artifact as "authored current", replayed nothing, and the strict parse in
 * `_parseAndRegisterArtifact` refused the boot. The registry now stamps each of
 * those retirements `retiredAfter: '17.4.0'`, and the door replays an entry
 * whenever the artifact's floor is at or below it.
 *
 * Two acceptance pins live here, on the real door: (1) the built artifact
 * boots and the conversion notices are logged; (2) a newly AUTHORED source
 * using the same retired keys is still refused loudly by the authoring funnel.
 * The window's two version boundaries — floor 17.5.0 on a 17.5.0 runtime
 * refused, and the label-17.4.0 regression case with an injected label — are
 * pinned in `@objectstack/metadata-core`'s `artifact-forward-conversion.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineStack } from '@objectstack/spec';
import { MetadataPlugin } from './plugin.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, '__fixtures__/forward-probe-17.4-built.artifact.json');

/** Fresh parse per test — `_parseAndRegisterArtifact` mutates items in place. */
function loadFixture(): any {
    return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

/** A fresh fixture carrying a fresh copy of the given `views`. */
function loadFixtureWith(views: unknown): any {
    return { ...loadFixture(), views: JSON.parse(JSON.stringify(views)) };
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

describe('[#20390] artifact door — a 17.4.0-built artifact boots on unreleased main', () => {
    it('the fixture carries the shape the published 17.4.0 CLI emitted (premise guard)', () => {
        const fixture = loadFixture();
        expect(fixture.manifest.engines.protocol).toBe('^17.4.0');
        const chartConfig = fixture.dashboards[0].widgets[0].chartConfig;
        expect(Object.keys(chartConfig)).toEqual(expect.arrayContaining(['type', 'xAxis', 'yAxis']));
        expect(fixture.pages[0].assignedProfiles).toEqual(['sales_manager']);
    });

    // Pin (1).
    it('boots: the dashboard and the page register with the retired keys converted away', async () => {
        const plugin = newPlugin();
        const total = await plugin._parseAndRegisterArtifact(fakeCtx(), loadFixture(), 'forward-probe-17.4');
        expect(total).toBeGreaterThan(0);

        const dashboard = await plugin.manager.get('dashboard', 'fwd_pipeline');
        expect(dashboard, 'the dashboard registers').toBeDefined();
        const chartConfig = (dashboard as any).widgets[0].chartConfig ?? {};
        for (const key of ['type', 'xAxis', 'yAxis']) expect(chartConfig).not.toHaveProperty(key);
        // The widget keeps its dataset binding — the selection the chart renders from.
        expect((dashboard as any).widgets[0]).toMatchObject({ type: 'bar', dataset: 'fwd_deal_metrics', dimensions: ['stage'], values: ['amount'] });

        const page = await plugin.manager.get('page', 'fwd_deal_desk');
        expect(page, 'the page registers').toBeDefined();
        expect(page).not.toHaveProperty('assignedProfiles');
    });

    // Pin (1), the other half: loud, once per conversion per artifact.
    it('logs one conversion summary per retired entry it replayed, naming the site count', async () => {
        const plugin = newPlugin();
        const ctx = fakeCtx();
        await plugin._parseAndRegisterArtifact(ctx, loadFixture(), 'forward-probe-17.4');

        const warns = conversionWarns(ctx);
        expect([...warns.keys()].sort()).toEqual([
            'dashboard-widget-chart-config-structure-removed',
            'page-assigned-profiles-removed',
        ]);
        expect(warns.get('dashboard-widget-chart-config-structure-removed')).toHaveLength(1);
        expect(warns.get('dashboard-widget-chart-config-structure-removed')![0]).toContain('3 site(s)');
        expect(warns.get('page-assigned-profiles-removed')).toHaveLength(1);
        expect(warns.get('page-assigned-profiles-removed')![0]).toContain('1 site(s)');
        // Under the per-entry half the floor is not below the runtime's label,
        // so the line must not claim the artifact "predates" a runtime printed
        // at the same version — it names the retirement that opened it instead.
        for (const line of [...warns.values()].flat()) expect(line).not.toContain("predates this runtime's spec");
    });

    /**
     * #12915 scope C rides the same window. The unbound-root notice is read off
     * the forward-conversion pass's own verdict, so on unreleased `main` a
     * 17.4.0-built artifact is "old" for it exactly as it is for the replay —
     * the notice must not wait for the package label to move.
     */
    it('announces a bare-root form predicate once — the #12915 notice follows the per-entry window', async () => {
        const views = [{
            form: {
                type: 'simple',
                data: { provider: 'object', object: 'fwd_deal' },
                sections: [{
                    name: 'deal',
                    fields: [
                        { field: 'stage' },
                        // Bare root: `stage`, not `record.stage` — unbound where it evaluates.
                        { field: 'amount', required: true, visibleWhen: { dialect: 'cel', source: 'stage == "won"' } },
                    ],
                }],
            },
        }];
        expect(loadFixtureWith(views).manifest.engines.protocol).toBe('^17.4.0');

        const plugin = newPlugin();
        const ctx = fakeCtx();
        await plugin._parseAndRegisterArtifact(ctx, loadFixtureWith(views), 'forward-probe-17.4-bare-root');
        // The HMR watcher replays the same artifact: still once.
        await plugin._parseAndRegisterArtifact(ctx, loadFixtureWith(views), 'forward-probe-17.4-bare-root');

        const unbound = (ctx.logger.warn.mock.calls as [string][])
            .map(([line]) => String(line))
            .filter((line) => line.includes('root identifier is NOT bound'));
        expect(unbound).toHaveLength(1);
        expect(unbound[0]).toContain("'stage'");
        expect(unbound[0]).toContain('1 view(s): fwd_deal');
    });
});

describe('[#20390] authoring funnel — a NEW source using the retired keys is still refused loudly', () => {
    // Pin (2). The source the fixture was built from, verbatim, authored today:
    // the authoring funnel never replays a retired entry, whatever the floor says.
    const source = () => ({
        manifest: {
            id: 'com.example.forward-probe', namespace: 'fwd', name: 'forward_probe', version: '1.0.0', type: 'app',
            engines: { protocol: '^17.4.0' },
        },
        objects: [{
            name: 'fwd_deal', label: 'Deal', sharingModel: 'private',
            fields: {
                name: { type: 'text', label: 'Name' },
                stage: { type: 'text', label: 'Stage' },
                amount: { type: 'number', label: 'Amount' },
            },
        }],
        datasets: [{
            name: 'fwd_deal_metrics', label: 'Deal metrics', object: 'fwd_deal',
            dimensions: [{ name: 'stage', field: 'stage' }],
            measures: [{ name: 'amount', field: 'amount', aggregate: 'sum' }],
        }],
        dashboards: [{
            name: 'fwd_pipeline', label: 'Pipeline',
            widgets: [{
                id: 'amount_by_stage', title: 'Amount by stage', type: 'bar',
                dataset: 'fwd_deal_metrics', dimensions: ['stage'], values: ['amount'],
                chartConfig: { type: 'bar', xAxis: { field: 'stage' }, yAxis: [{ field: 'amount' }] },
                layout: { x: 0, y: 0, w: 6, h: 4 },
            }],
        }],
        pages: [{ name: 'fwd_deal_desk', label: 'Deal Desk', type: 'app', assignedProfiles: ['sales_manager'], regions: [] }],
    });

    it('defineStack refuses with STACK_SCHEMA_INVALID / 422, one issue per retired site', () => {
        let refused: any = null;
        try {
            defineStack(source() as never);
        } catch (e) {
            refused = e;
        }
        expect(refused, 'defineStack must refuse').not.toBeNull();
        expect(refused.code).toBe('STACK_SCHEMA_INVALID');
        expect(refused.status).toBe(422);
        const paths = (refused.issues as { path: PropertyKey[] }[]).map((i) => i.path.join('.')).sort();
        expect(paths).toEqual([
            'dashboards.0.widgets.0.chartConfig.type',
            'dashboards.0.widgets.0.chartConfig.xAxis',
            'dashboards.0.widgets.0.chartConfig.yAxis',
            'pages.0.assignedProfiles',
        ]);
    });
});
