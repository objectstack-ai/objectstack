// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36806] The HTTP MCP bridge's `describe_object` reports the HAND lock —
 * `uiReadonly` and `uiReadonlyWhen` — as their own keys, never folded into
 * `readonly`: `readonly` tells an agent to leave a field out of a write, and a
 * hand-locked field is one an agent's write still sets (the engine never reads
 * either key), while a person at the console cannot edit it.
 *
 * Driven over the real security layer, through the bridge the real `/mcp`
 * entry builds, on the harness of `mcp-object-descriptions-34721.test.ts`.
 * The stdio twin is pinned in `packages/mcp/src/__tests__/mcp-server-runtime.test.ts`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    OBJECT_SCHEMA_MASK_DISABLE_ENV,
    SysMetadataAuditObject,
    SysMetadataHistoryObject,
    SysMetadataObject,
} from '@objectstack/metadata-core';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from '../http-dispatcher.js';
// Paid at collection, not inside a case's clock: the dispatcher's reach loads it lazily.
import '@objectstack/metadata';

/** A kernel over `services`, with an `mcp` service that hands back the bridge `handleMcp` built. */
function kernelOver(services: Record<string, any>) {
    const mcp: any = {
        lastOpts: undefined,
        handleHttpRequest: async (_req: Request, o: any) => {
            mcp.lastOpts = o;
            return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        },
    };
    const all: Record<string, any> = { ...services, mcp };
    const get = (n: string) => all[n] ?? null;
    return { getService: get, getServiceAsync: async (n: string) => get(n), context: { getService: get } } as any;
}

/** Drive the real `/mcp` entry for `executionContext` and hand back the bridge it built. */
async function bridgeFor(kernel: any, executionContext: Record<string, unknown>) {
    const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const res = await dispatcher.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
        request: new Request('http://localhost/api/v1/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: '{}',
        }),
        response: {},
        environmentId: undefined,
        executionContext: { ...executionContext },
    } as any);
    expect(res.response?.status, 'precondition: the MCP route must have been served').toBe(200);
    return kernel.getService('mcp').lastOpts.bridge;
}

const OBJ = 'mcp_hand_order';
const LOCKED = 'mcp_hand_locked_order';
const STAFF = { userId: 'usr_staff', positions: [] as string[], permissions: ['mcp_hand_staff'], systemPermissions: [] as string[] };

const prevMcp = process.env.OS_MCP_SERVER_ENABLED;
const prevMask = process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
beforeEach(() => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
});
afterEach(() => {
    if (prevMcp === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prevMcp;
    if (prevMask === undefined) delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
    else process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = prevMask;
});

describe('[#36806] HTTP MCP describe_object reports uiReadonly / uiReadonlyWhen as their own keys', () => {
    let engine: ObjectQL;
    let services: Record<string, any>;

    beforeAll(async () => {
        engine = new ObjectQL();
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
        const storeObjects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject] as any[];
        await driver.initObjects(storeObjects);
        engine.registerDriver(driver as any, true);
        await engine.init();
        for (const o of storeObjects) engine.registry.registerObject(o, '@objectstack/platform-objects');
        engine.registerApp({
            id: 'com.objectstack.qa.mcp-object-hand-lock',
            name: 'MCP object hand lock',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [
                {
                    name: OBJ,
                    label: 'Order',
                    sharingModel: 'public_read_write',
                    fields: {
                        subject: { name: 'subject', type: 'text', label: 'Subject' },
                        status: { name: 'status', type: 'text', label: 'Status', uiReadonly: true },
                        note: { name: 'note', type: 'text', label: 'Note', uiReadonlyWhen: "record.status != 'draft'" },
                        locked: { name: 'locked', type: 'text', label: 'Locked', readonly: true },
                    },
                },
                {
                    // [#37402] The whole-record hand lock on the object.
                    name: LOCKED,
                    label: 'Locked order',
                    sharingModel: 'public_read_write',
                    uiReadonlyWhen: "record.status in ['confirmed', 'done']",
                    fields: {
                        status: { name: 'status', type: 'text', label: 'Status' },
                        notes: { name: 'notes', type: 'text', label: 'Notes', uiReadonlyWhen: 'false' },
                    },
                },
            ],
        } as never);
        await engine.syncSchemas();
        const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
        const sets = [PermissionSetSchema.parse({ name: 'mcp_hand_staff', label: 'Staff', objects: { '*': all } })];
        const pluginServices: Record<string, unknown> = {
            manifest: { register: vi.fn() },
            objectql: engine,
            metadata: {
                get: async (type: string, name: string) =>
                  (type === 'permission' ? sets.find((s: any) => s?.name === name) : engine.getSchema(name)) ?? null,
                list: async () => sets,
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
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'mcp_hand_staff' });
        await plugin.init(ctx as never);
        await plugin.start(ctx as never);
        vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
        services = {
            protocol: new ObjectStackProtocolImplementation(engine as any),
            security: pluginServices.security,
            objectql: engine,
        };
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    }, 60_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        try { await engine?.destroy(); } catch { /* noop */ }
    });

    const field = (described: any, name: string) => described.fields.find((f: any) => f.name === name);

    it('a `uiReadonly` field reads uiReadonly: true and readonly: false — not UI-editable, and still a write an agent may send', async () => {
        const described = await (await bridgeFor(kernelOver(services), STAFF)).describeObject(OBJ);
        expect(field(described, 'status')).toMatchObject({ name: 'status', readonly: false, uiReadonly: true });
        expect('uiReadonlyWhen' in field(described, 'status')).toBe(false);
    });

    it('a `uiReadonlyWhen` field carries its predicate text, and readonly stays false', async () => {
        const described = await (await bridgeFor(kernelOver(services), STAFF)).describeObject(OBJ);
        expect(field(described, 'note')).toMatchObject({ readonly: false, uiReadonlyWhen: "record.status != 'draft'" });
        expect('uiReadonly' in field(described, 'note')).toBe(false);
    });

    it('CONTROL — a field that authors neither key keeps the shape it had; a `readonly` one reads readonly: true alone', async () => {
        const described = await (await bridgeFor(kernelOver(services), STAFF)).describeObject(OBJ);
        const subject = field(described, 'subject');
        expect('uiReadonly' in subject || 'uiReadonlyWhen' in subject).toBe(false);
        expect(field(described, 'locked')).toMatchObject({ readonly: true });
        expect('uiReadonly' in field(described, 'locked')).toBe(false);
    });

    // [#37402] The object level of the same model, through the real security layer.
    it('an object-level `uiReadonlyWhen` is reported on the answer, and no field reads readonly for it', async () => {
        const described = await (await bridgeFor(kernelOver(services), STAFF)).describeObject(LOCKED);
        expect(described.uiReadonlyWhen).toBe("record.status in ['confirmed', 'done']");
        expect(field(described, 'status')).toMatchObject({ readonly: false });
        expect('uiReadonlyWhen' in field(described, 'status')).toBe(false);
        expect(field(described, 'notes')).toMatchObject({ readonly: false, uiReadonlyWhen: 'false' });
    });

    it('CONTROL — an object that authors no object-level predicate carries no key', async () => {
        const described = await (await bridgeFor(kernelOver(services), STAFF)).describeObject(OBJ);
        expect('uiReadonlyWhen' in described).toBe(false);
    });
});
