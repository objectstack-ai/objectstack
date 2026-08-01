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
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';

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

        const err = await service
            .query({ cube: 'showcase_invoice', measures: ['ghost_sum'] } as any)
            .catch((e) => e as Error);

        expect(err.message).toMatch(/Valid measures: count\./);
        expect(err.message).not.toMatch(/Valid measures:[^.]*ghost_sum/);
    });

    it('refuses the dotted spelling the same way, naming what it stripped to', async () => {
        // `total.sum` prefix-strips to `sum`, which infers `SUM(sum)` — a column
        // named `sum` that does not exist. Same 500 pre-fix, same 400 now.
        const { service, aggregated } = makeService();

        await expect(
            service.query({ cube: 'showcase_invoice', measures: ['total.sum'] } as any),
        ).rejects.toMatchObject({ ...INVALID_FIELD, field: 'sum', measure: 'total.sum' });

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
        // way the answer must not be this gate's INVALID_FIELD.
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

        const err = await service
            .query({ cube: 'joined_cube', measures: ['remote_sum'] } as any)
            .catch((e) => e as Error & { code?: string });

        expect(err).toBeInstanceOf(Error);
        expect(err.code).not.toBe('INVALID_FIELD');
        // It got as far as the strategy — i.e. past this gate — and was declined
        // there for the strategy's own declared reason.
        expect(err.message).toMatch(/cannot evaluate a cross-object measure/);
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
