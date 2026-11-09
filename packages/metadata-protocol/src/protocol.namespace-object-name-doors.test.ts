// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the fake engine below
// cannot accept a call ObjectQL refuses (`check:engine-double-contract`).
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { findNamespaceObjectNameClashes } from '@objectstack/spec/kernel';
// The draft verdict reaches `import('@objectstack/lint')`; paid at collection,
// never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * [ADR-0150 D6, child K] A namespace never equals an object name, and no
 * object is short-named `custom` (`NS_custom`) — at every Studio door that
 * makes an object live under a package: the publish-mode save, the per-item
 * publish, the batch publish's pre-flight (`publishPackageDrafts`), and the
 * draft's verdict that tells the author ahead of all three.
 *
 * The object's name is judged against every installed package's namespace
 * (the object's own package excluded) and against its own package's
 * `NS_custom`, by the spec's predicate (`findNamespaceObjectNameClashes`).
 * Each refusal is `NAMESPACE_CONFLICT` / 422 — the install door's code for the
 * same rule — and carries the predicate's sentence, naming both spellings.
 *
 * The other direction — a NEW namespace equal to an object name — lands
 * through `SchemaRegistry.installPackage` (an authored package's create
 * reaches it), pinned in `@objectstack/objectql` and at `POST /packages` in
 * `@objectstack/runtime`.
 */

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
/** An installed package whose namespace is `crm_lead`. */
const OTHER = 'com.acme.beta';
const OTHER_NS = 'crm_lead';

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
        [OTHER]: { id: OTHER, namespace: OTHER_NS },
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

const objectBody = (name: string) => ({
    name,
    label: `Object ${name}`,
    // [#8308] Authored OWD — the authoring gate refuses an OWD-less custom object.
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

const rowsFor = (rows: Map<string, Row>, name: string) =>
    Array.from(rows.values())
        .filter((r) => r.type === 'object' && r.name === name)
        .map((r) => ({ state: r.state, package_id: r.package_id }));

/** The predicate's own sentence for an object of PKG equal to OTHER's namespace. */
const [EQUALS_INSTALLED] = findNamespaceObjectNameClashes(
    { objects: [{ name: OTHER_NS, namespace: NS, packageId: PKG }] },
    { namespaces: [{ namespace: OTHER_NS, packageId: OTHER }] },
);

const stageDraft = (protocol: ObjectStackProtocolImplementation, name: string) =>
    protocol.saveMetaItem({ type: 'object', name, item: objectBody(name), packageId: PKG, mode: 'draft' });

describe('[ADR-0150 D6 · K] the Studio object doors refuse a name equal to an installed namespace', () => {
    it('the publish-mode save refuses it — NAMESPACE_CONFLICT / 422, both spellings, nothing written', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        const outcome = await protocol.saveMetaItem({
            type: 'object', name: OTHER_NS, item: objectBody(OTHER_NS), packageId: PKG,
        }).then(() => 'saved', (e: unknown) => e);

        expect(outcome).toMatchObject({ code: 'NAMESPACE_CONFLICT', status: 422 });
        expect((outcome as Error).message).toBe(EQUALS_INSTALLED.message);
        expect((outcome as Error).message).toContain(`The object '${OTHER_NS}' of package '${PKG}'`);
        expect((outcome as Error).message).toContain(`installed namespace '${OTHER_NS}' of package '${OTHER}'`);
        expect(rowsFor(rows, OTHER_NS)).toEqual([]);
    });

    it('the per-item publish refuses that draft with the same envelope and sentence; the draft stays a draft', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, OTHER_NS);

        const outcome = await protocol.publishMetaItem({ type: 'object', name: OTHER_NS, packageId: PKG })
            .then(() => 'published', (e: unknown) => e);

        expect(outcome).toMatchObject({ code: 'NAMESPACE_CONFLICT', status: 422 });
        expect((outcome as Error).message).toBe(EQUALS_INSTALLED.message);
        expect(rowsFor(rows, OTHER_NS)).toEqual([{ state: 'draft', package_id: PKG }]);
    });

    it('the batch publish refuses it in its pre-flight, nothing promoted, and the draft\'s verdict tells the same sentence', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, OTHER_NS);

        const res: any = await protocol.publishPackageDrafts({ packageId: PKG } as any);
        expect(res).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0, failedCount: 1 });
        expect(res.failed[0]).toMatchObject({ type: 'object', name: OTHER_NS, code: 'NAMESPACE_CONFLICT', error: EQUALS_INSTALLED.message });
        expect(rowsFor(rows, OTHER_NS)).toEqual([{ state: 'draft', package_id: PKG }]);

        const diagnostics = ((await protocol.getMetaItem({ type: 'object', name: OTHER_NS, state: 'draft', packageId: PKG } as any)) as any)
            .item._diagnostics as { valid: boolean; errors?: Array<{ code?: string; message: string }> };
        expect(diagnostics.valid).toBe(false);
        expect(diagnostics.errors?.filter((e) => e.code === 'NAMESPACE_CONFLICT').map((e) => e.message))
            .toEqual([EQUALS_INSTALLED.message]);
    });

    it('an object short-named `custom` (NS_custom) is refused at the save, and the batch pre-flight names every offending draft', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const name = `${NS}_custom`;

        const saved = await protocol.saveMetaItem({ type: 'object', name, item: objectBody(name), packageId: PKG })
            .then(() => 'saved', (e: unknown) => e);
        expect(saved).toMatchObject({ code: 'NAMESPACE_CONFLICT', status: 422 });
        expect((saved as Error).message).toContain("short-named 'custom'");
        expect(rowsFor(rows, name)).toEqual([]);

        // Two offending drafts in one batch: the PRE-FLIGHT names both with
        // the rule's code (the promotion would stop at the first and call the
        // second `BATCH_ABORTED`).
        await stageDraft(protocol, name);
        await stageDraft(protocol, OTHER_NS);
        const res: any = await protocol.publishPackageDrafts({ packageId: PKG } as any);
        expect(res).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0, failedCount: 2 });
        expect(res.failed.map((f: any) => [f.name, f.code]).sort()).toEqual([
            [name, 'NAMESPACE_CONFLICT'],
            [OTHER_NS, 'NAMESPACE_CONFLICT'],
        ]);
    });
});

describe('[ADR-0150 D6 · K] what the Studio object doors still accept', () => {
    it('CONTROL — an object only STARTING with an installed namespace saves, publishes and reads valid', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const name = `${OTHER_NS}_note`;

        await protocol.saveMetaItem({ type: 'object', name, item: objectBody(name), packageId: PKG });
        expect(rowsFor(rows, name)).toEqual([{ state: 'active', package_id: PKG }]);

        const draft = `${NS}_custom_field`;
        await stageDraft(protocol, draft);
        const diagnostics = ((await protocol.getMetaItem({ type: 'object', name: draft, state: 'draft', packageId: PKG } as any)) as any)
            .item._diagnostics;
        expect(diagnostics).toEqual({ valid: true });
        expect(await protocol.publishPackageDrafts({ packageId: PKG } as any)).toMatchObject({ success: true, failedCount: 0 });
    });

    it('CONTROL — an object\'s own package is never a second holder of its namespace', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        // OTHER's own object carries OTHER's prefix: `crm_lead_x` under `crm_lead`.
        const name = `${OTHER_NS}_x`;
        await protocol.saveMetaItem({ type: 'object', name, item: objectBody(name), packageId: OTHER });
        expect(rowsFor(rows, name)).toEqual([{ state: 'active', package_id: OTHER }]);
    });

    it('CONTROL — an unprefixed name keeps its NAMESPACE_PREFIX refusal (the prefix rule answers first)', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const outcome = await protocol.saveMetaItem({ type: 'object', name: 'report', item: objectBody('report'), packageId: PKG })
            .then(() => 'saved', (e: unknown) => e);
        expect(outcome).toMatchObject({ code: 'NAMESPACE_PREFIX', status: 422 });
    });
});
