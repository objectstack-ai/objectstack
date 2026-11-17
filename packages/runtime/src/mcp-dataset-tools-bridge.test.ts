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
 * Also pinned (its own describe below): an i18n service that resolves but
 * whose `getLocales` / `getTranslations` throws, over the REAL executor, is a
 * degraded read on both dataset tools (seat ruling A).
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
 * [ADR-0149 D2] The HTTP door's dataset members when the request's i18n
 * service RESOLVES but its reads throw — not the lookup that throws, which
 * `metaTranslationSources` reads as none (text served untranslated).
 * `translationBundleOf` calls `getLocales` and `getTranslations` unguarded, so
 * the `/meta` list translation rejects with the i18n error, and `loadDatasets`
 * leaves that rejection to throw. The executor is the REAL one (the analytics
 * service `AnalyticsServicePlugin` registers, admission wired), so the answer
 * is its degraded-read contract: `list_datasets` lists nothing, says `partial`
 * and names the error; `query_dataset` refuses 503 `SERVICE_UNAVAILABLE`.
 *
 * Pinned on purpose under seat ruling A: the catalogue degrades and says so.
 * A follow-up (B: serve the untranslated text on a translation fault, inside
 * the shared translator) would flip these expectations deliberately, on both
 * transports at once.
 */
describe('[ADR-0149 D2] the HTTP dataset tools when the i18n service resolves but its reads throw', () => {
    /** The analytics service AnalyticsServicePlugin registers, so the executor is the platform's own. */
    async function wiredAnalytics(): Promise<AnalyticsService> {
        const registered: Record<string, unknown> = {};
        const pluginCtx = {
            getService: (name: string) => registered[name],
            registerService: (name: string, svc: unknown) => { registered[name] = svc; },
            replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
            logger: { info() {}, warn() {}, error() {}, debug() {} },
        };
        await new AnalyticsServicePlugin().init(pluginCtx as never);
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
                return locale === 'zh-CN' ? { datasets: { sales_analysis: { label: '销售分析' } } } : {};
            },
            getDefaultLocale: () => 'zh-CN',
        };
    }

    async function bridgeOverRealExecutor(read: 'getLocales' | 'getTranslations', message: string) {
        const analytics = await wiredAnalytics();
        const { ctx, deps } = harness({ analytics, i18n: i18nWhoseReadThrows(read, message) });
        expect(await resolveMcpDatasetToolsService(deps, ctx)).toBe(analytics);
        return buildMcpBridge(deps, ctx, { datasetTools: analytics });
    }

    const CASES = [
        { read: 'getLocales' as const, message: 'locales exploded' },
        { read: 'getTranslations' as const, message: 'bundle offline' },
    ];

    it.each(CASES)('$read throwing: list_datasets lists nothing, says partial and names the i18n error', async ({ read, message }) => {
        const bridge = await bridgeOverRealExecutor(read, message);
        const answer = await bridge.listDatasets!({});
        expect(answer).toEqual({ datasets: [], partial: true, warning: expect.stringContaining(message) });
        expect(answer.warning).toMatch(/^The dataset catalogue could not be read: /);
    });

    it.each(CASES)('$read throwing: query_dataset refuses 503 SERVICE_UNAVAILABLE, naming the failed read', async ({ read, message }) => {
        const bridge = await bridgeOverRealExecutor(read, message);
        const refused = await bridge
            .queryDataset!({ datasetName: 'sales_analysis', selection: { measures: ['revenue'] } }, { maxRows: 10 })
            .then(
                () => undefined,
                (e: unknown) => e as { code?: unknown; status?: unknown; message?: unknown },
            );
        expect(refused).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        // The failed read's own 503 (naming the i18n error), not the executor's
        // "not available on this deployment" one.
        expect(refused?.message).toContain(`the dataset read failed (${message})`);
    });
});
