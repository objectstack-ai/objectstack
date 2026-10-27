// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26707 — a draft's `_diagnostics` says what its publish will say.
 *
 * ## The defect, measured on `origin/main` before this file was written
 *
 * Six author-time rules ran only at publish. Each of the bodies below saved as
 * a draft (200), its draft read answered `_diagnostics: { valid: true }`, and
 * the publish refused it 422 `INVALID_METADATA` with the rule id in
 * `issues[]`. In a package publish the refusal rolled every other draft of
 * the package back with it, so an author who trusted "valid" lost unrelated
 * work far from the edit that caused it.
 *
 * ## What is pinned
 *
 * - The draft still SAVES (#4463 D1 is unchanged): every fixture is stored.
 * - Its read reports `valid: false` with the publish's own rule id (as the
 *   entry's `code`) and the publish's own message — compared against the
 *   publish run in the same test, never against a restatement of it.
 * - The publish still refuses exactly as before.
 * - A clean draft stays `valid: true`, and a draft whose reference resolves
 *   only inside its own package (the closure "Publish all" judges) is not
 *   reported: the verdict is the package publish's, not a stricter one.
 *
 * Harness: the package-aware multi-table stub engine of
 * `protocol-publish-drafts-closure.test.ts` (kept local, the established
 * shape). Nothing on the save, read or publish path is stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** The LIVE object universe: a deal with a formula field, and its account. */
const liveDealObject = {
    name: 'deal',
    label: 'Deal',
    sharingModel: 'private',
    fields: {
        name: { type: 'text', label: 'Name' },
        amount: { type: 'number', label: 'Amount' },
        deal_score: {
            type: 'formula',
            label: 'Score',
            expression: { dialect: 'cel', source: 'record.amount * 2' },
            returnType: 'number',
        },
    },
};

/** The LIVE dataset a fixture dashboard binds. */
const liveDealDataset = {
    name: 'deals_live',
    label: 'Deals',
    object: 'deal',
    dimensions: [{ name: 'deal_name', field: 'name' }],
    measures: [{ name: 'deal_count', aggregate: 'count' }],
};

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
            assertEngineFindOnePredicate(table, opts);
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
        // The engine's judge-only filter admission (#20158), as the live engine
        // answers it for a read scope on a formula field: refused, because a
        // virtual field has no column a row filter can read. The engine's real
        // verdicts are pinned in `packages/cli/test/rls-policy-authoring-admission.test.ts`.
        judgeFilter: (_object: string, where: unknown) =>
            JSON.stringify(where).includes('deal_score')
                ? { ok: false, code: 'FILTER_FIELD_NOT_STORED', status: 400, message: 'Field "deal_score" is a formula field and cannot be filtered.' }
                : { ok: true },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            // The LIVE universe: the objects and the one dataset the fixtures
            // resolve against.
            listItems: (type: string) => {
                if (type === 'object') return [liveDealObject];
                if (type === 'dataset') return [liveDealDataset];
                return [];
            },
            // The base the drafts are bound to is INSTALLED — a flow may be
            // saved only into a package the registry holds (#20863) — and its
            // manifest declares no namespace → the ADR-0028 prefix pre-flight is
            // skipped (legacy-grandfathered path); it declares no dependencies
            // and no live object carries a package stamp, so
            // `resolveWritePackageScope`'s closure removes nothing.
            getPackage: (id: string) => (id === PKG ? { manifest: { id: PKG } } : undefined),
        },
    };
    return { engine, rows, historyRows };
}
const PKG = 'app.sales';

// ─────────────────────────────────────────────────────────────────────────────
// The card's six shapes — every one Zod-valid, so a draft of it saves, and
// each one refused at publish by the rule named beside it.
// ─────────────────────────────────────────────────────────────────────────────

const CASES: Array<{ rule: string; type: string; item: { name: string } & Record<string, unknown> }> = [
    {
        // Reproduction 1: Start → Decision → End, a conditional edge whose CEL does not parse.
        rule: 'expression-invalid',
        type: 'flow',
        item: {
            name: 'edge_cel',
            label: 'Edge CEL',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'decide', type: 'decision', label: 'Decide' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'decide' },
                { id: 'e2', source: 'decide', target: 'end', type: 'conditional', condition: 'record.name ==' },
            ],
        },
    },
    {
        // Reproduction 2: a Webhook / API trigger with no secret.
        rule: 'flow-api-trigger-secret-missing',
        type: 'flow',
        item: {
            name: 'inbound_hook',
            label: 'Inbound Hook',
            type: 'api',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'api' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        },
    },
    {
        // Reproduction 3: an RLS read scope on a virtual (formula) field.
        rule: 'rls-predicate-unenforceable',
        type: 'permission',
        item: {
            name: 'sales_team',
            label: 'Sales Team',
            objects: { deal: { allowRead: true } },
            rowLevelSecurity: [{ name: 'hot_deals', object: 'deal', operation: 'select', using: 'record.deal_score > 5' }],
        },
    },
    {
        // Reproduction 4: a summary field with no summaryOperations.
        rule: 'field/summary-without-operations',
        type: 'object',
        item: {
            name: 'invoice',
            label: 'Invoice',
            sharingModel: 'private',
            fields: {
                name: { type: 'text', label: 'Name' },
                total: { type: 'summary', label: 'Total' },
            },
        },
    },
    {
        // Reproduction 5: a dashboard global filter on a field the bound
        // widget's object does not have.
        rule: 'dashboard-filter-field-unknown',
        type: 'dashboard',
        item: {
            name: 'deal_board',
            label: 'Deal Board',
            globalFilters: [{ field: 'region', type: 'select' }],
            widgets: [{ id: 'kpi_deals', type: 'metric', title: 'Deals', dataset: 'deals_live', values: ['deal_count'] }],
        },
    },
    {
        // Reproduction 6: a dataset whose include names no relationship.
        rule: 'dataset-include-unknown',
        type: 'dataset',
        item: {
            name: 'deal_rollup',
            label: 'Deal Rollup',
            object: 'deal',
            include: ['no_such_relation'],
            dimensions: [{ name: 'deal_name', field: 'name' }],
            measures: [{ name: 'deal_count', aggregate: 'count' }],
        },
    },
];

/** Stage one env-wide, package-bound draft (Studio's autosave shape). */
async function stageDraft(protocol: ObjectStackProtocolImplementation, type: string, item: { name: string }) {
    return (protocol as any).saveMetaItem({ type, name: item.name, item, packageId: PKG, mode: 'draft' });
}

/** The draft read Studio's editor makes, and its `_diagnostics`. */
async function draftDiagnostics(protocol: ObjectStackProtocolImplementation, type: string, name: string) {
    const read: any = await protocol.getMetaItem({ type, name, state: 'draft', packageId: PKG } as any);
    return read.item._diagnostics as { valid: boolean; errors?: Array<{ path: string; message: string; code?: string }> };
}

const pairs = (list: Array<{ rule?: string; code?: string; message: string }>) =>
    list.map((e) => [e.rule ?? e.code, e.message]).sort();

describe('a draft reads the verdict its publish gives (#26707)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    for (const c of CASES) {
        it(`${c.type} — [${c.rule}]: the draft saves, reads valid:false, and publish refuses with the same words`, async () => {
            const { engine, rows } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);

            // The draft still saves: no draft is refused by this card.
            const saved = await stageDraft(protocol, c.type, c.item);
            expect(saved).toMatchObject({ success: true, state: 'draft' });
            expect([...rows.values()].filter((r) => r.name === c.item.name).map((r) => r.state)).toEqual(['draft']);

            const diagnostics = await draftDiagnostics(protocol, c.type, c.item.name);

            // The publish refuses it, as it did before this card: one 422 on the
            // per-item door…
            const refusal: any = await protocol
                .publishMetaItem({ type: c.type, name: c.item.name, packageId: PKG } as any)
                .then(() => null, (e: unknown) => e);
            expect({ code: refusal?.code, status: refusal?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            expect(refusal.issues.map((i: any) => i.rule)).toContain(c.rule);

            // …and the draft's verdict is that refusal: valid:false, every
            // refused rule as an entry's `code`, with the publish's message.
            expect(diagnostics.valid).toBe(false);
            expect(pairs(diagnostics.errors ?? [])).toEqual(pairs(refusal.issues));
        });
    }

    it('the package publish refuses each of them and rolls the batch back, as before', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        for (const c of CASES) await stageDraft(protocol, c.type, c.item);

        const res: any = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.publishedCount).toBe(0);
        // The batch stops at its first refusal; that draft's own read named it.
        const first = res.failed[0];
        const diagnostics = await draftDiagnostics(protocol, first.type, first.name);
        expect(diagnostics.valid).toBe(false);
    });

    it('a clean draft still reads valid:true, with no entry added', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const flow = structuredClone(CASES[0]!.item) as any;
        flow.edges[1].condition = "record.name == 'x'";
        await stageDraft(protocol, 'flow', flow);

        expect(await draftDiagnostics(protocol, 'flow', flow.name)).toEqual({ valid: true });
        const published: any = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(published).toMatchObject({ success: true, failedCount: 0 });
    });

    it('a reference that resolves inside its own package is judged as "Publish all" judges it — not reported', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        // A dashboard drafted beside the dataset it binds: neither is live.
        await stageDraft(protocol, 'dataset', { ...liveDealDataset, name: 'deals_pending' });
        await stageDraft(protocol, 'dashboard', {
            name: 'pending_board',
            label: 'Pending Board',
            widgets: [{ id: 'kpi', type: 'metric', title: 'Deals', dataset: 'deals_pending', values: ['deal_count'] }],
        } as any);

        expect(await draftDiagnostics(protocol, 'dashboard', 'pending_board')).toEqual({ valid: true });
        const res: any = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(res).toMatchObject({ success: true, failedCount: 0 });
    });

    it('the same dashboard with its dataset nowhere is reported on its draft', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, 'dashboard', {
            name: 'pending_board',
            label: 'Pending Board',
            widgets: [{ id: 'kpi', type: 'metric', title: 'Deals', dataset: 'deals_pending', values: ['deal_count'] }],
        } as any);

        const diagnostics = await draftDiagnostics(protocol, 'dashboard', 'pending_board');
        expect(diagnostics.valid).toBe(false);
        expect(diagnostics.errors?.map((e) => e.code)).toContain('widget-dataset-unknown');
    });

    it('the draft-overlay preview read carries the same verdict', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const c = CASES[3]!;
        await stageDraft(protocol, c.type, c.item);

        const strict = await draftDiagnostics(protocol, c.type, c.item.name);
        const preview: any = await protocol.getMetaItem({ type: c.type, name: c.item.name, previewDrafts: true, packageId: PKG } as any);

        expect(preview.item._draft).toBe(true);
        expect(preview.item._diagnostics).toEqual(strict);
    });

    it('paths are item-relative where the finding is on the item itself', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, 'object', CASES[3]!.item);
        await stageDraft(protocol, 'flow', CASES[1]!.item);

        expect((await draftDiagnostics(protocol, 'object', 'invoice')).errors).toContainEqual(
            expect.objectContaining({ path: 'fields.total.summaryOperations', code: 'field/summary-without-operations' }),
        );
        expect((await draftDiagnostics(protocol, 'flow', 'inbound_hook')).errors).toContainEqual(
            expect.objectContaining({ path: 'nodes.0.config.secret', code: 'flow-api-trigger-secret-missing' }),
        );
    });
});
