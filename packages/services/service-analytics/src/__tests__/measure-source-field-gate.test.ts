// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4437 — the measure SOURCE-FIELD gate.
 *
 * `inferMeasure` maps a suffix convention onto a field name and cannot know
 * whether that field exists: `ghost_sum` happily became `SUM(ghost)`, the
 * driver threw `no such column`, and the caller got a driver error class on
 * the wire for what is a plain typo. Live repro on a showcase dev server
 * before the fix:
 *
 * ```
 * POST /analytics/query {"cube":"showcase_invoice","measures":["ghost_sum"]}
 * → 500 {"code":"SQLITE_ERROR","message":"Internal server error"}
 * ```
 *
 * A dotted spelling took the same path (`"total.sum"` → prefix-strip →
 * `inferMeasure('sum')` → `SUM(sum)` → 500). The DATA route has refused the
 * same mistake with a `400 INVALID_FIELD` naming the field since #4315/#4254;
 * these cases pin the analytics half of that answer, and pin the tiering that
 * keeps it from over-reaching (ADR-0112: a driver error class is never the
 * `error.code` for a caller-shaped mistake).
 *
 * [#5918] The DOTTED spelling has since left this gate. A dotted measure is
 * refused at the MINT — `mintableMeasureKey`, maintainer ruling 2026-08-07 —
 * because stripping the prefix answered the wrong question in both directions:
 * it named `sum` to a caller who wrote `total.sum`, and where the stripped tail
 * happened to be a real column it produced no verdict at all, silently
 * aggregating the base table under a relation-shaped label. Same code, same
 * status, same request key; different layer, and the message now names what the
 * caller actually sent. The case below pins that hand-off from this side; the
 * rule's own file is `dotted-measure-refusal.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';

/**
 * The refusal a query produced, typed as the Error it actually is.
 *
 * `promise.catch(fn)` does NOT drop the resolved branch from the type, so
 * `service.query(...).catch((e) => e as Error)` is `AnalyticsResult | Error`
 * and every `err.message` / `err.field` read below was a TS2339 against
 * `AnalyticsResult` -- 7 of the 10 errors this package's unwired `typecheck`
 * script hid. Narrowing once here rather than casting at each read also gives
 * the resolved branch an honest failure: a query that is NOT refused now says
 * so by name, instead of surfacing later as `expect(undefined).toMatch(...)`.
 */
type Refusal = Error & { code?: string; field?: string; member?: string; param?: string };

const refusalOf = (query: Promise<unknown>): Promise<Refusal> =>
    query.then<never, Refusal>(
        () => {
            throw new Error('expected the query to be refused, but it resolved');
        },
        (e) => e as Refusal,
    );

const silentLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
} as any;

const INVOICE_FIELDS = ['id', 'total', 'status', 'issued_on', 'account'];

/**
 * A service over one object (`showcase_invoice`) whose columns are known.
 * `aggregated` records every object an aggregate actually ran against, so a
 * test can assert the rejected query never reached the driver.
 */
function makeService(opts: { cubes?: Cube[]; wireProbe?: boolean; fields?: string[] } = {}) {
    const aggregated: string[] = [];
    const service = new AnalyticsService({
        logger: silentLogger,
        ...(opts.cubes ? { cubes: opts.cubes } : {}),
        queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
        executeAggregate: async (objectName: string) => {
            aggregated.push(objectName);
            return [{ count: 1 }];
        },
        isRegisteredObject: (n: string) => n === 'showcase_invoice',
        ...(opts.wireProbe === false
            ? {}
            : {
                getObjectFieldNames: (n: string) =>
                    n === 'showcase_invoice' ? (opts.fields ?? INVOICE_FIELDS) : undefined,
            }),
    });
    return { service, aggregated };
}

/** The envelope the DATA route already produces for the same mistake (#4315). */
const INVALID_FIELD = {
    code: 'INVALID_FIELD',
    status: 400,
    object: 'showcase_invoice',
    param: 'measures',
};

describe('#4437 — measure source-field gate', () => {
    it('refuses a measure over a missing field with a 400, not a driver 500', async () => {
        const { service, aggregated } = makeService();

        await expect(
            service.query({ cube: 'showcase_invoice', measures: ['ghost_sum'] } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'ghost', measure: 'ghost_sum' });

        // The whole point: the typo never became a column.
        expect(aggregated).toEqual([]);
    });

    it('names the missing field in the message so the caller can act on it', async () => {
        const { service } = makeService();

        await expect(
            service.query({ cube: 'showcase_invoice', measures: ['ghost_sum'] } as any),
        ).rejects.toThrow(/aggregates field 'ghost'/);
    });

    it('does not offer the caller their own typo back as a valid measure', async () => {
        // On the auto-inference path the bogus measure is already in
        // `cube.measures` (it was inferred from this very query), so echoing the
        // cube's measure list verbatim suggested `ghost_sum` — the one
        // alternative guaranteed not to work.
        const { service } = makeService();

        const err = await refusalOf(
            service.query({ cube: 'showcase_invoice', measures: ['ghost_sum'] } as any),
        );

        expect(err.message).toMatch(/Valid measures: count\./);
        expect(err.message).not.toMatch(/Valid measures:[^.]*ghost_sum/);
    });

    it('[#5918] refuses the dotted spelling by NAMING IT, not by naming what it stripped to', async () => {
        // Rewritten from "…naming what it stripped to". Until #5918 `total.sum`
        // prefix-stripped to `sum`, inferred `SUM(sum)`, and THIS gate refused it
        // as a missing column: `{field: 'sum', measure: 'total.sum'}` — honest
        // about what reached SQL, but naming a string the caller never wrote, and
        // silently right for the sibling spelling whose tail DID exist
        // (`owner.region_count_distinct` over a real `region` column — #5918's
        // measured defect). The maintainer ruled on 2026-08-07 that a dotted
        // measure is refused at the MINT instead, naming the caller's own
        // spelling; `dotted-measure-refusal.test.ts` is that rule's own file.
        //
        // What this case still pins, and why it belongs in #4437's file: the
        // dotted spelling is refused with the SAME wire shape (`INVALID_FIELD` /
        // 400 / `param: 'measures'`), and it still never reaches the driver. What
        // changed is WHICH layer answers — so the verdict no longer carries this
        // gate's `field`, which is exactly how the two are told apart (the same
        // distinction #5716 drew for the strategy's own refusals).
        const { service, aggregated } = makeService();

        const err = await service.query({ cube: 'showcase_invoice', measures: ['total.sum'] } as any).then(
            () => { throw new Error('expected the dotted measure to be refused'); },
            (e) => e as Error & { code?: string; status?: number; field?: string; member?: string; param?: string },
        );

        expect(err.code).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.param).toBe('measures');
        // The caller's own spelling, verbatim.
        expect(err.member).toBe('total.sum');
        expect(err.message).toMatch(/Measure 'total\.sum'/);
        // Not this gate's verdict: it names a missing base COLUMN in `field`, and
        // `sum` is not a column anyone asked about.
        expect(err.field).toBeUndefined();
        expect(err.message).not.toMatch(/aggregates field 'sum'/);

        expect(aggregated).toEqual([]);
    });

    it('does not poison the registry with the rejected cube', async () => {
        // Same rule the #3867 inference gate keeps: a rejected query must leave
        // no trace, or the retry finds a "registered" cube carrying the bogus
        // measure and sails straight into SQL.
        const { service, aggregated } = makeService();

        await expect(
            service.query({ cube: 'showcase_invoice', measures: ['ghost_sum'] } as any),
        ).rejects.toThrow();
        expect(service.cubeRegistry.get('showcase_invoice')).toBeUndefined();

        await expect(
            service.query({ cube: 'showcase_invoice', measures: ['ghost_sum'] } as any),
        ).rejects.toMatchObject(INVALID_FIELD);
        expect(aggregated).toEqual([]);
    });

    it('lets every legitimate measure spelling through unchanged', async () => {
        const { service, aggregated } = makeService();

        // `count(*)` — the one legitimately field-less aggregate.
        await service.query({ cube: 'showcase_invoice', measures: ['count'] } as any);
        // A real field under each inferred suffix.
        await service.query({
            cube: 'showcase_invoice',
            measures: ['total_sum', 'total_avg', 'total_min', 'total_max', 'total_count_distinct'],
        } as any);
        // Engine-assigned columns are admitted like the data path admits them.
        await service.query({ cube: 'showcase_invoice', measures: ['created_at_max'] } as any);

        expect(aggregated).toEqual(Array(3).fill('showcase_invoice'));
    });

    it('gates generateSql too, not just query', async () => {
        // `/analytics/sql` runs the same `ensureCube`; leaving it ungated would
        // hand back SQL naming a column that does not exist.
        const { service } = makeService();

        await expect(
            service.generateSql({ cube: 'showcase_invoice', measures: ['ghost_sum'] } as any),
        ).rejects.toMatchObject(INVALID_FIELD);
    });

    it('validates an AUTHORED cube whose declared measure lost its field', async () => {
        // An authored cube is not second-guessed about WHICH table it reads
        // (#3867), but a measure it declares over a dropped column is the same
        // caller-visible 500 — and here the suggestion list is real.
        const authored: Cube = {
            name: 'invoice_cube',
            title: 'Invoices',
            sql: 'showcase_invoice',
            measures: {
                count: { name: 'count', label: 'Count', type: 'count', sql: '*' },
                revenue: { name: 'revenue', label: 'Revenue', type: 'sum', sql: 'total' },
                legacy: { name: 'legacy', label: 'Legacy', type: 'sum', sql: 'dropped_column' },
            },
            dimensions: {},
            public: false,
        };
        const { service, aggregated } = makeService({ cubes: [authored] });

        await expect(
            service.query({ cube: 'invoice_cube', measures: ['legacy'] } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'dropped_column', measure: 'legacy' });
        expect(aggregated).toEqual([]);

        // Its healthy siblings still run, and are what the rejection suggests.
        await service.query({ cube: 'invoice_cube', measures: ['revenue'] } as any);
        expect(aggregated).toEqual(['showcase_invoice']);
    });

    it('leaves a cube whose `sql` is an expression alone — no field list to check', async () => {
        // `sql` is a subquery, not an object name: there is no schema to consult,
        // and guessing would reject perfectly good authored analytics.
        const derived: Cube = {
            name: 'derived_cube',
            title: 'Derived',
            sql: 'SELECT * FROM showcase_invoice WHERE status = 1',
            measures: { anything_sum: { name: 'anything_sum', label: 'x', type: 'sum', sql: 'anything' } },
            dimensions: {},
            public: false,
        };
        const { service } = makeService({ cubes: [derived] });

        await expect(
            service.query({ cube: 'derived_cube', measures: ['anything_sum'] } as any),
        ).resolves.toBeTruthy();
    });

    it('leaves a dotted cross-object measure to the layers that own it', async () => {
        // `account.balance` resolves through a JOIN this gate cannot see —
        // `balance` is not a column of `showcase_invoice` and must not be
        // reported as a missing one. Whether the query can run at all is the
        // strategy's call (the ObjectQL aggregate path declines cross-object
        // measures outright) and the join allowlist's (ADR-0021 D-C); either
        // way the answer must not be THIS GATE's verdict.
        //
        // [#5716] `code !== 'INVALID_FIELD'` was a PROXY for "not this gate",
        // usable only while the strategy's refusal carried no code. It now
        // carries `INVALID_FIELD` / 400 as well — the same class of mistake, one
        // wire shape — so the proxy is replaced by what it stood for: the
        // strategy's own message and metadata, and the ABSENCE of the `field`
        // this gate sets on every verdict it makes.
        const joined: Cube = {
            name: 'joined_cube',
            title: 'Joined',
            sql: 'showcase_invoice',
            measures: {
                remote_sum: { name: 'remote_sum', label: 'Remote', type: 'sum', sql: 'account.balance' },
            },
            dimensions: {},
            public: false,
        };
        const { service } = makeService({ cubes: [joined] });

        const err = await refusalOf(
            service.query({ cube: 'joined_cube', measures: ['remote_sum'] } as any),
        );

        expect(err).toBeInstanceOf(Error);
        // It got as far as the strategy — i.e. past this gate — and was declined
        // there for the strategy's own declared reason.
        expect(err.message).toMatch(/cannot evaluate a cross-object measure/);
        // The lie this case prevents: `balance` reported as a missing column of
        // `showcase_invoice`. This gate always names one in `field`; the strategy
        // never does.
        expect(err.message).not.toMatch(/does not have/);
        expect(err.field).toBeUndefined();
        expect(err.member).toBe('remote_sum');
        expect(err.param).toBe('measures');
    });

    it('stands down when no field probe is configured — nothing to consult', async () => {
        // Same tiering as the #3867 registry gate and the data path's
        // `resolveQueryFields`: with no source of truth the question cannot be
        // answered, and failing closed would break every embedding that runs
        // analytics without a data engine.
        const { service, aggregated } = makeService({ wireProbe: false });

        await service.query({ cube: 'showcase_invoice', measures: ['ghost_sum'] } as any);

        expect(aggregated).toEqual(['showcase_invoice']);
    });

    it('stands down for an object the probe cannot describe', async () => {
        // An external datasource whose columns are not mirrored locally answers
        // `undefined` — "cannot answer", not "has no fields".
        const external: Cube = {
            name: 'external_cube',
            title: 'External',
            sql: 'remote_table',
            measures: { ghost_sum: { name: 'ghost_sum', label: 'x', type: 'sum', sql: 'ghost' } },
            dimensions: {},
            public: false,
        };
        const { service } = makeService({ cubes: [external] });

        await expect(
            service.query({ cube: 'external_cube', measures: ['ghost_sum'] } as any),
        ).resolves.toBeTruthy();
    });
});
