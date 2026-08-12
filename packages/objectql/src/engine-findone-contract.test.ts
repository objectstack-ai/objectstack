// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4419 — `findOne` executes every option it declares, and refuses a query that
 * selects no particular record.
 *
 * The reported failure: a read query carrying a predicate the engine does not
 * execute is not rejected and not reported; the key is dropped and the query
 * runs WITHOUT a predicate. On `findOne` the forced `limit: 1` then turns that
 * into the object's FIRST ROW — a real, plausible-looking record unrelated to
 * the request, which no caller's `if (!row)` can catch and which propagates
 * into whatever is computed next. Downstream, one wrong key defaulted line-item
 * prices from the first product in the catalog and evaluated "is this deal
 * already closed?" against an unrelated record.
 *
 * `filter` — the key the issue was reported against — was closed by #4346 (fold
 * on every entry point) and #4400 (unknown keys throw), both pinned in
 * `engine-filter-alias.test.ts` / `engine-unknown-option.test.ts`. This suite
 * covers what those left standing:
 *
 *  1. **`search` was the same bug under a different key.** `find()` expanded
 *     ADR-0061 `search` into `where`; `findOne()` did not — while both are
 *     checked against the SAME legal-key set, so `search` passed the gate, rode
 *     onto the AST, and reached a driver. No driver reads `ast.search`. So
 *     `findOne({ search })` returned the first row of the whole object.
 *  2. **The empty predicate itself.** Even with every key folded and every
 *     unknown key refused, `findOne({})` still answered with an arbitrary row.
 *     It now throws, and names the three ways to be specific.
 *  3. **The drift pin at the bottom** is the part that stops (1) recurring: it
 *     walks `ENGINE_OPTION_KEY_SETS.findOne` and requires each declared key to
 *     have an observable effect. `search` sat declared-but-unexecuted through
 *     two rounds of hardening because nothing asked that question.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, ENGINE_OPTION_KEY_SETS } from './engine.js';

const account = {
    name: 'crm_account',
    label: 'Account',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
        industry: { name: 'industry', type: 'text' as const },
        annual_revenue: { name: 'annual_revenue', type: 'number' as const },
        owner: { name: 'owner', type: 'lookup' as const, reference: 'person' },
    },
};
const person = {
    name: 'person',
    label: 'Person',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
    },
};
interface SeenRead { ast: any; opts: any }

/** Memory driver recording the AST and driver options of every read. */
function makeRecordingDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    const reads: SeenRead[] = [];
    let nextId = 0;
    const matches = (row: any, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and') return (v as any[]).every((w) => matches(row, w));
            if (k === '$or') return (v as any[]).some((w) => matches(row, w));
            if (k.startsWith('$')) continue;
            // [#7641] `$icontains` — the operator `$search` compiles to. This
            // arm folded BOTH sides while it was still keyed on `$contains`,
            // i.e. it implemented `$icontains` semantics under the case-
            // SENSITIVE operator's name. That is part of why no unit test on
            // this path noticed the compiler was emitting the wrong operator:
            // the double answered the way the fixed compiler asks for.
            if (v && typeof v === 'object' && '$icontains' in (v as any)) {
                const needle = String((v as any).$icontains).toLowerCase();
                if (!String(row[k] ?? '').toLowerCase().includes(needle)) return false;
                continue;
            }
            const exp = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            if ((row[k] ?? null) !== (exp ?? null)) return false;
        }
        return true;
    };
    const run = (o: string, ast: any) => {
        let rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
        const ord = Array.isArray(ast?.orderBy) ? ast.orderBy : [];
        if (ord.length > 0) {
            rows = [...rows].sort((a: any, b: any) => {
                for (const { field, order } of ord) {
                    const cmp = String(a?.[field] ?? '').localeCompare(String(b?.[field] ?? ''));
                    if (cmp !== 0) return order === 'desc' ? -cmp : cmp;
                }
                return 0;
            });
        }
        if (typeof ast?.offset === 'number' && ast.offset > 0) rows = rows.slice(ast.offset);
        if (Array.isArray(ast?.fields) && ast.fields.length > 0) {
            rows = rows.map((r) => Object.fromEntries(ast.fields.map((f: string) => [f, (r as any)[f]])));
        }
        return typeof ast?.limit === 'number' && ast.limit > 0 ? rows.slice(0, ast.limit) : rows;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any, opts: any) { reads.push({ ast, opts }); return run(o, ast); },
        async findOne(o: string, ast: any, opts: any) { reads.push({ ast, opts }); return run(o, ast)[0] ?? null; },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
            const up = { ...cur, ...data, id }; s.set(id, up); return up;
        },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count(o: string, ast: any) { return run(o, ast).length; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, stores, reads };
}

describe('findOne executes what it declares and refuses an empty predicate (#4419)', () => {
    let engine: ObjectQL;
    let reads: SeenRead[];
    let one: any, two: any, three: any;

    beforeEach(async () => {
        engine = new ObjectQL();
        const mem = makeRecordingDriver();
        reads = mem.reads;
        engine.registerDriver(mem.driver, true);
        await engine.init();
        engine.registry.registerObject(account);
        engine.registry.registerObject(person);
        // The issue's own repro set.
        one = await engine.insert('crm_account', { name: 'One', industry: 'Retail', annual_revenue: 100 });
        two = await engine.insert('crm_account', { name: 'Two', industry: 'Metals', annual_revenue: 200 });
        three = await engine.insert('crm_account', { name: 'Three', industry: 'Mining', annual_revenue: 200 });
        reads.length = 0; // drop insert-path reads; the pins below own this log
    });

    const lastRead = () => reads.at(-1)!;

    // ── (1) `search` is a predicate on findOne, not a dropped key ────────

    it('findOne({search}) matches the searched record, not the first row', async () => {
        const row = await engine.findOne('crm_account', { search: 'Two' });
        expect(row?.name).toBe('Two');
        expect(row?.id).not.toBe(one.id);
    });

    it('the search term reaches the driver as an $icontains predicate — `search` never does', async () => {
        await engine.findOne('crm_account', { search: 'Two' });
        const { ast } = lastRead();
        expect(ast.where).toBeTruthy();
        // [#7641] `$icontains`, not `$contains`: the latter is contractually
        // case-SENSITIVE (#4706 Q2 = A), so `$search` compiling to it made
        // matching case-sensitive against three declarations saying otherwise.
        expect(JSON.stringify(ast.where)).toContain('$icontains');
        expect(ast.search).toBeUndefined();
        expect(ast.searchFields).toBeUndefined();
    });

    it('findOne({search, searchFields}) narrows the scanned fields, as find() does', async () => {
        // 'Two' lives in `name`, 'Metals' in `industry`. Narrowed to
        // `industry`, only the latter can hit — and a narrowed miss must be a
        // miss, not a fall-back to an unpredicated read.
        const narrowed = { searchFields: ['industry'] };
        expect(await engine.findOne('crm_account', { search: 'Two', ...narrowed })).toBeNull();
        expect((await engine.findOne('crm_account', { search: 'Metals', ...narrowed }))?.id)
            .toBe(two.id);
    });

    it('find({search}) is unchanged — the expansion moved, it did not fork', async () => {
        const rows = await engine.find('crm_account', { search: 'Two' });
        expect(rows.map((r: any) => r.name)).toEqual(['Two']);
    });

    it('a search that expands to NO filter is refused, not answered with an arbitrary row', async () => {
        // A blank/whitespace term expands to nothing (`expandSearchToFilter`
        // returns null), so the AST is left with no predicate at all — the
        // "predicate resolved to empty" shape the issue names. Before #4419 the
        // forced `limit: 1` turned it into the object's first row.
        for (const term of ['', '   ']) {
            await expect(engine.findOne('crm_account', { search: term }))
                .rejects.toThrow(/selects no particular record/);
        }
        expect(reads).toHaveLength(0);
    });

    // ── (2) the empty-predicate guard ───────────────────────────────────

    it.each([
        ['no argument at all', undefined],
        ['an empty bag', {}],
        ['an empty where', { where: {} }],
        ['an explicitly null where', { where: null }],
        ['a withdrawn filter alias', { filter: null }],
        ['projection without a predicate', { fields: ['id', 'name'] }],
        ['expand without a predicate', { expand: { owner: { object: 'person' } } }],
    ])('findOne with %s throws instead of returning the first row', async (_label, query) => {
        await expect(engine.findOne('crm_account', query as any)).rejects.toThrow(
            /findOne\('crm_account'\) selects no particular record/,
        );
        expect(reads).toHaveLength(0); // refused before the driver was asked
    });

    it('the refusal names all three ways to be specific', async () => {
        await expect(engine.findOne('crm_account', {} as any)).rejects.toThrow(
            /Pass 'where'.*pass 'orderBy'.*find\('crm_account', \{ limit: 1 \}\)/s,
        );
    });

    it.each([
        ['where', { where: { id: () => two.id } }],
        ['the filter alias', { filter: { id: () => two.id } }],
    ])('findOne({%s}) still selects the record', async (_label, shape) => {
        const key = Object.keys(shape)[0];
        const row = await engine.findOne('crm_account', { [key]: { id: two.id } } as any);
        expect(row?.id).toBe(two.id);
    });

    it('orderBy alone is a legitimate findOne — "the first record in THIS order"', async () => {
        const row = await engine.findOne('crm_account', {
            orderBy: [{ field: 'name', order: 'desc' }],
        } as any);
        expect(row?.name).toBe('Two'); // Two > Three > One
    });

    it('an empty orderBy array is not an ordering, and does not satisfy the guard', async () => {
        await expect(engine.findOne('crm_account', { orderBy: [] } as any))
            .rejects.toThrow(/selects no particular record/);
    });

    it('find() is NOT guarded — returning every row is an honest answer', async () => {
        const rows = await engine.find('crm_account');
        expect(rows).toHaveLength(3);
        expect(await engine.count('crm_account')).toBe(3);
    });

    // ── RETIRED PIN (#5158, maintainer ruling C) ────────────────────────
    //
    // This slot held: "a non-object where (an expression tree) is the DRIVER'S
    // TO INTERPRET, not refused". That sentence was the engine's explicit
    // blessing of a second filter dialect — the one door in the product that
    // let a `FilterArray` reach a driver unlowered, which is how four drivers
    // came to carry their own array compilers and how cloud's
    // `RemoteTransport` ended up refusing what `driver-sql` compiled.
    //
    // Ruling C closed that door: `FilterArray` is declared INPUT-ONLY (spec
    // #5285) and the engine lowers it through `parseFilterAST` like the
    // protocol face always has. So "the driver's to interpret" is no longer
    // true of ANY `where` — there is one dialect now, and the guard below
    // judges the lowered shape. The retirement is the point of the change, not
    // a casualty of it; the replacements assert what #4419 actually cares
    // about, which is that findOne never answers with an arbitrary row.
    //
    // Lowering itself is pinned in `engine-filter-array-lowering.test.ts`.

    it('an array where is LOWERED before the guard, and still selects the record', async () => {
        const row = await engine.findOne('crm_account', { where: [['name', '=', 'Two']] } as any);
        expect(row?.id).toBe(two.id);
        // The load-bearing half: what the driver saw was a FilterCondition.
        expect(Array.isArray(lastRead().ast.where)).toBe(false);
        expect(lastRead().ast.where).toEqual({ name: 'Two' });
    });

    it('`where: []` no longer walks past the guard as "an expression tree"', async () => {
        // The retired pin's real cost. `[]` means "no filter" — it always did
        // — but an unlowered `[]` counted as a predicate here, so findOne
        // applied `limit: 1` to the WHOLE table and returned its first row:
        // precisely the #4419 defect, surviving inside #4419's own guard.
        await expect(engine.findOne('crm_account', { where: [] } as any))
            .rejects.toThrow(/selects no particular record/);
    });

    it('the guard reads the CALLER\'s predicate, before any middleware scoping', async () => {
        // A read filter injected downstream narrows which rows are visible; it
        // does not make "whichever comes first" something the caller asked for.
        engine.registerMiddleware(async (opCtx: any, next: any) => {
            if (opCtx.operation === 'findOne') {
                opCtx.ast.where = { ...(opCtx.ast.where ?? {}), annual_revenue: 200 };
            }
            return next();
        });
        await expect(engine.findOne('crm_account', {} as any))
            .rejects.toThrow(/selects no particular record/);
    });

    // ── the L2 hook surface the issue was found on ──────────────────────

    it('ctx.api.object(o).findOne({where}) works; the same call with no predicate throws', async () => {
        const repo = engine.createContext({ userId: 'usr_1' }).object('crm_account');
        expect((await repo.findOne({ where: { id: two.id } }))?.id).toBe(two.id);
        expect((await repo.findOne({ search: 'Three' }))?.name).toBe('Three');
        await expect(repo.findOne()).rejects.toThrow(/selects no particular record/);
        await expect(repo.findOne({})).rejects.toThrow(/selects no particular record/);
    });

    it('a miss is still null — the guard did not turn "not found" into an error', async () => {
        expect(await engine.findOne('crm_account', { where: { id: 'nope' } } as any)).toBeNull();
        expect(await engine.findOne('crm_account', { search: 'nope' })).toBeNull();
    });

    // ── (3) drift pin: every declared findOne option is executed ────────

    /**
     * One proof per key in `ENGINE_OPTION_KEY_SETS.findOne`: the call to make,
     * and what must be observable afterwards. `na` records a key that is
     * deliberately not executed, with the reason — the only honest way to leave
     * one out, and the thing `search` never had.
     *
     * The table is asserted to cover the legal set EXACTLY, so a key added to
     * the spec must be given a proof (or an explicit `na`) before it can ship.
     */
    type Proof =
        | { call: Record<string, unknown>; expect: (seen: SeenRead) => void }
        | { na: string };

    const PROOFS: Record<string, Proof> = {
        where: {
            call: { where: { name: 'Two' } },
            expect: ({ ast }) => expect(ast.where).toMatchObject({ name: 'Two' }),
        },
        fields: {
            call: { where: { name: 'Two' }, fields: ['id', 'name'] },
            expect: ({ ast }) => expect(ast.fields).toEqual(['id', 'name']),
        },
        orderBy: {
            call: { orderBy: [{ field: 'name', order: 'desc' }] },
            expect: ({ ast }) => expect(ast.orderBy).toEqual([{ field: 'name', order: 'desc' }]),
        },
        offset: {
            call: { where: { annual_revenue: 200 }, offset: 1 },
            expect: ({ ast }) => expect(ast.offset).toBe(1),
        },
        search: {
            call: { search: 'Two' },
            expect: ({ ast }) => {
                expect(ast.search).toBeUndefined();
                // [#7641] the case-folding operator, not the case-sensitive one.
                expect(JSON.stringify(ast.where)).toContain('$icontains');
            },
        },
        searchFields: {
            call: { search: 'Two', searchFields: ['name'] },
            expect: ({ ast }) => {
                expect(ast.searchFields).toBeUndefined();
                // Narrowed to the one requested field, not the auto-default set.
                expect(JSON.stringify(ast.where)).toContain('name');
            },
        },
        expand: {
            call: { where: { name: 'Two' }, expand: { owner: { object: 'person' } } },
            // Engine-side post-processing: the relation is resolved after the
            // fetch, so the proof is that the key survives onto the AST for it.
            expect: ({ ast }) => expect(ast.expand).toBeTruthy(),
        },
        context: {
            call: { where: { name: 'Two' }, context: { tenantId: 't-1' } },
            expect: ({ ast, opts }) => {
                expect(ast.context).toBeUndefined(); // not a driver concern
                expect(opts).toMatchObject({ tenantId: 't-1' });
            },
        },
        tenantId: {
            call: { where: { name: 'Two' }, tenantId: 't-explicit' },
            expect: ({ opts }) => expect(opts).toMatchObject({ tenantId: 't-explicit' }),
        },
        tenantIds: {
            call: { where: { name: 'Two' }, tenantIds: ['t-1', 't-2'] },
            expect: ({ opts }) => expect(opts).toMatchObject({ tenantIds: ['t-1', 't-2'] }),
        },
        timezone: {
            call: { where: { name: 'Two' }, timezone: 'Asia/Shanghai' },
            expect: ({ opts }) => expect(opts).toMatchObject({ timezone: 'Asia/Shanghai' }),
        },
        transaction: {
            call: { where: { name: 'Two' }, transaction: { id: 'tx-1' } },
            expect: ({ opts }) => expect(opts).toMatchObject({ transaction: { id: 'tx-1' } }),
        },
        bypassTenantAudit: {
            call: { where: { name: 'Two' }, bypassTenantAudit: true },
            expect: ({ opts }) => expect(opts).toMatchObject({ bypassTenantAudit: true }),
        },
        preserveAudit: {
            call: { where: { name: 'Two' }, preserveAudit: true },
            expect: ({ opts }) => expect(opts).toMatchObject({ preserveAudit: true }),
        },
        limit: {
            na: 'findOne is single-row by contract — the literal `limit: 1` on the AST '
                + 'wins over any caller value (and over the folded `top` alias). Legal '
                + 'because the shared find/findOne schema declares it; overridden, not dropped.',
        },
    };

    it('every option findOne declares is one it executes', async () => {
        const legal = ENGINE_OPTION_KEY_SETS.findOne;
        expect(new Set(Object.keys(PROOFS)), 'PROOFS must cover the legal set exactly')
            .toEqual(new Set(legal));

        for (const [key, proof] of Object.entries(PROOFS)) {
            if ('na' in proof) {
                expect(proof.na.length, `${key} must state WHY it is not executed`).toBeGreaterThan(20);
                continue;
            }
            reads.length = 0;
            await engine.findOne('crm_account', proof.call as any);
            expect(reads.length, `findOne({${key}}) must reach the driver`).toBeGreaterThan(0);
            proof.expect(lastRead());
        }
    });

    it('the caller-supplied limit is overridden, not honoured — findOne stays single-row', async () => {
        await engine.findOne('crm_account', { where: { annual_revenue: 200 }, limit: 5 } as any);
        expect(lastRead().ast.limit).toBe(1);
        // `top` folds to `limit` (#4346) and loses to the same override.
        await engine.findOne('crm_account', { where: { annual_revenue: 200 }, top: 5 } as any);
        expect(lastRead().ast.limit).toBe(1);
    });

    it('the issue\'s original repro table, end to end', async () => {
        const o = () => engine.createContext({ isSystem: true }).object('crm_account');
        expect((await o().findOne({ where: { id: two.id } }))?.name).toBe('Two');
        expect((await o().findOne({ filter: { id: two.id } }))?.name).toBe('Two');   // #4346
        expect(await o().findOne({ where: { id: 'nope' } })).toBeNull();
        expect(await o().findOne({ filter: { id: 'nope' } })).toBeNull();            // #4346
        expect(await o().count({ where: { annual_revenue: 100 } })).toBe(1);
        expect(await o().count({ filter: { annual_revenue: 100 } })).toBe(1);        // #4346
        expect((await o().find({ filter: { annual_revenue: 200 } })).map((r: any) => r.id).sort())
            .toEqual([two.id, three.id].sort());
        expect((await o().findOne({ search: 'Two' }))?.name).toBe('Two');            // #4419
        await expect(o().findOne({})).rejects.toThrow(/selects no particular record/); // #4419
    });
});
