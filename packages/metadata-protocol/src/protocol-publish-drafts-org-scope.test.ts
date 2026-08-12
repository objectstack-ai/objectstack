// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright — which is why all 26
// of this package's (file, verb) pairs sat in the gate's DEBT ledger until
// #5619 sank the two predicates into a package both sides already depend on.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * Regression for #3115 — `publish-drafts` fails with `no_draft` after saving a
 * draft via Studio UI.
 *
 * Root cause (a cross-layer org-scope asymmetry):
 *
 *   • Studio's "Save Draft" goes through REST `PUT /meta/:type/:name?mode=draft`,
 *     which does NOT thread the session's `activeOrganizationId` into
 *     `saveMetaItem` — so the draft row is written env-wide
 *     (`organization_id = NULL`).
 *   • "Publish" goes through `POST /packages/:id/publish-drafts`, which DOES
 *     resolve `activeOrganizationId` (non-null when the session carries a
 *     default org) and passes it to `publishPackageDrafts`.
 *   • `listDrafts` was taught (PR #1852) to surface env-wide drafts to a
 *     non-null-org caller via `$or [{org}, {org IS NULL}]`, so the Publish CTA
 *     appears — but `promoteDraft` still looked the draft up with a STRICT
 *     `organization_id = <org>` equality and 404'd (`no_draft`) on the
 *     env-wide row it could never match.
 *
 * The fix promotes each listed draft in the org scope it actually lives in
 * (the scope `listDrafts` surfaced it from), so the pending-changes list and
 * the publish path agree.
 *
 * These tests exercise the REAL `listDrafts` + `promoteDraft` interaction
 * against a faithful multi-table stub engine (honours `$or` and
 * `organization_id IS NULL`), reproducing the exact save-env-wide /
 * publish-under-org mismatch.
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
// key — so an env-wide draft and an org-scoped active row for the same identity
// can coexist without colliding.
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
        // Exact-key lookups (findOne on a fully-qualified ref). When package_id
        // is not part of the where (promote's whereFor omits it → "match any
        // package"), fall back to a scan.
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

const objectBody = (name: string) => ({
    name,
    label: 'Project Task',
    fields: {
        title: { type: 'text', label: 'Title' },
        done: { type: 'boolean', label: 'Done' },
    },
});

/** [#6190] The org-scoped specimen — `view` is `allowOrgOverride: true`, so it
 *  is a type that legitimately carries per-org rows. See the third case. */
const viewBody = (name: string) => ({
    name,
    label: 'Project Tasks',
    object: 'proj_task',
    viewKind: 'list', // [#7741] the inline arm requires the object binding pair
    columns: [{ field: 'title', label: 'Title' }],
});

describe('publishPackageDrafts — env-wide draft under a non-null active org (#3115)', () => {
    it('saves the object draft env-wide (organization_id = NULL) when no org is threaded', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        // Mirrors REST `PUT /meta/object/proj_task?mode=draft&package=app.projects`
        // — package bound, but no organizationId threaded.
        await protocol.saveMetaItem({
            type: 'object',
            name: 'proj_task',
            item: objectBody('proj_task'),
            packageId: 'app.projects',
            mode: 'draft',
        });

        const draftRows = Array.from(rows.values()).filter((r) => r.state === 'draft');
        expect(draftRows).toHaveLength(1);
        expect(draftRows[0].organization_id).toBeNull();
        expect(draftRows[0].package_id).toBe('app.projects');
    });

    it('publishes the env-wide draft even though the session carries a non-null active org', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        // 1. Studio "Save Draft" — env-wide (no active org threaded).
        await protocol.saveMetaItem({
            type: 'object',
            name: 'proj_task',
            item: objectBody('proj_task'),
            packageId: 'app.projects',
            mode: 'draft',
        });

        // 2. Studio "Publish" — the dispatcher resolved a non-null active org.
        const res = await protocol.publishPackageDrafts({
            packageId: 'app.projects',
            organizationId: 'org_alpha',
        });

        // Before the fix this returned { success:false, failedCount:1,
        // failed:[{ code:'NO_DRAFT' }] }.
        expect(res.failed).toEqual([]);
        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(res.published.map((p) => p.name)).toEqual(['proj_task']);

        // The draft was consumed and the active row landed env-wide
        // (package-owned metadata is env-level, not per-org).
        const remaining = Array.from(rows.values());
        expect(remaining.filter((r) => r.state === 'draft')).toHaveLength(0);
        const active = remaining.filter((r) => r.state === 'active');
        expect(active).toHaveLength(1);
        expect(active[0].organization_id).toBeNull();
    });

    it('still publishes an org-scoped draft under that same org (no regression)', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        // A per-org overlay draft (organization_id = org_alpha).
        //
        // [#6190, 2026-08-09] Re-spelled from `object` to `view`. The org-scope
        // resolution this case guards (#3115 — promote the draft in the scope
        // `listDrafts` surfaced it from) is unchanged and is what is measured
        // here; what changed is which TYPES may carry an org-scoped row at all.
        // `object` is `allowOrgOverride: false`, so since the #6190 ruling its
        // org-scoped draft cannot be written in the first place — a fixture
        // that kept spelling it would have been pinning a write the platform
        // refuses, i.e. nothing. `view` is `allowOrgOverride: true`: it HAS a
        // per-org channel, its org rows ARE read back, and it therefore
        // exercises the #3115 seam exactly as `object` used to.
        await protocol.saveMetaItem({
            type: 'view',
            name: 'proj_task_grid',
            item: viewBody('proj_task_grid'),
            organizationId: 'org_alpha',
            packageId: 'app.projects',
            mode: 'draft',
        });

        const res = await protocol.publishPackageDrafts({
            packageId: 'app.projects',
            organizationId: 'org_alpha',
        });

        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        const active = Array.from(rows.values()).filter((r) => r.state === 'active');
        expect(active).toHaveLength(1);
        expect(active[0].organization_id).toBe('org_alpha');
    });
});
