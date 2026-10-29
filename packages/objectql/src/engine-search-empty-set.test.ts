// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24284] A non-blank `search` over an object whose RESOLVED search set is
 * empty is refused — `400 INVALID_FIELD`, on every verb that reaches
 * `expandSearchOnAst` — instead of answering every row.
 *
 * The shape is the junction object: two lookups and a composed formula title.
 * The auto-default scans textual and enum types only, so it resolves no field,
 * `expandSearchToFilter` answers `null`, and before this refusal the term was
 * dropped with `where` untouched: `search: 'zzzz-nothing'` and `search: 'Dune'`
 * returned the same five rows, read by a user as "everything matched".
 *
 * What stays as it was, pinned beside the refusal so a fix that over-reaches
 * goes red here too: a blank term is not a search; a control object with a
 * stored text field still filters; an explicit override intersected to nothing
 * on an object WITH a searchable set falls back to that set (filtered, never
 * every row).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

type Search = EngineQueryOptions['search'];

type Row = Record<string, unknown>;

const LOANS: Row[] = [
    { id: 'l1', book: 'b1', reader: 'r1' },
    { id: 'l2', book: 'b2', reader: 'r1' },
    { id: 'l3', book: 'b3', reader: 'r1' },
    { id: 'l4', book: 'b1', reader: 'r1' },
    { id: 'l5', book: 'b2', reader: 'r1' },
];
const BOOKS: Row[] = [
    { id: 'b1', title: 'Dune' },
    { id: 'b2', title: 'Emma' },
    { id: 'b3', title: 'Ulysses' },
];

function matches(row: Row, where: unknown): boolean {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Row)) {
        if (k === '$and') { if (!(v as unknown[]).every((w) => matches(row, w))) return false; continue; }
        if (k === '$or') { if (!(v as unknown[]).some((w) => matches(row, w))) return false; continue; }
        const op = v as Row;
        if (op && typeof op === 'object' && '$icontains' in op) {
            if (!String(row[k] ?? '').toLowerCase().includes(String(op.$icontains).toLowerCase())) return false;
            continue;
        }
        if (row[k] !== v) return false;
    }
    return true;
}

function makeDriver() {
    const reads: Array<{ object: string; via: string }> = [];
    const tables: Record<string, Row[]> = { lib_loan: LOANS, lib_book: BOOKS, lib_token: [{ id: 't1', digest: 'abc' }] };
    const read = (object: string, ast: any) => {
        const rows = (tables[object] ?? []).filter((r) => matches(r, ast?.where));
        return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    };
    const driver: any = {
        name: 'mem', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(object: string, ast: any) { reads.push({ object, via: 'find' }); return read(object, ast).map((r) => ({ ...r })); },
        async findOne(object: string, ast: any) { reads.push({ object, via: 'findOne' }); return read(object, ast)[0] ?? null; },
        async count(object: string, ast: any) { reads.push({ object, via: 'count' }); return read(object, ast).length; },
        async create(_o: string, d: any) { return d; },
        async update(_o: string, _id: string, d: any) { return d; },
        async delete() { return true; },
        async bulkCreate(_o: string, r: any[]) { return r; },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, reads };
}

const REFUSAL = {
    code: 'INVALID_FIELD',
    status: 400,
    object: 'lib_loan',
    param: 'search',
};

describe('[#24284] a search over an empty resolved search set is refused', () => {
    let engine: ObjectQL;
    let reads: ReturnType<typeof makeDriver>['reads'];

    beforeEach(async () => {
        const made = makeDriver();
        reads = made.reads;
        engine = new ObjectQL();
        engine.registerDriver(made.driver, true);
        await engine.init();
        const registry = engine.registry as any;
        registry.registerObject({ name: 'lib_book', fields: { title: { type: 'text' } } }, 'test');
        registry.registerObject({
            name: 'lib_loan',
            nameField: 'title',
            fields: {
                book: { type: 'lookup', reference: 'lib_book' },
                reader: { type: 'lookup', reference: 'lib_reader' },
                title: { type: 'formula', expression: "record.book.title + ' · ' + record.reader.name" },
            },
        }, 'test');
        // A textual column that is `internal: true` — excluded from the scan,
        // so the resolved set is empty for the same reason by another road.
        registry.registerObject({
            name: 'lib_token',
            fields: { digest: { type: 'text', internal: true } },
        }, 'test');
    });

    const verbs: Array<[string, (e: ObjectQL, search: Search) => Promise<unknown>]> = [
        ['find', (e, search) => e.find('lib_loan', { search })],
        ['findOne', (e, search) => e.findOne('lib_loan', { search })],
        ['count', (e, search) => e.count('lib_loan', { search })],
        ['aggregate', (e, search) => e.aggregate('lib_loan', {
            search, groupBy: ['book'], aggregations: [{ function: 'count', alias: 'n' }],
        })],
    ];

    it.each(verbs)('%s answers 400 INVALID_FIELD naming the object and both remedies — and reads nothing', async (_verb, run) => {
        for (const term of ['zzzz-nothing', 'Dune', { query: 'Dune' }] as Search[]) {
            const err: any = await run(engine, term).then(() => null, (e) => e);
            expect(err, `term ${JSON.stringify(term)} was answered`).not.toBeNull();
            expect(err).toMatchObject(REFUSAL);
            expect(String(err.message)).toMatch(/^Object 'lib_loan' has no searchable field, so 'search' cannot be honoured on it/);
            expect(String(err.message)).toContain("it declares no 'searchableFields'");
            expect(String(err.message)).toContain("Declare 'searchableFields' on 'lib_loan' naming a stored field");
            expect(String(err.message)).toContain('mirror the composed title onto a stored text field');
        }
        expect(reads.filter((r) => r.object === 'lib_loan')).toEqual([]);
    });

    it('an explicit searchFields narrowing does not rescue it — the allowed set is empty, so the fallback is too', async () => {
        for (const searchFields of [['title'], ['book'], ['nope'], []]) {
            const err: any = await engine.find('lib_loan', { search: 'Dune', searchFields }).then(() => null, (e) => e);
            expect(err, `searchFields ${JSON.stringify(searchFields)}`).toMatchObject(REFUSAL);
        }
    });

    it('a declaration naming only unscannable entries names them in the refusal', async () => {
        (engine.registry as any).registerObject({
            name: 'lib_loan',
            searchableFields: ['title', 'gone'],
            fields: {
                book: { type: 'lookup', reference: 'lib_book' },
                title: { type: 'formula', expression: 'record.book.title' },
            },
        }, 'test');
        const err: any = await engine.find('lib_loan', { search: 'Dune' }).then(() => null, (e) => e);
        expect(err).toMatchObject(REFUSAL);
        expect(String(err.message)).toContain("its 'searchableFields' (title, gone) names no stored field");
    });

    it('an object whose only text column is internal: true is refused the same way, saying why', async () => {
        const err: any = await engine.find('lib_token', { search: 'abc' }).then(() => null, (e) => e);
        expect(err).toMatchObject({ ...REFUSAL, object: 'lib_token' });
        expect(String(err.message)).toContain("('internal: true' fields are never searched)");
        expect(reads.filter((r) => r.object === 'lib_token')).toEqual([]);
    });

    it('a blank or whitespace term is not a search: every row, where untouched, on every verb', async () => {
        for (const search of ['', '   ', { query: '  ' }] as Search[]) {
            expect(await engine.find('lib_loan', { search })).toHaveLength(5);
            expect(await engine.count('lib_loan', { search })).toBe(5);
            expect(await engine.find('lib_loan', { search, where: { book: 'b1' } })).toHaveLength(2);
        }
    });

    it('control: an object with a stored text field still filters, and an override intersected to nothing falls back to its set', async () => {
        expect((await engine.find('lib_book', { search: 'Dune' })).map((r) => r.id)).toEqual(['b1']);
        expect(await engine.find('lib_book', { search: 'zzzz-nothing' })).toEqual([]);
        expect(await engine.count('lib_book', { search: 'zzzz-nothing' })).toBe(0);
        // A direct engine caller naming only fields outside the allowed set: the
        // tolerant intersection falls back to the allowed set — a FILTERED
        // answer, never every row.
        expect((await engine.find('lib_book', { search: 'emma', searchFields: ['nope'] })).map((r) => r.id)).toEqual(['b2']);
    });
});

/**
 * The internal producers and the data door, over a real engine: `searchAll`
 * (the ⌘K palette) hands `search` to objects it did not choose, so it must
 * keep skipping an object with nothing to scan BEFORE it queries — a refusal
 * there would fail the whole sweep. `findData` (the REST list / query door)
 * surfaces the refusal as the read's own answer.
 */
describe('[#24284] the palette keeps its skip; the data door surfaces the refusal', () => {
    async function makeHarness() {
        const made = makeDriver();
        const engine = new ObjectQL();
        engine.registerDriver(made.driver, true);
        await engine.init();
        const registry = engine.registry as any;
        registry.registerObject({ name: 'lib_book', fields: { title: { type: 'text' } } }, 'test');
        registry.registerObject({
            name: 'lib_loan',
            nameField: 'title',
            fields: {
                book: { type: 'lookup', reference: 'lib_book' },
                reader: { type: 'lookup', reference: 'lib_reader' },
                title: { type: 'formula', expression: "record.book.title + ' · ' + record.reader.name" },
            },
        }, 'test');
        registry.registerObject({ name: 'lib_token', fields: { digest: { type: 'text', internal: true } } }, 'test');
        const protocol = new ObjectStackProtocolImplementation(engine as never);
        return { protocol, reads: made.reads };
    }

    it('searchAll answers the other objects\' hits, and leaves the junction and the internal-only object out of objectsScanned', async () => {
        const { protocol, reads } = await makeHarness();
        const objects = ['lib_book', 'lib_loan', 'lib_token'];
        const res: any = await protocol.searchAll({ q: 'Dune', objects, perObject: 5, limit: 25 });
        expect(res.hits.map((h: any) => [h.object, h.id])).toEqual([['lib_book', 'b1']]);
        expect(res.totalObjects).toBe(1);
        expect(reads.filter((r) => r.object !== 'lib_book')).toEqual([]);
        const none: any = await protocol.searchAll({ q: 'Dune', objects: ['lib_loan', 'lib_token'], perObject: 5, limit: 25 });
        expect(none).toMatchObject({ hits: [], totalObjects: 0, totalHits: 0 });
    });

    it('findData over the junction answers the refusal, on the list and the query shapes', async () => {
        const { protocol, reads } = await makeHarness();
        for (const query of [{ search: 'zzzz-nothing' }, { search: { query: 'Dune' } }]) {
            const err: any = await (protocol as any).findData({ object: 'lib_loan', query }).then(() => null, (e: any) => e);
            expect(err, JSON.stringify(query)).toMatchObject(REFUSAL);
        }
        // [#27484] Flipped on purpose (triage ruling 6500648325, option A): a
        // blank override no longer reaches the engine as "absent", so the door
        // refuses it first, in the projection's envelope. The point of this
        // leg holds: a search over the junction never silently widens to every
        // row; no `lib_loan` read is made on either refusal.
        const blankOverride: any = await (protocol as any).findData({
            object: 'lib_loan', query: { search: 'Dune', searchFields: '' },
        }).then(() => null, (e: any) => e);
        expect(blankOverride).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param: 'searchFields' });
        expect(reads.filter((r) => r.object === 'lib_loan')).toEqual([]);
        // …and the control object and the blank term are untouched.
        const book: any = await (protocol as any).findData({ object: 'lib_book', query: { search: 'Dune' } });
        expect(book.records.map((r: any) => r.id)).toEqual(['b1']);
        const blank: any = await (protocol as any).findData({ object: 'lib_loan', query: { search: '' } });
        expect(blank.records).toHaveLength(5);
    });
});
