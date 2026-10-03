// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21470] Every runtime door that writes a `sys_metadata` row refuses a body
 * whose own `name` disagrees with the name it writes the row under — for
 * every type, through the one judge (`savedItemNameRefusal`,
 * `@objectstack/metadata/view-container-name`).
 *
 * ---------------------------------------------------------------------------
 * The defect, measured on `origin/main` `e9dec3dab` before this change
 * ---------------------------------------------------------------------------
 * The registry write-through keys a written body by its OWN `name`
 * (`hydrateOverlayIntoRegistry` → `registerItem(type, body, 'name')`), while
 * the row is stored under the request's name. So a body whose `name` was not
 * its row's answered under a name nobody saved it under, and under none by its
 * own:
 *
 *  - P6, a record view: row `crm_lead.mine`, body `name` `crm_lead.other` —
 *    accepted, registry key `crm_lead.other` only;
 *  - P7, a dashboard: row `dash_a`, body `name` `dash_b` — accepted, registry
 *    key `dash_b` only;
 *  - R1 / R2: `rollbackMetaItem` and `revertCommit`'s restore limb wrote such
 *    a stored history version back as the active row with ZERO `saveMetaItem`
 *    calls, and registered it under the body's `name`;
 *  - D1: `publishMetaItem` promoted such a stored draft the same way.
 *
 * View CONTAINERS were already refused at the save door (#21412) and stay
 * pinned in `view-container-runtime-expansion.test.ts`; this file pins every
 * other body at every write door.
 *
 * ---------------------------------------------------------------------------
 * Staging a stored body the save door would now refuse
 * ---------------------------------------------------------------------------
 * After this change no door writes such a body, so R1, R2, D1 and the batch
 * case stage one the way it exists in a deployment: as a row stored BEFORE the
 * change. A clean body is written through the real door, and its stored bytes
 * are then rewritten in the double (`residue()`), exactly as a pre-change row
 * sits at rest. Each refusal is paired with a CONTROL through the same door
 * on a clean body, so a door that refuses everything cannot pass.
 *
 * The kernel is the control-plane topology (`environmentId` undefined): the
 * one on which a non-`object` type writes through to the shared registry
 * (`applyRegistryWriteThrough`), which is where the second key appeared.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, imported from
// `@objectstack/metadata-core` and NOT from `@objectstack/objectql`: objectql
// depends on this package, so that import would close a dependency cycle.
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
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

interface HistoryRow {
    id: string;
    type: string;
    name: string;
    version: number;
    organization_id: string | null;
    operation_type: string;
    metadata?: string | null;
}

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

/** Top-level eq + `$or` + explicit-NULL, the subset these paths emit. */
function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
}

/**
 * A double that STORES rows and history and whose registry keys an item by
 * its own `name`, the way `SchemaRegistry.registerItem` does — a no-op
 * registry would pass every "nothing registered" assertion vacuously.
 * Copied from `protocol.recovery-doors-emit-mutation.test.ts`, not imported,
 * so each pin can fail on its own.
 */
function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    const registered = new Map<string, Map<string, unknown>>();
    let nextId = 0;
    let commit: unknown = null;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            if (r) return { key: k, row: r };
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
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
            if (table === 'sys_metadata_commit') return commit;
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            // Hold the caller's bound AFTER the filter, by PRESENCE — the
            // objectql-double-limit contract.
            const bound = <T>(all: T[]): T[] =>
                typeof opts?.limit === 'number' ? all.slice(0, opts.limit) : all;
            if (table === 'sys_metadata_history') {
                return bound(historyRows.filter((h) => matchesHistory(h, opts?.where ?? {})));
            }
            if (table !== 'sys_metadata') return [];
            return bound(Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {})));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h = { ...(data as unknown as HistoryRow), id: `h_${nextId}` };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { ...(data as unknown as Row), id: `r_${nextId}` };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
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
        async count() { return 0; },
        // A transaction that ROLLS BACK, the property `publishPackageDrafts`'
        // Phase 1 stands on (ADR-0067 D2): a throw restores the rows and the
        // history it started with. The registry is not part of it — Phase 1
        // defers every registry mutation to Phase 2 — so it is not snapshotted.
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            const rowsAtBegin = new Map(rows);
            const historyAtBegin = historyRows.slice();
            try {
                return await cb(undefined, { owned: true });
            } catch (error) {
                rows.clear();
                for (const [k, r] of rowsAtBegin) rows.set(k, r);
                historyRows.splice(0, historyRows.length, ...historyAtBegin);
                throw error;
            }
        },
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        registry: {
            registerItem: (type: string, item: any) => {
                if (!registered.has(type)) registered.set(type, new Map());
                registered.get(type)!.set(item?.name, item);
            },
            registerObject: () => {},
            unregisterObject: () => true,
            removeObjectOverlay: () => {},
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => true,
            listItems: (type: string) => Array.from(registered.get(type)?.values() ?? []),
            getItem: (type: string, name: string) => registered.get(type)?.get(name),
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
        },
    };
    return {
        engine,
        rows,
        historyRows,
        registered,
        serveCommit: (c: unknown) => { commit = c; },
    };
}

function makeProtocol() {
    const h = makeStubEngine();
    // `environmentId` UNDEFINED on purpose — see the header.
    const protocol = new ObjectStackProtocolImplementation(h.engine, () => new Map(), undefined) as any;
    expect(protocol.environmentId).toBeUndefined();
    // `OS_METADATA_WRITABLE` is memoised process-wide; clear it rather than assume.
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    const saveDoor = vi.spyOn(protocol, 'saveMetaItem');
    return { protocol, saveDoor, ...h };
}

type Harness = ReturnType<typeof makeProtocol>;

const dash = (name: string | undefined, label = 'D') =>
    (name === undefined ? { label, widgets: [] } : { name, label, widgets: [] });
const recordView = (name: string | undefined) => ({
    ...(name === undefined ? {} : { name }),
    object: 'crm_lead',
    viewKind: 'list',
    label: 'Mine',
    config: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: [{ field: 'name' }] },
});

/** Every stored row of `type` as `{ row, state, bodyName }`. */
const stored = (h: Harness, type: string) => Array.from(h.rows.values())
    .filter((r) => r.type === type)
    .map((r) => ({ row: r.name, state: r.state, bodyName: JSON.parse(r.metadata).name }));
const keys = (h: Harness, type: string) => Array.from(h.registered.get(type)?.keys() ?? []);

/**
 * Rewrite a stored body's `name` in place — a row as it sits at rest when it
 * was written before this change (see the header). Returns the row it edited.
 */
function residue(h: Harness, where: { type: string; name: string; state?: string; version?: number }, bodyName: unknown) {
    if (where.version !== undefined) {
        const row = h.historyRows.find((r) => r.type === where.type && r.name === where.name && r.version === where.version);
        if (!row?.metadata) throw new Error(`no history row ${where.type}/${where.name}@${where.version}`);
        row.metadata = JSON.stringify({ ...JSON.parse(row.metadata), name: bodyName });
        return row;
    }
    const row = Array.from(h.rows.values())
        .find((r) => r.type === where.type && r.name === where.name && r.state === (where.state ?? 'active'));
    if (!row) throw new Error(`no ${where.state ?? 'active'} row ${where.type}/${where.name}`);
    row.metadata = JSON.stringify({ ...JSON.parse(row.metadata), name: bodyName });
    return row;
}

/** The minimum a rejection pin asserts: the ADR-0112 envelope, not "it threw". */
function expectEnvelope(error: any) {
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.status).toBe(400);
}

async function attempt<T>(run: () => Promise<T>): Promise<{ result: T | null; error: any }> {
    try {
        return { result: await run(), error: null };
    } catch (error) {
        return { result: null, error };
    }
}

afterEach(() => vi.restoreAllMocks());

// ═══════════════════════════════════════════════════════════════════════════
// 1. The save door — every type (P6, P7)
// ═══════════════════════════════════════════════════════════════════════════

describe('[#21470] the save door refuses a body whose `name` is not its row\'s, for every type', () => {
    it('P6: a record view saved as crm_lead.mine with `name` crm_lead.other is refused; nothing stored, nothing registered', async () => {
        const h = makeProtocol();
        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'view', name: 'crm_lead.mine', item: recordView('crm_lead.other'),
        }));
        expectEnvelope(error);
        expect(stored(h, 'view')).toEqual([]);
        expect(keys(h, 'view')).toEqual([]);
    });

    it('P7: a dashboard saved as dash_a with `name` dash_b is refused; nothing stored, nothing registered', async () => {
        const h = makeProtocol();
        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'dashboard', name: 'dash_a', item: dash('dash_b'),
        }));
        expectEnvelope(error);
        expect(error.message).toContain("'dash_b'");
        expect(error.message).toContain("'dash_a'");
        expect(stored(h, 'dashboard')).toEqual([]);
        expect(keys(h, 'dashboard')).toEqual([]);
    });

    it('a `translation` body with `name: \'\'` — which its schema accepts — is refused, not registered under \'\'', async () => {
        // Measured before this change: stored under the row and registered
        // under the empty string. Row 1's predicate: a `name` the body carries
        // is set, whatever it is (the judge's header).
        const h = makeProtocol();
        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'translation', name: 'crm_zh', item: { name: '', locale: 'zh-CN' },
        }));
        expectEnvelope(error);
        expect(stored(h, 'translation')).toEqual([]);
        expect(keys(h, 'translation')).toEqual([]);
    });

    it('CONTROL: an equal `name` passes; an absent one passes the judge (a view is stamped, a dashboard meets its schema)', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_a', item: dash('dash_a') });
        await h.protocol.saveMetaItem({ type: 'view', name: 'crm_lead.mine', item: recordView('crm_lead.mine') });
        await h.protocol.saveMetaItem({ type: 'view', name: 'crm_lead.stamped', item: recordView(undefined) });
        // The judge passes an absent dashboard `name`; the dashboard schema
        // requires one, and answers in its own envelope.
        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'dashboard', name: 'dash_none', item: dash(undefined),
        }));
        expect([error?.code, error?.status]).toEqual(['INVALID_METADATA', 422]);

        expect(stored(h, 'dashboard')).toEqual([{ row: 'dash_a', state: 'active', bodyName: 'dash_a' }]);
        expect(stored(h, 'view').map((r) => [r.row, r.bodyName])).toEqual([
            ['crm_lead.mine', 'crm_lead.mine'],
            ['crm_lead.stamped', 'crm_lead.stamped'],
        ]);
        // One registry key per row, and it is the row's.
        expect(keys(h, 'dashboard')).toEqual(['dash_a']);
        expect(keys(h, 'view')).toEqual(['crm_lead.mine', 'crm_lead.stamped']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The restore doors (R1, R2)
// ═══════════════════════════════════════════════════════════════════════════

/** dash_a at v1, v2, v3 through the real door; v2's stored body then carries `name` dash_b. */
async function threeVersionsWithResidueAtV2(h: Harness) {
    await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_a', item: dash('dash_a', 'v1') });
    await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_a', item: dash('dash_a', 'v2') });
    await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_a', item: dash('dash_a', 'v3') });
    residue(h, { type: 'dashboard', name: 'dash_a', version: 2 }, 'dash_b');
    h.saveDoor.mockClear();
    return { historyBefore: h.historyRows.length, activeBefore: JSON.stringify(stored(h, 'dashboard')) };
}

const commitRow = (items: unknown[]) => ({
    id: 'c1',
    commit_id: 'c1',
    organization_id: null,
    operation: 'apply',
    message: 'the commit under revert',
    created_at: '2026-01-01T00:00:00Z',
    items: JSON.stringify(items),
});

describe('[#21470] the restore doors refuse a stored version whose `name` is not its row\'s', () => {
    it('R1: rollbackMetaItem to it is refused; the active row, the history and the registry are unchanged', async () => {
        const h = makeProtocol();
        const before = await threeVersionsWithResidueAtV2(h);
        const keysBefore = keys(h, 'dashboard');

        const { error } = await attempt(() => h.protocol.rollbackMetaItem({ type: 'dashboard', name: 'dash_a', toVersion: 2 }));

        expectEnvelope(error);
        expect(error.message).toContain('the name it is restored under');
        expect(JSON.stringify(stored(h, 'dashboard'))).toBe(before.activeBefore);
        expect(h.historyRows.length).toBe(before.historyBefore);
        expect(keys(h, 'dashboard')).toEqual(keysBefore);
        expect(keys(h, 'dashboard')).not.toContain('dash_b');
        expect(h.saveDoor).not.toHaveBeenCalled();
    });

    it('R1 CONTROL: a rollback to a clean version restores it, under the row\'s one key', async () => {
        const h = makeProtocol();
        await threeVersionsWithResidueAtV2(h);

        const res = await h.protocol.rollbackMetaItem({ type: 'dashboard', name: 'dash_a', toVersion: 1 });

        expect(res.success).toBe(true);
        expect(stored(h, 'dashboard')).toEqual([{ row: 'dash_a', state: 'active', bodyName: 'dash_a' }]);
        expect(keys(h, 'dashboard')).toEqual(['dash_a']);
    });

    it('R2: revertCommit\'s restore limb reports it in failed[] with the envelope\'s code; nothing is written', async () => {
        const h = makeProtocol();
        const before = await threeVersionsWithResidueAtV2(h);
        h.serveCommit(commitRow([{ type: 'dashboard', name: 'dash_a', existedBefore: true, prevVersion: 2 }]));
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.revertCommit({ commitId: 'c1' });

        expect(res.revertedCount).toBe(0);
        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]).toMatchObject({ type: 'dashboard', name: 'dash_a', code: 'VALIDATION_ERROR' });
        expect(res.failed[0].error).toContain('the name it is restored under');
        expect(JSON.stringify(stored(h, 'dashboard'))).toBe(before.activeBefore);
        expect(h.historyRows.length).toBe(before.historyBefore);
        expect(keys(h, 'dashboard')).not.toContain('dash_b');
        expect(h.saveDoor).not.toHaveBeenCalled();
    });

    it('R2 CONTROL: the restore limb restores a clean version', async () => {
        const h = makeProtocol();
        await threeVersionsWithResidueAtV2(h);
        h.serveCommit(commitRow([{ type: 'dashboard', name: 'dash_a', existedBefore: true, prevVersion: 1 }]));

        const res = await h.protocol.revertCommit({ commitId: 'c1' });

        expect(res.revertedCount).toBe(1);
        expect(res.failed).toEqual([]);
        expect(keys(h, 'dashboard')).toEqual(['dash_a']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The draft promotion (D1, and the batch that shares it)
// ═══════════════════════════════════════════════════════════════════════════

describe('[#21470] the draft promotion refuses a stored draft whose `name` is not its row\'s', () => {
    it('D1: publishMetaItem of it is refused; no active row, no registry key, the draft kept', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_d', item: dash('dash_d'), mode: 'draft' });
        residue(h, { type: 'dashboard', name: 'dash_d', state: 'draft' }, 'dash_e');
        h.saveDoor.mockClear();

        const { error } = await attempt(() => h.protocol.publishMetaItem({ type: 'dashboard', name: 'dash_d' }));

        expectEnvelope(error);
        expect(error.message).toContain('the name it is published under');
        expect(stored(h, 'dashboard')).toEqual([{ row: 'dash_d', state: 'draft', bodyName: 'dash_e' }]);
        expect(keys(h, 'dashboard')).toEqual([]);
        expect(h.saveDoor).not.toHaveBeenCalled();
    });

    it('D1 CONTROL: a clean draft publishes under the row\'s one key', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_d', item: dash('dash_d'), mode: 'draft' });

        const res = await h.protocol.publishMetaItem({ type: 'dashboard', name: 'dash_d' });

        expect(res.success).toBe(true);
        expect(stored(h, 'dashboard')).toEqual([{ row: 'dash_d', state: 'active', bodyName: 'dash_d' }]);
        expect(keys(h, 'dashboard')).toEqual(['dash_d']);
    });

    it('publishPackageDrafts: one refused draft aborts the batch as the authoring gate\'s refusal does — nothing goes live', async () => {
        // ADR-0067 D2: a package publishes as a unit. The refused draft is
        // reported with the envelope's code, its sibling as aborted with it,
        // and neither reaches `active` or the registry.
        const h = makeProtocol();
        const PKG = 'app.dash';
        await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_ok', item: dash('dash_ok'), mode: 'draft', packageId: PKG });
        await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_d', item: dash('dash_d'), mode: 'draft', packageId: PKG });
        residue(h, { type: 'dashboard', name: 'dash_d', state: 'draft' }, 'dash_e');
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.outcome).toBe('refused');
        expect(res.publishedCount).toBe(0);
        expect(res.failed.find((f: any) => f.name === 'dash_d')).toMatchObject({ type: 'dashboard', code: 'VALIDATION_ERROR' });
        expect(res.failed.map((f: any) => f.name).sort()).toEqual(['dash_d', 'dash_ok']);
        expect(stored(h, 'dashboard').every((r) => r.state === 'draft')).toBe(true);
        expect(keys(h, 'dashboard')).toEqual([]);
    });

    it('publishPackageDrafts CONTROL: the same batch with a clean draft publishes both', async () => {
        const h = makeProtocol();
        const PKG = 'app.dash';
        await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_ok', item: dash('dash_ok'), mode: 'draft', packageId: PKG });
        await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_d', item: dash('dash_d'), mode: 'draft', packageId: PKG });

        const res = await h.protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.outcome).toBe('published');
        expect(res.publishedCount).toBe(2);
        expect(keys(h, 'dashboard').sort()).toEqual(['dash_d', 'dash_ok']);
    });
});
