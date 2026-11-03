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
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, hashSpec } from '@objectstack/metadata-core';
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
        // The active read asks `type: { $in: [type, plural] }`; no other
        // operator reaches this stub.
        if (v && typeof v === 'object' && Array.isArray((v as { $in?: unknown }).$in)) {
            if (!(v as { $in: unknown[] }).$in.includes((r as any)[k])) return false;
            continue;
        }
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
        async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
            const matched = table === 'sys_metadata_history'
                ? historyRows.filter((h) => matchesHistory(h, opts.where))
                : Array.from(rows.values()).filter((r) => matchesMetadataWhere(r, opts.where));
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
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
        // [#29007] The card's reproduction: a `titleFormat` on an object that
        // authors no `nameField`. The stamped pointer outranks the template,
        // so the save was a silent no-op; the ruling of record (6574393684,
        // letter B) refuses it at the save gate.
        rule: 'title-format-retired',
        type: 'object',
        item: {
            name: 'qar8_tf2',
            label: 'Title Format',
            sharingModel: 'public_read_write',
            titleFormat: '{code} @ {city}',
            fields: {
                code: { type: 'text', label: 'Code' },
                city: { type: 'text', label: 'City' },
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
        // [#27445] Not one of #26707's six: a widget `filterBindings` key that
        // names no filter the dashboard declares (`regoin` for `region`). It
        // saved, read valid:true and PUBLISHED before; the new rule's verdict
        // rides the same draft-read and publish seams as its five siblings.
        rule: 'dashboard-filter-binding-unknown',
        type: 'dashboard',
        item: {
            name: 'deal_binding_board',
            label: 'Deal Binding Board',
            globalFilters: [{ name: 'region', field: 'name', type: 'select' }],
            widgets: [{
                id: 'kpi_deals', type: 'metric', title: 'Deals', dataset: 'deals_live',
                values: ['deal_count'], filterBindings: { regoin: false },
            }],
        },
    },
    {
        // [#28663] Not one of #26707's six: an app navigation entry whose
        // `visible` does not parse (the card's `'org_owner' in`). It saved, read
        // valid:true and PUBLISHED, and the console then hid the entry from
        // everyone; the same fault in a page `visibleWhen` was refused.
        rule: 'visibility-predicate-syntax',
        type: 'app',
        item: {
            name: 'qa_nav_app',
            label: 'QA Nav App',
            navigation: [{ id: 'nav_admin_only', type: 'object', label: 'Admin Only', objectName: 'deal', visible: "'org_owner' in" }],
        },
    },
    {
        // [#28663] The same fault inside an area's navigation.
        rule: 'visibility-predicate-syntax',
        type: 'app',
        item: {
            name: 'qa_area_app',
            label: 'QA Area App',
            areas: [{
                id: 'area_ops', label: 'Ops',
                navigation: [{ id: 'nav_admin_only', type: 'object', label: 'Admin Only', objectName: 'deal', visible: "'org_owner' in" }],
            }],
        },
    },
    {
        // [#28726] An app navigation entry whose `visible` is valid CEL but
        // overruns `maxAstNodes` (the card's 90-clause `||` chain). It saved,
        // read valid:true and published; the console then withheld the entry
        // from everyone. A page `visibleWhen` of the same size was refused.
        rule: 'visibility-predicate-over-budget',
        type: 'app',
        item: {
            name: 'qa_nav_budget_app',
            label: 'QA Nav Budget App',
            navigation: [{ id: 'nav_admin_only', type: 'object', label: 'Admin Only', objectName: 'deal', visible: Array.from({ length: 90 }, () => 'features.cloudManaged != true').join(' || ') }],
        },
    },
    {
        // [#28726] The same overrun on a group's child entry.
        rule: 'visibility-predicate-over-budget',
        type: 'app',
        item: {
            name: 'qa_nav_budget_child_app',
            label: 'QA Nav Budget Child App',
            navigation: [{
                id: 'grp', type: 'group', label: 'Group',
                children: [{ id: 'nav_admin_only', type: 'object', label: 'Admin Only', objectName: 'deal', visible: Array.from({ length: 90 }, () => 'features.cloudManaged != true').join(' || ') }],
            }],
        },
    },
    {
        // [#28663] Page variables: a duplicate name.
        rule: 'page-variable-name-duplicate',
        type: 'page',
        item: {
            name: 'qa_vars_dup', label: 'Vars', type: 'app',
            variables: [{ name: 'count', type: 'number' }, { name: 'count', type: 'string' }],
            regions: [{ name: 'main', components: [{ type: 'page:header', properties: { title: 'Vars' } }] }],
        },
    },
    {
        // [#28663] Page variables: an empty name.
        rule: 'page-variable-name-empty',
        type: 'page',
        item: {
            name: 'qa_vars_empty', label: 'Vars', type: 'app',
            variables: [{ name: '', type: 'string' }],
            regions: [{ name: 'main', components: [{ type: 'page:header', properties: { title: 'Vars' } }] }],
        },
    },
    {
        // [#28663] Page variables: a `number` seeded with "abc" (the card's shape).
        rule: 'page-variable-default-type',
        type: 'page',
        item: {
            name: 'qa_vars_type', label: 'Vars', type: 'app',
            variables: [{ name: 'count', type: 'number', defaultValue: 'abc' }],
            regions: [{ name: 'main', components: [{ type: 'page:header', properties: { title: 'Vars' } }] }],
        },
    },
    {
        // [#28725] A page variable whose `source` names no component on the
        // page (the card's `no_such_component`): nothing ever writes it.
        rule: 'page-variable-source-unknown',
        type: 'page',
        item: {
            name: 'qa_vars_source', label: 'Vars', type: 'app',
            variables: [{ name: 'selectedProjectId', type: 'record_id', source: 'no_such_component' }],
            regions: [{ name: 'main', components: [
                { id: 'project_picker', type: 'element:record_picker', dataSource: { object: 'deal' }, properties: { label: 'Deal', labelField: 'name' } },
            ] }],
        },
    },
    {
        // [#28725] A component `visibleWhen` reading an undeclared variable
        // (the card's `page.nosuch == 'x'`): the read never resolves.
        rule: 'visibility-page-variable-undeclared',
        type: 'page',
        item: {
            name: 'qa_vars_read', label: 'Vars', type: 'app',
            variables: [{ name: 'selectedProjectId', type: 'record_id' }],
            regions: [{ name: 'main', components: [
                { type: 'page:header', properties: { title: 'Vars' }, visibleWhen: "page.nosuch == 'x'" },
            ] }],
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
    {
        // [#29025] Not one of #26707's six: a loop whose closing edge is not
        // typed `back` (the card's push → check → revise → push). It saved,
        // read valid:true and PUBLISHED, and the engine then refused to
        // register it, so the flow never ran.
        rule: 'flow-undeclared-cycle',
        type: 'flow',
        item: {
            name: 'rework_loop',
            label: 'Rework Loop',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'push', type: 'assignment', label: 'Push' },
                { id: 'check', type: 'decision', label: 'Check' },
                { id: 'revise', type: 'assignment', label: 'Revise' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'push' },
                { id: 'e2', source: 'push', target: 'check' },
                { id: 'e3', source: 'check', target: 'end', type: 'conditional', condition: "record.name == 'done'" },
                { id: 'e4', source: 'check', target: 'revise', type: 'conditional', condition: "record.name != 'done'" },
                { id: 'e5', source: 'revise', target: 'push' },
            ],
        },
    },
    {
        // [#29233] A loop whose body closes on itself (body a → b → a, the
        // card's reproduction). It saved, read valid:true and PUBLISHED, and
        // the engine's region check then refused to register it.
        rule: 'flow-region-shape-invalid',
        type: 'flow',
        item: regionFlow('region_loop', {
            id: 'lp',
            type: 'loop',
            label: 'Loop',
            config: {
                collection: [1, 2],
                iteratorVariable: 'row',
                body: {
                    nodes: [
                        { id: 'step_a', type: 'assignment', label: 'A' },
                        { id: 'step_b', type: 'assignment', label: 'B' },
                    ],
                    edges: [
                        { id: 'b1', source: 'step_a', target: 'step_b' },
                        { id: 'b2', source: 'step_b', target: 'step_a' },
                    ],
                },
            },
        }),
    },
];

/** [#29233] start → CONTAINER → end, the container's region carrying the case. */
function regionFlow(name: string, container: Record<string, unknown>) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            container,
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: container.id as string },
            { id: 'e2', source: container.id as string, target: 'end' },
        ],
    };
}

/** [#29233] One straight body of a single step, the well-formed region shape. */
function oneStep(id: string) {
    return { nodes: [{ id, type: 'assignment', label: id }], edges: [] };
}

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

    it('[#29233] a well-formed loop, parallel and try_catch region each still read valid:true and publish', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const flows = [
            regionFlow('ok_loop', {
                id: 'lp', type: 'loop', label: 'Loop',
                config: { collection: [1, 2], iteratorVariable: 'row', body: oneStep('loop_step') },
            }),
            regionFlow('ok_parallel', {
                id: 'fan', type: 'parallel', label: 'Fan',
                config: { branches: [oneStep('left_step'), oneStep('right_step')] },
            }),
            regionFlow('ok_try', {
                id: 'guard', type: 'try_catch', label: 'Guard',
                config: { try: oneStep('try_step'), catch: oneStep('catch_step') },
            }),
        ];
        for (const flow of flows) await stageDraft(protocol, 'flow', flow);

        for (const flow of flows) expect(await draftDiagnostics(protocol, 'flow', flow.name)).toEqual({ valid: true });
        const published: any = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(published).toMatchObject({ success: true, publishedCount: 3, failedCount: 0 });
    });

    it('[#29233] the region verdict on the draft read is the registry rule\'s: the engine\'s sentence, at the item root', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        // A one-branch parallel block nested in a try region. The registry rule
        // judges the flow as one unit (as the engine does) and anchors the
        // flow itself, so the item-relative path is the item root; the
        // sentence names the region.
        const flow = regionFlow('nested_region', {
            id: 'guard', type: 'try_catch', label: 'Guard',
            config: {
                try: {
                    nodes: [{ id: 'fan', type: 'parallel', label: 'Fan', config: { branches: [oneStep('only_step')] } }],
                    edges: [],
                },
                catch: oneStep('catch_step'),
            },
        });
        await stageDraft(protocol, 'flow', flow);

        const diagnostics = await draftDiagnostics(protocol, 'flow', flow.name);
        expect(diagnostics.valid).toBe(false);
        expect((diagnostics.errors ?? []).filter((e) => e.code === 'flow-region-shape-invalid')).toEqual([{
            path: '',
            message: "Flow 'nested_region' would be refused at registration: parallel 'fan': a parallel block needs at least 2 branches",
            code: 'flow-region-shape-invalid',
        }]);
    });

    it('[#29025] the same loop with its closing edge typed back still reads valid:true and publishes', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const flow = structuredClone(CASES.find((c) => c.item.name === 'rework_loop')!.item) as any;
        flow.edges[4].type = 'back';
        await stageDraft(protocol, 'flow', flow);

        expect(await draftDiagnostics(protocol, 'flow', flow.name)).toEqual({ valid: true });
        const published: any = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(published).toMatchObject({ success: true, failedCount: 0 });
    });

    it('[#28663] a clean nav predicate and clean page variables still read valid:true and publish', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const app = structuredClone(CASES.find((c) => c.item.name === 'qa_nav_app')!.item) as any;
        app.navigation[0].visible = "'org_owner' in current_user.positions";
        const page = structuredClone(CASES.find((c) => c.item.name === 'qa_vars_type')!.item) as any;
        page.variables = [{ name: 'count', type: 'number', defaultValue: 0 }, { name: 'label', type: 'string' }];
        await stageDraft(protocol, 'app', app);
        await stageDraft(protocol, 'page', page);

        expect(await draftDiagnostics(protocol, 'app', app.name)).toEqual({ valid: true });
        expect(await draftDiagnostics(protocol, 'page', page.name)).toEqual({ valid: true });
        const published: any = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(published).toMatchObject({ success: true, failedCount: 0 });
    });

    it('[#28663] the nav and variable verdicts are located at the key on the draft read', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        for (const name of ['qa_area_app', 'qa_vars_type']) {
            const c = CASES.find((x) => x.item.name === name)!;
            await stageDraft(protocol, c.type, c.item);
        }

        expect((await draftDiagnostics(protocol, 'app', 'qa_area_app')).errors).toContainEqual(
            expect.objectContaining({ path: 'areas.0.navigation.0.visible', code: 'visibility-predicate-syntax' }),
        );
        expect((await draftDiagnostics(protocol, 'page', 'qa_vars_type')).errors).toContainEqual(
            expect.objectContaining({ path: 'variables.0.defaultValue', code: 'page-variable-default-type' }),
        );
    });

    it('[#28725] a `source` naming a component on the page and a declared `page.NAME` read still read valid:true and publish', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const source = structuredClone(CASES.find((c) => c.item.name === 'qa_vars_source')!.item) as any;
        source.variables[0].source = 'project_picker';
        const read = structuredClone(CASES.find((c) => c.item.name === 'qa_vars_read')!.item) as any;
        read.regions[0].components[0].visibleWhen = "page.selectedProjectId != ''";
        await stageDraft(protocol, 'page', source);
        await stageDraft(protocol, 'page', read);

        expect(await draftDiagnostics(protocol, 'page', source.name)).toEqual({ valid: true });
        expect(await draftDiagnostics(protocol, 'page', read.name)).toEqual({ valid: true });
        const published: any = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(published).toMatchObject({ success: true, failedCount: 0 });
    });

    it('[#28725] both verdicts are located at the reference on the draft read', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        for (const name of ['qa_vars_source', 'qa_vars_read']) {
            const c = CASES.find((x) => x.item.name === name)!;
            await stageDraft(protocol, c.type, c.item);
        }

        expect((await draftDiagnostics(protocol, 'page', 'qa_vars_source')).errors).toContainEqual(
            expect.objectContaining({ path: 'variables.0.source', code: 'page-variable-source-unknown' }),
        );
        expect((await draftDiagnostics(protocol, 'page', 'qa_vars_read')).errors).toContainEqual(
            expect.objectContaining({ path: 'regions.0.components.0', code: 'visibility-page-variable-undeclared' }),
        );
    });

    it('[#28726] the nav over-budget verdict is located at the key on the draft read; a chain inside the budget reads valid:true', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const c = CASES.find((x) => x.item.name === 'qa_nav_budget_child_app')!;
        await stageDraft(protocol, c.type, c.item);
        expect((await draftDiagnostics(protocol, 'app', 'qa_nav_budget_child_app')).errors).toContainEqual(
            expect.objectContaining({ path: 'navigation.0.children.0.visible', code: 'visibility-predicate-over-budget' }),
        );

        const under = structuredClone(CASES.find((x) => x.item.name === 'qa_nav_budget_app')!.item) as any;
        under.name = 'qa_nav_budget_under_app';
        under.navigation[0].visible = Array.from({ length: 51 }, () => 'features.cloudManaged != true').join(' || ');
        await stageDraft(protocol, 'app', under);
        expect(await draftDiagnostics(protocol, 'app', under.name)).toEqual({ valid: true });
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

    it('[#27828] a node config value refused by expression-invalid is located at the node, not in where prose', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        // Studio's Update Records value with its expression left blank.
        const flow = {
            name: 'blank_value',
            label: 'Blank Value',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'set',
                    type: 'update_record',
                    label: 'Set',
                    config: { objectName: 'deal', filter: { id: 'x' }, fields: { name: { dialect: 'cel', source: '   ' } } },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'set' },
                { id: 'e2', source: 'set', target: 'end' },
            ],
        };
        await stageDraft(protocol, 'flow', flow);

        const diagnostics = await draftDiagnostics(protocol, 'flow', flow.name);
        const refused = (diagnostics.errors ?? []).filter((e) => e.code === 'expression-invalid');
        expect(diagnostics.valid).toBe(false);
        expect(refused.length).toBeGreaterThan(0);
        // `nodes.<index>.…` is the spelling Studio's Problems list maps onto a node.
        for (const e of refused) expect(e.path).toBe('nodes.1.config.fields.name');
    });
});

describe('[#27444] an object draft without its package namespace prefix', () => {
    // A package whose manifest DECLARES a namespace, beside the stub's
    // namespace-less base: the prefix rule judges only the former.
    const NS_PKG = 'qa.scratch.r2';
    const nsEngine = () => {
        const stub = makeStubEngine();
        const base = stub.engine.registry.getPackage;
        stub.engine.registry.getPackage = (id: string) =>
            id === NS_PKG ? { manifest: { id: NS_PKG, namespace: 'r2' } } : base(id);
        return stub;
    };
    const objectBody = (name: string) => ({
        name,
        label: 'Formula Pkg',
        sharingModel: 'private',
        fields: { name: { type: 'text', label: 'Name' } },
    });
    const stage = (protocol: ObjectStackProtocolImplementation, name: string) =>
        (protocol as any).saveMetaItem({ type: 'object', name, item: objectBody(name), packageId: NS_PKG, mode: 'draft' });
    const read = async (protocol: ObjectStackProtocolImplementation, name: string) =>
        ((await protocol.getMetaItem({ type: 'object', name, state: 'draft', packageId: NS_PKG } as any)) as any)
            .item._diagnostics as { valid: boolean; errors?: Array<{ path: string; message: string; code?: string }> };

    it('saves as a draft, and its read carries the NAMESPACE_PREFIX refusal publish-drafts gives', async () => {
        const { engine, rows } = nsEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        // The draft still saves (ADR-0129 D2: a draft is judged when it is promoted).
        expect(await stage(protocol, 'qa_formula_pkg_r2')).toMatchObject({ success: true, state: 'draft' });
        expect([...rows.values()].filter((r) => r.name === 'qa_formula_pkg_r2').map((r) => r.state)).toEqual(['draft']);

        const diagnostics = await read(protocol, 'qa_formula_pkg_r2');

        // The batch publish still refuses it, as before…
        const res: any = await protocol.publishPackageDrafts({ packageId: NS_PKG });
        expect(res).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0 });
        const refused = res.failed.find((f: any) => f.name === 'qa_formula_pkg_r2');
        expect(refused?.code).toBe('NAMESPACE_PREFIX');

        // …and the draft's verdict is that refusal: its code, its sentence.
        expect(diagnostics.valid).toBe(false);
        expect(diagnostics.errors?.filter((e) => e.code === 'NAMESPACE_PREFIX').map((e) => e.message))
            .toEqual([refused.error]);
    });

    it('a prefixed draft object in the same package still reads valid:true', async () => {
        const { engine } = nsEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stage(protocol, 'r2_formula_pkg');

        expect(await read(protocol, 'r2_formula_pkg')).toEqual({ valid: true });
        expect(await protocol.publishPackageDrafts({ packageId: NS_PKG })).toMatchObject({ success: true, failedCount: 0 });
    });
});

describe('[#27445] a stored dashboard carrying an undeclared filterBindings key', () => {
    const board = CASES.find((c) => c.rule === 'dashboard-filter-binding-unknown')!.item;

    it('still loads unchanged — the rule judges the authoring path, never the read', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        // A row written while no rule judged it: the save path with the
        // authoring gate switched off, which stores the body verbatim exactly
        // as a write made before this rule existed did.
        process.env.OS_ALLOW_UNLINTED_METADATA_WRITES = '1';
        try {
            const saved: any = await (protocol as any).saveMetaItem({ type: 'dashboard', name: board.name, item: board, packageId: PKG });
            expect(saved.success).toBe(true);
        } finally {
            delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
        }
        expect([...rows.values()].filter((r) => r.name === board.name).map((r) => r.state)).toEqual(['active']);

        const read: any = await protocol.getMetaItem({ type: 'dashboard', name: board.name, packageId: PKG } as any);
        expect(read.item.widgets[0].filterBindings).toEqual({ regoin: false });
    });

    it('is refused on its next save, naming the key and the declared filters', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const err: any = await (protocol as any)
            .saveMetaItem({ type: 'dashboard', name: board.name, item: board, packageId: PKG })
            .then(() => null, (e: unknown) => e);
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = err.issues.find((i: any) => i.rule === 'dashboard-filter-binding-unknown');
        expect(issue.message).toContain('`filterBindings.regoin`');
        expect(issue.message).toContain('(declared: region)');
    });
});

describe('[#29007] a stored object carrying the retired titleFormat', () => {
    const titled = CASES.find((c) => c.rule === 'title-format-retired')!.item;

    it('still loads and reads the key — the schema parses it, no conversion drops it', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        // A row written before the refusal: the save path with the authoring
        // gate switched off stores the body verbatim, as a pre-ruling write did.
        process.env.OS_ALLOW_UNLINTED_METADATA_WRITES = '1';
        try {
            const saved: any = await (protocol as any).saveMetaItem({ type: 'object', name: titled.name, item: titled, packageId: PKG });
            expect(saved.success).toBe(true);
        } finally {
            delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
        }
        expect([...rows.values()].filter((r) => r.name === titled.name).map((r) => r.state)).toEqual(['active']);

        const read: any = await protocol.getMetaItem({ type: 'object', name: titled.name, packageId: PKG } as any);
        const tf = read.item.titleFormat;
        expect(typeof tf === 'string' ? tf : tf?.source).toBe('{code} @ {city}');
    });

    it('is refused on its next save with the prescription, and the same body without it saves', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const err: any = await (protocol as any)
            .saveMetaItem({ type: 'object', name: titled.name, item: titled, packageId: PKG })
            .then(() => null, (e: unknown) => e);
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = err.issues.find((i: any) => i.rule === 'title-format-retired');
        expect(issue, JSON.stringify(err.issues)).toBeDefined();
        expect(issue.message).toContain('migrate to nameField');

        // The control: the author's fix — the pointer, no template — saves.
        const { titleFormat: _dropped, ...fixed } = titled as Record<string, unknown>;
        const saved: any = await (protocol as any).saveMetaItem({
            type: 'object', name: titled.name, item: { ...fixed, nameField: 'code' }, packageId: PKG,
        });
        expect(saved.success).toBe(true);
    });
});

// [#29557, #29696] The legacy-D2 flow fixtures the publish doors (#29557) and the
// reads (#29696) are both pinned on.

/** start → get_record → end, the match map spelled under `filterKey`. */
const fetchFlow = (name: string, filterKey: 'filters' | 'filter') => ({
    name,
    label: name,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'fetch', type: 'get_record', label: 'Fetch', config: { objectName: 'deal', [filterKey]: { name: 'Acme' }, outputVariable: 'deal' } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'fetch' },
        { id: 'e2', source: 'fetch', target: 'end' },
    ],
});

/** The stored active row a legacy draft is a re-save of. */
async function seedActive(engine: any, body: { name: string }) {
    await engine.insert('sys_metadata', {
        type: 'flow',
        name: body.name,
        organization_id: null,
        package_id: PKG,
        state: 'active',
        metadata: JSON.stringify(body),
        checksum: hashSpec(body, 'flow'),
        version: 1,
    });
}

const storedConfig = (rows: Map<string, Row>, name: string, state: 'active' | 'draft') => {
    const row = [...rows.values()].find((r) => r.type === 'flow' && r.name === name && r.state === state);
    return row ? JSON.parse(row.metadata).nodes[1].config : undefined;
};

/**
 * [#29557] A flow draft stored in a legacy ADR-0087 D2 spelling the engine
 * registers (`get_record` `config.filters`, `flow-node-crud-filter-alias`). The
 * save door judges a flow on the canonicalizer's fallback in its D2-converted
 * spelling and stores the raw body (#21982), so the draft saves; both publish
 * doors and the draft read judge the stored draft through the same seam, so it
 * publishes, and what goes live is the stored bytes.
 *
 * The draft is the realistic one: a stored active row carries the spelling (a
 * row at rest), and the author's draft re-save of it carries the same hit, so
 * the save replays the full chain (#23903 ruling B'). This harness reaches no
 * automation service, so every save takes the fallback.
 */
describe('[#29557] a stored flow draft in a legacy D2 spelling the engine registers', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
    });

    async function stageLegacy(name: string, body = fetchFlow(name, 'filters')) {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await seedActive(engine, body);
        const saved = await stageDraft(protocol, 'flow', body);
        expect(saved).toMatchObject({ success: true, state: 'draft' });
        // Stored as written: the conversion is the verdict's, never the row's.
        expect(storedConfig(rows, name, 'draft')).toEqual({ objectName: 'deal', filters: { name: 'Acme' }, outputVariable: 'deal' });
        return { engine, rows, protocol };
    }

    it('publishes through the per-item door, and the active row is the stored bytes', async () => {
        const { rows, protocol } = await stageLegacy('legacy_fetch');

        const published: any = await protocol.publishMetaItem({ type: 'flow', name: 'legacy_fetch', packageId: PKG } as any);

        expect(published.success).toBe(true);
        expect(storedConfig(rows, 'legacy_fetch', 'active')).toEqual({ objectName: 'deal', filters: { name: 'Acme' }, outputVariable: 'deal' });
        expect(storedConfig(rows, 'legacy_fetch', 'draft')).toBeUndefined();
    });

    it('publishes through the package door, and the active row is the stored bytes', async () => {
        const { rows, protocol } = await stageLegacy('legacy_fetch');

        const published: any = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(published).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(storedConfig(rows, 'legacy_fetch', 'active')).toEqual({ objectName: 'deal', filters: { name: 'Acme' }, outputVariable: 'deal' });
    });

    it('its draft read reports no publish refusal for it', async () => {
        const { rows, protocol } = await stageLegacy('legacy_fetch');
        const stored = JSON.parse([...rows.values()].find((r) => r.name === 'legacy_fetch' && r.state === 'draft')!.metadata);

        // The draft read's publish verdict, on the stored draft: nothing.
        expect(await (protocol as any).draftPublishVerdict({ type: 'flow', name: 'legacy_fetch', body: stored, packageId: PKG }))
            .toEqual([]);
        // Served, it carries none of the rules the publish refused it on before.
        // (The read's own schema half still judges the served body as stored;
        // that seam is the read's, not the publish verdict's.)
        const codes = ((await draftDiagnostics(protocol, 'flow', 'legacy_fetch')).errors ?? []).map((e) => e.code);
        expect(codes).not.toContain('expression-invalid');
        expect(codes).not.toContain('flow-region-shape-invalid');
    });

    /** The same flow with a conditional edge whose CEL does not parse. */
    const brokenEdge = (name: string, filterKey: 'filters' | 'filter') => {
        const flow = fetchFlow(name, filterKey);
        flow.edges[1] = { ...flow.edges[1]!, type: 'conditional', condition: 'record.name ==' } as typeof flow.edges[number];
        return flow;
    };

    /** The per-item door's 422 for a draft of `body`, staged as `stageLegacy` stages it. */
    async function perItemRefusal(body: ReturnType<typeof fetchFlow>) {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await seedActive(engine, body);
        await stageDraft(protocol, 'flow', body);
        const err: any = await protocol.publishMetaItem({ type: 'flow', name: body.name, packageId: PKG } as any)
            .then(() => null, (e: unknown) => e);
        return { protocol, err };
    }

    const issueTriples = (issues: Array<{ rule?: string; path?: string; message: string }>) =>
        issues.map((i) => [i.rule, i.path, i.message]).sort();

    it('a draft still refused once converted is refused at both doors with the issues its canonical spelling gets', async () => {
        const canonical = await perItemRefusal(brokenEdge('broken_fetch', 'filter'));
        const legacy = await perItemRefusal(brokenEdge('broken_fetch', 'filters'));

        expect({ code: canonical.err?.code, status: canonical.err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(canonical.err.issues.map((i: any) => i.rule)).toContain('expression-invalid');
        expect({ code: legacy.err?.code, status: legacy.err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(issueTriples(legacy.err.issues)).toEqual(issueTriples(canonical.err.issues));

        // The package door refuses the same draft, on the same issues, and
        // publishes nothing.
        const batch: any = await legacy.protocol.publishPackageDrafts({ packageId: PKG });
        expect(batch).toMatchObject({ success: false, publishedCount: 0 });
        expect(batch.failed.map((f: any) => f.name)).toEqual(['broken_fetch']);
        expect(issueTriples(batch.failed[0].issues)).toEqual(issueTriples(canonical.err.issues));
    });
});

/**
 * [#29696] A flow READ judges a stored legacy D2 row in the spelling the doors
 * judge it in. A row at rest in a legacy ADR-0087 D2 spelling (`get_record`
 * `config.filters`) is accepted by the save door, both publish doors (#29557)
 * and the engine's canonicalizer; the read's `_diagnostics` schema half judges
 * it through the same seam (`storedFlowVerdictBody`), and serves it as stored.
 * Measured on `origin/main` `0eb97fa4` before the fix: every read below
 * answered `valid: false` with `unrecognized_keys` on `config.filters`.
 */
describe('[#29696] a flow read judges a stored legacy D2 row in its D2-converted spelling', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
    });

    /** The legacy fixture with a config key no conversion rewrites and the parse refuses. */
    const withUndeclaredKey = (name: string, filterKey: 'filters' | 'filter') => {
        const flow = fetchFlow(name, filterKey);
        flow.nodes[1] = { ...flow.nodes[1]!, config: { ...flow.nodes[1]!.config, not_a_config_key: true } } as typeof flow.nodes[number];
        return flow;
    };

    async function seeded(body: { name: string }) {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await seedActive(engine, body);
        return { engine, rows, protocol };
    }

    /** The active item read's `_diagnostics` and the config it serves. */
    async function activeRead(protocol: ObjectStackProtocolImplementation, name: string) {
        const read: any = await protocol.getMetaItem({ type: 'flow', name, packageId: PKG } as any);
        return { diagnostics: read.item._diagnostics, config: read.item.nodes[1].config };
    }

    it('the active item read reads valid: true and serves the stored bytes', async () => {
        const { protocol } = await seeded(fetchFlow('legacy_fetch', 'filters'));

        const { diagnostics, config } = await activeRead(protocol, 'legacy_fetch');

        expect(diagnostics).toEqual({ valid: true });
        expect(config).toEqual({ objectName: 'deal', filters: { name: 'Acme' }, outputVariable: 'deal' });
    });

    it('the list read reads valid: true and serves the stored bytes', async () => {
        const { protocol } = await seeded(fetchFlow('legacy_fetch', 'filters'));

        const list: any = await protocol.getMetaItems({ type: 'flow', packageId: PKG });
        const item = (list.items as any[]).find((i) => i.name === 'legacy_fetch');

        expect(item?._diagnostics).toEqual({ valid: true });
        expect(item.nodes[1].config).toEqual({ objectName: 'deal', filters: { name: 'Acme' }, outputVariable: 'deal' });
    });

    it('the layered read reads valid: true', async () => {
        const { protocol } = await seeded(fetchFlow('legacy_fetch', 'filters'));

        const layered: any = await protocol.getMetaItemLayered({ type: 'flow', name: 'legacy_fetch', packageId: PKG } as any);

        expect(layered._diagnostics).toEqual({ valid: true });
    });

    it('the draft read of a re-save of it reads valid: true', async () => {
        const body = fetchFlow('legacy_fetch', 'filters');
        const { rows, protocol } = await seeded(body);
        expect(await stageDraft(protocol, 'flow', body)).toMatchObject({ success: true, state: 'draft' });
        expect(storedConfig(rows, 'legacy_fetch', 'draft')).toEqual({ objectName: 'deal', filters: { name: 'Acme' }, outputVariable: 'deal' });

        expect(await draftDiagnostics(protocol, 'flow', 'legacy_fetch')).toEqual({ valid: true });
    });

    it('a row still refused once converted reads valid: false, with the errors its canonical spelling reads', async () => {
        const canonical = await activeRead((await seeded(withUndeclaredKey('refused_fetch', 'filter'))).protocol, 'refused_fetch');
        const legacy = await activeRead((await seeded(withUndeclaredKey('refused_fetch', 'filters'))).protocol, 'refused_fetch');

        expect(canonical.diagnostics.valid).toBe(false);
        expect(JSON.stringify(canonical.diagnostics.errors)).toContain('not_a_config_key');
        expect(legacy.diagnostics).toEqual(canonical.diagnostics);
        // Served as stored: the legacy spelling is what the read hands back.
        expect(legacy.config.filters).toEqual({ name: 'Acme' });
    });
});
