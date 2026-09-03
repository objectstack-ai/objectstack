// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Ruled A on the tracker card that extended ADR-0094 D2's door enumeration to
 * the recovery doors: `rollbackMetaItem` (after its registry write-through)
 * and both limbs of `revertCommit` project with `state: 'active'` and the
 * restored body; `revertCommit`'s soft-remove limb and `deleteMetaItem`'s
 * legacy raw-engine exit project with `state: 'deleted'` — the same call
 * `deleteMetaItem`'s repository branch already makes.
 *
 * ---------------------------------------------------------------------------
 * The defect this closes
 * ---------------------------------------------------------------------------
 * `runMutationProjector` (ADR-0094) is the awaited hook that keeps a derived
 * read-model (e.g. `permission` -> `sys_permission_set`) consistent with the
 * metadata row when a write returns. Before this file's subject landed, the
 * three recovery doors restored the row and the in-memory registry but never
 * called it: a rollback (or a commit revert) left the derived record on the
 * ROLLED-BACK-FROM state until an unrelated save/publish/delete on the same
 * name, or a boot reconciliation (ADR-0094 D3), re-derived it.
 *
 * The companion file `protocol.recovery-doors-emit-mutation.test.ts` (a prior
 * card) pins the sibling half of the SAME four call sites — the
 * fire-and-forget `emitMetadataMutation` listener announcement. This file
 * pins the AWAITED projector, and — per the ruling's ordering clause — that
 * the projector runs BEFORE the listener at every one of the four sites, the
 * order `saveMetaItem`'s own comment establishes.
 *
 * ---------------------------------------------------------------------------
 * Arms and controls
 * ---------------------------------------------------------------------------
 *  • POSITIVE CONTROL (§1): `saveMetaItem`, a door that already projects,
 *    delivers under this harness's fake projector — without it a silent
 *    harness would pass every door below for want of an instrument.
 *  • THE FOUR DOORS (§2): one pin per door that the registered projector
 *    receives `state` + `body` matching the restored/removed row, AND that it
 *    ran before the mutation listener (shared ORDER log).
 *  • NEGATIVE CONTROLS (§3): no projector registered -> no throw, no
 *    behavior change (best-effort, matching `runMutationProjector`'s own
 *    contract); the soft-remove limb's row-absent miss still runs neither
 *    projector nor listener (mirrors the sibling emit file's control).
 *  • WIRE SHAPE (§4): `deleteMetaItem`'s legacy exit now carries
 *    `projectionApplied` on its success return — the SAME optional key the
 *    repository branch already declares (Clause-2: no schema move, this
 *    field already exists on the method's one shared return type).
 *    `rollbackMetaItem` / `revertCommit` carry no such field: their response
 *    types declare none today and this change adds none (Clause-2 holds
 *    there too — the projector is called and awaited, never surfaced).
 *  • STRUCTURAL GUARD (§5): `runMutationProjector` now has exactly seven call
 *    sites (was three), mirroring the sibling file's emit count.
 *
 * ---------------------------------------------------------------------------
 * Ablation, direction declared in writing BEFORE the run
 * ---------------------------------------------------------------------------
 * Removing the `rollbackMetaItem` projector call (door 1) from `protocol.ts`:
 *   -> §2's rollback case turns RED (`projected` stays empty).
 *   -> §5's structural count drops from 7 to 6 and turns RED.
 *   -> every other case stays GREEN — the other three doors, the positive
 *      control, the negative controls, and §4's wire-shape cases observe code
 *      paths the ablation does not touch.
 *   => 2 RED / (total - 2) GREEN.
 * No rebuild is involved: the import is the same-package relative
 * `./protocol.js`, so vitest compiles `src/protocol.ts` itself.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import type { MetadataMutationEvent } from './protocol.js';

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
    recorded_at?: string;
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

/** One `sys_metadata_commit` row in the driver's snake_case wire shape. */
const commitRow = (items: unknown[]) => ({
    id: 'c1',
    commit_id: 'c1',
    organization_id: null,
    operation: 'apply',
    message: 'the commit under revert',
    created_at: '2026-01-01T00:00:00Z',
    items: JSON.stringify(items),
});

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    let nextId = 0;
    const artifacts = new Map<string, unknown>();
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
            const bound = <T>(all: T[]): T[] =>
                typeof opts?.limit === 'number' ? all.slice(0, opts.limit) : all;
            if (table === 'sys_metadata_history') {
                return bound(historyRows.filter((h) => matchesHistory(h, opts?.where ?? {})));
            }
            if (table !== 'sys_metadata') return [];
            return bound(Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {})));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
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
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            unregisterObject: () => true,
            removeObjectOverlay: () => {},
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => true,
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: (type: string, name: string) => artifacts.get(`${type}|${name}`),
        },
    };
    return {
        engine,
        rows,
        serveCommit: (c: unknown) => { commit = c; },
        serveArtifact: (type: string, name: string, item: unknown) => {
            artifacts.set(`${type}|${name}`, item);
        },
    };
}

/** One recorded projector invocation, address plus the body it was handed. */
interface ProjectedEvent {
    type: string;
    name: string;
    state: 'active' | 'draft' | 'deleted';
    organizationId?: string | null;
    body?: unknown;
}

/**
 * `mode: 'bootstrap'` leaves `environmentId` UNDEFINED — the topology
 * `deleteMetaItem`'s legacy raw-engine exit requires (see the sibling emit
 * file's §3 for the measured reachability proof; not re-measured here).
 */
function makeProtocol(mode: 'environment' | 'bootstrap' = 'environment') {
    const h = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(
        h.engine, () => new Map(), mode === 'bootstrap' ? undefined : 'env_prod',
    ) as any;
    ObjectStackProtocolImplementation.resetEnvWritableCache();

    /** Shared order log — both the projector and the listener push their
     * own tag, so a case can assert `['projector', 'listener']` and catch a
     * regression that reorders them, not merely one that drops either. */
    const order: string[] = [];
    const projected: ProjectedEvent[] = [];
    protocol.registerMutationProjector('object', async (evt: ProjectedEvent) => {
        order.push('projector');
        projected.push({ ...evt });
    });
    protocol.registerMutationProjector('api', async (evt: ProjectedEvent) => {
        order.push('projector');
        projected.push({ ...evt });
    });

    const seen: MetadataMutationEvent[] = [];
    protocol.onMetadataMutation((e: MetadataMutationEvent) => {
        order.push('listener');
        seen.push({ ...e });
    });

    return { protocol, order, projected, seen, ...h };
}

const PKG = 'app.demo';

const objectBody = (name: string, label = 'Ticket') => ({
    name,
    label,
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Positive control — the instrument works
// ═══════════════════════════════════════════════════════════════════════════

describe('positive control: an already-projecting door reaches the fake projector', () => {
    it('saveMetaItem runs the projector before the listener', async () => {
        const { protocol, order, projected } = makeProtocol();

        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'),
            packageId: PKG, mode: 'publish',
        });

        expect(projected).toEqual([
            { type: 'object', name: 'ticket', state: 'active', organizationId: null, body: objectBody('ticket') },
        ]);
        expect(order).toEqual(['projector', 'listener']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The four call sites
// ═══════════════════════════════════════════════════════════════════════════

describe('door 1 — rollbackMetaItem projects the restored body', () => {
    it('runs the projector with state: active and the restored body, before the listener', async () => {
        const { protocol, order, projected } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG,
        });
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket', 'Renamed'), packageId: PKG,
        });
        order.length = 0;
        projected.length = 0;

        const res = await protocol.rollbackMetaItem({ type: 'object', name: 'ticket', toVersion: 1 });

        expect(res.success).toBe(true);
        expect(projected).toEqual([
            { type: 'object', name: 'ticket', state: 'active', organizationId: null, body: objectBody('ticket') },
        ]);
        expect(order).toEqual(['projector', 'listener']);
    });
});

describe('door 2 — revertCommit, RESTORE limb projects the pre-commit body', () => {
    it('runs the projector with state: active and the pre-commit body, before the listener', async () => {
        const { protocol, order, projected, serveCommit } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG,
        });
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket', 'Renamed'), packageId: PKG,
        });
        order.length = 0;
        projected.length = 0;
        serveCommit(commitRow([
            { type: 'object', name: 'ticket', existedBefore: true, prevVersion: 1 },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.reverted[0].action).toBe('restored');
        expect(projected).toEqual([
            { type: 'object', name: 'ticket', state: 'active', organizationId: null, body: objectBody('ticket') },
        ]);
        expect(order).toEqual(['projector', 'listener']);
    });
});

describe('door 2 — revertCommit, SOFT-REMOVE limb projects state: deleted', () => {
    it('runs the projector with state: deleted (no body), before the listener — same shape deleteMetaItem sends', async () => {
        const { protocol, order, projected, serveCommit } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG,
        });
        order.length = 0;
        projected.length = 0;
        serveCommit(commitRow([
            { type: 'object', name: 'ticket', existedBefore: false },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.reverted[0].action).toBe('removed');
        expect(projected).toEqual([
            { type: 'object', name: 'ticket', state: 'deleted', organizationId: null },
        ]);
        expect(order).toEqual(['projector', 'listener']);
    });

    it('over an already-absent row runs NEITHER the projector nor the listener', async () => {
        // Mirrors the sibling emit file's negative control: the self-heal
        // still runs, but nothing mutated, so nothing is announced or
        // projected.
        const { protocol, order, projected, serveCommit } = makeProtocol();
        serveCommit(commitRow([
            { type: 'object', name: 'ghost', existedBefore: false },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.reverted[0].action).toBe('removed');
        expect(projected).toEqual([]);
        expect(order).toEqual([]);
    });
});

describe('door 3 — deleteMetaItem’s legacy raw-engine exit projects state: deleted', () => {
    const seedCodeOnlyRow = async (engine: any, type: string, name: string) => {
        await engine.insert('sys_metadata', {
            type, name,
            organization_id: null,
            package_id: null,
            state: 'active',
            metadata: JSON.stringify({ name, label: 'Legacy residue' }),
        });
    };

    it('runs the projector with state: deleted, before the listener, and carries projectionApplied on the receipt', async () => {
        const { protocol, order, projected, engine } = makeProtocol('bootstrap');
        await seedCodeOnlyRow(engine, 'api', 'legacy_endpoint');

        const res = await protocol.deleteMetaItem({ type: 'api', name: 'legacy_endpoint' });

        expect(res.success).toBe(true);
        expect(projected).toEqual([
            { type: 'api', name: 'legacy_endpoint', state: 'deleted', organizationId: null },
        ]);
        expect(order).toEqual(['projector', 'listener']);
        // [Clause-2: no schema move] `projectionApplied` is already declared
        // on `deleteMetaItem`'s ONE shared return type (the repository
        // branch has produced it since ADR-0094 shipped) — this exit now
        // populates the same optional key, it does not add one.
        expect(res.projectionApplied).toEqual({ success: true });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Negative controls
// ═══════════════════════════════════════════════════════════════════════════

describe('no projector registered: unchanged behavior, best-effort by contract', () => {
    it('rollbackMetaItem succeeds exactly as before when the type has no registered projector', async () => {
        const { protocol, projected } = makeProtocol();
        // `view` has no projector registered by this harness (only `object`
        // and `api` do) — the exact "nothing registered for this type" arm
        // `runMutationProjector` itself documents.
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', item: { name: 'cases', type: 'grid', label: 'A', columns: ['id'], object: 'case', viewKind: 'list' },
        });
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', item: { name: 'cases', type: 'grid', label: 'B', columns: ['id'], object: 'case', viewKind: 'list' },
        });

        const res = await protocol.rollbackMetaItem({ type: 'view', name: 'cases', toVersion: 1 });

        expect(res.success).toBe(true);
        expect(projected).toEqual([]);
    });

    it('a projector that throws is caught, logged, and never fails the rollback', async () => {
        const { protocol } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG,
        });
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket', 'Renamed'), packageId: PKG,
        });
        // Overwrite the harness's recording projector with a throwing one —
        // `registerMutationProjector` replaces, one per type (idempotent
        // re-init, per its own doc comment).
        protocol.registerMutationProjector('object', async () => {
            throw new Error('boom-from-projector');
        });

        const res = await protocol.rollbackMetaItem({ type: 'object', name: 'ticket', toVersion: 1 });

        // [ADR-0094] Best-effort: never thrown, the metadata write itself
        // already succeeded. `rollbackMetaItem`'s response type declares no
        // `projectionApplied` key (Clause-2), so there is nothing further to
        // assert on the receipt — only that the throw did not propagate.
        expect(res.success).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Structural guard — mirrors the sibling emit file's §5
// ═══════════════════════════════════════════════════════════════════════════

describe('every projecting door goes through runMutationProjector', () => {
    const source = readFileSync(
        fileURLToPath(new URL('./protocol.ts', import.meta.url)),
        'utf8',
    );

    it('has exactly seven `this.runMutationProjector(` call sites — three original, four recovery-door sites', () => {
        // saveMetaItem · runPublishSideEffects · deleteMetaItem (repository)
        //   + rollbackMetaItem
        //   + revertCommit restore limb + revertCommit soft-remove limb
        //   + deleteMetaItem (legacy raw-engine)
        const callSites = source.match(/this\.runMutationProjector\(/g) ?? [];
        expect(callSites).toHaveLength(7);
        // Non-vacuity: the declaration is not one of them.
        expect(source.match(/private async runMutationProjector\(/g) ?? []).toHaveLength(1);
    });

    it('listCommits is untouched by this change — the fenced-off symbol stays out of this file’s reach', () => {
        // [Fence] #14038 owns `listCommits` and its emitters on this same hot
        // file. This card's four sites are `rollbackMetaItem`, both limbs of
        // `revertCommit`, and `deleteMetaItem`'s legacy exit — nowhere near
        // it. Pinned here as a boundary marker, not a behavioral spec of
        // `listCommits` itself.
        const start = source.indexOf('async listCommits(');
        expect(start).toBeGreaterThan(-1);
        const nextMethod = source.indexOf('\n    async ', start + 1);
        const body = source.slice(start, nextMethod > -1 ? nextMethod : start + 4000);
        expect(body).not.toContain('runMutationProjector');
    });
});
