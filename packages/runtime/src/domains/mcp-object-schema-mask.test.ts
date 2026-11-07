// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 D1/D5] The HTTP MCP bridge's object-schema reads answer a caller
 * the field set the `/meta` object door answers that caller: `describeObject`
 * (behind `describe_object` and `validate_expression`), `optionFieldsOf` and
 * `listObjects`' `fieldCount` go through the door's own masker and projection
 * (`resolveObjectMasker` / `maskObjectSchema`, `domains/meta.ts`).
 *
 * Two halves:
 *
 *  1. The shared ADR-0106 case table (`OBJECT_SCHEMA_MASK_CASES`), every tier,
 *     over the bridge `handleMcp` builds for the case's caller. The table's own
 *     matcher reads a `fields` RECORD and the `/meta` document's other
 *     positions; `describeObject` answers a field LIST and none of those, so
 *     the verdict is restated over what it serves (see the stdio twin,
 *     `packages/mcp/src/stdio-data-bridge.object-schema-mask.test.ts`).
 *  2. The real security layer (`SecurityPlugin` on a real `ObjectQL` over a
 *     real `SqlDriver`, the protocol over that engine): a member denied a
 *     field, an unrestricted member, an exempt author and a member whose
 *     every field is denied, each read through the MCP bridge AND the
 *     dispatcher's `/metadata/object/:name` door, which must agree.
 *
 * The tool's rendering of the bridge's refusal (`errorResultWithCode`) is
 * `@objectstack/mcp`'s and is pinned there; here the refusal is asserted on
 * the thrown envelope (`code` + `status`).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    FLS_CONTRACT_ALL_FIELDS,
    FLS_CONTRACT_OBJECT,
    OBJECT_SCHEMA_MASK_CASES,
    securityDoubleFor,
    type ObjectSchemaMaskCase,
} from '@objectstack/metadata-core/testing';
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
import { RestServer } from '@objectstack/rest';
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
    return { bridge: kernel.getService('mcp').lastOpts.bridge, dispatcher };
}

/** The rejection `run` raised, or `undefined` when it resolved. */
const rejectionOf = async (run: () => Promise<unknown>): Promise<any> => run().then(() => undefined, (e: unknown) => e);

const REFUSED = { code: 'FIELD_VISIBILITY_UNRESOLVED', status: 503 };

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

describe('[ADR-0106] HTTP MCP bridge object-schema reads — the shared case table', () => {
    const OBJECT = FLS_CONTRACT_OBJECT.name;
    const account = () => JSON.parse(JSON.stringify(FLS_CONTRACT_OBJECT));
    const protocol = { getMetaItems: async (req: any) => ({ type: req.type, items: req.type === 'object' ? [account()] : [] }) };
    const metadata = { listObjects: async () => [account()], getObject: async () => account(), list: async () => [] };

    /** The three reads, as `testCase`'s caller is served them (or the refusal each raised). */
    async function readsUnder(testCase: ObjectSchemaMaskCase | undefined) {
        const security = testCase ? securityDoubleFor(testCase) : undefined;
        if (testCase?.maskingDisabled) process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = '1';
        const kernel = kernelOver({ protocol, metadata, ...(security ? { security } : {}) });
        const { bridge } = await bridgeFor(kernel, testCase?.context ?? { userId: 'u_staff', systemPermissions: [] });
        const settle = async (run: () => Promise<unknown>) => {
            try {
                return { value: await run() };
            } catch (error) {
                return { error: error as any };
            }
        };
        return {
            described: await settle(() => bridge.describeObject(OBJECT)),
            listed: await settle(() => bridge.listObjects()),
            options: await settle(() => bridge.optionFieldsOf(OBJECT)),
        };
    }

    it('the baseline (no security service) is the declared answer', async () => {
        const { described } = await readsUnder(undefined);
        expect((described.value as any).fields.map((f: any) => f.name)).toEqual([...FLS_CONTRACT_ALL_FIELDS]);
    });

    for (const testCase of OBJECT_SCHEMA_MASK_CASES) {
        it(testCase.id, async () => {
            const baseline = await readsUnder(undefined);
            const reads = await readsUnder(testCase);
            const expected = testCase.expect;
            if (expected.kind === 'fault') {
                for (const read of [reads.described, reads.listed, reads.options]) {
                    expect(read.error, `${testCase.id}: refused, never served`).toBeDefined();
                    expect({ code: read.error.code, status: read.error.status }).toEqual(REFUSED);
                }
                return;
            }
            if (expected.kind === 'unmasked') {
                // Byte-identical to the unrestricted answer.
                expect(JSON.stringify(reads.described.value)).toBe(JSON.stringify(baseline.described.value));
                expect(JSON.stringify(reads.listed.value)).toBe(JSON.stringify(baseline.listed.value));
                expect(JSON.stringify(reads.options.value)).toBe(JSON.stringify(baseline.options.value));
                return;
            }
            const described: any = reads.described.value;
            expect(described.fields.map((f: any) => f.name))
                .toEqual(FLS_CONTRACT_ALL_FIELDS.filter((name) => expected.present.includes(name)));
            expect((reads.listed.value as any[]).find((o) => o.name === OBJECT)?.fieldCount).toBe(expected.present.length);
            for (const name of expected.absent) {
                for (const read of [reads.described, reads.listed, reads.options]) {
                    expect(JSON.stringify(read.value), `${testCase.id}: '${name}' must not exist for this caller`)
                        .not.toMatch(new RegExp(`\\b${name}\\b`));
                }
            }
        });
    }
});

describe('[ADR-0106] HTTP MCP bridge and the /metadata object door agree — the real security layer', () => {
    const OBJ = 'mcp_fls_ledger';
    const DENIED = 'secret_margin';
    let engine: ObjectQL;
    let services: Record<string, any>;
    let allFields: string[];

    const sets: any[] = [];
    const PERSONAS = {
        /** Denied one field. */
        member: { userId: 'usr_member', positions: [] as string[], permissions: ['mcp_fls_member'], systemPermissions: [] as string[] },
        /** Denied nothing: the control. */
        staff: { userId: 'usr_staff', positions: [] as string[], permissions: ['mcp_fls_staff'], systemPermissions: [] as string[] },
        /** D4: may write the schema, so is served all of it. */
        author: { userId: 'usr_author', positions: [] as string[], permissions: ['mcp_fls_member'], systemPermissions: ['manage_metadata'] },
        /** Denied every field the object carries. */
        walled: { userId: 'usr_walled', positions: [] as string[], permissions: ['mcp_fls_walled'], systemPermissions: [] as string[] },
    } as const;

    beforeAll(async () => {
        engine = new ObjectQL();
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
        // The protocol's object read merges the stored metadata overlay, so the store is provisioned.
        const storeObjects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject] as any[];
        await driver.initObjects(storeObjects);
        engine.registerDriver(driver as any, true);
        await engine.init();
        for (const o of storeObjects) engine.registry.registerObject(o, '@objectstack/platform-objects');
        engine.registerApp({
            id: 'com.objectstack.qa.mcp-object-schema-mask',
            name: 'MCP object schema mask',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [{
                name: OBJ,
                label: 'Ledger',
                sharingModel: 'public_read_write',
                fields: {
                    title: { name: 'title', type: 'text', label: 'Title', required: true },
                    stage: { name: 'stage', type: 'select', label: 'Stage', options: [{ value: 'open', label: 'Open' }] },
                    [DENIED]: { name: DENIED, type: 'currency', label: 'Secret margin' },
                },
            }],
        } as never);
        await engine.syncSchemas();
        allFields = Object.keys((engine.getSchema(OBJ) as any).fields);
        const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
        sets.push(
            PermissionSetSchema.parse({
                name: 'mcp_fls_member', label: 'Member', objects: { '*': all },
                fields: { [`${OBJ}.${DENIED}`]: { readable: false, editable: false } },
            }),
            PermissionSetSchema.parse({ name: 'mcp_fls_staff', label: 'Staff', objects: { '*': all } }),
            PermissionSetSchema.parse({
                name: 'mcp_fls_walled', label: 'Walled', objects: { '*': all },
                fields: Object.fromEntries(allFields.map((f) => [`${OBJ}.${f}`, { readable: false, editable: false }])),
            }),
        );
        const pluginServices: Record<string, unknown> = {
            manifest: { register: vi.fn() },
            objectql: engine,
            metadata: {
                get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
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
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'mcp_fls_staff' });
        await plugin.init(ctx as never);
        await plugin.start(ctx as never);
        expect(pluginServices.security, 'precondition: the security plugin registered its service').toBeDefined();
        vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
        services = {
            protocol: new ObjectStackProtocolImplementation(engine as any),
            security: pluginServices.security,
            objectql: engine,
        };
        // Silence the D6 notices this suite does not judge.
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    }, 60_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        try { await engine?.destroy(); } catch { /* noop */ }
    });

    /** One persona's answer on both doors: the MCP bridge's reads and the `/metadata` item. */
    async function readBoth(persona: Record<string, unknown>) {
        const kernel = kernelOver(services);
        const { bridge, dispatcher } = await bridgeFor(kernel, persona);
        const meta = await dispatcher.handleMetadata(`/object/${OBJ}`, {
            request: {}, environmentId: undefined, executionContext: { ...persona },
        } as any, 'GET');
        // The answer, or the refusal it raised — whichever the door gave.
        const describe: any = await bridge.describeObject(OBJ).catch((error: unknown) => error);
        return { bridge, describe, meta: { status: meta.response?.status, item: meta.response?.body?.data?.item } };
    }

    it('precondition: the denied field is declared and stored', () => {
        expect(allFields).toContain(DENIED);
    });

    it('a member denied a field is described the field set the /metadata door serves them, without it', async () => {
        const { bridge, describe: described, meta } = await readBoth(PERSONAS.member);
        expect(meta.status).toBe(200);
        const metaNames = Object.keys(meta.item.fields).sort();
        const mcpNames = described.fields.map((f: any) => f.name).sort();
        expect(mcpNames).toEqual(metaNames);
        expect(mcpNames).not.toContain(DENIED);
        expect(mcpNames).toContain('title');
        expect(JSON.stringify(described)).not.toContain(DENIED);
        const listed = (await bridge.listObjects()).find((o: any) => o.name === OBJ);
        expect(listed.fieldCount).toBe(metaNames.length);
        expect(await bridge.optionFieldsOf(OBJ)).toEqual(['stage']);
    });

    it('CONTROL — an unrestricted member and an exempt author are described the whole object, byte-identical', async () => {
        const staff = await readBoth(PERSONAS.staff);
        const author = await readBoth(PERSONAS.author);
        // The whole declared field set, on both doors.
        expect(staff.describe.fields.map((f: any) => f.name).sort()).toEqual([...allFields].sort());
        expect(Object.keys(staff.meta.item.fields).sort()).toEqual([...allFields].sort());
        // The author holds the member's field deny and is still served all of it (D4).
        expect(JSON.stringify(author.describe)).toBe(JSON.stringify(staff.describe));
        // …and both are the answer a deployment with no security service gets.
        const unsecured = await bridgeFor(kernelOver({ ...services, security: undefined }), PERSONAS.staff);
        expect(JSON.stringify(staff.describe)).toBe(JSON.stringify(await unsecured.bridge.describeObject(OBJ)));
        expect(JSON.stringify(await staff.bridge.listObjects())).toBe(JSON.stringify(await unsecured.bridge.listObjects()));
    });

    it('a member denied every field is refused on both doors, never served an object with no fields', async () => {
        const { bridge, describe: refused, meta } = await readBoth(PERSONAS.walled);
        expect(meta.status).toBe(503);
        expect({ code: refused?.code, status: refused?.status }).toEqual(REFUSED);
        expect(JSON.stringify(meta).includes(DENIED)).toBe(false);
        const listed = await rejectionOf(() => bridge.listObjects());
        expect({ code: listed?.code, status: listed?.status }).toEqual(REFUSED);
        const options = await rejectionOf(() => bridge.optionFieldsOf(OBJ));
        expect({ code: options?.code, status: options?.status }).toEqual(REFUSED);
    });
});

describe('[ADR-0106] HTTP MCP list_actions summarises an action against the object as the caller is served it', () => {
    const OBJ = 'mcp_fls_project';
    const OTHER = 'mcp_fls_vendor';
    const DENIED = 'budget';
    const DENIED_OTHER = 'rate';
    const DENIED_LABEL = 'Approved budget';
    const DENIED_HELP = 'Spend ceiling the board signed off';
    let engine: ObjectQL;
    let services: Record<string, any>;

    const ai = (description: string) => ({ exposed: true, description });
    /** Binds a field the member cannot read. */
    const SET_BUDGET = { name: 'set_budget', label: 'Set budget', operation: 'update', params: [{ field: DENIED }], ai: ai('Set the approved budget of this project to a new amount.') };
    /** Binds a field of ANOTHER object the member cannot read (`objectOverride`, judged there). */
    const QUOTE_RATE = {
        name: 'quote_rate', label: 'Quote rate', operation: 'update',
        params: [{ field: DENIED_OTHER, objectOverride: OTHER }], ai: ai('Quote the day rate of a vendor for this project.'),
    };
    /**
     * Binds the OTHER object's field of the same name as the denied one, which
     * the member can read: listed, and summarised against no field of this
     * object (the served one carries no `budget`).
     */
    const VENDOR_BUDGET = {
        name: 'quote_vendor_budget', label: 'Quote vendor budget', operation: 'update',
        params: [{ field: DENIED, objectOverride: OTHER }], ai: ai('Quote the budget a vendor offered for this project.'),
    };
    /** Binds a field the member CAN read: the control. */
    const RENAME = { name: 'rename_project', label: 'Rename', operation: 'update', params: [{ field: 'title' }], ai: ai('Rename this project to the title the user gives.') };
    /** Binds no field at all. */
    const CLOSE = { name: 'close_project', label: 'Close', operation: 'update', patch: { stage: 'closed' }, ai: ai('Close this project once the work on it is finished.') };
    const ALL_ACTIONS = [CLOSE.name, QUOTE_RATE.name, VENDOR_BUDGET.name, RENAME.name, SET_BUDGET.name];
    const MEMBER_ACTIONS = [CLOSE.name, VENDOR_BUDGET.name, RENAME.name];
    const READABLE_ACTIONS = [CLOSE.name, RENAME.name];

    const PERSONAS = {
        /** Denied `budget` here and `rate` on the other object. */
        member: { userId: 'usr_member', positions: [] as string[], permissions: ['mcp_act_member'], systemPermissions: [] as string[] },
        /** Denied nothing: the control. */
        staff: { userId: 'usr_staff', positions: [] as string[], permissions: ['mcp_act_staff'], systemPermissions: [] as string[] },
        /** Denied every field of the project object. */
        walled: { userId: 'usr_walled', positions: [] as string[], permissions: ['mcp_act_walled'], systemPermissions: [] as string[] },
    } as const;

    beforeAll(async () => {
        engine = new ObjectQL();
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
        const storeObjects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject] as any[];
        await driver.initObjects(storeObjects);
        engine.registerDriver(driver as any, true);
        await engine.init();
        for (const o of storeObjects) engine.registry.registerObject(o, '@objectstack/platform-objects');
        engine.registerApp({
            id: 'com.objectstack.qa.mcp-list-actions-field-mask',
            name: 'MCP list_actions field mask',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [
                {
                    name: OBJ,
                    label: 'Project',
                    sharingModel: 'public_read_write',
                    fields: {
                        title: { name: 'title', type: 'text', label: 'Title', required: true },
                        stage: {
                            name: 'stage', type: 'select', label: 'Stage',
                            options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }],
                        },
                        [DENIED]: { name: DENIED, type: 'currency', label: DENIED_LABEL, description: DENIED_HELP },
                    },
                    actions: [SET_BUDGET, QUOTE_RATE, VENDOR_BUDGET, RENAME, CLOSE],
                },
                {
                    name: OTHER,
                    label: 'Vendor',
                    sharingModel: 'public_read_write',
                    fields: {
                        name: { name: 'name', type: 'text', label: 'Name' },
                        [DENIED_OTHER]: { name: DENIED_OTHER, type: 'currency', label: 'Day rate' },
                        [DENIED]: { name: DENIED, type: 'currency', label: 'Vendor budget' },
                    },
                },
            ],
        } as never);
        await engine.syncSchemas();
        const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
        const deny = { readable: false, editable: false };
        const sets = [
            PermissionSetSchema.parse({
                name: 'mcp_act_member', label: 'Member', objects: { '*': all },
                fields: { [`${OBJ}.${DENIED}`]: deny, [`${OTHER}.${DENIED_OTHER}`]: deny },
            }),
            PermissionSetSchema.parse({ name: 'mcp_act_staff', label: 'Staff', objects: { '*': all } }),
            PermissionSetSchema.parse({
                name: 'mcp_act_walled', label: 'Walled', objects: { '*': all },
                fields: Object.fromEntries(Object.keys((engine.getSchema(OBJ) as any).fields).map((f) => [`${OBJ}.${f}`, deny])),
            }),
        ];
        const pluginServices: Record<string, unknown> = {
            manifest: { register: vi.fn() },
            objectql: engine,
            metadata: {
                get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
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
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'mcp_act_staff' });
        await plugin.init(ctx as never);
        await plugin.start(ctx as never);
        expect(pluginServices.security, 'precondition: the security plugin registered its service').toBeDefined();
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

    /** One persona's `list_actions` answer on the HTTP bridge, and the actions the `/metadata` object door serves them. */
    async function listBoth(persona: Record<string, unknown>, over: Record<string, any> = services) {
        const { bridge, dispatcher } = await bridgeFor(kernelOver(over), persona);
        const listed: any[] = await bridge.listActions();
        const meta = await dispatcher.handleMetadata(`/object/${OBJ}`, {
            request: {}, environmentId: undefined, executionContext: { ...persona },
        } as any, 'GET');
        const metaActions = ((meta.response?.body?.data?.item?.actions ?? []) as any[]).map((a) => a.name).sort();
        return { listed, metaActions, metaStatus: meta.response?.status };
    }
    const namesOf = (listed: any[]) => listed.filter((a) => a.objectName === OBJ).map((a) => a.name).sort();
    const byName = (listed: any[], name: string) => listed.find((a) => a.objectName === OBJ && a.name === name);

    it('precondition: every fixture action is listed to an unrestricted caller', async () => {
        const { listed, metaActions } = await listBoth(PERSONAS.staff);
        expect(namesOf(listed)).toEqual(ALL_ACTIONS);
        expect(metaActions).toEqual(ALL_ACTIONS);
    });

    it('a member who cannot read the bound field is not listed the action, nor shown the field — as the /metadata door serves them', async () => {
        const { listed, metaActions, metaStatus } = await listBoth(PERSONAS.member);
        expect(metaStatus).toBe(200);
        expect(metaActions, 'the /metadata object door withholds both').toEqual(MEMBER_ACTIONS);
        expect(namesOf(listed), 'list_actions lists what the /metadata door serves').toEqual(metaActions);
        const text = JSON.stringify(listed.filter((a) => a.name !== VENDOR_BUDGET.name));
        for (const hidden of [DENIED, DENIED_OTHER, DENIED_LABEL, DENIED_HELP, 'Day rate']) {
            expect(text.includes(hidden), `'${hidden}' must not reach this caller`).toBe(false);
        }
    });

    it('a param bound to another object\'s readable field is summarised against that object\'s field, never this object\'s the member cannot read', async () => {
        const { listed } = await listBoth(PERSONAS.member);
        const entry = byName(listed, VENDOR_BUDGET.name);
        expect(entry.params).toEqual([{ name: DENIED, type: 'number', required: false, description: 'Vendor budget' }]);
        expect(JSON.stringify(entry).includes(DENIED_LABEL)).toBe(false);
        expect(JSON.stringify(entry).includes(DENIED_HELP)).toBe(false);
    });

    it('a member denied every field of a listed action\'s object is refused, as list_objects refuses them', async () => {
        const { bridge } = await bridgeFor(kernelOver(services), PERSONAS.walled);
        const refused = await rejectionOf(() => bridge.listActions());
        expect({ code: refused?.code, status: refused?.status }).toEqual(REFUSED);
        const listed = await rejectionOf(() => bridge.listObjects());
        expect({ code: listed?.code, status: listed?.status }).toEqual(REFUSED);
    });

    it('CONTROL — an unrestricted member is shown the full summary, byte-identical to a deployment with no security service', async () => {
        const { listed } = await listBoth(PERSONAS.staff);
        expect(byName(listed, SET_BUDGET.name).params).toEqual([
            { name: DENIED, type: 'number', required: false, description: `${DENIED_LABEL} — ${DENIED_HELP}` },
        ]);
        expect(byName(listed, QUOTE_RATE.name).params?.map((p: any) => p.name)).toEqual([DENIED_OTHER]);
        const unsecured = await listBoth(PERSONAS.staff, { ...services, security: undefined });
        expect(JSON.stringify(listed)).toBe(JSON.stringify(unsecured.listed));
    });

    it('an action binding a readable field, or none, is summarised to the member exactly as to the control', async () => {
        const member = await listBoth(PERSONAS.member);
        const staff = await listBoth(PERSONAS.staff);
        for (const name of READABLE_ACTIONS) {
            expect(byName(member.listed, name), name).toEqual(byName(staff.listed, name));
        }
        expect(byName(member.listed, RENAME.name).params).toEqual([{ name: 'title', type: 'string', required: false, description: 'Title' }]);
        expect(byName(member.listed, CLOSE.name)).not.toHaveProperty('params');
    });
});

describe('[ADR-0106 D1] a standalone or object-less action entry is served as the object door projects it — /meta action door (REST, dispatcher) and MCP list_actions', () => {
    const OBJ = 'meta_act_project';
    const OTHER = 'meta_act_vendor';
    const PKG = 'com.objectstack.qa.meta-action-entry-mask';
    const META = '/api/v1/meta';
    const ai = (description: string) => ({ exposed: true, description });
    /** Standalone, bound to this object's `budget`, which the member cannot read. */
    const ST_BUDGET = {
        name: 'st_set_budget', label: 'Set budget', objectName: OBJ, operation: 'update',
        params: [{ field: 'budget', label: 'Budget param label', helpText: 'Budget param help' }],
        ai: ai('Set the approved budget of this project to a new amount.'),
    };
    /** Standalone, bound to `title`, which the member can read: the control. */
    const ST_RENAME = {
        name: 'st_rename', label: 'Rename', objectName: OBJ, operation: 'update',
        params: [{ field: 'title' }], ai: ai('Rename this project to the title the user gives.'),
    };
    /** Standalone, binding no field at all. */
    const ST_PING = { name: 'st_ping', label: 'Ping', objectName: OBJ, type: 'api', target: '/api/v1/ping', ai: ai('Ping the project service to check that it answers.') };
    /** Object-less, bound through `objectOverride` to the other object's `rate`, which the member cannot read. */
    const GL_RATE = {
        name: 'gl_quote_rate', label: 'Quote rate', type: 'api', target: '/api/v1/quote',
        params: [{ field: 'rate', objectOverride: OTHER, label: 'Rate param label' }],
        ai: ai('Quote the day rate of a vendor before the work is booked.'),
    };
    /** Object-less, bound through `objectOverride` to the other object's `budget`, which the member CAN read. */
    const GL_VENDOR_BUDGET = {
        name: 'gl_vendor_budget', label: 'Vendor budget', type: 'api', target: '/api/v1/quote',
        params: [{ field: 'budget', objectOverride: OTHER }],
        ai: ai('Quote the budget a vendor offered before the work is booked.'),
    };
    /** Embedded on this object, bound through `objectOverride` to the other object's `budget`. */
    const EMBEDDED_VENDOR_BUDGET = {
        name: 'quote_vendor_budget', label: 'Quote vendor budget', operation: 'update',
        params: [{ field: 'budget', objectOverride: OTHER }], ai: ai('Quote the budget a vendor offered for this project.'),
    };
    const STANDALONE = [ST_BUDGET, ST_RENAME, ST_PING, GL_RATE, GL_VENDOR_BUDGET];
    const WITHHELD = [ST_BUDGET.name, GL_RATE.name];
    const HIDDEN_TEXT = ['Budget param label', 'Budget param help', 'Rate param label', 'Approved budget', 'Day rate'];

    const PERSONAS = {
        /** Denied this object's `budget` and the other object's `rate`. */
        member: { userId: 'usr_member', positions: [] as string[], permissions: ['meta_act_member'], systemPermissions: [] as string[] },
        /** Denied nothing: the control. */
        staff: { userId: 'usr_staff', positions: [] as string[], permissions: ['meta_act_staff'], systemPermissions: [] as string[] },
        /** D4: holds the member's denies and may write the schema. */
        author: { userId: 'usr_author', positions: [] as string[], permissions: ['meta_act_member'], systemPermissions: ['manage_metadata'] },
        /** The system context. */
        system: { userId: 'usr_system', isSystem: true, positions: [] as string[], permissions: ['meta_act_member'], systemPermissions: [] as string[] },
    } as const;
    type Persona = (typeof PERSONAS)[keyof typeof PERSONAS];

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
            id: PKG,
            name: 'Meta action entry mask',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [
                {
                    name: OBJ,
                    label: 'Project',
                    sharingModel: 'public_read_write',
                    fields: {
                        title: { name: 'title', type: 'text', label: 'Title', required: true },
                        budget: { name: 'budget', type: 'currency', label: 'Approved budget', description: 'Spend ceiling the board signed off' },
                    },
                    actions: [EMBEDDED_VENDOR_BUDGET],
                },
                {
                    name: OTHER,
                    label: 'Vendor',
                    sharingModel: 'public_read_write',
                    fields: {
                        name: { name: 'name', type: 'text', label: 'Name' },
                        rate: { name: 'rate', type: 'currency', label: 'Day rate' },
                        budget: { name: 'budget', type: 'currency', label: 'Vendor budget' },
                    },
                },
            ],
        } as never);
        for (const action of STANDALONE) engine.registry.registerItem('action', structuredClone(action) as any, 'name', PKG);
        await engine.syncSchemas();
        const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
        const deny = { readable: false, editable: false };
        const sets = [
            PermissionSetSchema.parse({
                name: 'meta_act_member', label: 'Member', objects: { '*': all },
                fields: { [`${OBJ}.budget`]: deny, [`${OTHER}.rate`]: deny },
            }),
            PermissionSetSchema.parse({ name: 'meta_act_staff', label: 'Staff', objects: { '*': all } }),
        ];
        const pluginServices: Record<string, unknown> = {
            manifest: { register: vi.fn() },
            objectql: engine,
            metadata: {
                get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
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
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'meta_act_staff' });
        await plugin.init(ctx as never);
        await plugin.start(ctx as never);
        expect(pluginServices.security, 'precondition: the security plugin registered its service').toBeDefined();
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

    /** One `/meta` answer, every byte a caller can compare: status, body and headers. */
    interface Wire { status: number; body: any; headers: Record<string, string> }
    const wireText = (w: Wire) => JSON.stringify(w);

    /** A code/package store answering `/published` with each standalone fixture as declared, and nothing for any other name. */
    const publishedStore = {
        getPublished: async (type: string, name: string) => {
            const found = type === 'action' ? STANDALONE.find((a) => a.name === name) : undefined;
            return found ? structuredClone(found) : undefined;
        },
    };

    /** `RestServer`'s registered `/meta` handlers, under `persona`; `cached: false` is a deployment with the published-value cache off. */
    function restDoor(persona: Persona, opts: { cached: boolean; secured?: boolean }) {
        const noop = () => {};
        const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
        const rest: any = new RestServer(server as any, services.protocol, {
            api: { requireAuth: false }, ...(opts.cached ? {} : { metadata: { enableCache: false } }),
        } as any);
        rest.resolveExecCtx = async () => JSON.parse(JSON.stringify(persona));
        rest.securityServiceProvider = async () => (opts.secured === false ? undefined : services.security);
        rest.metadataServiceProvider = async () => publishedStore;
        rest.registerRoutes();
        const read = async (
            routePath: string, params: Record<string, string>, headers: Record<string, string> = {}, query: Record<string, string> = {},
        ): Promise<Wire> => {
            const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === routePath);
            if (!route) throw new Error(`GET ${routePath} is not registered`);
            const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
            res.status = (code: number) => { res.statusCode = code; return res; };
            res.json = (body: any) => { res.body = body; return res; };
            res.send = () => res;
            res.end = () => res;
            res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
            res.setHeader = () => {};
            const path = `${META}/${params.type}${params.name ? `/${params.name}` : ''}`;
            await route.handler({ method: 'GET', path, params, query, body: {}, headers }, res);
            return { status: res.statusCode, body: res.body, headers: res.headers };
        };
        return {
            list: () => read(`${META}/:type`, { type: 'action' }),
            item: (name: string, headers?: Record<string, string>) => read(`${META}/:type/:name`, { type: 'action', name }, headers),
            layers: (name: string) => read(`${META}/:type/:name/layers`, { type: 'action', name }),
            legacyLayers: (name: string) => read(`${META}/:type/:name`, { type: 'action', name }, {}, { layers: 'true' }),
            published: (name: string) => read(`${META}/:type/:name/published`, { type: 'action', name }),
        };
    }

    /** The runtime dispatcher's `/meta` door, under `persona`. */
    function dispatcherDoor(persona: Persona, opts: { secured?: boolean } = {}) {
        const deployment = { ...services, ...(opts.secured === false ? { security: undefined } : {}) };
        const dispatcher = new HttpDispatcher(kernelOver(deployment), undefined, { enforceProjectMembership: false });
        // `/published` over the code/package store; the other doors read no metadata service.
        const publishing = new HttpDispatcher(kernelOver({ ...deployment, metadata: publishedStore }), undefined, { enforceProjectMembership: false });
        const read = async (path: string, query?: Record<string, string>, via: HttpDispatcher = dispatcher): Promise<Wire> => {
            const answer = await via.handleMetadata(path, {
                request: {}, environmentId: undefined, executionContext: JSON.parse(JSON.stringify(persona)),
            } as any, 'GET', undefined, query);
            return { status: answer.response?.status ?? 0, body: answer.response?.body, headers: (answer.response as any)?.headers ?? {} };
        };
        return {
            list: () => read('/action'),
            item: (name: string) => read(`/action/${name}`),
            layers: (name: string) => read(`/action/${name}/layers`),
            legacyLayers: (name: string) => read(`/action/${name}`, { layers: 'true' }),
            published: (name: string) => read(`/action/${name}/published`, undefined, publishing),
        };
    }

    const listedNames = (w: Wire): string[] => {
        const data = w.body?.data ?? w.body;
        const items: any[] = Array.isArray(data) ? data : (data?.items ?? []);
        return items.map((a: any) => a?.name).filter((n: unknown) => STANDALONE.some((s) => s.name === n)).sort();
    };
    const DOORS = [
        ['REST, cached arm', (p: Persona) => restDoor(p, { cached: true })],
        ['REST, uncached arm', (p: Persona) => restDoor(p, { cached: false })],
        ['dispatcher', (p: Persona) => dispatcherDoor(p)],
    ] as const;
    const ALL_NAMES = STANDALONE.map((a) => a.name).sort();

    it('precondition: every standalone fixture is listed and read whole by an unrestricted caller, on every door', async () => {
        for (const [door, open] of DOORS) {
            const staff = open(PERSONAS.staff);
            const list = await staff.list();
            expect(list.status, door).toBe(200);
            expect(listedNames(list), door).toEqual(ALL_NAMES);
            const item = await staff.item(ST_BUDGET.name);
            expect(item.status, door).toBe(200);
            expect(JSON.stringify(item.body), door).toContain('Budget param label');
        }
    });

    for (const [door, open] of DOORS) {
        it(`${door}: a member who cannot read a bound field is not listed the action, and is answered for it as for an unknown name`, async () => {
            const member = open(PERSONAS.member);
            const list = await member.list();
            expect(list.status).toBe(200);
            expect(listedNames(list)).toEqual(ALL_NAMES.filter((n) => !WITHHELD.includes(n)));
            for (const hidden of HIDDEN_TEXT) expect(wireText(list).includes(hidden), `'${hidden}' must not reach this caller`).toBe(false);
            const unknown = await member.item('no_such_action');
            expect(unknown.status, 'precondition: an unknown name is a 404').toBe(404);
            for (const name of WITHHELD) {
                expect(wireText(await member.item(name)), `${name} answers as an absent name`).toBe(wireText(unknown));
            }
        });

        for (const sub of ['layers', 'legacyLayers', 'published'] as const) {
            it(`${door}: the ${sub} read of a withheld action answers the member as for an unknown name; the staff is served it whole`, async () => {
                const member = open(PERSONAS.member);
                const unknown = await member[sub]('no_such_action');
                expect(unknown.status, 'precondition: an unknown name is a 404').toBe(404);
                for (const name of WITHHELD) {
                    // The deprecated spelling's `Link` names the requested path, whatever the answer.
                    expect(wireText(await member[sub](name)), `${name} answers as an absent name`)
                        .toBe(wireText(unknown).split('no_such_action').join(name));
                }
                const staff = await open(PERSONAS.staff)[sub](ST_BUDGET.name);
                expect(staff.status).toBe(200);
                expect(wireText(staff)).toContain('Budget param label');
                for (const name of [ST_RENAME.name, ST_PING.name, GL_VENDOR_BUDGET.name]) {
                    const served = await member[sub](name);
                    expect(served.status, `CONTROL ${name}`).toBe(200);
                    expect(wireText(served), `CONTROL ${name}`).toBe(wireText(await open(PERSONAS.staff)[sub](name)));
                }
            });
        }

        it(`${door}: CONTROL — a field-bound action the member can read, and one binding no field, are served to the member as to the staff`, async () => {
            for (const name of [ST_RENAME.name, ST_PING.name, GL_VENDOR_BUDGET.name]) {
                const member = await open(PERSONAS.member).item(name);
                expect(member.status, name).toBe(200);
                expect(wireText(member), name).toBe(wireText(await open(PERSONAS.staff).item(name)));
            }
        });

        it(`${door}: CONTROL — an exempt author and the system context are answered byte-identical to a deployment with no security service`, async () => {
            // The same caller with no security service: the draft-read admission
            // (a `draft` key on the layered read) is the caller's, not the mask's.
            const unsecuredFor = (persona: Persona) => (door === 'dispatcher'
                ? dispatcherDoor(persona, { secured: false })
                : restDoor(persona, { cached: door === 'REST, cached arm', secured: false }));
            for (const persona of [PERSONAS.author, PERSONAS.system]) {
                const exempt = open(persona);
                const unsecured = unsecuredFor(persona);
                expect(wireText(await exempt.list()), persona.userId).toBe(wireText(await unsecured.list()));
                for (const name of ALL_NAMES) {
                    for (const sub of ['item', 'layers', 'legacyLayers', 'published'] as const) {
                        expect(wireText(await exempt[sub](name)), `${persona.userId} ${sub} ${name}`).toBe(wireText(await unsecured[sub](name)));
                    }
                }
            }
        });
    }

    it('REST, cached arm: a member holding the validator of a withheld action is answered 404, never 304; the staff still revalidates', async () => {
        const staff = restDoor(PERSONAS.staff, { cached: true });
        const served = await staff.item(ST_BUDGET.name);
        const etag = served.headers.ETag;
        expect(etag, 'precondition: the cached arm issues a validator').toBeTruthy();
        const member = restDoor(PERSONAS.member, { cached: true });
        const conditional = await member.item(ST_BUDGET.name, { 'if-none-match': etag });
        expect(wireText(conditional)).toBe(wireText(await member.item('no_such_action')));
        expect((await staff.item(ST_BUDGET.name, { 'if-none-match': etag })).status).toBe(304);
    });

    it('MCP list_actions: an object-less action whose objectOverride param binds an unreadable field is not listed, nor its field shown', async () => {
        const member = await (await bridgeFor(kernelOver(services), PERSONAS.member)).bridge.listActions();
        const staff = await (await bridgeFor(kernelOver(services), PERSONAS.staff)).bridge.listActions();
        const names = (listed: any[]) => listed.map((a) => a.name).filter((n) => [GL_RATE.name, GL_VENDOR_BUDGET.name].includes(n)).sort();
        expect(names(staff), 'precondition: the staff is listed both').toEqual([GL_VENDOR_BUDGET.name, GL_RATE.name].sort());
        expect(names(member)).toEqual([GL_VENDOR_BUDGET.name]);
        for (const hidden of ['Rate param label', 'Day rate', '"rate"']) {
            expect(JSON.stringify(member).includes(hidden), `'${hidden}' must not reach this caller`).toBe(false);
        }
    });

    it('MCP list_actions: an objectOverride param is summarised with the field of the object it names, not the own object\'s same-named field', async () => {
        const listed: any[] = await (await bridgeFor(kernelOver(services), PERSONAS.staff)).bridge.listActions();
        const target = { name: 'budget', type: 'number', required: false, description: 'Vendor budget' };
        expect(listed.find((a) => a.name === EMBEDDED_VENDOR_BUDGET.name)?.params).toEqual([target]);
        expect(listed.find((a) => a.name === GL_VENDOR_BUDGET.name)?.params).toEqual([target]);
        const member: any[] = await (await bridgeFor(kernelOver(services), PERSONAS.member)).bridge.listActions();
        expect(member.find((a) => a.name === EMBEDDED_VENDOR_BUDGET.name)?.params).toEqual([target]);
    });
});
