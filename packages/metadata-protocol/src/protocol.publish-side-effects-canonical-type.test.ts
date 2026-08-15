// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8820] `runPublishSideEffects` hands `ensureObjectStorage` the FOLDED type.
//
// ---------------------------------------------------------------------------
// What this file pins, and why it exists at all
// ---------------------------------------------------------------------------
// `runPublishSideEffects` is Phase 2 of a publish, and it is reached from TWO
// callers: `publishMetaItem` (single-item, folded at the `/meta` boundary) and
// `publishPackageDrafts` (Studio's "publish whole app", which feeds it draft
// rows read straight out of `sys_metadata`). Until #8820 it took BOTH a folded
// `singularType` and an unfolded `requestType`, and `ensureObjectStorage` was
// the sole consumer of the unfolded one — a spelling-tolerant lookup one layer
// below a boundary that already folds, the shape `canonicalMetaType`'s header
// has rejected since #4432.
//
// The batch publish path had NO coverage of the table-DDL side effect at all,
// which is the reason this file exists. That gap is not incidental: it was
// measured on #8820 at `fd6bdf89f` by deleting `ensureObjectStorage`'s
// `'objects'` limb and running the whole package — 98 files / 1444 tests, green
// before and green after. A green suite could not tell the two states apart.
//
// ---------------------------------------------------------------------------
// The reachability question, measured rather than assumed
// ---------------------------------------------------------------------------
// #8820 was filed claiming the `'objects'` limb was dormant because "both call
// sites stand behind a fold". That reasoning is wrong — the second call site
// sits inside this helper, whose batch caller does NOT fold. But the conclusion
// survives for a DIFFERENT reason, and the difference is the whole content of
// the third case below: a draft row stored under a plural `type` cannot be
// promoted at all. `promoteDraftForPublish` addresses the row by its folded
// singular and `SysMetadataRepository.whereFor` emits that spelling verbatim
// with no at-rest fallback, so the promote raises `NO_DRAFT` and the
// all-or-nothing batch (ADR-0067 D2) aborts before Phase 2 ever runs.
//
// So the unfolded value could not carry a plural into the side effects by the
// ordinary route — but nothing in the type system or the call graph said so,
// and the helper's own parameter list advertised the opposite. #8820 removes
// the parameter rather than relying on that argument staying true.
//
// ---------------------------------------------------------------------------
// Ablation directions, predicted BEFORE running (see the PR body for results)
// ---------------------------------------------------------------------------
//   1. Ship state (fold + limb present)                        → GREEN
//   2. Fold kept, `'objects'` limb deleted                      → GREEN
//      (the limb is dead ONCE the producer folds — this is what
//       licenses its removal as a separate, provable follow-up)
//   3. Fold reverted to the unfolded value, limb deleted        → GREEN
//      (because case 3's plural row never reaches Phase 2 — the
//       abort in case 3 below is what makes this a coverage pin
//       and not a regression pin)
//   4. `ensureObjectStorage` guard inverted to accept ONLY
//      `'objects'`                                              → RED
//      (the non-vacuity control: proves cases 1-2 really observe
//       this helper calling `syncObjectSchema` with the folded
//       spelling, rather than passing for want of an assertion)

import { describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, imported from
// `@objectstack/metadata-core` and NOT from `@objectstack/objectql`: objectql
// depends on this package, so that import would close a dependency cycle turbo
// rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
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
    recorded_at: string;
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

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    let nextId = 0;
    /**
     * The observation channel this file is about: every name handed to the
     * driver's schema sync, in call order. `ensureObjectStorage` is the only
     * caller of it on a publish, so this doubles as "did Phase 2's DDL step
     * run, and under which spelling did it decide to".
     */
    const syncedObjects: string[] = [];

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

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => {
                    const w = opts.where;
                    if (w.type !== undefined && h.type !== w.type) return false;
                    if (w.name !== undefined && h.name !== w.name) return false;
                    if (w.version !== undefined && h.version !== w.version) return false;
                    if (w.organization_id !== undefined && h.organization_id !== w.organization_id) return false;
                    return true;
                }) ?? null;
            }
            if (table === 'sys_metadata_commit') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') return historyRows;
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {}));
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
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        syncObjectSchema: vi.fn(async (name: string) => {
            syncedObjects.push(name);
            return true;
        }),
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
        },
    };
    return { engine, rows, syncedObjects };
}

function makeProtocol() {
    const { engine, rows, syncedObjects } = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod') as any;
    return { protocol, rows, syncedObjects, engine };
}

const PKG = 'app.demo';

/**
 * An object body that clears the authoring gates the publish path runs before
 * it reaches Phase 2 — [#8308] authored OWD, and at least one field.
 */
const objectBody = (name: string) => ({
    name,
    label: 'Ticket',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

/**
 * Write a draft row through the REPOSITORY, which stamps `type` exactly as
 * given — the only way to produce a row whose stored spelling is plural, since
 * `saveMetaItem` folds before it persists. This is what a row written before
 * the #4432 boundary fold looks like at rest, and nothing rewrites it on
 * upgrade (`canonicalMetaType`'s header says so explicitly).
 */
async function seedDraftRowVerbatim(
    protocol: any,
    args: { type: string; name: string; body: unknown; packageId: string },
): Promise<void> {
    await protocol.ensureOverlayIndex();
    const repo = protocol.getOverlayRepo(null);
    await repo.put(
        { type: args.type, name: args.name, org: 'env' },
        args.body,
        {
            parentVersion: null,
            actor: null,
            source: 'test.at-rest-residue',
            intent: 'runtime-only',
            state: 'draft',
            packageId: args.packageId,
        },
    );
}

describe('[#8820] publish Phase 2 resolves the object table from the folded type', () => {
    it('single-item publish syncs the table (the path that always folded)', async () => {
        const { protocol, syncedObjects } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG, mode: 'draft',
        });

        const res = await protocol.publishMetaItem({ type: 'object', name: 'ticket' });

        expect(res.success).toBe(true);
        expect(syncedObjects).toEqual(['ticket']);
    });

    // ── the coverage this card was filed against: the batch path's DDL step ──
    //
    // Studio's "publish whole app" reaches `ensureObjectStorage` through
    // `runPublishSideEffects`, and NOTHING asserted that before #8820. The
    // deletion the card proposed would have been invisible to the entire
    // package suite; this case is what makes it visible.
    it('batch publish syncs the table for every promoted object', async () => {
        const { protocol, syncedObjects } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG, mode: 'draft',
        });
        await protocol.saveMetaItem({
            type: 'object', name: 'invoice', item: objectBody('invoice'), packageId: PKG, mode: 'draft',
        });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.success).toBe(true);
        expect(res.publishedCount).toBe(2);
        // Both objects' tables were synced — the side effect the card's
        // proposed deletion would have skipped, on the route with no coverage.
        expect([...syncedObjects].sort()).toEqual(['invoice', 'ticket']);
    });

    // ── why the `'objects'` limb could not be reached from here ──────────────
    //
    // This is the case that corrects #8820's stated reasoning. A plural row at
    // rest does not sail through Phase 2 under a tolerant guard; it never
    // reaches Phase 2, because the promote addresses it by its folded singular
    // and the repository does not fall back to the other spelling at rest.
    it('a draft row stored under a PLURAL type aborts the batch before Phase 2', async () => {
        const { protocol, syncedObjects } = makeProtocol();
        await seedDraftRowVerbatim(protocol, {
            type: 'objects', name: 'legacy_ticket', body: objectBody('legacy_ticket'), packageId: PKG,
        });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.publishedCount).toBe(0);
        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]).toMatchObject({ type: 'objects', name: 'legacy_ticket', code: 'NO_DRAFT' });
        // The DDL step never ran: Phase 2 is downstream of the promote, and the
        // batch is all-or-nothing (ADR-0067 D2).
        expect(syncedObjects).toEqual([]);
    });

    // ── non-vacuity control ─────────────────────────────────────────────────
    //
    // The two green cases above assert a call that a silently-skipped side
    // effect would leave absent, so they cannot pass vacuously — but they also
    // cannot distinguish WHICH spelling reached the guard, which is the thing
    // #8820 changed. This case pins the spelling directly at the seam.
    it('Phase 2 hands the guard the canonical singular, not the request spelling', async () => {
        const { protocol } = makeProtocol();
        const seen: string[] = [];
        protocol.ensureObjectStorage = async (type: string, name: string) => { seen.push(`${type}/${name}`); };
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG, mode: 'draft',
        });

        // Addressed with the PLURAL url spelling, which the `/meta` boundary
        // folds on the way in — so Phase 2 must see `object`, never `objects`.
        await protocol.publishMetaItem({ type: 'objects', name: 'ticket' });

        expect(seen).toEqual(['object/ticket']);
    });
});
