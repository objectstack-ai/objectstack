// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3867 — the cube auto-inference existence gate.
 *
 * `ensureCube` infers a minimal Cube when none is registered under the queried
 * name, and that inferred cube's `sql` IS the name. That is the intended
 * "metric over an object" path (an `object-metric` KPI widget queries
 * `crm_account` with no authored Cube) — but it accepted ANY string, so
 * `POST /analytics/query` could aggregate over an arbitrary physical table.
 * Live repro on a CRM dev server before the fix, using a table that genuinely
 * exists but is not a registered object:
 *
 * ```
 * POST /analytics/query {"cube":"sqlite_sequence","query":{"measures":["count"]}}
 * → 500 {"error":{"message":"SELECT  FROM \"sqlite_sequence\" - near \"FROM\": syntax error"}}
 * ```
 *
 * The name reached the driver as a table. This is the analytics-side twin of
 * the data-path gap closed in #3770, and these cases pin the same three-way
 * rule: registered cube → run; unregistered name that IS an object → infer and
 * run (the intended path, unchanged); neither → 404 before any SQL exists.
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

const authoredCube: Cube = {
    name: 'authored_cube',
    title: 'Authored',
    sql: 'some_physical_table',
    measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
    dimensions: {},
    public: false,
};

/** Records which object each aggregate ran against, so we can assert none ran. */
function makeService(opts: {
    knownObjects?: string[];
    cubes?: Cube[];
    wireRegistry?: boolean;
} = {}) {
    const aggregated: string[] = [];
    const service = new AnalyticsService({
        logger: silentLogger,
        ...(opts.cubes ? { cubes: opts.cubes } : {}),
        queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
        executeAggregate: async (objectName: string) => {
            aggregated.push(objectName);
            return [{ count: 1 }];
        },
        ...(opts.wireRegistry === false
            ? {}
            : { isRegisteredObject: (n: string) => (opts.knownObjects ?? []).includes(n) }),
    });
    return { service, aggregated };
}

const CUBE_NOT_FOUND = { code: 'CUBE_NOT_FOUND', status: 404 };

describe('#3867 — cube auto-inference existence gate', () => {
    it('rejects an unregistered name that is not an object, before any SQL exists', async () => {
        const { service, aggregated } = makeService({ knownObjects: ['crm_account'] });

        await expect(
            service.query({ cube: 'sqlite_sequence', measures: ['count'] } as any),
        ).rejects.toMatchObject(CUBE_NOT_FOUND);

        // The whole point: the name never became a table.
        expect(aggregated).toEqual([]);
    });

    it('names the object in the rejection so the caller can act on it', async () => {
        const { service } = makeService({ knownObjects: ['crm_account'] });

        await expect(
            service.query({ cube: 'sqlite_sequence', measures: ['count'] } as any),
        ).rejects.toMatchObject({ cube: 'sqlite_sequence' });
    });

    it('does not poison the registry with the rejected cube', async () => {
        // Pre-fix `ensureCube` registered the inferred cube before anything
        // could object; a rejected name must leave no trace, or the second
        // attempt would find a "registered" cube and sail through the gate.
        const { service, aggregated } = makeService({ knownObjects: ['crm_account'] });

        await expect(service.query({ cube: 'ghost', measures: ['count'] } as any)).rejects.toThrow();
        expect(service.cubeRegistry.get('ghost')).toBeUndefined();
        await expect(service.query({ cube: 'ghost', measures: ['count'] } as any))
            .rejects.toMatchObject(CUBE_NOT_FOUND);
        expect(aggregated).toEqual([]);
    });

    it('still auto-infers for a REGISTERED object — the intended KPI path is unchanged', async () => {
        const { service, aggregated } = makeService({ knownObjects: ['crm_account'] });

        const result = await service.query({ cube: 'crm_account', measures: ['count'] } as any);

        expect(result).toBeTruthy();
        expect(aggregated).toEqual(['crm_account']);
        expect(service.cubeRegistry.get('crm_account')).toBeTruthy();
    });

    it('never gates an authored cube — its `sql` is whatever it declares', async () => {
        // `authored_cube` is not an object name, and its physical table is a
        // third name entirely. A registered Cube was authored deliberately, so
        // the gate must not second-guess it.
        const { service, aggregated } = makeService({ knownObjects: [], cubes: [authoredCube] });

        await service.query({ cube: 'authored_cube', measures: ['count'] } as any);

        expect(aggregated).toEqual(['some_physical_table']);
    });

    it('gates generateSql too, not just query', async () => {
        // `/analytics/sql` runs the same `ensureCube`; leaving it ungated would
        // hand back SQL naming an arbitrary table.
        const { service } = makeService({ knownObjects: ['crm_account'] });

        await expect(
            service.generateSql({ cube: 'sqlite_sequence', measures: ['count'] } as any),
        ).rejects.toMatchObject(CUBE_NOT_FOUND);
    });

    it('stands down when no registry probe is configured — nothing to consult', async () => {
        // Same tiering as #3770's `assertObjectRegistered`: with no source of
        // truth the question cannot be answered, and failing closed would break
        // every embedding that runs analytics without a data engine.
        const { service, aggregated } = makeService({ wireRegistry: false });

        await service.query({ cube: 'anything_at_all', measures: ['count'] } as any);

        expect(aggregated).toEqual(['anything_at_all']);
    });
});
