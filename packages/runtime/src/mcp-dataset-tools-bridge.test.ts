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
 */

import { describe, it, expect, vi } from 'vitest';
// Paid during collection, not inside a clocked case: the dispatcher reaches
// `standalone-stack.ts`, whose function body `import()`s it (`scripts/check-test-source-alias.mjs`).
import '@objectstack/metadata';
import { HttpDispatcher } from './http-dispatcher.js';
import { buildMcpBridge, resolveMcpDatasetToolsService, type McpDatasetToolsService } from './domains/mcp.js';

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
