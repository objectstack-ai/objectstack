// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8400] `publishPackageDrafts` — Studio's "publish whole app" — wrote NO
// `sys_metadata_audit` rows at all.
//
// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------
// #7748 fixed the SINGLE-ITEM routes: `publishMetaItem` writes a
// `publish`/`allowed` row, `rollbackMetaItem` a `rollback`/`allowed` row, and
// all four 409 sites a `denied` row. `publishPackageDrafts` calls
// `promoteDraftForPublish` DIRECTLY, so none of that ran for it: a batch that
// promoted twenty artifacts left the trail exactly as empty as a batch nobody
// ever ran.
//
// ---------------------------------------------------------------------------
// Why the fix is a PLACEMENT and not just "add an insert"
// ---------------------------------------------------------------------------
// This route promotes every draft inside ONE `engine.transaction()` — ADR-0067
// D2, "a commit cannot half-land". An audit row written in there rolls back
// with the batch. For an allowed publish that is arguably right; for the
// REFUSAL THAT CAUSED THE ROLLBACK it is exactly wrong, because the trail would
// once again record nothing about a refused write — the defect #7748 exists to
// close, reintroduced one route over. So both outcomes are written in Phase 2,
// after the transaction has closed, driven off `promoted[]` and off the `catch`.
//
// That argument is only worth anything if this file can MEASURE it, which is
// why the fake engine below has a `transaction()` that really rolls back (see
// the next section) instead of the usual passthrough. Under a passthrough,
// writing the audit rows inside the transaction would pass every assertion
// here — vacuity of exactly the kind this card warns about, one level up from
// the `audit_skip` trap.
//
// ---------------------------------------------------------------------------
// ⚠️ Why this file's fake engine does NOT short-circuit the audit insert
// ---------------------------------------------------------------------------
// Most multi-table stubs in this repo open `insert` with
//
//     if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
//
// which is correct for a suite about something else — and makes every assertion
// in THIS file vacuous, because it reports "no audit rows" identically before
// and after the fix. The engine below persists audit rows like any other table.
// `control: …harness really persists audit rows` is the positive control that
// proves the number 0 means something here, and it exercises the ONE site that
// already worked before this card (`save`), so it must stay green under a
// revert of the production edits.
//
// ---------------------------------------------------------------------------
// Three states, not two: never-tried / attempted-and-rolled-back / landed
// ---------------------------------------------------------------------------
// `recordMetadataAudit` is best-effort by contract (ADR-0010 §3.6) — it catches
// its own insert failure and `console.warn`s. On top of that, this route's
// transaction can undo a landed row. So the harness tracks:
//
//   `auditRows`     — rows that LANDED and survived (rolled back with the txn).
//   `auditAttempts` — every insert AIMED at the audit table, deliberately NOT
//                     rolled back and not suppressed by a simulated failure.
//                     It is an out-of-band observation channel, like a spy: it
//                     is what separates "nothing ever tried to write it" (the
//                     defect) from "written inside the transaction and undone"
//                     (the wrong placement) from "the table rejected it".
//
// The two facts are asserted against each other in the locked-item case, which
// is the sharpest measurement in this file: `assertLockAllowsWrite` writes its
// `item_locked` denial from INSIDE the batch transaction, so that row is
// ATTEMPTED and then rolled away, while the `batch_aborted` row this card adds
// is written from the `catch` and survives. One refusal, two audit writes, two
// different fates — decided entirely by which side of the transaction they sit
// on.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// See the PR body for prediction vs. measurement.
//
// ---------------------------------------------------------------------------
// [#8594] One assertion in here was MEASURING the defect, and was inverted
// ---------------------------------------------------------------------------
// The locked-item case above ended on
//
//     expect(h.auditRows.some((a) => a.code === 'item_locked')).toBe(false);
//
// which pinned the fact that the INNER verdict's row was destroyed by the
// rollback its own refusal caused — a true statement about `main` on the day it
// was written, and the defect #8594 exists to close, not a contract. It now
// reads `.toBe(true)`, deliberately, and the second `describe` at the bottom of
// this file asserts that row in full (its `code`, its `lock_state`, its route),
// plus the `metadata_conflict` sibling that had no coverage at all.
//
// An inversion on its own would be satisfied by a "fix" that stopped rolling
// anything back, so every case that asserts a surviving denial also asserts
// ADR-0067 D2 in the same breath — nothing promoted, no commit row, no
// `allowed` row. See that block's header.

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

/** The ADR-0048 overlay key — draft and active rows for one identity coexist. */
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
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

type Harness = {
    engine: any;
    rows: Map<string, Row>;
    historyRows: HistoryRow[];
    commitRows: any[];
    /**
     * Arm a driver fault on every `sys_metadata` write for this item name.
     * Mutable so a test can stage its drafts through a healthy engine and break
     * it only for the batch under test.
     *
     * [#8594] `advanceActiveOnRead` arms an OPTIMISTIC-LOCK race instead of a
     * driver fault: a rival author advancing the active row in the window
     * between the two reads `promoteDraft` makes (`get` for the parent version,
     * then `put`'s own read inside its transaction), which is exactly the
     * 409 `METADATA_CONFLICT` the repository raises. Scoped to package-scoped
     * active reads so the pre-flight `commitItems` scan — which reads active
     * rows WITHOUT a `package_id` — does not consume the one-shot.
     */
    faults: { failMetadataWriteFor?: string; advanceActiveOnRead?: string };
    /** Audit rows that LANDED and were not rolled back. */
    auditRows: any[];
    /**
     * Every insert AIMED at `sys_metadata_audit` — including ones that threw
     * and ones a rollback later undid. Never rolled back: this is the
     * observation channel, not persisted state.
     */
    auditAttempts: any[];
};

function makeStubEngine(opts: { failAudit?: boolean } = {}): Harness {
    const faults: { failMetadataWriteFor?: string; advanceActiveOnRead?: string } = {};
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    const commitRows: any[] = [];
    const auditRows: any[] = [];
    const auditAttempts: any[] = [];
    let nextId = 0;
    let txDepth = 0;

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

    const driverFault = () => Object.assign(
        new Error('SQLITE_ERROR: no such table: sys_metadata'),
        { code: 'SQLITE_ERROR' },
    );

    const engine: any = {
        async findOne(table: string, opts2: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts2.where)) ?? null;
            }
            if (table === 'sys_metadata_commit') return null;
            const hit = findRow(opts2.where);
            if (!hit) return null;
            // [#8594] The rival author lands BETWEEN the two reads. THIS read is
            // answered with the row as it stood (the snapshot below), and the
            // stored row is advanced immediately after — so the next read, the
            // one `put` makes inside its own transaction, sees a different
            // checksum, the parent-version check fails, and the repository
            // raises the ConflictError that really produces `metadata_conflict`.
            if (faults.advanceActiveOnRead === hit.row.name
                && opts2.where?.state === 'active'
                && 'package_id' in (opts2.where ?? {})) {
                delete faults.advanceActiveOnRead;
                const asItStood = { ...hit.row };
                hit.row.checksum = 'sha256:advanced_by_a_rival';
                return asItStood;
            }
            return hit.row;
        },
        async find(table: string, opts2: { where: Record<string, unknown>; orderBy?: any; limit?: number }) {
            if (table === 'sys_metadata_audit') {
                // The read side `auditMetaItem` uses, so this file can assert
                // through the same door the `/audit` REST route serves from.
                return auditRows.filter((a) => {
                    if (opts2.where?.type !== undefined && a.type !== opts2.where.type) return false;
                    if (opts2.where?.name !== undefined && a.name !== opts2.where.name) return false;
                    return true;
                });
            }
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matchesHistory(h, opts2.where));
            }
            if (table === 'sys_metadata_commit') return [];
            return Array.from(rows.values()).filter((r) => matchesMetadataWhere(r, opts2.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') {
                // ⚠️ NOT short-circuited — see this file's header. The attempt
                // is recorded BEFORE any simulated failure and is never rolled
                // back, so "never tried", "tried and undone" and "tried and
                // rejected" stay three distinguishable states.
                auditAttempts.push(data);
                if (opts.failAudit) {
                    throw Object.assign(
                        new Error('SQLITE_ERROR: no such table: sys_metadata_audit'),
                        { code: 'SQLITE_ERROR' },
                    );
                }
                nextId += 1;
                const a = { id: `a_${nextId}`, ...(data as any) };
                auditRows.push(a);
                return { id: a.id };
            }
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h: HistoryRow = { id: `h_${nextId}`, ...(data as any) };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table === 'sys_metadata_commit') {
                nextId += 1;
                const c = { ...(data as any) };
                commitRows.push(c);
                return { id: c.id ?? `c_${nextId}` };
            }
            if (faults.failMetadataWriteFor && data.name === faults.failMetadataWriteFor) throw driverFault();
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts2: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts2);
            if (faults.failMetadataWriteFor
                && (data.name === faults.failMetadataWriteFor || opts2.where?.name === faults.failMetadataWriteFor)) {
                throw driverFault();
            }
            const found = findRow(opts2.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts2: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts2);
            const found = findRow(opts2.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        /**
         * A transaction that REALLY ROLLS BACK. The #7748 harness returns
         * `cb()` unchanged, which is fine for a route that has no transaction —
         * but this card is entirely about which side of one an audit row is
         * written on, and a passthrough makes both sides indistinguishable.
         *
         * `auditAttempts` is deliberately excluded from the snapshot: it models
         * an observer outside the database, and rolling it back would destroy
         * the only evidence that separates "written inside the transaction and
         * undone" from "never written".
         */
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            const owned = txDepth === 0;
            const snapshot = owned
                ? { rows: new Map(rows), historyRows: [...historyRows], commitRows: [...commitRows], auditRows: [...auditRows] }
                : null;
            txDepth += 1;
            try {
                return await cb(undefined, { owned });
            } catch (err) {
                if (snapshot) {
                    rows.clear();
                    for (const [k, v] of snapshot.rows) rows.set(k, v);
                    historyRows.length = 0;
                    historyRows.push(...snapshot.historyRows);
                    commitRows.length = 0;
                    commitRows.push(...snapshot.commitRows);
                    auditRows.length = 0;
                    auditRows.push(...snapshot.auditRows);
                }
                throw err;
            } finally {
                txDepth -= 1;
            }
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, rows, historyRows, commitRows, faults, auditRows, auditAttempts };
}

const viewBody = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
    name,
    type: 'grid',
    label,
    columns: ['id', 'title'],
    object: 'case',
    viewKind: 'list',
    ...extra,
});

const ORG = 'org_alpha';
const PKG = 'pkg_helpdesk';

/** Audit rows for one operation, in write order. */
const opRows = (h: Harness, operation: string) =>
    h.auditRows.filter((a) => a.operation === operation);

const publishRows = (h: Harness, outcome: 'allowed' | 'denied') =>
    opRows(h, 'publish').filter((a) => a.outcome === outcome);

/**
 * Stage one package-bound draft through the ordinary save path.
 *
 * `org: null` stages it ENV-WIDE (`organization_id IS NULL`), which is how
 * Studio and AI authoring actually write — see the scope cases below.
 */
async function stageDraft(
    protocol: ObjectStackProtocolImplementation,
    name: string,
    extra: Record<string, unknown> = {},
    org: string | null = ORG,
) {
    await protocol.saveMetaItem({
        type: 'view',
        name,
        ...(org ? { organizationId: org } : {}),
        item: viewBody(name, `${name} staged`, extra),
        mode: 'draft',
        packageId: PKG,
        actor: 'admin',
    } as any);
}

describe('[#8400] publishPackageDrafts audits the batch it publishes', () => {
    // ── positive control #1: the harness can see audit rows at all ───────────
    // Everything below counts rows in `auditRows`. If this engine short-
    // circuited the audit insert the way most stubs do, every count would be 0
    // and every assertion would pass for the wrong reason. This case exercises
    // the ONE site that already worked before #7748 and #8400, so it must stay
    // green under a revert of the production edits.
    it('control: a plain save writes its `save`/`allowed` row (harness really persists audit rows)', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);

        expect(h.auditRows).toHaveLength(0);
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG,
            item: viewBody('case_grid', 'v1'), actor: 'admin',
        } as any);

        expect(opRows(h, 'save')).toHaveLength(1);
        // A real persisted row, not the `{ id: 'audit_skip' }` sentinel most
        // stubs return: it carries the full payload and a minted id.
        expect(opRows(h, 'save')[0].id).toMatch(/^a_\d+$/);
        expect(opRows(h, 'save')[0]).toMatchObject({
            type: 'view',
            name: 'case_grid',
            organization_id: ORG,
            operation: 'save',
            outcome: 'allowed',
            code: 'ok',
            actor: 'admin',
        });
    });

    // ── positive control #2: the harness's transaction really rolls back ─────
    // Without this, "the denied row survived the rollback" below would be
    // unfalsifiable — a passthrough transaction lets a row written INSIDE the
    // batch survive too, and the placement this card is about would be
    // untestable.
    it('control: an audit row written inside a failing transaction does NOT survive (attempt still observable)', async () => {
        const h = makeStubEngine();

        await expect(h.engine.transaction(async () => {
            await h.engine.insert('sys_metadata_audit', {
                type: 'view', name: 'inside_txn', operation: 'publish', outcome: 'allowed', code: 'ok',
            });
            expect(h.auditRows).toHaveLength(1);
            throw new Error('batch failed');
        })).rejects.toThrow('batch failed');

        expect(h.auditRows).toHaveLength(0);
        expect(h.auditAttempts).toHaveLength(1);
    });

    // ── the allowed outcome ─────────────────────────────────────────────────
    it('a batch publish writes one `publish`/`allowed` row per promoted draft', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);

        await stageDraft(protocol, 'case_grid');
        await stageDraft(protocol, 'ticket_grid');

        // ABSENT BEFORE: staging drafts is two `save` rows; no publish row yet.
        expect(publishRows(h, 'allowed')).toHaveLength(0);

        const res = await protocol.publishPackageDrafts({
            packageId: PKG, organizationId: ORG, actor: 'admin',
        } as any);
        expect(res.publishedCount).toBe(2);
        expect(res.success).toBe(true);

        // PRESENT AFTER — one row per promoted item, naming the BATCH route so
        // the trail distinguishes "publish whole app" from a single-item publish.
        const allowed = publishRows(h, 'allowed');
        expect(allowed).toHaveLength(2);
        expect(allowed.map((a) => a.name).sort()).toEqual(['case_grid', 'ticket_grid']);
        for (const row of allowed) {
            expect(row).toMatchObject({
                type: 'view',
                organization_id: ORG,
                operation: 'publish',
                outcome: 'allowed',
                code: 'ok',
                actor: 'admin',
                source: 'protocol.publishPackageDrafts',
            });
            expect(String(row.note)).toContain(PKG);
        }
    });

    it('the QA shape: a two-item batch is counted, not swallowed', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);

        await stageDraft(protocol, 'case_grid');
        await stageDraft(protocol, 'ticket_grid');
        await protocol.publishPackageDrafts({
            packageId: PKG, organizationId: ORG, actor: 'admin',
        } as any);

        // The counter shape the #7748 QA run took — which, on the batch route,
        // read `Counter({'save': 2})` with both publishes missing.
        const counter = h.auditRows.reduce<Record<string, number>>((acc, a) => {
            acc[a.operation] = (acc[a.operation] ?? 0) + 1;
            return acc;
        }, {});
        expect(counter).toMatchObject({ save: 2, publish: 2 });
    });

    // ── the read door ───────────────────────────────────────────────────────
    it('auditMetaItem surfaces the batch publish row (the door `GET …/audit` serves from)', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);

        await stageDraft(protocol, 'case_grid');
        await protocol.publishPackageDrafts({
            packageId: PKG, organizationId: ORG, actor: 'admin',
        } as any);

        const { events } = await protocol.auditMetaItem({ type: 'view', name: 'case_grid' });
        expect(events.map((e) => e.operation)).toContain('publish');
        expect(events.find((e) => e.operation === 'publish')).toMatchObject({
            outcome: 'allowed',
            actor: 'admin',
            source: 'protocol.publishPackageDrafts',
        });
    });

    // ── scope: the row is keyed on the DRAFT's org, not the caller's ────────
    // Both fixtures above use `ORG` for the draft AND the publishing session,
    // so they cannot tell the two apart — an audit row keyed on either would
    // pass. These two pin it, and they are the only cases in this file where
    // the two values differ.
    //
    // Studio and AI authoring write drafts ENV-WIDE (`organization_id IS NULL`)
    // while the publishing session may carry a non-null active org.
    // `listDrafts` surfaces those env-wide rows to such a caller via its `$or`,
    // and `promoteDraftForPublish` is called with the DRAFT's scope (#3115), so
    // the active row lands env-wide. An audit row keyed on the caller's active
    // org would therefore record the publish against a partition the active row
    // never entered.
    it('scope: an env-wide draft published by an org-scoped caller audits ENV-WIDE, not to the caller org', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);

        // Draft is env-wide…
        await stageDraft(protocol, 'envwide_grid', {}, null);
        // …but the publishing session carries a non-null active org.
        const res = await protocol.publishPackageDrafts({
            packageId: PKG, organizationId: ORG, actor: 'admin',
        } as any);
        expect(res.publishedCount).toBe(1);

        const allowed = publishRows(h, 'allowed');
        expect(allowed).toHaveLength(1);
        expect(allowed[0].name).toBe('envwide_grid');
        expect(allowed[0].organization_id).toBeNull();
        expect(allowed[0].organization_id).not.toBe(ORG);
    });

    it('scope: an env-wide draft REFUSED under an org-scoped caller audits ENV-WIDE too', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine, undefined, 'env_test');

        await stageDraft(protocol, 'envwide_locked', {}, null);
        // Lock the ENV-WIDE active row — the scope `promoteDraftForPublish`
        // reads the lock from for an env-wide draft.
        await protocol.saveMetaItem({
            type: 'view', name: 'envwide_locked',
            item: viewBody('envwide_locked', 'protected', { _lock: 'no-overlay' }),
            packageId: PKG, actor: 'admin',
        } as any);

        const res = await protocol.publishPackageDrafts({
            packageId: PKG, organizationId: ORG, actor: 'admin',
        } as any);
        expect(res.publishedCount).toBe(0);

        // Membership, not length: [#8594] a lock refusal now leaves BOTH the
        // batch row and the inner verdict's own row, and the scope claim under
        // test here is about each row's `organization_id`, not about how many
        // rows one refusal produces.
        const denied = publishRows(h, 'denied');
        expect(denied.map((a) => a.code).sort()).toEqual(['batch_aborted', 'item_locked']);
        for (const row of denied) {
            expect(row.name).toBe('envwide_locked');
            // The denied rows read their scope from the draft's OWN scope — the
            // `listDrafts` row (`__batchItem` for the batch row, the promote
            // request for the inner one), the same source the allowed row's
            // `draftOrgId` comes from. Keyed on the caller's active org these
            // would be `ORG` and the two outcomes would disagree about where the
            // publish was refused.
            expect(row.organization_id).toBeNull();
            expect(row.organization_id).not.toBe(ORG);
        }
    });

    // ── the denied outcome, and the placement that makes it durable ──────────
    // The sharpest case in this file. A locked item refuses promotion from
    // INSIDE the batch transaction, and `assertLockAllowsWrite` writes its
    // `item_locked` denial there too — so that row is attempted and then rolled
    // away with everything else. The `batch_aborted` row this card adds is
    // written from the `catch`, outside the transaction, and survives.
    it('a refused batch leaves a `denied` row that SURVIVES the rollback it caused', async () => {
        const h = makeStubEngine();
        // `environmentId` is what arms the ADR-0010 lock gate
        // (`assertLockAllowsWrite` returns null without it).
        const protocol = new ObjectStackProtocolImplementation(h.engine, undefined, 'env_test');

        await stageDraft(protocol, 'case_grid');
        await stageDraft(protocol, 'locked_grid');
        // Lock the ACTIVE row AFTER both drafts are staged — locking first
        // would refuse the draft save itself.
        await protocol.saveMetaItem({
            type: 'view', name: 'locked_grid', organizationId: ORG,
            item: viewBody('locked_grid', 'protected', { _lock: 'no-overlay' }),
            packageId: PKG, actor: 'admin',
        } as any);

        const auditedBefore = h.auditRows.length;
        const res = await protocol.publishPackageDrafts({
            packageId: PKG, organizationId: ORG, actor: 'admin',
        } as any);

        // The batch is all-or-nothing (ADR-0067 D2).
        expect(res.success).toBe(false);
        expect(res.publishedCount).toBe(0);
        expect(res.failed.map((f) => f.code)).toContain('BATCH_ABORTED');

        // …and the rollback really happened: `case_grid` promoted first, then
        // unwound, so it is STILL a draft with no active row.
        const caseRows = [...h.rows.values()].filter((r) => r.name === 'case_grid');
        expect(caseRows.map((r) => r.state)).toEqual(['draft']);

        // No `allowed` row for the item whose promotion was undone — the
        // allowed rows are driven off a COMMITTED batch, not an attempted one.
        expect(publishRows(h, 'allowed')).toHaveLength(0);

        // The batch-level row survives, and it is the one written outside the
        // transaction. Asserted by MEMBERSHIP on its `code`, never by counting
        // the list: #8594 adds a SECOND denial beside it (the inner verdict's
        // own row, below), and a length assertion here would have read that
        // addition as a regression instead of as the fix.
        const denied = publishRows(h, 'denied');
        // adr0112-ok: D6b — persisted audit column, its own vocabulary
        const batchAborted = denied.filter((a) => a.code === 'batch_aborted');
        expect(batchAborted).toHaveLength(1);
        expect(batchAborted[0]).toMatchObject({
            type: 'view',
            name: 'locked_grid',
            organization_id: ORG,
            operation: 'publish',
            outcome: 'denied',
            // The persisted audit column's own vocabulary, lower-case like
            // `item_locked` — NOT a wire `error.code`.
            // adr0112-ok: D6b — persisted audit column, its own vocabulary
            code: 'batch_aborted',
            actor: 'admin',
            source: 'protocol.publishPackageDrafts',
        });
        expect(String(batchAborted[0].note)).toContain(PKG);
        expect(auditedBefore).toBeGreaterThan(0); // the staging saves really ran

        // ── THE PLACEMENT MEASUREMENT ────────────────────────────────────────
        // The lock gate's `item_locked` row was ATTEMPTED…
        expect(h.auditAttempts.some((a) => a.code === 'item_locked')).toBe(true);
        // …and [#8594] it now SURVIVES.
        //
        // ⚠️ THIS ASSERTION WAS INVERTED, deliberately. It read `.toBe(false)`
        // and that was this file MEASURING the defect rather than fixing it:
        // `assertLockAllowsWrite` wrote the row from INSIDE the batch
        // transaction, so the refusal's own record was destroyed by the very
        // rollback the refusal caused, and a compliance query on
        // `code = 'item_locked'` found nothing for a package publish refused by
        // a lock. `batch_aborted` above gave the batch route *a* trail but not
        // the inner verdict's vocabulary. `promoteDraftForPublish` now hands the
        // row to its caller instead of writing it, and the caller records it
        // outside the transaction — so both rows survive, each carrying its own
        // fact. The inner one is asserted in full in the `[#8594]` block below.
        expect(h.auditRows.some((a) => a.code === 'item_locked')).toBe(true);
    });

    it('the denied row quotes the refusal but never the driver dialect (the note is wire-visible)', async () => {
        // A driver fault instead of an authored refusal: `note` rides onto the
        // `GET …/audit` response through `auditMetaItem`, so it carries
        // `clientFacingFailureText`, not `e.message`.
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await stageDraft(protocol, 'broken_grid');
            // Break the engine only now — staging the draft is itself a
            // `sys_metadata` write and must succeed.
            h.faults.failMetadataWriteFor = 'broken_grid';
            const res = await protocol.publishPackageDrafts({
                packageId: PKG, organizationId: ORG, actor: 'admin',
            } as any);
            expect(res.publishedCount).toBe(0);

            // [#8594] Exactly ONE row here, and the length assertion is the
            // point: a driver fault carries NO inner verdict, so nothing may
            // appear beside `batch_aborted`. This is the over-broad guard for
            // #8594's shape — a fix that minted an inner-vocabulary row for
            // every refusal, instead of replaying only the ones the gates really
            // reached, would put a second row here and go red.
            const denied = publishRows(h, 'denied');
            expect(denied).toHaveLength(1);
            expect(denied[0]).toMatchObject({
                name: 'broken_grid', operation: 'publish', outcome: 'denied',
                // adr0112-ok: D6b — persisted audit column, its own vocabulary
                code: 'batch_aborted',
            });
            expect(String(denied[0].note)).not.toContain('SQLITE_ERROR');
            expect(String(denied[0].note)).toContain('rolled back');
        } finally {
            warn.mockRestore();
        }
    });

    // ── the third state ─────────────────────────────────────────────────────
    // `recordMetadataAudit` swallows its own failure so a deployment without
    // the table provisioned still answers API calls. That makes a missing row
    // ambiguous — unless the attempt is observed separately. Without this case,
    // a regression that stopped ATTEMPTING the write would be indistinguishable
    // from a table that rejects it.
    it('a failing audit table does not fail the batch publish — and the attempts are still observable', async () => {
        const h = makeStubEngine({ failAudit: true });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const protocol = new ObjectStackProtocolImplementation(h.engine);

            await stageDraft(protocol, 'case_grid');
            await stageDraft(protocol, 'ticket_grid');
            const res = await protocol.publishPackageDrafts({
                packageId: PKG, organizationId: ORG, actor: 'admin',
            } as any);

            // The publish still succeeds — best-effort, by contract.
            expect(res.publishedCount).toBe(2);
            expect(res.success).toBe(true);
            // No row landed…
            expect(h.auditRows).toHaveLength(0);
            // …but both writes were ATTEMPTED, which is the fact that separates
            // "the table rejected them" from "nothing ever tried" (the defect).
            const attempted = h.auditAttempts.filter(
                (a) => a.operation === 'publish' && a.source === 'protocol.publishPackageDrafts',
            );
            expect(attempted.map((a) => a.name).sort()).toEqual(['case_grid', 'ticket_grid']);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('sys_metadata_audit write failed'),
            );
        } finally {
            warn.mockRestore();
        }
    });
});

/**
 * [#8594] The INNER verdict's own row survives the rollback it caused.
 *
 * ---------------------------------------------------------------------------
 * What #8400 left, and why it was not enough
 * ---------------------------------------------------------------------------
 * #8400 gave a refused batch a `batch_aborted` row written from the `catch`,
 * outside the transaction. That is a real trail, but it is the BATCH's fact.
 * The item-level verdicts — `assertLockAllowsWrite`'s `item_locked` (with its
 * `lock_state` column) and `recordOptimisticConflictAudit`'s `metadata_conflict`
 * — were still written from INSIDE `promoteDraftForPublish`, i.e. inside the
 * batch transaction, and were destroyed by the very rollback their own refusal
 * caused. A compliance query filtering `code = 'item_locked'` therefore found
 * nothing for a package publish refused by a lock: the vocabulary that query
 * runs on never reached the table on this route.
 *
 * ---------------------------------------------------------------------------
 * The shape, and the premise it rests on (measured, not assumed)
 * ---------------------------------------------------------------------------
 * `promoteDraftForPublish` no longer writes those rows. It attaches them to the
 * refusal it throws, and each of its two callers records them on ITS side of
 * ITS transaction. The whole argument for that shape is a claim about the
 * single-item route — that it already audits outside a transaction — so the
 * first case below MEASURES it rather than taking it on faith, against the same
 * really-rolling-back harness. That case is green before AND after the
 * production change: it is the premise, not the deliverable.
 *
 * ---------------------------------------------------------------------------
 * The control that keeps the inversion honest
 * ---------------------------------------------------------------------------
 * "The denial rows survive" is also satisfied by a fix that simply stopped
 * rolling anything back — the trap a sibling inversion fell into. So every case
 * here that asserts a surviving denial ALSO asserts ADR-0067 D2 in the same
 * breath: the batch promoted NOTHING (`publishedCount: 0`, every draft still a
 * draft with no active row, no `sys_metadata_commit` row, no `allowed` row).
 * If the transaction stopped rolling back, those go red while the denial
 * assertions stay green — which is the whole point of asserting both.
 */
describe('[#8594] a refused publish leaves the INNER verdict, in its own vocabulary', () => {
    /** Every audit row for `code`, whatever the operation. */
    const byCode = (h: Harness, code: string) => h.auditRows.filter((a) => a.code === code);

    // ── the premise ──────────────────────────────────────────────────────────
    // The single-item route's denial row lands and STAYS on the same harness
    // whose `transaction()` really rolls back — because `publishMetaItem` opens
    // no transaction of its own. That is the fact the whole "hand the row to the
    // caller" shape is built on, so it is pinned here instead of assumed.
    it('premise: the SINGLE-ITEM publish route audits outside a transaction — its `item_locked` row survives', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine, undefined, 'env_test');

        await stageDraft(protocol, 'solo_locked');
        await protocol.saveMetaItem({
            type: 'view', name: 'solo_locked', organizationId: ORG,
            item: viewBody('solo_locked', 'protected', { _lock: 'no-overlay' }),
            packageId: PKG, actor: 'admin',
        } as any);

        let caught: any;
        try {
            await protocol.publishMetaItem({
                type: 'view', name: 'solo_locked', organizationId: ORG, actor: 'admin',
            } as any);
        } catch (e) { caught = e; }

        // ADR-0112 envelope: `code` AND `status`, never a bare `toThrow()`.
        expect(caught?.code).toBe('ITEM_LOCKED');
        expect(caught?.status).toBe(403);

        const locked = byCode(h, 'item_locked');
        expect(locked).toHaveLength(1);
        expect(locked[0]).toMatchObject({
            type: 'view',
            name: 'solo_locked',
            organization_id: ORG,
            operation: 'publish',
            outcome: 'denied',
            // adr0112-ok: D6b — persisted audit column, its own vocabulary
            code: 'item_locked',
            lock_state: 'no-overlay',
            actor: 'admin',
            // The single-item route keeps naming itself — unchanged by #8594.
            source: 'protocol.publishMetaItem',
        });
    });

    // ── the deliverable: the lock refusal ───────────────────────────────────
    it('a batch refused by a LOCK leaves an `item_locked` row with its `lock_state` — and still promotes nothing', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine, undefined, 'env_test');

        await stageDraft(protocol, 'case_grid');
        await stageDraft(protocol, 'locked_grid');
        await protocol.saveMetaItem({
            type: 'view', name: 'locked_grid', organizationId: ORG,
            item: viewBody('locked_grid', 'protected', { _lock: 'no-overlay' }),
            packageId: PKG, actor: 'admin',
        } as any);

        const res = await protocol.publishPackageDrafts({
            packageId: PKG, organizationId: ORG, actor: 'admin',
        } as any);

        // ── THE DELIVERABLE ──────────────────────────────────────────────────
        // The verdict that aborted the batch, in the vocabulary a compliance
        // query filters on, with the lock column that says WHICH lock.
        const locked = byCode(h, 'item_locked');
        expect(locked).toHaveLength(1);
        expect(locked[0]).toMatchObject({
            type: 'view',
            name: 'locked_grid',
            organization_id: ORG,
            operation: 'publish',
            outcome: 'denied',
            // adr0112-ok: D6b — persisted audit column, its own vocabulary
            code: 'item_locked',
            lock_state: 'no-overlay',
            actor: 'admin',
            // Re-stamped by the route that wrote it: the shared Phase-1 helper
            // passes `protocol.publishMetaItem` for both of its callers, and
            // filing a batch publish under the single-item route's name would
            // make the trail lie about which door was used.
            source: 'protocol.publishPackageDrafts',
        });

        // …beside #8400's batch-level row, which records a different fact and is
        // NOT replaced. Membership on the pair, never a count of the list.
        expect(publishRows(h, 'denied').map((a) => a.code).sort())
            .toEqual(['batch_aborted', 'item_locked']);

        // ── THE ADR-0067 D2 CONTROL ──────────────────────────────────────────
        // Rows surviving is only the fix if the rollback still happens. A fix
        // that made the denial durable by no longer rolling anything back would
        // satisfy every assertion above and fail every one below.
        expect(res.success).toBe(false);
        expect(res.publishedCount).toBe(0);
        expect(res.published).toEqual([]);
        // `case_grid` was promoted BEFORE `locked_grid` refused, and it unwound:
        // still a draft, with no active row anywhere.
        expect([...h.rows.values()].filter((r) => r.name === 'case_grid').map((r) => r.state))
            .toEqual(['draft']);
        expect([...h.rows.values()].some((r) => r.state === 'active' && r.name === 'case_grid'))
            .toBe(false);
        // The ADR-0067 commit row is written inside the same transaction, so it
        // unwound too — a recorded commit can never describe a partial publish.
        expect(h.commitRows).toHaveLength(0);
        // And no item was audited as published.
        expect(publishRows(h, 'allowed')).toHaveLength(0);
    });

    // ── the read door ───────────────────────────────────────────────────────
    // A row nobody can query is not a trail. `GET /api/v1/meta/:type/:name/audit`
    // serves from `auditMetaItem`, and that is where a compliance report reads
    // `code` / `lockState` from.
    it('auditMetaItem surfaces the `item_locked` verdict for a batch-refused item', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine, undefined, 'env_test');

        await stageDraft(protocol, 'locked_grid');
        await protocol.saveMetaItem({
            type: 'view', name: 'locked_grid', organizationId: ORG,
            item: viewBody('locked_grid', 'protected', { _lock: 'no-overlay' }),
            packageId: PKG, actor: 'admin',
        } as any);
        await protocol.publishPackageDrafts({
            packageId: PKG, organizationId: ORG, actor: 'admin',
        } as any);

        const { events } = await protocol.auditMetaItem({ type: 'view', name: 'locked_grid' });
        const verdict = events.find((e) => e.code === 'item_locked');
        expect(verdict).toBeDefined();
        expect(verdict).toMatchObject({
            operation: 'publish',
            outcome: 'denied',
            lockState: 'no-overlay',
            source: 'protocol.publishPackageDrafts',
        });
    });

    // ── the deliverable: the optimistic-lock refusal ─────────────────────────
    // The card's other inner verdict. `recordOptimisticConflictAudit` sat in the
    // same place with the same fate, and no case anywhere measured it on the
    // batch route: the 409 is raised by the repository's parent-version check,
    // which needs a real rival write between `promoteDraft`'s two reads (see
    // `advanceActiveOnRead`), not an injected error.
    it('a batch refused by a 409 CONFLICT leaves a `metadata_conflict` row — and still promotes nothing', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            // Staged FIRST so it is promoted first and is genuinely unwound by
            // the conflict that follows it — the ADR-0067 D2 control below is
            // about a promotion that really happened, not one never attempted.
            await stageDraft(protocol, 'bystander_grid');
            await stageDraft(protocol, 'raced_grid');
            // An active row for the draft to advance PAST — with no active row
            // the parent version is null on both reads and there is no race.
            await protocol.saveMetaItem({
                type: 'view', name: 'raced_grid', organizationId: ORG,
                item: viewBody('raced_grid', 'head'), packageId: PKG, actor: 'admin',
            } as any);

            // The rival lands between the two reads of `raced_grid`'s active row.
            h.faults.advanceActiveOnRead = 'raced_grid';

            const res = await protocol.publishPackageDrafts({
                packageId: PKG, organizationId: ORG, actor: 'admin',
            } as any);

            // ── THE DELIVERABLE ──────────────────────────────────────────────
            const conflict = byCode(h, 'metadata_conflict');
            expect(conflict).toHaveLength(1);
            expect(conflict[0]).toMatchObject({
                type: 'view',
                name: 'raced_grid',
                organization_id: ORG,
                operation: 'publish',
                outcome: 'denied',
                // adr0112-ok: D6b — persisted audit column, its own vocabulary
                code: 'metadata_conflict',
                actor: 'admin',
                source: 'protocol.publishPackageDrafts',
            });
            // The note names the losing race, which is the fact an author needs.
            expect(String(conflict[0].note)).toContain('sha256:advanced_by_a_rival');
            expect(publishRows(h, 'denied').map((a) => a.code).sort())
                .toEqual(['batch_aborted', 'metadata_conflict']);
            // The batch reports the refusal in its own envelope too.
            expect(res.failed.some((f) => f.code === 'METADATA_CONFLICT')).toBe(true);

            // ── THE ADR-0067 D2 CONTROL ──────────────────────────────────────
            expect(res.success).toBe(false);
            expect(res.publishedCount).toBe(0);
            expect(h.commitRows).toHaveLength(0);
            expect(publishRows(h, 'allowed')).toHaveLength(0);
            // The bystander draft that promoted before the conflict unwound.
            expect([...h.rows.values()].filter((r) => r.name === 'bystander_grid').map((r) => r.state))
                .toEqual(['draft']);
        } finally {
            warn.mockRestore();
        }
    });

    // ── the engine without a transaction ─────────────────────────────────────
    // `publishPackageDrafts` falls through to a plain sequential run when the
    // engine has no `transaction()` (memory driver, minimal stubs). The row must
    // land there too: after #8594 the placement no longer depends on the
    // engine's capabilities, which is the reason the helper stopped guessing.
    it('an engine with NO transaction() still lands the `item_locked` row', async () => {
        const h = makeStubEngine();
        delete h.engine.transaction;
        const protocol = new ObjectStackProtocolImplementation(h.engine, undefined, 'env_test');

        await stageDraft(protocol, 'locked_grid');
        await protocol.saveMetaItem({
            type: 'view', name: 'locked_grid', organizationId: ORG,
            item: viewBody('locked_grid', 'protected', { _lock: 'no-overlay' }),
            packageId: PKG, actor: 'admin',
        } as any);

        const res = await protocol.publishPackageDrafts({
            packageId: PKG, organizationId: ORG, actor: 'admin',
        } as any);
        expect(res.publishedCount).toBe(0);

        expect(byCode(h, 'item_locked')).toHaveLength(1);
        expect(byCode(h, 'item_locked')[0]).toMatchObject({
            name: 'locked_grid',
            operation: 'publish',
            outcome: 'denied',
            lock_state: 'no-overlay',
            source: 'protocol.publishPackageDrafts',
        });
    });
});
