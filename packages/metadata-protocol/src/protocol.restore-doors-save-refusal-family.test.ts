// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The restore doors ask the save door's refusal family.
 *
 * `rollbackMetaItem` and `revertCommit`'s restore limb write a stored history
 * body back as the active row (`repo.restoreVersion`). `saveMetaItem` refuses a
 * family of shapes after its schema gate: a hook with no `body`, a second
 * default record page of an object, an `external` object binding on a managed
 * datasource (both halves of the pair), an object `datasource` that names no
 * datasource (#26724), a `runAs: 'system'` flow an anonymous
 * endpoint names, the shared runtime authoring rules, and the authoring gate a
 * domain plugin registers. Measured on `origin/main` `5801a4f2c` before this
 * file: each restore door wrote every one of those shapes back, so a version
 * saved before a refusal existed, or one half of a pair the save door now
 * refuses, came back live with no refusal.
 *
 * Pinned here, per refusal, at both doors:
 *  - `rollbackMetaItem` answers the save door's own refusal (its code and
 *    status), and stores nothing: the active row, the history and the
 *    registry are unchanged;
 *  - `revertCommit` reports it in `failed[]` with that code, and stores
 *    nothing;
 *  - a CONTROL restores an acceptable version of the same item through the
 *    same door, so a door that refuses everything cannot pass.
 *
 * Staging. A version the save door refuses today is staged the way it exists
 * in a deployment: either the other half of a pair moved after the version
 * was saved (the datasource, the default page, the anonymous endpoint, the
 * plugin gate), or the stored bytes predate the rule and are rewritten in the
 * double (`rewriteHistory`), as such a row sits at rest.
 *
 * The double is copied from `protocol.item-name-every-door.test.ts`, not
 * imported, so each pin can fail on its own.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, imported from
// `@objectstack/metadata-core` and NOT from `@objectstack/objectql`: objectql
// depends on this package, so that import would close a dependency cycle.
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

interface HistoryRow {
    id: string;
    type: string;
    name: string;
    version: number;
    organization_id: string | null;
    operation_type: string;
    metadata?: string | null;
}

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

/** Top-level eq + `$or` + `$in` + explicit-NULL, the subset these paths emit. */
function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        const actual = (r as unknown as Record<string, unknown>)[k];
        if (v !== null && typeof v === 'object' && Array.isArray((v as { $in?: unknown }).$in)) {
            if (!(v as { $in: unknown[] }).$in.includes(actual)) return false;
            continue;
        }
        if (v === null ? actual !== null && actual !== undefined : actual !== v) return false;
    }
    return true;
}

/** A double that STORES rows and history, and whose registry keys an item by its own `name`. */
function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    const registered = new Map<string, Map<string, unknown>>();
    // [#26724] The drivers the engine has registered by name, with no datasource item.
    const drivers = new Set<string>();
    let nextId = 0;
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
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_commit') return commit;
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            // Hold the caller's bound AFTER the filter, by PRESENCE — the
            // objectql-double-limit contract.
            const bound = <T>(all: T[]): T[] =>
                typeof opts?.limit === 'number' ? all.slice(0, opts.limit) : all;
            if (table === 'sys_metadata_history') {
                return bound(historyRows.filter((h) => matchesHistory(h, opts?.where ?? {})));
            }
            if (table !== 'sys_metadata') return [];
            return bound(Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {})));
        },
        async insert(table: string, data: Record<string, unknown>) {
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
        async count() { return 0; },
        getDriverByName: (name: string) => (drivers.has(name) ? { name } : undefined),
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        registry: {
            registerItem: (type: string, item: any) => {
                if (!registered.has(type)) registered.set(type, new Map());
                registered.get(type)!.set(item?.name, item);
            },
            registerObject: () => {},
            unregisterObject: () => true,
            removeObjectOverlay: () => {},
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => true,
            listItems: (type: string) => Array.from(registered.get(type)?.values() ?? []),
            getItem: (type: string, name: string) => registered.get(type)?.get(name),
            getAllObjects: () => [],
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
        },
    };
    return {
        engine,
        rows,
        historyRows,
        registered,
        drivers,
        serveCommit: (c: unknown) => { commit = c; },
    };
}

function makeProtocol() {
    const h = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(h.engine, () => new Map(), undefined) as any;
    // `OS_METADATA_WRITABLE` is memoised process-wide; clear it rather than assume.
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    return { protocol, ...h };
}

type Harness = ReturnType<typeof makeProtocol>;

/** The active row of one item, as stored, or `null`. */
const activeBody = (h: Harness, type: string, name: string) => {
    const row = Array.from(h.rows.values()).find((r) => r.type === type && r.name === name && r.state === 'active');
    return row ? JSON.parse(row.metadata) : null;
};

/** Everything a refused restore must leave as it found it. */
const snapshot = (h: Harness) => JSON.stringify({
    rows: Array.from(h.rows.values()).map((r) => [r.type, r.name, r.state, r.metadata]),
    history: h.historyRows.length,
    registered: Array.from(h.registered.entries()).map(([t, m]) => [t, Array.from(m.keys())]),
});

/** Rewrite one stored history version's body in place — a version stored before the rule. */
function rewriteHistory(h: Harness, type: string, name: string, version: number, edit: (body: any) => any) {
    const row = h.historyRows.find((r) => r.type === type && r.name === name && r.version === version);
    if (!row?.metadata) throw new Error(`no history row ${type}/${name}@${version}`);
    row.metadata = JSON.stringify(edit(JSON.parse(row.metadata)));
}

const commitRow = (items: unknown[]) => ({
    id: 'c1',
    commit_id: 'c1',
    organization_id: null,
    operation: 'apply',
    message: 'the commit under revert',
    created_at: '2026-01-01T00:00:00Z',
    items: JSON.stringify(items),
});

async function attempt<T>(run: () => Promise<T>): Promise<{ result: T | null; error: any }> {
    try {
        return { result: await run(), error: null };
    } catch (error) {
        return { result: null, error };
    }
}

/**
 * One refusal at both doors. `stage` builds the item's history and returns the
 * version the save door now refuses and an acceptable one; `expectRefusal`
 * asserts the save door's envelope on the thrown error.
 */
interface RefusalCase {
    title: string;
    type: string;
    name: string;
    code: string;
    status: number;
    stage: (h: Harness) => Promise<{ refused: number; accepted: number }>;
    /** What else the save door's refusal says — the named subject, never the prose. */
    expectDetail?: (error: any) => void;
}

function pinBothDoors(c: RefusalCase) {
    describe(c.title, () => {
        it(`rollbackMetaItem: answers ${c.code} / ${c.status}; nothing is stored`, async () => {
            const h = makeProtocol();
            const { refused } = await c.stage(h);
            const before = snapshot(h);

            const { error } = await attempt(() => h.protocol.rollbackMetaItem({ type: c.type, name: c.name, toVersion: refused }));

            expect(error).toBeInstanceOf(Error);
            expect({ code: error?.code, status: error?.status }).toEqual({ code: c.code, status: c.status });
            c.expectDetail?.(error);
            expect(snapshot(h)).toBe(before);
        });

        it('rollbackMetaItem CONTROL: an acceptable version of the same item is restored', async () => {
            const h = makeProtocol();
            const { accepted } = await c.stage(h);
            const expected = JSON.parse(h.historyRows.find((r) => r.type === c.type && r.name === c.name && r.version === accepted)!.metadata!);

            const res = await h.protocol.rollbackMetaItem({ type: c.type, name: c.name, toVersion: accepted });

            expect(res.success).toBe(true);
            expect(res.restoredFromVersion).toBe(accepted);
            expect(activeBody(h, c.type, c.name)).toEqual(expected);
        });

        it(`revertCommit: reports ${c.code} in failed[]; nothing is stored`, async () => {
            const h = makeProtocol();
            const { refused } = await c.stage(h);
            h.serveCommit(commitRow([{ type: c.type, name: c.name, existedBefore: true, prevVersion: refused }]));
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const before = snapshot(h);

            const res = await h.protocol.revertCommit({ commitId: 'c1' });

            expect(res.success).toBe(false);
            expect(res.revertedCount).toBe(0);
            expect(res.failed).toEqual([expect.objectContaining({ type: c.type, name: c.name, code: c.code })]);
            expect(snapshot(h)).toBe(before);
        });

        it('revertCommit CONTROL: the restore limb restores an acceptable version of the same item', async () => {
            const h = makeProtocol();
            const { accepted } = await c.stage(h);
            const expected = JSON.parse(h.historyRows.find((r) => r.type === c.type && r.name === c.name && r.version === accepted)!.metadata!);
            h.serveCommit(commitRow([{ type: c.type, name: c.name, existedBefore: true, prevVersion: accepted }]));

            const res = await h.protocol.revertCommit({ commitId: 'c1' });

            expect(res.failed).toEqual([]);
            expect(res.revertedCount).toBe(1);
            expect(activeBody(h, c.type, c.name)).toEqual(expected);
        });
    });
}

afterEach(() => vi.restoreAllMocks());

// ─── Fixtures ────────────────────────────────────────────────────────────────

const hook = (label: string) => ({
    name: 'stamp_assignee',
    label,
    object: 'showcase_task',
    events: ['beforeUpdate'],
    body: { language: 'js', source: "ctx.input.assignee = 'HOOKED';" },
});

const recordPage = (name: string, isDefault: boolean, label = name) =>
    ({ name, label, type: 'record', object: 'acme_org', isDefault, regions: [] });

const datasource = (extra: Record<string, unknown> = {}) =>
    ({ name: 'wh', label: 'Warehouse', driver: 'sqlite', config: { filename: 'wh.db' }, ...extra });
const FEDERATED = { schemaMode: 'external', external: { allowWrites: false } };
const order = (extra: Record<string, unknown> = {}) => ({
    name: 'wh_order',
    label: 'Order',
    sharingModel: 'private',
    fields: { title: { name: 'title', label: 'Title', type: 'text' } },
    datasource: 'wh',
    ...extra,
});
const EXTERNAL = { external: { remoteName: 'orders' } };

const FLOW = 'acme_partner_intake';
const flow = (runAs: 'system' | 'user', label = 'Partner intake') => ({
    name: FLOW,
    label,
    type: 'autolaunched',
    runAs,
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});
const anonymousEndpoint = {
    name: 'acme_partner_intake_api',
    path: '/api/v1/apps/acme/partner/intake',
    method: 'POST',
    type: 'flow',
    target: FLOW,
    authRequired: false,
    rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 100 },
};

/** An object the spec parse accepts and the runtime authoring gate refuses: the autonumber names a field it lacks. */
const task = (gateRefused: boolean) => ({
    name: 'acme_task',
    label: 'Task',
    sharingModel: 'private',
    fields: {
        title: { type: 'text', label: 'Title' },
        task_no: { type: 'autonumber', label: 'Task No', autonumberFormat: gateRefused ? '{plan_no}{000}' : 'T-{000}' },
    },
});

const dash = (label: string) => ({ name: 'dash_a', label, widgets: [] });

// ─── The family, one refusal at a time ───────────────────────────────────────

pinBothDoors({
    title: 'a hook with no `body` (runtimeHookWithoutBodyRefusal)',
    type: 'hook',
    name: 'stamp_assignee',
    code: 'VALIDATION_ERROR',
    status: 400,
    async stage(h) {
        await h.protocol.saveMetaItem({ type: 'hook', name: 'stamp_assignee', item: hook('v1') });
        await h.protocol.saveMetaItem({ type: 'hook', name: 'stamp_assignee', item: hook('v2') });
        await h.protocol.saveMetaItem({ type: 'hook', name: 'stamp_assignee', item: hook('v3') });
        // v1 as a hook stored before the rule: a `handler` and no `body`.
        rewriteHistory(h, 'hook', 'stamp_assignee', 1, ({ body: _body, ...rest }) => ({ ...rest, handler: 'stampAssignee' }));
        return { refused: 1, accepted: 2 };
    },
    expectDetail: (error) => expect(error.message).toContain("'stamp_assignee'"),
});

pinBothDoors({
    title: 'a second default record page of an object (defaultRecordPageSaveRefusal)',
    type: 'page',
    name: 'org_detail_a',
    code: 'DEFAULT_RECORD_PAGE_CONFLICT',
    status: 422,
    async stage(h) {
        await h.protocol.saveMetaItem({ type: 'page', name: 'org_detail_a', item: recordPage('org_detail_a', true) });
        await h.protocol.saveMetaItem({ type: 'page', name: 'org_detail_a', item: recordPage('org_detail_a', false) });
        await h.protocol.saveMetaItem({ type: 'page', name: 'org_detail_a', item: recordPage('org_detail_a', false, 'A v3') });
        // Another page took the default after v1 was saved.
        await h.protocol.saveMetaItem({ type: 'page', name: 'org_detail_b', item: recordPage('org_detail_b', true) });
        return { refused: 1, accepted: 2 };
    },
    expectDetail: (error) => {
        expect(error.object).toBe('acme_org');
        expect(error.holders).toEqual([expect.objectContaining({ page: 'org_detail_b' })]);
    },
});

pinBothDoors({
    title: 'the datasource half: a datasource restored as managed while an object binds it `external` (externalBindingSaveRefusal)',
    type: 'datasource',
    name: 'wh',
    code: 'INVALID_METADATA',
    status: 422,
    async stage(h) {
        await h.protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource({ schemaMode: 'managed' }) });
        await h.protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource(FEDERATED) });
        await h.protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource({ ...FEDERATED, label: 'Warehouse v3' }) });
        await h.protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: order(EXTERNAL) });
        return { refused: 1, accepted: 2 };
    },
    expectDetail: (error) => {
        expect(error.issues).toEqual([expect.objectContaining({ path: 'schemaMode', code: 'custom' })]);
        expect(error.issues[0].message.startsWith("Object 'wh_order' declares `external` on datasource 'wh'")).toBe(true);
    },
});

pinBothDoors({
    title: 'the object half: an object restored `external` on a datasource that is managed now (externalBindingSaveRefusal)',
    type: 'object',
    name: 'wh_order',
    code: 'INVALID_METADATA',
    status: 422,
    async stage(h) {
        await h.protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource(FEDERATED) });
        await h.protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: order(EXTERNAL) });
        await h.protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: order() });
        await h.protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: order({ label: 'Order v3' }) });
        // The datasource went managed once no object bound it `external`.
        await h.protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource({ schemaMode: 'managed' }) });
        return { refused: 1, accepted: 2 };
    },
    expectDetail: (error) => {
        expect(error.issues).toEqual([expect.objectContaining({ path: 'external', code: 'custom' })]);
        expect(error.issues[0].message.startsWith("Object 'wh_order' declares `external` on datasource 'wh'")).toBe(true);
    },
});

pinBothDoors({
    title: 'a `runAs: \'system\'` flow an anonymous endpoint names (anonymousElevatedFlowRefusal)',
    type: 'flow',
    name: FLOW,
    code: 'INVALID_METADATA',
    status: 422,
    async stage(h) {
        await h.protocol.saveMetaItem({ type: 'flow', name: FLOW, item: flow('system') });
        await h.protocol.saveMetaItem({ type: 'flow', name: FLOW, item: flow('user') });
        await h.protocol.saveMetaItem({ type: 'flow', name: FLOW, item: flow('user', 'Partner intake v3') });
        // The anonymous endpoint naming the flow arrived after v1 was saved.
        h.engine.registry.registerItem('api', anonymousEndpoint);
        return { refused: 1, accepted: 2 };
    },
    expectDetail: (error) => expect(error.issues).toEqual([expect.objectContaining({ path: 'runAs', code: 'custom' })]),
});

pinBothDoors({
    title: 'an object restored with a `datasource` that names nothing now (unknownDatasourceSaveRefusal)',
    type: 'object',
    name: 'wh_order',
    code: 'INVALID_METADATA',
    status: 422,
    async stage(h) {
        h.drivers.add('rt_store');
        await h.protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: order({ datasource: 'rt_store' }) });
        await h.protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: order({ datasource: undefined }) });
        await h.protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: order({ datasource: undefined, label: 'Order v3' }) });
        // The driver v1 was bound to is gone.
        h.drivers.delete('rt_store');
        return { refused: 1, accepted: 2 };
    },
    expectDetail: (error) => {
        expect(error.issues).toEqual([expect.objectContaining({ path: 'datasource', code: 'custom' })]);
        expect(error.issues[0].message.startsWith("Object 'wh_order' names datasource 'rt_store', and no datasource")).toBe(true);
    },
});

pinBothDoors({
    title: 'a body the runtime authoring rules refuse (assertRuntimeAuthoringRules)',
    type: 'object',
    name: 'acme_task',
    code: 'INVALID_METADATA',
    status: 422,
    async stage(h) {
        await h.protocol.saveMetaItem({ type: 'object', name: 'acme_task', item: task(false) });
        await h.protocol.saveMetaItem({ type: 'object', name: 'acme_task', item: { ...task(false), label: 'Task v2' } });
        await h.protocol.saveMetaItem({ type: 'object', name: 'acme_task', item: { ...task(false), label: 'Task v3' } });
        // v1 as stored before the rule: its autonumber names a field the object lacks.
        rewriteHistory(h, 'object', 'acme_task', 1, () => task(true));
        return { refused: 1, accepted: 2 };
    },
    expectDetail: (error) => expect(String(error.message)).toContain('plan_no'),
});

pinBothDoors({
    title: 'a body a domain plugin\'s authoring gate refuses (runAuthoringGate)',
    type: 'dashboard',
    name: 'dash_a',
    code: 'PERMISSION_DENIED',
    status: 403,
    async stage(h) {
        await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_a', item: dash('Refused by the gate') });
        await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_a', item: dash('v2') });
        await h.protocol.saveMetaItem({ type: 'dashboard', name: 'dash_a', item: dash('v3') });
        // The plugin registered its gate after v1 was saved.
        h.protocol.registerAuthoringGate('dashboard', (ctx: { state: string; body: any }) => {
            if (ctx.body?.label === 'Refused by the gate') {
                throw Object.assign(new Error(`refused in state ${ctx.state}`), { code: 'PERMISSION_DENIED', status: 403 });
            }
        });
        return { refused: 1, accepted: 2 };
    },
    expectDetail: (error) => expect(error.message).toBe('refused in state active'),
});
