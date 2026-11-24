// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D2] The HTTP MCP bridge's knowledge members (`search_knowledge`),
 * as the `/mcp` route composes them over the `knowledge` service's
 * `knowledgeTools` executor (`@objectstack/service-knowledge`).
 *
 * Pinned here: the seam is served only by a `knowledge` service that carries
 * `knowledgeTools` (no service, or one without it, is "not served" and the
 * bridge carries no knowledge member); every call runs as the request's own
 * execution context; and the route resolves the seam only for a grant that
 * reaches the read family (`data:read`, or no OAuth grant at all), so a token
 * without it is carried neither member and never has the service resolved.
 * The executor itself (`aiExposed`, the row-level re-check) is pinned with
 * the service, in `service-knowledge`'s `knowledge-tools.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid during collection, not inside a clocked case: the dispatcher reaches
// `standalone-stack.ts`, whose function body `import()`s it (`scripts/check-test-source-alias.mjs`).
import '@objectstack/metadata';
import { HttpDispatcher } from './http-dispatcher.js';
import { buildMcpBridge, resolveMcpKnowledgeToolsService, type McpKnowledgeToolsService } from './domains/mcp.js';

const EC = { userId: 'u1', tenantId: 'org_1', systemPermissions: [] };
const DEFINITIONS = [{ name: 'search_knowledge', description: 'executor search', parameters: { type: 'object' } }];

function knowledgeService() {
    const executor = {
        definitions: DEFINITIONS,
        searchKnowledge: vi.fn(async () => ({ hits: [], sources: [] })),
    };
    const service: McpKnowledgeToolsService = { knowledgeTools: vi.fn(() => executor) };
    return { service, executor };
}

function harness(services: Record<string, unknown> = {}) {
    const { service, executor } = knowledgeService();
    const all: Record<string, unknown> = { knowledge: service, ...services };
    const kernel: any = { context: { getService: (n: string) => all[n] ?? null } };
    const ctx: any = {
        request: { method: 'POST', url: '/api/v1/mcp', headers: { host: 'acme.test' } },
        environmentId: 'platform',
        executionContext: EC,
    };
    const deps = (new HttpDispatcher(kernel) as any).domainDeps;
    return { service, executor, ctx, deps };
}

describe('[ADR-0149 D2] the MCP bridge\'s knowledge members', () => {
    it('the seam is served by a knowledge service carrying knowledgeTools, and not without one', async () => {
        const served = harness();
        expect(await resolveMcpKnowledgeToolsService(served.deps, served.ctx)).toBe(served.service);
        const none = harness({ knowledge: null });
        expect(await resolveMcpKnowledgeToolsService(none.deps, none.ctx)).toBeUndefined();
        // A knowledge service from before the tool (search only) serves no tool.
        const older = harness({ knowledge: { search: async () => [] } });
        expect(await resolveMcpKnowledgeToolsService(older.deps, older.ctx)).toBeUndefined();
    });

    it('a bridge built without the seam carries no knowledge member, so the tool is not listed', () => {
        const { ctx, deps } = harness();
        const bridge = buildMcpBridge(deps, ctx);
        expect(bridge.searchKnowledge).toBeUndefined();
        expect(bridge.knowledgeToolDefinitions).toBeUndefined();
    });

    it('hands the executor\'s definition over unchanged, and runs search_knowledge as the request\'s principal', async () => {
        const { ctx, deps, service, executor } = harness();
        const bridge = buildMcpBridge(deps, ctx, { knowledgeTools: service });
        expect(bridge.knowledgeToolDefinitions()).toBe(DEFINITIONS);
        const input = { query: 'refund window', sourceIds: ['policy_clauses'] };
        await bridge.searchKnowledge(input);
        expect(executor.searchKnowledge).toHaveBeenCalledWith(input, EC);
    });
});

/**
 * The `/mcp` route end to end, up to the MCP runtime: a kernel with a
 * `knowledge` service and an `mcp` service that records the options the route
 * hands it.
 */
async function servedFor(executionContext: Record<string, unknown>) {
    const { service, executor } = knowledgeService();
    const resolved: string[] = [];
    const mcp: any = {
        lastOpts: undefined,
        handleHttpRequest: async (_req: Request, o: any) => {
            mcp.lastOpts = o;
            return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        },
    };
    const all: Record<string, any> = { mcp, knowledge: service };
    const get = (n: string) => {
        resolved.push(n);
        return all[n] ?? null;
    };
    const kernel = { getService: get, getServiceAsync: async (n: string) => get(n), context: { getService: get } } as any;
    const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const res = await dispatcher.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
        request: new Request('http://localhost/api/v1/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: '{}',
        }),
        response: {},
        environmentId: undefined,
        executionContext,
    } as any);
    expect(res.response?.status, 'precondition: the MCP route must have been served').toBe(200);
    return { opts: mcp.lastOpts, executor, resolved };
}

describe('[ADR-0149 D2] the /mcp route carries search_knowledge only where the grant reaches the read family', () => {
    it('a session (no OAuth grant) is carried both members, bound to its own execution context', async () => {
        const ec = { userId: 'u1', isSystem: false };
        const { opts, executor } = await servedFor(ec);
        expect(typeof opts.bridge.searchKnowledge).toBe('function');
        expect(opts.bridge.knowledgeToolDefinitions()).toBe(DEFINITIONS);
        await opts.bridge.searchKnowledge({ query: 'q' });
        expect(executor.searchKnowledge).toHaveBeenCalledWith({ query: 'q' }, ec);
    });

    it('a token granting data:read is carried both members', async () => {
        const { opts, resolved } = await servedFor({ userId: 'u1', isSystem: false, oauthScopes: ['data:read'] });
        expect(opts.toolOptions).toEqual({ grantedScopes: ['data:read'] });
        // The control for the case below: the route resolves the service here.
        expect(resolved).toContain('knowledge');
        expect(typeof opts.bridge.searchKnowledge).toBe('function');
        expect(typeof opts.bridge.knowledgeToolDefinitions).toBe('function');
    });

    it('a token without data:read is carried neither member, and the knowledge service is never resolved for it', async () => {
        const { opts, resolved } = await servedFor({ userId: 'u1', isSystem: false, oauthScopes: ['data:write', 'actions:execute'] });
        expect(opts.toolOptions).toEqual({ grantedScopes: ['data:write', 'actions:execute'] });
        expect(opts.bridge.searchKnowledge).toBeUndefined();
        expect(opts.bridge.knowledgeToolDefinitions).toBeUndefined();
        expect(resolved).not.toContain('knowledge');
    });
});
