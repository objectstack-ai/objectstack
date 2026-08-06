// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5669 — the `where` SOURCE-FIELD gate, the third and last param of one defect.
 *
 * #4437 gave MEASURES a `400 INVALID_FIELD` naming the field; #5520 / PR #5667
 * gave `dimensions`/`timeDimensions` the same answer. The FILTER face — the
 * request key that most often carries a hand-typed field name — had no gate at
 * all. Measured on this harness against `origin/main` before the fix:
 *
 * ```
 * POST /analytics/query {"cube":"crm_account","measures":["count"],"where":{"bogus_col":"x"}}
 *   generateSql → SELECT COUNT(*) AS "count" FROM "crm_account" WHERE bogus_col = $1
 *   executeAggregate ← {filter: {"bogus_col":"x"}}          ← no refusal anywhere
 *
 * where: [["bogus_col","=","x"]]   (the #5334 array spelling)
 *   → the IDENTICAL statement and the IDENTICAL engine filter
 *
 * where: {$or: [{industry:"tech"}, {$and: [{bogus_nested:{$gt:1}}]}]}
 *   → WHERE (industry = $1 OR bogus_nested > $2)
 *
 * dataset face, runtimeFilter: {bogus_col: "x"}
 *   → SELECT COUNT(*) AS "account_count" FROM "crm_account" WHERE bogus_col = $1
 * ```
 *
 * On a real SQLite driver each of those is `no such column: bogus_col` with an
 * empty `code`/`status`, so the REST face falls to its 5xx backstop — a driver
 * error class on the wire for a caller-shaped typo (ADR-0112), exactly the shape
 * #4437 and #5520 were filed about.
 *
 * The blocks below pin the rejection, the dataset face, and — the half that
 * keeps the gate from over-reaching — everything it must NOT do.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Removing the three `assertWhereFields` calls from `ensureCube` turns RED every
 * case that asserts on an error only this gate produces (or on the driver never
 * being reached). Ordinary direction, no inversion: the rejection is new, and no
 * `??`-chain order was touched — the one thing that could have inverted here is
 * `resolveMemberSource`'s bag order, and `kind` is a NEW parameter, not a
 * reordered one. **Predicted 15 red / 16 green, naming the 15; measured exactly
 * that set** — as of #5669. #5739 later moved ONE case out of the red set; see
 * the third bullet.
 *
 * Two departures from "block 1+2 red, block 3 green" are deliberate, and are
 * named here rather than left for the next reader to trip over:
 *
 * - In block 1, "is answered about its MEASURE first" stays GREEN — the #4437
 *   gate produces that rejection, and the case exists to pin the ORDER, not the
 *   `where` verdict.
 * - In block 2, "the pre-fix driver error carried the statement" stays GREEN by
 *   design: it asserts the OLD behaviour on a cube the gate stands down for, the
 *   control proving this harness can still produce the leak the gate removes.
 *
 * [#5739] The third departure has since gone away, and the count with it. Block
 * 3's inference-path case pinned a VERDICT under #5669 (dotted member → the same
 * `INVALID_FIELD` the #5520 dimension gate gave), so it read green-before /
 * red-after and belonged to the red set. #5739 ruled that the ad-hoc path serves
 * the traversal, so the cube that case reads now mints `{sql: 'owner.region'}`,
 * `resolveMemberSource` answers `source: null`, and the case pins a STAND-DOWN
 * like the rest of block 3 — green in both directions. The gate's own code did
 * not move; **14 red / 17 green from #5739 onward**.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { Dataset } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

const silentLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
} as any;

const ACCOUNT_FIELDS = ['id', 'name', 'phone', 'industry', 'annual_revenue', 'assessed_at'];

/**
 * A service over one object (`crm_account`) whose columns are known.
 *
 * `aggregated` records the object + options of every aggregate that actually ran
 * and `sqls` every statement the native path built, so a test can assert the
 * rejected filter never reached the driver — which is also what proves there was
 * no generated SQL for the dataset face to echo.
 *
 * `native: true` selects the NativeSQLStrategy path and makes the driver double
 * fail the way the real one did: knex prefixes the offending statement to its
 * message (`<sql> - <cause>`), which is how the SQL got into the caller's body.
 */
function makeService(
    opts: { cubes?: Cube[]; wireProbe?: boolean; fields?: string[]; native?: boolean } = {},
) {
    const aggregated: string[] = [];
    const filters: unknown[] = [];
    const sqls: string[] = [];
    const service = new AnalyticsService({
        logger: silentLogger,
        ...(opts.cubes ? { cubes: opts.cubes } : {}),
        queryCapabilities: () => ({
            nativeSql: !!opts.native,
            objectqlAggregate: !opts.native,
            inMemory: false,
        }),
        executeAggregate: async (objectName: string, options: unknown) => {
            aggregated.push(objectName);
            filters.push((options as { filter?: unknown } | undefined)?.filter);
            return [{ account_count: 1, count: 1 }];
        },
        executeRawSql: async (objectName: string, sql: string) => {
            aggregated.push(objectName);
            sqls.push(sql);
            const bogus = /\b(bogus_col|bogus_nested|dropped_column)\b/.exec(sql)?.[1];
            if (bogus) throw new Error(`${sql} - no such column: ${bogus}`);
            return [{ account_count: 1, count: 1 }];
        },
        isRegisteredObject: (n: string) => n === 'crm_account',
        ...(opts.wireProbe === false
            ? {}
            : {
                getObjectFieldNames: (n: string) =>
                    n === 'crm_account' ? (opts.fields ?? ACCOUNT_FIELDS) : undefined,
            }),
    });
    return { service, aggregated, filters, sqls };
}

/** The error a call rejected with, typed — and a loud failure if it RESOLVED. */
async function rejection<T extends Error = Error & { code?: string }>(call: Promise<unknown>): Promise<T> {
    try {
        await call;
    } catch (e) {
        return e as T;
    }
    throw new Error('expected the call to reject, but it resolved');
}

/** How a call settled: the error it rejected with, or `{}` when it resolved. */
async function settle(call: Promise<unknown>): Promise<{ code?: string; message?: string }> {
    try {
        await call;
        return {};
    } catch (e) {
        return e as { code?: string; message?: string };
    }
}

/** The envelope the measure (#4437) and dimension (#5520) gates already produce. */
const INVALID_FIELD = {
    code: 'INVALID_FIELD',
    status: 400,
    object: 'crm_account',
    param: 'where',
};

/** The dataset behind the dataset-face repro — one declared dimension, one measure. */
const ACCOUNT_METRICS: Dataset = {
    name: 'account_metrics',
    label: 'Account metrics',
    object: 'crm_account',
    dimensions: [{ name: 'industry', field: 'industry', type: 'string' }],
    measures: [{ name: 'account_count', aggregate: 'count' }],
} as Dataset;

describe('#5669 — the gate: a `where` over a missing field is a 400, not a driver 500', () => {
    it('refuses the bare-cube path and names the field', async () => {
        const { service, aggregated } = makeService();

        await expect(
            service.query({
                cube: 'crm_account',
                measures: ['count'],
                where: { bogus_col: 'x' },
            } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'bogus_col', member: 'bogus_col' });

        // The whole point: the typo never became a WHERE column.
        expect(aggregated).toEqual([]);
    });

    it('says what the caller can act on — the field, and that undeclared real fields are fine', async () => {
        const { service } = makeService();

        const err = await rejection(
            service.query({ cube: 'crm_account', measures: ['count'], where: { bogus_col: 'x' } } as any),
        );

        expect(err.message).toMatch(/Filter member 'bogus_col' in 'where'/);
        expect(err.message).toMatch(/constrains field 'bogus_col'/);
        expect(err.message).toMatch(/object 'crm_account' does not have/);
        // The known-fields list is what turns a typo into a one-look fix.
        expect(err.message).toMatch(/known fields: annual_revenue, assessed_at, id, industry, name, phone\./);
        // And the message states the contract the third block pins, so a caller is
        // not left thinking a field must be declared as a dimension to be filtered.
        expect(err.message).toMatch(/may also be filtered on without the cube declaring it/);
    });

    it('does not offer the caller their own typo back as a valid filter member', async () => {
        // `inferCubeFromQuery` mints the `where`'s top-level keys into
        // `cube.dimensions`, so echoing that bag verbatim would suggest
        // `bogus_col` — the one alternative guaranteed not to work.
        const { service } = makeService();

        const err = await rejection(
            service.query({
                cube: 'crm_account',
                measures: ['count'],
                dimensions: ['industry'],
                where: { bogus_col: 'x' },
            } as any),
        );

        expect(err.message).toMatch(/Valid filter members: industry\./);
        expect(err.message).not.toMatch(/Valid filter members:[^.]*bogus_col/);
    });

    it('reports `(none)` rather than an empty list when nothing survives', async () => {
        const { service } = makeService();

        const err = await rejection(
            service.query({ cube: 'crm_account', measures: ['count'], where: { bogus_col: 'x' } } as any),
        );

        expect(err.message).toMatch(/Valid filter members: \(none\)\./);
    });

    it('finds a member nested under $or / $and, because a predicate under a disjunction still names a column', async () => {
        // Measured before the fix: `WHERE (industry = $1 OR bogus_nested > $2)`.
        // `collectFilterLeaves` discards structure on purpose — whether a
        // predicate sits under an `$or` changes nothing about column existence.
        const { service, aggregated } = makeService();

        await expect(
            service.query({
                cube: 'crm_account',
                measures: ['count'],
                where: { $or: [{ industry: 'tech' }, { $and: [{ bogus_nested: { $gt: 1 } }] }] },
            } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'bogus_nested', member: 'bogus_nested' });

        expect(aggregated).toEqual([]);
    });

    it('finds a member under $not, whose operand the normalizer REWRITES before compiling', async () => {
        // #5146's null-safe rewrite rebuilds the `$not` operand; the guard it adds
        // rides the same member, so reading the tree after the rewrite still sees
        // the caller's own field name.
        const { service, aggregated } = makeService();

        await expect(
            service.query({
                cube: 'crm_account',
                measures: ['count'],
                where: { $not: { bogus_col: 'x' } },
            } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'bogus_col' });

        expect(aggregated).toEqual([]);
    });

    it('finds a member behind $between, which LOWERS to two bounds', async () => {
        const { service, aggregated } = makeService();

        await expect(
            service.query({
                cube: 'crm_account',
                measures: ['count'],
                where: { bogus_col: { $between: [1, 5] } },
            } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'bogus_col' });

        expect(aggregated).toEqual([]);
    });

    it('gates the #5334 ARRAY spelling too — it compiles to the identical predicate', async () => {
        // Measured on `origin/main`: `where: [['bogus_col','=','x']]` and
        // `where: {bogus_col:'x'}` both produced
        // `WHERE bogus_col = $1` and handed `executeAggregate` the same
        // `{bogus_col: 'x'}`. `inferCubeFromQuery` skipping array `where` (#5353)
        // is about the ad-hoc cube's dimension VOCABULARY, not about which
        // columns reach the driver — so gating one spelling and not the other
        // would answer ONE mistake two ways.
        const { service, aggregated } = makeService();

        await expect(
            service.query({
                cube: 'crm_account',
                measures: ['count'],
                where: [['bogus_col', '=', 'x']],
            } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'bogus_col' });

        expect(aggregated).toEqual([]);
    });

    it('does not poison the registry with the rejected cube', async () => {
        // Same rule the #3867 inference gate and the #4437 / #5520 gates keep: a
        // rejected query must leave no trace, or the retry finds a "registered"
        // cube and sails straight into SQL.
        const { service, aggregated } = makeService();

        await expect(
            service.query({ cube: 'crm_account', measures: ['count'], where: { bogus_col: 'x' } } as any),
        ).rejects.toThrow();
        expect(service.cubeRegistry.get('crm_account')).toBeUndefined();

        await expect(
            service.query({ cube: 'crm_account', measures: ['count'], where: { bogus_col: 'x' } } as any),
        ).rejects.toMatchObject(INVALID_FIELD);
        expect(aggregated).toEqual([]);
    });

    it('gates generateSql too, not just query', async () => {
        // `/analytics/sql` runs the same `ensureCube`; leaving it ungated would
        // hand back SQL filtering on a column that does not exist — which is
        // literally the string the premise probe captured.
        const { service } = makeService();

        await expect(
            service.generateSql({
                cube: 'crm_account',
                measures: ['count'],
                where: { bogus_col: 'x' },
            } as any),
        ).rejects.toMatchObject(INVALID_FIELD);
    });

    it('validates an AUTHORED cube whose declared dimension lost its column', async () => {
        // An authored cube is not second-guessed about WHICH table it reads
        // (#3867), but filtering on a dimension it declares over a dropped column
        // is the same caller-visible 500 — and here the suggestion list is real.
        const authored: Cube = {
            name: 'account_cube',
            title: 'Accounts',
            sql: 'crm_account',
            measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
            dimensions: {
                industry: { name: 'industry', label: 'Industry', type: 'string', sql: 'industry' },
                legacy: { name: 'legacy', label: 'Legacy', type: 'string', sql: 'dropped_column' },
            },
            public: false,
        };
        const { service, aggregated } = makeService({ cubes: [authored] });

        // The member is what the caller wrote; the field is the column it resolves
        // to — the two differ here, which is why both are reported.
        await expect(
            service.query({ cube: 'account_cube', measures: ['count'], where: { legacy: 'x' } } as any),
        ).rejects.toMatchObject({
            ...INVALID_FIELD,
            field: 'dropped_column',
            member: 'legacy',
        });
        expect(aggregated).toEqual([]);

        // Its healthy sibling still filters, and is what the rejection suggests.
        await service.query({ cube: 'account_cube', measures: ['count'], where: { industry: 'tech' } } as any);
        expect(aggregated).toEqual(['crm_account']);
    });

    it('is answered about its MEASURE first when a query gets both wrong', async () => {
        // Request-key order (measures → dimensions → where): one rejection at a
        // time, naming a real mistake either way.
        const { service } = makeService();

        await expect(
            service.query({
                cube: 'crm_account',
                measures: ['ghost_sum'],
                where: { bogus_col: 'x' },
            } as any),
        ).rejects.toMatchObject({ code: 'INVALID_FIELD', param: 'measures', field: 'ghost' });
    });
});

describe('#5669 — the dataset face: refused before SQL exists, so nothing can echo it', () => {
    it('refuses a bogus `runtimeFilter` field with the same envelope', async () => {
        const { service, aggregated, sqls } = makeService({ native: true });

        await expect(
            service.queryDataset(ACCOUNT_METRICS, {
                measures: ['account_count'],
                runtimeFilter: { bogus_col: 'x' },
            } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'bogus_col', member: 'bogus_col' });

        // No statement was ever built, so there is no SQL for the REST envelope to
        // echo. (`rest-server`'s 500 branch is sanitised as well — see
        // `analytics-dataset-where-gate.test.ts` — but the driver error that
        // carried the statement no longer happens.)
        expect(sqls).toEqual([]);
        expect(aggregated).toEqual([]);
    });

    it('refuses a DATASET-declared filter over a dropped column', async () => {
        // Measured before the fix: `WHERE dropped_column = $1`. A dataset whose
        // object dropped a column its declared filter still names is the authored
        // half of the same mistake.
        const stale: Dataset = { ...ACCOUNT_METRICS, filter: { dropped_column: 'x' } } as Dataset;
        const { service, sqls } = makeService({ native: true });

        await expect(
            service.queryDataset(stale, { measures: ['account_count'] } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'dropped_column' });

        expect(sqls).toEqual([]);
    });

    it('the rejection message itself contains no generated SQL', async () => {
        const { service } = makeService({ native: true });

        const err = await rejection(
            service.queryDataset(ACCOUNT_METRICS, {
                measures: ['account_count'],
                runtimeFilter: { bogus_col: 'x' },
            } as any),
        );

        // It names the object and the field — a caller-shaped fact — and neither a
        // SELECT list, a quoted table name, a bound parameter, nor the driver's
        // own words. Note it DOES contain the word `where`: that is the REQUEST
        // KEY the caller must fix, which is caller vocabulary, not a SQL clause —
        // so the assertion is on the clause shape, not on the word.
        expect(err.message).toContain("object 'crm_account' does not have");
        expect(err.message).not.toMatch(/SELECT/i);
        expect(err.message).not.toMatch(/FROM "/);
        expect(err.message).not.toMatch(/WHERE\s+\S+\s*[=<>]/i);
        expect(err.message).not.toMatch(/\$\d/);
        expect(err.message).not.toMatch(/no such column/);
    });

    it('is the whole reason the leak was reachable: the pre-fix driver error carried the statement', async () => {
        // The control: with a cube the gate stands down for, the SAME harness
        // still produces the knex-shaped `<sql> - <cause>` message that used to
        // reach callers verbatim. Green before and after the change.
        const derived: Cube = {
            name: 'derived_cube',
            title: 'Derived',
            sql: 'SELECT * FROM crm_account',
            measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
            dimensions: {},
            public: false,
        };
        const { service } = makeService({ cubes: [derived], native: true });

        const err = await rejection(
            service.query({ cube: 'derived_cube', measures: ['count'], where: { bogus_col: 'x' } } as any),
        );

        expect(err.code).toBeUndefined();
        expect(err.message).toMatch(/^SELECT /);
        expect(err.message).toMatch(/no such column: bogus_col/);
    });
});

describe('#5669 — what the gate must NOT do', () => {
    it('lets an UNDECLARED but REAL field be filtered on', async () => {
        // `where: {phone: 'x'}` on a cube that declares no `phone` dimension
        // returned 200 before this change — the filter twin of the contract #5520
        // preserved for dimensions. The gate asks "does the OBJECT have this
        // field", never "did the cube declare it".
        const { service, aggregated, filters } = makeService();

        const result = await service.query({
            cube: 'crm_account',
            measures: ['count'],
            where: { phone: '555' },
        } as any);

        expect(result.rows).toHaveLength(1);
        expect(aggregated).toEqual(['crm_account']);
        expect(filters).toEqual([{ phone: '555' }]);
    });

    it('lets a real field be filtered on through the dataset face', async () => {
        const { service, sqls } = makeService({ native: true });

        await service.queryDataset(ACCOUNT_METRICS, {
            measures: ['account_count'],
            runtimeFilter: { industry: 'tech' },
        } as any);

        expect(sqls).toEqual([
            'SELECT COUNT(*) AS "account_count" FROM "crm_account" WHERE industry = $1',
        ]);
    });

    it('admits the engine-assigned columns the data path admits', async () => {
        // `id`/`created_at`/`updated_at` are engine-assigned rather than declared
        // (`resolveQueryFields` on the data path admits them unconditionally); a
        // gate stricter than the engine it guards would reject working queries.
        const { service, aggregated } = makeService({ fields: ['name'] });

        await service.query({
            cube: 'crm_account',
            measures: ['count'],
            where: { $and: [{ id: 'a1' }, { created_at: { $gte: '2026-01-01' } }, { updated_at: { $null: false } }] },
        } as any);

        expect(aggregated).toEqual(['crm_account']);
    });

    it('follows a declared dimension to its real column, not to its own name', async () => {
        // Dimension `assessed` → column `assessed_at`. Checking the member name
        // would reject a perfectly good authored cube.
        const authored: Cube = {
            name: 'renamed_cube',
            title: 'Renamed',
            sql: 'crm_account',
            measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
            dimensions: {
                assessed: { name: 'assessed', label: 'Assessed', type: 'time', sql: 'assessed_at' },
            },
            public: false,
        };
        const { service, aggregated, filters } = makeService({ cubes: [authored] });

        await service.query({ cube: 'renamed_cube', measures: ['count'], where: { assessed: '2026-01-01' } } as any);

        expect(aggregated).toEqual(['crm_account']);
        // Measured on `origin/main`, and unchanged: the engine gets the COLUMN.
        expect(filters).toEqual([{ assessed_at: '2026-01-01' }]);
    });

    it('follows a declared MEASURE to its column too, because a filter member resolves through both bags', async () => {
        // The false positive a dimensions-only lookup would have created. Measured
        // on `origin/main`: a cube declaring `measures.revenue = {sql:
        // 'annual_revenue'}` answers `where: {revenue: {$gt: 100}}` as
        // `annual_revenue > $1` on BOTH strategies — `resolveFieldSql` and
        // `resolveFieldName(…, 'any')` both fall through to `cube.measures`. A
        // gate that read dimensions only would have called `revenue` a missing
        // column and 400'd a working query.
        const authored: Cube = {
            name: 'measure_cube',
            title: 'Measures',
            sql: 'crm_account',
            measures: {
                count: { name: 'count', label: 'Count', type: 'count', sql: '*' },
                revenue: { name: 'revenue', label: 'Revenue', type: 'sum', sql: 'annual_revenue' },
            },
            dimensions: {},
            public: false,
        };
        const { service, aggregated, filters } = makeService({ cubes: [authored] });

        await service.query({ cube: 'measure_cube', measures: ['count'], where: { revenue: { $gt: 100 } } } as any);

        expect(aggregated).toEqual(['crm_account']);
        expect(filters).toEqual([{ annual_revenue: { $gt: 100 } }]);
    });

    it('accepts the canonical `<cube>.<field>` qualifier', async () => {
        const { service, aggregated } = makeService();

        await service.query({
            cube: 'crm_account',
            measures: ['count'],
            where: { 'crm_account.industry': 'tech' },
        } as any);

        expect(aggregated).toEqual(['crm_account']);
    });

    it('leaves a cube whose `sql` is an expression alone — no field list to check', async () => {
        const derived: Cube = {
            name: 'derived_cube',
            title: 'Derived',
            sql: 'SELECT * FROM crm_account WHERE active = 1',
            measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
            dimensions: {},
            public: false,
        };
        const { service } = makeService({ cubes: [derived] });

        await expect(
            service.query({ cube: 'derived_cube', measures: ['count'], where: { anything: 1 } } as any),
        ).resolves.toBeTruthy();
    });

    it('leaves a dotted relation filter on an AUTHORED cube to the layers that own it', async () => {
        // `owner.region` resolves through a JOIN this gate cannot see — `region`
        // may well be a column of the RELATED object, and reporting it as missing
        // from `crm_account` would be a lie. Whether the query can run is the
        // strategy's call and the join allowlist's (ADR-0021 D-C); either way the
        // answer must not be this gate's INVALID_FIELD. Measured on both
        // strategies: NativeSQL joins it
        // (`LEFT JOIN "owner" … WHERE "owner"."region" = $1`), ObjectQL declines it
        // with its own cross-object message.
        const joined: Cube = {
            name: 'joined_cube',
            title: 'Joined',
            sql: 'crm_account',
            measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
            dimensions: {},
            public: false,
        };
        const { service } = makeService({ cubes: [joined] });

        const settled = await settle(
            service.query({ cube: 'joined_cube', measures: ['count'], where: { 'owner.region': 'NA' } } as any),
        );

        expect(settled.code).not.toBe('INVALID_FIELD');
    });

    it('reads a NESTED relation filter as the same dotted member the strategies do', async () => {
        // `{owner: {region: 'NA'}}` is the object spelling of the same traversal —
        // `fieldLeaves` flattens it to the member `owner.region`, so reading the
        // TREE (rather than the raw top-level keys) is what keeps the two
        // spellings judged alike. A gate over raw keys would have judged `owner`,
        // a field the object does not have, and 400'd a legal relation filter;
        // measured here, both spellings reach ObjectQL's identical cross-object
        // decline instead.
        const joined: Cube = {
            name: 'joined_cube',
            title: 'Joined',
            sql: 'crm_account',
            measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
            dimensions: {},
            public: false,
        };
        const { service } = makeService({ cubes: [joined] });

        const settled = await settle(
            service.query({ cube: 'joined_cube', measures: ['count'], where: { owner: { region: 'NA' } } } as any),
        );

        expect(settled.code).not.toBe('INVALID_FIELD');
        expect(settled.message).toMatch(/cross-object filter \("owner\.region"\)/);
    });

    it('stands down for a dotted member on the INFERENCE path, exactly as the shipped dimension gate does', async () => {
        // The invariant this case exists for is unchanged: ONE dotted member gets
        // ONE answer across the `where` and `dimensions` request keys, because both
        // resolve through `resolveMemberSource`. What the answer IS changed once,
        // for both keys at the same time — which is precisely what the shared
        // resolution was built to guarantee.
        //
        // Until #5739, `inferCubeFromQuery` minted `stripPrefix(member)` — `region`
        // — as a dimension, `lookupMember`'s legacy second-segment lookup found it,
        // and the member resolved to BASE column `region`; both keys answered
        // `INVALID_FIELD` naming a field the caller never wrote (and, where the
        // base HAD a `region` column, filtered/grouped it silently). The maintainer
        // ruled on 2026-08-06 that the ad-hoc path serves the traversal, so the
        // mint is now verbatim (`{sql: 'owner.region'}`), `BARE_IDENTIFIER` rejects
        // the dotted `sql`, and `resolveMemberSource` answers `source: null` — this
        // gate stands down on both keys, as it always has for a relation traversal
        // on an AUTHORED cube (the two cases above).
        //
        // The gate's own code is untouched by #5739; what moved is the cube it
        // reads. Both keys are asserted here for that reason.
        const { service, aggregated } = makeService({ native: true });

        const viaWhere = await settle(
            service.query({ cube: 'crm_account', measures: ['count'], where: { 'owner.region': 'NA' } } as any),
        );
        const viaDimension = await settle(
            service.query({ cube: 'crm_account', measures: ['count'], dimensions: ['owner.region'] } as any),
        );

        expect(viaWhere.code).not.toBe('INVALID_FIELD');
        expect(viaDimension.code).not.toBe('INVALID_FIELD');
        // Load-bearing rather than a bare "not refused": the queries reached the
        // driver, and what they compiled to is the traversal — not the base column
        // the gate used to report as missing.
        expect(aggregated).toEqual(['crm_account', 'crm_account']);
        expect(viaWhere.message).toBeUndefined();
        expect(viaDimension.message).toBeUndefined();
    });

    it('leaves a declared dimension whose `sql` is an expression alone', async () => {
        const computed: Cube = {
            name: 'computed_cube',
            title: 'Computed',
            sql: 'crm_account',
            measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
            dimensions: {
                bucket: {
                    name: 'bucket',
                    label: 'Bucket',
                    type: 'string',
                    sql: "CASE WHEN annual_revenue > 0 THEN 'yes' ELSE 'no' END",
                },
            },
            public: false,
        };
        const { service } = makeService({ cubes: [computed] });

        await expect(
            service.query({ cube: 'computed_cube', measures: ['count'], where: { bucket: 'yes' } } as any),
        ).resolves.toBeTruthy();
    });

    it('stands down when no field probe is configured — nothing to consult', async () => {
        // Same tiering as the #3867 registry gate and the #4437 / #5520 gates: with
        // no source of truth the question cannot be answered, and failing closed
        // would break every embedding that runs analytics without a data engine.
        const { service, aggregated } = makeService({ wireProbe: false });

        await service.query({ cube: 'crm_account', measures: ['count'], where: { bogus_col: 'x' } } as any);

        expect(aggregated).toEqual(['crm_account']);
    });

    it('does not touch a query with no `where` at all', async () => {
        const { service, aggregated } = makeService();

        await service.query({ cube: 'crm_account', measures: ['count'] } as any);

        expect(aggregated).toEqual(['crm_account']);
    });

    it('leaves the boolean-identity `where` shapes exactly as #5322 / #5325 ruled them', async () => {
        // `{}`, `[]`, `{$and: []}`, `{$or: []}` name no column at all, so a field
        // gate has nothing to say about them and must not invent an answer. All
        // four resolved before this change; the `$or: []` one is FALSE (zero rows)
        // and still runs.
        const { service } = makeService();

        for (const where of [{}, [], { $and: [] }, { $or: [] }]) {
            const settled = await settle(
                service.query({ cube: 'crm_account', measures: ['count'], where } as any),
            );
            expect(settled.code).toBeUndefined();
        }
    });

    it('does not move the INVALID_FILTER refusals this gate cannot read', async () => {
        // #5352/#5367's geography, not this gate's: an unknown operator, a
        // zero-operator field constraint, an unlowerable infix array and an
        // unknown top-level combinator each still answer `INVALID_FILTER`/400 from
        // where they already did. The gate stands down on a tree it cannot read
        // rather than pulling those refusals forward into `ensureCube` — which
        // would also newly refuse them on the draft-preview path, whose
        // `matchesWhere` never consults the normalizer.
        const { service } = makeService();

        for (const where of [
            { industry: { $sounds_like: 'x' } },
            { industry: {} },
            [{ industry: 'tech' }, 'or', { industry: 'saas' }],
            { $weird: 1 },
        ]) {
            const settled = await settle(
                service.query({ cube: 'crm_account', measures: ['count'], where } as any),
            );
            expect(settled.code).toBe('INVALID_FILTER');
        }
    });
});
