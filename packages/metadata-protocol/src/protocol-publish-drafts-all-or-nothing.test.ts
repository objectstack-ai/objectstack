// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * ADR-0067 D2: a package publish is all-or-nothing — the refusal path must keep
 * the publish dialog's own promise ("要么全部生效，要么都不生效") on every
 * runtime, not only on one whose engine can roll a transaction back.
 *
 * ## The defect, as measured on a cloud environment
 *
 * Package `app.nyd2` held eleven drafts. The ninth, an object whose
 * autonumber format interpolates `{YYYYMM}` (no such field), was refused by
 * the publish-time authoring gate. The toast said "没有内容生效", yet drafts
 * 1-8 were live: the pending count dropped from 11 to 3 and the app was
 * served as published over an object that did not exist.
 *
 * ## The mechanism, measured in this file
 *
 * `publishPackageDrafts` promoted the drafts one by one and relied on
 * `engine.transaction()` to undo the earlier promotions when a later one was
 * refused. It probed `typeof engine.transaction === 'function'` — true on every
 * real engine — but `ObjectQL.transaction()` runs the callback with NO
 * transaction and NO rollback when the default driver cannot carry one (the
 * declared ADR-0119 D1 degrade; `TursoDriver`'s remote transport declares
 * `supports.transactionsUnsupported`). So on such a runtime every promotion
 * before the refused draft was already durable, and the refusal path then
 * reported "nothing landed".
 *
 * The `degrading` engine below models that runtime exactly as ObjectQL's
 * `transaction()` treats it: the callback runs with `{ owned: false }` and
 * nothing is undone, and `require: true` throws `ERR_TRANSACTION_UNSUPPORTED`
 * before the callback. The `rollingBack` engine models a SQL runtime whose
 * transaction really undoes the writes made inside it.
 *
 * Harness: the faithful stub engine of `protocol-publish-drafts-closure.test.ts`,
 * copied rather than imported (self-contained harnesses are the shape here),
 * extended with the driver registry `engineCanRollBack` reads and with ledgers
 * for the audit and commit rows. Drafts are staged through the real
 * `saveMetaItem` and published through the real `publishPackageDrafts`; nothing
 * on the gate or promotion path is stubbed.
 */

// Pays the lint root's first load at collection, never inside a clocked case.
import './lint-root-preload.testkit.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the stub engine cannot
// accept a call ObjectQL refuses. From `@objectstack/metadata-core`, never from
// `@objectstack/objectql` — that import would close a dependency cycle.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
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
    [k: string]: unknown;
}

// Overlay rows are keyed by (type, name, org, state, package_id) — the ADR-0048 key.
function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function matchesWhere(r: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

const PKG = 'app.nyd2';

type TransactionMode = 'degrading' | 'rollingBack';

/**
 * @param mode `degrading` — ObjectQL over a default driver that declares no
 *   transactions (the remote Turso transport): `transaction()` runs the
 *   callback with no rollback, and refuses `require: true` before it.
 *   `rollingBack` — a SQL runtime: the outermost `transaction()` snapshots the
 *   tables and restores them when the callback throws; a nested call joins.
 */
function makeEngine(mode: TransactionMode) {
    const rows = new Map<string, Row>();
    const tables: Record<string, Array<Record<string, unknown>>> = {
        sys_metadata_history: [],
        sys_metadata_audit: [],
        sys_metadata_commit: [],
    };
    let nextId = 0;
    let depth = 0;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            return r && matchesWhere(r, w) ? { key: k, row: r } : null;
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const driver = mode === 'degrading'
        ? { name: 'turso', beginTransaction: async () => ({}), supports: { transactionsUnsupported: true } }
        : { name: 'sql', beginTransaction: async () => ({}), supports: { transactionsUnsupported: false } };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (tables[table]) return tables[table].find((h) => matchesWhere(h, opts.where)) ?? null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where?: Record<string, unknown> } = {}) {
            const where = opts.where ?? {};
            if (tables[table]) return tables[table].filter((h) => matchesWhere(h, where));
            return Array.from(rows.values()).filter((r) => matchesWhere(r, where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            if (tables[table]) {
                const h = { id: `${table}_${nextId}`, ...data };
                tables[table].push(h);
                return { id: h.id };
            }
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
        async transaction<T>(
            cb: (ctx: any, info: { owned: boolean }) => Promise<T>,
            base?: unknown,
            opts?: { require?: boolean },
        ): Promise<T> {
            if (mode === 'degrading') {
                // `ObjectQL.transaction()` over a driver whose declaration says
                // it has no transactions (engine-transactions-section.ts).
                if (opts?.require === true) {
                    throw Object.assign(new Error("Datasource 'turso' cannot open a transaction"), {
                        code: 'ERR_TRANSACTION_UNSUPPORTED',
                    });
                }
                return cb(base, { owned: false });
            }
            if (depth > 0) return cb(base, { owned: false });
            const snapRows = new Map(Array.from(rows, ([k, r]) => [k, { ...r }]));
            const snapTables = Object.fromEntries(Object.entries(tables).map(([t, list]) => [t, list.map((h) => ({ ...h }))]));
            depth += 1;
            try {
                return await cb(base, { owned: true });
            } catch (e) {
                rows.clear();
                for (const [k, r] of snapRows) rows.set(k, r);
                for (const [t, list] of Object.entries(snapTables)) tables[t] = list;
                throw e;
            } finally {
                depth -= 1;
            }
        },
        // The driver registry `engineCanRollBack` (`@objectstack/core`) asks.
        getDefaultDriverName: () => driver.name,
        getDriverByName: (name: string) => (name === driver.name ? driver : undefined),
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            // The package the drafts are bound to is INSTALLED, and its
            // manifest declares no namespace and no dependencies.
            getPackage: (id: string) => (id === PKG ? { manifest: { id: PKG } } : undefined),
        },
    };
    const active = () => Array.from(rows.values()).filter((r) => r.state === 'active' && r.package_id === PKG);
    const drafts = () => Array.from(rows.values()).filter((r) => r.state === 'draft' && r.package_id === PKG);
    return { engine, rows, tables, active, drafts };
}

// ─────────────────────────────────────────────────────────────────────────────
// The card's eleven drafts, in the card's draft order.
// ─────────────────────────────────────────────────────────────────────────────

const OBJ = 'nyd2_leave_request';

const leaveRequest = (autonumberFormat: string) => ({
    name: OBJ,
    label: 'Leave Request',
    fields: {
        leave_no: { type: 'autonumber', label: 'Leave No', autonumberFormat },
        reason: { type: 'text', label: 'Reason' },
        days: { type: 'number', label: 'Days' },
    },
});

/** `QJ{YYYYMM}-{0000}`: `{YYYYMM}` is no date token and no field — refused at publish. */
const REFUSED_FORMAT = 'QJ{YYYYMM}-{0000}';
const CLEAN_FORMAT = 'QJ-{0000}';

const view = (short: string) => ({
    name: `${OBJ}.${short}`,
    object: OBJ,
    label: short,
    viewKind: 'list',
    type: 'grid',
    columns: ['leave_no', 'reason', 'days'],
});

/** `[type, name, body]` — a seed body carries no `name` (its schema refuses one). */
function cardDrafts(autonumberFormat: string): Array<[string, string, Record<string, unknown>]> {
    return [
        ['view', `${OBJ}.leave_ledger`, view('leave_ledger')],
        ['view', `${OBJ}.leave_month_ledger`, view('leave_month_ledger')],
        ['view', `${OBJ}.leave_pending`, view('leave_pending')],
        ['view', `${OBJ}.leave_status_board`, view('leave_status_board')],
        ['view', `${OBJ}.leave_calendar`, view('leave_calendar')],
        ['dataset', 'nyd2_leave_request_ds', {
            name: 'nyd2_leave_request_ds',
            label: 'Leave Requests',
            object: OBJ,
            dimensions: [{ name: 'reason', field: 'reason' }],
            measures: [{ name: 'request_count', aggregate: 'count' }],
        }],
        ['dashboard', 'leave_stats', {
            name: 'leave_stats',
            label: 'Leave Stats',
            widgets: [{
                id: 'kpi_requests', type: 'metric', title: 'Requests',
                dataset: 'nyd2_leave_request_ds', values: ['request_count'],
            }],
        }],
        ['app', 'leave_management', { name: 'leave_management', label: '请假管理' }],
        ['object', OBJ, leaveRequest(autonumberFormat)],
        ['permission', 'app_nyd2_member_access', {
            name: 'app_nyd2_member_access',
            label: 'Member Access',
            objects: { [OBJ]: { allowRead: true, allowCreate: true } },
        }],
        ['seed', 'nyd2_leave_request_sample', {
            object: OBJ,
            mode: 'insert',
            records: [{ reason: 'Annual leave', days: 2 }],
        }],
    ];
}

async function stageCardDrafts(protocol: ObjectStackProtocolImplementation, autonumberFormat: string) {
    for (const [type, name, item] of cardDrafts(autonumberFormat)) {
        await (protocol as any).saveMetaItem({ type, name, item, packageId: PKG, mode: 'draft' });
    }
}

const allNames = cardDrafts(CLEAN_FORMAT).map(([type, name]) => `${type}/${name}`).sort();
const namesOf = (list: Array<{ type: string; name: string }>) => list.map((r) => `${r.type}/${r.name}`).sort();

describe('publishPackageDrafts keeps ADR-0067 D2 on a runtime that cannot roll back', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    let info: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        info = vi.spyOn(console, 'info').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        info.mockRestore();
    });

    it('stages all eleven drafts and nothing is active before the publish', async () => {
        const { engine, active, drafts } = makeEngine('degrading');
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageCardDrafts(protocol, REFUSED_FORMAT);
        expect(namesOf(drafts())).toEqual(allNames);
        expect(active()).toEqual([]);
    });

    it('a refusal at item 9 of 11 leaves every draft pending and nothing active (store)', async () => {
        const { engine, active, drafts } = makeEngine('degrading');
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageCardDrafts(protocol, REFUSED_FORMAT);

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0, published: [] });
        const causal = res.failed.find((f) => f.name === OBJ)!;
        expect(causal).toMatchObject({ type: 'object', code: 'INVALID_METADATA' });
        expect(
            namesOf(active()),
            'a refused batch promoted drafts before the refused item — the half-landing the card measured',
        ).toEqual([]);
        expect(namesOf(drafts())).toEqual(allNames);
    });
});
