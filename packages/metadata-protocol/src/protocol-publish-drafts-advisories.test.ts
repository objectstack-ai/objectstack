// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9343 — the batch publish door (`publishPackageDrafts`, Studio's "publish
 * whole app", `POST /packages/:id/publish-drafts`) reports the #4463 runtime
 * authoring gate's per-draft advisories on each `published[]` element.
 *
 * Ruled shape (maintainer, 2026-08-17, recorded on the card): advisories ride
 * EACH `published[]` element, with the same optional, omitted-when-empty shape
 * as `PublishMetaItemResponseSchema.advisories` on the single-item door
 * (#9176) — no parallel top-level map. `failed[]` elements are unaffected: an
 * `error` finding refuses the promotion, and the batch being all-or-nothing
 * (ADR-0067 D2) that refusal aborts the whole batch.
 *
 * Before #9343 the batch caller destructured only `{ singularType, result }`
 * from `promoteDraftForPublish` — which since #9176 RETURNS the findings — so
 * the gate's advisory half was computed and dropped on the floor, per draft,
 * for every draft in the batch: the same shape #9176 closed one door over,
 * on the one door bulk/AI authoring actually takes.
 *
 * The advisory fixture is the #4717 / #9176 measurement verbatim: a flow
 * whose ONLY defect is a `delete_record` node declaring `multi: true` with no
 * `filter` — `lintFlowPatterns` raises `flow-multi-write-unfiltered` at
 * `severity: 'warning'`, so the promotion succeeds and the finding is exactly
 * what the advisory channel exists to carry. `runAs: 'system'` is
 * load-bearing: without it `flow-runas-unscoped` fires at `severity: 'error'`
 * and the publish becomes a refusal wearing an advisory's clothes.
 *
 * Harness: the same faithful stub engine as
 * `protocol-publish-drafts-org-scope.test.ts` (kept local — self-contained
 * harnesses are the established shape here, so two tripwires can fail
 * independently). Flows are env-wide (`flow` is `allowOrgOverride: false`),
 * saved as package-bound drafts, published through the REAL
 * `publishPackageDrafts` — nothing on the gate path is stubbed.
 */

import { describe, expect, it } from 'vitest';
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
            // No declared package namespace → publishPackageDrafts skips the
            // ADR-0028 prefix check (legacy-grandfathered path).
            getPackage: () => undefined,
        },
    };
    return { engine, rows, historyRows };
}

const PKG = 'app.ops';

/**
 * The reachable success-with-advisories fixture (#4717 / #9176, verbatim in
 * structure): the only defect is the unbounded bulk delete, which
 * `lintFlowPatterns` reports at `severity: 'warning'`.
 */
const advisoryFlow = (name: string) => ({
    name,
    label: 'Nightly Purge',
    type: 'autolaunched',
    status: 'active',
    runAs: 'system',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
            id: 'purge',
            type: 'delete_record',
            label: 'Purge',
            config: { objectName: 'audit_logs', multi: true },
        },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'purge' }],
});

/** The same flow with the bulk write bounded — no finding of any severity. */
const cleanFlow = (name: string) => {
    const flow = advisoryFlow(name);
    (flow.nodes[1] as any).config.filter = [{ field: 'created_at', operator: 'lt', value: '2020-01-01' }];
    return flow;
};

/** A flow whose approval expression is broken — `severity: 'error'`, the gating half. */
const gatedFlow = (name: string) => ({
    name,
    label: 'Leave Approval',
    type: 'autolaunched',
    status: 'active',
    runAs: 'system',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
            id: 'approve',
            type: 'approval',
            label: 'Approve',
            config: { approvers: [{ type: 'expression', value: 'record.owner ==' }] },
        },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'approve' }],
});

/** Stage one env-wide, package-bound flow draft (Studio's "Save Draft" shape). */
async function stageFlowDraft(
    protocol: ObjectStackProtocolImplementation,
    name: string,
    item: unknown,
): Promise<void> {
    await (protocol as any).saveMetaItem({
        type: 'flow', name, item, packageId: PKG, mode: 'draft',
    });
}

describe('publishPackageDrafts carries per-draft advisories on published[] elements (#9343)', () => {
    it('a batch whose one draft raises an advisory succeeds AND reports it on that element', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageFlowDraft(protocol, 'nightly_purge', advisoryFlow('nightly_purge'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        // The batch succeeded — advisories ride the 2xx, never a refusal.
        expect(res.failed).toEqual([]);
        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });

        // The finding reached the caller ON THE ELEMENT, with the id and
        // severity the rule emits — asserting the RULE ID rather than a bare
        // non-empty array: an array of the wrong findings is a different
        // defect from an empty one.
        const el = res.published[0]!;
        expect(el).toMatchObject({ type: 'flow', name: 'nightly_purge' });
        expect(el.advisories).toHaveLength(1);
        expect(el.advisories![0]!.rule).toBe('flow-multi-write-unfiltered');
        expect(el.advisories![0]!.severity).toBe('warning');
        expect(el.advisories![0]!.where).toContain('nightly_purge');

        // The element shape mirrors the single-item door's
        // `RuntimeAuthoringIssueSchema` element keys (#9176) — the "same
        // shape, both doors" half of the ruling.
        expect(Object.keys(el.advisories![0]!).sort())
            .toEqual(['hint', 'message', 'path', 'rule', 'severity', 'where']);
    });

    it('a mixed batch attaches advisories to exactly the raising element — the clean sibling carries no key', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageFlowDraft(protocol, 'nightly_purge', advisoryFlow('nightly_purge'));
        await stageFlowDraft(protocol, 'bounded_purge', cleanFlow('bounded_purge'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ success: true, publishedCount: 2, failedCount: 0 });
        const byName = new Map(res.published.map((p) => [p.name, p]));
        const raising = byName.get('nightly_purge')!;
        const clean = byName.get('bounded_purge')!;

        // Exactly the raising element reports; per-draft mapping, not batch-level.
        expect(raising.advisories).toHaveLength(1);
        expect(raising.advisories![0]!.rule).toBe('flow-multi-write-unfiltered');

        // The clean element's KEY SET is untouched — `advisories: []` would
        // satisfy a `toHaveLength(0)` while changing the element's bytes,
        // which is exactly what the omitted-when-empty rule forbids.
        expect('advisories' in clean).toBe(false);
        expect(Object.keys(clean).sort()).toEqual(['name', 'type', 'version']);
    });

    it('an advisory-free batch changes nothing: no element carries the key, byte-identical response', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageFlowDraft(protocol, 'bounded_purge', cleanFlow('bounded_purge'));
        await stageFlowDraft(protocol, 'second_purge', cleanFlow('second_purge'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ success: true, publishedCount: 2, failedCount: 0 });
        for (const el of res.published) {
            expect('advisories' in el).toBe(false);
            expect(Object.keys(el).sort()).toEqual(['name', 'type', 'version']);
        }
        // Byte-for-byte: the serialized response of a clean batch carries no
        // trace of the field. `JSON.stringify` is the wire (the route hands
        // this object to `res.json()` verbatim), and the wire is the promise
        // being made to existing callers.
        expect(JSON.stringify(res)).not.toContain('advisories');
    });

    it('the gating half is unchanged: an `error` finding aborts the batch, and failed[] elements carry no advisories key', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        // Draft saves are never gated (D1) — both stage fine.
        await stageFlowDraft(protocol, 'leave_approval', gatedFlow('leave_approval'));
        await stageFlowDraft(protocol, 'nightly_purge', advisoryFlow('nightly_purge'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        // ADR-0067 D2 — all-or-nothing: the error finding refuses the causal
        // item and rolls back the sibling whose own finding was only advisory.
        expect(res).toMatchObject({ success: false, publishedCount: 0, failedCount: 2 });
        expect(res.published).toEqual([]);
        const causal = res.failed.find((f) => f.name === 'leave_approval')!;
        expect(causal.code).toBe('INVALID_METADATA');
        const aborted = res.failed.find((f) => f.name === 'nightly_purge')!;
        expect(aborted.code).toBe('BATCH_ABORTED');
        // `failed[]` elements are unaffected by #9343 — the ruling's explicit
        // boundary: no advisories key appears anywhere on a refused batch.
        expect(JSON.stringify(res.failed)).not.toContain('advisories');
    });
});
