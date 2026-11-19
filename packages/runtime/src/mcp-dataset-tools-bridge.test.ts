// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D2] The HTTP MCP bridge's dataset members (`list_datasets` /
 * `query_dataset`), as `buildMcpBridge` composes them over the analytics
 * service's `datasetTools` executor.
 *
 * Pinned here: the seam is served only by an `analytics` service that carries
 * `datasetTools` (no service, or one without it, is "not served" and the bridge
 * carries no dataset member); the executor is bound to the saved datasets of
 * the protocol's merged read, to the request's security probe and to the tool
 * layer's page cap; and every call runs as the request's own principal.
 * Also pinned (its own describes below): an i18n service that resolves but
 * whose `getLocales` / `getTranslations` throws, over the REAL executor, serves
 * the datasets untranslated with a warning (#34993).
 */

import { describe, it, expect, vi } from 'vitest';
// Paid during collection, not inside a clocked case: the dispatcher reaches
// `standalone-stack.ts`, whose function body `import()`s it (`scripts/check-test-source-alias.mjs`).
import '@objectstack/metadata';
import { HttpDispatcher } from './http-dispatcher.js';
import { buildMcpBridge, resolveMcpDatasetToolsService, type McpDatasetToolsService } from './domains/mcp.js';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';

const EC = { userId: 'u1', tenantId: 'org_1', systemPermissions: [] };
const SAVED = [{ name: 'sales_analysis', label: 'Sales analysis', object: 'crm_opportunity' }];
const DEFINITIONS = [
    { name: 'list_datasets', description: 'executor list' },
    { name: 'query_dataset', description: 'executor query' },
];

function harness(services: Record<string, unknown> = {}) {
    const protocol = {
        getMetaItems: vi.fn(async ({ type }: { type: string }) => ({ type, items: type === 'dataset' ? SAVED : [] })),
    };
    const security = {
        describeDelegationNarrowing: vi.fn(async (object: string) => ({ narrowed: true, statement: `narrowed on ${object}` })),
    };
    const bound: Array<Parameters<McpDatasetToolsService['datasetTools']>[0]> = [];
    const executor = {
        definitions: DEFINITIONS,
        listDatasets: vi.fn(async () => ({ datasets: [] })),
        queryDataset: vi.fn(async () => ({ rows: [] })),
    };
    const analytics: McpDatasetToolsService = {
        datasetTools: vi.fn((deps) => {
            bound.push(deps);
            return executor;
        }),
    };
    const all: Record<string, unknown> = { protocol, security, analytics, ...services };
    const kernel: any = { context: { getService: (n: string) => all[n] ?? null } };
    const ctx: any = {
        request: { method: 'POST', url: '/api/v1/mcp', headers: { host: 'acme.test' } },
        environmentId: 'platform',
        executionContext: EC,
    };
    const deps = (new HttpDispatcher(kernel) as any).domainDeps;
    return { protocol, security, analytics, executor, bound, ctx, deps };
}

describe('[ADR-0149 D2] the MCP bridge\'s dataset members', () => {
    it('the seam is served by an analytics service carrying datasetTools, and not without one', async () => {
        const served = harness();
        expect(await resolveMcpDatasetToolsService(served.deps, served.ctx)).toBe(served.analytics);
        const none = harness({ analytics: null });
        expect(await resolveMcpDatasetToolsService(none.deps, none.ctx)).toBeUndefined();
        const older = harness({ analytics: { queryDataset: async () => ({}) } });
        expect(await resolveMcpDatasetToolsService(older.deps, older.ctx)).toBeUndefined();
    });

    it('a bridge built without the seam carries no dataset member, so neither tool is listed', () => {
        const { ctx, deps } = harness();
        const bridge = buildMcpBridge(deps, ctx);
        expect(bridge.listDatasets).toBeUndefined();
        expect(bridge.queryDataset).toBeUndefined();
        expect(bridge.datasetToolDefinitions).toBeUndefined();
    });

    it('hands the executor\'s definitions over unchanged', async () => {
        const { ctx, deps, analytics } = harness();
        const bridge = buildMcpBridge(deps, ctx, { datasetTools: analytics });
        expect(bridge.datasetToolDefinitions()).toBe(DEFINITIONS);
    });

    it('runs list_datasets as the request\'s principal, over the merged dataset read', async () => {
        const { ctx, deps, analytics, executor, bound, protocol } = harness();
        const bridge = buildMcpBridge(deps, ctx, { datasetTools: analytics });
        await bridge.listDatasets({ terms: ['营收'] });
        expect(executor.listDatasets).toHaveBeenCalledWith({ terms: ['营收'] }, EC);
        expect(await bound[0].loadDatasets(EC)).toEqual(SAVED);
        expect(protocol.getMetaItems).toHaveBeenCalledWith({ type: 'dataset' });
    });

    it('runs query_dataset as the request\'s principal, with the tool\'s page cap and the request\'s narrowing probe', async () => {
        const { ctx, deps, analytics, executor, bound, security } = harness();
        const bridge = buildMcpBridge(deps, ctx, { datasetTools: analytics });
        const input = { datasetName: 'sales_analysis', selection: { measures: ['revenue'] } };
        await bridge.queryDataset(input, { maxRows: 7 });
        expect(executor.queryDataset).toHaveBeenCalledWith(input, EC);
        const deps7 = bound.at(-1)!;
        expect(deps7.maxQueryLimit).toBe(7);
        expect(await deps7.diagnoseDelegation!('crm_opportunity', EC)).toEqual({ narrowed: true, statement: 'narrowed on crm_opportunity' });
        expect(security.describeDelegationNarrowing).toHaveBeenCalledWith('crm_opportunity', EC);
    });

    it('a throwing dataset read reaches the executor as a throw, never as an empty catalogue', async () => {
        const { ctx, deps, analytics, bound, protocol } = harness();
        protocol.getMetaItems.mockRejectedValueOnce(new Error('metadata store down'));
        buildMcpBridge(deps, ctx, { datasetTools: analytics }).datasetToolDefinitions();
        await expect(bound[0].loadDatasets(EC)).rejects.toThrow('metadata store down');
    });
});

/**
 * [ADR-0149 D2 · #34993] The HTTP door's dataset members when the request's
 * i18n service RESOLVES but its reads throw — a translation fault, which the
 * shared translator (`translationBundleOf`) answers as no bundle and says. The
 * executor is the REAL one (the analytics service `AnalyticsServicePlugin`
 * registers, admission wired): `list_datasets` keeps the dataset, in its
 * authored text, `partial` with the fault's warning; `query_dataset` answers.
 *
 * Flipped on purpose by #34993 (seat ruling B) from #34876's ruling-A pin
 * (`datasets: []` + `partial`, and a 503), on both transports at once.
 */
describe('[ADR-0149 D2] the HTTP dataset tools when the i18n service resolves but its reads throw', () => {
    const METRICS = {
        name: 'sales_analysis',
        label: 'Sales analysis',
        object: 'crm_opportunity',
        dimensions: [{ name: 'stage', label: 'Stage', field: 'stage', type: 'string' }],
        measures: [{ name: 'revenue', label: 'Revenue', aggregate: 'sum', field: 'amount' }],
    };
    const ZH_CN = { datasets: { sales_analysis: { label: '销售分析' } } };

    /**
     * The analytics service AnalyticsServicePlugin registers, so the executor is
     * the platform's own; over an open security double and an engine double
     * that declares `crm_opportunity`, so a dataset the load hands over IS
     * listed (the control case below), and an empty catalogue is the load's doing.
     */
    async function wiredAnalytics(): Promise<AnalyticsService> {
        const fields = { id: { type: 'text' }, stage: { type: 'text' }, amount: { type: 'number' } };
        const engine = {
            execute: async () => ({ rows: [{ stage: 'won', total_amount: 100 }] }),
            hasObjectMiddleware: () => false,
            getObject: (name: string) => (name === 'crm_opportunity' ? { fields } : undefined),
            resolveEffectiveDatasource: () => undefined,
        };
        const security = {
            getReadFilter: async () => undefined,
            canReadObject: () => true,
            getReadableFields: async () => Object.keys(fields),
            getQueryableFields: async () => Object.keys(fields),
        };
        const registered: Record<string, unknown> = { data: engine, security };
        const pluginCtx = {
            getService: (name: string) => registered[name],
            registerService: (name: string, svc: unknown) => { registered[name] = svc; },
            replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
            logger: { info() {}, warn() {}, error() {}, debug() {} },
        };
        await new AnalyticsServicePlugin({ queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }) }).init(pluginCtx as never);
        const analytics = registered.analytics as AnalyticsService;
        expect(analytics.hasPluginWiredAdmission()).toBe(true);
        return analytics;
    }

    /** A resolved i18n service whose `read` throws `message`; the other read answers a bundle. */
    function i18nWhoseReadThrows(read: 'getLocales' | 'getTranslations', message: string) {
        return {
            getLocales: () => {
                if (read === 'getLocales') throw new Error(message);
                return ['zh-CN', 'en'];
            },
            getTranslations: (locale: string) => {
                if (read === 'getTranslations') throw new Error(message);
                return locale === 'zh-CN' ? ZH_CN : {};
            },
            getDefaultLocale: () => 'zh-CN',
        };
    }

    async function bridgeOverRealExecutor(i18n: unknown) {
        const analytics = await wiredAnalytics();
        const protocol = { getMetaItems: async ({ type }: { type: string }) => ({ type, items: type === 'dataset' ? [METRICS] : [] }) };
        const { ctx, deps } = harness({ analytics, i18n, protocol });
        expect(await resolveMcpDatasetToolsService(deps, ctx)).toBe(analytics);
        return buildMcpBridge(deps, ctx, { datasetTools: analytics });
    }

    const CASES = [
        { read: 'getLocales' as const, message: 'locales exploded' },
        { read: 'getTranslations' as const, message: 'bundle offline' },
    ];

    it('control: the same harness lists the dataset, in the bundle label, when the reads answer', async () => {
        const answering = {
            getLocales: () => ['zh-CN', 'en'],
            getTranslations: (locale: string) => (locale === 'zh-CN' ? ZH_CN : {}),
            getDefaultLocale: () => 'zh-CN',
        };
        const bridge = await bridgeOverRealExecutor(answering);
        const answer = await bridge.listDatasets!({});
        expect(answer.partial).toBeUndefined();
        expect(answer.datasets.map((d: { name: string; label: string }) => [d.name, d.label])).toEqual([['sales_analysis', '销售分析']]);
    });

    it.each(CASES)('$read throwing: list_datasets keeps the dataset untranslated, partial, naming the i18n error', async ({ read, message }) => {
        const bridge = await bridgeOverRealExecutor(i18nWhoseReadThrows(read, message));
        const answer = await bridge.listDatasets!({});
        expect(answer.datasets.map((d: { name: string; label: string }) => [d.name, d.label])).toEqual([['sales_analysis', 'Sales analysis']]);
        expect(answer).toMatchObject({ partial: true, warning: expect.stringContaining(message) });
    });

    it.each(CASES)('$read throwing: query_dataset answers, in the authored labels', async ({ read, message }) => {
        const bridge = await bridgeOverRealExecutor(i18nWhoseReadThrows(read, message));
        const answer = await bridge.queryDataset!({ datasetName: 'sales_analysis', selection: { measures: ['revenue'] } }, { maxRows: 10 });
        expect(answer.rowCount).toBe(1);
        expect(answer.provenance.dataset).toEqual({ name: 'sales_analysis', label: 'Sales analysis' });
    });
});
