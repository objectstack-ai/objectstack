// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27818] The own-reference rule for a `datasource`'s
 * `external.credentialsRef` at the doors that make a STORED body the active
 * row: the restore doors (`rollbackMetaItem`, `revertCommit`'s restore limb)
 * and the draft publish (`publishMetaItem`).
 *
 * The rule is the one #27582 set and #27762 applied to the metadata save
 * door: a non-system write may only seal a new value or keep its own record's
 * stored reference. These doors seal nothing, so the one reference the body
 * they write may name is the one the active row they write into holds now:
 *
 *  - refused, `VALIDATION_ERROR` / 400, before anything is written: a version
 *    (or a draft) naming a reference another datasource holds, one no row
 *    holds, one its row held before and holds no longer, and one where its row
 *    holds none. One answer whatever the reference names, and the reference is
 *    never echoed;
 *  - accepted: a version (or a draft) naming the reference its row holds now,
 *    and one naming none (it stores none, as a save that omits the key does).
 *
 * Staging. A stored body the rule refuses today exists in a deployment in two
 * ways: it was stored before the save door judged the key, or the row's own
 * reference moved after it was stored (the datasource admin door binds and
 * rotates the reference by writing the active row directly). Both are staged
 * here by rewriting the stored bytes in the double, as such rows sit at rest.
 *
 * The double is copied from `protocol.restore-doors-save-refusal-family.test.ts`,
 * not imported, so each pin can fail on its own.
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
        getDriverByName: () => undefined,
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
    return { engine, rows, historyRows, registered, serveCommit: (c: unknown) => { commit = c; } };
}

function makeProtocol() {
    const h = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(h.engine, () => new Map(), undefined) as any;
    // `OS_METADATA_WRITABLE` is memoised process-wide; clear it rather than assume.
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    return { protocol, ...h };
}

type Harness = ReturnType<typeof makeProtocol>;

/** The reference `ledger`'s row holds now. */
const OWN_REF = 'sys_secret:ledger_own_27818';
/** The reference `ledger`'s row held before its reference was rotated. */
const FORMER_REF = 'sys_secret:ledger_former_27818';
/** The reference another datasource's row (`vault`) holds. */
const OTHER_REF = 'sys_secret:vault_own_27818';
/** A reference no row holds. */
const UNHELD_REF = 'sys_secret:held_by_no_row_27818';
const ALL_REFS = [OWN_REF, FORMER_REF, OTHER_REF, UNHELD_REF];

/** A schema-valid datasource body, so every refusal below is this rule's and never a 422. */
const datasource = (name: string, label: string, credentialsRef?: string) => ({
    name,
    label,
    driver: 'postgres',
    config: { host: 'db.internal', database: name, username: 'app' },
    ...(credentialsRef === undefined ? {} : { external: { credentialsRef } }),
});

const rowOf = (h: Harness, name: string, state: 'active' | 'draft' = 'active') =>
    Array.from(h.rows.values()).find((r) => r.type === 'datasource' && r.name === name && r.state === state);

const storedRefOf = (h: Harness, name: string, state: 'active' | 'draft' = 'active') => {
    const row = rowOf(h, name, state);
    return row ? JSON.parse(row.metadata).external?.credentialsRef : undefined;
};

/** Set the reference a stored row holds, in place — the way the datasource admin door writes the row. */
function bindRow(h: Harness, name: string, credentialsRef: string | undefined, state: 'active' | 'draft' = 'active') {
    const row = rowOf(h, name, state);
    if (!row) throw new Error(`no ${state} row datasource/${name}`);
    const { external: _external, ...rest } = JSON.parse(row.metadata);
    row.metadata = JSON.stringify(credentialsRef === undefined ? rest : { ...rest, external: { credentialsRef } });
}

/** Set the reference one stored history version names, in place. */
function bindVersion(h: Harness, name: string, version: number, credentialsRef: string | undefined) {
    const row = h.historyRows.find((r) => r.type === 'datasource' && r.name === name && r.version === version);
    if (!row?.metadata) throw new Error(`no history row datasource/${name}@${version}`);
    const { external: _external, ...rest } = JSON.parse(row.metadata);
    row.metadata = JSON.stringify(credentialsRef === undefined ? rest : { ...rest, external: { credentialsRef } });
}

/**
 * `ledger` saved three times through the save door (history versions 1–3),
 * then bound by the admin door to `OWN_REF`; `vault` bound to `OTHER_REF`.
 */
async function stage(h: Harness): Promise<void> {
    for (const label of ['Ledger v1', 'Ledger v2', 'Ledger v3']) {
        await h.protocol.saveMetaItem({ type: 'datasource', name: 'ledger', item: datasource('ledger', label) });
    }
    await h.protocol.saveMetaItem({ type: 'datasource', name: 'vault', item: datasource('vault', 'Vault') });
    bindRow(h, 'ledger', OWN_REF);
    bindRow(h, 'vault', OTHER_REF);
}

/** Everything a refused write must leave as it found it. */
const snapshot = (h: Harness) => JSON.stringify({
    rows: Array.from(h.rows.values()).map((r) => [r.type, r.name, r.state, r.metadata]),
    history: h.historyRows.length,
    registered: Array.from(h.registered.entries()).map(([t, m]) => [t, Array.from(m.keys())]),
});

const commitRow = (prevVersion: number) => ({
    id: 'c1',
    commit_id: 'c1',
    organization_id: null,
    operation: 'apply',
    message: 'the commit under revert',
    created_at: '2026-01-01T00:00:00Z',
    items: JSON.stringify([{ type: 'datasource', name: 'ledger', existedBefore: true, prevVersion }]),
});

const expectRuleEnvelope = (r: { code: unknown; status?: unknown; message: string }) => {
    expect({ code: r.code, status: r.status }, r.message).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
    for (const ref of ALL_REFS) expect(r.message).not.toContain(ref);
};

/** The references a restored version may name that the row it is restored into does not hold now. */
const refusedVersions: Array<{ title: string; rowHolds: string | undefined; versionNames: string }> = [
    { title: 'a reference another datasource holds', rowHolds: OWN_REF, versionNames: OTHER_REF },
    { title: 'a reference no row holds', rowHolds: OWN_REF, versionNames: UNHELD_REF },
    { title: 'the reference its row held before and holds no longer', rowHolds: OWN_REF, versionNames: FORMER_REF },
    { title: 'a reference where its row holds none now', rowHolds: undefined, versionNames: FORMER_REF },
];

afterEach(() => vi.restoreAllMocks());

/** What one door answered a refused write. */
interface Answer { code: unknown; status: unknown; message: string }

/** A draft of `ledger` saved through the save door with no reference, then holding `draftNames` at rest. */
async function stageDraft(h: Harness, draftNames: string | undefined) {
    await stage(h);
    await h.protocol.saveMetaItem({ type: 'datasource', name: 'ledger', mode: 'draft', item: datasource('ledger', 'Ledger v1') });
    bindRow(h, 'ledger', draftNames, 'draft');
}

/**
 * The three doors that make a stored `ledger` body the active row. `stage`
 * leaves a stored body (history version 1, or the draft) naming `bodyNames`;
 * `write` makes it the active row and returns the refusal, or `null` when the
 * door wrote it.
 */
const doors: Array<{
    door: string;
    stage: (h: Harness, bodyNames: string | undefined) => Promise<void>;
    write: (h: Harness) => Promise<Answer | null>;
}> = [
    {
        door: 'rollbackMetaItem',
        async stage(h, bodyNames) {
            await stage(h);
            bindVersion(h, 'ledger', 1, bodyNames);
        },
        async write(h) {
            try {
                const res = await h.protocol.rollbackMetaItem({ type: 'datasource', name: 'ledger', toVersion: 1 });
                expect(res.success).toBe(true);
                return null;
            } catch (err: any) {
                return { code: err.code, status: err.status, message: String(err.message) };
            }
        },
    },
    {
        door: 'revertCommit (its restore limb)',
        async stage(h, bodyNames) {
            await stage(h);
            bindVersion(h, 'ledger', 1, bodyNames);
            h.serveCommit(commitRow(1));
        },
        async write(h) {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const res = await h.protocol.revertCommit({ commitId: 'c1' });
            if (res.failed.length === 0) {
                expect(res.revertedCount).toBe(1);
                return null;
            }
            expect(res.success).toBe(false);
            expect(res.revertedCount).toBe(0);
            expect(res.failed).toEqual([{ type: 'datasource', name: 'ledger', error: expect.any(String), code: 'VALIDATION_ERROR' }]);
            // `failed[]` carries the refusal's code and text, not its status: the code is the standard catalog's 400.
            return { code: res.failed[0].code, status: 400, message: String(res.failed[0].error) };
        },
    },
    {
        door: 'publishMetaItem (the draft publish)',
        stage: stageDraft,
        async write(h) {
            try {
                await h.protocol.publishMetaItem({ type: 'datasource', name: 'ledger' });
                return null;
            } catch (err: any) {
                return { code: err.code, status: err.status, message: String(err.message) };
            }
        },
    },
];

describe('[#27818] datasource `external.credentialsRef`: a stored body made active may name only the reference its row holds now', () => {
    for (const d of doors) {
        describe(d.door, () => {
            /** One refused case on a fresh store: nothing is written, and the row keeps the reference it holds. */
            const refused = async (c: (typeof refusedVersions)[number]): Promise<Answer> => {
                const h = makeProtocol();
                await d.stage(h, c.versionNames);
                bindRow(h, 'ledger', c.rowHolds);
                const before = snapshot(h);
                const answer = await d.write(h);
                expect(answer, 'the write was accepted').not.toBeNull();
                expect(snapshot(h)).toBe(before);
                expect(storedRefOf(h, 'ledger')).toBe(c.rowHolds);
                return answer!;
            };

            for (const c of refusedVersions) {
                it(`refuses a body naming ${c.title}, VALIDATION_ERROR / 400, never echoing it`, async () => {
                    expectRuleEnvelope(await refused(c));
                });
            }

            it('answers the same whatever the reference names', async () => {
                const answers: Answer[] = [];
                for (const c of refusedVersions) answers.push(await refused(c));
                for (const answer of answers) expect(answer).toEqual(answers[0]);
            });

            it('writes a body naming the reference its row holds now, and keeps it', async () => {
                const h = makeProtocol();
                await d.stage(h, OWN_REF);
                expect(await d.write(h)).toBeNull();
                expect(JSON.parse(rowOf(h, 'ledger')!.metadata).label).toBe('Ledger v1');
                expect(storedRefOf(h, 'ledger')).toBe(OWN_REF);
            });

            it('writes a body naming no reference, which stores none (as a save omitting the key does)', async () => {
                const h = makeProtocol();
                await d.stage(h, undefined);
                expect(await d.write(h)).toBeNull();
                expect(JSON.parse(rowOf(h, 'ledger')!.metadata).label).toBe('Ledger v1');
                expect(storedRefOf(h, 'ledger')).toBeUndefined();
            });
        });
    }
});
