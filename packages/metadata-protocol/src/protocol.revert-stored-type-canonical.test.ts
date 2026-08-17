// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#9174] `revertCommit` refuses a non-canonical STORED type on its restore
// limb — the third at-rest door joining the two that already name this class
// on the wire.
//
// ---------------------------------------------------------------------------
// The question this file answers
// ---------------------------------------------------------------------------
// `isNonCanonicalStoredType` (#8908) names a six-member class of stored
// spellings whose type the manifest-collection map omits — `fields`, `seeds`,
// `external_catalogs`, `externalCatalogs`, `translations`, `email_templates`.
// Two doors that consume an at-rest `type` already answer for it by name:
//
//   • `publishPackageDrafts` — pre-flight refusal, `failed[].code` of
//     `STORED_TYPE_NOT_CANONICAL`, batch-atomic (#8908);
//   • `migrateStoredMetadata` — the row reported `outcome: 'skipped'` with the
//     same reason stated in full (#8957).
//
// `revertCommit` is the third consumer and had no such gate. It is the route
// #9111 traced as producer 5 and left explicitly UNGUARDED.
//
// ---------------------------------------------------------------------------
// What was MEASURED at HEAD, per limb, before any shape was chosen
// ---------------------------------------------------------------------------
// Driven end to end over the real `SysMetadataRepository` on an UNSCOPED
// kernel (the only one where the overlay-hydration limb runs at all), with a
// `fields/showcase_task.title` row at rest:
//
//   RESTORE limb (`existedBefore: true`, `prevVersion: 1`)
//     -> { success: true, revertedCount: 1, failedCount: 0,
//          reverted: [ { type: 'fields', …, action: 'restored' } ], failed: [] }
//        `registerItem` called ZERO times. The only trace anywhere:
//        `[Protocol] registry write-through failed for fields/showcase_task.title:
//         [registry_type_not_canonical] Refusing to register a SchemaRegistry
//         overlay entry under the non-canonical metadata type 'fields' …`
//        on the server's stderr. The receipt claims the pre-commit body is what
//        the platform now serves; for this class it cannot be — #9111's mint
//        door refuses the entry and boot refuses it too, so the restored body
//        reaches no reader at all.
//
//   SOFT-REMOVE limb (`existedBefore: false`)
//     -> { success: true, reverted: [ { …, action: 'removed' } ], failed: [] },
//        the row GONE from `sys_metadata`, no warning emitted, no registry key
//        touched. Nothing about that outcome is wrong.
//
// ---------------------------------------------------------------------------
// Which sibling shape this matches, and why REFUSE rather than DECLINE
// ---------------------------------------------------------------------------
// `saveMetaItem`'s: a wire-visible coded refusal, carried on this door's
// EXISTING per-item `failed[]` channel — the same one `VERSION_NOT_FOUND`,
// `ITEM_LOCKED` and `NOT_OVERRIDABLE` already ride. No new receipt surface, no
// new error code (`STORED_TYPE_NOT_CANONICAL` is already this package's, and
// already in the ledger).
//
// The test that separates the two siblings is whether the door can do what it
// PROMISES for this row. `migrateStoredMetadata` declines because rewriting a
// stored type spelling is an identity move and is out of that pass's reach
// entirely — nothing is refused, which is why `skipped` must not poison
// `storedMigrationClean` for a scan that runs forever. Here the write is
// squarely IN reach: the restore succeeds at the row and still delivers none of
// what `restored` promises. That is `saveMetaItem`'s case — a write this door is
// able to perform and must not — so it is refused, and `success` goes false
// because the commit the operator asked to undo was not undone. A one-shot
// operator action has no forever to poison.
//
// ⛔ Deliberately NOT on the soft-remove limb (section 2). That limb performs
// its promise exactly and completely, and the removal is the one action that
// reduces this residue; refusing it would answer `success: false` for a revert
// that fully succeeded and would hand back an instruction naming the very
// operation it had just declined to perform. #8908's own predicate is scoped
// the same way for the same reason.
//
// ⛔ No fold, no audit row, no commit-record entry for a refused item
// (sections 1 and 4) — #9161's ruling keeps the caller's spelling on the ledger
// keys unfolded so `AUDIT_TYPE_NOT_CANONICAL` fires loudly, and this gate
// touches none of them.
//
// ---------------------------------------------------------------------------
// Ablation directions, predicted BEFORE running — and what actually happened
// ---------------------------------------------------------------------------
//   1. Ship state                      predicted GREEN -> GREEN (10/10)
//   2. The pre-flight block deleted    predicted RED §1 -> RED, 6 failed
//      ⚠️ BROADER than predicted, and the prediction was the wrong shape: §4
//      goes red with §1, because a gate that refuses nothing lets the item back
//      into `reverted[]` and therefore into the append-only revert commit. That
//      is the leg's own point, so it is recorded as observed rather than
//      trimmed to the prediction. §2 and §3 stayed GREEN, which is the half
//      that matters: removing the gate changes nothing about the soft-remove
//      limb or about the rows that are not this defect.
//      This leg IS the pre-fix measurement quoted above.
//      ⚠️ It also ran RED-but-unreadable the first time, on eight tests, for a
//      reason that had nothing to do with the ablation — see `spyWarn` below.
//   3. `restoreToVersion !== null &&` dropped
//      from the gate — the soft-remove limb
//      refused too                     predicted RED §2 -> RED, exactly 1
//      failed: "removes a commit-created non-canonical row and reports
//      success". The obvious simplification, and this is its price.
//   4. Predicate swapped to the complete
//      `canonicalMetaType(t) !== t`    predicted RED §3 -> RED, exactly 1
//      failed: "a manifest-PRESENT plural is NOT refused". The narrow at-rest
//      predicate is load-bearing — `views`/`objects` fold in the manifest map,
//      so those rows revert AND register correctly today and are not this
//      defect.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLURAL_TO_SINGULAR, canonicalMetaUrlType } from '@objectstack/spec/shared';
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
    package_id: 'app.demo',
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
    /** Every `registerItem` key, in call order — the registry observation channel. */
    const registeredItems: Array<{ type: string; name: unknown }> = [];
    /** Rows the revert appends to the ADR-0067 commit ledger. */
    const commitLedger: Array<Record<string, unknown>> = [];
    /** Rows the revert appends to the ADR-0010 audit ledger (expected: none). */
    const auditLedger: Array<Record<string, unknown>> = [];
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
            if (table === 'sys_metadata_commit') return commit;
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matchesHistory(h, opts?.where ?? {}));
            }
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {}));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_commit') {
                commitLedger.push(data);
                return { id: String(data.id ?? 'commit_row') };
            }
            if (table === 'sys_metadata_audit') {
                auditLedger.push(data);
                return { id: 'audit_row' };
            }
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
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        registry: {
            registerItem: (type: string, item: any) => {
                registeredItems.push({ type, name: item?.name });
            },
            registerObject: () => undefined,
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => undefined,
        },
    };
    return {
        engine,
        rows,
        registeredItems,
        commitLedger,
        auditLedger,
        serveCommit: (c: unknown) => { commit = c; },
    };
}

function makeProtocol() {
    const h = makeStubEngine();
    // `environmentId` UNDEFINED — the unscoped (control-plane) kernel. On a
    // scoped one `applyRegistryWriteThrough` returns before the hydration limb,
    // so the pre-fix defect would not even be reachable to compare against.
    const protocol = new ObjectStackProtocolImplementation(h.engine, () => new Map(), undefined) as any;
    return { protocol, ...h };
}

/**
 * Write a row through the REPOSITORY, which stamps `type` exactly as given —
 * the only way to produce a row whose STORED spelling is non-canonical, since
 * every `/meta` entry point folds before it persists. This is what a pre-#7894
 * row looks like at rest, and nothing rewrites it on upgrade.
 */
async function seedRowVerbatim(
    protocol: any,
    args: { type: string; name: string; body: unknown },
): Promise<void> {
    await protocol.ensureOverlayIndex();
    const repo = protocol.getOverlayRepo(null);
    const ref = { type: args.type, name: args.name, org: 'env' };
    // Successive writes to one identity build the lineage a revert restores
    // from, so each must present the CURRENT head as its parent.
    const existing = await repo.get(ref, { state: 'active' });
    await repo.put(ref, args.body, {
        parentVersion: existing?.hash ?? null,
        actor: null,
        source: 'test.at-rest-residue',
        intent: 'runtime-only',
        state: 'active',
    });
}

const bodyAt = (name: string, label: string) => ({ name, label });

/** The stored body of `type/name`, or `undefined` when no row is left. */
const storedBody = (rows: Map<string, Row>, type: string, name: string): any => {
    for (const r of rows.values()) {
        if (r.type === type && r.name === name) return JSON.parse(r.metadata);
    }
    return undefined;
};

/**
 * Silence and observe `console.warn` — the channel this card is about.
 *
 * ⛔ Restored from `afterEach`, never from the test body. A body-tail
 * `mockRestore()` is skipped the moment an assertion above it throws, so the
 * spy survives into the NEXT test and accumulates its calls — measured here
 * while running ablation 2: four tests that have nothing to do with the
 * ablation went red on warnings emitted by earlier ones, and the ablation
 * direction was unreadable until this was fixed. A leg that cannot be read is
 * a leg that was not run.
 */
const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

afterEach(() => {
    vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. The RESTORE limb is refused, by name, on the wire
// ═══════════════════════════════════════════════════════════════════════════

describe('[#9174] revertCommit refuses a non-canonical stored type on the restore limb', () => {
    it('answers a wire-visible `failed[].code` and restores nothing', async () => {
        const warn = spyWarn();
        const { protocol, registeredItems, serveCommit } = makeProtocol();
        await seedRowVerbatim(protocol, {
            type: 'fields', name: 'showcase_task.title', body: bodyAt('showcase_task.title', 'V1'),
        });
        await seedRowVerbatim(protocol, {
            type: 'fields', name: 'showcase_task.title', body: bodyAt('showcase_task.title', 'V2'),
        });
        registeredItems.length = 0;
        serveCommit(commitRow([
            { type: 'fields', name: 'showcase_task.title', existedBefore: true, prevVersion: 1 },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        // The receipt, not merely "it did not restore": the code is what a
        // caller filters on and what makes this door agree with its siblings.
        expect(res.failed).toHaveLength(1);
        expect(res.failed[0].code).toBe('STORED_TYPE_NOT_CANONICAL');
        expect(res.failedCount).toBe(1);
        expect(res.revertedCount).toBe(0);
        expect(res.reverted).toEqual([]);
        // An item the operator asked to undo was not undone.
        expect(res.success).toBe(false);
    });

    it('names the row, the canonical type, and what to do about it', async () => {
        const warn = spyWarn();
        const { protocol, serveCommit } = makeProtocol();
        await seedRowVerbatim(protocol, {
            type: 'translations', name: 'legacy_bundle', body: bodyAt('legacy_bundle', 'V1'),
        });
        await seedRowVerbatim(protocol, {
            type: 'translations', name: 'legacy_bundle', body: bodyAt('legacy_bundle', 'V2'),
        });
        serveCommit(commitRow([
            { type: 'translations', name: 'legacy_bundle', existedBefore: true, prevVersion: 1 },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        const text = String(res.failed[0].error);
        // The stored spelling AND the canonical one — the operator cannot act
        // on either alone.
        expect(text).toContain("'translations/legacy_bundle'");
        expect(text).toContain(`'${canonicalMetaUrlType('translations')}'`);
        // The actionable instruction the two sibling doors already give.
        expect(text).toContain(`PUT /meta/${canonicalMetaUrlType('translations')}/legacy_bundle`);
        // …and the pointer that the migrate door cannot fix it either (#8957),
        // so the operator does not bounce between two doors.
        expect(text).toContain('_migrate-stored');
    });

    it('leaves the row at rest untouched and the registry unwritten — and emits no warning', async () => {
        const warn = spyWarn();
        const { protocol, registeredItems, rows, serveCommit } = makeProtocol();
        await seedRowVerbatim(protocol, {
            type: 'fields', name: 'showcase_task.title', body: bodyAt('showcase_task.title', 'V1'),
        });
        await seedRowVerbatim(protocol, {
            type: 'fields', name: 'showcase_task.title', body: bodyAt('showcase_task.title', 'V2'),
        });
        registeredItems.length = 0;
        serveCommit(commitRow([
            { type: 'fields', name: 'showcase_task.title', existedBefore: true, prevVersion: 1 },
        ]));

        await protocol.revertCommit({ commitId: 'c1' });

        // Refused UP FRONT: the head body is still V2. Pre-fix this was V1 —
        // the write happened and only the registry half was refused.
        expect(storedBody(rows, 'fields', 'showcase_task.title')?.label).toBe('V2');
        expect(registeredItems).toEqual([]);
        // The `console.warn` IS the defect this card names. Nothing on this
        // path may reach `applyRegistryWriteThrough`'s best-effort catch now —
        // asserted as "not one warning from this call", so a RENAMED warning
        // cannot slip past a substring match.
        expect(warn).not.toHaveBeenCalled();
    });

    it('carries the caller’s spelling into `failed[]` UNFOLDED (#9161)', async () => {
        const warn = spyWarn();
        const { protocol, serveCommit } = makeProtocol();
        await seedRowVerbatim(protocol, { type: 'fields', name: 'a.b', body: bodyAt('a.b', 'V1') });
        await seedRowVerbatim(protocol, { type: 'fields', name: 'a.b', body: bodyAt('a.b', 'V2') });
        serveCommit(commitRow([{ type: 'fields', name: 'a.b', existedBefore: true, prevVersion: 1 }]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        // The refusal must not "helpfully" fold: the item's identity in the
        // receipt is the spelling the row really carries, which is the fact the
        // operator has to act on. Folding here is what #9161 ruled against on
        // the ledger keys, and the same reasoning holds for the receipt.
        expect(res.failed[0].type).toBe('fields');
        expect(res.failed[0].name).toBe('a.b');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The SOFT-REMOVE limb is deliberately outside the gate
// ═══════════════════════════════════════════════════════════════════════════
//
// Ablation 3 is this section's reason to exist: dropping `willRestore &&` from
// the gate is the "obvious simplification", and it costs the operator the one
// operation that reduces this residue.

describe('[#9174] the soft-remove limb keeps reverting, and says so', () => {
    it('removes a commit-created non-canonical row and reports success', async () => {
        const warn = spyWarn();
        const { protocol, rows, serveCommit } = makeProtocol();
        await seedRowVerbatim(protocol, {
            type: 'fields', name: 'legacy_only', body: bodyAt('legacy_only', 'V1'),
        });
        serveCommit(commitRow([
            { type: 'fields', name: 'legacy_only', existedBefore: false, prevVersion: null },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.failed).toEqual([]);
        expect(res.reverted).toEqual([{ type: 'fields', name: 'legacy_only', action: 'removed' }]);
        expect(res.success).toBe(true);
        // The row is GONE — the undo the operator asked for, performed in full,
        // and the one action that makes this residue smaller.
        expect(storedBody(rows, 'fields', 'legacy_only')).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The gate's edges — what it must NOT refuse
// ═══════════════════════════════════════════════════════════════════════════

describe('[#9174] the pre-flight fires on exactly the at-rest class', () => {
    it('a canonical type still reverts and still registers under its own key', async () => {
        const warn = spyWarn();
        const { protocol, registeredItems, rows, serveCommit } = makeProtocol();
        await seedRowVerbatim(protocol, { type: 'view', name: 'grid', body: bodyAt('grid', 'V1') });
        await seedRowVerbatim(protocol, { type: 'view', name: 'grid', body: bodyAt('grid', 'V2') });
        registeredItems.length = 0;
        serveCommit(commitRow([{ type: 'view', name: 'grid', existedBefore: true, prevVersion: 1 }]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.failed).toEqual([]);
        expect(res.success).toBe(true);
        expect(storedBody(rows, 'view', 'grid')?.label).toBe('V1');
        // Non-vacuity for the whole file: the write-through really does run on
        // this path, so section 1's empty `registeredItems` is a refusal rather
        // than a harness that never registers anything.
        expect(registeredItems).toEqual([{ type: 'view', name: 'grid' }]);
        expect(warn).not.toHaveBeenCalled();
    });

    it('a manifest-PRESENT plural is NOT refused — it is not this defect', async () => {
        const warn = spyWarn();
        const { protocol, registeredItems, serveCommit } = makeProtocol();
        // External dependency of the verdict, pinned rather than assumed: the
        // manifest fold resolves `views`, so the restore limb hands the
        // write-through the CANONICAL key and the entry lands correctly.
        expect(PLURAL_TO_SINGULAR.views).toBe('view');
        await seedRowVerbatim(protocol, { type: 'views', name: 'legacy_grid', body: bodyAt('legacy_grid', 'V1') });
        await seedRowVerbatim(protocol, { type: 'views', name: 'legacy_grid', body: bodyAt('legacy_grid', 'V2') });
        registeredItems.length = 0;
        serveCommit(commitRow([{ type: 'views', name: 'legacy_grid', existedBefore: true, prevVersion: 1 }]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        // Widening the predicate to the complete `canonicalMetaType(t) !== t`
        // would change a wire-visible `failed[].code` for rows that are NOT
        // this defect — #8908's own scoping argument, one door over.
        expect(res.failed).toEqual([]);
        expect(res.reverted).toEqual([{ type: 'views', name: 'legacy_grid', action: 'restored' }]);
        expect(registeredItems).toEqual([{ type: 'view', name: 'legacy_grid' }]);
    });

    it('the fold-map disagreement the gate rests on is real', () => {
        // The gate's value dies the day these two maps stop disagreeing, so the
        // disagreement is pinned here rather than assumed. Filtered against the
        // live map — a hand-written list ships with members missing (#8908
        // measured exactly that) and no way to notice.
        const blind = ['fields', 'seeds', 'external_catalogs', 'externalCatalogs', 'translations', 'email_templates']
            .filter((s) => (PLURAL_TO_SINGULAR[s] ?? s) === s);
        expect(blind.length).toBeGreaterThan(0);
        for (const spelling of blind) {
            expect(canonicalMetaUrlType(spelling), `${spelling} must fold at the URL map`).not.toBe(spelling);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The ledgers, and the neighbours
// ═══════════════════════════════════════════════════════════════════════════

describe('[#9174] a refused item touches no ledger key and stops no neighbour', () => {
    it('is absent from the append-only revert commit, which records only what was reverted', async () => {
        const warn = spyWarn();
        const { protocol, commitLedger, auditLedger, serveCommit } = makeProtocol();
        await seedRowVerbatim(protocol, { type: 'fields', name: 'a.b', body: bodyAt('a.b', 'V1') });
        await seedRowVerbatim(protocol, { type: 'fields', name: 'a.b', body: bodyAt('a.b', 'V2') });
        serveCommit(commitRow([{ type: 'fields', name: 'a.b', existedBefore: true, prevVersion: 1 }]));

        await protocol.revertCommit({ commitId: 'c1' });

        // The revert commit is built from `reverted[]`, so a refused item is
        // simply not in it — the ledger never claims an undo that did not
        // happen, and no spelling was folded to put it there.
        expect(commitLedger).toHaveLength(1);
        expect(JSON.parse(String(commitLedger[0].items))).toEqual([]);
        // ⛔ And no audit row: this function writes none for ANY of its per-item
        // failures, and a row minted only for this class would need the type
        // FOLDED to be readable — the one move #9161 rules out here.
        expect(auditLedger).toEqual([]);
    });

    it('reverts the neighbours of a refused item and reports the mix honestly', async () => {
        const warn = spyWarn();
        const { protocol, rows, commitLedger, serveCommit } = makeProtocol();
        await seedRowVerbatim(protocol, { type: 'view', name: 'grid', body: bodyAt('grid', 'V1') });
        await seedRowVerbatim(protocol, { type: 'view', name: 'grid', body: bodyAt('grid', 'V2') });
        await seedRowVerbatim(protocol, { type: 'fields', name: 'a.b', body: bodyAt('a.b', 'V1') });
        await seedRowVerbatim(protocol, { type: 'fields', name: 'a.b', body: bodyAt('a.b', 'V2') });
        serveCommit(commitRow([
            { type: 'view', name: 'grid', existedBefore: true, prevVersion: 1 },
            { type: 'fields', name: 'a.b', existedBefore: true, prevVersion: 1 },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        // Per ITEM, like every other verdict in this loop: one refusal does not
        // abort the batch (that is the publish door's ADR-0067 D2 posture, and
        // this door has no transaction to be atomic over).
        expect(res.revertedCount).toBe(1);
        expect(res.failedCount).toBe(1);
        expect(res.success).toBe(false);
        expect(storedBody(rows, 'view', 'grid')?.label).toBe('V1');
        expect(storedBody(rows, 'fields', 'a.b')?.label).toBe('V2');
        expect(JSON.parse(String(commitLedger[0].items))).toEqual([
            { type: 'view', name: 'grid', existedBefore: true, prevVersion: null },
        ]);
    });
});
