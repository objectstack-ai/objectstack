// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28661 — a roll-up the engine would refuse at every recompute is refused at
 * the object write door: an object saved active, a draft published (one item
 * or the package's drafts), and the draft's own `_diagnostics`.
 *
 * ## The defect, measured on `origin/main` before this file was written
 *
 * A `summary` field whose `summaryOperations` is `sum` (or `avg`) over a child
 * TEXT field saved 200, its draft read `_diagnostics: { valid: true }`, and
 * `publish-drafts` answered `published`. From then on every create, update
 * and delete of the child answered 500 although each write had landed: the
 * recompute's `engine.aggregate` refuses the pair after the commit. A roll-up
 * naming a child object that does not exist (`qsf_nope`) published the same
 * way and read nothing for good. `os lint` judged neither; no door did.
 *
 * ## What is pinned
 *
 * - The active save and both publish doors refuse `sum` / `avg` over a text
 *   child field with 422 `INVALID_METADATA`, the rule id and the name-keyed
 *   path of the field; a `sum` over a number field is admitted.
 * - The draft still SAVES (#4463 D1), and its read reports the publish's
 *   verdict.
 * - A child object that exists nowhere is refused the same way; a child that
 *   is a draft published in the same package publish is not.
 *
 * Harness: the package-aware stub engine of `protocol.draft-publish-verdict.test.ts`
 * (kept local, the established shape). Nothing on the save, read or publish
 * path is stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** The LIVE child object: the card's `qsf_child`, with a text and a number field. */
const liveChildObject = {
    name: 'qsf_child',
    label: 'Child',
    sharingModel: 'controlled_by_parent',
    fields: {
        name: { type: 'text', label: 'Name' },
        memo: { type: 'text', label: 'Memo' },
        amount: { type: 'number', label: 'Amount' },
        parent: { type: 'master_detail', label: 'Parent', reference: 'qsf_parent', required: true, deleteBehavior: 'cascade' },
    },
};

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
    updated_at?: string;
    created_at?: string;
}

interface HistoryRow {
    id: string;
    event_seq: number;
    name: string;
    type: string;
    version: number;
    operation_type: string;
    metadata: string | null;
    checksum: string | null;
    previous_checksum: string | null;
    change_note?: string | null;
    source?: string | null;
    organization_id: string | null;
    recorded_by?: string | null;
    recorded_at: string;
}

// Overlay rows are keyed by (type, name, org, state, package_id) — the ADR-0048 key.
function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function matchesMetadataWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesMetadataWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        // The active read asks `type: { $in: [type, plural] }`; no other
        // operator reaches this stub.
        if (v && typeof v === 'object' && Array.isArray((v as { $in?: unknown }).$in)) {
            if (!(v as { $in: unknown[] }).$in.includes((r as any)[k])) return false;
            continue;
        }
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    let nextId = 0;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            return r ? { key: k, row: r } : null;
        }
        for (const [k, r] of rows) if (matchesMetadataWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean => {
        if (w.organization_id !== undefined && h.organization_id !== w.organization_id) return false;
        if (w.type !== undefined && h.type !== w.type) return false;
        if (w.name !== undefined && h.name !== w.name) return false;
        if (w.version !== undefined && h.version !== w.version) return false;
        if (w.operation_type !== undefined && h.operation_type !== w.operation_type) return false;
        return true;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
            const matched = table === 'sys_metadata_history'
                ? historyRows.filter((h) => matchesHistory(h, opts.where))
                : Array.from(rows.values()).filter((r) => matchesMetadataWhere(r, opts.where));
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h: HistoryRow = { id: `h_${nextId}`, ...(data as any) };
                historyRows.push(h);
                return { id: h.id };
            }
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
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
            // The LIVE universe: the child object every roll-up below names.
            listItems: (type: string) => (type === 'object' ? [liveChildObject] : []),
            // The base the drafts are bound to is INSTALLED — a flow may be
            // saved only into a package the registry holds (#20863) — and its
            // manifest declares no namespace → the ADR-0028 prefix pre-flight is
            // skipped (legacy-grandfathered path); it declares no dependencies
            // and no live object carries a package stamp, so
            // `resolveWritePackageScope`'s closure removes nothing.
            getPackage: (id: string) => (id === PKG ? { manifest: { id: PKG } } : undefined),
        },
    };
    return { engine, rows, historyRows };
}

const PKG = 'app.qsf';

/** The card's parent: a valid `child_sum`, and the `probe_sf` roll-up under test. */
const parentWith = (probe: Record<string, unknown>) => ({
    name: 'qsf_parent',
    label: 'Parent',
    sharingModel: 'private',
    fields: {
        name: { type: 'text', label: 'Name' },
        child_sum: { type: 'summary', label: 'Child Sum', summaryOperations: { object: 'qsf_child', function: 'sum', field: 'amount' } },
        probe_sf: { type: 'summary', label: 'Probe', summaryOperations: probe },
    },
});

const saveActive = (protocol: ObjectStackProtocolImplementation, item: { name: string }) =>
    (protocol as any).saveMetaItem({ type: 'object', name: item.name, item, packageId: PKG });

const saveDraft = (protocol: ObjectStackProtocolImplementation, item: { name: string }) =>
    (protocol as any).saveMetaItem({ type: 'object', name: item.name, item, packageId: PKG, mode: 'draft' });

const refusalOf = (p: Promise<unknown>): Promise<any> => p.then(() => null, (e: unknown) => e);

const draftDiagnostics = async (protocol: ObjectStackProtocolImplementation, name: string) => {
    const read: any = await protocol.getMetaItem({ type: 'object', name, state: 'draft', packageId: PKG } as any);
    return read.item._diagnostics as { valid: boolean; errors?: Array<{ path: string; message: string; code?: string }> };
};

const AGGREGAND_PATH = 'objects.qsf_parent.fields.probe_sf.summaryOperations.field';
const CHILD_OBJECT_PATH = 'objects.qsf_parent.fields.probe_sf.summaryOperations.object';

describe('a roll-up over a field the engine does not aggregate is refused at the object door (#28661)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    for (const fn of ['sum', 'avg']) {
        it(`${fn} over a text child field: the active save refuses it 422, naming the field path and the route`, async () => {
            const { engine, rows } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            const refusal = await refusalOf(saveActive(protocol, parentWith({ object: 'qsf_child', function: fn, field: 'memo' })));

            expect({ code: refusal?.code, status: refusal?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            const issue = refusal.issues.find((i: any) => i.rule === 'rollup/non-numeric-aggregand');
            expect(issue, JSON.stringify(refusal.issues)).toBeDefined();
            expect(issue.path).toBe(AGGREGAND_PATH);
            expect(issue.message).toContain(`${fn}(qsf_child.memo), a text field`);
            expect(issue.hint).toContain("or use function: 'count'");
            // Refused before anything is stored.
            expect([...rows.values()].filter((r) => r.name === 'qsf_parent')).toEqual([]);
        });

        it(`${fn} over a text child field: the draft saves, reads valid:false, and both publish doors refuse it`, async () => {
            const { engine, rows } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            const saved = await saveDraft(protocol, parentWith({ object: 'qsf_child', function: fn, field: 'memo' }));
            expect(saved).toMatchObject({ success: true, state: 'draft' });

            const diagnostics = await draftDiagnostics(protocol, 'qsf_parent');
            expect(diagnostics.valid).toBe(false);
            expect((diagnostics.errors ?? []).map((e) => [e.code, e.path])).toContainEqual([
                'rollup/non-numeric-aggregand', 'fields.probe_sf.summaryOperations.field',
            ]);

            const one = await refusalOf(protocol.publishMetaItem({ type: 'object', name: 'qsf_parent', packageId: PKG } as any));
            expect({ code: one?.code, status: one?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            expect(one.issues.map((i: any) => [i.rule, i.path])).toContainEqual(['rollup/non-numeric-aggregand', AGGREGAND_PATH]);

            const batch: any = await protocol.publishPackageDrafts({ packageId: PKG });
            expect(batch.outcome).not.toBe('published');
            expect(batch).toMatchObject({ success: false, publishedCount: 0, failedCount: 1 });
            const failed = batch.failed.find((f: any) => f.name === 'qsf_parent');
            expect(failed?.code).toBe('INVALID_METADATA');
            expect(JSON.stringify(failed)).toContain('rollup/non-numeric-aggregand');
            expect(JSON.stringify(failed)).toContain(AGGREGAND_PATH);
            expect([...rows.values()].filter((r) => r.name === 'qsf_parent').map((r) => r.state)).toEqual(['draft']);
        });
    }

    it('sum over a number child field is admitted on every door (the control)', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const body = parentWith({ object: 'qsf_child', function: 'sum', field: 'amount' });

        await expect(saveActive(protocol, body)).resolves.toMatchObject({ success: true });

        const fresh = new ObjectStackProtocolImplementation(makeStubEngine().engine);
        await saveDraft(fresh, body);
        expect((await draftDiagnostics(fresh, 'qsf_parent')).valid).toBe(true);
        const batch: any = await fresh.publishPackageDrafts({ packageId: PKG });
        expect(batch).toMatchObject({ outcome: 'published', publishedCount: 1, failedCount: 0 });
    });
});

describe('a roll-up from a child object the deployment does not have is refused at the object door (#28661)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    const nope = () => parentWith({ object: 'qsf_nope', function: 'sum', field: 'amount' });

    it('the active save refuses it 422 at the object key', async () => {
        const protocol = new ObjectStackProtocolImplementation(makeStubEngine().engine);
        const refusal = await refusalOf(saveActive(protocol, nope()));
        expect({ code: refusal?.code, status: refusal?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(refusal.issues.map((i: any) => [i.rule, i.path])).toContainEqual(['rollup/unknown-child-object', CHILD_OBJECT_PATH]);
    });

    it('the draft saves, reads valid:false, and the package publish refuses it', async () => {
        const protocol = new ObjectStackProtocolImplementation(makeStubEngine().engine);
        await expect(saveDraft(protocol, nope())).resolves.toMatchObject({ success: true, state: 'draft' });
        const diagnostics = await draftDiagnostics(protocol, 'qsf_parent');
        expect(diagnostics.valid).toBe(false);
        expect((diagnostics.errors ?? []).map((e) => e.code)).toContain('rollup/unknown-child-object');
        const batch: any = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(batch).toMatchObject({ success: false, publishedCount: 0 });
        expect(JSON.stringify(batch.failed)).toContain('rollup/unknown-child-object');
    });

    it('a child that is a draft of the same package publish is not refused — the natural authoring order', async () => {
        const protocol = new ObjectStackProtocolImplementation(makeStubEngine().engine);
        const draftChild = { ...liveChildObject, name: 'qsf_line', fields: { ...liveChildObject.fields } };
        await saveDraft(protocol, parentWith({ object: 'qsf_line', function: 'sum', field: 'amount' }));
        await saveDraft(protocol, draftChild);
        expect((await draftDiagnostics(protocol, 'qsf_parent')).valid).toBe(true);
        const batch: any = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(batch, JSON.stringify(batch.failed)).toMatchObject({ outcome: 'published', publishedCount: 2, failedCount: 0 });
    });
});
