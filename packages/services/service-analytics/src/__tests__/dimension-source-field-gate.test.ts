// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5520 — the dimension SOURCE-FIELD gate, the symmetric half of #4437.
 *
 * #4437 gave MEASURES a `400 INVALID_FIELD` naming the field, and stopped there.
 * The identical mistake one request key over kept reaching the driver, on both
 * analytics faces. Live repro on hotcrm + 17.0.0-rc.2 (SQLite file driver)
 * before the fix:
 *
 * ```
 * POST /analytics/query {"cube":"account_metrics","measures":["account_count"],"dimensions":["bogus_dim"]}
 * → 500 {"code":"SQLITE_ERROR","message":"Internal server error"}
 *
 * POST /analytics/dataset/query {"datasetName":"account_metrics",
 *                               "selection":{"measures":["account_count"],"dimensions":["bogus_dim"]}}
 * → 500 {"code":"ANALYTICS_QUERY_FAILED",
 *        "error":"SELECT bogus_dim AS \"bogus_dim\", COUNT(*) AS \"account_count\"
 *                 FROM \"crm_account\" GROUP BY bogus_dim - no such column: bogus_dim"}
 * ```
 *
 * — while the measure control group on the very same route answered a clean
 * 400. Two ADR-0112 faults for one caller typo: a driver error class as the
 * caller's `error.code`, and (on the dataset face) the generated statement,
 * physical table and column names included, echoed back to the caller.
 *
 * The cases below pin three things: the rejection itself on BOTH paths, that a
 * rejected query never reaches the driver (so no statement exists to echo), and
 * — the guard that keeps the gate from over-reaching — that grouping by a REAL
 * field the cube never declared still works, because that is the established
 * contract and the dimension twin of measure auto-inference.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Removing the three `assertDimensionFields` calls from `ensureCube` turns RED
 * every case in the first two blocks that asserts on the rejection — they assert
 * on an error only the gate produces — and leaves the third block ("what the
 * gate must NOT do") GREEN, because those cases assert the pre-#5520 behaviour
 * this change preserves. Ordinary direction, no inversion: the rejection is new,
 * and no `??`-chain order was touched. Predicted 10 red / 12 green; measured
 * exactly that.
 *
 * The one case that survives the mutation inside the second block is deliberate:
 * "the pre-fix driver error carried the statement" asserts the OLD behaviour on
 * a cube the gate stands down for, so it is green before and after — it is the
 * control that proves the harness can still produce the leak this gate removes.
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
 * `aggregated` records every object an aggregate actually ran against and `sqls`
 * every statement the native path built, so a test can assert the rejected query
 * never reached the driver — which is also what proves there was no generated
 * SQL for the dataset face to echo.
 *
 * `native: true` selects the NativeSQLStrategy path and makes the driver double
 * fail the way the real one did: knex prefixes the offending statement to its
 * message (`<sql> - <cause>`), which is exactly how the SQL got into the
 * caller's response body.
 */
function makeService(
    opts: { cubes?: Cube[]; wireProbe?: boolean; fields?: string[]; native?: boolean } = {},
) {
    const aggregated: string[] = [];
    const sqls: string[] = [];
    const service = new AnalyticsService({
        logger: silentLogger,
        ...(opts.cubes ? { cubes: opts.cubes } : {}),
        queryCapabilities: () => ({
            nativeSql: !!opts.native,
            objectqlAggregate: !opts.native,
            inMemory: false,
        }),
        executeAggregate: async (objectName: string) => {
            aggregated.push(objectName);
            return [{ account_count: 1 }];
        },
        executeRawSql: async (objectName: string, sql: string) => {
            aggregated.push(objectName);
            sqls.push(sql);
            const bogus = /\b(bogus_dim|bogus_at|dropped_column)\b/.exec(sql)?.[1];
            if (bogus) throw new Error(`${sql} - no such column: ${bogus}`);
            return [{ account_count: 1 }];
        },
        isRegisteredObject: (n: string) => n === 'crm_account',
        ...(opts.wireProbe === false
            ? {}
            : {
                getObjectFieldNames: (n: string) =>
                    n === 'crm_account' ? (opts.fields ?? ACCOUNT_FIELDS) : undefined,
            }),
    });
    return { service, aggregated, sqls };
}

/**
 * The error a call rejected with, typed — and a loud failure if it RESOLVED.
 *
 * `.catch((e) => e as Error)` (the sibling measure-gate file's spelling) widens
 * the awaited value to `Error | AnalyticsResult`, on which `.message` type-checks
 * as neither: four frozen TS2339s in `tsc --noEmit`. That debt is #4311's, not
 * worth reworking someone else's file for — but a new file must not add to it.
 */
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

/** The envelope the measure gate already produces for the same mistake (#4437). */
const INVALID_FIELD = {
    code: 'INVALID_FIELD',
    status: 400,
    object: 'crm_account',
    param: 'dimensions',
};

/** The dataset behind repro ③ — one declared dimension, one declared measure. */
const ACCOUNT_METRICS: Dataset = {
    name: 'account_metrics',
    label: 'Account metrics',
    object: 'crm_account',
    dimensions: [{ name: 'industry', field: 'industry', type: 'string' }],
    measures: [{ name: 'account_count', aggregate: 'count' }],
} as Dataset;

describe('#5520 — the gate: a dimension over a missing field is a 400, not a driver 500', () => {
    it('refuses the bare-cube path (repro ①) and names the field', async () => {
        const { service, aggregated } = makeService();

        await expect(
            service.query({
                cube: 'crm_account',
                measures: ['count'],
                dimensions: ['bogus_dim'],
            } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'bogus_dim', dimension: 'bogus_dim' });

        // The whole point: the typo never became a `GROUP BY` column.
        expect(aggregated).toEqual([]);
    });

    it('says what the caller can act on — the field, and that undeclared real fields are fine', async () => {
        const { service } = makeService();

        const err = await rejection(
            service.query({ cube: 'crm_account', measures: ['count'], dimensions: ['bogus_dim'] } as any),
        );

        expect(err.message).toMatch(/groups by field 'bogus_dim'/);
        expect(err.message).toMatch(/object 'crm_account' does not have/);
        // The known-fields list is what turns a typo into a one-look fix.
        expect(err.message).toMatch(/known fields: annual_revenue, assessed_at, id, industry, name, phone\./);
        // And the message states the contract the guard cases below pin, so a
        // caller is not left thinking they must declare a dimension first.
        expect(err.message).toMatch(/may also be used as a dimension without the cube declaring it/);
    });

    it('does not offer the caller their own typo back as a valid dimension', async () => {
        // On the auto-inference path the bogus dimension is already in
        // `cube.dimensions` (it was minted from this very query), so echoing the
        // cube's dimension list verbatim would suggest `bogus_dim` — the one
        // alternative guaranteed not to work.
        const { service } = makeService();

        const err = await rejection(
            service.query({
                cube: 'crm_account',
                measures: ['count'],
                dimensions: ['industry', 'bogus_dim'],
            } as any),
        );

        expect(err.message).toMatch(/Valid dimensions: industry\./);
        expect(err.message).not.toMatch(/Valid dimensions:[^.]*bogus_dim/);
    });

    it('reports `(none)` rather than an empty list when nothing survives', async () => {
        const { service } = makeService();

        const err = await rejection(
            service.query({ cube: 'crm_account', measures: ['count'], dimensions: ['bogus_dim'] } as any),
        );

        expect(err.message).toMatch(/Valid dimensions: \(none\)\./);
    });

    it('refuses a bogus TIME dimension too, naming that request key', async () => {
        // Same bag (`cube.dimensions`), same `lookupMember`, same 500 before the
        // fix — `date_trunc('month', bogus_at)` on a column that does not exist.
        // Only `param` differs, because that is the key the caller must fix.
        const { service, aggregated } = makeService();

        await expect(
            service.query({
                cube: 'crm_account',
                measures: ['count'],
                timeDimensions: [{ dimension: 'bogus_at', granularity: 'month' }],
            } as any),
        ).rejects.toMatchObject({
            code: 'INVALID_FIELD',
            status: 400,
            object: 'crm_account',
            param: 'timeDimensions',
            field: 'bogus_at',
            dimension: 'bogus_at',
        });
        expect(aggregated).toEqual([]);
    });

    it('does not poison the registry with the rejected cube', async () => {
        // Same rule the #3867 inference gate and the #4437 measure gate keep: a
        // rejected query must leave no trace, or the retry finds a "registered"
        // cube carrying the bogus dimension and sails straight into SQL.
        const { service, aggregated } = makeService();

        await expect(
            service.query({ cube: 'crm_account', measures: ['count'], dimensions: ['bogus_dim'] } as any),
        ).rejects.toThrow();
        expect(service.cubeRegistry.get('crm_account')).toBeUndefined();

        await expect(
            service.query({ cube: 'crm_account', measures: ['count'], dimensions: ['bogus_dim'] } as any),
        ).rejects.toMatchObject(INVALID_FIELD);
        expect(aggregated).toEqual([]);
    });

    it('gates generateSql too, not just query', async () => {
        // `/analytics/sql` runs the same `ensureCube`; leaving it ungated would
        // hand back SQL grouping by a column that does not exist.
        const { service } = makeService();

        await expect(
            service.generateSql({
                cube: 'crm_account',
                measures: ['count'],
                dimensions: ['bogus_dim'],
            } as any),
        ).rejects.toMatchObject(INVALID_FIELD);
    });

    it('validates an AUTHORED cube whose declared dimension lost its column', async () => {
        // An authored cube is not second-guessed about WHICH table it reads
        // (#3867), but a dimension it declares over a dropped column is the same
        // caller-visible 500 — and here the suggestion list is real.
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

        await expect(
            service.query({ cube: 'account_cube', measures: ['count'], dimensions: ['legacy'] } as any),
        ).rejects.toMatchObject({
            ...INVALID_FIELD,
            field: 'dropped_column',
            dimension: 'legacy',
        });
        expect(aggregated).toEqual([]);

        // Its healthy sibling still groups, and is what the rejection suggests.
        await service.query({ cube: 'account_cube', measures: ['count'], dimensions: ['industry'] } as any);
        expect(aggregated).toEqual(['crm_account']);
    });
});

describe('#5520 — the dataset face: refused before SQL exists, so nothing can echo it', () => {
    it('refuses a bogus selection dimension (repro ③) with the same envelope', async () => {
        const { service, aggregated, sqls } = makeService({ native: true });

        await expect(
            service.queryDataset(ACCOUNT_METRICS, {
                measures: ['account_count'],
                dimensions: ['bogus_dim'],
            } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'bogus_dim', dimension: 'bogus_dim' });

        // Repro ③'s leak, at its source: no statement was ever built, so there is
        // no SQL for the REST envelope to echo. (`rest-server`'s 500 branch is
        // sanitised as well — see `analytics-dataset-dimension-gate.test.ts` —
        // but the driver error that carried the statement no longer happens.)
        expect(sqls).toEqual([]);
        expect(aggregated).toEqual([]);
    });

    it('the rejection message itself contains no generated SQL', async () => {
        const { service } = makeService({ native: true });

        const err = await rejection(
            service.queryDataset(ACCOUNT_METRICS, {
                measures: ['account_count'],
                dimensions: ['bogus_dim'],
            } as any),
        );

        // It names the object and the field — a caller-shaped fact — and neither
        // a SELECT list, a quoted table name, nor a GROUP BY clause.
        expect(err.message).toContain("object 'crm_account' does not have");
        expect(err.message).not.toMatch(/SELECT/i);
        expect(err.message).not.toMatch(/GROUP BY/i);
        expect(err.message).not.toMatch(/no such column/);
    });

    it('is the whole reason the leak was reachable: the pre-fix driver error carried the statement', async () => {
        // The control: with a dimension the gate cannot judge, the SAME harness
        // still produces the knex-shaped `<sql> - <cause>` message that used to
        // reach callers verbatim. This is what the gate removes for a caller typo
        // and what `looksLikeInternalErrorLeak` withholds for everything else.
        const derived: Cube = {
            name: 'derived_cube',
            title: 'Derived',
            sql: 'SELECT * FROM crm_account',
            measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
            dimensions: {
                bogus_dim: { name: 'bogus_dim', label: 'x', type: 'string', sql: 'bogus_dim' },
            },
            public: false,
        };
        const { service } = makeService({ cubes: [derived], native: true });

        const err = await rejection(
            service.query({ cube: 'derived_cube', measures: ['count'], dimensions: ['bogus_dim'] } as any),
        );

        expect(err.code).toBeUndefined();
        expect(err.message).toMatch(/^SELECT /);
        expect(err.message).toMatch(/no such column: bogus_dim/);
    });
});

describe('#5520 — what the gate must NOT do', () => {
    it('lets an UNDECLARED but REAL field group, on the bare-cube path', async () => {
        // `dimensions: ['phone']` on a cube that declares no `phone` is an
        // established contract — the dimension twin of measure auto-inference —
        // and grouping by it returned 200 before this change. The gate asks
        // "does the OBJECT have this field", never "did the cube declare it".
        const { service, aggregated } = makeService();

        const result = await service.query({
            cube: 'crm_account',
            measures: ['count'],
            dimensions: ['phone'],
        } as any);

        expect(result.rows).toHaveLength(1);
        expect(result.fields.map((f) => f.name)).toContain('phone');
        expect(aggregated).toEqual(['crm_account']);
    });

    it('lets an UNDECLARED but REAL field group, on the dataset path', async () => {
        // Same contract through `queryDataset`: `phone` is not one of
        // `account_metrics`' declared dimensions, and still groups.
        const { service, sqls } = makeService({ native: true });

        const result = await service.queryDataset(ACCOUNT_METRICS, {
            measures: ['account_count'],
            dimensions: ['phone'],
        } as any);

        expect(result.rows).toEqual([{ account_count: 1 }]);
        expect(sqls).toEqual([
            'SELECT phone AS "phone", COUNT(*) AS "account_count" FROM "crm_account" GROUP BY phone',
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
            dimensions: ['id', 'created_at', 'updated_at'],
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
        const { service, aggregated } = makeService({ cubes: [authored] });

        await service.query({ cube: 'renamed_cube', measures: ['count'], dimensions: ['assessed'] } as any);

        expect(aggregated).toEqual(['crm_account']);
    });

    it('accepts the canonical `<cube>.<field>` qualifier', async () => {
        const { service, aggregated } = makeService();

        await service.query({
            cube: 'crm_account',
            measures: ['count'],
            dimensions: ['crm_account.industry'],
        } as any);

        expect(aggregated).toEqual(['crm_account']);
    });

    it('leaves a cube whose `sql` is an expression alone — no field list to check', async () => {
        // `sql` is a subquery, not an object name: there is no schema to consult,
        // and guessing would reject perfectly good authored analytics.
        const derived: Cube = {
            name: 'derived_cube',
            title: 'Derived',
            sql: 'SELECT * FROM crm_account WHERE active = 1',
            measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
            dimensions: {
                anything: { name: 'anything', label: 'x', type: 'string', sql: 'anything' },
            },
            public: false,
        };
        const { service } = makeService({ cubes: [derived] });

        await expect(
            service.query({ cube: 'derived_cube', measures: ['count'], dimensions: ['anything'] } as any),
        ).resolves.toBeTruthy();
    });

    it('leaves a dotted relation dimension to the layers that own it', async () => {
        // `account.industry` resolves through a JOIN this gate cannot see —
        // `industry` may well be a column of the RELATED object, and reporting it
        // as missing from `crm_account` would be a lie. Whether the query can run
        // is the strategy's call and the join allowlist's (ADR-0021 D-C); either
        // way the answer must not be this gate's INVALID_FIELD.
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
            service.query({ cube: 'joined_cube', measures: ['count'], dimensions: ['owner.region'] } as any),
        );

        // Either it ran, or it was declined by the join layer — but never here.
        expect(settled.code).not.toBe('INVALID_FIELD');
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
            service.query({ cube: 'computed_cube', measures: ['count'], dimensions: ['bucket'] } as any),
        ).resolves.toBeTruthy();
    });

    it('stands down when no field probe is configured — nothing to consult', async () => {
        // Same tiering as the #3867 registry gate, the #4437 measure gate and the
        // data path's `resolveQueryFields`: with no source of truth the question
        // cannot be answered, and failing closed would break every embedding that
        // runs analytics without a data engine.
        const { service, aggregated } = makeService({ wireProbe: false });

        await service.query({ cube: 'crm_account', measures: ['count'], dimensions: ['bogus_dim'] } as any);

        expect(aggregated).toEqual(['crm_account']);
    });

    it('stands down for an object the probe cannot describe', async () => {
        // An external datasource whose columns are not mirrored locally answers
        // `undefined` — "cannot answer", not "has no fields".
        const external: Cube = {
            name: 'external_cube',
            title: 'External',
            sql: 'remote_table',
            measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
            dimensions: {
                ghost: { name: 'ghost', label: 'x', type: 'string', sql: 'ghost' },
            },
            public: false,
        };
        const { service } = makeService({ cubes: [external] });

        await expect(
            service.query({ cube: 'external_cube', measures: ['count'], dimensions: ['ghost'] } as any),
        ).resolves.toBeTruthy();
    });

    it('still answers about the MEASURE first when a query gets both wrong', async () => {
        // One rejection at a time, and #4437's is the one that was already
        // load-bearing for callers — so its envelope does not move.
        const { service } = makeService();

        await expect(
            service.query({
                cube: 'crm_account',
                measures: ['ghost_sum'],
                dimensions: ['bogus_dim'],
            } as any),
        ).rejects.toMatchObject({
            code: 'INVALID_FIELD',
            status: 400,
            param: 'measures',
            field: 'ghost',
        });
    });
});
