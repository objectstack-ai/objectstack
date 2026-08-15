// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7529 — a dashboard widget dataset binding that names nothing, refused at
 * PUBLISH, end to end through `saveMetaItem` / `publishMetaItem`.
 *
 * ## What is being pinned
 *
 * The card's measured symptom: a widget bound to a dataset that exists nowhere
 * answered `200` on both save and publish, with referential integrity enforced
 * only at runtime (a visible error on the live board). Root cause, measured
 * rather than inherited: `validateWidgetBindings` provably catches this body
 * and was never invoked, because `dashboard` was not a runtime-gated type.
 *
 * The maintainer's 2026-08-12 ruling (option B): allow at save, refuse at
 * publish — a DRAFT may hold a forward reference to a dataset not yet
 * authored; publishing asserts the board works, with the offending key path
 * named, never a 200. Both halves are pinned below, because the ruling is a
 * boundary in each direction: refusing the draft would destroy the "widget
 * first, dataset second" authoring flow the decision deliberately preserved.
 *
 * ## The thread-through is load-bearing (why the legit-board test matters)
 *
 * The gate resolves bindings against the LIVE dataset universe —
 * `listCollection('dataset', 'datasets')` in `assertRuntimeAuthoringRules`,
 * carried as `RuntimeStackContext.datasets`. Without that thread-through a
 * per-write snapshot holds no datasets at all and every widget on a fully
 * legitimate board reads as dangling (3 phantom `widget-dataset-unknown`
 * errors measured on a 3-widget board). The "publishes a legitimate board"
 * test below is therefore the DISCRIMINATING one: it fails with phantom
 * refusals if the datasets ever stop reaching the gate, which is exactly the
 * wired-and-running-on-nothing state (#4449) that cannot be caught by
 * asserting refusals alone.
 *
 * Harness: the real repository write path over a stub engine — the same shape
 * as `protocol.runtime-authoring-gate.test.ts`, because a gate INSIDE
 * `saveMetaItem` cannot be tested against a harness that mocks `saveMetaItem`.
 * Assertions on the throwing surface follow the ADR-0112 envelope discipline:
 * `code` AND `status` together, never a bare `rejects.toThrow()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The producer's OWN write-verb dispatch decisions (#4550 delete / #5480
// update), so the fake engine below cannot accept a call ObjectQL refuses.
// Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright (#5619).
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — every one of them Zod-valid, so the refusal under test is the one
// being measured and not a schema failure wearing its clothes. (`saveMetaItem`
// runs `DashboardSchema.safeParse` BEFORE this gate; `dataset` is a required
// widget key, so an invalid fixture would 422 with `failed spec validation`
// and the test would pass for the wrong reason.)
// ─────────────────────────────────────────────────────────────────────────────

/** The card's body: a widget whose dataset binding names nothing. */
const danglingBoard = () => ({
    name: 'ops_board',
    label: 'Ops Board',
    widgets: [
        {
            id: 'kpi_orders',
            type: 'metric',
            title: 'Orders',
            dataset: 'no_such_dataset_xyz',
            values: ['order_count'],
        },
    ],
});

/** A fully legitimate 3-widget board bound to the registry's real dataset. */
const legitBoard = () => ({
    name: 'ops_board',
    label: 'Ops Board',
    widgets: [
        { id: 'kpi_orders', type: 'metric', title: 'Orders', dataset: 'orders_ds', values: ['order_count'] },
        {
            id: 'by_status',
            type: 'bar',
            title: 'By Status',
            dataset: 'orders_ds',
            dimensions: ['status'],
            values: ['order_count'],
            chartConfig: { type: 'bar', xAxis: { field: 'status' }, yAxis: [{ field: 'order_count' }] },
        },
        {
            id: 'by_region',
            type: 'donut',
            title: 'By Region',
            dataset: 'orders_ds',
            dimensions: ['region'],
            values: ['order_count'],
            chartConfig: { type: 'donut', series: [{ name: 'order_count' }] },
        },
    ],
});

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
}

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;

function makeStubEngine() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) {
            if (w.type !== undefined && r.type !== w.type) continue;
            if (w.name !== undefined && r.name !== w.name) continue;
            if (w.organization_id !== undefined && r.organization_id !== w.organization_id) continue;
            if (w.state !== undefined && r.state !== w.state) continue;
            return { key: k, row: r };
        }
        return null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t === 'sys_metadata_audit') return { id: 'audit_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            rows.set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            // The live resolution universe — objects AND datasets, the
            // collection this card threads through to the gate. The dataset is
            // exactly what the legit board binds; the dangling board names
            // something that is not here, which is the whole defect.
            listItems: (type: string) => {
                if (type === 'object') {
                    return [{
                        name: 'orders',
                        fields: [
                            { name: 'amount', type: 'number' },
                            { name: 'status', type: 'text' },
                            { name: 'region', type: 'text' },
                        ],
                    }];
                }
                if (type === 'dataset') {
                    return [{
                        name: 'orders_ds',
                        object: 'orders',
                        dimensions: [
                            { name: 'status', field: 'status' },
                            { name: 'region', field: 'region' },
                        ],
                        measures: [{ name: 'order_count', aggregate: 'count' }],
                    }];
                }
                return [];
            },
            getItem: () => undefined,
        },
    };
    return { engine, rows };
}

/** A protocol on the ordinary tenant posture (environment id, default channel). */
function makeProtocol() {
    const { engine, rows } = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test');
    return { protocol: protocol as any, rows };
}

const dashboardRows = (rows: Map<string, Row>) =>
    Array.from(rows.values()).filter((r) => r.type === 'dashboard');

const save = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
    protocol.saveMetaItem({ type: 'dashboard', name: 'ops_board', item, ...extra });

describe('dashboard dataset bindings at the publish door (#7529)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    // ── The refusal: never 200 on a publish of a board that cannot render ──

    it('REFUSES an ACTIVE save of the dangling board with a located 422', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await save(protocol, danglingBoard()).catch((e: any) => e);

        // The ADR-0112 envelope — code AND status, never a bare throw: the
        // unfixed door does not throw at all, so a throw-only assertion would
        // report "the promise resolved" and never "the envelope is missing".
        expect(err).toBeInstanceOf(Error);
        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');

        // The ruling's own words: refuse "with the offending key path named".
        const issue = err.issues.find((i: any) => i.rule === 'widget-dataset-unknown');
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe('dashboards[0].widgets[0]');
        expect(issue.message).toMatch(/no_such_dataset_xyz/);
        expect(issue.hint.length).toBeGreaterThan(10);

        // Which rules produced the verdict — "clean" and "nothing ran" stay
        // distinguishable from the outside.
        expect(err.rulesRun).toContain('validateWidgetBindings');

        // And nothing landed. The card's symptom was a 200 that persisted.
        expect(dashboardRows(rows)).toEqual([]);
    });

    // ── Option B's other half: a draft may hold a forward reference ──

    it('lets the identical body through as a DRAFT — the forward-reference workflow', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await save(protocol, danglingBoard(), { mode: 'draft' });

        expect(
            result.success,
            `the 2026-08-12 ruling chose refuse-at-publish PRECISELY so an author can build the ` +
                `widget first and the dataset second — a draft makes no claim to work (#4463 D1).`,
        ).toBe(true);
        const states = dashboardRows(rows).map((r) => r.state);
        expect(states).toContain('draft');
        expect(states, 'a draft save must not mint an active row').not.toContain('active');
    });

    it('gates the draft→active PROMOTION, so the draft door is not a bypass', async () => {
        const { protocol } = makeProtocol();
        await save(protocol, danglingBoard(), { mode: 'draft' });

        const err = await protocol
            .publishMetaItem({ type: 'dashboard', name: 'ops_board' })
            .catch((e: any) => e);

        expect(
            err?.status,
            `publish IS the verb the ruling gates — Studio saves ?mode=draft and POSTs /publish on ` +
                `every edit, so an ungated promotion would be the card's 200-on-publish unchanged.`,
        ).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.issues.map((i: any) => i.rule)).toContain('widget-dataset-unknown');
    });

    // ── The thread-through is live: a legitimate board still publishes ──

    it('publishes a fully legitimate 3-widget board — the datasets really reach the gate', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await save(protocol, legitBoard());

        expect(
            result.success,
            `a refusal here means the dataset universe did not reach the gate ` +
                `(listCollection('dataset','datasets') → RuntimeStackContext.datasets) and every ` +
                `binding read as dangling — the 3-phantom state that would 422 every legitimate ` +
                `dashboard publish in the product: ${JSON.stringify(result)}`,
        ).toBe(true);
        expect(dashboardRows(rows).length).toBe(1);
    });

    it('publishes a clean draft of the same legitimate board', async () => {
        const { protocol } = makeProtocol();
        await save(protocol, legitBoard(), { mode: 'draft' });
        const result = await protocol.publishMetaItem({ type: 'dashboard', name: 'ops_board' });
        expect(result.success).toBe(true);
    });

    // ── The workflow the ruling preserved, end to end ──

    it('draft with a forward reference → dataset appears → publish succeeds', async () => {
        // The authoring flow option B exists for, in one test: the draft holds
        // a reference that resolves to nothing YET; once the registry knows the
        // dataset, publishing the same draft succeeds without edits.
        const { engine, rows } = makeStubEngine();
        const datasets: unknown[] = [];
        const realListItems = engine.registry.listItems;
        engine.registry.listItems = (type: string) =>
            type === 'dataset' ? datasets : realListItems(type);
        const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test');

        await protocol.saveMetaItem({
            type: 'dashboard', name: 'ops_board', item: legitBoard(), mode: 'draft',
        });

        // Publishing while the dataset does not exist anywhere: refused.
        const err = await protocol
            .publishMetaItem({ type: 'dashboard', name: 'ops_board' })
            .catch((e: any) => e);
        expect(err?.status).toBe(422);
        expect(err.issues.map((i: any) => i.rule)).toContain('widget-dataset-unknown');

        // The dataset gets authored; the same draft now publishes untouched.
        // (Only `success` is asserted — the stub engine defaults an absent
        // `state` to active in its row key, so the state FIELD is not a
        // faithful readback surface here; the refusal-then-success flip is the
        // behaviour under test.)
        datasets.push(...realListItems('dataset'));
        const result = await protocol.publishMetaItem({ type: 'dashboard', name: 'ops_board' });
        expect(result.success).toBe(true);
        expect(dashboardRows(rows).length).toBeGreaterThan(0);
    });
});
