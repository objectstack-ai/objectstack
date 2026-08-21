// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10219 B — the PER-ITEM publish door could not SEE a draft the batch door
 * published fine.
 *
 * Measured on a cloud rig: four `view` drafts sitting at `state='draft'` in
 * `sys_metadata`, listed by the console's pending-changes banner and promoted
 * by its one-click "publish 4 changes" button, were each refused per item with
 * `404 [no_draft] No pending draft exists for view/... — nothing to publish.`
 *
 * `view` is `allowOrgOverride: true`, so the REST seam threads the session's
 * active organization into the publish (`organizationIdForMetaWrite`); the
 * drafts were authored env-wide (`organization_id = NULL`), which is what
 * package/AI authoring writes, and a strict `organization_id = <org>` lookup can
 * never match them. `object` and `flow` are NOT org-overridable, which is why
 * per-item publish worked for them and failed for views.
 *
 * That is the single-item twin of #3115, which the batch door fixed by promoting
 * each draft in the scope `listDrafts` surfaced it FROM. The per-item door now
 * DISCOVERS the draft's scope the same way, with the ADR-0005 precedence.
 *
 * Harness: the faithful multi-table stub engine used by
 * `protocol-publish-drafts-org-scope.test.ts` / `-advisories.test.ts` (kept
 * local — self-contained harnesses are the established shape here, so two
 * tripwires fail independently). Nothing on the publish path is stubbed: the
 * REAL `publishMetaItem` / `publishPackageDrafts` run.
 */

import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import type { MetaItemPublishedEvent } from './protocol.js';

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
            // No declared package namespace → the ADR-0028 prefix check is
            // skipped (legacy-grandfathered path).
            getPackage: () => undefined,
        },
    };
    return { engine, rows, historyRows };
}

const PKG = 'app.ops';

/** `view` is `allowOrgOverride: true` — the org-overridable specimen of case B. */
const viewBody = (name: string) => ({
    name,
    label: 'Customers',
    object: 'customer',
    viewKind: 'list', // [#7741] the inline arm requires the object binding pair
    columns: [{ field: 'name', label: 'Name' }],
});

describe('publishMetaItem resolves the draft\'s OWN org scope (#10219 B, the single-item #3115)', () => {
    it('publishes an env-wide `view` draft although the session carries an active org', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        // Authored env-wide — what package/AI authoring writes, and what
        // `PUT ?mode=draft` writes with no active org threaded.
        await protocol.saveMetaItem({
            type: 'view', name: 'customer_list', item: viewBody('customer_list'),
            packageId: PKG, mode: 'draft',
        });

        // `POST /meta/view/customer_list/publish` from a session with an active
        // org: `view` is org-overridable, so the REST seam threads it. Before the
        // fix this answered 404 `[no_draft]`.
        const res = await protocol.publishMetaItem({
            type: 'view', name: 'customer_list', organizationId: 'org_alpha', actor: 'admin',
        });

        expect(res.success).toBe(true);
        const remaining = Array.from(rows.values());
        expect(remaining.filter((r) => r.state === 'draft')).toHaveLength(0);
        const active = remaining.filter((r) => r.state === 'active');
        expect(active).toHaveLength(1);
        // Promoted in the scope it was authored in — NOT copied into the org.
        expect(active[0]!.organization_id).toBeNull();
    });

    it('reports the promotion under the scope it landed in, so the notification is not a lie', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const seen: MetaItemPublishedEvent[] = [];
        protocol.onMetaItemPublished((evt) => { seen.push(evt); });

        await protocol.saveMetaItem({
            type: 'view', name: 'customer_list', item: viewBody('customer_list'),
            packageId: PKG, mode: 'draft',
        });
        await protocol.publishMetaItem({
            type: 'view', name: 'customer_list', organizationId: 'org_alpha', actor: 'admin',
        });

        expect(seen).toEqual([
            { type: 'view', name: 'customer_list', organizationId: null },
        ]);
    });

    it('PRECEDENCE — an org that has its own draft publishes THAT one, not the env-wide row', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'view', name: 'customer_list', item: { ...viewBody('customer_list'), label: 'Env wide' },
            packageId: PKG, mode: 'draft',
        });
        await protocol.saveMetaItem({
            type: 'view', name: 'customer_list', item: { ...viewBody('customer_list'), label: 'Org alpha' },
            organizationId: 'org_alpha', packageId: PKG, mode: 'draft',
        });

        await protocol.publishMetaItem({
            type: 'view', name: 'customer_list', organizationId: 'org_alpha', actor: 'admin',
        });

        // The ADR-0005 overlay order: the caller's own org shadows env-wide.
        const active = Array.from(rows.values()).filter((r) => r.state === 'active');
        expect(active).toHaveLength(1);
        expect(active[0]!.organization_id).toBe('org_alpha');
        expect(JSON.parse(active[0]!.metadata).label).toBe('Org alpha');
        // The env-wide draft is untouched — it was never this publish's subject.
        const drafts = Array.from(rows.values()).filter((r) => r.state === 'draft');
        expect(drafts).toHaveLength(1);
        expect(drafts[0]!.organization_id).toBeNull();
    });

    it('CONTROL — a genuinely absent draft still refuses with NO_DRAFT / 404', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'view', name: 'customer_list', item: viewBody('customer_list'),
            packageId: PKG,
        });

        await expect(
            protocol.publishMetaItem({
                type: 'view', name: 'customer_list', organizationId: 'org_alpha', actor: 'admin',
            }),
        ).rejects.toMatchObject({ code: 'NO_DRAFT', status: 404 });
    });
});
