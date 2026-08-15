// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * Regression for #8907 — `publishPackageDrafts` promotes (and drains) ANOTHER
 * package's draft row.
 *
 * Root cause: `publishPackageDrafts` lists the package's drafts with
 * `repo.listDrafts({ packageId })` — a `package_id = :packageId` filter — then
 * promotes each listed row through `promoteDraftForPublish` →
 * `repo.promoteDraft`. `promoteDraft` re-resolved the row it was about to
 * promote with `whereFor(ref, 'draft')`, which OMITS the `package_id`
 * dimension. ADR-0048 keys overlay rows by `(org, type, name, package_id)`
 * precisely so two installed packages shipping the same name each keep their
 * OWN row, so that lookup cannot distinguish them: publishing `app.demo`
 * promoted whichever `(type, name)` draft the driver returned first.
 *
 * Measured consequence (the card's reproduction): publishing `app.demo`
 * promoted **app.other's** pending draft to active, drained THAT package's
 * draft row, recorded it under app.demo's ADR-0067 commit — and left app.demo's
 * own edit pending, while answering `success: true`.
 *
 * ## Why this fixture pins the defect rather than passing by luck
 *
 * Which of the two rows wins is DRIVER-ORDER DEPENDENT — `findOne` has no
 * defined order without an `ORDER BY` — so a fixture that happened to resolve
 * the right row would prove nothing. The ordering is therefore made
 * deterministic HERE, and the fixture is built so the WRONG row is the one the
 * pre-fix code selects:
 *
 *   - the stub's `findRow` falls back to an insertion-ordered scan exactly when
 *     `package_id` is absent from the `where` (which is the pre-fix promote's
 *     lookup), and returns the FIRST match;
 *   - `app.other`'s draft is therefore saved FIRST, so the package-agnostic
 *     lookup lands on it and not on the package being published.
 *
 * The first case asserts that precondition explicitly, so a future change to
 * insertion order fails loudly instead of silently draining the fixture's
 * discriminating power.
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

// Overlay rows are keyed by (type, name, org, state, package_id) — the ADR-0048
// key — so two packages' drafts for the SAME (type, name) coexist as distinct
// rows. That coexistence is the whole precondition of this defect.
function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/** Does row `r` satisfy `where` (top-level eq + `$or` + `organization_id IS NULL`)? */
function matchesMetadataWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesMetadataWhere(r, c))) return false;
            continue;
        }
        // `undefined` = "dimension not constrained"; `null` = "must be NULL".
        if (v === undefined) continue;
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
        // Exact-key lookup when the caller SCOPED the read by package. When
        // `package_id` is absent (the pre-fix promote's "match any package"
        // lookup) fall back to an insertion-ordered scan returning the FIRST
        // match — the deterministic stand-in for a real driver's undefined
        // `findOne` order, and what makes the wrong row win below.
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
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matchesHistory(h, opts.where));
            }
            return Array.from(rows.values()).filter((r) => matchesMetadataWhere(r, opts.where));
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
            // No declared package namespace → publishPackageDrafts skips the
            // ADR-0028 prefix check (legacy-grandfathered path).
            getPackage: () => undefined,
        },
    };
    return { engine, rows, historyRows };
}

/**
 * Two packages ship the SAME object name. `label` is the marker that says which
 * package's body a row is carrying — the fact the assertions turn on.
 *
 * [#8308] Authored OWD: the publish gate refuses an OWD-less custom object
 * (`security-owd-unset`).
 */
const objectBody = (name: string, label: string) => ({
    name,
    label,
    sharingModel: 'private',
    fields: {
        title: { type: 'text', label: 'Title' },
    },
});

const draftRowsOf = (rows: Map<string, Row>) =>
    Array.from(rows.values()).filter((r) => r.state === 'draft');
const activeRowsOf = (rows: Map<string, Row>) =>
    Array.from(rows.values()).filter((r) => r.state === 'active');
const labelOf = (r: Row) => (JSON.parse(r.metadata) as { label?: string }).label;

/** Save the two colliding drafts, `app.other` FIRST — see the file header. */
async function seedTwoPackageDrafts(protocol: ObjectStackProtocolImplementation) {
    await protocol.saveMetaItem({
        type: 'object',
        name: 'shared_ticket',
        item: objectBody('shared_ticket', 'FROM_OTHER'),
        packageId: 'app.other',
        mode: 'draft',
    });
    await protocol.saveMetaItem({
        type: 'object',
        name: 'shared_ticket',
        item: objectBody('shared_ticket', 'FROM_DEMO'),
        packageId: 'app.demo',
        mode: 'draft',
    });
}

describe('publishPackageDrafts — two packages holding drafts for one (type, name) (#8907)', () => {
    it('parks both drafts as distinct ADR-0048 rows, with the OTHER package first in scan order', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedTwoPackageDrafts(protocol);

        const drafts = draftRowsOf(rows);
        expect(drafts).toHaveLength(2);
        // The precondition the two cases below depend on: a package-agnostic
        // scan hits `app.other` FIRST, so resolving without the package
        // dimension selects the row that is NOT being published.
        expect(drafts.map((r) => r.package_id)).toEqual(['app.other', 'app.demo']);
        expect(drafts.map(labelOf)).toEqual(['FROM_OTHER', 'FROM_DEMO']);
    });

    it('promotes the PUBLISHING package own draft, not the first row that shares the name', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedTwoPackageDrafts(protocol);

        const res = await protocol.publishPackageDrafts({ packageId: 'app.demo' });

        expect(res.failed).toEqual([]);
        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });

        // Before the fix the active row carried `package_id: 'app.other'` and
        // the body labelled FROM_OTHER — app.other's unreviewed pending change,
        // published under app.demo's commit.
        const active = activeRowsOf(rows);
        expect(active).toHaveLength(1);
        expect(active[0].package_id).toBe('app.demo');
        expect(labelOf(active[0])).toBe('FROM_DEMO');
    });

    it('drains the published package own draft and leaves the other package draft pending', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedTwoPackageDrafts(protocol);
        await protocol.publishPackageDrafts({ packageId: 'app.demo' });

        // Exactly one draft survives, and it is the one nobody published.
        // Before the fix this was inverted: app.other's row was drained and
        // app.demo's edit stayed pending while the response said "published".
        const drafts = draftRowsOf(rows);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].package_id).toBe('app.other');
        expect(labelOf(drafts[0])).toBe('FROM_OTHER');
    });

    it('still publishes a lone package-bound draft (no regression)', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'object',
            name: 'solo_ticket',
            item: objectBody('solo_ticket', 'SOLO'),
            packageId: 'app.demo',
            mode: 'draft',
        });

        const res = await protocol.publishPackageDrafts({ packageId: 'app.demo' });

        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(draftRowsOf(rows)).toHaveLength(0);
        const active = activeRowsOf(rows);
        expect(active).toHaveLength(1);
        expect(active[0].package_id).toBe('app.demo');
        expect(labelOf(active[0])).toBe('SOLO');
    });
});
