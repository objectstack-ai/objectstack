// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10219 A — the PER-ITEM publish door (`publishMetaItem`, i.e.
 * `POST /api/v1/meta/:type/:name/publish`) had no re-bind signal.
 *
 * Measured on a cloud rig against AI-authored metadata published item by item:
 * two flows published as `state='active'` produced no bind log and never fired.
 * Only a forced kernel rebuild (`kernel:ready` -> `syncFlowsFromProtocol`,
 * #2560) picked them up. `service-automation` re-binds on the
 * `metadata:reloaded` lifecycle event, which had exactly two announcers — the
 * metadata plugin's dev-artifact watcher, and the runtime dispatcher after
 * `publishPackageDrafts` (#2576). The per-item door announced nothing.
 *
 * The fix notifies from the PRODUCER
 * ({@link ObjectStackProtocolImplementation.onMetaItemPublished}); the host
 * plugin turns that into the kernel announce, because the protocol holds no
 * hook bus. The bridge half is pinned in
 * `objectql/src/plugin-publish-announce.test.ts`, and the consumer half in
 * `service-automation/src/flow-publish-rebind.test.ts`.
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

/**
 * A clean record-triggered flow — the shape of the automation the rig measured
 * as inert. `runAs: 'system'` is load-bearing: without it `flow-runas-unscoped`
 * fires at `severity: 'error'` and the publish becomes a refusal.
 */
const recordTriggeredFlow = (name: string) => ({
    name,
    label: 'Ticket Closed',
    type: 'autolaunched',
    status: 'active',
    runAs: 'system',
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'Start',
            config: { objectName: 'ticket', triggerType: 'record-after-update' },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

describe('publishMetaItem notifies the host that ONE item went live (#10219 A)', () => {
    it('emits the canonical type/name/scope after a per-item publish', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const seen: MetaItemPublishedEvent[] = [];
        protocol.onMetaItemPublished((evt) => { seen.push(evt); });

        await protocol.saveMetaItem({
            type: 'flow', name: 'ticket_closed', item: recordTriggeredFlow('ticket_closed'),
            packageId: PKG, mode: 'draft',
        });
        // Before the fix this published the row and told nobody, so the flow
        // stayed `active` and completely unbound until the kernel was rebuilt.
        const res = await protocol.publishMetaItem({
            type: 'flow', name: 'ticket_closed', actor: 'admin',
        });

        expect(res.success).toBe(true);
        expect(seen).toEqual([{ type: 'flow', name: 'ticket_closed', organizationId: null }]);
    });

    it('AWAITS the listener before answering, so a publish-then-write caller cannot race the bind', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const order: string[] = [];
        protocol.onMetaItemPublished(async () => {
            await new Promise((r) => setTimeout(r, 5));
            order.push('rebound');
        });

        await protocol.saveMetaItem({
            type: 'flow', name: 'ticket_closed', item: recordTriggeredFlow('ticket_closed'),
            packageId: PKG, mode: 'draft',
        });
        await protocol.publishMetaItem({ type: 'flow', name: 'ticket_closed', actor: 'admin' });
        order.push('publish-returned');

        expect(order).toEqual(['rebound', 'publish-returned']);
    });

    it('a THROWING listener never fails the publish — the row is already durable', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        protocol.onMetaItemPublished(() => { throw new Error('subscriber exploded'); });

        await protocol.saveMetaItem({
            type: 'flow', name: 'ticket_closed', item: recordTriggeredFlow('ticket_closed'),
            packageId: PKG, mode: 'draft',
        });
        const res = await protocol.publishMetaItem({
            type: 'flow', name: 'ticket_closed', actor: 'admin',
        });

        expect(res.success).toBe(true);
        const live = Array.from(rows.values()).filter((r) => r.state === 'active');
        expect(live.map((r) => r.name)).toEqual(['ticket_closed']);
    });

    it('unsubscribing stops the notification', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const seen: MetaItemPublishedEvent[] = [];
        const off = protocol.onMetaItemPublished((evt) => { seen.push(evt); });
        off();

        await protocol.saveMetaItem({
            type: 'flow', name: 'ticket_closed', item: recordTriggeredFlow('ticket_closed'),
            packageId: PKG, mode: 'draft',
        });
        await protocol.publishMetaItem({ type: 'flow', name: 'ticket_closed', actor: 'admin' });

        expect(seen).toEqual([]);
    });

    it('CONTROL — the BATCH door does NOT emit it per item (its announce is one per publish, at the route)', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const seen: MetaItemPublishedEvent[] = [];
        protocol.onMetaItemPublished((evt) => { seen.push(evt); });

        await protocol.saveMetaItem({
            type: 'flow', name: 'ticket_closed', item: recordTriggeredFlow('ticket_closed'),
            packageId: PKG, mode: 'draft',
        });
        await protocol.saveMetaItem({
            type: 'flow', name: 'ticket_reopened', item: recordTriggeredFlow('ticket_reopened'),
            packageId: PKG, mode: 'draft',
        });
        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ success: true, publishedCount: 2, failedCount: 0 });
        // Emitting here would fan a FULL kernel re-sync (schema DDL, connector
        // re-materialization, flow re-bind) out once per promoted draft, on top
        // of the one announce `POST /packages/:id/publish-drafts` already makes.
        expect(seen).toEqual([]);
    });
});
