// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21086 — the generic data door (`findData` / `getData`) serves the stored
 * metadata body of a `sys_metadata` / `sys_metadata_history` row as its type's
 * read projection: the one every `/meta` read exit serves, through the same
 * `@objectstack/spec/kernel` redactor registry.
 *
 * Both halves are pinned, per row shape:
 *
 *  - **withheld** — a stored credential is absent from what the door serves,
 *    on the list read, the by-id read, a projection naming only the body, and a
 *    version snapshot; a grouping by the body column is refused before the
 *    engine is asked;
 *  - **preserved** — a body that holds nothing to withhold reaches the caller
 *    byte-for-byte (the stored string itself, never re-serialized), every
 *    other column is untouched, a projection gets exactly the columns it named,
 *    and every other object, and every other grouping, is served as before.
 *
 * Rows are seeded straight into a stub engine: the credentials under test are
 * legacy at-rest material (the write doors refuse most of these spellings), so
 * only a direct seed reproduces the population that matters.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertEngineFindOnePredicate, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { getMetadataTypeRedactor, registerMetadataTypeRedactor } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** Stored credential values — each must be absent from every served body. */
const SECRETS = [
    'stored-enc-key-value',
    'stored-inline-password',
    'stored-url-password',
    'stored-alias-token',
    'stored-nested-token',
] as const;

/** A legacy turso row: the still-writable key plus an alias spelling. */
const TURSO_BODY = {
    name: 'edge_cache',
    label: 'Edge Cache',
    driver: 'turso',
    config: {
        url: 'file:/var/data/edge.db',
        encryptionKey: 'stored-enc-key-value',
        authtoken: 'stored-alias-token',
    },
};

/** A legacy postgres row: inline password, URL userinfo password, nested spelling. */
const POSTGRES_BODY = {
    name: 'warehouse',
    label: 'Warehouse',
    driver: 'postgres',
    config: {
        url: 'postgresql://reporting:stored-url-password@db.internal:5432/warehouse',
        password: 'stored-inline-password',
        options: { deep: { authtoken: 'stored-nested-token' } },
        poolSize: 4,
    },
};

/** A datasource that stores nothing to withhold. */
const CLEAN_DATASOURCE_BODY = {
    name: 'local_sqlite',
    driver: 'sqlite',
    config: { url: 'file:/var/data/local.db' },
};

/** A type that registers no redactor; its body mentions a credential-shaped key on purpose. */
const VIEW_BODY = { name: 'all_tasks', label: 'All Tasks', type: 'grid', config: { password: 'not-a-credential' } };

/**
 * Stored strings are formatted (indented) on purpose: a body that is served
 * untouched must arrive as these exact bytes, which a parse-then-stringify
 * round trip would not reproduce.
 */
const stored = (body: unknown) => JSON.stringify(body, null, 2);

const SYS_METADATA_ROWS = [
    { id: 'm_turso', type: 'datasource', name: 'edge_cache', state: 'active', metadata: stored(TURSO_BODY) },
    { id: 'm_pg', type: 'datasource', name: 'warehouse', state: 'active', metadata: stored(POSTGRES_BODY) },
    { id: 'm_clean', type: 'datasource', name: 'local_sqlite', state: 'active', metadata: stored(CLEAN_DATASOURCE_BODY) },
    { id: 'm_view', type: 'view', name: 'all_tasks', state: 'active', metadata: stored(VIEW_BODY) },
];

const HISTORY_ROWS = [
    { id: 'h_pg_1', type: 'datasource', name: 'warehouse', version: 1, operation_type: 'create', metadata: stored(POSTGRES_BODY) },
    { id: 'h_view_1', type: 'view', name: 'all_tasks', version: 1, operation_type: 'create', metadata: stored(VIEW_BODY) },
];

/** An ordinary business object with a `metadata` column of its own. */
const NOTE_SCHEMA = {
    name: 'note',
    fields: {
        type: { name: 'type', type: 'text' },
        metadata: { name: 'metadata', type: 'textarea' },
    },
};
const NOTE_ROWS = [{ id: 'n_1', type: 'datasource', metadata: stored(POSTGRES_BODY) }];

const ROWS: Record<string, Record<string, unknown>[]> = {
    sys_metadata: SYS_METADATA_ROWS,
    sys_metadata_history: HISTORY_ROWS,
    note: NOTE_ROWS,
};
const SCHEMAS: Record<string, unknown> = {
    sys_metadata: SysMetadataObject,
    sys_metadata_history: SysMetadataHistoryObject,
    note: NOTE_SCHEMA,
};

function project(row: Record<string, unknown>, fields: unknown): Record<string, unknown> {
    if (!Array.isArray(fields)) return row;
    const out: Record<string, unknown> = { id: row.id };
    for (const f of fields as string[]) if (f in row) out[f] = row[f];
    return out;
}

/** Plain field equality only — a combinator or an operator value is refused, never misread. */
function matches(row: Record<string, unknown>, where: unknown): boolean {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where as Record<string, unknown>).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`stub engine: combinator '${k}' is not implemented`);
        if (v !== null && typeof v === 'object') throw new Error(`stub engine: operator value on '${k}' is not implemented`);
        return row[k] === v;
    });
}

function makeProtocol(rows: Record<string, Record<string, unknown>[]> = ROWS) {
    const find = vi.fn(async (object: string, opts: any) =>
        (rows[object] ?? []).filter((r) => matches(r, opts?.where)).map((r) => project(r, opts?.fields)));
    const findOne = vi.fn(async (object: string, opts: any) => {
        assertEngineFindOnePredicate(object, opts);
        const hit = (rows[object] ?? []).find((r) => matches(r, opts?.where));
        return hit ? project(hit, opts?.fields) : null;
    });
    const aggregate = vi.fn(async () => [{ type: 'datasource', n: 3 }]);
    const engine = {
        registry: { getObject: (n: string) => SCHEMAS[n] },
        find,
        findOne,
        count: vi.fn(async () => 0),
        aggregate,
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find, findOne, aggregate };
}

function expectNoSecret(served: unknown): void {
    const text = JSON.stringify(served);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
}

const byId = (records: any[], id: string) => records.find((r) => r.id === id);

describe('[#21086] findData — sys_metadata rows serve the read projection of their body', () => {
    it('withholds every stored credential spelling from the list read', async () => {
        const { p } = makeProtocol();
        const result: any = await p.findData({ object: 'sys_metadata', query: { type: 'datasource' } });

        expect(result.records).toHaveLength(3);
        expectNoSecret(result.records);

        const turso = JSON.parse(byId(result.records, 'm_turso').metadata);
        expect(turso.config).toEqual({ url: 'file:/var/data/edge.db' });

        const pg = JSON.parse(byId(result.records, 'm_pg').metadata);
        expect(pg.config).toEqual({
            url: 'postgresql://reporting@db.internal:5432/warehouse',
            options: { deep: {} },
            poolSize: 4,
        });
        // The served body is the one `/meta` serves: the same registry entry.
        expect(pg).toEqual(getMetadataTypeRedactor('datasource')!(POSTGRES_BODY).item);
    });

    it('preserves the other columns, and a body with nothing to withhold byte-for-byte', async () => {
        const { p } = makeProtocol();
        const result: any = await p.findData({ object: 'sys_metadata', query: {} });

        for (const row of SYS_METADATA_ROWS) {
            const served = byId(result.records, row.id);
            expect(served.type).toBe(row.type);
            expect(served.name).toBe(row.name);
            expect(served.state).toBe(row.state);
        }
        // Untouched bodies keep the stored bytes (the fixture is indented).
        expect(byId(result.records, 'm_clean').metadata).toBe(stored(CLEAN_DATASOURCE_BODY));
        expect(byId(result.records, 'm_view').metadata).toBe(stored(VIEW_BODY));
    });

    it('reads `type` for a projection naming only the body, and serves only the named columns', async () => {
        const { p, find } = makeProtocol();
        const result: any = await p.findData({ object: 'sys_metadata', query: { select: 'metadata' } });

        expect(find.mock.calls[0]![1].fields).toEqual(['metadata', 'type']);
        expectNoSecret(result.records);
        for (const served of result.records) {
            expect(Object.keys(served).sort()).toEqual(['id', 'metadata']);
        }
    });

    it('leaves a projection that names `type` itself, or no body, exactly as asked', async () => {
        const { p, find } = makeProtocol();
        const withType: any = await p.findData({ object: 'sys_metadata', query: { select: 'metadata,type' } });
        expect(find.mock.calls[0]![1].fields).toEqual(['metadata', 'type']);
        expectNoSecret(withType.records);
        expect(byId(withType.records, 'm_pg').type).toBe('datasource');

        const noBody: any = await p.findData({ object: 'sys_metadata', query: { select: 'name' } });
        expect(find.mock.calls[1]![1].fields).toEqual(['name']);
        expect(Object.keys(noBody.records[0]).sort()).toEqual(['id', 'name']);
    });

    it('serves a version snapshot (sys_metadata_history) the same projection', async () => {
        const { p } = makeProtocol();
        const result: any = await p.findData({ object: 'sys_metadata_history', query: {} });

        expectNoSecret(result.records);
        expect(JSON.parse(byId(result.records, 'h_pg_1').metadata).config.password).toBeUndefined();
        expect(byId(result.records, 'h_view_1').metadata).toBe(stored(VIEW_BODY));
    });

    it('does not touch an object outside the stored-metadata tables', async () => {
        const { p } = makeProtocol();
        const result: any = await p.findData({ object: 'note', query: {} });
        expect(result.records[0].metadata).toBe(stored(POSTGRES_BODY));
    });
});

describe('[#21086] getData — the by-id read serves the same projection', () => {
    it('withholds the stored credential from the record', async () => {
        const { p } = makeProtocol();
        const result: any = await p.getData({ object: 'sys_metadata', id: 'm_turso' });

        expectNoSecret(result.record);
        expect(JSON.parse(result.record.metadata).config).toEqual({ url: 'file:/var/data/edge.db' });
        expect(result.record.type).toBe('datasource');
    });

    it('reads `type` for `select=metadata`, and serves only the named columns', async () => {
        const { p, findOne } = makeProtocol();
        const result: any = await p.getData({ object: 'sys_metadata', id: 'm_pg', select: 'metadata' });

        expect(findOne.mock.calls[0]![1].fields).toEqual(['metadata', 'type']);
        expectNoSecret(result.record);
        expect(Object.keys(result.record).sort()).toEqual(['id', 'metadata']);
    });

    it('serves a body with nothing to withhold as stored', async () => {
        const { p } = makeProtocol();
        const result: any = await p.getData({ object: 'sys_metadata', id: 'm_view' });
        expect(result.record.metadata).toBe(stored(VIEW_BODY));
    });
});

describe('[#21086] grouping by the stored body column is refused before the engine runs', () => {
    for (const [label, groupBy, position] of [
        ['field-name form', ['metadata'], 'groupBy[0]'],
        ['object form', ['type', { field: 'metadata' }], 'groupBy[1].field'],
    ] as const) {
        it(`refuses the ${label} with INVALID_FIELD / 400`, async () => {
            const { p, aggregate } = makeProtocol();
            const err: any = await p.findData({
                object: 'sys_metadata',
                query: { groupBy, aggregations: [{ function: 'count', alias: 'n' }] },
            }).catch((e) => e);

            expect(err).toBeInstanceOf(Error);
            expect(err.code).toBe('INVALID_FIELD');
            expect(err.status).toBe(400);
            expect(err.param).toBe('groupBy');
            expect(err.field).toBe('metadata');
            expect(err.message).toContain(position);
            expect(aggregate).not.toHaveBeenCalled();
        });
    }

    it('refuses it on sys_metadata_history too', async () => {
        const { p, aggregate } = makeProtocol();
        const err: any = await p.findData({
            object: 'sys_metadata_history',
            query: { groupBy: ['metadata'], aggregations: [{ function: 'count', alias: 'n' }] },
        }).catch((e) => e);
        expect(err.code).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(aggregate).not.toHaveBeenCalled();
    });

    it('still serves a grouping by any other column, and the same grouping on another object', async () => {
        const { p, aggregate } = makeProtocol();
        const byType: any = await p.findData({
            object: 'sys_metadata',
            query: { groupBy: ['type'], aggregations: [{ function: 'count', alias: 'n' }] },
        });
        expect(byType.records).toEqual([{ type: 'datasource', n: 3 }]);

        await p.findData({
            object: 'note',
            query: { groupBy: ['metadata'], aggregations: [{ function: 'count', alias: 'n' }] },
        });
        expect(aggregate).toHaveBeenCalledTimes(2);
    });
});

describe('[#21086] fails closed on a body it cannot judge', () => {
    it('withholds a body whose row carries no `type`', async () => {
        const { p } = makeProtocol({ sys_metadata: [{ id: 'm_x', metadata: stored(POSTGRES_BODY) }] });
        const result: any = await p.findData({ object: 'sys_metadata', query: {} });
        expect(result.records[0]).toEqual({ id: 'm_x' });
    });

    it('withholds an unparseable body of a type that registers a redactor, and serves one of a type that does not', async () => {
        const { p } = makeProtocol({
            sys_metadata: [
                { id: 'm_bad_ds', type: 'datasource', metadata: '{"config":{"password":"stored-inline-password"' },
                { id: 'm_bad_view', type: 'view', metadata: '{"name":' },
            ],
        });
        const result: any = await p.findData({ object: 'sys_metadata', query: {} });
        expect(byId(result.records, 'm_bad_ds')).toEqual({ id: 'm_bad_ds', type: 'datasource' });
        expect(byId(result.records, 'm_bad_view').metadata).toBe('{"name":');
    });

    it('serves an already-parsed body in the shape it arrived in, redacted', async () => {
        const { p } = makeProtocol({ sys_metadata: [{ id: 'm_obj', type: 'datasource', metadata: POSTGRES_BODY }] });
        const result: any = await p.findData({ object: 'sys_metadata', query: {} });
        expectNoSecret(result.records);
        expect(typeof result.records[0].metadata).toBe('object');
        expect(result.records[0].metadata.config.poolSize).toBe(4);
    });
});

describe('[#21086] the door follows the redactor registry, not a datasource rule of its own', () => {
    const previous = getMetadataTypeRedactor('view');
    afterEach(() => {
        registerMetadataTypeRedactor('view', previous ?? ((item) => ({ item, redactedKeys: [] })));
    });

    it('applies whatever redactor the type registers', async () => {
        registerMetadataTypeRedactor('view', (item) => {
            const { config: _config, ...rest } = item;
            return { item: rest, redactedKeys: ['config.password'] };
        });
        const { p } = makeProtocol();
        const result: any = await p.findData({ object: 'sys_metadata', query: { type: 'view' } });
        expect(JSON.parse(result.records[0].metadata)).toEqual({ name: 'all_tasks', label: 'All Tasks', type: 'grid' });
    });
});
