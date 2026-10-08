// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22203] Every package-declared item of a `security`-domain type that the
 * type registry declares `allowOrgOverride: false` is refused at the metadata
 * save door — and the refusal is the type-level one, fed by the provenance
 * seam, not a lock written for one type.
 *
 * ## What was wrong, measured
 *
 * The save door's packaged-base check is already type-level: it refuses a write
 * onto an item a code package ships when the type has no overlay channel
 * (`refusePackagedBaseOverride` in `saveMetaItem` on an environment-scoped
 * kernel, `SysMetadataRepository.assertAllowed`'s `override-artifact` intent on
 * a host-config one), and both read `allowOrgOverride` off
 * `DEFAULT_METADATA_TYPE_REGISTRY`. What decides "a code package ships it" is
 * `isArtifactBacked`, which asks this engine's SchemaRegistry for an entry a
 * package registered (`getArtifactItem`, `_packageId` provenance).
 *
 * The only seam that puts a stack collection into that registry under its
 * package is `registerMetadataCollections` over `METADATA_ARRAY_KEYS`. That list
 * carried `permissions` and `capabilities`, and the retired `roles` instead of
 * `positions` (ADR-0090 D3 renamed the collection; the rename reached the
 * artifact door's map and never this one). So a stack-declared position had no
 * registry entry, `isArtifactBacked('position', name)` answered false, the save
 * took the `runtime-only` intent, and `allowRuntimeCreate: true` let it through:
 * `PUT /api/v1/meta/position/NAME` over a package's position answered 200 and
 * the saved row then won the by-name read. A permission set was refused on the
 * same door because its collection was on the list.
 *
 * ## What this file pins
 *
 * The set under test is ENUMERATED FROM THE REGISTRY, not written out: every
 * `domain: 'security'` row with `allowOrgOverride: false`. For each, a real
 * `ObjectQL` registers a manifest that declares one item through the type's
 * stack collection, and a real `ObjectStackProtocolImplementation` over that
 * engine is asked to save over it — on both topologies, because the two answer
 * at different layers. The rejection is asserted on the envelope (`code` +
 * `status`), and nothing may be stored.
 *
 * No security plugin is composed here, so the permission-set refusal below is
 * the protocol's own type-level door, not plugin-security's packaged
 * permission-set lock (which stays a stricter layer on top of it).
 *
 * Controls, so the refusals cannot pass for the wrong reason: a position no
 * package declares still saves (the `allowRuntimeCreate` tier is untouched); an
 * `allowOrgOverride: true` type still saves over its packaged item; and the
 * by-name read after a refusal still serves the package's declaration.
 */

import { describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { singularToPlural } from '@objectstack/spec/shared';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const PKG = 'com.acme.security_catalog';
const NAME = 'probe_item';

/** The pin's population, read off the registry: every non-overridable `security` type. */
const SECURITY_NON_OVERRIDABLE = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((entry) => entry.domain === 'security' && entry.allowOrgOverride === false)
    .map((entry) => entry.type);

/**
 * A schema-valid body per type. A type that joins the population without one
 * fails the first case below by name, rather than dropping out of the pin.
 */
const BODIES: Record<string, Record<string, unknown>> = {
    permission: { name: NAME, label: 'Probe', objects: {} },
    position: { name: NAME, label: 'Probe' },
    capability: { name: NAME, label: 'Probe' },
};

/** The overlayable control: `allowOrgOverride: true`, declared through a stack collection. */
const OVERLAYABLE_TYPE = 'email_template';
const OVERLAYABLE_BODY = { name: NAME, label: 'Probe', subject: 'Probe', bodyHtml: '<p>Probe</p>' };

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
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

/** One manifest declaring `NAME` through every security collection under test, plus the control. */
function securityManifest(): Record<string, unknown> {
    const manifest: Record<string, unknown> = { id: PKG, name: 'security_catalog' };
    for (const type of SECURITY_NON_OVERRIDABLE) {
        if (BODIES[type]) manifest[singularToPlural(type)] = [BODIES[type]];
    }
    manifest[singularToPlural(OVERLAYABLE_TYPE)] = [OVERLAYABLE_BODY];
    return manifest;
}

type Topology = 'environment-scoped' | 'host-config';
const TOPOLOGIES: readonly Topology[] = ['environment-scoped', 'host-config'];

async function boot(topology: Topology) {
    const engine = new ObjectQL();
    const { driver, stores } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(securityManifest());
    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        topology === 'environment-scoped' ? 'env_prod' : undefined,
    );
    const storedRows = () => Array.from(stores.get('sys_metadata')?.values() ?? []);
    return { engine, protocol, storedRows };
}

describe('[#22203] security-domain allowOrgOverride:false — the package door is type-level', () => {
    it('the population is read from the registry, and every member has a fixture', () => {
        // The three the registry declares today. Asserted as a superset so a
        // fourth `security` type joins the pin instead of breaking it — and the
        // per-type loop below then demands a body for it by name.
        expect(SECURITY_NON_OVERRIDABLE).toEqual(expect.arrayContaining(['permission', 'position', 'capability']));
        for (const type of SECURITY_NON_OVERRIDABLE) {
            expect(BODIES[type], `no fixture body for security type '${type}'`).toBeDefined();
        }
    });

    it.each(SECURITY_NON_OVERRIDABLE)('the provenance seam registers a stack-declared %s under its package', async (type) => {
        const { engine } = await boot('host-config');
        // The input `isArtifactBacked` reads: an entry a package registered.
        const artifact = engine.registry.getArtifactItem<any>(type, NAME);
        expect(artifact?._packageId).toBe(PKG);
        expect(artifact?._provenance).toBe('package');
    });

    for (const topology of TOPOLOGIES) {
        it.each(SECURITY_NON_OVERRIDABLE)(`${topology}: a save over a package-declared %s is refused 403 NOT_OVERRIDABLE and stores nothing`, async (type) => {
            const { protocol, storedRows } = await boot(topology);

            const err: any = await protocol
                .saveMetaItem({ type, name: NAME, item: { ...BODIES[type], label: 'Environment fork' } })
                .then(() => undefined, (e: unknown) => e);

            expect({ code: err?.code, status: err?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expect(storedRows()).toHaveLength(0);
        });
    }

    it('the by-name read after the refusal still serves the package\'s position', async () => {
        const { protocol } = await boot('host-config');
        await protocol
            .saveMetaItem({ type: 'position', name: NAME, item: { name: NAME, label: 'Environment fork' } })
            .catch(() => undefined);

        const read: any = await protocol.getMetaItem({ type: 'position', name: NAME });
        expect(read?.item?.label).toBe('Probe');
    });

    // ── controls ─────────────────────────────────────────────────────────

    it.each(TOPOLOGIES)('%s: a position no package declares still saves (the allowRuntimeCreate tier)', async (topology) => {
        const { protocol, storedRows } = await boot(topology);

        const result: any = await protocol.saveMetaItem({
            type: 'position', name: 'env_only_position', item: { name: 'env_only_position', label: 'Env only' },
        });

        expect(result?.success).toBe(true);
        expect(storedRows().map((r: any) => `${r.type}/${r.name}`)).toEqual(['position/env_only_position']);
    });

    it.each(TOPOLOGIES)(`%s: an allowOrgOverride:true type (${OVERLAYABLE_TYPE}) still saves over its packaged item`, async (topology) => {
        const entry = DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === OVERLAYABLE_TYPE);
        expect(entry?.allowOrgOverride).toBe(true);
        const { engine, protocol, storedRows } = await boot(topology);
        // The control is only a control if its item is package-declared too.
        expect(engine.registry.getArtifactItem<any>(OVERLAYABLE_TYPE, NAME)?._packageId).toBe(PKG);

        const result: any = await protocol.saveMetaItem({
            type: OVERLAYABLE_TYPE, name: NAME, item: { ...OVERLAYABLE_BODY, label: 'Environment overlay' },
        });

        expect(result?.success).toBe(true);
        expect(storedRows().map((r: any) => `${r.type}/${r.name}`)).toEqual([`${OVERLAYABLE_TYPE}/${NAME}`]);
    });
});
