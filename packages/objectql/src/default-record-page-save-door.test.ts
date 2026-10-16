// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One default record page per object per deployment — the metadata save door
 * (maintainer ruling A on #23015, record 6134056653; `saveMetaItem`'s
 * `defaultRecordPageSaveRefusal`).
 *
 * A `page` saved as the default record page of an object another page already
 * holds — a page a package ships, or a page already stored — is refused 422
 * `DEFAULT_RECORD_PAGE_CONFLICT`, naming both, and nothing is stored. Run on
 * the real engine, registry and protocol over an in-memory driver, on both
 * topologies: a host-config kernel writes a saved page through into the
 * registry, an environment-scoped kernel does not, so there the stored rows are
 * the only record of the environment's pages and the door must read them.
 *
 * The controls keep the refusal as narrow as the ruling: a save under the
 * existing default's own name (an overlay by name) stays accepted; so do a
 * non-default record page, a default for another object, an `isDefault` page
 * that is not a record page, and the demote-then-promote sequence. A save under
 * a PACKAGED page's own name is answered by the packaged-base refusal
 * (`NOT_OVERRIDABLE` 403), unchanged and never by this one.
 */

import { describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const PKG = 'com.acme.auth';

/** A record page; `object` and `isDefault` are what a case varies. */
const recordPage = (name: string, object: string, isDefault = true, extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    type: 'record',
    object,
    isDefault,
    regions: [],
    ...extra,
});

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        // The bundled type's member (#22877) — `sys-metadata.object.ts` declares
        // it, and an `email_template` write keys its row by it.
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

type Topology = 'environment-scoped' | 'host-config';
const TOPOLOGIES: readonly Topology[] = ['environment-scoped', 'host-config'];

/** The package ships the default record page of `acme_org`. */
async function boot(topology: Topology) {
    const engine = new ObjectQL();
    const { driver, stores } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp({ id: PKG, name: 'auth', pages: [recordPage('acme_org_detail', 'acme_org')] });
    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        topology === 'environment-scoped' ? 'env_prod' : undefined,
    );
    const storedPages = () =>
        Array.from(stores.get('sys_metadata')?.values() ?? [])
            .filter((r: any) => r.type === 'page')
            .map((r: any) => r.name)
            .sort();
    const save = (name: string, item: Record<string, unknown>) =>
        protocol.saveMetaItem({ type: 'page', name, item }).then(
            (result: any) => ({ ok: true as const, result }),
            (error: any) => ({ ok: false as const, error }),
        );
    /** A stored ACTIVE environment page row, laid in the store directly — no write door in front of it. */
    const storeRow = (name: string, body: Record<string, unknown>) =>
        driver.create('sys_metadata', {
            type: 'page', name, organization_id: null, package_id: null,
            metadata: JSON.stringify(body), state: 'active', version: 1,
        });
    return { engine, protocol, storedPages, save, storeRow };
}

/** The envelope, the object and both pages of one refusal, by its first sentence. */
function expectRefusal(outcome: { ok: boolean; error?: any }, saved: string, object: string, holder: string) {
    expect(outcome.ok, 'the save was refused').toBe(false);
    const err = outcome.error;
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'DEFAULT_RECORD_PAGE_CONFLICT', status: 422 });
    expect(err.object).toBe(object);
    expect(String(err.message).split('. ')[0]).toBe(
        `Default record page conflict: page '${saved}' cannot be saved as the default record page of object `
        + `'${object}': ${holder} already is`,
    );
}

describe.each(TOPOLOGIES)('%s kernel — a page saved as a second default record page', (topology) => {
    it('is refused over a page a package ships, naming both, and stores nothing', async () => {
        const { save, storedPages } = await boot(topology);
        const outcome = await save('env_org_detail', recordPage('env_org_detail', 'acme_org'));
        expectRefusal(outcome, 'env_org_detail', 'acme_org', `page 'acme_org_detail' of package '${PKG}'`);
        expect(String((outcome as { error?: any }).error?.message)).toContain(
            "Save 'env_org_detail' with `isDefault: false`: a page a package ships stays the default unless the deployment "
            + "is composed without that package's page.",
        );
        expect(storedPages()).toEqual([]);
    });

    it('is refused over a page the environment already stored, naming it', async () => {
        const { save, storedPages } = await boot(topology);
        expect((await save('env_task_a', recordPage('env_task_a', 'acme_task'))).ok).toBe(true);
        const outcome = await save('env_task_b', recordPage('env_task_b', 'acme_task'));
        expectRefusal(outcome, 'env_task_b', 'acme_task', "page 'env_task_a', authored in this environment");
        expect(String((outcome as { error?: any }).error?.message)).toContain(
            "Save 'env_task_b' with `isDefault: false`, or first save 'env_task_a' with `isDefault: false` to make "
            + "'env_task_b' the default instead.",
        );
        expect(storedPages()).toEqual(['env_task_a']);
    });

    it('a draft is judged again when it is published: another page took the default in between', async () => {
        const { protocol, save } = await boot(topology);
        const draft = await protocol
            .saveMetaItem({ type: 'page', name: 'env_task_a', item: recordPage('env_task_a', 'acme_task'), mode: 'draft' })
            .then(() => true, (e: any) => e);
        expect(draft, String(draft?.message)).toBe(true);
        expect((await save('env_task_b', recordPage('env_task_b', 'acme_task'))).ok).toBe(true);
        const published = await protocol.publishMetaItem({ type: 'page', name: 'env_task_a' }).then(
            (result: any) => ({ ok: true as const, result }),
            (error: any) => ({ ok: false as const, error }),
        );
        expect(published.ok, 'the publish was refused').toBe(false);
        const err = (published as { error: any }).error;
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'DEFAULT_RECORD_PAGE_CONFLICT', status: 422 });
        expect(String(err.message).split('. ')[0]).toBe(
            "Default record page conflict: page 'env_task_a' cannot be published as the default record page of object "
            + "'acme_task': page 'env_task_b', authored in this environment already is",
        );
    });

    it('a page that leaves `type` out is a record page, and is refused too', async () => {
        const { save } = await boot(topology);
        const { type: _omit, ...untyped } = recordPage('env_org_detail', 'acme_org');
        expectRefusal(await save('env_org_detail', untyped), 'env_org_detail', 'acme_org', `page 'acme_org_detail' of package '${PKG}'`);
    });

    // ── controls ─────────────────────────────────────────────────────────

    it('control: a save under the existing default\'s own name (an overlay by name) stays accepted', async () => {
        const { save, storedPages } = await boot(topology);
        expect((await save('env_task_a', recordPage('env_task_a', 'acme_task'))).ok).toBe(true);
        const again = await save('env_task_a', recordPage('env_task_a', 'acme_task', true, { label: 'Renamed' }));
        expect(again.ok, String((again as any).error?.message)).toBe(true);
        expect(storedPages()).toEqual(['env_task_a']);
    });

    it('control: the packaged default\'s own name answers the packaged-base refusal, unchanged, never this one', async () => {
        const { save } = await boot(topology);
        const outcome = await save('acme_org_detail', recordPage('acme_org_detail', 'acme_org'));
        expect(outcome.ok).toBe(false);
        expect({ code: (outcome as any).error?.code, status: (outcome as any).error?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
    });

    it('control: a non-default record page for the object saves', async () => {
        const { save, storedPages } = await boot(topology);
        const outcome = await save('env_org_detail', recordPage('env_org_detail', 'acme_org', false));
        expect(outcome.ok, String((outcome as any).error?.message)).toBe(true);
        expect(storedPages()).toEqual(['env_org_detail']);
    });

    it('control: a default record page for another object saves', async () => {
        const { save } = await boot(topology);
        const outcome = await save('env_env_detail', recordPage('env_env_detail', 'acme_env'));
        expect(outcome.ok, String((outcome as any).error?.message)).toBe(true);
    });

    it('an isDefault page that is not a record page holds no default — the page parse refuses its flag (#23610), and nothing is stored', async () => {
        const { save, storedPages } = await boot(topology);
        const outcome = await save('env_home', { name: 'env_home', label: 'Home', type: 'home', isDefault: true, regions: [] });
        expect(outcome.ok, 'the save was refused').toBe(false);
        const err = (outcome as { error: any }).error;
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(String(err.message)).toContain("`isDefault: true` is refused on a `type: 'home'` page");
        expect(storedPages()).toEqual([]);
    });

    it('control: the same home page without the flag saves', async () => {
        const { save } = await boot(topology);
        const outcome = await save('env_home', { name: 'env_home', label: 'Home', type: 'home', regions: [] });
        expect(outcome.ok, String((outcome as any).error?.message)).toBe(true);
    });

    it('control: demote the stored default, then the new page may be the default', async () => {
        const { save, storedPages } = await boot(topology);
        expect((await save('env_task_a', recordPage('env_task_a', 'acme_task'))).ok).toBe(true);
        expect((await save('env_task_a', recordPage('env_task_a', 'acme_task', false))).ok).toBe(true);
        const promoted = await save('env_task_b', recordPage('env_task_b', 'acme_task'));
        expect(promoted.ok, String((promoted as any).error?.message)).toBe(true);
        expect(storedPages()).toEqual(['env_task_a', 'env_task_b']);
    });
});

// #23610 (maintainer ruling A on Q1 and Q2, record 6190536588) — the save door
// is the page parse's: a non-record page's `isDefault: true`, the retired
// `full-width` template and a region the template does not place are each
// refused 422 `INVALID_METADATA` at save. A row ALREADY stored in one of those
// shapes is read back through the stored-row conversion chain (the read path
// never refuses it): the two shapes with a lossless rewrite come back
// CONVERTED — the retired D2 entries `page-is-default-off-record-page-removed`
// and `page-template-full-width-to-default` delete the flag and re-spell the
// template — while the unplaced region, which has no lossless rewrite, is
// served as stored. Saving the row as it was stored is refused until it is
// fixed, whichever way it reads back. `served` is what the read answers for
// the keys the shape varies.
const PLACEMENT_SHAPES: ReadonlyArray<[label: string, body: Record<string, unknown>, says: string, served: Record<string, unknown>]> = [
    ['a home page with `isDefault: true`', { name: 'env_shape', label: 'Shape', type: 'home', isDefault: true, regions: [] }, '`isDefault: true` is refused', { isDefault: undefined, regions: [] }],
    ['the retired `full-width` template', { name: 'env_shape', label: 'Shape', type: 'record', object: 'acme_task', template: 'full-width', regions: [{ name: 'main', components: [] }] }, "`template: 'full-width'` was removed", { template: 'default', regions: [{ name: 'main', components: [] }] }],
    ['a `left_sidebar` region on `three-column`', { name: 'env_shape', label: 'Shape', type: 'home', template: 'three-column', regions: [{ name: 'left_sidebar', components: [] }, { name: 'main', components: [] }] }, 'Region `left_sidebar` is refused', { template: 'three-column', regions: [{ name: 'left_sidebar', components: [] }, { name: 'main', components: [] }] }],
];

describe.each(TOPOLOGIES)('%s kernel — the page parse at the save door, and rows stored before it (#23610)', (topology) => {
    it.each(PLACEMENT_SHAPES)('%s: the save is refused 422 INVALID_METADATA, and nothing is stored', async (_label, body, says) => {
        const { save, storedPages } = await boot(topology);
        const outcome = await save('env_shape', body);
        expect(outcome.ok, 'the save was refused').toBe(false);
        const err = (outcome as { error: any }).error;
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(String(err.message)).toContain(says);
        expect(storedPages()).toEqual([]);
    });

    it.each(PLACEMENT_SHAPES)('%s, ALREADY stored: the read serves the row through the stored-row conversion chain, and saving it as stored is refused', async (_label, body, _says, served) => {
        const { protocol, save, storeRow } = await boot(topology);
        await storeRow('env_shape', body);
        const read: any = await protocol.getMetaItem({ type: 'page', name: 'env_shape' });
        expect(read?.item?.name).toBe('env_shape');
        for (const [key, value] of Object.entries(served)) {
            expect(read.item[key], key).toEqual(value);
        }
        const again = await save('env_shape', body);
        expect(again.ok, 'the re-save was refused').toBe(false);
        expect((again as { error: any }).error?.status).toBe(422);
    });
});
