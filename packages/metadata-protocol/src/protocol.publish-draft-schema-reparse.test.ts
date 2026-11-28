// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the fake engine below
// cannot accept a call ObjectQL refuses (`check:engine-double-contract`).
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, hashSpec } from '@objectstack/metadata-core';
import { ObjectSchema } from '@objectstack/spec/data';
// The draft verdict reaches `import('@objectstack/lint')`; paid at collection,
// never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/** Does row `r` satisfy `where` (top-level eq + `$or`)? */
function matchesMetadataWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesMetadataWhere(r, c))) return false;
            continue;
        }
        // `undefined` = "dimension not constrained"; `null` = "must be NULL".
        if (v === undefined) continue;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            const op = v as Record<string, unknown>;
            if ('$in' in op) {
                if (!(op.$in as unknown[]).includes((r as any)[k])) return false;
                continue;
            }
            if ('$ne' in op) {
                if ((r as any)[k] === op.$ne) return false;
                continue;
            }
        }
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

/** The package whose objects are saved and published here. */
const PKG = 'com.acme.alpha';
const NS = 'crm';

function makeStubEngine() {
    const rows = new Map<string, Row>();
    let nextId = 0;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) if (matchesMetadataWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const manifests: Record<string, Record<string, unknown>> = {
        [PKG]: { id: PKG, namespace: NS },
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = Array.from(rows.values()).filter((r) => matchesMetadataWhere(r, opts.where ?? {}));
            // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            if (table !== 'sys_metadata') return { id: `x_${nextId}` };
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            if (table !== 'sys_metadata') return { deleted: 0 };
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            getPackage: (id: string) => (manifests[id] ? { manifest: manifests[id] } : undefined),
            getAllPackages: () => Object.values(manifests).map((manifest) => ({ manifest })),
        },
    };
    return { engine, rows };
}

/**
 * A sealed audit-class object whose default chain column `tenant_id` is a
 * declared lookup — the body the ADR-0154 D10 chain-column refinement admits.
 */
const sealedLedger = (name: string) => ({
    name,
    label: `Ledger ${name}`,
    sharingModel: 'private',
    fields: {
        action: { type: 'text', label: 'Action' },
        old_value: { type: 'textarea', label: 'Old Value' },
        tenant_id: { type: 'lookup', reference: 'sys_organization', label: 'Organization' },
    },
    lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['old_value'] } },
});

/**
 * The same object as stored before that refinement landed: no `tenant_id`, so
 * the current `ObjectSchema` refuses it.
 */
const preRefinementLedger = (name: string) => {
    const body = sealedLedger(name);
    const { tenant_id: _dropped, ...fields } = body.fields;
    return { ...body, fields };
};

/**
 * Overwrites the stored draft row's body in place: the draft a save wrote
 * before the refinement that now refuses it, with the checksum the store
 * would have written for it.
 */
function rewriteStoredDraft(rows: Map<string, Row>, name: string, body: unknown) {
    const row = [...rows.values()].find((r) => r.type === 'object' && r.name === name && r.state === 'draft');
    if (!row) throw new Error(`no stored draft of object/${name}`);
    row.metadata = JSON.stringify(body);
    row.checksum = hashSpec(body, 'object');
}

const rowsFor = (rows: Map<string, Row>, name: string) =>
    Array.from(rows.values())
        .filter((r) => r.type === 'object' && r.name === name)
        .map((r) => ({ state: r.state, package_id: r.package_id }));

/** The ADR-0154 D10 default-chain-column refusal, located as the spec raises it. */
const defaultChainIssue = (outcome: unknown) =>
    ((outcome as { issues?: Array<{ path: string }> }).issues ?? []).filter((i) => i.path.startsWith('lifecycle.seal'));

/** Saves a valid draft, then rewrites its stored body as `stored`. */
async function stagePreRefinementDraft(protocol: ObjectStackProtocolImplementation, rows: Map<string, Row>, name: string, stored: unknown) {
    await protocol.saveMetaItem({ type: 'object', name, item: sealedLedger(name), packageId: PKG, mode: 'draft' });
    rewriteStoredDraft(rows, name, stored);
}

/**
 * [#35924] An object draft stored before a narrowing `ObjectSchema`
 * refinement landed is judged by it at publish.
 *
 * Measured on `origin/main` before the fix (this file's pins, unfixed): the
 * per-item publish of the pre-refinement draft answered `success: true` and
 * the package publish `outcome: 'published'`, each writing the active row —
 * while the save door refuses the same body `422 INVALID_METADATA`. The
 * promotion re-ran the save door's other refusals on the stored draft and
 * never the schema parse.
 *
 * The "draft saved before the refinement" is made by saving a body the
 * current schema admits and rewriting the stored row to the body a store
 * held from before ADR-0154 D10's chain-column rule (no `tenant_id`); the
 * row's checksum is the one the store would have written for it.
 *
 * Harness: the real save, publish and repository paths over a stub engine
 * whose write verbs are held to ObjectQL's own dispatch decisions.
 */
describe('[#35924] the publish judges an object draft by the current ObjectSchema', () => {
    it('PREMISE — the fixtures straddle the refinement: one parses, the other is refused', () => {
        expect(ObjectSchema.safeParse(sealedLedger('crm_ledger')).success).toBe(true);
        expect(ObjectSchema.safeParse(preRefinementLedger('crm_ledger')).success).toBe(false);
    });

    it('the save door refuses the pre-refinement body — INVALID_METADATA / 422, nothing stored', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const name = 'crm_ledger';
        const outcome = await protocol.saveMetaItem({ type: 'object', name, item: preRefinementLedger(name), packageId: PKG, mode: 'draft' })
            .then(() => 'saved', (e: unknown) => e);
        expect(outcome).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(defaultChainIssue(outcome)).not.toEqual([]);
        expect(rowsFor(rows, name)).toEqual([]);
    });

    it('the per-item publish refuses that draft with the save door\'s envelope; the draft stays a draft', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const name = 'crm_ledger';
        await stagePreRefinementDraft(protocol, rows, name, preRefinementLedger(name));

        const saved = await protocol.saveMetaItem({ type: 'object', name, item: preRefinementLedger(name), packageId: PKG, mode: 'draft' })
            .then(() => 'saved', (e: unknown) => e);
        const outcome = await protocol.publishMetaItem({ type: 'object', name, packageId: PKG })
            .then(() => 'published', (e: unknown) => e);

        expect(outcome).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        // The same findings the save door raises for the same body.
        expect(defaultChainIssue(outcome)).toEqual(defaultChainIssue(saved));
        expect(defaultChainIssue(outcome)).not.toEqual([]);
        expect(rowsFor(rows, name)).toEqual([{ state: 'draft', package_id: PKG }]);
    });

    it('the package publish refuses it into failed[] with nothing promoted', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const name = 'crm_ledger';
        await stagePreRefinementDraft(protocol, rows, name, preRefinementLedger(name));

        const res: any = await protocol.publishPackageDrafts({ packageId: PKG } as any);

        expect(res).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0, failedCount: 1 });
        expect(res.failed[0]).toMatchObject({ type: 'object', name, code: 'INVALID_METADATA' });
        expect(rowsFor(rows, name)).toEqual([{ state: 'draft', package_id: PKG }]);
    });
});

describe('[#35924] what the publish still promotes', () => {
    it('CONTROL — a fresh valid draft publishes per item, as before', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const name = 'crm_ledger';
        await protocol.saveMetaItem({ type: 'object', name, item: sealedLedger(name), packageId: PKG, mode: 'draft' });

        expect(await protocol.publishMetaItem({ type: 'object', name, packageId: PKG })).toMatchObject({ success: true });
        expect(rowsFor(rows, name)).toEqual([{ state: 'active', package_id: PKG }]);
    });

    it('CONTROL — a fresh valid draft publishes with its package, as before', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const name = 'crm_ledger';
        await protocol.saveMetaItem({ type: 'object', name, item: sealedLedger(name), packageId: PKG, mode: 'draft' });

        expect(await protocol.publishPackageDrafts({ packageId: PKG } as any))
            .toMatchObject({ success: true, outcome: 'published', publishedCount: 1, failedCount: 0 });
        expect(rowsFor(rows, name)).toEqual([{ state: 'active', package_id: PKG }]);
    });

    it('CONTROL — a draft stored in a spelling the ADR-0087 chain converts still publishes: it is judged as served', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const name = 'crm_ledger';
        // `externalSharingModel` is tombstoned on the object shape (a live
        // author is refused at parse) and stripped from a stored row by the
        // chain (`object-external-sharing-model-removed`).
        const legacy = { ...sealedLedger(name), externalSharingModel: 'private' };
        expect(ObjectSchema.safeParse(legacy).success).toBe(false);
        await stagePreRefinementDraft(protocol, rows, name, legacy);

        expect(await protocol.publishMetaItem({ type: 'object', name, packageId: PKG })).toMatchObject({ success: true });
        expect(rowsFor(rows, name)).toEqual([{ state: 'active', package_id: PKG }]);
    });
});
