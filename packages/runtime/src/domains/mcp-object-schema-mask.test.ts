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
            // The same caller's answers for a name nothing declares.
            unknownDescribed: await settle(() => bridge.describeObject('no_such_object')),
            unknownOptions: await settle(() => bridge.optionFieldsOf('no_such_object')),
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
            if (expected.kind === 'absent') {
                // [ruling record 6787890900] Answered exactly as a name nothing
                // declares, and left out of the listing.
                expect(reads.described).toEqual(reads.unknownDescribed);
                expect(reads.options).toEqual(reads.unknownOptions);
                expect(reads.described.value).toBeNull();
                expect((reads.listed.value as any[]).map((o) => o.name)).not.toContain(OBJECT);
                return;
            }
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
                // The catalog reads a set by name (ADR-0150 D3): served from the same list.
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
        // [ruling record 6787890900] …listed minus the objects the data plane
        // refuses this member (a wildcard grant reaches no private object).
        const everything: any[] = await unsecured.bridge.listObjects();
        const readable: any[] = [];
        for (const o of everything) if (await services.security.canReadObject(o.name, PERSONAS.staff)) readable.push(o);
        expect(readable.map((o) => o.name)).toContain(OBJ);
        expect(JSON.stringify(await staff.bridge.listObjects())).toBe(JSON.stringify(readable));
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

describe('[ruling record 6787890900] an object the caller may not read does not exist on any schema door — the real security layer', () => {
    const OBJ = 'mcp_vis_ledger';
    /** A readable object whose reference field names {@link OBJ}. */
    const REF = 'mcp_vis_ledger_line';
    const SECRET = 'secret_margin';
    let engine: ObjectQL;
    let services: Record<string, any>;
    let allFields: string[];

    const PERSONAS = {
        /** Holds a read grant on {@link REF} only — none on {@link OBJ}. */
        lines: { userId: 'usr_lines', positions: [] as string[], permissions: ['mcp_vis_lines'], systemPermissions: [] as string[] },
        /** The same grant, and D4: served every object whole all the same. */
        author: { userId: 'usr_author', positions: [] as string[], permissions: ['mcp_vis_lines'], systemPermissions: ['manage_metadata'] },
        /** A read grant on both: the control. */
        both: { userId: 'usr_both', positions: [] as string[], permissions: ['mcp_vis_both'], systemPermissions: [] as string[] },
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
            id: 'com.objectstack.qa.mcp-object-read-visibility',
            name: 'MCP object read visibility',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [{
                name: OBJ,
                label: 'Ledger',
                sharingModel: 'public_read_write',
                fields: {
                    title: { name: 'title', type: 'text', label: 'Title' },
                    [SECRET]: { name: SECRET, type: 'currency', label: 'Secret margin' },
                },
            }, {
                name: REF,
                label: 'Ledger line',
                sharingModel: 'public_read_write',
                fields: {
                    memo: { name: 'memo', type: 'text', label: 'Memo' },
                    ledger: { name: 'ledger', type: 'lookup', reference: OBJ, label: 'Ledger' },
                },
            }],
        } as never);
        await engine.syncSchemas();
        allFields = Object.keys((engine.getSchema(OBJ) as any).fields);
        const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
        const sets = [
            PermissionSetSchema.parse({ name: 'mcp_vis_lines', label: 'Lines', objects: { [REF]: all } }),
            PermissionSetSchema.parse({ name: 'mcp_vis_both', label: 'Both', objects: { [REF]: all, [OBJ]: all } }),
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
        // The deployment's baseline set grants nothing on {@link OBJ}.
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'mcp_vis_lines' });
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

    /** One persona's whole answer for `name`: the `/metadata` item and list, and the MCP reads. */
    async function doorsFor(persona: Record<string, unknown>, name: string) {
        const kernel = kernelOver(services);
        const { bridge, dispatcher } = await bridgeFor(kernel, persona);
        const ctx = { request: {}, environmentId: undefined, executionContext: { ...persona } } as any;
        const item = await dispatcher.handleMetadata(`/object/${name}`, ctx, 'GET');
        const list = await dispatcher.handleMetadata('/object', ctx, 'GET');
        const listData = list.response?.body?.data;
        return {
            item: { status: item.response?.status, body: item.response?.body },
            listed: ((Array.isArray(listData) ? listData : listData?.items) ?? []).map((o: any) => o?.name),
            described: await bridge.describeObject(name),
            options: await bridge.optionFieldsOf(name),
            mcpListed: (await bridge.listObjects()).map((o: any) => o.name),
        };
    }

    it('precondition: the data plane refuses the caller the object, and admits the control', async () => {
        expect(await services.security.canReadObject(OBJ, PERSONAS.lines)).toBe(false);
        expect(await services.security.canReadObject(REF, PERSONAS.lines)).toBe(true);
        expect(await services.security.canReadObject(OBJ, PERSONAS.both)).toBe(true);
    });

    it('is answered on every door exactly as a name that names no object, and left out of every list', async () => {
        const hidden = await doorsFor(PERSONAS.lines, OBJ);
        const unknown = await doorsFor(PERSONAS.lines, 'mcp_vis_no_such_object');
        expect(hidden.item.status).toBe(404);
        expect(JSON.stringify(hidden.item.body)).toBe(JSON.stringify(unknown.item.body));
        expect(hidden.described).toBeNull();
        expect(hidden.described).toEqual(unknown.described);
        expect(hidden.options).toEqual(unknown.options);
        for (const listed of [hidden.listed, hidden.mcpListed]) {
            expect(listed).not.toContain(OBJ);
            expect(listed).toContain(REF);
        }
        expect(JSON.stringify(hidden).includes(SECRET)).toBe(false);
    });

    it('CONTROL — a readable object\'s reference field still names it', async () => {
        const line = await doorsFor(PERSONAS.lines, REF);
        expect(line.item.status).toBe(200);
        expect(line.item.body.data.item.fields.ledger.reference).toBe(OBJ);
        expect(line.described.fields.map((f: any) => f.name)).toContain('ledger');
    });

    it('CONTROL — an author with the same grant, and a member with a grant on it, are served it on every door', async () => {
        for (const persona of [PERSONAS.author, PERSONAS.both]) {
            const doors = await doorsFor(persona, OBJ);
            expect(doors.item.status).toBe(200);
            expect(Object.keys(doors.item.body.data.item.fields).sort()).toEqual([...allFields].sort());
            expect(doors.described.fields.map((f: any) => f.name).sort()).toEqual([...allFields].sort());
            expect(doors.listed).toContain(OBJ);
            expect(doors.mcpListed).toContain(OBJ);
        }
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
                // The catalog reads a set by name (ADR-0150 D3): served from the same list.
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
                // The catalog reads a set by name (ADR-0150 D3): served from the same list.
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
    /**
     * Headers whose value is the wall clock at the moment of the read, not
     * anything the projection decided: the protocol stamps `lastModified` with
     * the time of the read, which the door renders at one-second precision, so
     * two sequential reads of one answer differ there whenever they straddle a
     * second boundary.
     */
    const CLOCK_HEADERS = new Set(['last-modified', 'date']);
    /**
     * The wire as compared: every byte, except that a clock header's VALUE
     * reads as a fixed token when it is a date. Its presence, its position and
     * a value that is not a date are still compared, so an answer that gains
     * or drops the header still differs.
     */
    const wireText = (w: Wire) => JSON.stringify({
        ...w,
        headers: w.headers && Object.fromEntries(Object.entries(w.headers).map(([k, v]) => [
            k,
            CLOCK_HEADERS.has(k.toLowerCase()) && !Number.isNaN(Date.parse(v)) ? 'CLOCK' : v,
        ])),
    });

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

describe('[ADR-0106 D1] an action the caller is not shown is answered on every run door as an unknown name — REST /actions and MCP run_action', () => {
    const OBJ = 'run_fls_project';
    const OTHER = 'run_fls_vendor';
    const APPROVE = 'run_fls.approve';
    const ai = (description: string) => ({ exposed: true, description });
    /** Binds a field the member cannot read; required, so a bag without it is a param error to a caller shown it. */
    const SET_BUDGET = { name: 'set_budget', label: 'Set budget', operation: 'update', params: [{ field: 'budget' }], ai: ai('Set the approved budget of this project to a new amount.') };
    /** Binds another object's field the member cannot read (`objectOverride`, judged there). */
    const QUOTE_RATE = { name: 'quote_rate', label: 'Quote rate', operation: 'update', params: [{ field: 'rate', objectOverride: OTHER }], ai: ai('Quote the day rate of a vendor for this project.') };
    /** As SET_BUDGET, and gated on a capability no persona but the approver holds. */
    const APPROVE_BUDGET = {
        name: 'approve_budget', label: 'Approve budget', operation: 'update', params: [{ field: 'budget' }],
        requiredPermissions: [APPROVE], ai: ai('Approve the budget of this project at a new amount.'),
    };
    /** Binds a field the member CAN read: the control. */
    const RENAME = { name: 'rename_project', label: 'Rename', operation: 'update', params: [{ field: 'title' }], ai: ai('Rename this project to the title the user gives.') };
    /** Binds no field at all. */
    const CLOSE = { name: 'close_project', label: 'Close', operation: 'update', patch: { stage: 'closed' }, ai: ai('Close this project once the work on it is finished.') };
    /** No params: its `patch` writes the field the member cannot read. */
    const ZERO_BUDGET = { name: 'zero_budget', label: 'Zero budget', operation: 'update', patch: { budget: 0 }, ai: ai('Set the approved budget of this project to zero.') };
    /** The handler the two rewrites below dispatch to, and what it was handed. */
    const HANDLER = 'apply_project_amount';
    const handled: unknown[] = [];
    /** A rewrite whose inline param is named like the field: still a mention of it. */
    const NAMED_LIKE_FIELD = {
        name: 'apply_named_budget', label: 'Apply amount', type: 'script', target: HANDLER,
        params: [{ name: 'budget', type: 'number' }], ai: ai('Apply a new amount to the approved budget of this project.'),
    };
    /** The changeset's migration followed literally: a handler action whose declaration names no field the member cannot read. */
    const APPLY_AMOUNT = {
        name: 'apply_amount', label: 'Apply amount', type: 'script', target: HANDLER,
        params: [{ name: 'new_amount', type: 'number' }], ai: ai('Apply a new amount to the approved budget of this project.'),
    };
    const WITHHELD = [SET_BUDGET.name, QUOTE_RATE.name, APPROVE_BUDGET.name, ZERO_BUDGET.name, NAMED_LIKE_FIELD.name];
    const UNKNOWN = 'no_such_action';
    /** Every bag shape a caller can send: none, a value of the wrong type, an undeclared key, a well-formed one on a record. */
    const BAGS: ReadonlyArray<Record<string, unknown>> = [
        {},
        { params: { budget: 'not a number', rate: 'not a number' } },
        { params: { undeclared_key: 1 } },
        { recordId: 'p1', params: { budget: 5, rate: 5 } },
    ];

    const ORG = 'org_run_fls';
    const member = {
        userId: 'usr_member', organizationId: ORG, positions: [] as string[], permissions: ['run_fls_member'], systemPermissions: [] as string[],
    };
    const PERSONAS = {
        /** Denied `budget` here and `rate` on the other object. */
        member,
        /** As the member, and holding the approve capability. */
        approver: { ...member, userId: 'usr_approver', systemPermissions: [APPROVE] },
        /** Denied nothing: the control. */
        staff: { ...member, userId: 'usr_staff', permissions: ['run_fls_staff'] },
        /** Denied every field of the project object. */
        walled: { ...member, userId: 'usr_walled', permissions: ['run_fls_walled'] },
        /** D4: holds the member's denies and may write the schema. */
        author: { ...member, userId: 'usr_author', systemPermissions: ['manage_metadata'] },
        /** The system context. */
        system: { userId: 'usr_system', organizationId: ORG, isSystem: true },
    } as const;
    type Persona = Record<string, unknown>;

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
            id: 'com.objectstack.qa.run-door-field-mask',
            name: 'Run door field mask',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [
                {
                    name: OBJ,
                    label: 'Project',
                    sharingModel: 'public_read_write',
                    fields: {
                        title: { name: 'title', type: 'text', label: 'Title' },
                        stage: {
                            name: 'stage', type: 'select', label: 'Stage',
                            options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }],
                        },
                        budget: { name: 'budget', type: 'currency', label: 'Approved budget', required: true },
                    },
                    actions: [SET_BUDGET, QUOTE_RATE, APPROVE_BUDGET, RENAME, CLOSE, ZERO_BUDGET, NAMED_LIKE_FIELD, APPLY_AMOUNT],
                },
                {
                    name: OTHER,
                    label: 'Vendor',
                    sharingModel: 'public_read_write',
                    fields: {
                        name: { name: 'name', type: 'text', label: 'Name' },
                        rate: { name: 'rate', type: 'currency', label: 'Day rate' },
                    },
                },
            ],
        } as never);
        await engine.syncSchemas();
        engine.registerAction(OBJ, HANDLER, async (ctx: any) => {
            handled.push(ctx?.params?.new_amount ?? ctx?.params?.budget);
            return { applied: true };
        });
        const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
        const deny = { readable: false, editable: false };
        const sets = [
            PermissionSetSchema.parse({
                name: 'run_fls_member', label: 'Member', objects: { '*': all },
                fields: { [`${OBJ}.budget`]: deny, [`${OTHER}.rate`]: deny },
            }),
            PermissionSetSchema.parse({ name: 'run_fls_staff', label: 'Staff', objects: { '*': all } }),
            PermissionSetSchema.parse({
                name: 'run_fls_walled', label: 'Walled', objects: { '*': all },
                fields: Object.fromEntries(Object.keys((engine.getSchema(OBJ) as any).fields).map((f) => [`${OBJ}.${f}`, deny])),
            }),
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
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'run_fls_staff' });
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

    /** A project row, written in the system context, read back the same way. */
    const seed = async (id: string) => {
        await engine.insert(OBJ, { id, title: 'Apollo', stage: 'open', budget: 100, organization_id: ORG }, { context: { isSystem: true } });
    };
    const rowOf = async (id: string): Promise<any> => engine.findOne(OBJ, { where: { id }, context: { isSystem: true } });

    /** `POST /actions/:object/:action` under `persona`, as the wire answers it. */
    async function restRun(persona: Persona, action: string, bag: Record<string, unknown>, over: Record<string, any> = services) {
        const dispatcher = new HttpDispatcher(kernelOver(over), undefined, { enforceProjectMembership: false });
        const answer = await dispatcher.handleActions(`/${OBJ}/${action}`, 'POST', structuredClone(bag), {
            request: {}, environmentId: undefined, executionContext: { ...persona },
        } as any);
        return { status: answer.response?.status ?? 0, body: answer.response?.body };
    }
    /** MCP `run_action` under `persona`: the value it resolved, or the refusal's ADR-0112 fields. */
    async function mcpRun(persona: Persona, action: string, bag: Record<string, unknown>, over: Record<string, any> = services) {
        const { bridge } = await bridgeFor(kernelOver(over), persona);
        try {
            return { value: await bridge.runAction(action, { objectName: OBJ, ...structuredClone(bag) }) };
        } catch (error: any) {
            return { refused: { message: String(error?.message), code: error?.code, status: error?.status } };
        }
    }
    /** A host's own door (`dispatchAction`) under `persona`, at the given posture. */
    async function hostRun(persona: Persona, action: string, bag: Record<string, unknown>, posture: 'rest' | 'ai') {
        const dispatcher = new HttpDispatcher(kernelOver(services), undefined, { enforceProjectMembership: false });
        const answer = await dispatcher.dispatchHostAction({
            executionContext: { ...persona } as any, objectName: OBJ, actionName: action, posture, ...structuredClone(bag),
        });
        return { status: answer.status, body: answer.body };
    }
    /** `text` with the unknown name standing where `name` stands. */
    const asUnknown = (text: string, name: string) => text.split(UNKNOWN).join(name);

    it('precondition: the staff is shown every fixture action, and the member is shown exactly the ones binding no field they cannot read', async () => {
        const read = async (persona: Persona) => {
            const { dispatcher } = await bridgeFor(kernelOver(services), persona);
            const meta = await dispatcher.handleMetadata(`/object/${OBJ}`, {
                request: {}, environmentId: undefined, executionContext: { ...persona },
            } as any, 'GET');
            return ((meta.response?.body?.data?.item?.actions ?? []) as any[]).map((a) => a.name).sort();
        };
        const every = [SET_BUDGET, QUOTE_RATE, APPROVE_BUDGET, RENAME, CLOSE, ZERO_BUDGET, NAMED_LIKE_FIELD, APPLY_AMOUNT].map((a) => a.name).sort();
        expect(await read(PERSONAS.staff)).toEqual(every);
        expect(await read(PERSONAS.member)).toEqual(every.filter((n) => !WITHHELD.includes(n)));
    });

    it('REST: an action the member is not shown is answered byte-identical to an unknown name, whatever the bag, and nothing is written', async () => {
        await seed('p1');
        for (const bag of BAGS) {
            const unknown = await restRun(PERSONAS.member, UNKNOWN, bag);
            expect(unknown.status, 'precondition: an unknown name is a 404').toBe(404);
            for (const name of WITHHELD) {
                const answer = await restRun(PERSONAS.member, name, bag);
                expect(JSON.stringify(answer), `${name} ${JSON.stringify(bag)}`).toBe(asUnknown(JSON.stringify(unknown), name));
            }
        }
        expect((await rowOf('p1'))?.budget).toBe(100);
    });

    it('MCP run_action: an action the member is not shown is answered byte-identical to an unknown name, whatever the bag, and nothing is written', async () => {
        await seed('p2');
        for (const bag of BAGS.map((b) => (b.recordId ? { ...b, recordId: 'p2' } : b))) {
            const unknown = await mcpRun(PERSONAS.member, UNKNOWN, bag);
            expect(unknown.refused, 'precondition: an unknown name is refused').toBeDefined();
            for (const name of WITHHELD) {
                const answer = await mcpRun(PERSONAS.member, name, bag);
                expect(JSON.stringify(answer), `${name} ${JSON.stringify(bag)}`).toBe(asUnknown(JSON.stringify(unknown), name));
            }
        }
        expect((await rowOf('p2'))?.budget).toBe(100);
    });

    it('host dispatchAction, both postures: an action the member is not shown is answered byte-identical to an unknown name, whatever the bag', async () => {
        await seed('p6');
        for (const posture of ['rest', 'ai'] as const) {
            for (const bag of BAGS.map((b) => (b.recordId ? { ...b, recordId: 'p6' } : b))) {
                const unknown = await hostRun(PERSONAS.member, UNKNOWN, bag, posture);
                expect(unknown.status, 'precondition: an unknown name is a 404').toBe(404);
                for (const name of WITHHELD) {
                    const answer = await hostRun(PERSONAS.member, name, bag, posture);
                    expect(JSON.stringify(answer), `${posture} ${name} ${JSON.stringify(bag)}`).toBe(asUnknown(JSON.stringify(unknown), name));
                }
            }
        }
        expect((await rowOf('p6'))?.budget).toBe(100);
    });

    it('a capability-gated action the member is not shown is answered as unknown on both doors, never as its gate\'s refusal; the scoped pre-screen names no gate', async () => {
        for (const persona of [PERSONAS.member, PERSONAS.approver]) {
            const rest = await restRun(persona, APPROVE_BUDGET.name, {});
            expect(JSON.stringify(rest)).toBe(asUnknown(JSON.stringify(await restRun(persona, UNKNOWN, {})), APPROVE_BUDGET.name));
            const { bridge } = await bridgeFor(kernelOver(services), persona);
            expect(await bridge.capabilityRefusal(APPROVE_BUDGET.name, OBJ)).toBeUndefined();
        }
        // CONTROL: shown it, a caller without the capability is answered the gate's refusal on both.
        expect((await restRun(PERSONAS.staff, APPROVE_BUDGET.name, {})).status).toBe(403);
        const { bridge } = await bridgeFor(kernelOver(services), PERSONAS.staff);
        expect((await bridge.capabilityRefusal(APPROVE_BUDGET.name, OBJ))?.status).toBe(403);
    });

    it('a caller whose field visibility cannot be evaluated is refused 503 FIELD_VISIBILITY_UNRESOLVED on both doors, and nothing runs', async () => {
        await seed('p3');
        for (const name of [SET_BUDGET.name, RENAME.name, CLOSE.name]) {
            const rest = await restRun(PERSONAS.walled, name, { recordId: 'p3', params: {} });
            expect({ status: rest.status, code: rest.body?.error?.code }, name).toEqual({ status: 503, code: REFUSED.code });
            const mcp = await mcpRun(PERSONAS.walled, name, { recordId: 'p3', params: {} });
            expect({ code: mcp.refused?.code, status: mcp.refused?.status }, name).toEqual(REFUSED);
        }
        // A security service that throws is the same refusal.
        const sick = { ...services, security: { getMetadataReadableFields: async () => { throw new Error('security service unavailable'); } } };
        expect((await restRun(PERSONAS.member, CLOSE.name, {}, sick)).status).toBe(503);
        expect((await mcpRun(PERSONAS.member, CLOSE.name, {}, sick)).refused).toMatchObject(REFUSED);
        expect((await rowOf('p3'))?.stage).toBe('open');
    });

    it('CONTROL — an action the member is shown runs for the member as it runs for the staff, on both doors', async () => {
        await seed('p4');
        await seed('p5');
        const rest = await restRun(PERSONAS.member, RENAME.name, { recordId: 'p4', params: { title: 'Gemini' } });
        expect(rest.status, JSON.stringify(rest.body)).toBe(200);
        expect((await rowOf('p4'))?.title).toBe('Gemini');
        const mcp = await mcpRun(PERSONAS.member, CLOSE.name, { recordId: 'p5' });
        expect(mcp.refused, JSON.stringify(mcp.refused)).toBeUndefined();
        expect((await rowOf('p5'))?.stage).toBe('closed');
        // A param error is still the shown caller's located 400, on both doors.
        const staffRest = await restRun(PERSONAS.staff, SET_BUDGET.name, { params: { budget: 'not a number' } });
        expect(staffRest.status).toBe(400);
        expect(JSON.stringify(staffRest.body)).toContain('budget');
        const staffMcp = await mcpRun(PERSONAS.staff, SET_BUDGET.name, { params: { budget: 'not a number' } });
        expect(staffMcp.refused?.status).toBe(400);
    });

    it('the migration followed literally: a handler action whose declaration names no field the member cannot read runs for the member, on both doors', async () => {
        await seed('p7');
        handled.length = 0;
        const rest = await restRun(PERSONAS.member, APPLY_AMOUNT.name, { recordId: 'p7', params: { new_amount: 9 } });
        expect(rest.status, JSON.stringify(rest.body)).toBe(200);
        const mcp = await mcpRun(PERSONAS.member, APPLY_AMOUNT.name, { recordId: 'p7', params: { new_amount: 9 } });
        expect(mcp.refused, JSON.stringify(mcp.refused)).toBeUndefined();
        expect(handled).toEqual([9, 9]);
        // The same rewrite with the param named like the field is still a mention of it.
        const named = await restRun(PERSONAS.member, NAMED_LIKE_FIELD.name, { recordId: 'p7', params: { budget: 9 } });
        expect(JSON.stringify(named)).toBe(asUnknown(JSON.stringify(await restRun(PERSONAS.member, UNKNOWN, {})), NAMED_LIKE_FIELD.name));
        expect(handled).toEqual([9, 9]);
    });

    it('CONTROL — the system context and a D4-exempt author are answered as a deployment with the mask switched off answers them', async () => {
        for (const persona of [PERSONAS.system, PERSONAS.author]) {
            for (const [door, run] of [['REST', restRun], ['MCP', mcpRun]] as const) {
                const id = `p_${String(persona.userId)}_${door}`;
                const twin = `${id}_unmasked`;
                await seed(id);
                await seed(twin);
                const answered = await run(persona, SET_BUDGET.name, { recordId: id, params: { budget: 7 } });
                process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = '1';
                const control = await run(persona, SET_BUDGET.name, { recordId: twin, params: { budget: 7 } });
                delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
                const where = `${door} ${String(persona.userId)}`;
                // The row's own timestamps are the wall clock of each write, not anything a gate decided.
                const text = (answer: unknown, rowId: string) => JSON.stringify(answer).split(rowId).join('ID')
                    .replace(/"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z"/g, '"CLOCK"');
                expect(text(answered, id), where).toBe(text(control, twin));
                expect(JSON.stringify(answered).includes(UNKNOWN), where).toBe(false);
                expect((await rowOf(id))?.budget, where).toBe((await rowOf(twin))?.budget);
            }
        }
        // The system context's run writes.
        expect((await rowOf(`p_${PERSONAS.system.userId}_REST`))?.budget).toBe(7);
    });
});

describe('[#32435] describe_object serves what a write needs, as the caller is served the object — the real security layer', () => {
    const OBJ = 'mcp_write_leave';
    const DENIED = 'secret_margin';
    let engine: ObjectQL;
    let services: Record<string, any>;

    const PERSONAS = {
        /** Denied one field. */
        member: { userId: 'usr_member', positions: [] as string[], permissions: ['mcp_write_member'], systemPermissions: [] as string[] },
        /** Denied nothing: the control. */
        staff: { userId: 'usr_staff', positions: [] as string[], permissions: ['mcp_write_staff'], systemPermissions: [] as string[] },
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
            id: 'com.objectstack.qa.mcp-describe-write-facts',
            name: 'MCP describe write facts',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [{
                name: OBJ,
                label: 'Leave',
                sharingModel: 'public_read_write',
                fields: {
                    subject: { name: 'subject', type: 'text', label: 'Subject', required: true },
                    leave_type: {
                        name: 'leave_type',
                        type: 'select',
                        label: 'Leave type',
                        required: true,
                        options: [{ value: 'annual', label: 'Annual', color: '#0a0' }, { value: 'sick', label: 'Sick' }],
                        defaultValue: 'annual',
                    },
                    [DENIED]: { name: DENIED, type: 'currency', label: 'Margin' },
                },
                validations: [
                    { type: 'script', name: 'subject_not_blank', condition: 'record.subject == ""', message: 'Subject must not be blank.' },
                    {
                        type: 'cross_field',
                        name: 'margin_needs_subject',
                        fields: [DENIED, 'subject'],
                        condition: 'record.subject == null',
                        message: 'A margin needs a subject.',
                    },
                    // Names the hidden field in its MESSAGE alone.
                    { type: 'script', name: 'message_names_hidden', condition: 'record.subject == "x"', message: `Fill ${DENIED} first.` },
                    { type: 'script', name: 'retired_rule', active: false, condition: 'record.subject == "y"', message: 'Retired.' },
                ],
            }],
        } as never);
        await engine.syncSchemas();
        const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
        const sets = [
            PermissionSetSchema.parse({
                name: 'mcp_write_member', label: 'Member', objects: { '*': all },
                fields: { [`${OBJ}.${DENIED}`]: { readable: false, editable: false } },
            }),
            PermissionSetSchema.parse({ name: 'mcp_write_staff', label: 'Staff', objects: { '*': all } }),
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
        const plugin = new SecurityPlugin({ fallbackPermissionSet: 'mcp_write_staff' });
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

    const describedFor = async (persona: Record<string, unknown>): Promise<any> =>
        (await bridgeFor(kernelOver(services), persona)).bridge.describeObject(OBJ);
    const field = (described: any, name: string) => described.fields.find((f: any) => f.name === name);
    /** Does `name` occur in `text` as an identifier token? */
    const mentions = (text: string, name: string) => (text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? ([] as string[])).includes(name);

    it('a member denied a field is served options, defaults, readonly/system and the rule messages, and nothing of the field', async () => {
        const described = await describedFor(PERSONAS.member);
        expect(field(described, 'subject')).toEqual({
            name: 'subject', type: 'text', label: 'Subject', required: true, readonly: false, system: false,
        });
        expect(field(described, 'leave_type')).toEqual({
            name: 'leave_type',
            type: 'select',
            label: 'Leave type',
            required: true,
            readonly: false,
            system: false,
            options: [{ value: 'annual', label: 'Annual' }, { value: 'sick', label: 'Sick' }],
            defaultValue: 'annual',
        });
        // An audit column the registry injects: never writable, and said so.
        expect(field(described, 'created_at')).toMatchObject({ readonly: true, system: true });
        expect(described.validations).toEqual([{
            name: 'subject_not_blank',
            type: 'script',
            message: 'Subject must not be blank.',
            severity: 'error',
            events: ['insert', 'update'],
            fields: [],
        }]);
        const text = JSON.stringify(described);
        expect(mentions(text, DENIED)).toBe(false);
        expect(text).not.toContain('record.');
    });

    it('CONTROL — an unrestricted member is served every active rule, the hidden-field ones included', async () => {
        const described = await describedFor(PERSONAS.staff);
        expect(described.fields.map((f: any) => f.name)).toContain(DENIED);
        expect(described.validations.map((r: any) => r.name))
            .toEqual(['subject_not_blank', 'margin_needs_subject', 'message_names_hidden']);
        expect(described.validations[1].fields).toEqual([DENIED, 'subject']);
        const text = JSON.stringify(described);
        expect(mentions(text, 'retired_rule')).toBe(false);
        expect(text).not.toContain('record.');
        // …and it is the answer a deployment with no security service gets.
        const unsecured = await bridgeFor(kernelOver({ ...services, security: undefined }), PERSONAS.staff);
        expect(text).toBe(JSON.stringify(await unsecured.bridge.describeObject(OBJ)));
    });
});
