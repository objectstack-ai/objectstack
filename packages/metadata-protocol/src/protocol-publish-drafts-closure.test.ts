// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10377 — the BATCH publish door judges a package against its OWN closure:
 * the same batch's pending drafts are part of the resolution universe.
 *
 * ## The defect, measured on a cloud rig 2026-08-21
 *
 * An AI-built package `app.shyx` drafted `dataset/shyx_customer_ds` and
 * `dashboard/customer_dashboard` (a widget bound to that dataset) together.
 * Every `publishPackageDrafts` attempt rolled back:
 *
 * ```
 * batch publish of 'app.shyx' rolled back at dashboard/customer_dashboard:
 * [invalid_metadata] … dashboards[0].widgets[0]:
 * [widget-dataset-unknown] dataset "shyx_customer_ds" does not resolve …
 * ```
 *
 * Root cause, verified at source before this file was written:
 * `assertRuntimeAuthoringRules` builds every context collection with
 * `listCollection(…)`, which reads `engine.registry` — the LIVE universe. A
 * draft is deliberately NOT in that registry (`saveMetaItem` write-through
 * runs on `mode: 'publish'` only), and the batch door's own promotions do not
 * put it there either: `applyRegistryWriteThrough` runs in Phase 2, AFTER the
 * Phase-1 transaction that gates and promotes every draft. So NO same-batch
 * draft is ever visible to any sibling's gate pass — which is why the symptom
 * is order-independent, and why re-naming the dataset (which the build agent
 * tried twice) could never help.
 *
 * ## Why datasets is where it BLOCKS, and the other collections do not
 *
 * `validateWidgetBindings` raises `widget-dataset-unknown` at
 * `severity: 'error'`, and an error finding refuses the promotion — the batch
 * being all-or-nothing (ADR-0067 D2), that refusal aborts the whole package.
 * The `objects` and `permissions` gaps are the same defect at advisory
 * severity: they do not refuse, they manufacture findings that describe
 * nothing. Both are pinned below, because a closure that is uniform is the
 * property #9612/#10058 declared and a per-collection patch is what produced
 * this card.
 *
 * ## The discriminating tests are the ones that expect SILENCE
 *
 * A "still refuses a genuinely absent dataset" test alone would also pass with
 * the whole gate disabled. So each pair here is (clean batch publishes) +
 * (genuinely dangling still refuses), and the first half is the one that fails
 * on `origin/main`.
 *
 * Harness: the faithful multi-table stub engine used by
 * `protocol-publish-drafts-advisories.test.ts` (kept local — self-contained
 * harnesses are the established shape here, so two tripwires fail
 * independently). Nothing on the publish path is stubbed: the REAL
 * `saveMetaItem` / `publishPackageDrafts` run.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the fake engine below
// cannot accept a call ObjectQL refuses. From `@objectstack/metadata-core`,
// never from `@objectstack/objectql` — that import would close a cycle.
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

/** The LIVE object universe — the base object every fixture dataset reads. */
const liveCustomerObject = {
    name: 'shyx_customer',
    label: 'Customer',
    fields: {
        status: { type: 'text', label: 'Status' },
        amount: { type: 'number', label: 'Amount' },
    },
};

/** The LIVE permission universe — one set, granting only the live object. */
const liveReadonlySet = {
    name: 'shyx_readonly',
    label: 'Read Only',
    objects: { shyx_customer: { allowRead: true } },
};

function makeStubEngine(options?: { liveObjects?: unknown[]; livePermissions?: unknown[] }) {
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
            // The LIVE universe. Deliberately holds NO dataset and NO
            // permission set: everything the fixtures resolve against comes
            // from the batch's own pending drafts, which is the whole subject.
            listItems: (type: string) => {
                if (type === 'object') return options?.liveObjects ?? [liveCustomerObject];
                // ONE live permission set, granting something unrelated to the
                // fixtures below. It is what ACTIVATES
                // `security-master-detail-ungranted` (the rule is silent when a
                // stack declares no sets at all), so the batch's own grant is
                // measured against a rule that is running in both worlds rather
                // than against a rule that is off.
                if (type === 'permission') return options?.livePermissions ?? [liveReadonlySet];
                return [];
            },
            // No declared package namespace → the ADR-0028 prefix pre-flight is
            // skipped (legacy-grandfathered path), and `resolveWritePackageScope`
            // narrows nothing.
            getPackage: () => undefined,
        },
    };
    return { engine, rows, historyRows };
}

const PKG = 'app.shyx';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — every one Zod-valid, so the verdict under test is the gate's and
// not a schema failure wearing its clothes.
// ─────────────────────────────────────────────────────────────────────────────

const customerDataset = (name: string) => ({
    name,
    label: 'Customers',
    object: 'shyx_customer',
    dimensions: [{ name: 'status', field: 'status' }],
    measures: [{ name: 'customer_count', aggregate: 'count' }],
});

const boardBoundTo = (datasetName: string) => ({
    name: 'customer_dashboard',
    label: 'Customer Dashboard',
    widgets: [
        {
            id: 'kpi_customers',
            type: 'metric',
            title: 'Customers',
            dataset: datasetName,
            values: ['customer_count'],
        },
    ],
});

/** A Zod-valid autolaunched flow whose start node fires on `objectName`. */
const flowOn = (name: string, objectName: string) => ({
    name,
    label: name,
    description: `fires on ${objectName}`,
    version: 1,
    status: 'active',
    type: 'autolaunched',
    runAs: 'system',
    variables: [],
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'On update',
            config: { objectName, triggerType: 'record-after-update' },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end', type: 'default', isDefault: false }],
});

/**
 * A detail object whose master_detail child needs an object-level CRUD grant
 * — the `security-master-detail-ungranted` subject, which resolves against the
 * `permissions` collection.
 */
const detailObject = (name: string) => ({
    name,
    label: name,
    // `controlled_by_parent` is the authored OWD a master-detail child wants
    // (ADR-0090 D1 refuses an unset one at publish, `security-owd-unset`).
    sharingModel: 'controlled_by_parent',
    fields: {
        // `reference`, the sole spelling `FieldSchema` declares — the aliases do
        // not parse (strict schema, #5017) and `refOf` in the security rule
        // reads only this one.
        parent: { type: 'master_detail', label: 'Parent', reference: 'shyx_customer', required: true },
        note: { type: 'text', label: 'Note' },
    },
});

/** A permission set granting object-level CRUD on `objectName`. */
const permissionGranting = (name: string, objectName: string) => ({
    name,
    label: name,
    objects: {
        [objectName]: { allowRead: true, allowCreate: true, allowEdit: true },
    },
});

/** Stage one env-wide, package-bound draft (Studio's "Save Draft" shape). */
async function stageDraft(
    protocol: ObjectStackProtocolImplementation,
    type: string,
    item: { name: string },
): Promise<void> {
    await (protocol as any).saveMetaItem({
        type, name: item.name, item, packageId: PKG, mode: 'draft',
    });
}

const rulesOf = (res: any, name: string): string[] =>
    (res.published.find((p: any) => p.name === name)?.advisories ?? []).map((a: any) => a.rule);

describe('publishPackageDrafts judges each draft against the BATCH closure (#10377)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    // ── datasets: the card's own defect, and the only one that REFUSES ──

    it('publishes a dashboard together with the dataset it binds — dataset drafted FIRST', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, 'dataset', customerDataset('shyx_customer_ds'));
        await stageDraft(protocol, 'dashboard', boardBoundTo('shyx_customer_ds'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(
            res.failed,
            `the dataset is IN THIS BATCH. A [widget-dataset-unknown] rollback here means the gate's `
            + `datasets context still carries only ALREADY-LIVE declarations, so a package shipping a `
            + `dashboard together with its dataset can never publish — the #10377 symptom verbatim.`,
        ).toEqual([]);
        expect(res).toMatchObject({ success: true, publishedCount: 2, failedCount: 0 });
    });

    it('publishes the same pair with the dashboard drafted FIRST — order-independent', async () => {
        // The registry write-through that would make a promoted sibling visible
        // runs in Phase 2, AFTER the whole Phase-1 gate+promote transaction. So
        // intra-batch order can never be the fix, and this pins that the closure
        // — not luck of iteration order — is what resolves the binding.
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, 'dashboard', boardBoundTo('shyx_customer_ds'));
        await stageDraft(protocol, 'dataset', customerDataset('shyx_customer_ds'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.failed).toEqual([]);
        expect(res).toMatchObject({ success: true, publishedCount: 2, failedCount: 0 });
    });

    it('STILL rolls back a dashboard bound to a genuinely absent dataset', async () => {
        // ⭐ The boundary in the other direction: the closure is the package's
        // own drafts plus the live universe, NOT "anything goes". A name that is
        // in neither place is still the #7529 refusal, with its located path.
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, 'dataset', customerDataset('shyx_customer_ds'));
        await stageDraft(protocol, 'dashboard', boardBoundTo('no_such_dataset_xyz'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ success: false, publishedCount: 0 });
        expect(res.published).toEqual([]);
        const causal = res.failed.find((f) => f.name === 'customer_dashboard')!;
        expect(causal.code).toBe('INVALID_METADATA');
        expect(causal.error).toMatch(/widget-dataset-unknown/);
        expect(causal.error).toMatch(/no_such_dataset_xyz/);
        // ADR-0067 D2 — all-or-nothing: the healthy sibling is aborted, not
        // published around the refusal.
        expect(res.failed.find((f) => f.name === 'shyx_customer_ds')?.code).toBe('BATCH_ABORTED');
    });

    it('refuses a lone dashboard whose dataset is nowhere — no batch, same verdict', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, 'dashboard', boardBoundTo('shyx_customer_ds'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ success: false, publishedCount: 0 });
        expect(res.failed[0]!.code).toBe('INVALID_METADATA');
        expect(res.failed[0]!.error).toMatch(/widget-dataset-unknown/);
    });

    // ── The repository-shape guard: a minimal double must still publish ──

    it('publishes through a repo double declaring only `listDrafts` — the closure degrades, it never throws', async () => {
        // ⭐ The patch-round regression. Collecting the batch's pending
        // declarations introduced the batch door's FIRST dependency on
        // `repo.get`; `getOverlayRepo` is the seam every publish double
        // replaces, and nine cases in `@objectstack/objectql` drive a double
        // that declares `listDrafts` alone. Unguarded, this door answered
        // `TypeError: repo.get is not a function` BEFORE any promotion — a
        // shape it used to accept, now fatal.
        const { engine } = makeStubEngine();
        const protocol: any = new ObjectStackProtocolImplementation(engine);
        protocol.ensureOverlayIndex = async () => {};
        protocol.getOverlayRepo = () => ({
            listDrafts: async () => [
                { type: 'dataset', name: 'shyx_customer_ds', organizationId: null, packageId: PKG },
            ],
        });
        protocol.runPublishSideEffects = async () => ({});
        vi.spyOn(protocol, 'promoteDraftForPublish').mockImplementation(async (req: any) => ({
            singularType: req.type,
            orgId: null,
            advisories: [],
            result: { version: 'h', seq: 1, item: { body: { name: req.name } }, packageId: null },
        }));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(res.failed).toEqual([]);

        // ⛔ And the degrade SAYS WHY. A gate that quietly stops seeing part of
        // its input reads as "clean" from every surface downstream, so the
        // missing member and the consequence are both named — a bare silent
        // fallback would be the defect this assertion exists to forbid.
        const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
        expect(said).toContain("declares no 'get'");
        expect(said).toMatch(/LIVE declarations only/);
    });

    // ── objects: the same gap at advisory severity ──

    it('a flow bound to a same-batch OBJECT draft raises no phantom trigger advisory', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, 'object', detailObject('shyx_ticket'));
        await stageDraft(protocol, 'flow', flowOn('shyx_on_ticket', 'shyx_ticket'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.failed).toEqual([]);
        expect(
            rulesOf(res, 'shyx_on_ticket'),
            `'shyx_ticket' is drafted in THIS batch, so the flow's trigger object resolves. A `
            + `[flow-trigger-unknown-object] here is the datasets defect at advisory severity: it does `
            + `not refuse, it describes nothing.`,
        ).not.toContain('flow-trigger-unknown-object');
    });

    it('STILL reports a flow bound to an object that is in neither the batch nor the registry', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, 'object', detailObject('shyx_ticket'));
        await stageDraft(protocol, 'flow', flowOn('shyx_on_ghost', 'shyx_ghost'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.failed).toEqual([]);
        expect(rulesOf(res, 'shyx_on_ghost')).toContain('flow-trigger-unknown-object');
    });

    // ── permissions: same gap, reached through an object publish ──

    it('an object granted by a same-batch PERMISSION draft raises no phantom ungranted advisory', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, 'object', detailObject('shyx_ticket'));
        await stageDraft(protocol, 'permission', permissionGranting('shyx_agent', 'shyx_ticket'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.failed).toEqual([]);
        expect(
            rulesOf(res, 'shyx_ticket'),
            `the grant is IN THIS BATCH. A [security-master-detail-ungranted] here is the `
            + `permissions half of the same closure gap — the per-write phantom class PR #7886 `
            + `already paid for on the live collection.`,
        ).not.toContain('security-master-detail-ungranted');
    });

    it('STILL reports a master-detail object no permission set in the batch grants', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageDraft(protocol, 'object', detailObject('shyx_ticket'));
        await stageDraft(protocol, 'permission', permissionGranting('shyx_agent', 'shyx_other'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.failed).toEqual([]);
        expect(rulesOf(res, 'shyx_ticket')).toContain('security-master-detail-ungranted');
    });
});
