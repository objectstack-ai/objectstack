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
 *
 * And, over the real protocol (no protocol double): a valid package pack, which
 * the protocol's served listing decorates with the read path's `_diagnostics`,
 * is the pack `get_record_context` answers through on the `/mcp` route — the
 * door hands the executor the authored pack, not the serving envelope.
 *
 * And the two doors over one real kernel for one caller (the last `describe`):
 * the `/mcp` route and the real `MCPServerPlugin` stdio session, through the
 * real `record-context` service, answer every case with the same bytes —
 * refusals included — and a pack saved at run time to the metadata registry
 * is read as a shipped one is.
 */

import { afterAll, beforeAll, describe, it, expect, vi, type Mock } from 'vitest';
// Paid during collection, not inside a clocked case: the dispatcher reaches
// `standalone-stack.ts`, whose function body `import()`s it (`scripts/check-test-source-alias.mjs`).
import '@objectstack/metadata';
import { SysMetadataAuditObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { assembleExecutionContext, resolveAuthzContext } from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { MCPServerPlugin, MCPServerRuntime } from '@objectstack/mcp';
import { createRecordContextTools, RecordContextServicePlugin } from '@objectstack/service-record-context';
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
            'packageNamespace',
            'pageCap',
            'publishedObjectDefinitionOf',
            'query',
            'queryableFieldsOf',
            'readGuard',
            'servedObjectDefinitionOf',
            'userTextLocales',
        ]);
        // [ADR-0160 D3, second amendment] The queryable fields: this request's security service's own
        // answer, for this request's caller; none (no service, or one without the method) is `undefined`.
        expect(await door.queryableFieldsOf('policy')).toBeUndefined();
        // [ADR-0160 D3] The page cap: the deployment's read limits, unset here.
        expect(door.pageCap()).toBeUndefined();
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

    it('[ADR-0160 D3] the door\'s queryable fields are the security service\'s answer for the caller, and its page cap the deployment\'s smaller read limit', async () => {
        const getQueryableFields = vi.fn(async () => ['title', 'status']);
        const { ctx, deps, service, doors } = harness({ security: { getQueryableFields } });
        const bridge = buildMcpBridge(deps, ctx, { recordContextTools: service });
        await bridge.getRecordContext({ objectName: 'policy', recordId: 'p1' }, { readGuard: vi.fn(async () => undefined) });
        const [door] = doors;
        expect(await door.queryableFieldsOf('policy')).toEqual(['title', 'status']);
        expect(getQueryableFields).toHaveBeenCalledWith('policy', expect.objectContaining({ userId: EC.userId, tenantId: EC.tenantId }));
        vi.stubEnv('OS_DATA_MAX_PAGE_SIZE', '40');
        vi.stubEnv('OS_DATA_QUERY_ROW_BUDGET', '12');
        try {
            expect(door.pageCap()).toBe(12);
        } finally {
            vi.unstubAllEnvs();
        }
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

/**
 * The `/mcp` route over the REAL protocol: a real `ObjectQL` over a real
 * `SqlDriver`, the security layer, `ObjectStackProtocolImplementation` over
 * that engine, the real executor and the real MCP runtime. Nothing here is a
 * double of the metadata plane, so the pack reaches the executor exactly as
 * the protocol serves it.
 */
describe('[ADR-0160 D4] the /mcp route answers through a package pack the real protocol serves', () => {
    const PKG_ID = 'com.objectstack.qa.record-context-door';
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;
    let kernel: any;

    beforeAll(async () => {
        engine = new ObjectQL();
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
        const store = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject] as any[];
        await driver.initObjects(store);
        engine.registerDriver(driver as any, true);
        await engine.init();
        for (const o of store) engine.registry.registerObject(o, '@objectstack/platform-objects');
        engine.registerApp({
            id: PKG_ID, name: 'record context door', version: '1.0.0', type: 'plugin', scope: 'system',
            objects: [{
                name: 'rcd_policy', label: 'Policy', nameField: 'title', sharingModel: 'public_read_write',
                fields: {
                    title: { name: 'title', type: 'text', label: 'Title' },
                    status: { name: 'status', type: 'text', label: 'Status' },
                },
            }],
            aiContexts: [{ name: 'rcd_policy_document', label: 'Policy document', object: 'rcd_policy', fields: ['title', 'status'] }],
        } as never);
        await engine.syncSchemas();
        await engine.insert('rcd_policy', { id: 'p1', title: 'Fire cover', status: 'active', organization_id: 'org_1' }, { context: { isSystem: true } } as never);

        const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
        const sets = [PermissionSetSchema.parse({ name: 'rcd_member', label: 'Member', isDefault: true, objects: { '*': all } })];
        const services: Record<string, any> = {
            manifest: { register: vi.fn() },
            objectql: engine,
            metadata: {
                get: async (type: string, name: string) =>
                    (type === 'permission' ? sets.find((s) => s.name === name) : engine.getSchema(name)) ?? null,
                list: async (type: string) => (type === 'permission' ? sets : []),
            },
        };
        const ctx = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            registerService: vi.fn((name: string, service: unknown) => { services[name] = service; }),
            getService: (name: string) => {
                if (!(name in services)) throw new Error(`service not registered: ${name}`);
                return services[name];
            },
        };
        const security = new SecurityPlugin({ fallbackPermissionSet: 'rcd_member' });
        await security.init(ctx as never);
        await security.start(ctx as never);

        protocol = new ObjectStackProtocolImplementation(engine as any);
        const tools = createRecordContextTools();
        const runtime = new MCPServerRuntime({ name: 'objectstack', version: '0.0.0' });
        const served: Record<string, any> = {
            ...services,
            protocol,
            'record-context': { recordContextTools: () => tools },
            mcp: { handleHttpRequest: (req: Request, o: any) => runtime.handleHttpRequest(req, o) },
        };
        const get = (n: string) => served[n] ?? null;
        kernel = { getService: get, getServiceAsync: async (n: string) => get(n), context: { getService: get } };
    }, 60_000);

    afterAll(async () => {
        try { await engine?.destroy(); } catch { /* best effort */ }
    });

    it('the served listing carries the read decoration, and the call is answered through the pack', async () => {
        // Precondition: the protocol serves the pack decorated, as `/meta/ai_context` does.
        // Were it served bare, this case could not tell a door that strips from one that does not.
        const listed: any = await protocol.getMetaItems({ type: 'ai_context' });
        const served = listed.items.find((p: { name?: string }) => p.name === 'rcd_policy_document');
        expect(served?._packageId).toBe(PKG_ID);
        expect(served).toHaveProperty('_diagnostics');

        const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
        const body = {
            jsonrpc: '2.0', id: 1, method: 'tools/call',
            params: { name: 'get_record_context', arguments: { objectName: 'rcd_policy', recordId: 'p1', context: 'rcd_policy_document' } },
        };
        const res = await dispatcher.handleMcp(body, {
            request: new Request('http://localhost/api/v1/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
                body: JSON.stringify(body),
            }),
            response: {},
            environmentId: undefined,
            executionContext: { userId: 'usr_member', tenantId: 'org_1', positions: [], permissions: [], systemPermissions: [] },
        } as any);
        expect(res.response?.status).toBe(200);
        const result = (res.response?.body as any)?.result;
        expect(result?.isError, JSON.stringify(result)).not.toBe(true);
        const answer = JSON.parse(result.content[0].text);
        expect(answer.data.pack.name).toBe('rcd_policy_document');
        expect(answer.data.fields.map((f: { name: string; value: unknown }) => [f.name, f.value])).toEqual([
            ['title', 'Fire cover'],
            ['status', 'active'],
        ]);
    });

    it('[ADR-0150 addendum 2026-11-25] two packages\' packs of one name on one root: each is reached by its face, and the bare name is refused naming both', async () => {
        for (const [id, namespace, label] of [['com.acme.rcd_sales', 'rcds', 'Sales brief'], ['com.acme.rcd_people', 'rcdp', 'People brief']]) {
            engine.registerApp({
                id, name: id, version: '1.0.0', type: 'plugin', scope: 'system', namespace,
                aiContexts: [{ name: 'rcd_brief', label, object: 'rcd_policy', fields: ['title'] }],
            } as never);
        }
        const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
        const call = async (context: string) => {
            const body = {
                jsonrpc: '2.0', id: 1, method: 'tools/call',
                params: { name: 'get_record_context', arguments: { objectName: 'rcd_policy', recordId: 'p1', context } },
            };
            const res = await dispatcher.handleMcp(body, {
                request: new Request('http://localhost/api/v1/mcp', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
                    body: JSON.stringify(body),
                }),
                response: {},
                environmentId: undefined,
                executionContext: { userId: 'usr_member', tenantId: 'org_1', positions: [], permissions: [], systemPermissions: [] },
            } as any);
            expect(res.response?.status).toBe(200);
            const result = (res.response?.body as any)?.result;
            return { isError: result?.isError === true, payload: JSON.parse(result.content[0].text) };
        };
        const sales = await call('rcds-rcd_brief');
        expect(sales.isError, JSON.stringify(sales.payload)).toBe(false);
        expect(sales.payload.data.pack).toEqual({ name: 'rcd_brief', label: 'Sales brief' });
        const people = await call('rcdp-rcd_brief');
        expect(people.isError, JSON.stringify(people.payload)).toBe(false);
        expect(people.payload.data.pack).toEqual({ name: 'rcd_brief', label: 'People brief' });
        const bare = await call('rcd_brief');
        expect(bare.isError).toBe(true);
        expect(bare.payload.error).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
        expect(bare.payload.error.message).toContain('rcds-rcd_brief');
        expect(bare.payload.error.message).toContain('rcdp-rcd_brief');
    });
});

/**
 * [ADR-0149 D7 · ADR-0160 D3/D4] The two MCP doors over ONE real kernel, for
 * ONE caller: the `/mcp` route (`HttpDispatcher.handleMcp` into the real
 * `MCPServerRuntime`, this package's HTTP data bridge) and the long-lived
 * stdio session of the real `MCPServerPlugin` (`createStdioDataBridge`),
 * both answering through the real `record-context` service
 * (`RecordContextServicePlugin`) over a real `ObjectQL` on `SqlDriver`, the
 * real `SecurityPlugin` and the real protocol. Nothing of the metadata plane,
 * the data plane or the executor is a double.
 *
 * The caller is one identity per call: the stdio session resolves its
 * `OS_MCP_STDIO_API_KEY` through `resolveAuthzContext` and
 * `assembleExecutionContext`, and the `/mcp` request is handed the context
 * those same two calls assemble for the same key. Every case below asks both
 * doors the same call and requires the same bytes back, refusals included.
 * The key's owner is `usr_member`; one case names `usr_plain` as its owner
 * instead, the same user bar the capability that lifts a masking rule.
 *
 * Where `main` differs from ADR-0160 as amended 2026-11-25 (a related child
 * THIS caller is not served is left out and stated, not refused), the case
 * pins what the executor does today and says so in its title.
 */
describe('[ADR-0149 D7 · ADR-0160 D4] get_record_context over one real kernel: the /mcp door and the stdio door answer one caller with the same bytes', () => {
    const PKG = 'com.objectstack.qa.record-context-parity';
    const OFF_PKG = 'com.objectstack.qa.record-context-parity-off';
    const KEY = 'osk_rc_parity_key_000000000000000000000000';
    const READ_ALL = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
    const READ_NONE = { allowRead: false, allowCreate: false, allowEdit: false, allowDelete: false };
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;
    let dispatcher: HttpDispatcher;
    let caller: ExecutionContext;
    /**
     * A second caller of the same key's door, without the capability that lifts
     * `rc_step.serial`'s masking rule: `usr_member` holds `rc_unmask` through
     * its own grant of `rc_unmasker`; `usr_plain` holds the baseline only.
     */
    let plainCaller: ExecutionContext;
    /** Whom the key's owner row names on this call: the stdio door re-resolves it per call. */
    let keyOwner: 'usr_member' | 'usr_plain' = 'usr_member';
    let rpc: (method: string, params?: unknown) => Promise<any>;
    /** The real `security` service both doors resolve. */
    let securityService: any;
    /** [#37666] The stdio door's plugin-context logger: the door writes its 5xx fault lines here. */
    let stdioLogger: { info: Mock; warn: Mock; error: Mock; debug: Mock };
    /** The execution context the stdio door handed the engine, per object read. */
    const stdioReads: Array<{ object: string; context: any }> = [];

    beforeAll(async () => {
        vi.stubEnv('OS_MCP_STDIO_API_KEY', KEY);
        engine = new ObjectQL();
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
        const store = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject] as any[];
        await driver.initObjects(store);
        engine.registerDriver(driver as any, true);
        await engine.init();
        for (const o of store) engine.registry.registerObject(o, '@objectstack/platform-objects');
        const child = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
            name, label, nameField: 'version', sharingModel: 'public_read_write', ...extra,
            fields: {
                version: { name: 'version', type: 'text', label: 'Version' },
                policy: { name: 'policy', type: 'lookup', reference: 'rc_policy', label: 'Policy' },
            },
        });
        engine.registerApp({
            id: PKG, name: 'record context parity', version: '1.0.0', type: 'plugin', scope: 'system',
            objects: [
                {
                    name: 'rc_policy', label: 'Policy', nameField: 'title', sharingModel: 'public_read_write',
                    fields: {
                        title: { name: 'title', type: 'text', label: 'Title' },
                        status: { name: 'status', type: 'select', label: 'Status', options: [{ value: 'active', label: 'Active' }] },
                        secret_note: { name: 'secret_note', type: 'text', label: 'Secret note' },
                        vault: { name: 'vault', type: 'lookup', reference: 'rc_vault', label: 'Vault' },
                        content: { name: 'content', type: 'markdown', label: 'Content' },
                    },
                },
                child('rc_revision', 'Revision'),
                {
                    name: 'rc_step', label: 'Step', nameField: 'label', sharingModel: 'public_read_write',
                    fields: {
                        label: { name: 'label', type: 'text', label: 'Label' },
                        stage: { name: 'stage', type: 'text', label: 'Stage' },
                        rank: { name: 'rank', type: 'number', label: 'Rank' },
                        policy: { name: 'policy', type: 'lookup', reference: 'rc_policy', label: 'Policy' },
                        // A masking rule `rc_unmask` lifts: the security service lists it as queryable
                        // for `usr_member`, where the contract's fallback never would, and not for `usr_plain`.
                        serial: { name: 'serial', type: 'text', label: 'Serial', maskingRule: { keepHead: 1, keepTail: 1 }, requiredPermissions: ['rc_unmask'] },
                    },
                },
                child('rc_closed', 'Closed', { enable: { apiEnabled: false } }),
                child('rc_hidden', 'Hidden'),
                // Served to `usr_member` alone (its `rc_unmasker` grant), not to `usr_plain`.
                child('rc_partner', 'Partner'),
                {
                    name: 'rc_vault', label: 'Vault', sharingModel: 'public_read_write', enable: { apiEnabled: false },
                    fields: { label: { name: 'label', type: 'text', label: 'Label' } },
                },
            ],
            aiContexts: [
                {
                    name: 'rc_main', label: 'Policy document', object: 'rc_policy',
                    fields: ['title', 'status', 'secret_note', 'vault'],
                    related: [{ object: 'rc_revision', fields: ['version'] }],
                    body: { field: 'content' },
                },
                {
                    name: 'rc_unserved_child', label: 'Unserved child', object: 'rc_policy', fields: ['title'],
                    related: [{ object: 'rc_hidden', fields: ['version'] }, { object: 'rc_revision', fields: ['version'] }],
                },
                {
                    name: 'rc_filtered', label: 'Filtered steps', object: 'rc_policy', fields: ['title'],
                    related: [{ object: 'rc_step', fields: ['label', 'rank'], where: { stage: { $eq: 'open' } }, orderBy: [{ field: 'rank', order: 'desc' }], limit: 2 }],
                },
                {
                    name: 'rc_unqueryable_where', label: 'Unqueryable where', object: 'rc_policy', fields: ['title'],
                    related: [
                        { object: 'rc_step', fields: ['label'], where: { stage: { $ne: 'closed' } } },
                        { object: 'rc_revision', fields: ['version'] },
                    ],
                },
                {
                    name: 'rc_unmasked_order', label: 'Steps by serial', object: 'rc_policy', fields: ['title'],
                    related: [{ object: 'rc_step', fields: ['label'], orderBy: [{ field: 'serial', order: 'desc' }] }],
                },
                {
                    name: 'rc_created_order', label: 'Steps by creation', object: 'rc_policy', fields: ['title'],
                    related: [{ object: 'rc_step', fields: ['label'], orderBy: [{ field: 'created_at', order: 'desc' }] }],
                },
                {
                    name: 'rc_steps', label: 'Steps', object: 'rc_policy', fields: ['title'],
                    related: [{ object: 'rc_step', fields: ['label'], orderBy: [{ field: 'rank', order: 'asc' }] }],
                },
                { name: 'rc_exposure_child', label: 'Exposure child', object: 'rc_policy', fields: ['title'], related: [{ object: 'rc_closed', fields: ['version'] }] },
                { name: 'rc_disabled_child', label: 'Disabled child', object: 'rc_policy', fields: ['title'], related: [{ object: 'rc_off', fields: ['version'] }] },
                // [ADR-0160 D1] An author defect: `rc_ghost` is an object the stack does not define.
                {
                    name: 'rc_ghost_child', label: 'Ghost child', object: 'rc_policy', fields: ['title'],
                    related: [{ object: 'rc_ghost', fields: ['version'] }, { object: 'rc_step', fields: ['label'], orderBy: [{ field: 'rank', order: 'asc' }] }],
                },
                {
                    name: 'rc_role_child', label: 'Role child', object: 'rc_policy', fields: ['title'],
                    related: [{ object: 'rc_partner', fields: ['version'] }, { object: 'rc_step', fields: ['label'], orderBy: [{ field: 'rank', order: 'asc' }] }],
                },
            ],
        } as never);
        engine.registerApp({
            id: OFF_PKG, name: 'record context parity (off)', version: '1.0.0', type: 'plugin', scope: 'system',
            objects: [child('rc_off', 'Off')],
        } as never);
        await engine.syncSchemas();
        const sys = { context: { isSystem: true } } as never;
        await engine.insert('rc_vault', { id: 'v1', label: 'Vault 1', organization_id: 'org_1' }, sys);
        await engine.insert('rc_policy', {
            id: 'p1', title: 'Fire cover', status: 'active', secret_note: 'hush', vault: 'v1',
            content: '# Scope\nCovers fire.\n# Exclusions\nFlood.', organization_id: 'org_1',
        }, sys);
        // A body of 300 headings at one level, past the body bound: its outline comes in pages.
        await engine.insert('rc_policy', {
            id: 'p2', title: 'Long cover', status: 'active', secret_note: 'hush', vault: 'v1',
            content: Array.from({ length: 300 }, (_, i) => `## Clause ${i + 1}\nThe insurer pays clause ${i + 1}.\n`).join(''),
            organization_id: 'org_1',
        }, sys);
        await engine.insert('rc_revision', { id: 'r1', version: 'v1', policy: 'p1', owner_id: 'usr_member', organization_id: 'org_1' }, sys);
        await engine.insert('rc_revision', { id: 'r2', version: 'v2', policy: 'p1', owner_id: 'usr_other', organization_id: 'org_1' }, sys);
        await engine.insert('rc_hidden', { id: 'h1', version: 'h', policy: 'p1', organization_id: 'org_1' }, sys);
        await engine.insert('rc_partner', { id: 'pt1', version: 'pt', policy: 'p1', organization_id: 'org_1' }, sys);
        for (const [id, stage, rank, at] of [
            ['s1', 'open', 1, '2026-11-01T00:00:00.000Z'],
            ['s2', 'open', 3, '2026-11-02T00:00:00.000Z'],
            ['s3', 'open', 2, '2026-11-03T00:00:00.000Z'],
            ['s4', 'closed', 5, '2026-11-04T00:00:00.000Z'],
        ] as const) {
            await engine.insert('rc_step', {
                id, label: `Step ${id}`, stage, rank, policy: 'p1', serial: `N-${rank}`, created_at: at, organization_id: 'org_1',
            }, sys);
        }
        engine.registry.disablePackage(OFF_PKG);

        const sets = [PermissionSetSchema.parse({
            name: 'rc_member', label: 'Member', isDefault: true,
            objects: { '*': READ_ALL, rc_hidden: READ_NONE, rc_partner: READ_NONE },
            fields: { 'rc_policy.secret_note': { readable: false, editable: false } },
            rowLevelSecurity: [{ name: 'rc_own_revisions', object: 'rc_revision', operation: 'select', using: 'owner_id == current_user.id' }],
        }), PermissionSetSchema.parse({
            // Granted to `usr_member` alone (its `sys_user_permission_set` row below).
            name: 'rc_unmasker', label: 'Unmasker', systemPermissions: ['rc_unmask'], objects: { rc_partner: READ_ALL },
        })];
        const services: Record<string, any> = {
            manifest: { register: vi.fn() },
            objectql: engine,
            metadata: {
                get: async (type: string, name: string) =>
                    (type === 'permission' ? sets.find((s) => s.name === name) : engine.getSchema(name)) ?? null,
                list: async (type: string) => (type === 'permission' ? sets : []),
            },
        };
        const ctx = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            registerService: vi.fn((name: string, service: unknown) => { services[name] = service; }),
            getService: (name: string) => {
                if (!(name in services)) throw new Error(`service not registered: ${name}`);
                return services[name];
            },
        };
        const security = new SecurityPlugin({ fallbackPermissionSet: 'rc_member' });
        await security.init(ctx as never);
        await security.start(ctx as never);
        securityService = services.security;
        await new RecordContextServicePlugin().init(ctx as never);
        protocol = new ObjectStackProtocolImplementation(engine as any);

        // The key's auth tables (`sys_api_key`, `sys_user`, `sys_member`,
        // `sys_user_permission_set`) are not part of this kernel: these answers
        // stand in for them, for the one key (owner {@link keyOwner}, active in
        // `org_1`; `usr_member` alone granted `rc_unmasker`); every other read is
        // the engine's, and the stdio door's are recorded with their context.
        const keyedQl = new Proxy(engine as any, {
            get(target, prop, receiver) {
                if (prop === 'update') {
                    return async (object: string, data: unknown, options?: unknown) =>
                        object === 'sys_api_key' ? {} : target.update(object, data, options);
                }
                if (prop === 'find') {
                    return async (object: string, query?: any, options?: any) => {
                        const users = ['usr_member', 'usr_plain'];
                        if (object === 'sys_api_key') {
                            return [{ id: 'k1', user_id: keyOwner, revoked: false, active_organization_id: 'org_1' }];
                        }
                        if (object === 'sys_user') return users.includes(query?.where?.id) ? [{ id: query.where.id }] : [];
                        if (object === 'sys_member') {
                            const members = users.map((u, i) => ({ id: `m${i + 1}`, user_id: u, organization_id: 'org_1', role: 'member' }));
                            const who = query?.where?.user_id;
                            return who === undefined ? members : members.filter((m) => m.user_id === who);
                        }
                        if (object === 'sys_user_permission_set') {
                            return query?.where?.user_id === 'usr_member'
                                ? [{ id: 'g1', user_id: 'usr_member', permission_set: 'rc_unmasker', organization_id: 'org_1' }]
                                : [];
                        }
                        if (object.startsWith('sys_') && !target.registry.getObject(object)) return [];
                        stdioReads.push({ object, context: query?.context ?? options?.context });
                        return target.find(object, query, options);
                    };
                }
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const resolveCaller = async (): Promise<ExecutionContext> => assembleExecutionContext({
            authz: await resolveAuthzContext({ ql: keyedQl, headers: { 'x-api-key': KEY }, tenancyPosture: undefined, client: { transport: 'stdio' } } as never),
            oauth: undefined, localization: undefined, requestLocale: undefined, accessToken: undefined,
        } as never) as ExecutionContext;
        caller = await resolveCaller();
        keyOwner = 'usr_plain';
        try { plainCaller = await resolveCaller(); } finally { keyOwner = 'usr_member'; }

        // The stdio door: the real plugin's long-lived session, over an in-process transport.
        const stdioServices = new Map<string, unknown>(Object.entries({
            metadata: services.metadata, protocol, objectql: keyedQl, security: services.security,
            'record-context': services['record-context'],
        }));
        const sctx: any = {
            registerService: vi.fn((name: string, service: unknown) => stdioServices.set(name, service)),
            getService: vi.fn((name: string) => {
                if (!stdioServices.has(name)) throw new Error(`Service "${name}" not found`);
                return stdioServices.get(name);
            }),
            replaceService: vi.fn(),
            getServices: vi.fn(() => stdioServices),
            hook: vi.fn(),
            trigger: vi.fn(async () => {}),
            logger: (stdioLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
            getKernel: vi.fn(() => ({})),
        };
        const plugin = new MCPServerPlugin({ autoStart: true });
        await plugin.init(sctx);
        const stdioRuntime = stdioServices.get('mcp') as MCPServerRuntime;
        vi.spyOn(stdioRuntime, 'start').mockResolvedValue(undefined);
        await plugin.start(sctx);
        const waiting = new Map<number, (frame: any) => void>();
        let nextId = 1;
        const transport: any = {
            async start() {},
            async close() { transport.onclose?.(); },
            async send(message: any) {
                const resolve = typeof message?.id === 'number' ? waiting.get(message.id) : undefined;
                if (resolve) { waiting.delete(message.id); resolve(message); }
            },
        };
        rpc = (method, params) => new Promise<any>((resolve) => {
            const id = nextId++;
            waiting.set(id, resolve);
            transport.onmessage?.({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
        });
        await stdioRuntime.server.connect(transport as never);
        await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'parity', version: '0' } });
        transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' });

        // The /mcp door: the dispatcher over the same kernel's services and a fresh MCP runtime per request.
        const httpRuntime = new MCPServerRuntime({ name: 'objectstack', version: '0.0.0' });
        const served: Record<string, any> = {
            ...services,
            protocol,
            mcp: { handleHttpRequest: (req: Request, o: any) => httpRuntime.handleHttpRequest(req, o) },
        };
        const get = (n: string) => served[n] ?? null;
        dispatcher = new HttpDispatcher({ getService: get, getServiceAsync: async (n: string) => get(n), context: { getService: get } } as any, undefined, { enforceProjectMembership: false });
    }, 60_000);

    afterAll(async () => {
        vi.unstubAllEnvs();
        try { await engine?.destroy(); } catch { /* best effort */ }
    });

    interface DoorAnswer { isError: boolean; text: string }

    const overHttp = async (args: Record<string, unknown>, tool = 'get_record_context', executionContext: ExecutionContext = caller): Promise<DoorAnswer> => {
        const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } };
        const res = await dispatcher.handleMcp(body, {
            request: new Request('http://localhost/api/v1/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
                body: JSON.stringify(body),
            }),
            response: {},
            environmentId: undefined,
            executionContext,
        } as any);
        expect(res.response?.status).toBe(200);
        const result = (res.response?.body as any)?.result;
        return { isError: result?.isError === true, text: result?.content?.[0]?.text };
    };
    const overStdio = async (args: Record<string, unknown>, tool = 'get_record_context'): Promise<DoorAnswer> => {
        const frame = await rpc('tools/call', { name: tool, arguments: args });
        return { isError: frame?.result?.isError === true, text: frame?.result?.content?.[0]?.text };
    };
    /** Both doors, one call: the same bytes, or the case fails here. */
    const both = async (args: Record<string, unknown>, tool = 'get_record_context') => {
        const http = await overHttp(args, tool);
        const stdio = await overStdio(args, tool);
        expect(typeof http.text).toBe('string');
        expect(stdio).toEqual(http);
        return { isError: http.isError, text: http.text, payload: JSON.parse(http.text) };
    };
    /** {@link both}, as `usr_plain`: the /mcp request carries its context, and the key's owner row names it for the stdio call. */
    const bothAsPlain = async (args: Record<string, unknown>, tool = 'get_record_context') => {
        keyOwner = 'usr_plain';
        try {
            const http = await overHttp(args, tool, plainCaller);
            const stdio = await overStdio(args, tool);
            expect(typeof http.text).toBe('string');
            expect(stdio).toEqual(http);
            return { isError: http.isError, text: http.text, payload: JSON.parse(http.text) };
        } finally {
            keyOwner = 'usr_member';
        }
    };

    it('precondition: the stdio session reads as the caller the /mcp request carries', async () => {
        expect(caller).toMatchObject({ userId: 'usr_member', tenantId: 'org_1' });
        stdioReads.length = 0;
        await overStdio({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_main' });
        const root = stdioReads.find((r) => r.object === 'rc_policy');
        expect(root?.context).toMatchObject({
            userId: caller.userId, tenantId: caller.tenantId, permissions: caller.permissions, positions: caller.positions,
        });
    });

    it('a record through its package pack: a hidden field stated, an unopenable lookup not shown, an unreadable related row absent', async () => {
        const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_main' });
        expect(answer.isError).toBe(false);
        const { data, notes } = answer.payload;
        expect(data.pack).toEqual({ name: 'rc_main', label: 'Policy document' });
        expect(data.record).toEqual({ object: 'rc_policy', id: 'p1', displayName: 'Fire cover' });
        // The hidden field (FLS) is not carried and not named; the notes state it.
        expect(data.fields.map((f: { name: string }) => f.name)).toEqual(['title', 'status', 'vault']);
        expect(answer.text).not.toContain('secret_note');
        expect(answer.text).not.toContain('hush');
        expect(notes.map((n: { kind: string }) => n.kind)).toEqual(['not_visible']);
        // [card amendment 4] The door decides an expansion target's API exposure:
        // `rc_vault` is `apiEnabled: false`, so its row is never expanded or named.
        expect(data.fields.find((f: { name: string }) => f.name === 'vault')).toEqual({ name: 'vault', label: 'Vault', notVisible: true });
        expect(answer.text).not.toContain('Vault 1');
        // The related list is read as the caller: the row its row rule refuses is absent.
        expect(data.related).toHaveLength(1);
        expect(data.related[0]).toMatchObject({ object: 'rc_revision', field: 'policy' });
        expect(data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['r1']);
        expect(data.body).toEqual({ field: 'content', label: 'Content', text: '# Scope\nCovers fire.\n# Exclusions\nFlood.' });
    });

    it('a root the caller may not read is refused before any pack is looked up, as get_record refuses it', async () => {
        const answer = await both({ objectName: 'rc_hidden', recordId: 'h1', context: 'rc_main' });
        expect(answer.isError).toBe(true);
        expect(answer.payload.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(answer.text).not.toContain('rc_main');
        const record = await both({ objectName: 'rc_hidden', recordId: 'h1' }, 'get_record');
        expect(record.isError).toBe(true);
        expect(answer.payload.error).toEqual(record.payload.error);
    });

    it('[ADR-0160 D3 as amended] a related child this caller is not served is left out: the root and the served child, one not-visible statement, the child named nowhere', async () => {
        const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_unserved_child' });
        expect(answer.isError).toBe(false);
        const { data, notes } = answer.payload;
        expect(data.fields.map((f: { name: string }) => f.name)).toEqual(['title']);
        // The served control: its section answers as the caller reads it.
        expect(data.related.map((l: { object: string }) => l.object)).toEqual(['rc_revision']);
        expect(data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['r1']);
        expect(notes.map((n: { kind: string }) => n.kind)).toEqual(['not_visible']);
        expect(answer.text).not.toContain('rc_hidden');
        expect(answer.text).not.toContain('Hidden');
    });

    it('[ADR-0160 D1/D3] a related entry naming an object the stack does not define leaves its section out and states nothing: the same bytes for both callers, on both doors', async () => {
        // Precondition: no package and no environment defines it, so it is an author defect (`os validate`).
        expect(engine.getSchema('rc_ghost')).toBeUndefined();
        expect(await protocol.getMetaItems({ type: 'object' } as never)).not.toContainEqual(expect.objectContaining({ name: 'rc_ghost' }));
        const member = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_ghost_child' });
        const plain = await bothAsPlain({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_ghost_child' });
        for (const answer of [member, plain]) {
            expect(answer.isError).toBe(false);
            // The other entry still answers; the undefined one has no section, no name and no statement.
            expect(answer.payload.data.related.map((l: { object: string }) => l.object)).toEqual(['rc_step']);
            expect(answer.payload.data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['s1', 's3', 's2', 's4']);
            expect(answer.payload.notes).toEqual([]);
            expect(answer.text).not.toContain('rc_ghost');
        }
        // Who asks changes nothing: one answer, byte for byte.
        expect(plain.text).toBe(member.text);
    });

    it('[ADR-0160 D3 as amended] a defined child served to one caller and not the other: its section for the one, the not-visible statement for the other, on both doors', async () => {
        const member = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_role_child' });
        expect(member.isError).toBe(false);
        expect(member.payload.data.related.map((l: { object: string }) => l.object)).toEqual(['rc_partner', 'rc_step']);
        expect(member.payload.data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['pt1']);
        expect(member.payload.notes).toEqual([]);
        const plain = await bothAsPlain({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_role_child' });
        expect(plain.isError).toBe(false);
        expect(plain.payload.data.related.map((l: { object: string }) => l.object)).toEqual(['rc_step']);
        expect(plain.payload.notes.map((n: { kind: string }) => n.kind)).toEqual(['not_visible']);
        expect(plain.payload.notes[0]).not.toHaveProperty('object');
        for (const word of ['rc_partner', 'Partner', 'pt1']) expect(plain.text).not.toContain(word);
    });

    it('a related child its API exposure refuses refuses the call, named (the caller\'s schema shows it)', async () => {
        const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_exposure_child' });
        expect(answer.isError).toBe(true);
        expect(answer.payload.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(answer.payload.error.message).toContain("'rc_closed'");
    });

    it('a related child whose package is disabled (OBJECT_PACKAGE_DISABLED) refuses the call, unnamed', async () => {
        await expect(protocol.getMetaItemForExecution({ type: 'object', name: 'rc_off' } as never)).rejects.toMatchObject({ code: 'OBJECT_PACKAGE_DISABLED' });
        const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_disabled_child' });
        expect(answer.isError).toBe(true);
        expect(answer.payload.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(answer.text).not.toContain('rc_off');
    });

    it('[ADR-0112] a related child whose list read fails (an outage, no coded refusal) fails the call INTERNAL_ERROR on both doors, naming nothing, never as a refusal', async () => {
        const OUTAGE = 'disk I/O error reading rc_revision.version';
        const real = engine.find.bind(engine);
        const failing = vi.spyOn(engine, 'find').mockImplementation(async (object: string, ...rest: any[]) => {
            if (object === 'rc_revision') throw new Error(OUTAGE);
            return (real as any)(object, ...rest);
        });
        // The doors' fault log (`logServerFault`, `@objectstack/types`): the /mcp door's runtime here
        // has no logger, so its lines take the console fallback; the stdio door's plugin hands the
        // runtime its context logger, so its lines go there (#37666).
        const errorLines = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnLines = vi.spyOn(console, 'warn').mockImplementation(() => {});
        stdioLogger.error.mockClear();
        stdioLogger.warn.mockClear();
        try {
            const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_main' });
            await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_main' });
            // An outage is a fault, never a declared capability absence: each door logs it at error,
            // with the outage as its cause, on every call, the second included.
            expect(warnLines.mock.calls.filter(([line]) => String(line).includes('capability absence'))).toEqual([]);
            expect(stdioLogger.warn.mock.calls.filter(([line]) => String(line).includes('capability absence'))).toEqual([]);
            const isFault = ([line]: unknown[]) =>
                typeof line === 'string' && line.startsWith('[5xx] 500') && line.includes('get_record_context rc_policy');
            const faults = errorLines.mock.calls.filter(isFault);
            expect(faults).toHaveLength(2);
            const stdioFaults = stdioLogger.error.mock.calls.filter(isFault);
            expect(stdioFaults).toHaveLength(2);
            for (const [, err, meta] of stdioFaults) {
                expect(meta).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
                // The logger renders the cause chain itself; the original rides on `cause`.
                expect(((err as Error).cause as Error | undefined)?.message).toBe(OUTAGE);
            }
            for (const [, meta] of faults) {
                expect(meta).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
                // The original reaches the line through the fault log's own `cause` rendering,
                // not through a suffix on the failure's stack.
                const { causes, stack } = meta as { causes?: Array<{ message: string; stack?: string }>; stack?: unknown };
                expect(causes?.[0]?.message).toBe(`Error: ${OUTAGE}`);
                expect(causes?.[0]?.stack).toContain(OUTAGE);
                expect(String(stack)).not.toContain('Caused by:');
            }
            // Reached through each door, so the answer is the outage's on both.
            expect(failing.mock.calls.filter(([object]) => object === 'rc_revision').length).toBeGreaterThanOrEqual(4);
            expect(answer.isError).toBe(true);
            expect(answer.payload.error).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
            // The wire carries no cause text: the fault line is the operator's alone.
            for (const word of ['rc_revision', 'disk I/O', 'version', 'causes', 'Caused by']) expect(answer.text).not.toContain(word);
        } finally {
            failing.mockRestore();
            errorLines.mockRestore();
            warnLines.mockRestore();
        }
        // Control: the same call reads once the list read answers.
        const control = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_main' });
        expect(control.isError).toBe(false);
        expect(control.payload.data.related[0]).toMatchObject({ object: 'rc_revision' });
    });

    it.each<[string, () => unknown, Record<string, unknown>]>([
        [
            'a sandboxed beforeFind hook\'s plain throw stays 400 HOOK_ABORTED, in the hook\'s words',
            () => Object.assign(new Error("beforeFind hook 'rc_gate' threw: Revisions are closed for review"), { innerMessage: 'Revisions are closed for review' }),
            { code: 'HOOK_ABORTED', status: 400, message: 'Revisions are closed for review' },
        ],
        [
            'a PERMISSION_DENIED with no status stays PERMISSION_DENIED, as the door renders it',
            () => Object.assign(new Error('Permission denied'), { code: 'PERMISSION_DENIED' }),
            { code: 'PERMISSION_DENIED' },
        ],
    ])('[ADR-0112] at the related list read, a throw the /data door answers as a refusal stays that refusal on both doors: %s', async (_label, thrown, expected) => {
        const real = engine.find.bind(engine);
        const refusing = vi.spyOn(engine, 'find').mockImplementation(async (object: string, ...rest: any[]) => {
            if (object === 'rc_revision') throw thrown();
            return (real as any)(object, ...rest);
        });
        try {
            const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_main' });
            expect(refusing.mock.calls.filter(([object]) => object === 'rc_revision').length).toBeGreaterThanOrEqual(2);
            expect(answer.isError).toBe(true);
            expect(answer.payload.error).toMatchObject(expected);
            // The door's refusal, as main answered it: never the fault's 500.
            expect([undefined, 400, 403]).toContain(answer.payload.error.status);
        } finally {
            refusing.mockRestore();
        }
        const control = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_main' });
        expect(control.isError).toBe(false);
        expect(control.payload.data.related[0]).toMatchObject({ object: 'rc_revision' });
    });

    it('[ADR-0112] at the related list read, a fault the /data door codes stays the door\'s answer on both doors: ERR_DATASOURCE_UNAVAILABLE 503 with its sentence, never INTERNAL_ERROR', async () => {
        const SENTENCE = 'The datasource for this object is not available';
        const real = engine.find.bind(engine);
        const unavailable = vi.spyOn(engine, 'find').mockImplementation(async (object: string, ...rest: any[]) => {
            if (object === 'rc_revision') throw Object.assign(new Error(SENTENCE), { code: 'ERR_DATASOURCE_UNAVAILABLE' });
            return (real as any)(object, ...rest);
        });
        const errorLines = vi.spyOn(console, 'error').mockImplementation(() => {});
        stdioLogger.error.mockClear();
        try {
            const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_main' });
            expect(unavailable.mock.calls.filter(([object]) => object === 'rc_revision').length).toBeGreaterThanOrEqual(2);
            expect(answer.isError).toBe(true);
            expect(answer.payload.error).toMatchObject({ code: 'ERR_DATASOURCE_UNAVAILABLE', status: 503, message: SENTENCE });
            // Each door still logs the fault it answered, under the door's own code: the /mcp door on
            // the console fallback, the stdio door on its plugin-context logger (#37666).
            const isFault = ([line]: unknown[]) =>
                typeof line === 'string' && line.startsWith('[5xx]') && line.includes('get_record_context rc_policy');
            const faults = [...errorLines.mock.calls.filter(isFault), ...stdioLogger.error.mock.calls.filter(isFault)];
            expect(faults).toHaveLength(2);
            expect(errorLines.mock.calls.filter(isFault)).toHaveLength(1);
            for (const [line] of faults) expect(String(line)).toMatch(/^\[5xx\] 503\b/);
            expect(JSON.stringify(errorLines.mock.calls.map(([, meta]) => meta))).not.toContain('INTERNAL_ERROR');
            expect(JSON.stringify(stdioLogger.error.mock.calls.map(([, , meta]) => meta))).not.toContain('INTERNAL_ERROR');
        } finally {
            unavailable.mockRestore();
            errorLines.mockRestore();
        }
        const control = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_main' });
        expect(control.isError).toBe(false);
        expect(control.payload.data.related[0]).toMatchObject({ object: 'rc_revision' });
    });

    it('[ADR-0160 D3, second amendment] where, orderBy and limit on a related list answer the same bytes on both doors: filtered, ordered, cut at the limit and stated', async () => {
        const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_filtered' });
        expect(answer.isError).toBe(false);
        const { data, notes } = answer.payload;
        expect(data.related).toHaveLength(1);
        expect(data.related[0]).toMatchObject({ object: 'rc_step', field: 'policy', truncated: true });
        expect(data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['s2', 's3']);
        expect(notes).toEqual([{ kind: 'related_truncated', object: 'rc_step', text: expect.stringContaining('2') }]);
    });

    it('[ADR-0160 D3, second amendment] a where field outside the security service\'s queryable answer drops the section with the statement on both doors, never refusing, though the fallback would admit it', async () => {
        // plugin-security's read projection already leaves out what its queryable answer leaves out,
        // bar masked fields (which the fallback refuses for everyone), so the answer is narrowed here by
        // one field the fallback admits: served, readable, declaring no masking rule.
        expect(await securityService.getReadableFields('rc_step', caller)).toContain('stage');
        expect((engine.getSchema('rc_step') as any)?.fields?.stage?.maskingRule).toBeUndefined();
        const real = securityService.getQueryableFields.bind(securityService);
        const narrowed = vi.spyOn(securityService, 'getQueryableFields').mockImplementation(async (object: any, ctx: any) => {
            const fields = await real(object, ctx);
            return object === 'rc_step' ? fields?.filter((f: string) => f !== 'stage') : fields;
        });
        try {
            const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_unqueryable_where' });
            expect(answer.isError).toBe(false);
            const { data, notes } = answer.payload;
            // The served control beside it still answers.
            expect(data.related.map((l: { object: string }) => l.object)).toEqual(['rc_revision']);
            expect(notes.map((n: { kind: string }) => n.kind)).toEqual(['not_visible']);
            expect(answer.text).not.toContain('stage');
            expect(answer.text).not.toContain('rc_step');
            // Asked on both doors, for the caller each resolved.
            const asked = narrowed.mock.calls.filter(([object]) => object === 'rc_step');
            expect(asked.length).toBeGreaterThanOrEqual(2);
            for (const [, ctx] of asked) expect(ctx).toMatchObject({ userId: caller.userId, tenantId: caller.tenantId });
        } finally {
            narrowed.mockRestore();
        }
    });

    it('[ADR-0160 D3, second amendment] an orderBy on a masked field this caller is served whole is read on both doors: the doors hand over the security service\'s answer, not the fallback', async () => {
        expect(await securityService.getQueryableFields('rc_step', caller)).toContain('serial');
        const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_unmasked_order' });
        expect(answer.isError).toBe(false);
        expect(answer.payload.notes).toEqual([]);
        expect(answer.payload.data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['s4', 's2', 's3', 's1']);
    });

    it('[ADR-0160 D3, second amendment] an orderBy on a masked field whose rule is NOT lifted for the caller drops the section with the statement on both doors, never refusing and naming nothing of it', async () => {
        // Precondition: the two callers differ in the capability alone, and each door reads as its caller.
        expect(plainCaller).toMatchObject({ userId: 'usr_plain', tenantId: 'org_1' });
        expect(caller.systemPermissions).toContain('rc_unmask');
        expect(plainCaller.systemPermissions ?? []).not.toContain('rc_unmask');
        expect(await securityService.getQueryableFields('rc_step', plainCaller)).not.toContain('serial');
        expect(await securityService.getQueryableFields('rc_step', caller)).toContain('serial');
        stdioReads.length = 0;
        const answer = await bothAsPlain({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_unmasked_order' });
        expect(stdioReads.find((r) => r.object === 'rc_policy')?.context).toMatchObject({ userId: 'usr_plain', tenantId: 'org_1' });
        expect(answer.isError).toBe(false);
        expect(answer.payload.data.record.id).toBe('p1');
        expect(answer.payload.data).not.toHaveProperty('related');
        expect(answer.payload.notes.map((n: { kind: string }) => n.kind)).toEqual(['not_visible']);
        expect(answer.payload.notes[0]).not.toHaveProperty('object');
        // No section, row, count or field name of the child (the pack's own label, "Steps by serial", is the author's).
        for (const word of ['rc_step', '"serial"', 'N-', 'Step s']) expect(answer.text).not.toContain(word);
        // Control leg: the same pack, as the caller whose capability lifts the rule, reads the section.
        const control = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_unmasked_order' });
        expect(control.payload.notes).toEqual([]);
        expect(control.payload.data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['s4', 's2', 's3', 's1']);
    });

    it('[ADR-0160 D3] an orderBy on a registry-injected field (created_at) is accepted by the own-field check and by both doors', async () => {
        const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_created_order' });
        expect(answer.isError).toBe(false);
        expect(answer.payload.notes).toEqual([]);
        expect(answer.payload.data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['s4', 's3', 's2', 's1']);
    });

    it('[ADR-0160 D3: every cut is stated] under a deployment page cap below the cut plus its probe row, both doors cut one row under the cap and state it', async () => {
        const plain = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_steps' });
        expect(plain.payload.data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['s1', 's3', 's2', 's4']);
        const saved = process.env.OS_DATA_MAX_PAGE_SIZE;
        process.env.OS_DATA_MAX_PAGE_SIZE = '3';
        try {
            const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_steps' });
            expect(answer.isError).toBe(false);
            const { data, notes } = answer.payload;
            expect(data.related[0].truncated).toBe(true);
            expect(data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['s1', 's3']);
            expect(notes).toEqual([{ kind: 'related_truncated', object: 'rc_step', text: expect.stringContaining('2') }]);
        } finally {
            if (saved === undefined) delete process.env.OS_DATA_MAX_PAGE_SIZE;
            else process.env.OS_DATA_MAX_PAGE_SIZE = saved;
        }
    });

    it('an anchor the body does not resolve is one coded answer', async () => {
        const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_main', anchor: 'nowhere' });
        expect(answer.isError).toBe(true);
        expect(answer.payload.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });

    it('[ADR-0160 D3] a long body\'s outline pages on both doors: outlineFrom reaches the executor through each, and the page it lists issues anchors that read their sections', async () => {
        const first = await both({ objectName: 'rc_policy', recordId: 'p2', context: 'rc_main' });
        expect(first.isError).toBe(false);
        const next = first.payload.data.body.outlineNext;
        expect(next).toBe(first.payload.data.body.outline.length);
        const page = await both({ objectName: 'rc_policy', recordId: 'p2', context: 'rc_main', outlineFrom: next });
        expect(page.isError).toBe(false);
        // A door that dropped the key would answer the first page again.
        expect(page.payload.data.body.outline[0]).toEqual({ anchor: `clause-${next + 1}`, heading: `Clause ${next + 1}`, level: 2 });
        const anchor = page.payload.data.body.outline.at(-1).anchor;
        const section = await both({ objectName: 'rc_policy', recordId: 'p2', context: 'rc_main', anchor });
        expect(section.payload.data.body.text).toMatch(/^## Clause \d+\nThe insurer pays clause \d+\.\n$/);
    });

    it('[ADR-0160 D3] an outlineFrom on a body carried whole is one coded answer on both doors', async () => {
        const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_main', outlineFrom: 80 });
        expect(answer.isError).toBe(true);
        expect(answer.payload.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });

    it('a pack served from the metadata registry (saved at run time, not shipped by the stack) is read', async () => {
        await protocol.saveMetaItem({
            type: 'ai_context', name: 'rc_registry',
            item: { name: 'rc_registry', label: 'Registry brief', object: 'rc_policy', fields: ['title', 'status'] },
        } as never);
        const listed: any = await protocol.getMetaItems({ type: 'ai_context' });
        const row = listed.items.find((p: { name?: string }) => p.name === 'rc_registry');
        expect(row).toBeDefined();
        expect(row?._packageId).toBeUndefined();
        const answer = await both({ objectName: 'rc_policy', recordId: 'p1', context: 'rc_registry' });
        expect(answer.isError).toBe(false);
        expect(answer.payload.data.pack).toEqual({ name: 'rc_registry', label: 'Registry brief' });
        expect(answer.payload.data.fields.map((f: { name: string; value: unknown }) => [f.name, f.value])).toEqual([
            ['title', 'Fire cover'],
            ['status', 'active'],
        ]);
    });
});
