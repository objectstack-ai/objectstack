// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34721] The HTTP MCP bridge's `list_objects` and `describe_object` answers
 * carry the object's and each field's AUTHORED `description`, read off the
 * object as the caller is served it (ADR-0106 D5) — so a field the caller
 * cannot read takes its description with it, and a definition that authors
 * none keeps the shape it always had (no `description` key).
 *
 * Driven over the real security layer (`SecurityPlugin` on a real `ObjectQL`
 * over a real `SqlDriver`, the protocol over that engine), through the bridge
 * the real `/mcp` entry builds for the caller. The stdio twin is
 * `packages/mcp/src/stdio-data-bridge.object-descriptions-34721.test.ts`.
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

const OBJ = 'mcp_desc_deal';
const PLAIN = 'mcp_desc_plain';
const DENIED = 'secret_margin';
const OBJECT_TEXT = 'A sales deal, from first call to signed order.';
const AMOUNT_TEXT = 'Amount, tax excluded.';
const DENIED_TEXT = 'Internal margin after rebates.';

const PERSONAS = {
    /** Denied one field. */
    member: { userId: 'usr_member', positions: [] as string[], permissions: ['mcp_desc_member'], systemPermissions: [] as string[] },
    /** Denied nothing: the control. */
    staff: { userId: 'usr_staff', positions: [] as string[], permissions: ['mcp_desc_staff'], systemPermissions: [] as string[] },
} as const;

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

describe('[#34721] HTTP MCP list_objects and describe_object serve the authored descriptions, as the caller is served the object', () => {
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
            id: 'com.objectstack.qa.mcp-object-descriptions',
            name: 'MCP object descriptions',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [
                {
                    name: OBJ,
                    label: 'Deal',
                    description: OBJECT_TEXT,
                    sharingModel: 'public_read_write',
                    fields: {
                        subject: { name: 'subject', type: 'text', label: 'Subject' },
                        amount: { name: 'amount', type: 'currency', label: 'Amount', description: AMOUNT_TEXT },
                        blank_note: { name: 'blank_note', type: 'text', label: 'Note', description: '   ' },
                        [DENIED]: { name: DENIED, type: 'currency', label: 'Margin', description: DENIED_TEXT },
                    },
                },
                {
                    name: PLAIN,
                    label: 'Plain',
                    sharingModel: 'public_read_write',
                    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
                },
            ],
        } as never);
        await engine.syncSchemas();
        const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
        const sets = [
            PermissionSetSchema.parse({
                name: 'mcp_desc_member', label: 'Member', objects: { '*': all },
                fields: { [`${OBJ}.${DENIED}`]: { readable: false, editable: false } },
            }),
            PermissionSetSchema.parse({ name: 'mcp_desc_staff', label: 'Staff', objects: { '*': all } }),
        ];
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
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'mcp_desc_staff' });
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

    const bridgeAs = (persona: Record<string, unknown>) => bridgeFor(kernelOver(services), persona);
    const field = (described: any, name: string) => described.fields.find((f: any) => f.name === name);

    it('describe_object: a readable field\'s description is returned, a field the member cannot read is withheld with its description', async () => {
        const described = await (await bridgeAs(PERSONAS.member)).describeObject(OBJ);
        expect(described.description).toBe(OBJECT_TEXT);
        expect(field(described, 'amount')).toMatchObject({ name: 'amount', label: 'Amount', description: AMOUNT_TEXT });
        expect(field(described, DENIED)).toBeUndefined();
        expect(JSON.stringify(described)).not.toContain(DENIED_TEXT);
    });

    it('CONTROL — the unrestricted member is returned the same field\'s description', async () => {
        const described = await (await bridgeAs(PERSONAS.staff)).describeObject(OBJ);
        expect(field(described, DENIED)).toMatchObject({ name: DENIED, description: DENIED_TEXT });
        expect(field(described, 'amount')).toMatchObject({ description: AMOUNT_TEXT });
    });

    it('describe_object: a field or object that authors no description (or a blank one) carries no description key', async () => {
        const bridge = await bridgeAs(PERSONAS.member);
        const described = await bridge.describeObject(OBJ);
        expect('description' in field(described, 'subject')).toBe(false);
        expect('description' in field(described, 'blank_note')).toBe(false);
        expect('description' in (await bridge.describeObject(PLAIN))).toBe(false);
    });

    it('list_objects: each object\'s authored description, and no key on an object that authors none', async () => {
        const listed: any[] = await (await bridgeAs(PERSONAS.member)).listObjects();
        const deal = listed.find((o) => o.name === OBJ);
        const plain = listed.find((o) => o.name === PLAIN);
        expect(deal).toMatchObject({ name: OBJ, label: 'Deal', description: OBJECT_TEXT });
        expect(plain).toBeDefined();
        expect('description' in plain).toBe(false);
    });
});
