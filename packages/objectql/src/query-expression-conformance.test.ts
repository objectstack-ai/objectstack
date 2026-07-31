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
    },
};

/**
 * An in-memory driver that really sorts, really projects and really paginates.
 *
 * This matters more than usual here: a driver that ignored `orderBy` would make
 * every "a real sort field works" control vacuously true, and the pins above it
 * would then pass against a completely broken sort axis.
 */
function makeMemoryDriver() {
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
            if (k.startsWith('$')) continue;
            if (v && typeof v === 'object' && '$in' in (v as any)) {
                if (!(v as any).$in.map(String).includes(String(row[k]))) return false;
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
        findStream() { throw new Error('not implemented'); },
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

    /** The issue's transcript order: five rows inserted `C A E B D`. */
    const INSERTION_ORDER = ['C', 'A', 'E', 'B', 'D'];

    const titles = (r: any): string[] => r.records.map((x: any) => x.title);

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver, stores } = makeMemoryDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(projectObject as any, 'test-package');
        engine.registry.registerObject(taskObject as any, 'test-package');
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
