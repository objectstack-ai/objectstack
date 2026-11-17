// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34872] The HTTP MCP bridge's `list_objects` and `describe_object` answers
 * carry the object's and each field's label, option labels and descriptions
 * in the CALLER'S locale — this request's `Accept-Language`, read by
 * `metaRequestLocale` and translated by `translateMetaList`, the `/meta`
 * object door's own routine — over the object AS THE CALLER IS SERVED IT
 * (ADR-0106 D3/D5): translation never brings back a masked field or its text.
 * Without a locale, or for a key the bundle does not carry, the authored text.
 * Names never change.
 *
 * Driven over the real security layer (`SecurityPlugin` on a real `ObjectQL`
 * over a real `SqlDriver`, the protocol over that engine), through the bridge
 * the real `/mcp` entry builds for the caller, with an i18n service double
 * that carries a zh-CN bundle. The stdio twin is
 * `packages/mcp/src/stdio-data-bridge.object-locale-34872.test.ts`.
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

/** Drive the real `/mcp` entry for `executionContext`, under `acceptLanguage` when given, and hand back the bridge it built. */
async function bridgeFor(kernel: any, executionContext: Record<string, unknown>, acceptLanguage?: string) {
    const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (acceptLanguage !== undefined) headers['accept-language'] = acceptLanguage;
    const res = await dispatcher.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
        request: new Request('http://localhost/api/v1/mcp', { method: 'POST', headers, body: '{}' }),
        response: {},
        environmentId: undefined,
        executionContext: { ...executionContext },
    } as any);
    expect(res.response?.status, 'precondition: the MCP route must have been served').toBe(200);
    return kernel.getService('mcp').lastOpts.bridge;
}

const OBJ = 'mcp_loc_deal';
const PLAIN = 'mcp_loc_plain';
const DENIED = 'secret_margin';
const OBJECT_TEXT = 'A sales deal, from first call to signed order.';
const AMOUNT_TEXT = 'Amount, tax excluded.';
const DENIED_TEXT = 'Internal margin after rebates.';

/** The zh-CN bundle: the deal, its fields (`help` is the bundle key a field's description is served from) and one option. */
const ZH_CN = {
    objects: {
        [OBJ]: {
            label: '交易',
            description: '一笔销售交易，从首次接触到签单。',
            fields: {
                subject: { label: '主题' },
                amount: { label: '金额', help: '金额，不含税。' },
                stage: { label: '阶段', options: { won: '赢单' } },
                [DENIED]: { label: '毛利', help: '返利后的内部毛利。' },
            },
        },
    },
};

/** An i18n service double: the zh-CN bundle above, an empty `en` one, and `en` as the default. */
const i18nService = {
    getLocales: () => ['en', 'zh-CN'],
    getTranslations: (locale: string) => (locale === 'zh-CN' ? ZH_CN : locale === 'en' ? {} : undefined),
    getDefaultLocale: () => 'en',
};

const PERSONAS = {
    /** Denied one field. */
    member: { userId: 'usr_member', positions: [] as string[], permissions: ['mcp_loc_member'], systemPermissions: [] as string[] },
    /** Denied nothing: the control. */
    staff: { userId: 'usr_staff', positions: [] as string[], permissions: ['mcp_loc_staff'], systemPermissions: [] as string[] },
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

describe('[#34872] HTTP MCP list_objects and describe_object serve labels and descriptions in the caller\'s locale', () => {
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
            id: 'com.objectstack.qa.mcp-object-locale',
            name: 'MCP object locale',
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
                        stage: {
                            name: 'stage', type: 'select', label: 'Stage',
                            options: [{ value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }],
                        },
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
                name: 'mcp_loc_member', label: 'Member', objects: { '*': all },
                fields: { [`${OBJ}.${DENIED}`]: { readable: false, editable: false } },
            }),
            PermissionSetSchema.parse({ name: 'mcp_loc_staff', label: 'Staff', objects: { '*': all } }),
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
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'mcp_loc_staff' });
        await plugin.init(ctx as never);
        await plugin.start(ctx as never);
        vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
        services = {
            protocol: new ObjectStackProtocolImplementation(engine as any),
            security: pluginServices.security,
            objectql: engine,
            i18n: i18nService,
        };
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    }, 60_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        try { await engine?.destroy(); } catch { /* noop */ }
    });

    const bridgeAs = (persona: Record<string, unknown>, acceptLanguage?: string, extra: Record<string, any> = {}) =>
        bridgeFor(kernelOver({ ...services, ...extra }), persona, acceptLanguage);
    const field = (described: any, name: string) => described.fields.find((f: any) => f.name === name);

    it('describe_object under zh-CN: the object\'s and each field\'s label, description and option label are the bundle\'s; names never change', async () => {
        const described = await (await bridgeAs(PERSONAS.staff, 'zh-CN,zh;q=0.9,en;q=0.8')).describeObject(OBJ);
        expect(described).toMatchObject({ name: OBJ, label: '交易', description: '一笔销售交易，从首次接触到签单。' });
        expect(field(described, 'subject')).toMatchObject({ name: 'subject', label: '主题' });
        expect(field(described, 'amount')).toMatchObject({ name: 'amount', label: '金额', description: '金额，不含税。' });
        expect(field(described, 'stage')).toMatchObject({
            name: 'stage',
            label: '阶段',
            // The stored value a write sends is unchanged; only what a person reads is translated.
            options: [{ value: 'won', label: '赢单' }, { value: 'lost', label: 'Lost' }],
        });
    });

    it('list_objects under zh-CN: each object\'s label and description are the bundle\'s, and the field count is the served one', async () => {
        const listed: any[] = await (await bridgeAs(PERSONAS.member, 'zh-CN')).listObjects();
        expect(listed.find((o) => o.name === OBJ)).toEqual({
            name: OBJ, label: '交易', description: '一笔销售交易，从首次接触到签单。', fieldCount: expect.any(Number),
        });
        // An object the bundle does not carry keeps its authored label.
        expect(listed.find((o) => o.name === PLAIN)).toMatchObject({ name: PLAIN, label: 'Plain' });
    });

    it('a field the member cannot read stays absent under translation, its translated label and description with it', async () => {
        const bridge = await bridgeAs(PERSONAS.member, 'zh-CN');
        const described = await bridge.describeObject(OBJ);
        expect(described.label).toBe('交易');
        expect(field(described, DENIED)).toBeUndefined();
        const text = JSON.stringify(described);
        for (const leaked of ['毛利', '返利后的内部毛利。', 'Margin', DENIED_TEXT]) expect(text).not.toContain(leaked);
        // …and the listing counts the fields the member is served: one fewer than the unrestricted control.
        const memberCount = (await bridge.listObjects()).find((o: any) => o.name === OBJ).fieldCount;
        const staffCount = (await (await bridgeAs(PERSONAS.staff, 'zh-CN')).listObjects()).find((o: any) => o.name === OBJ).fieldCount;
        expect(memberCount).toBe(staffCount - 1);
    });

    it('without a locale preference (the default `en` carries no entry): the authored labels and descriptions', async () => {
        const bridge = await bridgeAs(PERSONAS.staff);
        const described = await bridge.describeObject(OBJ);
        expect(described).toMatchObject({ name: OBJ, label: 'Deal', description: OBJECT_TEXT });
        expect(field(described, 'amount')).toMatchObject({ label: 'Amount', description: AMOUNT_TEXT });
        expect(field(described, 'stage').options).toEqual([{ value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]);
        expect((await bridge.listObjects()).find((o: any) => o.name === OBJ)).toMatchObject({ label: 'Deal', description: OBJECT_TEXT });
    });

    it('a locale the bundle does not carry, or no i18n service at all: the authored text', async () => {
        const described = await (await bridgeAs(PERSONAS.staff, 'fr-FR')).describeObject(OBJ);
        expect(described).toMatchObject({ label: 'Deal', description: OBJECT_TEXT });
        const noI18n = await (await bridgeAs(PERSONAS.staff, 'zh-CN', { i18n: null })).describeObject(OBJ);
        expect(noI18n).toMatchObject({ label: 'Deal', description: OBJECT_TEXT });
        expect(field(noI18n, 'subject')).toMatchObject({ label: 'Subject' });
    });
});
