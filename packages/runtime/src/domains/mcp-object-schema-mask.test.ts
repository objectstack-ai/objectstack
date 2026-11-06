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
    const SYS_CTX = { isSystem: true, userId: 'usr_system' };
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
        return { bridge, describe, meta: { status: meta.response.status, item: meta.response.body?.data?.item } };
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
