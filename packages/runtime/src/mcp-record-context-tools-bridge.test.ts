// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0160 D4] The HTTP MCP bridge's record-context members
 * (`get_record_context`), as the `/mcp` route composes them over the
 * `record-context` service's executor (`@objectstack/service-record-context`).
 *
 * Pinned here: the seam is served only by a `record-context` service carrying
 * `recordContextTools`; the bridge hands the executor's definition over
 * unchanged; every call hands the executor a door built from THIS bridge's
 * own read members plus the tool layer's read guard, unchanged, and the
 * published packs read through the protocol's merged `ai_context` listing;
 * and the route resolves the seam only for a grant that reaches the read
 * family, so a token without `data:read` is carried neither member and never
 * has the service resolved. The executor itself is pinned with the service;
 * the tool on both transports in `packages/mcp/src/mcp-record-context-tools.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid during collection, not inside a clocked case: the dispatcher reaches
// `standalone-stack.ts`, whose function body `import()`s it (`scripts/check-test-source-alias.mjs`).
import '@objectstack/metadata';
import { HttpDispatcher } from './http-dispatcher.js';
import {
    buildMcpBridge,
    resolveMcpRecordContextToolsService,
    type McpRecordContextToolsService,
} from './domains/mcp.js';

const EC = { userId: 'u1', tenantId: 'org_1', systemPermissions: [] };
const DEFINITIONS = [{ name: 'get_record_context', description: 'executor read', parameters: { type: 'object' } }];
const PACK = { name: 'policy_document', label: 'Policy document', object: 'policy', fields: ['title'] };

function recordContextService() {
    const doors: any[] = [];
    const executor = {
        definitions: DEFINITIONS,
        getRecordContext: vi.fn(async (_input: unknown, door: unknown) => {
            doors.push(door);
            return { data: {}, notes: [], framing: '' };
        }),
    };
    const service: McpRecordContextToolsService = { recordContextTools: vi.fn(() => executor) };
    return { service, executor, doors };
}

function harness(services: Record<string, unknown> = {}) {
    const { service, executor, doors } = recordContextService();
    const protocol = { getMetaItems: vi.fn(async ({ type }: { type: string }) => ({ type, items: type === 'ai_context' ? [PACK] : [] })) };
    const all: Record<string, unknown> = { 'record-context': service, protocol, ...services };
    const kernel: any = { context: { getService: (n: string) => all[n] ?? null } };
    const ctx: any = {
        request: { method: 'POST', url: '/api/v1/mcp', headers: { host: 'acme.test' } },
        environmentId: 'platform',
        executionContext: EC,
    };
    const deps = (new HttpDispatcher(kernel) as any).domainDeps;
    return { service, executor, doors, protocol, ctx, deps };
}

describe('[ADR-0160 D4] the MCP bridge\'s record-context members', () => {
    it('the seam is served by a record-context service carrying recordContextTools, and not without one', async () => {
        const served = harness();
        expect(await resolveMcpRecordContextToolsService(served.deps, served.ctx)).toBe(served.service);
        const none = harness({ 'record-context': null });
        expect(await resolveMcpRecordContextToolsService(none.deps, none.ctx)).toBeUndefined();
        const other = harness({ 'record-context': { render: async () => ({}) } });
        expect(await resolveMcpRecordContextToolsService(other.deps, other.ctx)).toBeUndefined();
    });

    it('a bridge built without the seam carries no record-context member, so the tool is not listed', () => {
        const { ctx, deps } = harness();
        const bridge = buildMcpBridge(deps, ctx);
        expect(bridge.getRecordContext).toBeUndefined();
        expect(bridge.recordContextToolDefinitions).toBeUndefined();
    });

    it('hands the definition over unchanged, and the executor a door of this bridge\'s own members and the tool\'s guard', async () => {
        const { ctx, deps, service, executor, doors, protocol } = harness();
        const bridge = buildMcpBridge(deps, ctx, { recordContextTools: service });
        expect(bridge.recordContextToolDefinitions()).toBe(DEFINITIONS);

        const readGuard = vi.fn(async () => undefined);
        const input = { objectName: 'policy', recordId: 'p1' };
        await bridge.getRecordContext(input, { readGuard });
        expect(executor.getRecordContext).toHaveBeenCalledTimes(1);
        expect(executor.getRecordContext.mock.calls[0][0]).toBe(input);

        const [door] = doors;
        expect(door.readGuard).toBe(readGuard);
        expect(Object.keys(door).sort()).toEqual([
            'assertApiExposed',
            'diagnoseDelegation',
            'fieldVisibilityOf',
            'get',
            'listContextPacks',
            'publishedObjectDefinitionOf',
            'query',
            'readGuard',
            'servedObjectDefinitionOf',
            'userTextLocales',
        ]);
        // The published packs: the protocol's merged listing, as `/meta/ai_context` reads it.
        expect(await door.listContextPacks()).toEqual([PACK]);
        expect(protocol.getMetaItems).toHaveBeenCalledWith({ type: 'ai_context' });
        // Each record read is the bridge's own member, as the caller.
        const get = vi.spyOn(bridge, 'get').mockResolvedValue({ id: 'p1' });
        const query = vi.spyOn(bridge, 'query').mockResolvedValue({ records: [] });
        await door.get('policy', 'p1');
        await door.query('policy_revision', { where: { policy: 'p1' }, limit: 21 });
        expect(get).toHaveBeenCalledWith('policy', 'p1');
        expect(query).toHaveBeenCalledWith('policy_revision', { where: { policy: 'p1' }, limit: 21 });
        expect(await door.userTextLocales()).toEqual(await bridge.userTextLocales());
    });
});

/**
 * The `/mcp` route end to end, up to the MCP runtime: a kernel with a
 * `record-context` service and an `mcp` service that records the options the
 * route hands it.
 */
async function servedFor(executionContext: Record<string, unknown>) {
    const { service } = recordContextService();
    const resolved: string[] = [];
    const mcp: any = {
        lastOpts: undefined,
        handleHttpRequest: async (_req: Request, o: any) => {
            mcp.lastOpts = o;
            return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        },
    };
    const all: Record<string, any> = { mcp, 'record-context': service };
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
    return { opts: mcp.lastOpts, resolved };
}

describe('[ADR-0160 D4] the /mcp route carries get_record_context only where the grant reaches the read family', () => {
    it('a session (no OAuth grant) is carried both members', async () => {
        const { opts } = await servedFor({ userId: 'u1', isSystem: false });
        expect(typeof opts.bridge.getRecordContext).toBe('function');
        expect(opts.bridge.recordContextToolDefinitions()).toBe(DEFINITIONS);
    });

    it('a token without data:read is carried neither member, and the service is never resolved for it', async () => {
        const { opts, resolved } = await servedFor({ userId: 'u1', isSystem: false, oauthScopes: ['data:write'] });
        expect(opts.bridge.getRecordContext).toBeUndefined();
        expect(opts.bridge.recordContextToolDefinitions).toBeUndefined();
        expect(resolved).not.toContain('record-context');
    });
});
