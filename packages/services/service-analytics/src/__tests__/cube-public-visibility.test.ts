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
 * - non-disclosure: that refusal is byte-identical (status, code, message) to
 *   the one a name no cube and no object carries gets, so it does not confirm
 *   that a hidden cube exists;
 * - the controls: a cube that declares `public: true`, and one that omits the
 *   key (input shape, and parsed through `CubeSchema` the way `defineCube` does),
 *   are listed and answered;
 * - the three INTERNAL producers (`inferCubeFromQuery`, `compileDataset`,
 *   `CubeRegistry.inferFromObject`) mint visible cubes — moot for the first,
 *   whose cube is never registered (#20381), so no visibility verdict reads
 *   it — so the ad-hoc KPI path and the dataset door (whose `DatasetExecutor`
 *   queries run through the same gate, asked of the call's own request scope)
 *   keep answering after the flag became enforced, and a dataset named like a
 *   hidden cube runs as itself rather than answering in a way that would
 *   reveal the hidden name.
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

const measures = { count: { label: 'Count', type: 'count' as const, sql: '*' } };
const dimensions = { status: { label: 'Status', type: 'string' as const, sql: 'status' } };

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

describe('analytics_cube.public — a hidden cube is indistinguishable from a missing one', () => {
  type Refusal = Error & { code?: string; status?: number; cube?: string };
  const refusalOf = (run: () => Promise<unknown>): Promise<Refusal | undefined> =>
    run().then(() => undefined, (e: unknown) => e as Refusal);
  const envelope = (e: Refusal | undefined) => ({
    status: e?.status,
    code: e?.code,
    message: e?.message,
    cube: e?.cube,
    keys: Object.keys(e ?? {}).sort(),
  });

  it.each(['query', 'generateSql'] as const)(
    '`%s()`: the same name, hidden in one deployment and absent from another, answers an equal status, code and message',
    async (door) => {
      const secret: Cube = { name: 'secret_cube', sql: 'secret_table', measures, dimensions, public: false };
      const hidden = makeService([secret]).service; // registered, declared public: false
      const absent = makeService([]).service; // no such cube, and not a registered object
      const q = { cube: 'secret_cube', measures: ['secret_cube.count'] };

      const whenHidden = await refusalOf(() => hidden[door](q));
      const whenAbsent = await refusalOf(() => absent[door](q));

      expect(whenHidden).toBeInstanceOf(Error);
      expect(whenAbsent).toBeInstanceOf(Error);
      expect(whenHidden?.status).toBe(404);
      expect(whenHidden?.code).toBe('CUBE_NOT_FOUND');
      // Byte for byte: a caller who guesses a name learns nothing about whether
      // a hidden cube stands behind it.
      expect(envelope(whenHidden)).toEqual(envelope(whenAbsent));
    },
  );
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
  it('the ad-hoc KPI path: an inferred cube is answered on every request, and never registered or listed', async () => {
    const { service, aggregated } = makeService([]);

    await service.query({ cube: 'crm_account', measures: ['count'] });
    // [#20381] The first request's inferred cube stayed in that request, so
    // the second infers again — nothing registered under the name that a
    // hidden verdict could ever refuse it by.
    await service.query({ cube: 'crm_account', measures: ['count'] });

    expect(aggregated).toEqual(['crm_account', 'crm_account']);
    expect(service.cubeRegistry.get('crm_account')).toBeUndefined();
    expect((await service.getMeta()).map((c) => c.name)).toEqual([]);
  });

  it('the dataset door: `queryDataset` runs its compiled cube through the same gate, and it answers', async () => {
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
  });

  it('the dataset door does not reveal a hidden name: a dataset named like a hidden cube runs as itself, exactly like any other name', async () => {
    const secret: Cube = { name: 'pipeline', sql: 'secret_table', measures, dimensions, public: false };
    const withHidden = new AnalyticsService({
      logger: silentLogger,
      cubes: [secret],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [{ stage: 'won', total: 3 }],
    });
    const without = new AnalyticsService({
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
    const selection = { dimensions: ['stage'], measures: ['total'] };

    // The call's own compiled cube answers its name inside the request, so the
    // gate asks about THAT cube (visible) — the same outcome as for a name no
    // configured cube has, which is what keeps this door from being an oracle.
    expect((await withHidden.queryDataset(dataset, selection)).rows).toEqual(
      (await without.queryDataset(dataset, selection)).rows,
    );
    // …and the configured hidden cube is untouched: still omitted, still refused.
    expect(await withHidden.getMeta('pipeline')).toEqual([]);
    await expect(withHidden.query({ cube: 'pipeline', measures: ['pipeline.count'] })).rejects.toMatchObject({
      code: 'CUBE_NOT_FOUND',
      status: 404,
    });
  });

  it('`compileDataset` and `CubeRegistry.inferFromObject` write the visible default', () => {
    const compiled = compileDataset(DatasetSchema.parse({
      name: 'pipeline',
      label: 'Pipeline',
      object: 'opportunity',
      dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
      measures: [{ name: 'total', aggregate: 'count' }],
    }));
    const inferred = new CubeRegistry().inferFromObject('tasks', [{ name: 'title', type: 'text', label: 'Title' }]);

    expect(compiled.cube.public).toBe(true);
    expect(inferred.public).toBe(true);
  });
});
