// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4226 — the REST list path has FOUR axes on which a caller names a field, and
 * only one of them used to answer when the name was wrong.
 *
 * `filter` was closed over four issues (#4134 / #4164 / #4181 / #4121): a bad
 * filter is now a 400, never a 200 over the wrong rows. The same machine went
 * on leaking on the other three — `sort`, `select` and `expand` pointed at a
 * field that does not exist were silently not applied, and answered `200`:
 *
 * ```
 * sort=no_such_field   -> 200  CAEBD          byte-identical to "no sort at all"
 * select=no_such_field -> 200  <every field>   asked for one column, got all of them
 * expand=no_such_rel   -> 200  <no such key>   no relation, no complaint
 * ```
 *
 * Each fails differently and each is now refused:
 *
 * - **sort** — the row SET is unchanged, so this is not #4181's "returned
 *   everything". It is worse in one specific way: `sort` + `top` IS how a
 *   caller asks for "the latest N", so a dropped sort silently hands back an
 *   ARBITRARY N. `400 INVALID_SORT` — the standard-catalog code that had no
 *   emitter until now.
 * - **select** — `engine.find()` drops unknown columns (deliberate `SELECT *`
 *   tolerance) and then falls back to `*` when that empties the projection, so
 *   `?select=<typo>` asked for ONE column and received EVERY column. A
 *   parameter whose whole purpose is to return less failed by returning more.
 *   `400 INVALID_FIELD`.
 * - **expand** — lightest: same rows, same columns, the relation just is not
 *   there. But the response cannot be told apart from "every foreign key is
 *   null", and the client renders raw ids where names belong.
 *   `400 INVALID_FIELD`.
 *
 * Every axis here carries a CONTROL: a real field that demonstrably works. A
 * conformance test that only asserts rejections passes just as happily when the
 * feature is broken outright, and pins nothing.
 *
 * Driven against a REAL {@link ObjectQL} engine — not an engine double —
 * because the authority these gates consult is the REGISTRY's field map, which
 * is not what the author declared (`applySystemFields` injects the audit /
 * tenant / owner columns at registration), and because expansion is engine
 * work: only the real one can show `$expand` resolving a `tree` field.
 *
 * #4254 extends the same machine to the three axes #4226 explicitly left out —
 * `searchFields`, `groupBy` and `aggregations` — in the second describe block
 * below. Same ingress, same tiering, same control-group discipline; the new
 * failure modes are worse only in WHAT they corrupt (`searchFields` changes
 * the row SET, `groupBy` collapses N groups into one, `sum(<typo>)` answers a
 * 0 no report can tell from a real one).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

const projectObject = {
    name: 'showcase_project',
    label: 'Project',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        name: { name: 'name', label: 'Name', type: 'text' as const },
    },
};

const taskObject = {
    name: 'showcase_task',
    label: 'Task',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' as const, required: true },
        status: { name: 'status', label: 'Status', type: 'text' as const },
        project_id: { name: 'project_id', label: 'Project', type: 'lookup' as const, reference: 'showcase_project' },
        parent_id: { name: 'parent_id', label: 'Parent', type: 'tree' as const, reference: 'showcase_task' },
        // [#4254] A searchable long-text column and a NON-searchable numeric
        // one: `notes` is what `searchFields=notes` legitimately narrows to,
        // `estimate` is what `sum()` legitimately totals — and what the search
        // auto-default excludes by TYPE, which is its own rejection.
        notes: { name: 'notes', label: 'Notes', type: 'textarea' as const },
        estimate: { name: 'estimate', label: 'Estimate', type: 'number' as const },
    },
};

/**
 * A stub driver that really sorts, really projects and really paginates.
 *
 * This matters more than usual here: a driver that ignored `orderBy` would make
 * every "a real sort field works" control vacuously true, and the pins above it
 * would then pass against a completely broken sort axis.
 */
function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((arm) => matchesWhere(row, arm))) return false;
                continue;
            }
            // [#4254] `$or` + `$contains` are the shape the engine expands
            // `search` into (an `$or` of case-insensitive `$contains`, ADR-0061).
            // Without them the driver would MATCH EVERY ROW for any search, and
            // the "searchFields really narrows the row set" controls below would
            // hold vacuously against a search that never filtered anything.
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((arm) => matchesWhere(row, arm))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            if (v && typeof v === 'object' && '$in' in (v as any)) {
                if (!(v as any).$in.map(String).includes(String(row[k]))) return false;
                continue;
            }
            if (v && typeof v === 'object' && '$contains' in (v as any)) {
                const haystack = String(row[k] ?? '').toLowerCase();
                if (!haystack.includes(String((v as any).$contains).toLowerCase())) return false;
                continue;
            }
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = row[k] === undefined ? null : row[k];
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const applySort = (rows: Record<string, unknown>[], orderBy: any): Record<string, unknown>[] => {
        // Mirrors every real driver: an `orderBy` that is not a SortNode array
        // produces NO ordering. That is the shape of the bug the sort axis had —
        // reproduced faithfully here so the normalizer is what has to fix it.
        if (!Array.isArray(orderBy) || orderBy.length === 0) return rows;
        return [...rows].sort((x, y) => {
            for (const node of orderBy) {
                if (!node?.field) continue;
                const a = x[node.field];
                const b = y[node.field];
                if (a === b) continue;
                const cmp = String(a) < String(b) ? -1 : 1;
                return node.order === 'desc' ? -cmp : cmp;
            }
            return 0;
        });
    };
    const project = (rows: Record<string, unknown>[], fields: any): Record<string, unknown>[] => {
        if (!Array.isArray(fields) || fields.length === 0) return rows;
        return rows.map((r) => Object.fromEntries(fields.map((f: string) => [f, r[f]])));
    };
    const driver: any = {
        name: 'memory',
        version: '0.0.0',
        supports: {} as any,
        async connect() {},
        async disconnect() {},
        async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const matched = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            const sorted = applySort(matched, ast?.orderBy);
            const from = typeof ast?.offset === 'number' ? ast.offset : 0;
            const page = typeof ast?.limit === 'number' ? sorted.slice(from, from + ast.limit) : sorted.slice(from);
            return project(page, ast?.fields);
        },
        async findOne(object: string, ast: any) {
            const rows = await this.find(object, ast);
            return rows[0] ?? null;
        },
        async create(object: string, data: Record<string, unknown>) {
            const id = String(data.id);
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const updated = { ...(s.get(id) ?? {}), ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) { return this.create(object, data); },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) {
            return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where)).length;
        },
        async aggregate(object: string, ast: any) { return [{ count: await this.count(object, ast) }]; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; },
        async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {},
        async rollback() {},
    };
    return { driver, stores };
}

describe('#4226 — sort / select / expand on the list path (real ObjectQL engine)', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;
    let stores: Map<string, Map<string, Record<string, unknown>>>;

    /** The issue's transcript order: five rows inserted `C A E B D`. */
    const INSERTION_ORDER = ['C', 'A', 'E', 'B', 'D'];

    const titles = (r: any): string[] => r.records.map((x: any) => x.title);

    beforeEach(async () => {
        engine = new ObjectQL();
        const made = makeStubDriver();
        const driver = made.driver;
        stores = made.stores;
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(projectObject, 'test-package');
        engine.registry.registerObject(taskObject, 'test-package');
        protocol = new ObjectStackProtocolImplementation(engine);

        stores.set('showcase_project', new Map([
            ['p1', { id: 'p1', name: 'Apollo' }],
        ]));
        const tasks = new Map<string, Record<string, unknown>>();
        INSERTION_ORDER.forEach((letter, i) => {
            tasks.set(`t_${letter}`, {
                id: `t_${letter}`,
                title: letter,
                status: i === 0 ? 'done' : 'open',
                project_id: 'p1',
                parent_id: letter === 'A' ? null : 't_A',
                owner_id: 'usr_1',
                created_at: '2026-07-30T00:00:00.000Z',
            });
        });
        stores.set('showcase_task', tasks);
    });

    it('baseline — no sort returns the rows in insertion order', async () => {
        const r: any = await protocol.findData({ object: 'showcase_task' });
        expect(titles(r)).toEqual(INSERTION_ORDER);
    });

    // ─────────────────────────────────────────────────────────────
    // SORT — control group
    // ─────────────────────────────────────────────────────────────

    it('a real field sorts, in both directions', async () => {
        await expect(protocol.findData({ object: 'showcase_task', query: { sort: 'title' } }))
            .resolves.toMatchObject({ records: expect.any(Array) });
        expect(titles(await protocol.findData({ object: 'showcase_task', query: { sort: 'title' } })))
            .toEqual(['A', 'B', 'C', 'D', 'E']);
        expect(titles(await protocol.findData({ object: 'showcase_task', query: { sort: '-title' } })))
            .toEqual(['E', 'D', 'C', 'B', 'A']);
        expect(titles(await protocol.findData({ object: 'showcase_task', query: { sort: 'title desc' } })))
            .toEqual(['E', 'D', 'C', 'B', 'A']);
    });

    it('EVERY wire spelling of a sort reaches the driver, not just the two that used to', async () => {
        // `string[]` is the client SDK's own declared type
        // (`orderBy?: string | string[] | SortNode[]`) and `{field: direction}`
        // is what `GET /data/:object/export`, `GET /data/import/jobs` and
        // objectui's calendar all emit. Both fell through the normalizer
        // untouched and were then declined by every driver's
        // `Array.isArray(orderBy)` guard: no ORDER BY clause, no error.
        for (const query of [
            { sort: '-title' },
            { orderBy: ['-title'] },
            { orderBy: [{ field: 'title', order: 'desc' }] },
            { orderBy: { title: 'desc' } },
            { $orderby: { title: 'desc' } },
            { orderBy: { field: 'title', order: 'desc' } },
        ]) {
            const r: any = await protocol.findData({ object: 'showcase_task', query });
            expect(titles(r), `spelling ${JSON.stringify(query)}`).toEqual(['E', 'D', 'C', 'B', 'A']);
        }
    });

    // ─────────────────────────────────────────────────────────────
    // SORT — rejected
    // ─────────────────────────────────────────────────────────────

    it.each([
        ['bare string', { sort: 'no_such_field' }],
        ['descending', { sort: '-no_such_field' }],
        ['second of two', { sort: 'title,no_such_field' }],
        ['string array', { orderBy: ['no_such_field'] }],
        ['SortNode array', { orderBy: [{ field: 'no_such_field', order: 'desc' }] }],
        ['direction map', { orderBy: { no_such_field: 'desc' } }],
        ['OData spelling', { $orderby: 'no_such_field' }],
    ])('sorting by an unknown field is a 400, not insertion order — %s', async (_label, query) => {
        await expect(protocol.findData({ object: 'showcase_task', query }))
            .rejects.toMatchObject({
                status: 400,
                code: 'INVALID_SORT',
                field: 'no_such_field',
                object: 'showcase_task',
            });
    });

    it('garbage that parses to a field name is refused on the same terms', async () => {
        // The issue's `sort={oops`: it reads as a field called `{oops`, matches
        // nothing in the field map, and used to produce exactly the insertion
        // order an unsorted query returns.
        await expect(protocol.findData({ object: 'showcase_task', query: { sort: '{oops' } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_SORT' });
    });

    it.each([
        ['a number', { sort: 42 }],
        ['a boolean', { orderBy: true }],
        ['an entry naming no field', { orderBy: [{ order: 'desc' }] }],
        ['an unreadable direction', { orderBy: [{ field: 'title', order: 'sideways' }] }],
        ['an unreadable direction in the map form', { orderBy: { title: 'sideways' } }],
    ])('a sort the normalizer cannot read is refused rather than dropped — %s', async (_label, query) => {
        await expect(protocol.findData({ object: 'showcase_task', query }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_SORT' });
    });

    /**
     * [#4721] The one unknown KEY on this axis, against the real engine.
     *
     * Every rejection above is about a bad VALUE — a field that does not exist,
     * a direction that is not asc/desc. `{ field, direction }` is well-formed on
     * both counts and was therefore accepted, with the foreign key stripped and
     * `order` left on its `asc` default: a DESCENDING request answered
     * ascending, 200, no signal. Paired with `top` that is not a reordered page
     * but a different set of rows — the "latest N" footgun below, reached
     * through a spelling rather than a typo.
     *
     * `direction` is `IReportService.orderBy`'s live vocabulary, which
     * `plugin-auth/objectql-adapter.ts` already translates by hand; the schema
     * half of this door (`SortNodeSchema`'s `aliases: { direction: 'order' }`)
     * landed in the same change.
     */
    it('sorting with `direction` instead of `order` is a 400, not a silently ASCENDING page', async () => {
        // The control first: this is what the caller meant, and it works.
        expect(titles(await protocol.findData({
            object: 'showcase_task', query: { orderBy: [{ field: 'title', order: 'desc' }], top: 2 },
        }))).toEqual(['E', 'D']);

        // Same request, foreign spelling. Pre-#4721 this resolved to ['A','B'] —
        // the opposite end of the table, under an ordinary success.
        await expect(protocol.findData({
            object: 'showcase_task', query: { orderBy: [{ field: 'title', direction: 'desc' }], top: 2 },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_SORT', field: 'title' });

        // And the rejection hands over the translation — `direction` → `order`
        // is not reachable by edit distance, so a bare refusal would leave the
        // caller exactly where the silent strip did.
        await expect(protocol.findData({
            object: 'showcase_task', query: { orderBy: [{ field: 'title', direction: 'desc' }] },
        })).rejects.toThrow(/order: 'desc'/);
    });

    it('an unapplied sort can no longer hide behind `top` — the "latest N" footgun', async () => {
        // This pairing is the whole reason the sort axis matters. Pre-fix it
        // answered 200 with an arbitrary 2 of 5 rows and no way to tell.
        expect(titles(await protocol.findData({
            object: 'showcase_task', query: { sort: '-title', top: 2 },
        }))).toEqual(['E', 'D']);
        await expect(protocol.findData({
            object: 'showcase_task', query: { sort: '-no_such_field', top: 2 },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_SORT' });
    });

    it('the rejection says which field and how to spell the direction', async () => {
        await expect(protocol.findData({ object: 'showcase_task', query: { sort: 'stauts' } }))
            .rejects.toThrow(/Did you mean the field 'status'/);
        // `field:direction` is the EXPORT route's spelling. A caller moving
        // between the two routes gets the list route's syntax, not a bare
        // "no such field 'title:desc'".
        await expect(protocol.findData({ object: 'showcase_task', query: { sort: 'title:desc' } }))
            .rejects.toThrow(/sort=title desc/);
    });

    it('the rejection quotes the parameter the caller actually wrote', async () => {
        // A caller who sent `?$orderby=…` must not be told that 'orderBy' —
        // a name absent from their request — is the problem.
        for (const [query, param] of [
            [{ sort: 'no_such_field' }, 'sort'],
            [{ orderBy: 'no_such_field' }, 'orderBy'],
            [{ $orderby: 'no_such_field' }, '$orderby'],
        ] as const) {
            await expect(protocol.findData({ object: 'showcase_task', query }))
                .rejects.toMatchObject({ param });
        }
        for (const [query, param] of [
            [{ select: 'no_such_field' }, 'select'],
            [{ fields: 'no_such_field' }, 'fields'],
            [{ $select: 'no_such_field' }, '$select'],
        ] as const) {
            await expect(protocol.findData({ object: 'showcase_task', query }))
                .rejects.toMatchObject({ param });
        }
    });

    it('an empty sort is ABSENT, not malformed', async () => {
        for (const query of [{ sort: '' }, { orderBy: [] }, { orderBy: {} }, { orderBy: null }]) {
            expect(titles(await protocol.findData({ object: 'showcase_task', query })))
                .toEqual(INSERTION_ORDER);
        }
    });

    it('a null orderBy alongside a real sort does not shadow it', async () => {
        // `options.orderBy ?? options.sort` picks `sort` here, so the rejection
        // (and the applied sort) must be attributed to `sort` too.
        expect(titles(await protocol.findData({
            object: 'showcase_task', query: { orderBy: null, sort: '-title' },
        }))).toEqual(['E', 'D', 'C', 'B', 'A']);
        await expect(protocol.findData({
            object: 'showcase_task', query: { orderBy: null, sort: 'no_such_field' },
        })).rejects.toMatchObject({ code: 'INVALID_SORT', param: 'sort' });
    });

    // ─────────────────────────────────────────────────────────────
    // SORT — dotted paths (#4256)
    // ─────────────────────────────────────────────────────────────

    it('the foreign-key column itself still sorts — the gate is about the dot, not the relationship', async () => {
        await expect(protocol.findData({ object: 'showcase_task', query: { sort: 'project_id' } }))
            .resolves.toMatchObject({ records: expect.any(Array) });
        await expect(protocol.findData({ object: 'showcase_task', query: { sort: '-parent_id' } }))
            .resolves.toMatchObject({ records: expect.any(Array) });
    });

    it.each([
        ['bare string', { sort: 'project_id.name' }],
        ['descending', { sort: '-project_id.name' }],
        ['second of two', { sort: 'title,project_id.name' }],
        ['string array', { orderBy: ['project_id.name'] }],
        ['SortNode array', { orderBy: [{ field: 'project_id.name', order: 'desc' }] }],
        ['direction map', { orderBy: { 'project_id.name': 'desc' } }],
        ['OData spelling', { $orderby: 'project_id.name' }],
    ])('a dotted path into a related object is a 400, not insertion order — %s', async (_label, query) => {
        // The head segment (`project_id`) is a real field, which is exactly
        // what carried this shape past the #4226 gate while no driver could
        // then order by it: SQL renders `"project_id"."name"` against a table
        // that was never joined and the #3821 backstop retries WITHOUT the
        // sort; Mongo and the memory driver resolve the path against the row,
        // where the foreign key is a scalar id. The last sort response that
        // looked applied and was not.
        await expect(protocol.findData({ object: 'showcase_task', query }))
            .rejects.toMatchObject({
                status: 400,
                code: 'INVALID_SORT',
                field: 'project_id.name',
                object: 'showcase_task',
            });
    });

    it('the dotted rejection names the relationship it tried to cross and prescribes a STORED field', async () => {
        // [#6924] The prescription is part of the contract, not decoration: a
        // refusal that hands the author an unbuildable fix is the same dead end
        // as no hint at all. #4256 chose "a formula or rollup field that copies
        // it into a real column"; measured on a REAL SqlDriver (better-sqlite3)
        // and on InMemoryDriver, `orderBy` naming a `formula` field answers 200
        // with the rows in INSERTION order, identically for asc and desc — no
        // column exists, so the #3821 backstop retries without the sort. That
        // is the exact silent degradation this gate exists to stop, so the old
        // hint routed the author back into it.
        const err: any = await protocol
            .findData({ object: 'showcase_task', query: { sort: 'project_id.name' } })
            .then(() => null, (e: unknown) => e);
        expect(err).toBeTruthy();
        // ADR-0112 envelope — a rejection case asserts code AND status, not
        // merely that something was thrown.
        expect(err.status).toBe(400);
        expect(err.code).toBe('INVALID_SORT');
        expect(err.message).toMatch(/follows the relationship 'project_id'/);
        // The remedy must be a STORED field — #6673's vocabulary for the same
        // correction on the SEARCH axis, deliberately the same word here.
        expect(err.message).toMatch(/a stored field/);
        // ...and the old prescription must be gone, not merely joined.
        expect(err.message).not.toMatch(/formula or rollup/);
        // `formula` may still appear — but only as the named trap, never as the
        // thing to build. This is what separates the fix from a reword that
        // keeps the dead end in a subordinate clause.
        expect(err.message).toMatch(/Not a formula field/);
    });

    it('a dotted path under a non-reference head is refused on the same axis, minus the relationship claim', async () => {
        // `title.length` reaches into a VALUE, not a related record. Telling
        // this caller they "followed a relationship" would be false — `title`
        // holds text — so the message states the contract instead.
        await expect(protocol.findData({ object: 'showcase_task', query: { sort: 'title.length' } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_SORT', field: 'title.length' });
        await expect(protocol.findData({ object: 'showcase_task', query: { sort: 'title.length' } }))
            .rejects.toThrow(/whole columns/);
    });

    it('an unknown head keeps the typo answer — dotted precedence mirrors the expand gate', async () => {
        // `?sort=no_such.title` was a 400 before this gate existed (judged on
        // its head segment) and must keep reading as a typo, not as a
        // relationship crossing; a list carrying both mistakes reports the
        // typo first, like expand's `unknown` > `not-a-reference`.
        await expect(protocol.findData({ object: 'showcase_task', query: { sort: 'no_such.title' } }))
            .rejects.toThrow(/not a field on object/);
        await expect(protocol.findData({
            object: 'showcase_task', query: { sort: 'no_such.title,project_id.name' },
        })).rejects.toMatchObject({ code: 'INVALID_SORT', field: 'no_such.title' });
    });

    it('the "latest N by a related column" footgun is closed too', async () => {
        // `?sort=-project_id.created_at&top=2` used to answer 200 with an
        // arbitrary 2 of 5 — indistinguishable from the real latest-2.
        await expect(protocol.findData({
            object: 'showcase_task', query: { sort: '-project_id.created_at', top: 2 },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_SORT', field: 'project_id.created_at' });
    });

    // ─────────────────────────────────────────────────────────────
    // SELECT — control group, then rejected
    // ─────────────────────────────────────────────────────────────

    it('a real projection narrows the response', async () => {
        const r: any = await protocol.findData({ object: 'showcase_task', query: { select: 'id,title' } });
        expect(Object.keys(r.records[0]).sort()).toEqual(['id', 'title']);
    });

    it('a projection naming NO known field no longer widens to every field', async () => {
        // The failure this axis actually had: unknown columns are dropped, an
        // empty projection falls back to `*`, and the two compose into "asked
        // for one column, received all of them" — over-return from a parameter
        // that exists to under-return.
        await expect(protocol.findData({ object: 'showcase_task', query: { select: 'no_such_field' } }))
            .rejects.toMatchObject({
                status: 400,
                code: 'INVALID_FIELD',
                field: 'no_such_field',
                object: 'showcase_task',
                param: 'select',
            });
    });

    it('a partially-unknown projection is refused too — half a projection is not the one asked for', async () => {
        await expect(protocol.findData({ object: 'showcase_task', query: { select: 'title,no_such_field' } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'no_such_field' });
    });

    it.each([
        ['select', { select: 'no_such_field' }],
        ['select as array', { select: ['no_such_field'] }],
        ['fields', { fields: 'no_such_field' }],
        ['$select', { $select: 'no_such_field' }],
    ])('every projection spelling gets the same answer — %s', async (_label, query) => {
        await expect(protocol.findData({ object: 'showcase_task', query }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'no_such_field' });
    });

    // [#4196] The retired nested-select object form. Before it was removed from
    // `FieldNode`, an entry like this reached `.map(String)` here and came back
    // as the unknown field `"[object Object]"` — a 400 naming something the
    // caller never wrote, about a shape the spec still said was legal.
    it('the removed nested-select object form is refused BY NAME, not as the field "[object Object]"', async () => {
        await expect(protocol.findData({
            object: 'showcase_task',
            query: { fields: [{ field: 'parent_id', fields: ['title'] }] },
        })).rejects.toMatchObject({
            status: 400,
            code: 'INVALID_FIELD',
            object: 'showcase_task',
            param: 'fields',
        });
        await expect(protocol.findData({
            object: 'showcase_task',
            query: { fields: [{ field: 'parent_id' }] },
        })).rejects.toThrow(/nested-select object form.*removed.*expand/s);
    });

    it('wrapping a REAL field in the object form is refused too — the shape is wrong, not the name', async () => {
        // The gate is about the shape, so `title` being a perfectly good column
        // buys the entry nothing. This is also why the shape is judged before
        // the field map: a host whose registry cannot answer "is this a field"
        // still must not hand `{ field: 'title' }` to a driver.
        await expect(protocol.findData({
            object: 'showcase_task',
            query: { fields: [{ field: 'title' }] },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', param: 'fields' });
    });

    it('a dotted path is still accepted — the replacement the rejection prescribes', async () => {
        // The string form covers the readable half of what the object form
        // claimed: the head segment is validated here, the tail resolved
        // downstream. The rejection above points at this and at `expand`.
        await expect(protocol.findData({
            object: 'showcase_task', query: { select: 'parent_id.title' },
        })).resolves.toBeDefined();
    });

    it('the system columns the registry injected still project', async () => {
        // `applySystemFields` adds these at registration — a gate reading only
        // the AUTHORED field map would reject every one of them.
        expect(taskObject.fields).not.toHaveProperty('owner_id');
        const r: any = await protocol.findData({
            object: 'showcase_task', query: { select: 'id,owner_id,created_at' },
        });
        expect(Object.keys(r.records[0]).sort()).toEqual(['created_at', 'id', 'owner_id']);
    });

    // ─────────────────────────────────────────────────────────────
    // EXPAND — control group, then rejected
    // ─────────────────────────────────────────────────────────────

    it('a real relation expands', async () => {
        const r: any = await protocol.findData({ object: 'showcase_task', query: { expand: 'project_id' } });
        expect(r.records[0].project_id).toMatchObject({ id: 'p1', name: 'Apollo' });
    });

    it('a `tree` self-reference expands too — the spec always said it would', async () => {
        // `REFERENCE_VALUE_TYPES` lists `tree` among the types whose value "points
        // at another record … the related record object in expanded form", and
        // objectui requests it. `expandRelatedRecords` used a hand-copied
        // `!==` chain that omitted it, so it came back as a raw parent id.
        const r: any = await protocol.findData({
            object: 'showcase_task', query: { expand: 'parent_id', sort: 'title' },
        });
        expect(r.records[0].parent_id).toBeNull();              // 'A' is the root
        expect(r.records[1].parent_id).toMatchObject({ id: 't_A', title: 'A' });
    });

    it.each([
        ['expand', { expand: 'no_such_rel' }],
        ['populate', { populate: 'no_such_rel' }],
        ['$expand', { $expand: 'no_such_rel' }],
        ['the advanced map form', { expand: { no_such_rel: { object: 'no_such_rel' } } }],
    ])('expanding something the object does not declare is a 400 — %s', async (_label, query) => {
        await expect(protocol.findData({ object: 'showcase_task', query }))
            .rejects.toMatchObject({
                status: 400,
                code: 'INVALID_FIELD',
                field: 'no_such_rel',
                object: 'showcase_task',
                param: 'expand',
            });
    });

    it('expanding a field that exists but holds no reference is refused, with its own reason', async () => {
        // A different mistake from a typo, so a different message: `title` is a
        // real column, it just has nothing to expand into.
        await expect(protocol.findData({ object: 'showcase_task', query: { expand: 'title' } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'title' });
        await expect(protocol.findData({ object: 'showcase_task', query: { expand: 'title' } }))
            .rejects.toThrow(/is not a relationship/);
    });

    it('a reference field with no target gets a third message — the bug is on the OBJECT', async () => {
        // A `lookup` whose `reference` was never authored: the engine has
        // nothing to batch-load, so expansion cannot work — but telling the
        // caller "not a relationship" about a declared lookup sends them to
        // fix the wrong end.
        engine.registry.registerObject({
            name: 'showcase_broken',
            label: 'Broken',
            fields: {
                id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
                orphan: { name: 'orphan', label: 'Orphan', type: 'lookup' },
            },
        } as any, 'test-package');
        await expect(protocol.findData({ object: 'showcase_broken', query: { expand: 'orphan' } }))
            .rejects.toThrow(/declares no target object/);
    });

    it('a `user` field carries its target IN THE TYPE — bare `{type:"user"}` expands (cloud#983)', async () => {
        // `field.zod` defines `user` as "a lookup specialized to the `sys_user`
        // system object … target fixed to the `sys_user` system object", and
        // `Field.user()` takes no target argument — it writes
        // `reference: 'sys_user'` itself. So a field authored WITHOUT
        // `reference` (hand-written JSON, an AI author, a Studio form) is fully
        // specified, and the gate above must not read it as the previous test's
        // targetless lookup.
        //
        // Live capture: an AI-built app modelled 负责人 as `{ type: 'user' }`,
        // objectui's default list expanded that column (its
        // `EXPANDABLE_FIELD_TYPES` keys on the TYPE, deliberately ignoring the
        // target), and the very first screen of the new app rendered
        // "该视图的查询被拒绝" over a `400 … declares no target object`.
        engine.registry.registerObject({
            name: 'sys_user',
            label: 'User',
            fields: {
                id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
                name: { name: 'name', label: 'Name', type: 'text' },
            },
        } as any, 'test-package');
        engine.registry.registerObject({
            name: 'showcase_equipment',
            label: 'Equipment',
            fields: {
                id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
                name: { name: 'name', label: 'Name', type: 'text' },
                // No `reference` — exactly as captured.
                responsible_person: { name: 'responsible_person', label: '负责人', type: 'user' },
            },
        } as any, 'test-package');
        stores.set('sys_user', new Map([['usr_1', { id: 'usr_1', name: 'Ada' }]]));
        stores.set('showcase_equipment', new Map([
            ['e1', { id: 'e1', name: 'Lathe', responsible_person: 'usr_1' }],
        ]));

        // Admitted — and, the half a gate-only fix would miss, actually
        // EXPANDED. Letting the request through while the engine still skipped
        // the field would answer 200 with a raw user id in the cell, which is
        // the "client renders raw ids where names belong" failure this whole
        // axis exists to close.
        const r: any = await protocol.findData({
            object: 'showcase_equipment', query: { populate: 'responsible_person' },
        });
        expect(r.records[0].responsible_person).toMatchObject({ id: 'usr_1', name: 'Ada' });
    });

    // ─────────────────────────────────────────────────────────────
    // The single-record route answers identically (#4226)
    // ─────────────────────────────────────────────────────────────

    it('GET /data/:object/:id gives the same answer as the list route', async () => {
        // "Two routes, opposite answers for one input" is the failure mode this
        // whole family of issues keeps rediscovering. `getData` reads the same
        // `select`/`expand` against the same field map.
        await expect(protocol.getData({ object: 'showcase_task', id: 't_A', select: 'id,title' }))
            .resolves.toMatchObject({ record: { title: 'A' } });
        await expect(protocol.getData({ object: 'showcase_task', id: 't_A', select: 'no_such_field' }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD' });
        await expect(protocol.getData({ object: 'showcase_task', id: 't_A', expand: 'no_such_rel' }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD' });
    });

    // ─────────────────────────────────────────────────────────────
    // Tiering — the gates must not overreach
    // ─────────────────────────────────────────────────────────────

    it('an unknown OBJECT is still a 404 — no axis gate may turn it into a 400', async () => {
        for (const query of [
            { sort: 'no_such_field' },
            { select: 'no_such_field' },
            { expand: 'no_such_rel' },
        ]) {
            await expect(protocol.findData({ object: 'no_such_object', query }))
                .rejects.toMatchObject({ status: 404, code: 'OBJECT_NOT_FOUND' });
        }
    });

    it('a legacy ARRAY field map disables every gate rather than rejecting everything', async () => {
        // `Object.keys` on an array yields '0','1','2' …, so a gate that read
        // one as a field map would 400 on every real field name it was handed.
        // Same call the no-field-map case makes: nothing here can answer "does
        // this field exist".
        const arrayEngine: any = {
            find: async () => [],
            count: async () => 0,
            registry: { getObject: (name: string) => ({ name, fields: [{ name: 'title' }] }) },
        };
        const lenient = new ObjectStackProtocolImplementation(arrayEngine);
        for (const query of [
            { sort: 'no_such_field' },
            { select: 'no_such_field' },
            { expand: 'no_such_rel' },
        ]) {
            await expect(lenient.findData({ object: 'legacy_object', query })).resolves.toBeDefined();
        }
    });

    it('the filter axis keeps its own codes — the new gates did not swallow them', async () => {
        await expect(protocol.findData({ object: 'showcase_task', query: { filter: '{status:done' } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FILTER' });
        await expect(protocol.findData({ object: 'showcase_task', query: { pageSize: '5' } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD' });
        await expect(protocol.findData({ object: 'showcase_task', query: { $nope: '5' } }))
            .rejects.toMatchObject({ status: 400, code: 'UNSUPPORTED_QUERY_PARAM' });
    });

    it('all four axes compose on one request when every name is real', async () => {
        const r: any = await protocol.findData({
            object: 'showcase_task',
            query: {
                filter: JSON.stringify({ status: 'open' }),
                sort: '-title',
                select: 'id,title,project_id',
                expand: 'project_id',
                top: 2,
            },
        });
        expect(titles(r)).toEqual(['E', 'D']);
        expect(r.total).toBe(4);
        expect(r.hasMore).toBe(true);
        expect(r.records[0].project_id).toMatchObject({ id: 'p1', name: 'Apollo' });
        expect(Object.keys(r.records[0]).sort()).toEqual(['id', 'project_id', 'title']);
    });
});

/**
 * [#4254] An object that DECLARES `searchableFields` — the other branch of the
 * allowed-set resolution. `notes` exists and is text, but the declaration
 * excludes it, which earns its own rejection message (the fix is on the
 * OBJECT's declaration, not the request's spelling).
 */
const memoObject = {
    name: 'showcase_memo',
    label: 'Memo',
    searchableFields: ['title'],
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' as const },
        notes: { name: 'notes', label: 'Notes', type: 'textarea' as const },
    },
};

describe('#4254 — searchFields / groupBy / aggregations on the list path (real ObjectQL engine)', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;

    /** Same transcript order as #4226: five rows inserted `C A E B D`. */
    const INSERTION_ORDER = ['C', 'A', 'E', 'B', 'D'];
    /** C (the 'done' row) totals 10; the four 'open' rows total 12. */
    const ESTIMATES: Record<string, number> = { C: 10, A: 1, E: 5, B: 2, D: 4 };

    const titles = (r: any): string[] => r.records.map((x: any) => x.title);
    const ids = (r: any): string[] => r.records.map((x: any) => x.id);

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver, stores } = makeStubDriver();
        // The issue's transcript runs on the engine's IN-MEMORY aggregation
        // fallback — the path `engine.aggregate` takes for drivers with no
        // native `aggregate` (driver-rest, driver-memory, partial SQL
        // drivers). The fake's one-line `aggregate` stub would both preempt
        // that path and ignore `groupBy`, making every grouping control below
        // vacuously green against a grouping that never ran.
        delete (driver as any).aggregate;
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(projectObject, 'test-package');
        engine.registry.registerObject(taskObject, 'test-package');
        engine.registry.registerObject(memoObject, 'test-package');
        protocol = new ObjectStackProtocolImplementation(engine);

        const tasks = new Map<string, Record<string, unknown>>();
        INSERTION_ORDER.forEach((letter, i) => {
            tasks.set(`t_${letter}`, {
                id: `t_${letter}`,
                title: letter,
                status: i === 0 ? 'done' : 'open',
                project_id: 'p1',
                parent_id: letter === 'A' ? null : 't_A',
                // Only B carries the term in `notes`; only A carries it in
                // `title`. `?search=a` finding exactly these two rows — and
                // `searchFields` narrowing to exactly one — is what proves the
                // search actually scans the columns it says it does.
                ...(letter === 'B' ? { notes: 'alpha in notes' } : {}),
                estimate: ESTIMATES[letter],
                owner_id: 'usr_1',
                created_at: '2026-07-30T00:00:00.000Z',
            });
        });
        stores.set('showcase_task', tasks);
        stores.set('showcase_memo', new Map([
            ['m1', { id: 'm1', title: 'gamma report', notes: 'delta hidden in notes' }],
            ['m2', { id: 'm2', title: 'delta summary', notes: 'plain' }],
        ]));
    });

    // ─────────────────────────────────────────────────────────────
    // SEARCH-FIELDS — control group
    // ─────────────────────────────────────────────────────────────

    it('search scans the default columns, and searchFields really narrows the row set', async () => {
        // 'a' hits A in `title` and B in `notes` — two rows, two different
        // matched columns. The narrowing controls only prove something
        // because the un-narrowed baseline finds BOTH.
        expect(titles(await protocol.findData({ object: 'showcase_task', query: { search: 'a' } })))
            .toEqual(['A', 'B']);
        expect(titles(await protocol.findData({
            object: 'showcase_task', query: { search: 'a', searchFields: 'title' },
        }))).toEqual(['A']);
        expect(titles(await protocol.findData({
            object: 'showcase_task', query: { search: 'a', searchFields: ['notes'] },
        }))).toEqual(['B']);
        // The object form of `search` carries the same override — in both the
        // array and comma-string shapes the engine accepts.
        expect(titles(await protocol.findData({
            object: 'showcase_task', query: { search: { query: 'a', fields: ['title'] } },
        }))).toEqual(['A']);
        expect(titles(await protocol.findData({
            object: 'showcase_task', query: { search: { query: 'a', fields: 'notes' } },
        }))).toEqual(['B']);
    });

    it('a declared searchableFields is the allowed set — search does not scan outside it', async () => {
        // `delta` sits in m2's title and m1's NOTES; the declaration limits the
        // scan to `title`, so m1 must not match. This is the declared-branch
        // control the declared-branch rejection below leans on.
        expect(ids(await protocol.findData({ object: 'showcase_memo', query: { search: 'delta' } })))
            .toEqual(['m2']);
        expect(ids(await protocol.findData({
            object: 'showcase_memo', query: { search: 'delta', searchFields: 'title' },
        }))).toEqual(['m2']);
    });

    // ─────────────────────────────────────────────────────────────
    // SEARCH-FIELDS — rejected
    // ─────────────────────────────────────────────────────────────

    it('an unknown searchFields no longer WIDENS the search back to the default set', async () => {
        // The issue's transcript: `?search=a&searchFields=no_such_field` used
        // to return BOTH matching rows — the engine dropped the unknown name,
        // the emptied override fell back to every searchable column, and a
        // parameter whose only purpose is to narrow answered with the WIDER
        // set. Same two-step #4226 closed on `select`, except this one changes
        // which ROWS come back.
        await expect(protocol.findData({
            object: 'showcase_task', query: { search: 'a', searchFields: 'no_such_field' },
        })).rejects.toMatchObject({
            status: 400,
            code: 'INVALID_FIELD',
            field: 'no_such_field',
            object: 'showcase_task',
            param: 'searchFields',
        });
    });

    it('a partially-unknown searchFields is refused too — half a narrowing is not the one asked for', async () => {
        await expect(protocol.findData({
            object: 'showcase_task', query: { search: 'a', searchFields: 'title,no_such_field' },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'no_such_field' });
    });

    it.each([
        ['comma string', { search: 'a', searchFields: 'no_such_field' }, 'searchFields'],
        ['array', { search: 'a', searchFields: ['no_such_field'] }, 'searchFields'],
        ['OData spelling', { search: 'a', $searchFields: 'no_such_field' }, '$searchFields'],
        ['the object form of search', { search: { query: 'a', fields: ['no_such_field'] } }, 'search'],
        ['the object form with a comma string', { search: { query: 'a', fields: 'no_such_field' } }, 'search'],
    ])('every override spelling gets the same answer, quoting the parameter the caller wrote — %s', async (_label, query, param) => {
        await expect(protocol.findData({ object: 'showcase_task', query }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'no_such_field', param });
    });

    it('a REAL field outside the searchable set is refused with its own reason', async () => {
        // A different mistake from a typo: `estimate` exists, it just cannot
        // be a `$contains` target. The message names the auto-default rule and
        // the field's type, because the fix (declare `searchableFields`) is on
        // the object.
        await expect(protocol.findData({
            object: 'showcase_task', query: { search: 'a', searchFields: 'estimate' },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'estimate' });
        await expect(protocol.findData({
            object: 'showcase_task', query: { search: 'a', searchFields: 'estimate' },
        })).rejects.toThrow(/is not searchable.*type 'number'/s);
        // System columns get the system-column reason, not "unknown".
        await expect(protocol.findData({
            object: 'showcase_task', query: { search: 'a', searchFields: 'id' },
        })).rejects.toThrow(/system\/audit column/);
    });

    it('outside a DECLARED searchableFields, the message points at the declaration', async () => {
        // `notes` exists on the memo and is text-like — under the auto-default
        // it would be searchable. The declaration is what excludes it, so the
        // rejection must say so rather than call it unknown or untextual.
        await expect(protocol.findData({
            object: 'showcase_memo', query: { search: 'delta', searchFields: 'notes' },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'notes' });
        await expect(protocol.findData({
            object: 'showcase_memo', query: { search: 'delta', searchFields: 'notes' },
        })).rejects.toThrow(/declares 'searchableFields'/);
    });

    it('a STALE searchableFields declaration gets a third message — the bug is on the OBJECT', async () => {
        // Clients echo the declaration verbatim (objectui's list search sends
        // `$searchFields: schema.searchableFields`), so a declared entry whose
        // field was renamed away must not be reported as the caller's typo —
        // same split #4226 drew for a lookup whose `reference` was never
        // authored. It is still refused: with every requested name stale, the
        // engine's fallback would have scanned the default set — the widening
        // this axis exists to close.
        engine.registry.registerObject({
            name: 'showcase_stale',
            label: 'Stale',
            searchableFields: ['title', 'ghost'],
            fields: {
                id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
                title: { name: 'title', label: 'Title', type: 'text' },
            },
        } as any, 'test-package');
        // The engine's own resolution tolerates the stale entry — a search
        // WITHOUT an override works over the existing subset.
        await expect(protocol.findData({ object: 'showcase_stale', query: { search: 'x' } }))
            .resolves.toBeDefined();
        // The objectui echo: the full declaration, stale entry included.
        await expect(protocol.findData({
            object: 'showcase_stale', query: { search: 'x', searchFields: ['title', 'ghost'] },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'ghost' });
        await expect(protocol.findData({
            object: 'showcase_stale', query: { search: 'x', searchFields: 'ghost' },
        })).rejects.toThrow(/declared in 'searchableFields' but does not exist/);
    });

    it('the override is validated even without a search term riding along', async () => {
        // The caller named fields either way; a stale override is the same
        // typo before the `search` that will eventually use it is added. (The
        // export route only sends `searchFields` alongside `search`, so
        // nothing in the framework depends on the inert combination.)
        await expect(protocol.findData({ object: 'showcase_task', query: { searchFields: 'no_such_field' } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'no_such_field' });
        await expect(protocol.findData({ object: 'showcase_task', query: { searchFields: 'title' } }))
            .resolves.toMatchObject({ total: 5 });
    });

    it('an override the server cannot read is refused rather than ignored', async () => {
        // A number/object override was silently discarded by the engine —
        // which left the search over the DEFAULT columns: the same widening,
        // one shape earlier.
        for (const searchFields of [42, { fields: 'title' }, true]) {
            await expect(protocol.findData({
                object: 'showcase_task', query: { search: 'a', searchFields },
            })).rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', param: 'searchFields' });
        }
        await expect(protocol.findData({
            object: 'showcase_task', query: { search: 'a', searchFields: ['title', 42] },
        })).rejects.toThrow(/entry #2.*is not a field name/s);
    });

    it('a dotted path is refused with the scans-own-columns hint, not a bare "unknown"', async () => {
        // Plausible vocabulary from the select/sort axes — but the engine
        // intersects the override by EXACT name, so a dotted path could only
        // be dropped (and the search widened) if it were let through.
        await expect(protocol.findData({
            object: 'showcase_task', query: { search: 'a', searchFields: 'parent_id.title' },
        })).rejects.toThrow(/scans this object's own columns/);
    });

    it('an empty override is ABSENT, not malformed', async () => {
        for (const searchFields of ['', []]) {
            expect(titles(await protocol.findData({
                object: 'showcase_task', query: { search: 'a', searchFields },
            }))).toEqual(['A', 'B']);
        }
    });

    // ─────────────────────────────────────────────────────────────
    // GROUP-BY — control group, then rejected
    // ─────────────────────────────────────────────────────────────

    it('a real groupBy really groups (in-memory fallback path)', async () => {
        const r: any = await protocol.findData({
            object: 'showcase_task',
            query: { groupBy: ['status'], aggregations: [{ function: 'count', alias: 'n' }] },
        });
        expect(r.records).toHaveLength(2);
        expect(r.records).toEqual(expect.arrayContaining([
            { status: 'done', n: 1 },
            { status: 'open', n: 4 },
        ]));
    });

    it('a date-bucketed groupBy really buckets', async () => {
        const r: any = await protocol.findData({
            object: 'showcase_task',
            query: {
                groupBy: [{ field: 'created_at', dateGranularity: 'month' }],
                aggregations: [{ function: 'count', alias: 'n' }],
            },
        });
        expect(r.records).toEqual([{ created_at: '2026-07', n: 5 }]);
    });

    it('grouping by an unknown field is a 400, not one null-keyed bucket', async () => {
        // The pre-fix answer was `[{ no_such_field: null, n: 5 }]` — the true
        // row count under a grouping that never ran, structurally identical to
        // "this column really holds a single value". A chart draws one bar.
        await expect(protocol.findData({
            object: 'showcase_task',
            query: { groupBy: ['no_such_field'], aggregations: [{ function: 'count', alias: 'n' }] },
        })).rejects.toMatchObject({
            status: 400,
            code: 'INVALID_FIELD',
            field: 'no_such_field',
            object: 'showcase_task',
            param: 'groupBy',
        });
    });

    it.each([
        ['second of two', { groupBy: ['status', 'no_such_field'] }],
        ['structured form', { groupBy: [{ field: 'no_such_field', dateGranularity: 'month' }] }],
        ['no aggregations riding along', { groupBy: ['no_such_field'] }],
    ])('every groupBy spelling of an unknown field gets the same answer — %s', async (_label, query) => {
        await expect(protocol.findData({ object: 'showcase_task', query }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'no_such_field' });
    });

    it('a groupBy the spec cannot read is refused as a SHAPE, with its own code', async () => {
        // Every one of these used to be ignored by the `Array.isArray` routing
        // guard and ride to `engine.find` as inert AST junk: rows came back
        // UNGROUPED with a 200, indistinguishable from a query that never
        // asked for grouping.
        await expect(protocol.findData({ object: 'showcase_task', query: { groupBy: 'status' } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_QUERY', param: 'groupBy' });
        await expect(protocol.findData({ object: 'showcase_task', query: { groupBy: [42] } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_QUERY' });
        await expect(protocol.findData({
            object: 'showcase_task', query: { groupBy: [{ dateGranularity: 'month' }] },
        })).rejects.toThrow(/names no field/);
        await expect(protocol.findData({
            object: 'showcase_task',
            query: { groupBy: [{ field: 'created_at', dateGranularity: 'fortnight' }] },
        })).rejects.toThrow(/not a date granularity/);
    });

    it('grouping by a related column is refused with the runs-own-columns hint', async () => {
        await expect(protocol.findData({
            object: 'showcase_task', query: { groupBy: ['parent_id.title'] },
        })).rejects.toThrow(/this object's own columns/);
    });

    // ─────────────────────────────────────────────────────────────
    // AGGREGATIONS — control group, then rejected
    // ─────────────────────────────────────────────────────────────

    it('a real sum really sums (in-memory fallback path)', async () => {
        const r: any = await protocol.findData({
            object: 'showcase_task',
            query: {
                groupBy: ['status'],
                aggregations: [{ function: 'sum', field: 'estimate', alias: 'total' }],
            },
        });
        expect(r.records).toEqual(expect.arrayContaining([
            { status: 'done', total: 10 },
            { status: 'open', total: 12 },
        ]));
    });

    it('count(*) — the one legitimate field-less form — passes, in both spellings', async () => {
        const bare: any = await protocol.findData({
            object: 'showcase_task', query: { aggregations: [{ function: 'count', alias: 'n' }] },
        });
        expect(bare.records).toEqual([{ n: 5 }]);
        const star: any = await protocol.findData({
            object: 'showcase_task', query: { aggregations: [{ function: 'count', field: '*', alias: 'n' }] },
        });
        expect(star.records).toEqual([{ n: 5 }]);
    });

    it('summing an unknown field is a 400, not a 0 no report can question', async () => {
        // The pre-fix answer was `[{status:'open', s:0}, {status:'done', s:0}]`
        // — sum folded a column of undefined to 0, the exact number a
        // genuinely empty quarter produces. avg/min/max answered null the
        // same way.
        await expect(protocol.findData({
            object: 'showcase_task',
            query: {
                groupBy: ['status'],
                aggregations: [{ function: 'sum', field: 'no_such_field', alias: 's' }],
            },
        })).rejects.toMatchObject({
            status: 400,
            code: 'INVALID_FIELD',
            field: 'no_such_field',
            object: 'showcase_task',
            param: 'aggregations',
        });
        // count(field) counts the non-null values of a REAL column — an
        // unknown one is the same typo as anywhere else.
        await expect(protocol.findData({
            object: 'showcase_task',
            query: { aggregations: [{ function: 'count', field: 'no_such_field', alias: 'n' }] },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'no_such_field' });
    });

    it('an aggregation the spec cannot read is refused as a SHAPE, with its own code', async () => {
        // Each of these had a silent placeholder instead of an error: null
        // results for an unknown function or a field-less sum, a result column
        // literally keyed "undefined" for a missing alias.
        await expect(protocol.findData({
            object: 'showcase_task', query: { aggregations: 'sum(estimate)' },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_QUERY', param: 'aggregations' });
        await expect(protocol.findData({
            object: 'showcase_task', query: { aggregations: [42] },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_QUERY' });
        await expect(protocol.findData({
            object: 'showcase_task',
            query: { aggregations: [{ function: 'median', field: 'estimate', alias: 'm' }] },
        })).rejects.toThrow(/not an aggregation function/);
        await expect(protocol.findData({
            object: 'showcase_task', query: { aggregations: [{ function: 'sum', field: 'estimate' }] },
        })).rejects.toThrow(/has no 'alias'/);
        await expect(protocol.findData({
            object: 'showcase_task', query: { aggregations: [{ function: 'sum', alias: 's' }] },
        })).rejects.toThrow(/Only 'count' may omit the field/);
        await expect(protocol.findData({
            object: 'showcase_task', query: { aggregations: [{ function: 'sum', field: '*', alias: 's' }] },
        })).rejects.toThrow(/count-all sentinel/);
    });

    // ─────────────────────────────────────────────────────────────
    // Composition and tiering
    // ─────────────────────────────────────────────────────────────

    it('search + searchFields compose with the #4226 axes on one request', async () => {
        const r: any = await protocol.findData({
            object: 'showcase_task',
            query: {
                filter: JSON.stringify({ status: 'open' }),
                search: 'a',
                searchFields: 'title,notes',
                sort: '-title',
                select: 'id,title',
                top: 2,
            },
        });
        expect(titles(r)).toEqual(['B', 'A']);
        expect(Object.keys(r.records[0]).sort()).toEqual(['id', 'title']);
    });

    it('where + groupBy + aggregations compose on one request', async () => {
        const r: any = await protocol.findData({
            object: 'showcase_task',
            query: {
                filter: JSON.stringify({ status: 'open' }),
                groupBy: ['status'],
                aggregations: [
                    { function: 'sum', field: 'estimate', alias: 'total' },
                    { function: 'count', alias: 'n' },
                ],
            },
        });
        expect(r.records).toEqual([{ status: 'open', total: 12, n: 4 }]);
        expect(r.total).toBe(1);
        expect(r.hasMore).toBe(false);
    });

    it('an unknown OBJECT is still a 404 — no new axis gate may turn it into a 400', async () => {
        for (const query of [
            { search: 'a', searchFields: 'no_such_field' },
            { groupBy: ['no_such_field'] },
            { aggregations: [{ function: 'sum', field: 'no_such_field', alias: 's' }] },
        ]) {
            await expect(protocol.findData({ object: 'no_such_object', query }))
                .rejects.toMatchObject({ status: 404, code: 'OBJECT_NOT_FOUND' });
        }
    });

    it('a legacy ARRAY field map disables the NAME gates — but shape is still refused', async () => {
        // Name checks need a field map to consult; the shape of the request
        // needs nothing. A registry-less/legacy host must not reject real
        // field names it cannot verify — and must still not carry a groupBy
        // string or a numeric searchFields to an engine that would ignore it.
        const arrayEngine: any = {
            find: async () => [],
            count: async () => 0,
            aggregate: async () => [],
            registry: {
                getObject: (name: string) => ({
                    name,
                    fields: [{ name: 'title' }],
                    searchableFields: ['title'],
                }),
            },
        };
        const lenient = new ObjectStackProtocolImplementation(arrayEngine);
        for (const query of [
            { search: 'a', searchFields: 'no_such_field' },
            { groupBy: ['no_such_field'] },
            { aggregations: [{ function: 'sum', field: 'no_such_field', alias: 's' }] },
        ]) {
            await expect(lenient.findData({ object: 'legacy_object', query })).resolves.toBeDefined();
        }
        await expect(lenient.findData({ object: 'legacy_object', query: { groupBy: 'status' } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_QUERY' });
        await expect(lenient.findData({ object: 'legacy_object', query: { search: 'a', searchFields: 42 } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD' });
    });
});

/**
 * [#6674] The known-but-VIRTUAL axis — the fail-open #4254 closed one axis over,
 * surviving where the name is real.
 *
 * #4254 refuses a `$searchFields` entry the engine would not scan. A `formula`
 * field slipped through the one gap that judgment had: the DECLARED branch
 * admitted any entry that EXISTS, so declaring a formula field put it in the
 * allowed set, and the gate — reading that same set — accepted it. Measured on
 * `origin/main` before this change:
 *
 * ```
 * AUTO:          {"allowed":["name","project_name"],"source":"auto"}           formula excluded
 * DECL-FORMULA:  {"allowed":["name","project_name_formula"],"source":"declared"}  admitted verbatim
 * ?search=Apollo&searchFields=project_name_formula -> 200, 0 rows              silent
 * ```
 *
 * Zero rows is the whole defect: a formula value is computed on read, so no
 * driver materializes a column for `$contains` to scan — 0 rows on
 * driver-memory (the property is absent from the stored row) and 0 rows WITH NO
 * ERROR on driver-sql/better-sqlite3. The declaration reads as search coverage
 * and delivers none, which is the "an unapplied filter must not look like a
 * satisfied one" family (#3948) with the sign that matters here: the caller
 * asked to search a column and got a well-formed empty answer.
 *
 * Refused now, with its own message, because BOTH neighbouring messages are
 * wrong for it: "outside the declared set" is false (it may be IN the list),
 * and the auto-default's "declare `searchableFields` to choose the searchable
 * set" would instruct the author to write the very declaration being refused.
 */
describe('#6674 — a virtual formula field named in searchFields (real ObjectQL engine)', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;
    let stores: Map<string, Map<string, Record<string, unknown>>>;

    /** Declares a formula field searchable — the card's shape exactly. */
    const virtualObject = {
        name: 'showcase_virtual',
        label: 'Virtual',
        searchableFields: ['name', 'project_name_formula'],
        fields: {
            id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
            name: { name: 'name', label: 'Name', type: 'text' as const },
            project_name_formula: {
                name: 'project_name_formula', label: 'Project (formula)',
                type: 'formula' as const, expression: "record.name + ' · Apollo'",
            },
        },
    };

    /** No declaration at all — the auto-default branch of the same question. */
    const autoObject = {
        name: 'showcase_auto_virtual',
        label: 'Auto Virtual',
        fields: {
            id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
            name: { name: 'name', label: 'Name', type: 'text' as const },
            label_formula: {
                name: 'label_formula', label: 'Label (formula)',
                type: 'formula' as const, expression: 'record.name',
            },
        },
    };

    const ids = (r: any): string[] => r.records.map((x: any) => x.id);

    beforeEach(async () => {
        engine = new ObjectQL();
        const made = makeStubDriver();
        stores = made.stores;
        engine.registerDriver(made.driver, true);
        await engine.init();
        engine.registry.registerObject(virtualObject as any, 'test-package');
        engine.registry.registerObject(autoObject as any, 'test-package');
        protocol = new ObjectStackProtocolImplementation(engine);

        // The stored row carries `name` only. That IS the fixture's point: the
        // formula's computed value would contain "Apollo", and the column that
        // would have to hold it does not exist.
        stores.set('showcase_virtual', new Map([
            ['v1', { id: 'v1', name: 'Widget' }],
            ['v2', { id: 'v2', name: 'Apollo Widget' }],
        ]));
        stores.set('showcase_auto_virtual', new Map([['a1', { id: 'a1', name: 'Widget' }]]));
    });

    it('CONTROL — the declared NON-virtual entry still narrows and still matches', async () => {
        // Non-vacuity for every rejection below: the same object, the same
        // declaration, one entry over, answers rows. A conformance block that
        // only asserted refusals would pass just as happily with search broken.
        expect(ids(await protocol.findData({
            object: 'showcase_virtual', query: { search: 'Apollo', searchFields: 'name' },
        }))).toEqual(['v2']);
        // …and with no override at all, the search still runs over the surviving
        // declared entry. Stock compatibility: an already-published object whose
        // `searchableFields` names a formula field keeps answering plain
        // searches, over the same rows as before, because the dropped entry
        // matched nothing anyway.
        expect(ids(await protocol.findData({
            object: 'showcase_virtual', query: { search: 'Apollo' },
        }))).toEqual(['v2']);
    });

    it('the DECLARED formula entry is refused — 400 INVALID_FIELD, not 200 with no rows', async () => {
        await expect(protocol.findData({
            object: 'showcase_virtual',
            query: { search: 'Apollo', searchFields: 'project_name_formula' },
        })).rejects.toMatchObject({
            status: 400, code: 'INVALID_FIELD',
            field: 'project_name_formula', object: 'showcase_virtual',
        });
        await expect(protocol.findData({
            object: 'showcase_virtual',
            query: { search: 'Apollo', searchFields: 'project_name_formula' },
        })).rejects.toThrow(/is a virtual 'formula' field and cannot be searched/);
        // The message must name WHY (no stored column) and the fix (a stored
        // mirror) — the refusal is only useful if the author can act on it.
        await expect(protocol.findData({
            object: 'showcase_virtual',
            query: { search: 'Apollo', searchFields: 'project_name_formula' },
        })).rejects.toThrow(/computed on read and never stored/);
        await expect(protocol.findData({
            object: 'showcase_virtual',
            query: { search: 'Apollo', searchFields: 'project_name_formula' },
        })).rejects.toThrow(/Mirror the computed value onto a stored text field/);
    });

    it('the objectui echo — the whole declaration, formula entry included — is refused', async () => {
        // The path this actually reaches production on: objectui's list search
        // sends `$searchFields: schema.searchableFields` verbatim, so the object
        // that declares a formula field 400s its own toolbar search. That is the
        // blast radius the corpus count bounds, and it is why the message says
        // the declaration is what to fix.
        await expect(protocol.findData({
            object: 'showcase_virtual',
            query: { search: 'Apollo', searchFields: ['name', 'project_name_formula'] },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'project_name_formula' });
        await expect(protocol.findData({
            object: 'showcase_virtual',
            query: { search: 'Apollo', searchFields: ['name', 'project_name_formula'] },
        })).rejects.toThrow(/searchableFields' declares it/);
    });

    it('an UNDECLARED formula field gets the same reason, not the auto-default advice', async () => {
        // Before #6674 this fell to the auto-default branch, whose message ends
        // "Declare 'searchableFields' on the object to choose the searchable set
        // explicitly" — advice that, followed, produces exactly the declaration
        // the case above refuses. The virtual reason is checked BEFORE the
        // source split for that reason.
        await expect(protocol.findData({
            object: 'showcase_auto_virtual', query: { search: 'x', searchFields: 'label_formula' },
        })).rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'label_formula' });
        await expect(protocol.findData({
            object: 'showcase_auto_virtual', query: { search: 'x', searchFields: 'label_formula' },
        })).rejects.toThrow(/is a virtual 'formula' field/);
        await expect(protocol.findData({
            object: 'showcase_auto_virtual', query: { search: 'x', searchFields: 'label_formula' },
        })).rejects.not.toThrow(/choose the searchable set explicitly/);
    });

    it('CONTROL — the #4254 axes are untouched: unknown, stale and unsearchable keep their messages', async () => {
        // The neighbour must not regress. Three distinct reasons, three
        // distinct messages, all still reached.
        await expect(protocol.findData({
            object: 'showcase_virtual', query: { search: 'x', searchFields: 'no_such_field' },
        })).rejects.toThrow(/Unknown field 'no_such_field'/);

        engine.registry.registerObject({
            name: 'showcase_mixed',
            label: 'Mixed',
            searchableFields: ['title', 'ghost'],
            fields: {
                id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
                title: { name: 'title', label: 'Title', type: 'text' },
                estimate: { name: 'estimate', label: 'Estimate', type: 'number' },
            },
        } as any, 'test-package');
        await expect(protocol.findData({
            object: 'showcase_mixed', query: { search: 'x', searchFields: 'ghost' },
        })).rejects.toThrow(/declared in 'searchableFields' but does not exist/);
        await expect(protocol.findData({
            object: 'showcase_mixed', query: { search: 'x', searchFields: 'estimate' },
        })).rejects.toThrow(/declares 'searchableFields'/);
    });
});
