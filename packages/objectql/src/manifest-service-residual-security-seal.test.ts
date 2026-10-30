// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0130 D4, ADR-0131 D6] A security rule a composed stack declares only on
 * its TOP LEVEL, beside package bodies that do not declare it (the stack's
 * residual), is managed content the way a package body's is: the metadata
 * save door seals it against an environment save, and the declared rule keeps
 * being the one served.
 *
 * What decides "a code package ships this" at that door is an entry a package
 * registered in this engine's SchemaRegistry (`isArtifactBacked`). The
 * `manifest` service registers each residual item there under the stack's own
 * manifest id, as it registers a body's items under the body's id, so the two
 * answer alike. `engine-security-catalog-package-door.test.ts` holds the same
 * door for a body's items; this file holds it for the residual's.
 *
 * The population is read from the type registry, not written out: every
 * `domain: 'security'` type with `allowEnvironmentOverlay: false`. The stack is
 * booted through the `manifest` service, as `AppPlugin` hands a config boot's
 * stack to it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import type { ServiceObject } from '@objectstack/spec/data';
import { OWNERSHIP_QUEUE_SERVICE } from '@objectstack/spec/contracts';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { singularToPlural } from '@objectstack/spec/shared';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

const RELEASE_ID = 'com.example.acme.release';
const NAME = 'probe_item';

/** The pin's population, read off the registry: every non-overridable `security` type. */
const SECURITY_NON_OVERRIDABLE = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((entry) => entry.domain === 'security' && entry.allowEnvironmentOverlay === false)
    .map((entry) => entry.type);

/** A schema-valid body per type; a type that joins the population without one fails the first case by name. */
const BODIES: Record<string, Record<string, unknown>> = {
    permission: { name: NAME, label: 'Probe', objects: {} },
    position: { name: NAME, label: 'Probe' },
    capability: { name: NAME, label: 'Probe' },
    sharing_rule: {
        type: 'criteria', name: NAME, label: 'Probe', object: 'probe_object',
        condition: "record.status == 'open'", accessLevel: 'read',
        sharedWith: { type: 'position', value: 'probe_position' },
    },
    queue: { name: NAME, label: 'Probe', members: [{ type: 'position', value: 'probe_position' }] },
    assignment_rule: {
        name: NAME, label: 'Probe', object: 'probe_object',
        entries: [{ name: 'all', assignTo: { type: 'queue', value: 'probe_queue' } }],
    },
};

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
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

/** In-memory driver, copied from `save-meta-response-conformance.test.ts`; equality-only WHERE. */
function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them (#7620).
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
            // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
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
    return { driver, stores };
}

/**
 * A stack carrying `packages[]` whose top level declares `NAME` through each
 * type's collection and whose one body declares none of them — what
 * `AppPlugin.init` hands the `manifest` service.
 */
function residualStack(types: readonly string[]): Record<string, unknown> {
    const manifest = { id: RELEASE_ID, name: 'acme', namespace: 'acme', version: '1.0.0', type: 'app' };
    const stack: Record<string, unknown> = {
        manifest,
        packages: [{ manifest: { id: 'com.example.acme.service', name: 'service', namespace: 'acme', version: '2.4.0', type: 'module' } }],
    };
    for (const type of types) stack[singularToPlural(type)] = [{ ...BODIES[type] }];
    return { ...manifest, ...stack };
}

const kernels: ObjectKernel[] = [];
afterEach(async () => {
    for (const kernel of kernels.splice(0)) await kernel.shutdown().catch(() => {});
});

async function boot(types: readonly string[]) {
    const engine = new ObjectQL();
    const { driver, stores } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin({ ql: engine, registerProtocol: false }));
    await kernel.use({
        name: 'test.residual-security-stack',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            // The queue and assignment-rule boot check asks for the service, never calls it.
            ctx.registerService(OWNERSHIP_QUEUE_SERVICE, {});
            engine.registry.registerObject(sysMetadataObject, 'test-package');
            for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
                engine.registry.registerObject(o as any, 'test-package');
            }
            await ctx.getService<{ register(m: unknown): Promise<void> }>('manifest').register(residualStack(types));
        },
    } as Plugin);
    await kernel.bootstrap();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), undefined);
    const storedRows = () => Array.from(stores.get('sys_metadata')?.values() ?? []);
    return { engine, protocol, storedRows };
}

describe('[ADR-0130 D4, ADR-0131 D6] a residual top-level security rule is sealed like a body\'s', () => {
    it('the population is read from the registry, and every member has a fixture', () => {
        expect(SECURITY_NON_OVERRIDABLE).toEqual(expect.arrayContaining(['permission', 'position', 'capability']));
        for (const type of SECURITY_NON_OVERRIDABLE) {
            expect(BODIES[type], `no fixture body for security type '${type}'`).toBeDefined();
        }
    });

    it.each(SECURITY_NON_OVERRIDABLE)('a residual %s is registered under the stack\'s manifest id', async (type) => {
        const { engine } = await boot([type]);
        const artifact = engine.registry.getArtifactItem<any>(type, NAME);
        expect(artifact?._packageId).toBe(RELEASE_ID);
        expect(artifact?._packageVersion).toBe('1.0.0');
    });

    it.each(SECURITY_NON_OVERRIDABLE)('a save over a residual %s is refused 403 NOT_OVERRIDABLE and stores nothing', async (type) => {
        const { protocol, storedRows } = await boot([type]);
        const err: any = await protocol
            .saveMetaItem({ type, name: NAME, item: { ...BODIES[type], label: 'Environment fork' } })
            .then(() => undefined, (e: unknown) => e);
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(storedRows()).toHaveLength(0);
    });

    it('the by-name read after the refusal serves the declared permission set', async () => {
        const { protocol } = await boot(['permission']);
        await protocol
            .saveMetaItem({ type: 'permission', name: NAME, item: { ...BODIES.permission, label: 'Environment fork' } })
            .catch(() => undefined);
        const read: any = await protocol.getMetaItem({ type: 'permission', name: NAME });
        expect(read?.item?.label).toBe('Probe');
    });

    it('CONTROL: a position the stack does not declare still saves (the allowRuntimeCreate tier)', async () => {
        const { protocol, storedRows } = await boot(['position']);
        const result: any = await protocol.saveMetaItem({
            type: 'position', name: 'env_only_position', item: { name: 'env_only_position', label: 'Env only' },
        });
        expect(result?.success).toBe(true);
        expect(storedRows().map((r: any) => `${r.type}/${r.name}`)).toEqual(['position/env_only_position']);
    });
});
