// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * WIP PROBE, not a deliverable: the bring-up of the record-context HTTP/stdio
 * parity rig, kept on this branch so the work resumes from it.
 *
 * What it measured at ad604c10: every pack the protocol's merged listing
 * serves carries the `_diagnostics` decoration (`decorateMetadataItem`), and
 * the executor's strict `AiContextSchema` parse (`parsedContextPacks`) drops
 * the row, so both doors answer "no context pack" for a valid pack. With
 * `RC_STRIP=1` the rig strips the decoration (a CONTROL only) and the HTTP door
 * reads the pack. The stdio half still answers RECORD_NOT_FOUND for the same
 * row: its key-resolved caller is not yet the HTTP caller.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SysMetadataAuditObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { MCPServerPlugin, MCPServerRuntime } from '@objectstack/mcp';
import { RecordContextServicePlugin } from '@objectstack/service-record-context';
import { HttpDispatcher } from '../http-dispatcher.js';
import '@objectstack/metadata';

const PKG = 'com.objectstack.qa.record-context-37175';
const OFF_PKG = 'com.objectstack.qa.record-context-37175-off';
const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };

describe('probe', () => {
    let engine: ObjectQL;
    const services: Record<string, any> = {};
    const stdioServices = new Map<string, unknown>();
    let rpc: (method: string, params?: unknown) => Promise<any>;
    const contexts: any[] = [];

    beforeAll(async () => {
        engine = new ObjectQL();
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
        const storeObjects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject] as any[];
        await driver.initObjects(storeObjects);
        engine.registerDriver(driver as any, true);
        await engine.init();
        for (const o of storeObjects) engine.registry.registerObject(o, '@objectstack/platform-objects');
        engine.registerApp({
            id: PKG, name: 'record context rig', version: '1.0.0', type: 'plugin', scope: 'system',
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
                {
                    name: 'rc_revision', label: 'Revision', nameField: 'version', sharingModel: 'private',
                    fields: {
                        version: { name: 'version', type: 'text', label: 'Version' },
                        policy: { name: 'policy', type: 'lookup', reference: 'rc_policy', label: 'Policy' },
                    },
                },
                {
                    name: 'rc_vault', label: 'Vault', enable: { apiEnabled: false }, sharingModel: 'public_read_write',
                    fields: { label: { name: 'label', type: 'text', label: 'Label' } },
                },
                {
                    name: 'rc_closed', label: 'Closed', enable: { apiEnabled: false }, sharingModel: 'public_read_write',
                    fields: {
                        version: { name: 'version', type: 'text', label: 'Version' },
                        policy: { name: 'policy', type: 'lookup', reference: 'rc_policy', label: 'Policy' },
                    },
                },
                {
                    name: 'rc_hidden', label: 'Hidden', sharingModel: 'public_read_write',
                    fields: {
                        version: { name: 'version', type: 'text', label: 'Version' },
                        policy: { name: 'policy', type: 'lookup', reference: 'rc_policy', label: 'Policy' },
                    },
                },
                {
                    name: 'sys_rc_note', label: 'Note', sharingModel: 'public_read_write',
                    fields: {
                        body: { name: 'body', type: 'text', label: 'Body' },
                        policy: { name: 'policy', type: 'lookup', reference: 'rc_policy', label: 'Policy' },
                    },
                },
            ],
            aiContexts: [
                {
                    name: 'rc_main', label: 'Policy document', object: 'rc_policy',
                    fields: ['title', 'status', 'secret_note', 'vault'],
                    related: [{ object: 'rc_revision', fields: ['version'] }],
                    body: { field: 'content' },
                },
            ],
        } as never);
        engine.registerApp({
            id: OFF_PKG, name: 'record context rig (off)', version: '1.0.0', type: 'plugin', scope: 'system',
            objects: [{
                name: 'rc_off', label: 'Off', sharingModel: 'public_read_write',
                fields: {
                    version: { name: 'version', type: 'text', label: 'Version' },
                    policy: { name: 'policy', type: 'lookup', reference: 'rc_policy', label: 'Policy' },
                },
            }],
        } as never);
        await engine.syncSchemas();
        await engine.insert('rc_vault', { id: 'v1', label: 'Vault 1', organization_id: 'org_1' }, { context: { isSystem: true } } as never);
        await engine.insert('rc_policy', { id: 'p1', title: 'Fire cover', status: 'active', secret_note: 'hush', vault: 'v1', content: '# Scope\nCovers fire.\n# Exclusions\nFlood.', organization_id: 'org_1' }, { context: { isSystem: true } } as never);
        await engine.insert('rc_revision', { id: 'r1', version: 'v1', policy: 'p1', owner_id: 'usr_member', organization_id: 'org_1' }, { context: { isSystem: true } } as never);
        await engine.insert('rc_revision', { id: 'r2', version: 'v2', policy: 'p1', owner_id: 'usr_other', organization_id: 'org_1' }, { context: { isSystem: true } } as never);

        const sets = [
            PermissionSetSchema.parse({
                name: 'rc_member', label: 'Member', isDefault: true,
                objects: { '*': all, rc_hidden: { allowRead: false, allowCreate: false, allowEdit: false, allowDelete: false } },
                fields: { 'rc_policy.secret_note': { readable: false, editable: false } },
            }),
        ];
        const pluginServices: Record<string, unknown> = {
            manifest: { register: vi.fn() },
            objectql: engine,
            metadata: {
                get: async (type: string, name: string) =>
                    (type === 'permission' ? sets.find((s: any) => s?.name === name) : engine.getSchema(name)) ?? null,
                list: async (type: string) => (type === 'permission' ? sets : []),
            },
        };
        const ctx = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            registerService: vi.fn((name: string, service: unknown) => { pluginServices[name] = service; }),
            getService: (name: string) => {
                if (!(name in pluginServices)) throw new Error(`service not registered: ${name}`);
                return pluginServices[name];
            },
        };
        const security = new SecurityPlugin({ fallbackPermissionSet: 'rc_member' });
        await security.init(ctx as never);
        await security.start(ctx as never);
        await new RecordContextServicePlugin().init(ctx as never);

        const realProtocol = new ObjectStackProtocolImplementation(engine as any);
        services.realProtocol = realProtocol;
        services.protocol = process.env.RC_STRIP ? new Proxy(realProtocol as any, {
            get(t, prop, r) {
                if (prop === 'getMetaItems') {
                    return async (req: any) => {
                        const out: any = await t.getMetaItems(req);
                        if (req?.type !== 'ai_context') return out;
                        return { ...out, items: out.items.map(({ _diagnostics, ...rest }: any) => rest) };
                    };
                }
                const v = Reflect.get(t, prop, r);
                return typeof v === 'function' ? v.bind(t) : v;
            },
        }) : realProtocol;
        services.security = pluginServices.security;
        services.objectql = engine;
        services['record-context'] = pluginServices['record-context'];
        services.metadata = pluginServices.metadata;

        // stdio
        process.env.OS_MCP_STDIO_API_KEY = 'osk_rc37175_probe_key_0000000000000000';
        const ql = new Proxy(engine as any, {
            get(target, prop, receiver) {
                if (prop === 'update') {
                    return async (object: string, data: unknown, options?: unknown) =>
                        object === 'sys_api_key' ? {} : target.update(object, data, options);
                }
                if (prop === 'find') {
                    return async (object: string, query?: unknown, options?: unknown) => {
                        if (object === 'sys_api_key') return [{ id: 'k1', user_id: 'usr_member', revoked: false }];
                        if (object === 'sys_user') return (query as any)?.where?.id === 'usr_member' ? [{ id: 'usr_member' }] : [];
                        if (object.startsWith('sys_') && object !== 'sys_metadata' && !target.registry.getObject(object)) return [];
                        contexts.push({ object, query, options });
                        return target.find(object, query, options);
                    };
                }
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        for (const [k, v] of Object.entries({ metadata: services.metadata, protocol: services.protocol, objectql: ql, security: services.security, 'record-context': services['record-context'] })) stdioServices.set(k, v);
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
            logger: { info: vi.fn(), warn: vi.fn((...a: any[]) => console.log('WARN', ...a)), error: vi.fn((...a: any[]) => console.log('ERR', ...a)), debug: vi.fn() },
            getKernel: vi.fn(() => ({})),
        };
        const plugin = new MCPServerPlugin({ autoStart: true });
        await plugin.init(sctx);
        const runtime = stdioServices.get('mcp') as MCPServerRuntime;
        vi.spyOn(runtime, 'start').mockResolvedValue(undefined);
        await plugin.start(sctx);
        const waiting = new Map<number, (frame: any) => void>();
        let nextId = 1;
        const transport: any = {
            onmessage: undefined, onclose: undefined, onerror: undefined,
            async start() {}, async close() { transport.onclose?.(); },
            async send(message: any) {
                const resolve = typeof message?.id === 'number' ? waiting.get(message.id) : undefined;
                if (resolve) { waiting.delete(message.id); resolve(message); }
            },
        };
        rpc = (method: string, params?: unknown) => new Promise<any>((resolve) => {
            const id = nextId++;
            waiting.set(id, resolve);
            transport.onmessage?.({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
        });
        await runtime.server.connect(transport as never);
        await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '0' } });
        transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' });
    }, 60_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        try { await engine?.destroy(); } catch { /* noop */ }
    });

    it('probes', async () => {
        console.log('PACKS', JSON.stringify(await services.protocol.getMetaItems({ type: 'ai_context' })).slice(0, 400));
        const s = await rpc('tools/call', { name: 'get_record_context', arguments: { objectName: 'rc_policy', recordId: 'p1', context: 'rc_main' } });
        console.log('STDIO', JSON.stringify(s).slice(0, 3000));
        const ec = contexts.find((c) => c.object === 'rc_policy');
        console.log('CTX', String(JSON.stringify(ec?.options ?? ec?.query ?? contexts.map((c) => c.object))).slice(0, 1500));
        const mcp: any = {
            handleHttpRequest: (req: Request, opts: any) => new MCPServerRuntime({ name: 'objectstack', version: '0.0.0' }).handleHttpRequest(req, opts),
        };
        const allSvc: Record<string, any> = { ...services, mcp };
        const get = (n: string) => allSvc[n] ?? null;
        const kernel = { getService: get, getServiceAsync: async (n: string) => get(n), context: { getService: get } } as any;
        const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
        const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_record_context', arguments: { objectName: 'rc_policy', recordId: 'p1', context: 'rc_main' } } };
        const res = await dispatcher.handleMcp(body, {
            request: new Request('http://localhost/api/v1/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) }),
            response: {}, environmentId: undefined,
            executionContext: { userId: 'usr_member', positions: [], permissions: [], systemPermissions: [] },
        } as any);
        console.log('HTTP', res.response?.status, JSON.stringify(res.response?.body).slice(0, 3000));
        expect(true).toBe(true);
    });
});
