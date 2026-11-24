// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35138] What the MCP record tools build `notRecorded` / `ifNotRecorded`
 * from, on the HTTP bridge: the caller's served schema (`describeObject`) and
 * the caller's locale ladder (`userTextLocales`). The tool layer renders the
 * members (`packages/mcp/src/mcp-not-recorded.test.ts`); here the bridge's
 * two answers are pinned over the real security layer (`SecurityPlugin` on a
 * real `ObjectQL` over a real `SqlDriver`, the protocol over that engine),
 * through the bridge the real `/mcp` entry builds for the caller.
 *
 * The rule the tools hold: an object or field the caller cannot see is
 * answered exactly as one that does not exist for them. So the served schema
 * must not show it, and a read naming it must be refused, for both.
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

/** The rejection `run` raised, or `undefined` when it resolved. */
const rejectionOf = async (run: () => Promise<unknown>): Promise<any> => run().then(() => undefined, (e: unknown) => e);

const OBJ = 'mcp_nr_deal';
const VAULT = 'mcp_nr_vault';
const HIDDEN = 'secret_margin';
const UNKNOWN_FIELD = 'invoice_total';
const UNKNOWN_OBJECT = 'mcp_nr_invoice';

const PERSONAS = {
    /** Reads {@link OBJ} without {@link HIDDEN}; no grant on {@link VAULT}. */
    member: { userId: 'usr_member', positions: [] as string[], permissions: ['mcp_nr_member'], systemPermissions: [] as string[] },
    /** Reads everything: the control. */
    staff: { userId: 'usr_staff', positions: [] as string[], permissions: ['mcp_nr_staff'], systemPermissions: [] as string[] },
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

describe('[#35138] HTTP MCP bridge — the served schema and locale the not-recorded members are built from', () => {
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
            id: 'com.objectstack.qa.mcp-not-recorded',
            name: 'MCP not recorded',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [
                {
                    name: OBJ,
                    label: 'Deal',
                    sharingModel: 'public_read_write',
                    fields: {
                        subject: { name: 'subject', type: 'text', label: 'Subject' },
                        amount: { name: 'amount', type: 'currency', label: 'Amount' },
                        [HIDDEN]: { name: HIDDEN, type: 'currency', label: 'Margin' },
                    },
                },
                {
                    name: VAULT,
                    label: 'Vault',
                    sharingModel: 'public_read_write',
                    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
                },
            ],
        } as never);
        await engine.syncSchemas();
        const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
        const sets = [
            PermissionSetSchema.parse({
                name: 'mcp_nr_member', label: 'Member', objects: { [OBJ]: all },
                fields: { [`${OBJ}.${HIDDEN}`]: { readable: false, editable: false } },
            }),
            PermissionSetSchema.parse({ name: 'mcp_nr_staff', label: 'Staff', objects: { [OBJ]: all, [VAULT]: all } }),
            PermissionSetSchema.parse({ name: 'mcp_nr_base', label: 'Base', objects: { [OBJ]: all } }),
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
        // The deployment's baseline set grants nothing on {@link VAULT}.
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'mcp_nr_base' });
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

    /** The field names `describeObject` serves `persona` on {@link OBJ}. */
    async function servedNames(persona: Record<string, unknown>): Promise<string[]> {
        const bridge = await bridgeFor(kernelOver(services), persona);
        return ((await bridge.describeObject(OBJ)).fields as Array<{ name: string }>).map((f) => f.name);
    }

    it('precondition: the staff is served the field the member is denied, and only the staff may read the vault', async () => {
        expect(await servedNames(PERSONAS.staff)).toContain(HIDDEN);
        expect(await services.security.canReadObject(VAULT, PERSONAS.member)).toBe(false);
        expect(await services.security.canReadObject(VAULT, PERSONAS.staff)).toBe(true);
    });

    it('a field the member cannot see is absent from their schema as an unknown one is, and a read naming either is refused', async () => {
        const names = await servedNames(PERSONAS.member);
        expect(names).toEqual(expect.arrayContaining(['subject', 'amount']));
        const bridge = await bridgeFor(kernelOver(services), PERSONAS.member);
        for (const name of [HIDDEN, UNKNOWN_FIELD]) {
            expect(names).not.toContain(name);
            for (const run of [
                () => bridge.query(OBJ, { where: { [name]: 1 } }),
                () => bridge.aggregate(OBJ, { groupBy: [name], aggregations: [{ function: 'count', alias: 'n' }] }),
            ]) {
                const refused = await rejectionOf(run);
                expect(refused, `a read naming ${name} must be refused`).toBeDefined();
                expect(typeof refused.code).toBe('string');
                expect(refused.status ?? refused.statusCode).toBeGreaterThanOrEqual(400);
                expect(refused.status ?? refused.statusCode).toBeLessThan(500);
            }
        }
    });

    it('an object the member cannot read is no object in their schema, as an unknown name is, and a read of either is refused', async () => {
        const bridge = await bridgeFor(kernelOver(services), PERSONAS.member);
        for (const name of [VAULT, UNKNOWN_OBJECT]) {
            expect(await bridge.describeObject(name)).toBeNull();
            const refused = await rejectionOf(() => bridge.query(name, {}));
            expect(refused, `a read of ${name} must be refused`).toBeDefined();
            expect(refused.status ?? refused.statusCode).toBeGreaterThanOrEqual(400);
            expect(refused.status ?? refused.statusCode).toBeLessThan(500);
        }
    });

    it('CONTROL — the staff reads the field and the vault, and the member reads a field it is served', async () => {
        const staff = await bridgeFor(kernelOver(services), PERSONAS.staff);
        await expect(staff.query(OBJ, { where: { [HIDDEN]: 1 } })).resolves.toBeDefined();
        await expect(staff.query(VAULT, {})).resolves.toBeDefined();
        expect(await staff.describeObject(VAULT)).not.toBeNull();
        const member = await bridgeFor(kernelOver(services), PERSONAS.member);
        await expect(member.query(OBJ, { where: { amount: 1 } })).resolves.toBeDefined();
    });

    it('userTextLocales answers this request\'s ladder: its locale, then the workspace default; none for an unlocalized caller', async () => {
        const localized = await bridgeFor(kernelOver(services), { ...PERSONAS.member, locale: 'zh-CN', workspaceLocale: 'ja-JP' });
        expect(await localized.userTextLocales()).toEqual(['zh-CN', 'ja-JP']);
        const plain = await bridgeFor(kernelOver(services), PERSONAS.member);
        expect(await plain.userTextLocales()).toEqual([]);
    });
});
