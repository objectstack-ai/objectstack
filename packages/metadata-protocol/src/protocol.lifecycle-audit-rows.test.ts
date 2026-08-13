// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7748] The metadata audit trail recorded only `save`.
//
// ---------------------------------------------------------------------------
// The defect, stated as the inversion it is
// ---------------------------------------------------------------------------
// `protocol.ts` wrote an ALLOWED-outcome audit row at exactly two sites — the
// `save` path and the `delete` path. `publishMetaItem` and `rollbackMetaItem`
// reached `recordMetadataAudit` through ONE route only: `assertLockAllowsWrite`,
// which records on the DENY path and `return`s before any write on allow:
//
//     const refusal = evaluateLockForWrite(state.lock);
//     if (!refusal) return null;            // ← allowed: returns before any audit write
//     …
//     await this.recordMetadataAudit({ …, outcome: 'denied', … });
//
// So a REFUSED publish was audited and a SUCCESSFUL one was not — the inverse
// of what an audit trail is for. The 409 `METADATA_CONFLICT` denial is refused
// OUTSIDE that helper (it comes back from the repository's parent-version
// check), so it wrote nothing either: a caller losing a race against another
// author was indistinguishable, in the trail, from a caller who never tried.
//
// Measured against the QA run this card came from: 3 publishes + 2 rollbacks,
// all 200, all sent with `X-Actor`, produced `Counter({'save': 5})`.
//
// The `sys_metadata_audit` schema has always declared `publish` and `rollback`
// as `operation` options (see the platform-object translations bundle) — the
// table was designed for these rows from the start and the writes were simply
// never made.
//
// ---------------------------------------------------------------------------
// ⚠️ Why this file's fake engine does NOT short-circuit the audit insert
// ---------------------------------------------------------------------------
// Every other multi-table stub in this repo opens `insert` with
//
//     if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
//
// which is correct for a suite that is about something else — and makes every
// assertion in THIS file vacuous. A harness that swallows the insert reports
// "no audit rows" identically before and after the fix. So the engine below
// persists audit rows like any other table, and `records the control row` is
// the positive control proving it can see them at all.
//
// ---------------------------------------------------------------------------
// Absent-before / present-after, and the third state
// ---------------------------------------------------------------------------
// `recordMetadataAudit` is best-effort by contract (ADR-0010 §3.6): it catches
// its own insert failure and `console.warn`s rather than failing the caller.
// That makes "the row is missing" ambiguous between two very different worlds:
//
//   (a) nothing ever tried to write it        ← the defect this card reports
//   (b) the write was attempted and failed    ← a provisioning problem
//
// A test that only counts rows cannot tell them apart, and would go green on
// (b) forever. So the harness records every insert AIMED at the audit table
// (`auditAttempts`) separately from the ones that landed (`auditRows`), and the
// last describe drives (b) explicitly: audit table rejecting, publish still
// succeeds, attempt made, row absent.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Ordinary red, and asymmetric by design: reverting the production edits must
// NOT disturb the `save` control (it is the site that already worked).
//
// Predicted before running: `save` control green, best-effort-swallow case
// green, the five publish / rollback / conflict assertions red.
// MEASURED on the reverted tree (`git checkout origin/main -- protocol.ts`):
// **6 red / 1 green**. The prediction was wrong on the swallow case, and the
// correction is worth more than the guess was:
//
//   → expected [] to have a length of 1 but got +0
//   → expected { save: 2 } to match object { save: 2, publish: 2, rollback: 1 }
//   → expected [ 'save' ] to include 'publish'
//   → expected false to be true          ← the swallow case
//
// The swallow case goes red because its load-bearing assertion is
// `auditAttempts.some(a => a.operation === 'publish')` — under the defect no
// publish audit write is ATTEMPTED at all, so there is nothing for the failing
// table to reject. That is the correct direction: the case exists to separate
// "attempted and rejected" from "never attempted", and the defect IS the
// second. Only the `save` control stayed green, which is the asymmetry that
// matters — the fix did not "fix" a site that was already right.
//
// Restored afterwards with `git checkout <branch> -- protocol.ts`; `git status`
// clean against the commit, so the numbers above were taken against the same
// bytes that ship.

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
    /** Audit rows that LANDED. */
    auditRows: any[];
    /** Every insert AIMED at `sys_metadata_audit`, including ones that threw. */
    auditAttempts: any[];
};

function makeStubEngine(opts: { failAudit?: boolean } = {}): Harness {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    const auditRows: any[] = [];
    const auditAttempts: any[] = [];
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
        async findOne(table: string, opts2: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts2.where)) ?? null;
            }
            return findRow(opts2.where)?.row ?? null;
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
            return Array.from(rows.values()).filter((r) => matchesMetadataWhere(r, opts2.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') {
                // ⚠️ NOT short-circuited — see this file's header. The attempt
                // is recorded BEFORE any simulated failure, so "never tried"
                // and "tried and failed" stay distinguishable.
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
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts2: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts2);
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
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, rows, historyRows, auditRows, auditAttempts };
}

const viewBody = (label: string) => ({
    name: 'case_grid',
    type: 'grid',
    label,
    columns: ['id', 'title'],
    object: 'case',
    viewKind: 'list',
});

const ORG = 'org_alpha';

/** Audit rows for one operation, in write order. */
const opRows = (h: Harness, operation: string) =>
    h.auditRows.filter((a) => a.operation === operation);

/** Capture a rejection without letting a resolve pass silently. */
async function rejection(run: () => Promise<unknown>): Promise<any> {
    let caught: any;
    let resolved: unknown;
    let didResolve = false;
    try {
        resolved = await run();
        didResolve = true;
    } catch (e) {
        caught = e;
    }
    expect(
        didResolve,
        `expected a rejection, but the call resolved with ${JSON.stringify(resolved)}`,
    ).toBe(false);
    return caught;
}

describe('[#7748] the audit trail records the whole lifecycle, not only `save`', () => {
    // ── the positive control ────────────────────────────────────────────────
    // Everything below counts rows in `auditRows`. If the harness could not
    // see audit rows at all, every one of those counts would be 0 and every
    // assertion would pass for the wrong reason. This case is the proof that
    // the number 0 means something — it exercises the ONE site that already
    // worked before this card, and it must stay green under a revert.
    it('control: a plain save writes its `save`/`allowed` row (harness really persists audit rows)', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);

        expect(h.auditRows).toHaveLength(0);
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG,
            item: viewBody('v1'), actor: 'admin',
        } as any);

        expect(opRows(h, 'save')).toHaveLength(1);
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

    // ── publish ─────────────────────────────────────────────────────────────
    it('publishMetaItem writes a `publish`/`allowed` row — absent before, present after', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);

        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG,
            item: viewBody('staged'), mode: 'draft', actor: 'admin',
        } as any);

        // ABSENT BEFORE: staging a draft is a `save`; no publish row yet.
        expect(opRows(h, 'publish')).toHaveLength(0);

        const res = await protocol.publishMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG, actor: 'admin',
        } as any);
        expect((res as any).success).toBe(true);

        // PRESENT AFTER.
        expect(opRows(h, 'publish')).toHaveLength(1);
        expect(opRows(h, 'publish')[0]).toMatchObject({
            type: 'view',
            name: 'case_grid',
            organization_id: ORG,
            operation: 'publish',
            outcome: 'allowed',
            code: 'ok',
            actor: 'admin',
            source: 'protocol.publishMetaItem',
        });
    });

    it('the QA shape: 2 publishes and 1 rollback are all counted, not just the saves', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);

        for (const label of ['v1', 'v2']) {
            await protocol.saveMetaItem({
                type: 'view', name: 'case_grid', organizationId: ORG,
                item: viewBody(label), mode: 'draft', actor: 'admin',
            } as any);
            await protocol.publishMetaItem({
                type: 'view', name: 'case_grid', organizationId: ORG, actor: 'admin',
            } as any);
        }
        await protocol.rollbackMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG,
            toVersion: 1, actor: 'admin',
        } as any);

        // The counter the QA run took, which read `Counter({'save': 5})` with
        // every publish and rollback missing.
        const counter = h.auditRows.reduce<Record<string, number>>((acc, a) => {
            acc[a.operation] = (acc[a.operation] ?? 0) + 1;
            return acc;
        }, {});
        expect(counter).toMatchObject({ save: 2, publish: 2, rollback: 1 });
    });

    // ── rollback ────────────────────────────────────────────────────────────
    it('rollbackMetaItem writes a `rollback`/`allowed` row naming the restored version', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);

        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG,
            item: viewBody('v1'), actor: 'admin',
        } as any);
        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG,
            item: viewBody('v2'), actor: 'admin',
        } as any);

        expect(opRows(h, 'rollback')).toHaveLength(0);

        const res = await protocol.rollbackMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG,
            toVersion: 1, actor: 'admin',
        } as any);
        expect((res as any).success).toBe(true);

        expect(opRows(h, 'rollback')).toHaveLength(1);
        expect(opRows(h, 'rollback')[0]).toMatchObject({
            type: 'view',
            name: 'case_grid',
            operation: 'rollback',
            outcome: 'allowed',
            code: 'ok',
            actor: 'admin',
            source: 'protocol.rollbackMetaItem',
            note: 'restored from version 1',
        });
    });

    // ── the 409 denial ──────────────────────────────────────────────────────
    // The card's reproduction step 4: force a conflict with a stale If-Match
    // (`parentVersion`) and re-read the audit. The refusal is raised OUTSIDE
    // `assertLockAllowsWrite`, which is why the lock gate's deny-path audit
    // never covered it.
    it('a 409 METADATA_CONFLICT writes a `denied` row — the refusal is recorded, not silent', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);

        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG,
            item: viewBody('head'), actor: 'admin',
        } as any);
        const auditedBefore = h.auditRows.length;

        const caught = await rejection(() => protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG,
            item: viewBody('should not land'),
            parentVersion: 'sha256:stale', actor: 'admin',
        } as any));

        // ADR-0112 envelope: the rejection-class assertion is `code` AND
        // `status`, never a bare `toThrow()`.
        expect(caught?.code).toBe('METADATA_CONFLICT');
        expect(caught?.status).toBe(409);

        expect(h.auditRows).toHaveLength(auditedBefore + 1);
        const denial = h.auditRows[h.auditRows.length - 1];
        expect(denial).toMatchObject({
            type: 'view',
            name: 'case_grid',
            operation: 'save',
            outcome: 'denied',
            // The persisted audit column's own vocabulary (ADR-0112 D6b),
            // lower-case like the `item_locked` row the lock gate writes —
            // NOT the wire code `METADATA_CONFLICT`.
            code: 'metadata_conflict',
            actor: 'admin',
        });
        expect(String(denial.note)).toContain('sha256:stale');
    });

    // ── the read door ───────────────────────────────────────────────────────
    // Rows are worthless if the endpoint the QA run polled cannot see them.
    it('auditMetaItem surfaces the publish row (the door `GET …/audit` serves from)', async () => {
        const h = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(h.engine);

        await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG,
            item: viewBody('staged'), mode: 'draft', actor: 'admin',
        } as any);
        await protocol.publishMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG, actor: 'admin',
        } as any);

        const { events } = await protocol.auditMetaItem({ type: 'view', name: 'case_grid' });
        expect(events.map((e) => e.operation)).toContain('publish');
        const published = events.find((e) => e.operation === 'publish');
        expect(published).toMatchObject({ outcome: 'allowed', actor: 'admin' });
    });

    // ── the third state ─────────────────────────────────────────────────────
    // `recordMetadataAudit` is best-effort: it swallows its own failure so a
    // deployment without the table provisioned still answers API calls. That
    // makes a missing row ambiguous — unless the attempt is observed
    // separately. Without this case, a regression that stopped ATTEMPTING the
    // write would be indistinguishable from a table that rejects it.
    it('a failing audit table does not fail the publish — and the attempt is still observable', async () => {
        const h = makeStubEngine({ failAudit: true });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const protocol = new ObjectStackProtocolImplementation(h.engine);

            await protocol.saveMetaItem({
                type: 'view', name: 'case_grid', organizationId: ORG,
                item: viewBody('staged'), mode: 'draft', actor: 'admin',
            } as any);
            const res = await protocol.publishMetaItem({
                type: 'view', name: 'case_grid', organizationId: ORG, actor: 'admin',
            } as any);

            // The publish still succeeds — best-effort, by contract.
            expect((res as any).success).toBe(true);
            // No row landed…
            expect(h.auditRows).toHaveLength(0);
            // …but the write was ATTEMPTED, which is the fact that separates
            // "the table rejected it" from "nothing ever tried" (the defect).
            expect(h.auditAttempts.some((a) => a.operation === 'publish')).toBe(true);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('sys_metadata_audit write failed'),
            );
        } finally {
            warn.mockRestore();
        }
    });
});
