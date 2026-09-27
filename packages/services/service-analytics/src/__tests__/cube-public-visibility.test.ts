// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `analytics_cube.public` — the analytics API honours an authored cube's
 * visibility (the Cube.dev semantics this schema follows: a cube declared
 * `public: false` is neither discovered nor queryable through the API).
 *
 * Until this change the key was parsed, stored and read by NOTHING: `getMeta`
 * listed a `public: false` cube and every query door answered it, so an author
 * who wrote the flag got a cube exactly as exposed as one that did not — an
 * access-shaped key that gated nothing. The default was `false` too, which is
 * why it could never simply be switched on: enforcing it as declared would have
 * hidden every authored cube. The default is now the mainstream "visible", and
 * an explicit `false` hides.
 *
 * What this file pins, one door at a time:
 *
 * - discovery: `getMeta()` omits a hidden cube, and `getMeta(name)` answers a
 *   hidden name with nothing — the same answer as a name no cube has;
 * - the query doors: `query()` (`POST /analytics/query`) and `generateSql()`
 *   (`POST /analytics/sql`) refuse a hidden cube with the declared
 *   `CUBE_NOT_FOUND` / 404 envelope — never an empty result — before a strategy
 *   runs and before the registry is touched;
 * - the controls: a cube that declares `public: true`, and one that omits the
 *   key (input shape, and parsed through `CubeSchema` the way `defineCube` does),
 *   are listed and answered;
 * - the three INTERNAL producers (`inferCubeFromQuery`, `compileDataset`,
 *   `CubeRegistry.inferFromObject`) mint visible cubes, so the ad-hoc KPI path
 *   and the dataset door — which reaches `query()` through `DatasetExecutor` —
 *   keep answering after the flag became enforced.
 */

import { describe, it, expect, vi } from 'vitest';
import { CubeSchema, type Cube } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import { CubeRegistry } from '../cube-registry.js';
import { compileDataset } from '../dataset-compiler.js';

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

const measures = { count: { name: 'count', label: 'Count', type: 'count' as const, sql: '*' } };
const dimensions = { status: { name: 'status', label: 'Status', type: 'string' as const, sql: 'status' } };

const hiddenCube: Cube = { name: 'hidden_cube', sql: 'hidden_table', measures, dimensions, public: false };
const visibleCube: Cube = { name: 'visible_cube', sql: 'visible_table', measures, dimensions, public: true };
/** Input shape with the key OMITTED — `register` never parses, so this is what an unparsed caller hands in. */
const omittedCube: Cube = { name: 'omitted_cube', sql: 'omitted_table', measures, dimensions };
/** Parsed the way `defineCube()` and `defineStack({ analyticsCubes })` parse an authored cube. */
const parsedCube = CubeSchema.parse({ name: 'parsed_cube', sql: 'parsed_table', measures, dimensions });

/** Records every object an aggregate ran against, so a refusal can prove no strategy ran. */
function makeService(cubes: Cube[] = [hiddenCube, visibleCube, omittedCube, parsedCube]) {
  const aggregated: string[] = [];
  const service = new AnalyticsService({
    logger: silentLogger,
    cubes,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (objectName: string) => {
      aggregated.push(objectName);
      return [{ count: 1 }];
    },
    isRegisteredObject: (n: string) => ['crm_account', 'opportunity'].includes(n),
  });
  return { service, aggregated };
}

const HIDDEN_REFUSAL = { code: 'CUBE_NOT_FOUND', status: 404, cube: 'hidden_cube' };

describe('analytics_cube.public — discovery (`getMeta`)', () => {
  it('omits a cube declared `public: false` and lists every visible one', async () => {
    const { service } = makeService();

    const names = (await service.getMeta()).map((c) => c.name);

    expect(names).not.toContain('hidden_cube');
    expect(names).toEqual(['visible_cube', 'omitted_cube', 'parsed_cube']);
  });

  it('answers a hidden name with nothing — the same answer as a name no cube has', async () => {
    const { service } = makeService();

    expect(await service.getMeta('hidden_cube')).toEqual([]);
    expect(await service.getMeta('no_such_cube')).toEqual([]);
    expect((await service.getMeta('visible_cube')).map((c) => c.name)).toEqual(['visible_cube']);
  });
});

describe('analytics_cube.public — every query door refuses a hidden cube', () => {
  it('`query()` refuses with the declared CUBE_NOT_FOUND/404 envelope, and no strategy runs', async () => {
    const { service, aggregated } = makeService();

    await expect(
      service.query({ cube: 'hidden_cube', measures: ['hidden_cube.count'] }),
    ).rejects.toMatchObject(HIDDEN_REFUSAL);

    expect(aggregated).toEqual([]);
  });

  it('`generateSql()` refuses the same way — the dry-run door shows no statement for a hidden cube', async () => {
    const { service, aggregated } = makeService();

    await expect(
      service.generateSql({ cube: 'hidden_cube', measures: ['hidden_cube.count'] }),
    ).rejects.toMatchObject(HIDDEN_REFUSAL);

    expect(aggregated).toEqual([]);
  });

  it('refuses before the registry is touched — a suffix-inferred measure does not augment the hidden cube', async () => {
    const { service } = makeService();
    const before = service.cubeRegistry.get('hidden_cube');

    await expect(
      service.query({ cube: 'hidden_cube', measures: ['amount_sum'] }),
    ).rejects.toMatchObject(HIDDEN_REFUSAL);

    expect(service.cubeRegistry.get('hidden_cube')).toBe(before);
  });

  it('a refusal is not an empty result: the promise rejects rather than resolving with no rows', async () => {
    const { service } = makeService();

    const outcome = await service.query({ cube: 'hidden_cube', measures: ['hidden_cube.count'] }).then(
      (result) => ({ resolved: result }),
      (error: unknown) => ({ rejected: error }),
    );

    expect(outcome).not.toHaveProperty('resolved');
    expect(outcome).toHaveProperty('rejected');
  });
});

describe('analytics_cube.public — the controls stay open', () => {
  it.each(['visible_cube', 'omitted_cube', 'parsed_cube'])('`%s` is answered by `query()`', async (name) => {
    const { service, aggregated } = makeService();

    await service.query({ cube: name, measures: [`${name}.count`] });

    expect(aggregated).toEqual([name.replace('_cube', '_table')]);
  });

  it('an authored cube that omits `public` parses to visible (the spec default feeds the runtime)', () => {
    expect(parsedCube.public).toBe(true);
  });
});

describe('analytics_cube.public — the internal producers mint visible cubes', () => {
  it('the ad-hoc KPI path: an inferred cube is answered again on the next request, and listed', async () => {
    const { service, aggregated } = makeService([]);

    await service.query({ cube: 'crm_account', measures: ['count'] });
    // The first request REGISTERED the inferred cube; the second resolves it
    // from the registry, which is where a hidden verdict would now refuse it.
    await service.query({ cube: 'crm_account', measures: ['count'] });

    expect(aggregated).toEqual(['crm_account', 'crm_account']);
    expect(service.cubeRegistry.get('crm_account')?.public).toBe(true);
    expect((await service.getMeta()).map((c) => c.name)).toEqual(['crm_account']);
  });

  it('the dataset door: `queryDataset` reaches `query()` through DatasetExecutor with its compiled cube', async () => {
    const service = new AnalyticsService({
      logger: silentLogger,
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [{ stage: 'won', total: 3 }],
    });
    const dataset = DatasetSchema.parse({
      name: 'pipeline',
      label: 'Pipeline',
      object: 'opportunity',
      dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
      measures: [{ name: 'total', aggregate: 'count' }],
    });

    const result = await service.queryDataset(dataset, { dimensions: ['stage'], measures: ['total'] });

    expect(result.rows).toEqual([{ stage: 'won', total: 3 }]);
    expect(service.cubeRegistry.get('pipeline')?.public).toBe(true);
  });

  it('`compileDataset` and `CubeRegistry.inferFromObject` write the visible default', () => {
    const compiled = compileDataset(DatasetSchema.parse({
      name: 'pipeline',
      label: 'Pipeline',
      object: 'opportunity',
      measures: [{ name: 'total', aggregate: 'count' }],
    }));
    const inferred = new CubeRegistry().inferFromObject('tasks', [{ name: 'title', type: 'text', label: 'Title' }]);

    expect(compiled.cube.public).toBe(true);
    expect(inferred.public).toBe(true);
  });
});
