// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15950 — the runtime authoring gate resolves references against the LIVE
 * metadata universe, which includes what a runtime author just SAVED.
 *
 * ## The defect, as measured end to end before anything was changed
 *
 * Driving the real write path over the harness below, in one process, with no
 * restart between the steps:
 *
 *   1. `saveMetaItem({ type: 'dataset', name: 'p2008_users' })` → `success`,
 *      `state: 'active'`, one row in `sys_metadata`.
 *   2. `registry.listItems('dataset')` → the five code-package datasets and
 *      NOTHING else. The five are the firing control: they are in the same
 *      read, so this is a measurement of an absence and not of a dead stub.
 *   3. `getMetaItems({ type: 'dataset' })` → SIX, the authored one included.
 *   4. `saveMetaItem({ type: 'dashboard' })`, three widgets bound to it →
 *      `422 INVALID_METADATA`, THREE `widget-dataset-unknown`, hint
 *      `"Declared datasets: sys_user_metrics, …"` — every dataset except the
 *      one the author had just saved.
 *
 * Steps 2 and 3 are the whole defect in two lines: two readers of the word
 * "live" disagreeing about the same artifact in the same instant. `runtime-gate.ts`
 * declares the field it fills as "The live dataset declarations", so the reader
 * in breach was the gate's, which consulted the SchemaRegistry alone. The
 * registry is a BOOT-time universe for every type except `object`:
 * `applyRegistryWriteThrough` registers an object unconditionally and returns
 * early for everything else on an environment-scoped kernel, so the row is
 * invisible until a restart re-hydrates it. That is why the card's step 5 —
 * restart, replay byte for byte — answered `200`.
 *
 * ## Why this is pinned HERE and not against the gate's arguments
 *
 * The gate is a pure function of its arguments and `runRuntimeAuthoringRules`
 * is already pinned both ways against hand-built ones (`runtime-gate.*.test.ts`
 * in `@objectstack/lint`). Those pins could not see this defect and never
 * will: the ARGUMENTS were the wrong thing. What has to be exercised is the
 * GATHER — `assertRuntimeAuthoringRules` building its own context from the
 * host — so every test below drives `saveMetaItem`, the same door the card
 * drove, and asserts on what that door answers.
 *
 * Harness: the real repository write path over a stub engine, the shape
 * `protocol.dashboard-dataset-publish-gate.test.ts` (#7529) established for
 * exactly this reason. Two things in it are modelled from declarations rather
 * than guessed, because the measurement is worthless if they are wrong:
 * `sys_metadata.state` carries `defaultValue: 'active'`
 * (`metadata-core/src/objects/sys-metadata.object.ts`), and the protocol is
 * constructed with an environment id — the ordinary tenant posture, and the one
 * on which the write-through gate above returns early.
 *
 * Refusal assertions follow the ADR-0112 envelope discipline: `code` AND
 * `status`, never a bare `rejects.toThrow()`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the fake engine cannot
// accept a call ObjectQL would refuse. From `@objectstack/metadata-core` and
// never `@objectstack/objectql`: objectql depends on this package (#5619).
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import {
    DASHBOARD_FILTER_FIELD_UNKNOWN,
    VIEW_PAGE_UNRESOLVED,
    WIDGET_MEASURE_UNKNOWN,
} from '@objectstack/lint';
import { ObjectStackProtocolImplementation } from './protocol.js';

const WIDGET_DATASET_UNKNOWN = 'widget-dataset-unknown';

/**
 * The card's own hint, verbatim, is the list of code-package datasets this
 * deployment declares — so they are the firing control for every "the authored
 * one is missing" reading below.
 */
const CODE_DATASET_NAMES = [
    'sys_user_metrics',
    'sys_organization_metrics',
    'sys_session_metrics',
    'sys_package_installation_metrics',
    'sys_audit_log_metrics',
] as const;

/**
 * [#16224] The `orders` columns the code package's own declaration carries —
 * the BASE layer, the shape a `sys_metadata` row written by an author has
 * (ADR-0029 D9.2).
 */
const ORDERS_BASE_FIELDS = [
    { name: 'amount', type: 'number' },
    { name: 'status', type: 'text' },
    { name: 'region', type: 'text' },
];

/**
 * [#16224] What an `extend` contributor adds. Present in the registry's
 * RESOLVED copy and in nothing an author writes — so a reference to it is
 * exactly the "resolves today, reads as dangling tomorrow" phantom #16223
 * declined to trade for.
 */
const ORDERS_EXTENDED_FIELDS = [{ name: 'priority', type: 'text' }];

const datasetBody = (name: string) => ({
    name,
    label: name,
    object: 'orders',
    dimensions: [
        { name: 'status', field: 'status' },
        { name: 'region', field: 'region' },
    ],
    measures: [{ name: 'order_count', aggregate: 'count' }],
});

/** The card's board: three widgets, all bound to the runtime-authored dataset. */
const threeWidgetBoard = (dataset: string) => ({
    name: 'p2008_dash',
    label: 'Pin smoke dashboard',
    widgets: [
        { id: 'kpi', type: 'metric', title: 'Total', dataset, values: ['order_count'] },
        {
            id: 'by_status', type: 'bar', title: 'By status', dataset,
            dimensions: ['status'], values: ['order_count'],
            chartConfig: { type: 'bar', xAxis: { field: 'status' }, yAxis: [{ field: 'order_count' }] },
        },
        {
            id: 'by_region', type: 'donut', title: 'By region', dataset,
            dimensions: ['region'], values: ['order_count'],
            chartConfig: { type: 'donut', series: [{ name: 'order_count' }] },
        },
    ],
});

/** A standalone list overlay mounting a page, as `saveMetaItem` stores one. */
const pageMountView = (pageName: string) => ({
    name: 'orders.dashboard',
    object: 'orders',
    viewKind: 'list',
    type: 'page',
    pageName,
    columns: [],
});

/**
 * [#16224] A board whose DASHBOARD FILTER targets one column of the dataset's
 * object — the position `validateWidgetBindings` resolves against the object
 * graph, and therefore the one that reads the `object` collection this gate
 * gathers.
 */
const filterBoard = (boardName: string, field: string) => ({
    name: boardName,
    label: 'Object-graph smoke dashboard',
    globalFilters: [{ name: 'scope', field, type: 'select' }],
    widgets: [{
        id: 'kpi', type: 'metric', title: 'Total',
        dataset: 'sys_user_metrics', values: ['order_count'],
    }],
});

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
    package_id?: string | null;
}

/**
 * ⚠️ The engine below is keyed BY TABLE, and that is a correctness property of
 * the harness rather than tidiness. The stub this one is modelled on keeps one
 * flat row map and skips `sys_metadata_audit` by name, which was invisible for
 * as long as nothing read `sys_metadata` as a table: a draft save writes a
 * `sys_metadata_history` row that carries no `state`, so a flat map served it
 * back as an ACTIVE metadata row and a draft-only dataset resolved. Measured
 * here — the draft test below failed for exactly that reason before the tables
 * were separated, and it is the kind of green that would have looked like the
 * product accepting a draft.
 */
function makeHarness() {
    const tables = new Map<string, Row[]>();
    const tableOf = (name: string): Row[] => {
        const existing = tables.get(name);
        if (existing) return existing;
        const created: Row[] = [];
        tables.set(name, created);
        return created;
    };
    const rows = tableOf('sys_metadata');
    let nextId = 0;
    const matches = (row: Row, where: Record<string, unknown>): boolean => {
        for (const [field, value] of Object.entries(where)) {
            if (value === undefined) continue;
            if ((row as unknown as Record<string, unknown>)[field] !== value) return false;
        }
        return true;
    };
    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            return tableOf(table).find((r) => matches(r, opts.where)) ?? null;
        },
        async find(table: string, opts: { where?: Record<string, unknown>; limit?: number }) {
            // The caller's bound is applied AFTER the filter and BY PRESENCE —
            // a double that silently ignores `limit` answers with more rows
            // than the caller asked for and reads as a passing query
            // (`check:objectql-double-limit`).
            const hits = tableOf(table).filter((r) => matches(r, opts?.where ?? {}));
            return typeof opts?.limit === 'number' ? hits.slice(0, opts.limit) : hits;
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            // The DECLARED column default the real store applies —
            // `sys-metadata.object.ts`: `state: Field.select(…, { defaultValue:
            // 'active' })`. Without it this harness answers "no active rows" to
            // every store read and reports the repair as ineffective for a
            // reason that exists nowhere but here.
            const row = { id: `r_${nextId}`, state: 'active', ...(data as any) } as Row;
            if (row.state === undefined) row.state = 'active';
            tableOf(table).push(row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const rowsOfTable = tableOf(table);
            const idx = rowsOfTable.findIndex((r) => matches(r, opts.where));
            if (idx < 0) return { id: null };
            rowsOfTable[idx] = { ...rowsOfTable[idx], ...(data as any) };
            return { id: rowsOfTable[idx].id };
        },
        async delete(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const rowsOfTable = tableOf(table);
            const idx = rowsOfTable.findIndex((r) => matches(r, opts.where));
            if (idx < 0) return { deleted: 0 };
            rowsOfTable.splice(idx, 1);
            return { deleted: 1 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            getItem: () => undefined,
            isPackageDisabled: () => false,
            // A BOOT-time universe: the code packages, and nothing a runtime
            // author writes. That is not a simplification of the harness — it
            // is the product behaviour this card is about, and the assertions
            // below prove it still holds while they run.
            // [#16224] The registry's copy of an object is its RESOLVED
            // schema (ADR-0029 D9.2) — the owner's base layer with its
            // `extend` contributors already folded on. Modelled rather than
            // flattened, because the whole of #16223's additivity argument
            // turns on the two being different bodies.
            // Shape-preserving on purpose: a code package declares `fields`
            // as an array and `ObjectSchema` accepts the keyed record an
            // author writes, and the real `foldObjectExtendersOnto` folds onto
            // whichever it is handed.
            foldObjectExtendersOnto: (name: string, body: any) => {
                if (name !== 'orders' || !body || typeof body !== 'object') return body;
                if (Array.isArray(body.fields)) {
                    return { ...body, fields: [...body.fields, ...ORDERS_EXTENDED_FIELDS] };
                }
                const keyed = Object.fromEntries(
                    ORDERS_EXTENDED_FIELDS.map((f) => [f.name, { type: f.type }]),
                );
                return { ...body, fields: { ...(body.fields ?? {}), ...keyed } };
            },
            listItems: (type: string) => {
                if (type === 'object') {
                    return [{
                        name: 'orders',
                        fields: [...ORDERS_BASE_FIELDS, ...ORDERS_EXTENDED_FIELDS],
                    }];
                }
                if (type === 'dataset') return CODE_DATASET_NAMES.map((n) => datasetBody(n));
                return [];
            },
        },
    };
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test');
    return { engine, rows, protocol };
}

const issuesOf = (err: unknown, rule: string) =>
    ((err as { issues?: { rule: string }[] } | null)?.issues ?? []).filter((i) => i.rule === rule);

describe('#15950 — the authoring gate resolves against runtime-authored metadata', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { warn.mockRestore(); });

    it('publishes a board bound to a dataset saved moments earlier, in the same process', async () => {
        const { engine, protocol } = makeHarness();

        // ── The card's step 1 ────────────────────────────────────────────────
        const saved = await protocol.saveMetaItem({
            type: 'dataset', name: 'p2008_users', item: datasetBody('p2008_users'),
            packageId: 'com.pin2008.smoke',
        });
        expect(saved.success).toBe(true);
        expect(saved.state).toBe('active');

        // ── The disagreement, asserted so this test cannot go quietly vacuous ─
        //
        // These two are the reason the test discriminates. If the registry ever
        // starts carrying runtime-authored datasets (a write-through change),
        // the first assertion fails and says so — at which point this test is
        // passing for a NEW reason and must be re-derived, not deleted. A green
        // run with a registry that already held `p2008_users` would prove
        // nothing about the store leg at all.
        const registered = [...engine.registry.listItems('dataset')].map((d: any) => d.name);
        expect(
            registered,
            'the firing control: the code-package datasets must be in this same read, '
            + 'or the assertion below is measuring a dead stub rather than an absence',
        ).toEqual([...CODE_DATASET_NAMES]);
        expect(
            registered,
            'the SchemaRegistry is a boot-time universe for every type but `object` — '
            + 'if this changes, re-derive this test rather than trusting its green',
        ).not.toContain('p2008_users');

        const listed = await protocol.getMetaItems({ type: 'dataset' });
        expect(
            (listed.items as { name: string }[]).map((d) => d.name),
            'the read API behind `GET /meta/dataset` answers from registry AND store',
        ).toContain('p2008_users');

        // ── The card's step 3, which used to be a 422 with three phantoms ────
        const result = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p2008_dash', item: threeWidgetBoard('p2008_users'),
            packageId: 'com.pin2008.smoke',
        });
        expect(
            result.success,
            'three phantom `widget-dataset-unknown` here is the whole card: the dataset is '
            + 'readable through the metadata API at this instant and the gate called it nonexistent',
        ).toBe(true);
        expect(result.advisories ?? [], 'and not demoted to an advisory either').toEqual([]);
    });

    it('still refuses a board bound to a dataset that exists in NEITHER home', async () => {
        // The negative control. Widening a resolution universe must not be a
        // way of switching the rule off — #7529's refusal is intact, with its
        // key path named, and nothing lands.
        const { protocol, rows } = makeHarness();

        const err = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p2008_dash', item: threeWidgetBoard('no_such_dataset_xyz'),
        }).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(Error);
        expect((err as any).status).toBe(422);
        expect((err as any).code).toBe('INVALID_METADATA');
        const found = issuesOf(err, WIDGET_DATASET_UNKNOWN);
        expect(found.length).toBe(3);
        expect((found[0] as any).path).toBe('dashboards[0].widgets[0]');
        expect((found[0] as any).message).toMatch(/no_such_dataset_xyz/);
        expect(rows.filter((r) => r.type === 'dashboard')).toEqual([]);
    });

    it('does not let a DRAFT dataset satisfy a published board', async () => {
        // The scope of the store leg, pinned: `state: 'active'` only. #7529's
        // ruling is refuse-at-publish precisely so an author can write the
        // widget first and the dataset second; a draft dataset that resolved
        // would publish a board that cannot render, which is the ruling
        // inverted rather than implemented.
        const { protocol } = makeHarness();
        const draft = await protocol.saveMetaItem({
            type: 'dataset', name: 'p2008_users', item: datasetBody('p2008_users'), mode: 'draft',
        });
        expect(draft.success).toBe(true);

        const err = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p2008_dash', item: threeWidgetBoard('p2008_users'),
        }).catch((e: unknown) => e);

        expect((err as any)?.status).toBe(422);
        expect(issuesOf(err, WIDGET_DATASET_UNKNOWN).length).toBe(3);

        // …and the same board publishes once the dataset itself is published.
        await protocol.saveMetaItem({ type: 'dataset', name: 'p2008_users' , item: datasetBody('p2008_users') });
        const result = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p2008_dash', item: threeWidgetBoard('p2008_users'),
        });
        expect(result.success).toBe(true);
    });

    it('folds the store into EVERY context collection, not just `datasets`', async () => {
        // The gather is one helper serving five collections, so the repair is
        // one helper too. `pages` is the arm triage asked for a reading on:
        // same shape, lower severity — `validateViewPageRefs` reports at
        // `warning`, so the phantom rode in `advisories` instead of 422-ing the
        // write. Measured both ways here.
        const { protocol } = makeHarness();

        const unknownMount = await protocol.saveMetaItem({
            type: 'view', name: 'orders.dashboard', item: pageMountView('never_authored_page'),
        });
        expect(
            (unknownMount.advisories ?? []).map((a: any) => a.rule),
            'the control: an unresolvable page mount is still reported',
        ).toContain(VIEW_PAGE_UNRESOLVED);

        await protocol.saveMetaItem({
            type: 'page', name: 'sales_dashboard', item: { name: 'sales_dashboard', label: 'Sales' },
        });
        const authoredMount = await protocol.saveMetaItem({
            type: 'view', name: 'orders.dashboard', item: pageMountView('sales_dashboard'),
        });
        expect(authoredMount.success).toBe(true);
        expect(
            (authoredMount.advisories ?? []).map((a: any) => a.rule),
            'a page saved through `PUT /meta/page` is a live page',
        ).not.toContain(VIEW_PAGE_UNRESOLVED);
    });
});

/**
 * #16224 — the residual #16223 wrote down: where an overlay REDEFINES an item a
 * code package already declares, the gate judged that item's CONTENT from the
 * registry copy.
 *
 * ## Reproduced end to end before anything was changed
 *
 * Driving the real write path over the same harness, in one process:
 *
 *   1. `registry.listItems('dataset')` carries the code package's
 *      `sys_user_metrics`, whose only measure is `order_count`.
 *   2. `saveMetaItem({ type: 'dataset', name: 'sys_user_metrics' })` writes an
 *      env-wide overlay that REDEFINES it: the measure is now `row_count`, and
 *      `order_count` is gone. `success: true`, one row in `sys_metadata`.
 *   3. `getMetaItems({ type: 'dataset' })` — the read API behind
 *      `GET /meta/dataset`, and the body the runtime serves — answers with the
 *      OVERLAY: measures `['row_count']`.
 *   4. `saveMetaItem({ type: 'dashboard' })`, one widget bound to
 *      `values: ['order_count']` → **`success: true`**. The measure exists in
 *      neither the overlay nor anything the runtime will serve, and the gate
 *      accepted the board.
 *   5. The same board bound to `values: ['row_count']` — the measure the
 *      overlay DOES declare → **422, `widget-measure-unknown`**.
 *
 * Steps 4 and 5 are the residual in two lines, and they are the SAME instant:
 * the gate accepted a binding to a measure that does not exist and refused a
 * binding to the one that does, because both were judged against a body the
 * runtime had already stopped serving. That is #15950's phantom in both
 * directions at once — an acceptance that should have been a refusal, and a
 * refusal that should have been an acceptance.
 *
 * ## The repair, and why it is not a reversal of #16223
 *
 * #16223's fold contributed store-only NAMES and never displaced a registry
 * entry, because a `sys_metadata` row is an object's BASE layer while the
 * registry copy is its RESOLVED schema (ADR-0029 D9.2). That argument does not
 * say "never let an overlay win" — it says "never let an UNRESOLVED body win",
 * and it names the remedy in the same breath: {@link getMetaItems} lets its
 * overlay win and runs `foldObjectExtendersFromRegistry` on the winner.
 *
 * So the gate now performs the read API's own merge — `mergePackageAwareOverlay`
 * with that same transform — and the resolved-vs-base distinction is kept by
 * folding, not by declining. The last two tests below are that distinction's
 * pins: an `object` overlay wins on its own fields AND keeps the registry's
 * `extend` contributors, which is exactly the "field reference that resolves
 * today reading as dangling" #16223 refused to trade for.
 */
describe('#16224 — an overlay that REDEFINES a code-package item is judged from the overlay', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { warn.mockRestore(); });

    /** The code-package dataset this tenant redefines. */
    const OVERRIDDEN = 'sys_user_metrics';

    /**
     * The overlay: same name, same object, same dimensions — one measure
     * REMOVED and one added. `dataset` is `allowOrgOverride: false`
     * (`DEFAULT_METADATA_TYPE_REGISTRY`), so the reachable redefinition is the
     * env-wide one, which is the other limb the card names.
     */
    const overlayBody = () => ({
        ...datasetBody(OVERRIDDEN),
        measures: [{ name: 'row_count', aggregate: 'count' }],
    });

    /** One metric widget, so the count of findings IS the count of bindings. */
    const oneWidgetBoard = (dataset: string, value: string) => ({
        name: 'p16224_dash',
        label: 'Overlay smoke dashboard',
        widgets: [{ id: 'kpi', type: 'metric', title: 'Total', dataset, values: [value] }],
    });

    it('refuses a widget bound to a measure the overlay REMOVED', async () => {
        const { protocol, engine, rows } = makeHarness();

        // ── The firing control ───────────────────────────────────────────────
        //
        // The code package's own body must be in this same read and must carry
        // `order_count`, or the refusal below is measuring a dataset that was
        // never there rather than a redefinition.
        const declared = [...engine.registry.listItems('dataset')]
            .find((d: any) => d.name === OVERRIDDEN);
        expect(declared, 'the code package must declare the name being redefined').toBeDefined();
        expect(
            (declared as any).measures.map((m: any) => m.name),
            'the firing control: the registry copy still carries the measure the overlay removes',
        ).toEqual(['order_count']);

        // ── The redefinition ─────────────────────────────────────────────────
        const saved = await protocol.saveMetaItem({
            type: 'dataset', name: OVERRIDDEN, item: overlayBody(),
        });
        expect(saved.success).toBe(true);
        expect(saved.state).toBe('active');
        expect(rows.filter((r) => r.type === 'dataset' && r.name === OVERRIDDEN).length).toBe(1);

        // ── What the runtime will actually serve ─────────────────────────────
        const listed = await protocol.getMetaItems({ type: 'dataset' });
        const served = (listed.items as any[]).filter((d) => d.name === OVERRIDDEN);
        expect(served.length, 'the two homes must not both answer for one name').toBe(1);
        expect(
            served[0].measures.map((m: any) => m.name),
            'the read API behind `GET /meta/dataset` answers with the overlay',
        ).toEqual(['row_count']);

        // ── The residual ─────────────────────────────────────────────────────
        const err = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p16224_dash', item: oneWidgetBoard(OVERRIDDEN, 'order_count'),
        }).catch((e: unknown) => e);

        expect(
            err,
            'the gate accepted a binding to a measure the runtime will not serve, because it '
            + 'judged the dataset from the registry copy the overlay had already replaced',
        ).toBeInstanceOf(Error);
        expect((err as any).status).toBe(422);
        expect((err as any).code).toBe('INVALID_METADATA');
        const found = issuesOf(err, WIDGET_MEASURE_UNKNOWN);
        expect(found.length).toBe(1);
        expect((found[0] as any).message).toMatch(/order_count/);
        expect(rows.filter((r) => r.type === 'dashboard')).toEqual([]);
    });

    it('accepts a widget bound to a measure only the overlay declares', async () => {
        // The same instant, the other direction: judging from the registry copy
        // ALSO refused the measure that does exist. A repair that only stopped
        // the false acceptance would leave this one refused.
        const { protocol } = makeHarness();

        await protocol.saveMetaItem({ type: 'dataset', name: OVERRIDDEN, item: overlayBody() });

        const result = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p16224_dash', item: oneWidgetBoard(OVERRIDDEN, 'row_count'),
        });
        expect(
            result.success,
            '`row_count` is the measure the runtime serves for this dataset at this instant',
        ).toBe(true);
        expect(
            (result.advisories ?? []).map((a: any) => a.rule),
            'and not demoted to an advisory either',
        ).not.toContain(WIDGET_MEASURE_UNKNOWN);
    });

    it('still refuses a measure that exists in NEITHER the overlay nor the registry', async () => {
        // The negative control. Letting the overlay win must not be a way of
        // switching the rule off.
        const { protocol, rows } = makeHarness();

        await protocol.saveMetaItem({ type: 'dataset', name: OVERRIDDEN, item: overlayBody() });

        const err = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p16224_dash', item: oneWidgetBoard(OVERRIDDEN, 'no_such_measure_xyz'),
        }).catch((e: unknown) => e);

        expect((err as any)?.status).toBe(422);
        expect((err as any)?.code).toBe('INVALID_METADATA');
        expect(issuesOf(err, WIDGET_MEASURE_UNKNOWN).length).toBe(1);
        expect(rows.filter((r) => r.type === 'dashboard')).toEqual([]);
    });

    it('leaves #16223 intact: a store-only NAME is still contributed additively', async () => {
        // The control that must not move. #16223's arm is a name the registry
        // does not carry; this card only changes what happens at a name it
        // DOES. Asserted in the same process as the redefinition above so the
        // two arms of one merge are measured together.
        const { protocol, engine } = makeHarness();

        await protocol.saveMetaItem({ type: 'dataset', name: OVERRIDDEN, item: overlayBody() });
        await protocol.saveMetaItem({
            type: 'dataset', name: 'p2008_users', item: datasetBody('p2008_users'),
        });

        expect(
            [...engine.registry.listItems('dataset')].map((d: any) => d.name),
            'the registry is still the boot-time universe — neither row reached it',
        ).toEqual([...CODE_DATASET_NAMES]);

        // The store-only name resolves, with its own measure…
        const additive = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p2008_dash', item: oneWidgetBoard('p2008_users', 'order_count'),
        });
        expect(additive.success, '#16223: a store-only name is contributed to the universe').toBe(true);

        // …and the redefined name is judged from the overlay in the same gather.
        const err = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p16224_dash', item: oneWidgetBoard(OVERRIDDEN, 'order_count'),
        }).catch((e: unknown) => e);
        expect((err as any)?.status).toBe(422);
        expect(issuesOf(err, WIDGET_MEASURE_UNKNOWN).length).toBe(1);
    });

    it('keeps the RESOLVED-vs-BASE distinction: an object overlay wins WITH its registry extenders folded on', async () => {
        // #16223's argument, pinned rather than repeated. The registry's copy of
        // `orders` is the resolved schema — the code package's base layer plus
        // the `extend` contributor's `priority` — while the `sys_metadata` row
        // an author writes is the base layer alone. Letting the raw row displace
        // the resolved body would make `priority` read as dangling, which is the
        // subtler phantom #16223 declined to trade for.
        //
        // Both halves are asserted here: the overlay's own new field resolves
        // (the overlay won) AND the extender's field still resolves (the fold
        // ran on the winner, the way `getMetaItems` runs it).
        const { protocol } = makeHarness();

        // The base layer as an author writes it: the code package's own columns
        // plus one of the tenant's, and NO `priority` — that field exists only
        // as an `extend` contributor in the registry.
        await protocol.saveMetaItem({
            type: 'object', name: 'orders', item: {
                name: 'orders',
                label: 'Orders',
                // An authored OWD is REQUIRED at the runtime object door
                // (`security-owd-unset`) — absence is not a decision.
                sharingModel: 'private',
                fields: {
                    ...Object.fromEntries(ORDERS_BASE_FIELDS.map((f) => [f.name, { type: f.type }])),
                    channel: { type: 'text' },
                },
            },
        });

        const onOverlayField = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p16224_obj', item: filterBoard('p16224_obj', 'channel'),
        });
        expect(
            (onOverlayField.advisories ?? []).map((a: any) => a.rule),
            'the overlay won: a column only the overlay declares resolves',
        ).not.toContain(DASHBOARD_FILTER_FIELD_UNKNOWN);
        expect(onOverlayField.success).toBe(true);

        const onExtenderField = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p16224_ext', item: filterBoard('p16224_ext', 'priority'),
        });
        expect(
            (onExtenderField.advisories ?? []).map((a: any) => a.rule),
            'and the fold ran on the winner: the registry `extend` contributor survives '
            + '(ADR-0029 D9.2 — this is the phantom #16223 refused to trade for)',
        ).not.toContain(DASHBOARD_FILTER_FIELD_UNKNOWN);
        expect(onExtenderField.success).toBe(true);

        // The firing control: a column on NEITHER layer is still reported, so
        // the two readings above are not a rule that stopped running.
        const err = await protocol.saveMetaItem({
            type: 'dashboard', name: 'p16224_bad', item: filterBoard('p16224_bad', 'no_such_column_xyz'),
        }).catch((e: unknown) => e);
        const reported = (err instanceof Error)
            ? issuesOf(err, DASHBOARD_FILTER_FIELD_UNKNOWN).length
            : ((err as any).advisories ?? []).filter((a: any) => a.rule === DASHBOARD_FILTER_FIELD_UNKNOWN).length;
        expect(reported, 'the firing control for both readings above').toBeGreaterThan(0);
    });
});
