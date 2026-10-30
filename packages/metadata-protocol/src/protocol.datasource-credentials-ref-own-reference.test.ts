// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27762] A `datasource` saved through the metadata door may name, in
 * `external.credentialsRef`, only the reference its own stored row already
 * holds. This is the own-reference rule #27582 set for the engine's secret
 * fields and #27722 applied to the datasource admin door's create: a
 * non-system write may only seal a new value or keep its own record's stored
 * reference. The metadata door seals nothing, so its one legal reference is
 * the one it keeps.
 *
 * Pinned at `saveMetaItem`, the one save the REST `PUT /api/v1/meta/:type/:name`
 * door and the runtime dispatcher's `/meta` door both call (`meta-envelope`,
 * `meta-dispatch`), and the in-process doors that write through it:
 *
 *  - refused, `VALIDATION_ERROR` / 400, before anything is written: a create
 *    naming any reference; an edit naming a reference other than the one its
 *    row holds, or naming one where its row holds none; a draft naming one the
 *    row it overlays does not hold. One answer whatever the reference names,
 *    and the reference is never echoed;
 *  - accepted: an edit or a draft that sends back its own stored reference
 *    (the GET → edit → PUT round trip), and a body that names none;
 *  - the server-stated rewrites (`source` set, the stored-metadata migration)
 *    keep their pass-through.
 *
 * Harness: the real write path over a stub engine, the shape of
 * `protocol.metadata-redaction.test.ts`; every row is seeded directly.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's own dispatch decisions, so the stub cannot accept a call ObjectQL refuses.
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch, hashSpec } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import type { MetadataWriteFace } from './protocol.js';

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
}

/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

const matches = (r: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => v === undefined || whereValueMatches((r as any)[k], v));

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

/** A stub engine over one `sys_metadata` map, logging every write it is asked for. */
function makeStubEngine() {
    const rows = new Map<string, Row>();
    const writes: string[] = [];
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            return findRow(opts.where)?.row ?? null;
        },
        async find(_table: string, opts: { where: Record<string, unknown>; limit?: number }) {
            const hits = Array.from(rows.values()).filter((r) => matches(r, opts.where));
            return typeof opts?.limit === 'number' ? hits.slice(0, opts.limit) : hits;
        },
        async insert(table: string, data: Record<string, unknown>) {
            writes.push(`insert ${table}`);
            if (table !== 'sys_metadata') return { id: 'side_table' };
            const row = { id: `r_${++nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            writes.push(`update ${table}`);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { /* no DDL in this stub */ },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            getItem: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, rows, writes };
}

/** A schema-valid datasource body, so every refusal below is this rule's and never a 422. */
const datasourceBody = (name: string, label: string, credentialsRef?: string) => ({
    name,
    label,
    driver: 'postgres',
    config: { host: 'db.internal', database: name, username: 'app' },
    ...(credentialsRef === undefined ? {} : { external: { credentialsRef } }),
});

/** The reference `ledger`'s own row holds. */
const OWN_REF = 'sys_secret:ledger_own_27762';
/** The reference another datasource's row (`vault`) holds. */
const OTHER_REF = 'sys_secret:vault_own_27762';
/** A reference no row holds. */
const UNHELD_REF = 'sys_secret:held_by_no_row_27762';

function seed(rows: Map<string, Row>, name: string, credentialsRef?: string) {
    const where = { type: 'datasource', name, organization_id: null, package_id: null, state: 'active' };
    const body = datasourceBody(name, name, credentialsRef);
    rows.set(keyOf(where), {
        id: `r_seed_${name}`,
        ...where,
        metadata: JSON.stringify(body),
        // A real row carries its own checksum, which the save's parent read compares.
        checksum: hashSpec(body),
        version: 1,
    });
}

/** `ledger` holds its own reference, `vault` another, `plain` none. */
function session() {
    const stub = makeStubEngine();
    seed(stub.rows, 'ledger', OWN_REF);
    seed(stub.rows, 'vault', OTHER_REF);
    seed(stub.rows, 'plain');
    return { ...stub, protocol: new ObjectStackProtocolImplementation(stub.engine) };
}

const rowOf = (rows: Map<string, Row>, name: string, state: 'active' | 'draft' = 'active') =>
    Array.from(rows.values()).find((r) => r.type === 'datasource' && r.name === name && r.state === state);

const storedRefOf = (rows: Map<string, Row>, name: string, state: 'active' | 'draft' = 'active') => {
    const row = rowOf(rows, name, state);
    return row ? JSON.parse(row.metadata).external?.credentialsRef : undefined;
};

/** The store as a comparable value, so "nothing was written" is a reading, not a claim. */
const snapshot = (rows: Map<string, Row>) => JSON.stringify(Array.from(rows.entries()).sort());

/** Runs a save expected to be refused; returns the refusal after asserting nothing was written. */
async function refused(
    s: ReturnType<typeof session>,
    request: Parameters<ObjectStackProtocolImplementation['saveMetaItem']>[0],
): Promise<{ code: unknown; status: unknown; message: string }> {
    const before = snapshot(s.rows);
    const writesBefore = s.writes.length;
    let caught: any;
    try {
        await s.protocol.saveMetaItem(request);
    } catch (err) {
        caught = err;
    }
    expect(caught, 'the save was accepted').toBeDefined();
    expect(snapshot(s.rows)).toBe(before);
    expect(s.writes.slice(writesBefore)).toEqual([]);
    return { code: caught.code, status: caught.status, message: String(caught.message) };
}

const expectRuleRefusal = (r: { code: unknown; status: unknown; message: string }) => {
    expect({ code: r.code, status: r.status }, r.message).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
    for (const ref of [OWN_REF, OTHER_REF, UNHELD_REF]) expect(r.message).not.toContain(ref);
};

describe('[#27762] datasource `external.credentialsRef`: a non-system save may only keep its own stored reference', () => {
    describe('refused before anything is written, with one answer whatever the reference names', () => {
        it('a create naming a reference another datasource holds, and one naming a reference no row holds', async () => {
            const s = session();
            const other = await refused(s, { type: 'datasource', name: 'fresh', item: datasourceBody('fresh', 'Fresh', OTHER_REF) });
            const unheld = await refused(s, { type: 'datasource', name: 'fresh', item: datasourceBody('fresh', 'Fresh', UNHELD_REF) });
            expectRuleRefusal(other);
            expect(unheld).toEqual(other);
            expect(rowOf(s.rows, 'fresh')).toBeUndefined();
        });

        it('an edit naming a reference other than the one its own row holds', async () => {
            const s = session();
            const other = await refused(s, { type: 'datasource', name: 'ledger', item: datasourceBody('ledger', 'Ledger', OTHER_REF) });
            const unheld = await refused(s, { type: 'datasource', name: 'ledger', item: datasourceBody('ledger', 'Ledger', UNHELD_REF) });
            expectRuleRefusal(other);
            expect(unheld).toEqual(other);
            expect(storedRefOf(s.rows, 'ledger')).toBe(OWN_REF);
        });

        it('an edit naming a reference where its own row holds none', async () => {
            const s = session();
            expectRuleRefusal(await refused(s, { type: 'datasource', name: 'plain', item: datasourceBody('plain', 'Plain', OTHER_REF) }));
            expect(storedRefOf(s.rows, 'plain')).toBeUndefined();
        });

        it('a draft naming a reference the active row it overlays does not hold', async () => {
            const s = session();
            expectRuleRefusal(await refused(s, {
                type: 'datasource', name: 'ledger', mode: 'draft', item: datasourceBody('ledger', 'Ledger', OTHER_REF),
            }));
            expect(rowOf(s.rows, 'ledger', 'draft')).toBeUndefined();
        });

        it('a reference with the plural type spelling is judged the same', async () => {
            const s = session();
            expectRuleRefusal(await refused(s, { type: 'datasources', name: 'fresh', item: datasourceBody('fresh', 'Fresh', OTHER_REF) }));
        });

        const faces: Array<{ face: string; extra: { writeFace?: MetadataWriteFace; surface?: 'mcp' | 'studio' } }> = [
            { face: 'the REST `PUT` door (`meta-envelope`)', extra: { writeFace: 'meta-envelope' } },
            { face: 'the runtime dispatcher\'s `/meta` door (`meta-dispatch`)', extra: { writeFace: 'meta-dispatch' } },
            { face: 'the package copy (`package-duplicate`)', extra: { writeFace: 'package-duplicate' } },
            { face: 'the unmanaged import (`package-unmanaged-import`)', extra: { writeFace: 'package-unmanaged-import' } },
            { face: 'an MCP save', extra: { surface: 'mcp' } },
        ];
        for (const { face, extra } of faces) {
            it(`on ${face}`, async () => {
                const s = session();
                expectRuleRefusal(await refused(s, {
                    type: 'datasource', name: 'fresh', item: datasourceBody('fresh', 'Fresh', OTHER_REF), ...extra,
                }));
            });
        }
    });

    describe('accepted', () => {
        it('an edit that sends back its own stored reference (the GET → edit → PUT round trip) keeps it', async () => {
            const s = session();
            const served: any = (await s.protocol.getMetaItem({ type: 'datasource', name: 'ledger' })).item;
            expect(served.external?.credentialsRef).toBe(OWN_REF);
            await s.protocol.saveMetaItem({ type: 'datasource', name: 'ledger', item: { ...served, label: 'Ledger (edited)' } });
            expect(JSON.parse(rowOf(s.rows, 'ledger')!.metadata).label).toBe('Ledger (edited)');
            expect(storedRefOf(s.rows, 'ledger')).toBe(OWN_REF);
        });

        it('a first draft that sends back the reference the active row holds keeps it on the draft', async () => {
            const s = session();
            await s.protocol.saveMetaItem({
                type: 'datasource', name: 'ledger', mode: 'draft', item: datasourceBody('ledger', 'Ledger (draft)', OWN_REF),
            });
            expect(storedRefOf(s.rows, 'ledger', 'draft')).toBe(OWN_REF);
        });

        it('a body that names no reference saves as before', async () => {
            const s = session();
            await s.protocol.saveMetaItem({ type: 'datasource', name: 'fresh', item: datasourceBody('fresh', 'Fresh') });
            expect(rowOf(s.rows, 'fresh')).toBeDefined();
            expect(storedRefOf(s.rows, 'fresh')).toBeUndefined();
        });

        it('a server-stated rewrite (`source: \'migrate-stored\'`) keeps its pass-through', async () => {
            const s = session();
            await s.protocol.saveMetaItem({
                type: 'datasource', name: 'plain', item: datasourceBody('plain', 'Plain', OTHER_REF), source: 'migrate-stored',
            });
            expect(storedRefOf(s.rows, 'plain')).toBe(OTHER_REF);
        });
    });
});
