// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21470] Every runtime door that writes a `sys_metadata` row refuses a body
 * whose own `name` disagrees with the name it writes the row under — for
 * every type, through the one judge (`savedItemNameRefusal`,
 * `@objectstack/metadata/view-container-name`).
 *
 * Section 4 pins the second half of the body against its address, with the
 * same envelope at the save door, the restore doors and the draft promotion: a permission set
 * whose body `packageId` disagrees with the package the row is written into
 * (ADR-0086 D3, `permissionSetOwnerBindingRefusal`). It shares this file's
 * double and its staging of a stored body.
 *
 * Section 5 pins ADR-0138 D2b's flow half at the same publish doors, on the
 * same double: a flow published with `runAs: 'system'` while an anonymous
 * endpoint of `type: 'flow'` names it (`anonymousElevatedFlowRefusal`). The
 * double's registry lists `api` items, which is one of the two places the
 * protocol reads the declared endpoints from; the other, the `metadata`
 * service, is handed in per case.
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

// ═══════════════════════════════════════════════════════════════════════════
// 4. The body's `packageId` against the row's binding (ADR-0086 D3)
// ═══════════════════════════════════════════════════════════════════════════
//
// The second half of "the body against its address": a permission set whose
// body `packageId` disagrees with the package the row is written into is
// refused at the save door (draft and publish mode), at the restore doors
// (`rollbackMetaItem` and `revertCommit`'s restore limb) and at the draft
// promotion (the per-item publish and the package publish), with the name
// judge's envelope. Measured on `origin/main` `175e8d414` before the change:
// every refused case below was accepted, and the stored row's `package_id`
// then decided the owner everywhere it is read, silently overriding the body.
// A disagreeing STORED draft is staged as `residue()` stages a name: written
// clean through the real door, its stored body then rewritten in the double.

const BOUND = 'app.probe_bound';
const OTHER = 'app.probe_other';
const perm = (name: string, packageId?: string) =>
    ({ name, label: 'Probe', objects: {}, ...(packageId === undefined ? {} : { packageId }) });

/** Every stored permission row as `{ row, state, binding, body }` (`body` = the body's `packageId`). */
const storedSets = (h: Harness) => Array.from(h.rows.values())
    .filter((r) => r.type === 'permission')
    .map((r) => ({ row: r.name, state: r.state, binding: r.package_id ?? null, body: JSON.parse(r.metadata).packageId }));

/** Rewrite a stored permission body's `packageId` in place — a row stored before this change. */
function residuePackageId(h: Harness, where: { name: string; state: string }, packageId: string) {
    const row = Array.from(h.rows.values())
        .find((r) => r.type === 'permission' && r.name === where.name && r.state === where.state);
    if (!row) throw new Error(`no ${where.state} permission row ${where.name}`);
    row.metadata = JSON.stringify({ ...JSON.parse(row.metadata), packageId });
}

/** The refusal this section pins: the envelope, the key located, both values named. */
function expectOwnerRefusal(error: any, declared: string, binding: string | null) {
    expectEnvelope(error);
    expect(error.issues).toEqual([expect.objectContaining({ path: 'packageId', code: 'custom' })]);
    expect(error.message).toContain(`declares \`packageId\` '${declared}'`);
    expect(error.message).toContain(binding === null ? 'into no package' : `into package '${binding}'`);
}

describe('[ADR-0086 D3] the save door refuses a permission set whose body `packageId` disagrees with its binding', () => {
    it.each(['publish', 'draft'] as const)('%s mode: saved into one package, declaring another, is refused; nothing stored, nothing registered', async (mode) => {
        const h = makeProtocol();
        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: 'probe_member', item: perm('probe_member', OTHER), packageId: BOUND, mode,
        }));
        expectOwnerRefusal(error, OTHER, BOUND);
        // The prescription comes first: both remedies, before the 500-character REST bound can cut it.
        expect(error.message.indexOf('Drop `packageId`')).toBe(0);
        expect(error.message).toContain(`or save the set into package '${OTHER}'`);
        expect(storedSets(h)).toEqual([]);
        expect(keys(h, 'permission')).toEqual([]);
    });

    it.each(['publish', 'draft'] as const)('%s mode: a body `packageId` on a save into no package is refused (absent = environment-authored)', async (mode) => {
        const h = makeProtocol();
        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: 'probe_member', item: perm('probe_member', OTHER), mode,
        }));
        expectOwnerRefusal(error, OTHER, null);
        expect(storedSets(h)).toEqual([]);
        expect(keys(h, 'permission')).toEqual([]);
    });

    it('an empty-string `packageId` on a save into no package is refused too: the key is present', async () => {
        const h = makeProtocol();
        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: 'probe_member', item: perm('probe_member', ''),
        }));
        expectOwnerRefusal(error, '', null);
        // No package to save into is offered for a value that names none.
        expect(error.message).not.toContain('or save the set into package');
        expect(storedSets(h)).toEqual([]);
    });

    it('a draft that names no package is judged against the package it INHERITS, not the request\'s spelling', async () => {
        // The active row is bound to BOUND, so a package-less draft save lands
        // in BOUND (#11087): the refusal names BOUND, and an agreeing body passes.
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: 'probe_member', item: perm('probe_member'), packageId: BOUND });

        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: 'probe_member', item: perm('probe_member', OTHER), mode: 'draft',
        }));
        expectOwnerRefusal(error, OTHER, BOUND);

        await h.protocol.saveMetaItem({ type: 'permission', name: 'probe_member', item: perm('probe_member', BOUND), mode: 'draft' });
        expect(storedSets(h)).toEqual([
            { row: 'probe_member', state: 'active', binding: BOUND, body: undefined },
            { row: 'probe_member', state: 'draft', binding: BOUND, body: BOUND },
        ]);
    });

    it('a direct save that names no package is judged against the one package its address resolves to', async () => {
        // The item's only active row is bound to BOUND, so a package-less
        // direct save writes BOUND's row: an agreeing body passes, and a
        // disagreeing one is refused naming BOUND, not "no package".
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: 'probe_member', item: perm('probe_member'), packageId: BOUND });

        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: 'probe_member', item: perm('probe_member', OTHER),
        }));
        expectOwnerRefusal(error, OTHER, BOUND);

        await h.protocol.saveMetaItem({ type: 'permission', name: 'probe_member', item: perm('probe_member', BOUND) });
        expect(storedSets(h)).toEqual([{ row: 'probe_member', state: 'active', binding: BOUND, body: BOUND }]);
    });

    it('CONTROL: a body `packageId` equal to the binding is accepted in both modes, and an absent one with or without a package', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: 'agree_live', item: perm('agree_live', BOUND), packageId: BOUND });
        await h.protocol.saveMetaItem({ type: 'permission', name: 'agree_draft', item: perm('agree_draft', BOUND), packageId: BOUND, mode: 'draft' });
        await h.protocol.saveMetaItem({ type: 'permission', name: 'bare_bound', item: perm('bare_bound'), packageId: BOUND });
        await h.protocol.saveMetaItem({ type: 'permission', name: 'bare_env', item: perm('bare_env') });
        expect(storedSets(h)).toEqual([
            { row: 'agree_live', state: 'active', binding: BOUND, body: BOUND },
            { row: 'agree_draft', state: 'draft', binding: BOUND, body: BOUND },
            { row: 'bare_bound', state: 'active', binding: BOUND, body: undefined },
            { row: 'bare_env', state: 'active', binding: null, body: undefined },
        ]);
        expect(keys(h, 'permission').sort()).toEqual(['agree_live', 'bare_bound', 'bare_env']);
    });
});

describe('[ADR-0086 D3] the draft promotion refuses a permission-set draft whose body `packageId` disagrees with its binding', () => {
    it('publishMetaItem: a stored draft bound to one package declaring another is refused; the draft is kept, nothing goes live', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: 'probe_member', item: perm('probe_member', BOUND), packageId: BOUND, mode: 'draft' });
        residuePackageId(h, { name: 'probe_member', state: 'draft' }, OTHER);
        h.saveDoor.mockClear();

        const { error } = await attempt(() => h.protocol.publishMetaItem({ type: 'permission', name: 'probe_member' }));

        expectOwnerRefusal(error, OTHER, BOUND);
        expect(error.message.indexOf('Save the draft')).toBe(0);
        expect(error.message).toContain('Nothing was published.');
        expect(storedSets(h)).toEqual([{ row: 'probe_member', state: 'draft', binding: BOUND, body: OTHER }]);
        expect(keys(h, 'permission')).toEqual([]);
        expect(h.saveDoor).not.toHaveBeenCalled();
    });

    it('publishPackageDrafts: the refused draft aborts the batch, reported with the envelope\'s code; nothing goes live', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: 'probe_ok', item: perm('probe_ok'), packageId: BOUND, mode: 'draft' });
        await h.protocol.saveMetaItem({ type: 'permission', name: 'probe_member', item: perm('probe_member'), packageId: BOUND, mode: 'draft' });
        residuePackageId(h, { name: 'probe_member', state: 'draft' }, OTHER);
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.publishPackageDrafts({ packageId: BOUND });

        expect(res.outcome).toBe('refused');
        expect(res.publishedCount).toBe(0);
        const refused = res.failed.find((f: any) => f.name === 'probe_member');
        expect(refused).toMatchObject({ type: 'permission', code: 'VALIDATION_ERROR' });
        expect(refused.error).toContain(`declares \`packageId\` '${OTHER}'`);
        expect(refused.error).toContain(`into package '${BOUND}'`);
        expect(storedSets(h).every((r) => r.state === 'draft')).toBe(true);
        expect(keys(h, 'permission')).toEqual([]);
    });

    it('CONTROL: the same batch with an agreeing body publishes both, under the binding', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: 'probe_ok', item: perm('probe_ok'), packageId: BOUND, mode: 'draft' });
        await h.protocol.saveMetaItem({ type: 'permission', name: 'probe_member', item: perm('probe_member', BOUND), packageId: BOUND, mode: 'draft' });

        const res = await h.protocol.publishPackageDrafts({ packageId: BOUND });

        expect(res.outcome).toBe('published');
        expect(res.publishedCount).toBe(2);
        expect(storedSets(h).filter((r) => r.state === 'active')).toEqual([
            { row: 'probe_ok', state: 'active', binding: BOUND, body: undefined },
            { row: 'probe_member', state: 'active', binding: BOUND, body: BOUND },
        ]);
    });
});

/**
 * A permission set at v1, v2, v3 through the real door, saved into `binding`
 * (or into no package); v2's stored history body then declares `declared` —
 * a version stored before the save door judged the key.
 */
async function threeSetVersionsWithOwnerResidueAtV2(h: Harness, binding: string | null, declared: string) {
    const save = (label: string) => h.protocol.saveMetaItem({
        type: 'permission', name: 'probe_member', item: { ...perm('probe_member'), label },
        ...(binding === null ? {} : { packageId: binding }),
    });
    await save('v1');
    await save('v2');
    await save('v3');
    const v2 = h.historyRows.find((r) => r.type === 'permission' && r.name === 'probe_member' && r.version === 2);
    if (!v2?.metadata) throw new Error('no history row permission/probe_member@2');
    v2.metadata = JSON.stringify({ ...JSON.parse(v2.metadata), packageId: declared });
    h.saveDoor.mockClear();
    return { historyBefore: h.historyRows.length, activeBefore: JSON.stringify(storedSets(h)) };
}

/** The label of the active stored set — which version a restore left active. */
const activeLabel = (h: Harness) => {
    const row = Array.from(h.rows.values()).find((r) => r.type === 'permission' && r.name === 'probe_member' && r.state === 'active');
    return row ? JSON.parse(row.metadata).label : undefined;
};

describe('[ADR-0086 D3] the restore doors refuse a stored version whose body `packageId` disagrees with the row it is restored into', () => {
    it('rollbackMetaItem: a version declaring another package is refused with the restore remedy; the active row and the history are unchanged', async () => {
        const h = makeProtocol();
        const before = await threeSetVersionsWithOwnerResidueAtV2(h, BOUND, OTHER);

        const { error } = await attempt(() => h.protocol.rollbackMetaItem({ type: 'permission', name: 'probe_member', toVersion: 2 }));

        expectOwnerRefusal(error, OTHER, BOUND);
        expect(error.message.indexOf(`Save permission set 'probe_member' again with \`packageId\` dropped or set to '${BOUND}', instead of restoring this version.`)).toBe(0);
        expect(error.message).toContain('Nothing was restored.');
        expect(JSON.stringify(storedSets(h))).toBe(before.activeBefore);
        expect(activeLabel(h)).toBe('v3');
        expect(h.historyRows.length).toBe(before.historyBefore);
        expect(h.saveDoor).not.toHaveBeenCalled();
    });

    it('rollbackMetaItem: a version declaring a package, restored into a row bound to none, is refused (absent = environment-authored)', async () => {
        const h = makeProtocol();
        const before = await threeSetVersionsWithOwnerResidueAtV2(h, null, OTHER);

        const { error } = await attempt(() => h.protocol.rollbackMetaItem({ type: 'permission', name: 'probe_member', toVersion: 2 }));

        expectOwnerRefusal(error, OTHER, null);
        expect(error.message.indexOf("Save permission set 'probe_member' again with `packageId` dropped, instead of restoring this version.")).toBe(0);
        expect(JSON.stringify(storedSets(h))).toBe(before.activeBefore);
        expect(h.historyRows.length).toBe(before.historyBefore);
    });

    it('CONTROL: rollbackMetaItem restores a version whose body agrees with the binding, and one that carries no key', async () => {
        const h = makeProtocol();
        await threeSetVersionsWithOwnerResidueAtV2(h, BOUND, BOUND);

        const agreeing = await h.protocol.rollbackMetaItem({ type: 'permission', name: 'probe_member', toVersion: 2 });
        expect(agreeing.success).toBe(true);
        expect(activeLabel(h)).toBe('v2');
        expect(storedSets(h)).toEqual([{ row: 'probe_member', state: 'active', binding: BOUND, body: BOUND }]);

        const bare = await h.protocol.rollbackMetaItem({ type: 'permission', name: 'probe_member', toVersion: 1 });
        expect(bare.success).toBe(true);
        expect(activeLabel(h)).toBe('v1');
        expect(storedSets(h)).toEqual([{ row: 'probe_member', state: 'active', binding: BOUND, body: undefined }]);
    });

    it('revertCommit\'s restore limb reports a disagreeing version in failed[] with the envelope\'s code; nothing is written', async () => {
        const h = makeProtocol();
        const before = await threeSetVersionsWithOwnerResidueAtV2(h, BOUND, OTHER);
        h.serveCommit(commitRow([{ type: 'permission', name: 'probe_member', existedBefore: true, prevVersion: 2 }]));
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.revertCommit({ commitId: 'c1' });

        expect(res.revertedCount).toBe(0);
        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]).toMatchObject({ type: 'permission', name: 'probe_member', code: 'VALIDATION_ERROR' });
        expect(res.failed[0].error).toContain('instead of restoring this version');
        expect(res.failed[0].error).toContain(`declares \`packageId\` '${OTHER}'`);
        expect(JSON.stringify(storedSets(h))).toBe(before.activeBefore);
        expect(h.historyRows.length).toBe(before.historyBefore);
        expect(h.saveDoor).not.toHaveBeenCalled();
    });

    it('CONTROL: revertCommit\'s restore limb restores a version whose body agrees with the binding', async () => {
        const h = makeProtocol();
        await threeSetVersionsWithOwnerResidueAtV2(h, BOUND, BOUND);
        h.serveCommit(commitRow([{ type: 'permission', name: 'probe_member', existedBefore: true, prevVersion: 2 }]));

        const res = await h.protocol.revertCommit({ commitId: 'c1' });

        expect(res.revertedCount).toBe(1);
        expect(res.failed).toEqual([]);
        expect(activeLabel(h)).toBe('v2');
        expect(storedSets(h)).toEqual([{ row: 'probe_member', state: 'active', binding: BOUND, body: BOUND }]);
    });
});

describe('[ADR-0086 D3] duplicatePackage copies a set that declares its source package as declaring the target', () => {
    const SRC = 'app.dupsrc';
    const DST = 'app.dupdst';

    it('the copy declares the package it is saved into; a source row that already disagreed is reported in failed[]', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: 'dupsrc_member', item: perm('dupsrc_member', SRC), packageId: SRC });
        await h.protocol.saveMetaItem({ type: 'permission', name: 'dupsrc_stray', item: perm('dupsrc_stray', SRC), packageId: SRC });
        residuePackageId(h, { name: 'dupsrc_stray', state: 'active' }, OTHER);
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.duplicatePackage({ sourcePackageId: SRC, targetPackageId: DST });

        expect(res.copied).toEqual([{ type: 'permission', name: 'dupdst_member' }]);
        expect(res.failed).toEqual([expect.objectContaining({ type: 'permission', name: 'dupsrc_stray' })]);
        expect(res.failed[0].error).toContain(`declares \`packageId\` '${OTHER}'`);
        expect(storedSets(h).filter((r) => r.binding === DST)).toEqual([
            { row: 'dupdst_member', state: 'active', binding: DST, body: DST },
        ]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. A flow published as `system` while an anonymous endpoint names it (ADR-0138 D2b)
// ═══════════════════════════════════════════════════════════════════════════
//
// The record refuses the anonymous flow endpoint × `runAs: 'system'` flow pair
// "in both directions, because either item can be the last one edited". An
// endpoint is code-only, so this door holds the FLOW direction: the flow is the
// item being published, and the endpoints that name it are read from the engine
// registry and the `metadata` service. Every door a flow body reaches `active`
// through is pinned — the publish-mode save, the per-item publish of a draft,
// the package's publish-drafts — each with its control, and with the envelope
// (`INVALID_METADATA` / 422, the issue located at `runAs`) and the prescription.

const D2B_FLOW = 'acme_partner_intake';
const D2B_ENDPOINT = 'acme_partner_intake_api';

/**
 * A start → end flow. `autolaunched`, so the shared authoring rules have
 * nothing to say about its trigger (a `type: 'api'` flow owes its start node a
 * signed secret) and every control below isolates the D2b verdict; the pair
 * is judged on `runAs` and the endpoint's `target`, never on the flow's type.
 */
const d2bFlow = (runAs: 'system' | 'user') => ({
    name: D2B_FLOW,
    label: 'Partner intake',
    type: 'autolaunched',
    runAs,
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/** A code-declared flow endpoint naming {@link D2B_FLOW}, as `registerApp` files it. */
const d2bEndpoint = (authRequired: boolean) => ({
    name: D2B_ENDPOINT,
    path: '/api/v1/apps/acme/partner/intake',
    method: 'POST',
    type: 'flow',
    target: D2B_FLOW,
    authRequired,
    ...(authRequired ? {} : { rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 100 } }),
});

/** A protocol over this file's double, with an optional `metadata` service answering `list('api')`. */
function makeD2bProtocol(metadataList?: (type: string) => Promise<unknown[]>, installedPackage?: string) {
    const h = makeStubEngine();
    // A flow saved into a package needs that package installed (the named-base
    // rule); the double's registry installs the one a case names.
    if (installedPackage) {
        h.engine.registry.getPackage = (id: string) =>
            (id === installedPackage ? { manifest: { id, scope: 'project' } } : undefined);
    }
    const services = new Map<string, unknown>();
    if (metadataList) services.set('metadata', { list: metadataList });
    const protocol = new ObjectStackProtocolImplementation(h.engine, () => services as Map<string, any>, undefined) as any;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    return { protocol, ...h };
}

/** The refusal this section pins: the envelope, the key located, both items and the prescription named. */
function expectElevatedRefusal(error: any) {
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('INVALID_METADATA');
    expect(error.status).toBe(422);
    expect(error.issues).toEqual([expect.objectContaining({ path: 'runAs', code: 'custom' })]);
    expect(error.message).toContain(`Flow '${D2B_FLOW}'`);
    expect(error.message).toContain(`'${D2B_ENDPOINT}'`);
    expect(error.message).toContain('authenticated endpoint');
    expect(error.message).toContain('signed inbound hook');
    expect(error.message).toContain('public form');
}

const storedFlows = (h: { rows: Map<string, Row> }) => Array.from(h.rows.values())
    .filter((r) => r.type === 'flow')
    .map((r) => ({ row: r.name, state: r.state, runAs: JSON.parse(r.metadata).runAs }));

describe('[ADR-0138 D2b] the save door refuses a flow published as `system` while an anonymous endpoint names it', () => {
    it('publish mode: refused with the envelope; nothing stored', async () => {
        const h = makeD2bProtocol();
        h.engine.registry.registerItem('api', d2bEndpoint(false));

        const { error } = await attempt(() => h.protocol.saveMetaItem({ type: 'flow', name: D2B_FLOW, item: d2bFlow('system') }));

        expectElevatedRefusal(error);
        expect(storedFlows(h)).toEqual([]);
    });

    it('CONTROL: the same flow under `user` beside the anonymous endpoint saves', async () => {
        const h = makeD2bProtocol();
        h.engine.registry.registerItem('api', d2bEndpoint(false));

        const res = await h.protocol.saveMetaItem({ type: 'flow', name: D2B_FLOW, item: d2bFlow('user') });

        expect(res.success).toBe(true);
        expect(storedFlows(h)).toEqual([{ row: D2B_FLOW, state: 'active', runAs: 'user' }]);
    });

    it('CONTROL: the flow under `system` behind an AUTHENTICATED endpoint saves', async () => {
        const h = makeD2bProtocol();
        h.engine.registry.registerItem('api', d2bEndpoint(true));

        const res = await h.protocol.saveMetaItem({ type: 'flow', name: D2B_FLOW, item: d2bFlow('system') });

        expect(res.success).toBe(true);
        expect(storedFlows(h)).toEqual([{ row: D2B_FLOW, state: 'active', runAs: 'system' }]);
    });

    it('the endpoint is read from the `metadata` service too — the index the endpoint matcher serves from', async () => {
        const h = makeD2bProtocol(async (type) => (type === 'api' ? [d2bEndpoint(false)] : []));

        const { error } = await attempt(() => h.protocol.saveMetaItem({ type: 'flow', name: D2B_FLOW, item: d2bFlow('system') }));

        expectElevatedRefusal(error);
        expect(storedFlows(h)).toEqual([]);
    });

    it('a `metadata` service whose read fails fails the publish: "nothing names it" is never answered from a read that did not happen', async () => {
        const outage = Object.assign(new Error('metadata store unreachable'), { code: 'METADATA_STORE_UNAVAILABLE' });
        const h = makeD2bProtocol(async () => { throw outage; });

        const { error } = await attempt(() => h.protocol.saveMetaItem({ type: 'flow', name: D2B_FLOW, item: d2bFlow('system') }));

        expect(error).toBe(outage);
        expect(storedFlows(h)).toEqual([]);
    });

    it('draft mode is let through (a draft does not execute); a `migrate-stored` re-save is not judged', async () => {
        const h = makeD2bProtocol();
        h.engine.registry.registerItem('api', d2bEndpoint(false));

        const draft = await h.protocol.saveMetaItem({ type: 'flow', name: D2B_FLOW, item: d2bFlow('system'), mode: 'draft' });
        expect(draft.success).toBe(true);

        const migrated = await h.protocol.saveMetaItem({
            type: 'flow', name: D2B_FLOW, item: d2bFlow('system'), source: 'migrate-stored',
        });
        expect(migrated.success).toBe(true);
        expect(storedFlows(h)).toEqual(expect.arrayContaining([{ row: D2B_FLOW, state: 'active', runAs: 'system' }]));
    });
});

describe('[ADR-0138 D2b] the draft promotion refuses a `system` flow draft an anonymous endpoint names', () => {
    it('publishMetaItem: refused with the envelope; the draft is kept, nothing goes live', async () => {
        const h = makeD2bProtocol();
        h.engine.registry.registerItem('api', d2bEndpoint(false));
        await h.protocol.saveMetaItem({ type: 'flow', name: D2B_FLOW, item: d2bFlow('system'), mode: 'draft' });

        const { error } = await attempt(() => h.protocol.publishMetaItem({ type: 'flow', name: D2B_FLOW }));

        expectElevatedRefusal(error);
        expect(storedFlows(h)).toEqual([{ row: D2B_FLOW, state: 'draft', runAs: 'system' }]);
    });

    it('publishMetaItem CONTROL: a `user` draft beside the anonymous endpoint publishes', async () => {
        const h = makeD2bProtocol();
        h.engine.registry.registerItem('api', d2bEndpoint(false));
        await h.protocol.saveMetaItem({ type: 'flow', name: D2B_FLOW, item: d2bFlow('user'), mode: 'draft' });

        const res = await h.protocol.publishMetaItem({ type: 'flow', name: D2B_FLOW });

        expect(res.success).toBe(true);
        expect(storedFlows(h)).toEqual([{ row: D2B_FLOW, state: 'active', runAs: 'user' }]);
    });

    it('publishPackageDrafts: the refused flow draft aborts the batch with the envelope\'s code; nothing goes live', async () => {
        const PKG = 'app.intake';
        const h = makeD2bProtocol(undefined, PKG);
        h.engine.registry.registerItem('api', d2bEndpoint(false));
        await h.protocol.saveMetaItem({ type: 'flow', name: D2B_FLOW, item: d2bFlow('system'), mode: 'draft', packageId: PKG });
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.publishedCount).toBe(0);
        expect(res.failed).toEqual([expect.objectContaining({ type: 'flow', name: D2B_FLOW, code: 'INVALID_METADATA' })]);
        expect(storedFlows(h)).toEqual([{ row: D2B_FLOW, state: 'draft', runAs: 'system' }]);
    });

    it('publishPackageDrafts CONTROL: the same draft behind an authenticated endpoint publishes', async () => {
        const PKG = 'app.intake';
        const h = makeD2bProtocol(undefined, PKG);
        h.engine.registry.registerItem('api', d2bEndpoint(true));
        await h.protocol.saveMetaItem({ type: 'flow', name: D2B_FLOW, item: d2bFlow('system'), mode: 'draft', packageId: PKG });

        const res = await h.protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.outcome).toBe('published');
        expect(res.publishedCount).toBe(1);
    });
});
