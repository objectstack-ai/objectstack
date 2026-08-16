// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7534 — the EXPLICIT filter axes had no field-existence gate, so one endpoint
 * family answered ONE mistake two ways depending on which door the caller used:
 *
 * ```
 * GET  /data/showcase_task?not_a_field=x                        -> 400 INVALID_FIELD
 * POST /data/showcase_task/query {"where":{"not_a_field":"x"}}  -> 200 {records:[],total:0}
 * ```
 *
 * Measured at the branch point, all four doors on one object and one field
 * name: the bare-key control REJECTED (400/INVALID_FIELD), while the `where`
 * object, the `$filter` string and the filter AST each RESOLVED with
 * `total: 0`. So this is NOT a regression of #4134 — that gate still holds on
 * the door it covers. It is the sibling door its fix never reached.
 *
 * The losing answer is the exact failure #4134 was filed about: an unknown name
 * lowers into a field-equality predicate that can only match zero rows, and the
 * response is indistinguishable from "this object really is empty".
 *
 * Harness shape is deliberately the same as `protocol-unknown-query-param.test.ts`
 * — a REAL {@link ObjectQL} engine rather than an engine double — because the
 * gate's authority is the REGISTRY's field map, not the author's declaration:
 * `applySystemFields` injects the audit / tenant / owner columns at
 * registration, and only a real registry can show that `owner_id` still filters
 * through the explicit door while `not_a_field` is refused.
 *
 * Tests marked GUARD pass in BOTH directions (with the fix and with it
 * reverted). They are here to pin what must NOT change — the #4134 control, the
 * honest zero, the gate's reach — not to demonstrate the fix.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

/** 10 rows, 2 of them `status: 'done'`. */
const taskObject = {
    name: 'showcase_task',
    label: 'Task',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' as const, required: true },
        status: { name: 'status', label: 'Status', type: 'text' as const },
    },
};

function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            // `$and` / `$or` must be honored, not skipped — #4164 composes the
            // explicit filter and the implicit field predicates through `$and`,
            // and this suite files unknown names under `$or` / `$not` too. A
            // matcher that ignored them would green-light a filter that never ran.
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((arm) => matchesWhere(row, arm))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((arm) => matchesWhere(row, arm))) return false;
                continue;
            }
            if (k === '$not') {
                if (matchesWhere(row, v)) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = row[k] === undefined ? null : row[k];
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
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
            const all = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            const from = typeof ast?.offset === 'number' ? ast.offset : 0;
            return typeof ast?.limit === 'number' ? all.slice(from, from + ast.limit) : all.slice(from);
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
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

/**
 * The three EXPLICIT doors of the issue, each spelled the way a caller reaches
 * it, as a function of the field name under test.
 *
 * Kept as ONE table so every door-agreement assertion below is driven from it
 * rather than from a hand-copied list — the copies are how two doors drift into
 * two verdicts in the first place, which is the entire subject of this issue.
 */
const EXPLICIT_DOORS: ReadonlyArray<{
    door: string,
    param: string,
    /** Both the field AND the value are parameters — a door whose value is
     *  patched in afterwards by string surgery is a fixture that can silently
     *  miss (the `$filter` door nests JSON inside JSON, so its quotes are
     *  escaped and a naive replace does nothing but leave the test green-looking
     *  and wrong). */
    query: (field: string, value: string) => any,
}> = [
    // `where` object — `POST /data/:object/query` body.
    { door: 'where object', param: 'where', query: (f, v) => ({ where: { [f]: v } }) },
    // `$filter` string — the OData spelling, JSON in a querystring value.
    { door: '$filter string', param: '$filter', query: (f, v) => ({ $filter: JSON.stringify({ [f]: v }) }) },
    // Filter AST — the `FilterArray` sugar the ObjectUI client and FilterBuilder emit.
    { door: 'filter AST', param: 'filter', query: (f, v) => ({ filter: [[f, '=', v]] }) },
];

describe('#7534 — unknown field on the EXPLICIT filter axes (real ObjectQL engine)', () => {
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(async () => {
        const engine = new ObjectQL();
        const { driver, stores } = makeStubDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(taskObject, 'test-package');
        protocol = new ObjectStackProtocolImplementation(engine);

        const rows = new Map<string, Record<string, unknown>>();
        for (let i = 1; i <= 10; i++) {
            rows.set(`t${i}`, {
                id: `t${i}`,
                title: `Task ${i}`,
                status: i <= 2 ? 'done' : 'open',
                owner_id: 'usr_1',
                created_at: '2026-07-30T00:00:00.000Z',
            });
        }
        stores.set('showcase_task', rows);
    });

    const find = (query?: any) => protocol.findData({ object: 'showcase_task', query });

    // ─────────────────────────────────────────────────────────────
    // Positive identity FIRST — every rejection below is only meaningful
    // against a door that demonstrably works when the field is real.
    // ─────────────────────────────────────────────────────────────

    it('GUARD baseline — no filter returns every row', async () => {
        await expect(find()).resolves.toMatchObject({ total: 10 });
    });

    it('GUARD every explicit door APPLIES a real filter — the positive identity the refusals are measured against', async () => {
        // Scale guard: if a door is added to the table and not to the issue's
        // coverage, this count is what says so.
        expect(EXPLICIT_DOORS).toHaveLength(3);
        for (const { door, query } of EXPLICIT_DOORS) {
            const r: any = await find(query('status', 'done'));
            expect(r.total, `${door} must apply a real filter`).toBe(2);
            expect(
                r.records.map((x: any) => x.id).sort(),
                `${door} must return the two 'done' rows, not an arbitrary page`,
            ).toEqual(['t1', 't2']);
        }
    });

    // ─────────────────────────────────────────────────────────────
    // The defect: each door, on its own, for the issue's own field name
    // ─────────────────────────────────────────────────────────────

    it.each(EXPLICIT_DOORS)(
        'the $door door refuses an unknown field with 400 INVALID_FIELD instead of 200 + an empty list',
        async ({ param, query }) => {
            await expect(find(query('not_a_field', 'x'))).rejects.toMatchObject({
                status: 400,
                code: 'INVALID_FIELD',
                field: 'not_a_field',
                object: 'showcase_task',
                param,
            });
        },
    );

    it('the AST single-comparison and and-group spellings are refused too, not just the flat list', async () => {
        // `['not_a_field','=','x']` and `['and', …]` are separate branches of
        // `parseFilterAST`; the flat-list case above exercises neither.
        for (const filter of [
            ['not_a_field', '=', 'x'],
            ['and', ['status', '=', 'open'], ['not_a_field', '=', 'x']],
        ]) {
            await expect(find({ filter })).rejects.toMatchObject({
                status: 400, code: 'INVALID_FIELD', field: 'not_a_field',
            });
        }
    });

    it('an unknown field is found however deeply the combinators bury it', async () => {
        // Structure is discarded when collecting field keys: whether a predicate
        // sits under an `$or` changes nothing about whether its column exists.
        for (const where of [
            { $and: [{ status: 'open' }, { not_a_field: 'x' }] },
            { $or: [{ status: 'open' }, { not_a_field: 'x' }] },
            { $not: { not_a_field: 'x' } },
            { $and: [{ $or: [{ $not: { not_a_field: 'x' } }] }] },
        ]) {
            await expect(find({ where })).rejects.toMatchObject({
                status: 400, code: 'INVALID_FIELD', field: 'not_a_field',
            });
        }
    });

    it('an unknown field carrying an OPERATOR bag is refused on the same terms', async () => {
        // `{not_a_field: {$gte: 5}}` is still a predicate that can only match
        // zero rows — the operator does not make the column exist.
        await expect(find({ where: { not_a_field: { $gte: 5 } } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'not_a_field' });
    });

    // ─────────────────────────────────────────────────────────────
    // The issue's actual complaint: the doors DISAGREED
    // ─────────────────────────────────────────────────────────────

    it('all four doors now give ONE verdict for one mistake', async () => {
        const doors: ReadonlyArray<{ door: string, query: any }> = [
            // The #4134 control — the door that already answered correctly.
            { door: 'bare key (control)', query: { not_a_field: 'x' } },
            ...EXPLICIT_DOORS.map(({ door, query }) => ({ door, query: query('not_a_field', 'x') })),
        ];
        // Scale guard: the issue names four doors. If this list shrinks, the
        // loop below silently stops covering one of them.
        expect(doors).toHaveLength(4);

        const verdicts: string[] = [];
        for (const { door, query } of doors) {
            try {
                const r: any = await find(query);
                verdicts.push(`${door} => 200 total=${r.total}`);
            } catch (e: any) {
                verdicts.push(`${door} => ${e.status} ${e.code}`);
            }
        }
        // Pinned positively, not as a "must not contain": the exact verdict for
        // every door is written out, so a door that starts answering something
        // else — including a NEW wrong answer — fails here.
        expect(verdicts).toEqual([
            'bare key (control) => 400 INVALID_FIELD',
            'where object => 400 INVALID_FIELD',
            '$filter string => 400 INVALID_FIELD',
            'filter AST => 400 INVALID_FIELD',
        ]);
    });

    it('GUARD the bare-key control is untouched — this fix is #4134\'s sibling, not its replacement', async () => {
        await expect(find({ not_a_field: 'x' })).rejects.toMatchObject({
            status: 400,
            code: 'INVALID_FIELD',
            field: 'not_a_field',
            object: 'showcase_task',
        });
        // Its message is the PARAM-shaped one, and stays that way: the two doors
        // give one verdict but not one sentence, because the advice differs.
        await expect(find({ pageSize: '5' }))
            .rejects.toThrow(/Did you mean the 'top' query parameter/);
    });

    // ─────────────────────────────────────────────────────────────
    // The rejection has to be usable
    // ─────────────────────────────────────────────────────────────

    it('names the parameter the caller actually wrote, not the canonical slot', async () => {
        // Telling someone who sent `?$filter=…` that "'where' is invalid" names
        // a parameter absent from their request (#4226's discipline).
        for (const [query, param] of [
            [{ $filter: JSON.stringify({ not_a_field: 'x' }) }, '$filter'],
            [{ filter: JSON.stringify({ not_a_field: 'x' }) }, 'filter'],
            [{ filters: JSON.stringify({ not_a_field: 'x' }) }, 'filters'],
            [{ where: { not_a_field: 'x' } }, 'where'],
        ] as const) {
            await expect(find(query)).rejects.toMatchObject({ code: 'INVALID_FIELD', param });
        }
    });

    it('states the zero-row consequence and suggests the field that was meant', async () => {
        await expect(find({ where: { not_a_field: 'x' } }))
            .rejects.toThrow(/can only match zero records/);
        await expect(find({ where: { stauts: 'done' } }))
            .rejects.toThrow(/Did you mean the field 'status'/);
    });

    it('reports the first unknown name and still discloses the rest', async () => {
        await expect(find({ where: { not_a_field: 'x', other_bogus: 'y' } }))
            .rejects.toMatchObject({
                field: 'not_a_field',
                fields: ['not_a_field', 'other_bogus'],
            });
    });

    // ─────────────────────────────────────────────────────────────
    // GUARDs — the reach of the gate, which must not grow
    // ─────────────────────────────────────────────────────────────

    it('GUARD a real field that matches nothing is still an HONEST 200 + total 0', async () => {
        // The one empty list that must never become a 400: the predicate was
        // applied and genuinely matched nothing.
        for (const query of [
            { where: { status: 'zzz' } },
            { $filter: JSON.stringify({ status: 'zzz' }) },
            { filter: [['status', '=', 'zzz']] },
        ]) {
            await expect(find(query)).resolves.toMatchObject({ total: 0 });
        }
    });

    it('GUARD filters on the system fields the registry injected, which the author never declared', async () => {
        expect(taskObject.fields).not.toHaveProperty('owner_id');
        await expect(find({ where: { owner_id: 'usr_1' } })).resolves.toMatchObject({ total: 10 });
        await expect(find({ where: { created_at: '2026-07-30T00:00:00.000Z' } }))
            .resolves.toMatchObject({ total: 10 });
        await expect(find({ where: { id: 't1' } })).resolves.toMatchObject({ total: 1 });
    });

    it('[#8371] a dotted path on a REAL relation head is now REFUSED — the verdict this gate deliberately lacked', async () => {
        // This GUARD used to pin the pass-through ("nothing may refuse it
        // after") — the scope note of a gate that had ONE verdict, not a
        // ruling that the spelling must stay unjudged forever. #8371 measured
        // it on all three drivers (zero rows everywhere: `owner_id` is a
        // registry-injected `lookup`, storing a scalar id no dotted path can
        // traverse) and ruled the refusal, with the whole key named exactly as
        // the caller wrote it. The properties that SURVIVE from the old guard
        // are narrower and still pinned around this test: a nested-relation
        // OBJECT condition is not descended into, and an unknown head keeps
        // its typo-shaped answer, first.
        await expect(find({ where: { 'owner_id.name': 'Ada' } }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', field: 'owner_id.name' });
    });

    it('a dotted path on an UNKNOWN head is refused, exactly as the bare-key door judges one', async () => {
        // The other half of the head-segment rule, and — unlike the pass-through
        // above — this one is the fix talking: it is a 200 + empty list without
        // it. Kept as its own test for that reason; folding the two halves into
        // one case mislabels a fix-dependent assertion as a guard.
        await expect(find({ where: { 'not_a_field.name': 'Ada' } }))
            .rejects.toMatchObject({ code: 'INVALID_FIELD', field: 'not_a_field.name' });
    });

    it('GUARD a nested-relation condition is not descended into — its keys belong to another object', async () => {
        // `{owner_id: {region: 'NA'}}` names `owner_id` on THIS object and
        // `region` on the related one. Judging `region` against this object's
        // field map would refuse a legitimate relation filter.
        await expect(find({ where: { owner_id: { region: 'NA' } } })).resolves.toBeDefined();
    });

    it('GUARD an unknown object stays a 404 — the filter gate must not turn it into a 400', async () => {
        await expect(
            protocol.findData({ object: 'no_such_object', query: { where: { not_a_field: 'x' } } }),
        ).rejects.toMatchObject({ status: 404, code: 'OBJECT_NOT_FOUND' });
    });

    it('GUARD an unrunnable filter is still INVALID_FILTER — this gate answers only "does the field exist"', async () => {
        // #4181 / #4121 own the shape verdicts and run first; a field gate that
        // pre-empted them would relabel a parse failure as a typo.
        await expect(find({ filter: '{status:done' }))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_FILTER' });
    });

    it('GUARD #4164 composition is unchanged — a bare field param still NARROWS an explicit filter', async () => {
        const r: any = await find({ filter: JSON.stringify({ status: 'open' }), title: 'Task 3' });
        expect(r.total).toBe(1);
        expect(r.records.map((x: any) => x.id)).toEqual(['t3']);
    });

    it('GUARD the param gate still reports FIRST when both a bare key and the filter are wrong', async () => {
        // Precedence deliberately unmoved: this gate runs after #4134's, so a
        // request that gets both wrong answers exactly as it did before.
        await expect(find({ where: { not_a_field: 'x' }, pageSize: '5' }))
            .rejects.toThrow(/Did you mean the 'top' query parameter/);
    });
});
