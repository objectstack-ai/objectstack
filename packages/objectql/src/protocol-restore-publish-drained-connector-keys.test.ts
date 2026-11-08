// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// Pays the lint root's first load at collection, never inside a clocked case.
import './__fixtures__/lint-root-preload.testkit.js';
import { describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';
import { assertEngineFindOnePredicate } from './engine-findone-predicate.js';

/**
 * `rollbackMetaItem` and `publishMetaItem` write a connector's LIVE row
 * without the positions a save of the served form drains (its undeclared
 * `auth` keys), whatever the history version or the stored draft holds.
 *
 * The stub engine is `protocol-publish-rollback.test.ts`'s.
 * The placeholder is a fixture string, not a credential.
 */

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
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

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;
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
        const k = keyOf(w);
        const r = rows.get(k);
        return r ? { key: k, row: r } : null;
    };

    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean => {
        if (w.organization_id !== undefined && h.organization_id !== w.organization_id)
            return false;
        if (w.type !== undefined && h.type !== w.type) return false;
        if (w.name !== undefined && h.name !== w.name) return false;
        if (w.version !== undefined && h.version !== w.version) return false;
        if (w.operation_type !== undefined && h.operation_type !== w.operation_type)
            return false;
        return true;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            // [#11957] Pinned to ObjectQL.findOne's OWN #4419 predicate: `findOne`
            // applies limit: 1, so a query naming no record returns an ARBITRARY row
            // and the engine REFUSES it. A double that answers it anyway is how
            // #11767 shipped a bootstrap bypass that was inert on every real
            // deployment while a 641-line unit matrix stayed green.
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
            let found: unknown[];
            if (table === 'sys_metadata_history') {
                const out = historyRows.filter((h) => matchesHistory(h, opts.where));
                // QueryAST shape: `orderBy` is an ARRAY of `{ field, order }`
                // (SortNodeSchema). This double used to destructure
                // `{ field, direction }` off the array itself, so both names
                // read `undefined` — it spoke the `direction` vocabulary the
                // engine does not read (#4674) AND, because an array has no
                // `.field`, sorted nothing at all. Either way a test built on
                // it would have ratified the broken behaviour.
                const orderBy = (opts as any).orderBy;
                if (Array.isArray(orderBy) && orderBy.length > 0) {
                    out.sort((a: any, b: any) => {
                        for (const { field, order } of orderBy) {
                            const av = a[field]; const bv = b[field];
                            if (av < bv) return order === 'desc' ? 1 : -1;
                            if (av > bv) return order === 'desc' ? -1 : 1;
                        }
                        return 0;
                    });
                }
                found = out;
            } else {
                // Every stated column is matched (`$in` or equality; an absent
                // column reads as `null`); operator keys are not modelled.
                found = Array.from(rows.values()).filter((r) =>
                    Object.entries(opts.where).every(([column, want]) => {
                        if (want === undefined || column.startsWith('$')) return true;
                        const actual = (r as unknown as Record<string, unknown>)[column] ?? null;
                        if (want !== null && typeof want === 'object') {
                            return Array.isArray((want as { $in?: unknown }).$in) ? whereValueMatches(actual, want) : true;
                        }
                        return actual === want;
                    }));
            }
            // The caller's bound, applied after the filter (check:objectql-double-limit).
            return typeof opts?.limit === 'number' ? found.slice(0, opts.limit) : found;
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
            // [#5480] Pinned to ObjectQL.update's OWN dispatch predicate, the
            // twin of the delete pin below and on the same argument: this file
            // could bind one write verb to the producer and not the other only
            // because `update` had no shared predicate to bind to.
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            // Re-key in case state changed.
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            // [#4550] Pinned to ObjectQL.delete's OWN dispatch predicate. A double
            // looser than the engine it stands in for is how #4434 shipped a REST
            // route that answered 500 to every caller with its suite green.
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any) => Promise<T>): Promise<T> {
            return cb(undefined);
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            // The connector door reads the registry for a shipped item of the name.
            getItem: () => undefined,
        },
    };
    return { engine, rows, historyRows };
}

/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` (the by-name read's both-spellings `type`) or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

const LEGACY_AUTH_VALUE = 'TEST_PLACEHOLDER_LEGACY_AUTH_VALUE';
const DECLARED_AUTH = { type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' };

const connector = (label: string) => ({
    name: 'vendor_api',
    label,
    type: 'api',
    provider: 'rest',
    providerConfig: { baseUrl: 'https://api.vendor.example/v1' },
    auth: { ...DECLARED_AUTH },
});

/** The stored body with an undeclared `auth` key added. */
const withLegacyKey = (stored: string): string => {
    const body = JSON.parse(stored);
    return JSON.stringify({ ...body, auth: { ...body.auth, token: LEGACY_AUTH_VALUE } });
};

const liveConnectorRow = (rows: Map<string, Row>, state = 'active'): Row | undefined =>
    Array.from(rows.values()).find((r) => r.type === 'connector' && r.name === 'vendor_api' && r.state === state);

describe('rollbackMetaItem and publishMetaItem write a connector live row without a drained key', () => {
    it('rollbackMetaItem to a version that holds an undeclared `auth` key', async () => {
        const { engine, rows, historyRows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({ type: 'connector', name: 'vendor_api', item: connector('v1') });
        await protocol.saveMetaItem({ type: 'connector', name: 'vendor_api', item: connector('v2') });
        const v1 = historyRows.find((h) => h.type === 'connector' && h.version === 1)!;
        v1.metadata = withLegacyKey(v1.metadata!);

        const result = await protocol.rollbackMetaItem({ type: 'connector', name: 'vendor_api', toVersion: 1, actor: 'admin' });

        expect((result as any).success).toBe(true);
        const live = liveConnectorRow(rows)!;
        expect(live.metadata).not.toContain(LEGACY_AUTH_VALUE);
        expect(JSON.parse(live.metadata)).toMatchObject({ label: 'v1', auth: DECLARED_AUTH });
    });

    it('publishMetaItem of a stored draft that holds an undeclared `auth` key', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({ type: 'connector', name: 'vendor_api', item: connector('v1') });
        await protocol.saveMetaItem({ type: 'connector', name: 'vendor_api', item: connector('v2-draft'), mode: 'draft' } as any);
        const draft = liveConnectorRow(rows, 'draft')!;
        draft.metadata = withLegacyKey(draft.metadata);

        const result = await protocol.publishMetaItem({ type: 'connector', name: 'vendor_api', actor: 'admin' });

        expect((result as any).success).toBe(true);
        const live = liveConnectorRow(rows)!;
        expect(live.metadata).not.toContain(LEGACY_AUTH_VALUE);
        expect(JSON.parse(live.metadata)).toMatchObject({ label: 'v2-draft', auth: DECLARED_AUTH });
        expect(liveConnectorRow(rows, 'draft')).toBeUndefined();
    });

    it('CONTROL: rollbackMetaItem to a version with nothing undeclared restores it as written', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({ type: 'connector', name: 'vendor_api', item: connector('v1') });
        const v1Stored = liveConnectorRow(rows)!.metadata;
        await protocol.saveMetaItem({ type: 'connector', name: 'vendor_api', item: connector('v2') });

        await protocol.rollbackMetaItem({ type: 'connector', name: 'vendor_api', toVersion: 1, actor: 'admin' });

        expect(liveConnectorRow(rows)!.metadata).toBe(v1Stored);
    });
});
