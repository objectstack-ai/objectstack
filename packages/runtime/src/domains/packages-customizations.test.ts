// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28411, ADR-0146 D8 item 4] `GET /packages/:id/customizations` — one read
 * answers "what did we change on this base": the items its paired
 * `<base>.custom` package overrides, the members the pair adds to the base's
 * objects, and the base's items switched off in the activation ledger, with
 * each list's length.
 *
 * Driven through the real dispatcher over the real protocol and the real
 * `ObjectQL` engine with an in-memory driver (the harness of `@objectstack/objectql`'s
 * `protocol-custom-override-effective-read.test.ts`): the base is registered
 * as a code package, the pair is installed through the package door with its
 * dependency declared, every override is written through the draft save and
 * the per-item publish, and the ledger row through the ledger's own store.
 *
 *  - the fixture base + pair answers all three lists, counts 1/1/1, and the
 *    answer parses through `GetPackageCustomizationsResponseSchema`;
 *  - AGREEMENT: every listed override is the item the layered read of the
 *    base's name reports as `overlay`, the `.custom` row that declares it;
 *  - CONTROLS: a declaration from a non-pair package is not listed; an
 *    undeclared pair row is not an override (both rows are refused at the
 *    save door since #28410, so the test asserts that refusal and lays them
 *    down below the gate, as rows from before it); another package's extension and
 *    ledger rows are not the base's; a base with no pair answers empty lists
 *    and 200 and no pair is created; a `.custom` id is refused naming its base;
 *    an unknown id answers 404; a caller without the read capability is
 *    refused as `GET /packages/:id` refuses them; a query parameter is refused.
 *
 * Test-path resolution: the protocol and the engine are
 * `@objectstack/metadata-protocol`'s and `@objectstack/objectql`'s `dist/`, so a
 * change there is read here after those packages are rebuilt.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { GetPackageCustomizationsResponseSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectStoreMetadataActivationStore } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';
import { ROUTE_LEDGER } from '../route-ledger.js';

const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
const DEPENDENT = 'com.default.acme-extra';
const OTHER = 'com.example.other';
const VIEW = 'showcase_task.default';
const DECLARATION = { package: BASE, basedOn: '1.0.0' } as const;

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        bundle_member: { name: 'bundle_member', label: 'Bundle Member', type: 'text' as const, maxLength: 100 },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        draft_changes: { name: 'draft_changes', label: 'Draft Changes', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

/** The ledger's four columns (ADR-0126 §4), as `sys_metadata_activation` declares them. */
const activationObject: ServiceObject = {
    name: 'sys_metadata_activation',
    label: 'Metadata Activation',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        metadata_type: { name: 'metadata_type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        active: { name: 'active', label: 'Active', type: 'boolean' as const },
    },
};

function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const rowVal = row[k];
            if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
                if (!(v as any).$in.includes(rowVal === undefined ? null : rowVal)) return false;
                continue;
            }
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return driver;
}

const listBody = (name: string, columns: readonly string[]) => ({
    name,
    object: 'showcase_task',
    viewKind: 'list',
    label: 'All Tasks',
    config: {
        type: 'grid',
        data: { provider: 'object', object: 'showcase_task' },
        columns: columns.map((field) => ({ field })),
    },
});

function baseManifest(): Record<string, unknown> {
    return {
        id: BASE,
        name: 'showcase',
        // [ADR-0146 D3, #28512] The pair's namespace is the base's plus `_custom`.
        namespace: 'showcase',
        version: '1.0.0',
        objects: [{
            name: 'showcase_task',
            label: 'Task',
            sharingModel: 'private',
            fields: Object.fromEntries(['title', 'status', 'due_date'].map((f) => [f, { name: f, label: f, type: 'text' }])),
        }],
        views: [{
            object: 'showcase_task',
            list: {
                label: 'All Tasks',
                type: 'grid',
                data: { provider: 'object', object: 'showcase_task' },
                columns: ['title', 'status', 'due_date'].map((field) => ({ field })),
            },
        }],
    };
}

/** A second code package owning an object of its own, so an extension of it is not the base's. */
function otherManifest(): Record<string, unknown> {
    return {
        id: OTHER,
        name: 'other',
        version: '1.0.0',
        objects: [{
            name: 'other_note',
            label: 'Note',
            sharingModel: 'private',
            fields: { body: { name: 'body', label: 'Body', type: 'text' } },
        }],
    };
}

async function boot() {
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(), true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    engine.registry.registerObject(activationObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(baseManifest());
    engine.registerApp(otherManifest());
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    const kernel: any = {
        context: {
            getService: (name: string) => (name === 'objectql' ? engine : name === 'protocol' ? protocol : null),
        },
    };
    return { engine, protocol, dispatcher: new HttpDispatcher(kernel) };
}

const savedWritable = process.env.OS_METADATA_WRITABLE;
beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});
afterEach(() => {
    if (savedWritable === undefined) delete process.env.OS_METADATA_WRITABLE;
    else process.env.OS_METADATA_WRITABLE = savedWritable;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});

/**
 * Installs a writable package through the package door, depending on the base.
 * The pair carries what its ensure door writes (ADR-0146 D3): the base's pair
 * namespace, explicit, and the dependency on the base.
 */
async function install(protocol: ObjectStackProtocolImplementation, id: string): Promise<void> {
    await (protocol as any).installPackage({
        manifest: {
            id,
            name: id.split('.').join('-'),
            version: '0.1.0',
            type: 'app',
            ...(id === PAIR ? { namespace: 'showcase_custom' } : {}),
            dependencies: { [BASE]: '*' },
        },
    });
}

/** A draft save naming the package, then the per-item publish naming it. */
async function saveView(
    protocol: ObjectStackProtocolImplementation,
    packageId: string,
    name: string,
    columns: readonly string[],
    extra: Record<string, unknown> = {},
): Promise<void> {
    const body = { ...listBody(name, columns), ...extra };
    await protocol.saveMetaItem({ type: 'view', name, item: body, mode: 'draft', packageId } as any);
    await protocol.publishMetaItem({ type: 'view', name, packageId } as any);
}

/**
 * [#28410, ADR-0146 D2, ruling A on #28390] A row the override write gate now
 * refuses at the save door, laid down as it was before the gate: the door's
 * refusal (`403 NOT_OVERRIDABLE`, its sentence matching `refused`) is asserted
 * first, then the same draft save and publish run with the gate answering
 * `not_concerned` for them alone. Such rows exist from before the gate, so
 * the read below still has to treat them right; what is pinned is the read.
 */
async function saveViewBeforeTheGate(
    protocol: ObjectStackProtocolImplementation,
    packageId: string,
    name: string,
    columns: readonly string[],
    refused: RegExp,
    extra: Record<string, unknown> = {},
): Promise<void> {
    const body = { ...listBody(name, columns), ...extra };
    await expect(protocol.saveMetaItem({ type: 'view', name, item: body, mode: 'draft', packageId } as any))
        .rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403, message: expect.stringMatching(refused) });
    const gated = protocol as any;
    gated.overrideWriteVerdict = () => ({ verdict: 'not_concerned' });
    try {
        await saveView(protocol, packageId, name, columns, extra);
    } finally {
        delete gated.overrideWriteVerdict;
    }
}

/** One `extend` contribution, as `registerApp` registers a manifest's `objectExtensions` entry. */
const extend = (engine: ObjectQL, packageId: string, object: string, body: Record<string, unknown>) =>
    engine.registry.registerObject({ name: object, ...body } as any, packageId, undefined, 'extend');

const switchOff = (engine: ObjectQL, type: string, name: string, packageId: string, active = false) =>
    new ObjectStoreMetadataActivationStore(engine as any, type).setActive({ name, packageId, active });

const reader = (permissions: string[] = ['studio.access']): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: permissions },
});

const customizations = (dispatcher: HttpDispatcher, id: string, query: Record<string, unknown> = {}, context = reader()) =>
    dispatcher.handlePackages(`/${encodeURIComponent(id)}/customizations`, 'GET', undefined, query, context);

/** The fixture of the card: one declared override, one extension field, one switched-off flow. */
async function fixture() {
    const booted = await boot();
    const { engine, protocol } = booted;
    await install(protocol, PAIR);
    await saveView(protocol, PAIR, VIEW, ['title', 'due_date'], { overrides: { ...DECLARATION } });
    extend(engine, PAIR, 'showcase_task', { fields: { region__c: { name: 'region__c', label: 'Region', type: 'text' } } });
    await switchOff(engine, 'flow', 'showcase_task_reminder', BASE);
    return booted;
}

describe('[#28411] GET /packages/:id/customizations — overrides, extensions and switched-off items of a base', () => {
    it('answers the three lists of the fixture base and their counts, 1/1/1, through the declared response schema', async () => {
        const { dispatcher } = await fixture();
        const r = await customizations(dispatcher, BASE);
        expect(r.response?.status).toBe(200);
        const data = r.response?.body?.data;
        expect(data).toEqual({
            packageId: BASE,
            overrides: [{ type: 'view', name: VIEW, basedOn: '1.0.0', version: expect.any(Number) }],
            extensions: [{ object: 'showcase_task', kind: 'field', name: 'region__c' }],
            switchedOff: [{ type: 'flow', name: 'showcase_task_reminder' }],
            contributions: [],
            counts: { overrides: 1, extensions: 1, switchedOff: 1, contributions: 0 },
        });
        const parsed = GetPackageCustomizationsResponseSchema.safeParse(data);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it('the route ledger names the response schema this suite parses the answer with', () => {
        const row = ROUTE_LEDGER.find((r) => r.route === 'GET /packages/:id/customizations');
        expect(row?.responseSchema).toBe('GetPackageCustomizationsResponseSchema');
        expect(row?.client).toBe('packages.customizations');
    });

    it('AGREEMENT: every listed override is the item the layered read of the base\'s name reports as `overlay`', async () => {
        const { dispatcher, protocol } = await fixture();
        const { overrides } = (await customizations(dispatcher, BASE)).response?.body?.data;
        expect(overrides.length).toBeGreaterThan(0);
        for (const { type, name } of overrides) {
            const layers: any = await (protocol as any).getMetaItemLayered({ type, name, packageId: BASE });
            expect(layers.overlay?.overrides, `${type}/${name}`).toEqual(DECLARATION);
            expect(layers.effective?.overrides, `${type}/${name}`).toEqual(DECLARATION);
        }
    });

    it('a declaration from a package that is not the base\'s pair is not an override of the base', async () => {
        const { dispatcher, protocol } = await boot();
        await install(protocol, DEPENDENT);
        await saveViewBeforeTheGate(protocol, DEPENDENT, VIEW, ['title', 'status'], /carries `overrides`/, { overrides: { ...DECLARATION } });
        const data = (await customizations(dispatcher, BASE)).response?.body?.data;
        expect(data.overrides).toEqual([]);
        expect(data.counts.overrides).toBe(0);
    });

    it('a pair row without the declaration is the pair\'s own item, not an override', async () => {
        const { dispatcher, protocol } = await boot();
        await install(protocol, PAIR);
        await saveViewBeforeTheGate(protocol, PAIR, VIEW, ['title'], /declares no override/);
        const data = (await customizations(dispatcher, BASE)).response?.body?.data;
        expect(data.overrides).toEqual([]);
        expect(data.counts.overrides).toBe(0);
    });

    it('a pair row of a type no declaration applies to (a permission set, ADR-0146 D6) is not an override, whatever its body says', async () => {
        const { dispatcher, protocol, engine } = await boot();
        await install(protocol, PAIR);
        // Laid down as the repository's write lays a row down: the publish
        // door refuses `overrides` on this type, so only a stored row carries it.
        await engine.insert('sys_metadata', {
            type: 'permission', name: 'showcase_admin', organization_id: null, package_id: PAIR,
            metadata: JSON.stringify({ name: 'showcase_admin', label: 'Admin', overrides: { ...DECLARATION } }),
            state: 'active', version: 1,
        }, { context: { isSystem: true } });
        const data = (await customizations(dispatcher, BASE)).response?.body?.data;
        expect(data.overrides).toEqual([]);
        expect(data.counts.overrides).toBe(0);
    });

    it('lists the pair\'s validations and indexes beside its fields, and no other package\'s extension or object', async () => {
        const { dispatcher, protocol, engine } = await boot();
        await install(protocol, PAIR);
        extend(engine, PAIR, 'showcase_task', {
            fields: { region__c: { name: 'region__c', label: 'Region', type: 'text' } },
            validations: [{ name: 'region_set', type: 'script', condition: 'region__c != null', message: 'Region' }],
            indexes: [{ name: 'idx_region', fields: ['region__c'] }, { fields: ['region__c', 'status'] }],
        });
        // Another dependent's extension of the base's object, and the pair's
        // extension of an object the base does not own.
        extend(engine, DEPENDENT, 'showcase_task', { fields: { partner_code: { name: 'partner_code', label: 'Code', type: 'text' } } });
        extend(engine, PAIR, 'other_note', { fields: { tag__c: { name: 'tag__c', label: 'Tag', type: 'text' } } });
        const data = (await customizations(dispatcher, BASE)).response?.body?.data;
        expect(data.extensions).toEqual([
            { object: 'showcase_task', kind: 'field', name: 'region__c' },
            { object: 'showcase_task', kind: 'validation', name: 'region_set' },
            { object: 'showcase_task', kind: 'index', fields: ['region__c', 'status'] },
            { object: 'showcase_task', kind: 'index', name: 'idx_region', fields: ['region__c'] },
        ]);
        expect(data.counts.extensions).toBe(4);
        expect(GetPackageCustomizationsResponseSchema.safeParse(data).success).toBe(true);
    });

    it('switched off is the base\'s `active: false` ledger rows only', async () => {
        const { dispatcher, engine } = await boot();
        await switchOff(engine, 'flow', 'showcase_task_reminder', BASE);
        await switchOff(engine, 'action', 'showcase_task.archive', BASE);
        await switchOff(engine, 'flow', 'showcase_task_digest', BASE, true);
        await switchOff(engine, 'flow', 'other_note_digest', OTHER);
        const data = (await customizations(dispatcher, BASE)).response?.body?.data;
        expect(data.switchedOff).toEqual([
            { type: 'action', name: 'showcase_task.archive' },
            { type: 'flow', name: 'showcase_task_reminder' },
        ]);
        expect(data.counts.switchedOff).toBe(2);
    });

    it('a base with no pair answers empty lists and 200, and the read creates no pair', async () => {
        const { dispatcher, engine } = await boot();
        const before = engine.registry.getAllPackages().length;
        const r = await customizations(dispatcher, BASE);
        expect(r.response?.status).toBe(200);
        expect(r.response?.body?.data).toEqual({
            packageId: BASE,
            overrides: [],
            extensions: [],
            switchedOff: [],
            contributions: [],
            counts: { overrides: 0, extensions: 0, switchedOff: 0, contributions: 0 },
        });
        expect(engine.registry.getAllPackages().length).toBe(before);
        expect(engine.registry.getPackage(PAIR)).toBeFalsy();
    });

    it('a `.custom` id is refused 400 with a message naming its base, installed or not', async () => {
        const { dispatcher, protocol } = await boot();
        const absent = await customizations(dispatcher, PAIR);
        expect(absent.response?.status).toBe(400);
        expect(absent.response?.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(absent.response?.body?.error?.message).toContain(`'${BASE}'`);
        await install(protocol, PAIR);
        const present = await customizations(dispatcher, PAIR);
        expect(present.response?.status).toBe(400);
        expect(present.response?.body?.error?.message).toContain(`'${BASE}'`);
    });

    it('an unknown id answers 404 in the wording of GET /packages/:id', async () => {
        const { dispatcher } = await boot();
        const r = await customizations(dispatcher, 'com.example.nowhere');
        expect(r.response?.status).toBe(404);
        const single = await dispatcher.handlePackages('/com.example.nowhere', 'GET', undefined, {}, reader());
        expect(r.response?.body?.error?.message).toBe(single.response?.body?.error?.message);
    });

    it('a caller without the read capability is refused here exactly as GET /packages/:id refuses them', async () => {
        const { dispatcher } = await fixture();
        const caller = reader(['manage_metadata']);
        const r = await customizations(dispatcher, BASE, {}, caller);
        const single = await dispatcher.handlePackages(`/${encodeURIComponent(BASE)}`, 'GET', undefined, {}, caller);
        expect(single.response?.status).toBe(403);
        expect(r.response?.status).toBe(403);
        expect(r.response?.body?.error).toEqual(single.response?.body?.error);
        // `setup.access` is admitted, as it is there.
        expect((await customizations(dispatcher, BASE, {}, reader(['setup.access']))).response?.status).toBe(200);
    });

    it('a query parameter is refused 400 VALIDATION_ERROR naming it: the door reads none', async () => {
        const { dispatcher } = await fixture();
        const r = await customizations(dispatcher, BASE, { includeDrafts: 'true' });
        expect(r.response?.status).toBe(400);
        expect(r.response?.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(r.response?.body?.error?.message).toContain('includeDrafts');
    });
});

const THIRD = 'com.example.acme-sync';
const FOURTH = 'com.example.partner';

/** A flow triggered by a record change on `object`. */
const flowOn = (name: string, object: string) => ({
    name,
    label: name,
    type: 'record_change',
    status: 'active',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: object, triggerType: 'record-after-update' } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/** A code package registered as the engine registers every manifest: an object extension and flows. */
const registerContributor = (engine: ObjectQL, id: string, fields: readonly string[], flows: ReadonlyArray<ReturnType<typeof flowOn>>) =>
    engine.registerApp({
        id,
        name: id.split('.').join('-'),
        version: '1.0.0',
        objectExtensions: [{
            extend: 'showcase_task',
            fields: Object.fromEntries(fields.map((f) => [f, { name: f, label: f, type: 'text' }])),
        }],
        flows: [...flows],
    });

/**
 * The card's fixture (#28722): the base ships a flow on its object, the pair
 * extends that object and carries a flow on it, and a third code package
 * extends the same object with a field and ships a flow on it — plus a flow
 * on an object the base does not own.
 */
async function contributedFixture() {
    const booted = await boot();
    const { engine, protocol } = booted;
    engine.registry.registerItem('flow', flowOn('showcase_task_escalate', 'showcase_task'), 'name', BASE);
    await install(protocol, PAIR);
    extend(engine, PAIR, 'showcase_task', { fields: { region__c: { name: 'region__c', label: 'Region', type: 'text' } } });
    engine.registry.registerItem('flow', flowOn('showcase_task_region_notify', 'showcase_task'), 'name', PAIR);
    registerContributor(engine, THIRD, ['acme_sync_id'], [flowOn('acme_task_sync', 'showcase_task'), flowOn('acme_note_sync', 'other_note')]);
    return booted;
}

describe('[#28722] GET /packages/:id/customizations — the fields and flows other packages contribute to a base', () => {
    it('names the third package for its extension field and its flow, and names neither the base nor the pair', async () => {
        const { dispatcher } = await contributedFixture();
        const r = await customizations(dispatcher, BASE);
        expect(r.response?.status).toBe(200);
        const data = r.response?.body?.data;
        expect(data.contributions).toEqual([
            { kind: 'field', object: 'showcase_task', name: 'acme_sync_id', packageId: THIRD },
            { kind: 'flow', object: 'showcase_task', name: 'acme_task_sync', packageId: THIRD },
        ]);
        expect(data.counts.contributions).toBe(2);
        // The pair's member stays where N-15 serves it, and is not a contribution.
        expect(data.extensions).toEqual([{ object: 'showcase_task', kind: 'field', name: 'region__c' }]);
        const parsed = GetPackageCustomizationsResponseSchema.safeParse(data);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it('stamps each item with its own package: two packages adding a field of one name are two entries', async () => {
        const { dispatcher, engine } = await contributedFixture();
        registerContributor(engine, FOURTH, ['acme_sync_id'], []);
        const { contributions } = (await customizations(dispatcher, BASE)).response?.body?.data;
        expect(contributions.filter((c: any) => c.kind === 'field')).toEqual([
            { kind: 'field', object: 'showcase_task', name: 'acme_sync_id', packageId: THIRD },
            { kind: 'field', object: 'showcase_task', name: 'acme_sync_id', packageId: FOURTH },
        ]);
    });

    it('a flow authored in this environment is not a package\'s contribution', async () => {
        const { dispatcher, engine } = await contributedFixture();
        // The bare slot every package-less registration takes: the sentinel
        // stamp, and a tenant-authored overlay wearing a real package's id.
        engine.registry.registerItem('flow', { ...flowOn('showcase_task_local', 'showcase_task'), _packageId: 'sys_metadata' } as any);
        engine.registry.registerItem('flow', { ...flowOn('showcase_task_org', 'showcase_task'), _packageId: THIRD, _provenance: 'org' } as any);
        const { contributions } = (await customizations(dispatcher, BASE)).response?.body?.data;
        expect(contributions.map((c: any) => `${c.kind}:${c.name}`)).toEqual(['field:acme_sync_id', 'flow:acme_task_sync']);
    });

    it('reads a field\'s stamp and a flow\'s stamp the same way: each stamp lists both kinds or neither', async () => {
        const { dispatcher, engine } = await boot();
        // One field extension and one flow per stamp, on the base's object.
        // A code package's stamp is a contribution; the package-less
        // `sys_metadata` sentinel and a tenant-authored body wearing a real
        // package's id are the environment's, whichever kind carries them.
        const stamps = [
            { tag: 'code', packageId: THIRD, body: {} },
            { tag: 'sentinel', packageId: 'sys_metadata', body: {} },
            { tag: 'tenant', packageId: FOURTH, body: { _provenance: 'org' } },
        ] as const;
        for (const { tag, packageId, body } of stamps) {
            extend(engine, packageId, 'showcase_task', { ...body, fields: { [`${tag}_field`]: { name: `${tag}_field`, label: tag, type: 'text' } } });
            engine.registry.registerItem('flow', { ...flowOn(`${tag}_flow`, 'showcase_task'), _packageId: packageId, ...body } as any);
        }
        const { contributions } = (await customizations(dispatcher, BASE)).response?.body?.data;
        const listedTags = (kind: string) => contributions
            .filter((c: any) => c.kind === kind)
            .map((c: any) => c.name.replace(/_(field|flow)$/, ''))
            .sort();
        expect(listedTags('field')).toEqual(listedTags('flow'));
        expect(contributions).toEqual([
            { kind: 'field', object: 'showcase_task', name: 'code_field', packageId: THIRD },
            { kind: 'flow', object: 'showcase_task', name: 'code_flow', packageId: THIRD },
        ]);
    });

    it('another base\'s read lists what is contributed to its own objects only', async () => {
        const { dispatcher } = await contributedFixture();
        const data = (await customizations(dispatcher, OTHER)).response?.body?.data;
        expect(data.contributions).toEqual([{ kind: 'flow', object: 'other_note', name: 'acme_note_sync', packageId: THIRD }]);
        expect(data.counts.contributions).toBe(1);
    });
});
