// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The five overlay-enabled metadata types keep their ENVIRONMENT overlay: a
 * packaged item of each can be overlaid environment-wide, the overlay is stored
 * with no organization, it is what the item's read then serves, and
 * `GET /meta/types` tells Studio the type is writable.
 *
 * ## Why this file exists (#22340, stage S1)
 *
 * The registry flag that opens these writes, `allowOrgOverride`, is about to
 * change twice: #15206 rewrites the write doors and deletes the per-organization
 * overlay path that also reads it, and #22340 then renames the flag to say what
 * it will mean, "may an environment overlay this packaged item". Neither change
 * may lose an environment overlay, and before this file that was checkable for
 * part of the population only. So every case here is the ENVIRONMENT path and
 * nothing else: no `organizationId` reaches any call, the protocol has no
 * organization of its own, and the item is one a code package ships. The
 * per-organization path can be deleted under these cases without moving one.
 *
 * ## What is pinned, per type and on both topologies
 *
 *   1. the write — `saveMetaItem` over the packaged item is accepted, stores
 *      exactly one row, the row names no organization, and the item's read
 *      serves the body that was written;
 *   2. the read of a stored overlay — a stored environment-wide row is served
 *      by `getMetaItem`. The row is put in the store directly, so this leg asks
 *      the read alone, with no write door in front of it: a row stored before a
 *      flag change keeps being served whatever the flag then says;
 *   3. the wire — `getMetaTypes` advertises the flag `true` for the type, from
 *      the registry and not from the `OS_METADATA_WRITABLE` hatch.
 *
 * And the identity: the registry types whose flag is `true` are exactly these
 * five. The population below is written out, NOT read from the registry, so
 * that a type leaving the flag fails its own cases by name instead of silently
 * dropping out of them.
 *
 * ## The harness
 *
 * The real `ObjectQL` engine and its `SchemaRegistry`, the real
 * `ObjectStackProtocolImplementation` over it, and an in-memory driver (the
 * shape of `engine-security-catalog-package-door.test.ts`, which this file
 * follows). Two topologies, because the write is refused at different layers
 * on each: an environment kernel (`environmentId` set) and a host-config
 * kernel (none). Four of the packaged items arrive through the manifest's own
 * stack collections (`views`, `dashboards`, `reports`, `emailTemplates`), the
 * seam that stamps package provenance. `translation` has no such collection:
 * a stack's `translations:` are i18n bundles, and neither the engine's
 * collection list nor the metadata artifact door carries the type. Its
 * packaged item is registered through the registry's own package seam,
 * `registerItem(type, item, 'name', packageId)`, which is the one
 * `isArtifactBacked` reads.
 *
 * ## Pins that already exist elsewhere, and are not restated here
 *
 *   - view: the dispatcher PUT (`runtime/src/meta-field-overlay-lock.test.ts`),
 *     the package-door verdict
 *     (`metadata-protocol/src/protocol.packaged-base-refusal.test.ts`), the
 *     repository write
 *     (`metadata-protocol/src/sys-metadata-repository.package-writability.test.ts`),
 *     and the wire flag on a mock engine (`protocol-meta-types-rich.test.ts`).
 *   - dashboard: the dispatcher PUT (`runtime/src/meta-field-overlay-lock.test.ts`).
 *   - email_template: the save over a packaged template on both topologies,
 *     as the control of `engine-security-catalog-package-door.test.ts`.
 *   - report, translation: none.
 *
 * Each of those pins one layer of one type. What this file adds is the
 * environment round trip for all five on one harness: the row's organization,
 * the served body and the wire flag, none of which those pins read.
 *
 * No dispatcher case is added in `packages/runtime`: for an environment-wide
 * write (a `manage_metadata` session with no active organization) the
 * dispatcher reads the flag nowhere — its two readers, the
 * `manage_org_presentation` capability verdict and `organizationIdForMetaWrite`,
 * answer only for a session with an active organization, which is the
 * per-organization path — and it hands this same request to `saveMetaItem`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const PKG = 'com.acme.overlay_catalog';
const PACKAGED_LABEL = 'Packaged';
const OVERLAY_LABEL = 'Environment overlay';

/** The population, written out: the five types whose registry flag opens an environment overlay. */
const OVERLAY_ENABLED = ['view', 'dashboard', 'report', 'translation', 'email_template'] as const;
type OverlayType = (typeof OVERLAY_ENABLED)[number];

/**
 * Per type: the packaged item's name, and its body with a given label. The
 * view is the expanded item of the manifest's container below
 * (`<object>.<listViews key>`), which is the item Studio edits.
 */
const ITEMS: Record<OverlayType, { name: string; body: (label: string) => Record<string, unknown> }> = {
    view: {
        name: 'probe_obj.probe_list',
        body: (label) => ({
            name: 'probe_obj.probe_list',
            object: 'probe_obj',
            viewKind: 'list',
            label,
            config: { type: 'grid', data: { provider: 'object', object: 'probe_obj' }, columns: [{ field: 'name' }] },
        }),
    },
    dashboard: {
        name: 'probe_dashboard',
        body: (label) => ({ name: 'probe_dashboard', label, widgets: [] }),
    },
    report: {
        name: 'probe_report',
        // A report binds a dataset that resolves; the manifest ships it.
        body: (label) => ({
            name: 'probe_report', label, type: 'summary', dataset: 'probe_metrics', rows: ['month'], values: ['amount_sum'],
        }),
    },
    translation: {
        name: 'probe_translation',
        body: (label) => ({ name: 'probe_translation', label, locale: 'zh-CN', messages: { probeSave: '保存' } }),
    },
    email_template: {
        name: 'probe_email',
        body: (label) => ({ name: 'probe_email', label, subject: 'Probe', bodyHtml: '<p>Probe</p>' }),
    },
};

/** The package: every type but `translation` through its own stack collection. */
function overlayCatalogManifest(): Record<string, unknown> {
    return {
        id: PKG,
        name: 'overlay_catalog',
        views: [{
            object: 'probe_obj',
            listViews: {
                probe_list: {
                    label: PACKAGED_LABEL,
                    type: 'grid',
                    data: { provider: 'object', object: 'probe_obj' },
                    columns: [{ field: 'name' }],
                },
            },
        }],
        dashboards: [ITEMS.dashboard.body(PACKAGED_LABEL)],
        datasets: [{
            name: 'probe_metrics',
            label: 'Probe Metrics',
            object: 'probe_obj',
            dimensions: [{ name: 'month', label: 'Month', field: 'created_at', type: 'date' }],
            measures: [{ name: 'amount_sum', label: 'Amount', aggregate: 'sum', field: 'amount' }],
        }],
        reports: [ITEMS.report.body(PACKAGED_LABEL)],
        emailTemplates: [ITEMS.email_template.body(PACKAGED_LABEL)],
    };
}

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

/** In-memory driver, copied from `engine-security-catalog-package-door.test.ts`; equality-only WHERE. */
function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them.
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
    engine.registerApp(overlayCatalogManifest());
    engine.registry.registerItem('translation', ITEMS.translation.body(PACKAGED_LABEL), 'name', PKG);
    // No organization anywhere: the protocol is built without one, and no
    // call below passes one.
    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        topology === 'environment-scoped' ? 'env_prod' : undefined,
    );
    const rowsOf = (type: string, name: string) => Array.from(stores.get('sys_metadata')?.values() ?? [])
        .filter((r) => r.type === type && r.name === name);
    /**
     * A stored ACTIVE environment-wide overlay row, written into the store the
     * way the repository's write lays one down (no organization, no package
     * binding, the body as JSON), with no write door in front of it.
     */
    const storeEnvironmentRow = (type: string, name: string, body: Record<string, unknown>) =>
        driver.create('sys_metadata', {
            type, name, organization_id: null, package_id: null,
            metadata: JSON.stringify(body), state: 'active', version: 1,
        });
    return { engine, protocol, rowsOf, storeEnvironmentRow };
}

// The operator hatch also opens a type's overlay, and a value left in the
// environment would answer for a registry flag this file pins. Cleared for
// every case and restored after it.
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

describe('the five overlay-enabled types keep their environment overlay of a packaged item', () => {
    it('the registry opens an overlay on exactly these five types', () => {
        const flagged = DEFAULT_METADATA_TYPE_REGISTRY
            .filter((entry) => entry.allowOrgOverride === true)
            .map((entry) => entry.type)
            .sort();
        expect(flagged).toEqual([...OVERLAY_ENABLED].sort());
    });

    for (const topology of TOPOLOGIES) {
        it.each(OVERLAY_ENABLED)(`${topology}: a save over the packaged %s is accepted, stored with no organization, and served back`, async (type) => {
            const { engine, protocol, rowsOf } = await boot(topology);
            const { name, body } = ITEMS[type];
            // Only an overlay if a package ships the item it lands on.
            expect(engine.registry.getArtifactItem<any>(type, name)?._packageId).toBe(PKG);

            const result: any = await protocol
                .saveMetaItem({ type, name, item: body(OVERLAY_LABEL) })
                .catch((e: any) => ({ refused: { code: e?.code, status: e?.status } }));

            expect(result).toMatchObject({ success: true });
            const rows = rowsOf(type, name);
            expect(rows).toHaveLength(1);
            // NULL is how the repository writes "no organization" today; a
            // tenant-less row with no such column reads the same here.
            expect(rows[0].organization_id ?? null).toBeNull();
            const read: any = await protocol.getMetaItem({ type, name });
            expect(read?.item?.label).toBe(OVERLAY_LABEL);
        });

        it.each(OVERLAY_ENABLED)(`${topology}: a stored environment-wide overlay of the packaged %s is what its read serves`, async (type) => {
            const { protocol, storeEnvironmentRow } = await boot(topology);
            const { name, body } = ITEMS[type];
            // Control: before the row exists the read serves the package's item,
            // so the label below can only come from the stored overlay.
            const before: any = await protocol.getMetaItem({ type, name });
            expect(before?.item?.label).toBe(PACKAGED_LABEL);

            await storeEnvironmentRow(type, name, body(OVERLAY_LABEL));

            const read: any = await protocol.getMetaItem({ type, name });
            expect(read?.item?.label).toBe(OVERLAY_LABEL);
        });
    }

    it.each(OVERLAY_ENABLED)('GET /meta/types advertises %s as overlay-writable, from the registry', async (type) => {
        const { protocol } = await boot('environment-scoped');

        const result: any = await protocol.getMetaTypes();
        const entry = result?.entries?.find((e: any) => e.type === type);

        expect(entry).toMatchObject({ allowOrgOverride: true, overrideSource: 'registry' });
    });
});
