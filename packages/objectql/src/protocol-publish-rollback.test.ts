// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

/**
 * Protocol-level coverage for the per-item draft / publish / rollback /
 * diff lifecycle introduced by the metadata save-rules audit.
 *
 * The stub engine here is multi-table aware (sys_metadata + sys_metadata_history)
 * and keys overlay rows by (type, name, org, state) so draft and active rows
 * for the same identity can coexist.
 */

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
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

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;
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
        const k = keyOf(w);
        const r = rows.get(k);
        return r ? { key: k, row: r } : null;
    };

    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean => {
        if (w.organization_id !== undefined && h.organization_id !== w.organization_id)
            return false;
        if (w.type !== undefined && h.type !== w.type) return false;
        if (w.name !== undefined && h.name !== w.name) return false;
        if (w.version !== undefined && h.version !== w.version) return false;
        if (w.operation_type !== undefined && h.operation_type !== w.operation_type)
            return false;
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
                const out = historyRows.filter((h) => matchesHistory(h, opts.where));
                if (opts && (opts as any).orderBy) {
                    const { field, direction } = (opts as any).orderBy;
                    out.sort((a: any, b: any) => {
                        const av = a[field]; const bv = b[field];
                        if (av < bv) return direction === 'desc' ? 1 : -1;
                        if (av > bv) return direction === 'desc' ? -1 : 1;
                        return 0;
                    });
                }
                return out;
            }
            return Array.from(rows.values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
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
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            // Re-key in case state changed.
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any) => Promise<T>): Promise<T> {
            return cb(undefined);
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
        },
    };
    return { engine, rows, historyRows };
}

describe('publishMetaItem / rollbackMetaItem / diffMetaItem', () => {
    const sampleBody = (label: string) => ({
        name: 'case_grid', type: 'grid', label, columns: ['id', 'title'],
    });

    it('saveMetaItem with mode=draft creates a draft row, active read sees published', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: sampleBody('Published'),
        });
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: sampleBody('Pending'),
            mode: 'draft',
        });
        const states = Array.from(rows.values()).map((r) => r.state).sort();
        expect(states).toEqual(['active', 'draft']);
        const active = await protocol.getMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
        });
        expect((active as any).item.label).toBe('Published');
        const draft = await protocol.getMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha', state: 'draft',
        });
        expect((draft as any).item.label).toBe('Pending');
    });

    it('publishMetaItem promotes the draft body to active and clears the draft', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: sampleBody('v1'),
        });
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: sampleBody('v2-draft'), mode: 'draft',
        });
        const result = await protocol.publishMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha', actor: 'admin',
        });
        expect((result as any).success).toBe(true);
        // Only the active row remains.
        const states = Array.from(rows.values()).map((r) => r.state);
        expect(states).toEqual(['active']);
        const body = JSON.parse(Array.from(rows.values())[0].metadata);
        expect(body.label).toBe('v2-draft');
    });

    it('publishMetaItem returns 404 no_draft when nothing is pending', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: sampleBody('v1'),
        });
        await expect(
            protocol.publishMetaItem({
                type: 'view', name: 'case_grid', organizationId: 'org_alpha', actor: 'admin',
            }),
        ).rejects.toMatchObject({ code: 'no_draft', status: 404 });
    });

    it('getMetaItem(state=draft) returns 404 no_draft when no overlay row exists', async () => {
        // Contract guard for the REST GET `/meta/:type/:name?state=draft`
        // endpoint: with no pending draft we must throw `no_draft` (HTTP 404),
        // identical to publishMetaItem. This prevents the historical ambiguity
        // where the response was a 200 envelope without `item`, which clients
        // had to disambiguate by sniffing keys.
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: sampleBody('v1'),
            // `mode` defaults to publish, so this writes the active row;
            // no draft row exists after this save.
        });
        await expect(
            protocol.getMetaItem({
                type: 'view', name: 'case_grid', organizationId: 'org_alpha',
                state: 'draft',
            }),
        ).rejects.toMatchObject({ code: 'no_draft', status: 404 });

        // Also covers the "never saved" path — no overlay row at all.
        await expect(
            protocol.getMetaItem({
                type: 'view', name: 'never_existed', organizationId: 'org_alpha',
                state: 'draft',
            }),
        ).rejects.toMatchObject({ code: 'no_draft', status: 404 });
    });

    it('getMetaItem(state=draft) returns the draft body when one is pending', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: sampleBody('v1'),
        });
        // Write a draft row in addition to the active row.
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: sampleBody('v2-draft'),
            mode: 'draft',
        } as any);
        const got = await protocol.getMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            state: 'draft',
        });
        expect(got).toMatchObject({
            type: 'view',
            name: 'case_grid',
            item: expect.objectContaining({ label: 'v2-draft' }),
        });
    });

    it('rollbackMetaItem restores a previous version with op=revert', async () => {
        const { engine, historyRows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: sampleBody('v1'),
        });
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: sampleBody('v2'),
        });
        const result = await protocol.rollbackMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            toVersion: 1, actor: 'admin',
        });
        expect((result as any).success).toBe(true);
        expect((result as any).restoredFromVersion).toBe(1);
        const live = await protocol.getMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
        });
        expect((live as any).item.label).toBe('v1');
        // History records a revert.
        const ops = historyRows.map((h) => h.operation_type);
        expect(ops).toContain('revert');
    });

    it('rollbackMetaItem returns 404 version_not_found for missing version', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: sampleBody('v1'),
        });
        await expect(
            protocol.rollbackMetaItem({
                type: 'view', name: 'case_grid', organizationId: 'org_alpha',
                toVersion: 99, actor: 'admin',
            }),
        ).rejects.toMatchObject({ code: 'version_not_found', status: 404 });
    });

    it('diffMetaItem returns structured top-level key diff between two versions', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: { name: 'case_grid', type: 'grid', label: 'A', columns: ['id'] },
        });
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            item: { name: 'case_grid', type: 'grid', label: 'B', columns: ['id', 'title'], extra: 1 },
        });
        const diff = await protocol.diffMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
            fromVersion: 1, toVersion: 2,
        });
        expect((diff as any).added.map((e: any) => e.path)).toContain('extra');
        expect((diff as any).changed.map((e: any) => e.path).sort()).toEqual(['columns', 'label']);
    });
});

describe('deleteMetaItem — storage teardown (dropStorage)', () => {
    const seedActiveObject = async (name: string) => {
        const { engine, rows } = makeStubEngine();
        engine.syncObjectSchema = vi.fn();
        engine.dropObjectSchema = vi.fn();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({ type: 'object', name, item: { name, label: name, fields: { title: { type: 'text' } } } });
        return { engine, rows, protocol };
    };

    it('drops the physical table when dropStorage is set (object + active)', async () => {
        const { engine, protocol } = await seedActiveObject('expense_claim');
        const res = await protocol.deleteMetaItem({ type: 'object', name: 'expense_claim', dropStorage: true });
        expect(res.success).toBe(true);
        expect(engine.dropObjectSchema).toHaveBeenCalledTimes(1);
        expect(engine.dropObjectSchema).toHaveBeenCalledWith('expense_claim');
    });

    it('does NOT drop the table by default (delete stays non-destructive to data)', async () => {
        const { engine, protocol } = await seedActiveObject('expense_claim');
        await protocol.deleteMetaItem({ type: 'object', name: 'expense_claim' });
        expect(engine.dropObjectSchema).not.toHaveBeenCalled();
    });

    it('never drops a sys_-prefixed platform table even with dropStorage', async () => {
        const { engine, protocol } = await seedActiveObject('sys_secret');
        await protocol.deleteMetaItem({ type: 'object', name: 'sys_secret', dropStorage: true });
        expect(engine.dropObjectSchema).not.toHaveBeenCalled();
    });

    it('does not drop storage for a non-object type even with dropStorage', async () => {
        const { engine, rows } = makeStubEngine();
        engine.dropObjectSchema = vi.fn();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({ type: 'dashboard', name: 'sales', item: { name: 'sales', label: 'Sales', widgets: [] } });
        await protocol.deleteMetaItem({ type: 'dashboard', name: 'sales', dropStorage: true });
        expect(engine.dropObjectSchema).not.toHaveBeenCalled();
    });
});
