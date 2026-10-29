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


import { appendFileSync } from 'node:fs';
const OUT = process.env.PROBE_OUT!;
async function stageDraft(protocol: ObjectStackProtocolImplementation, type: string, item: { name: string }) {
    return (protocol as any).saveMetaItem({ type, name: item.name, item, packageId: PKG, mode: 'draft' });
}
const RULE_OBJ = {
    name: 'rule_probe',
    label: 'Rule Probe',
    sharingModel: 'private',
    fields: {
        name: { type: 'text', label: 'Name' },
        amount: { type: 'number', label: 'Amount' },
    },
    validations: [
        { name: 'ok_rule', type: 'script', condition: 'record.name != null', message: 'ok' },
        { name: 'amount_rule', type: 'script', condition: 'record.amount > 100', message: 'Amount rule' },
        { name: 'cond_rule', type: 'conditional', when: 'record.amount > 5',
          then: { name: 'inner', type: 'script', condition: 'record.amount < 1000', message: 'inner' }, message: 'c' },
    ],
};
const FLOW = {
    name: 'edge_cel', label: 'Edge CEL', type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'decide', type: 'decision', label: 'Decide' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'decide' },
        { id: 'e2', source: 'decide', target: 'end', type: 'conditional', condition: 'record.name ==' },
    ],
};
describe('probe 27643', () => {
    for (const [type, item] of [['object', RULE_OBJ], ['flow', FLOW]] as const) {
        it(type, async () => {
            const { engine } = makeStubEngine();
            const protocol = new ObjectStackProtocolImplementation(engine);
            await stageDraft(protocol, type, item as any);
            const read: any = await protocol.getMetaItem({ type, name: item.name, state: 'draft', packageId: PKG } as any);
            const refusal: any = await protocol.publishMetaItem({ type, name: item.name, packageId: PKG } as any).then(() => null, (e: unknown) => e);
            appendFileSync(OUT, JSON.stringify({ type, diagnostics: read.item._diagnostics,
                publish422: refusal && { status: refusal.status, code: refusal.code,
                    issues: refusal.issues.map((i: any) => ({ rule: i.rule, path: i.path, where: i.where, message: i.message.slice(0, 160) })) } }, null, 1) + '\n');
        });
    }
});
