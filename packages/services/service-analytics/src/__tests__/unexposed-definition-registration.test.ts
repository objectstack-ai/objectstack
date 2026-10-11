// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A definition that can never answer is refused when it is registered, not
 * published and left to fail at every query.
 *
 * The analytics door refuses every query over an object whose `enable` block
 * the spec's one exposure decision (`apiExposureDenialReason`) denies the
 * aggregate operation: `404 OBJECT_API_DISABLED` for `apiEnabled: false`, `405
 * OBJECT_API_METHOD_NOT_ALLOWED` for a whitelist that does not grant it
 * (`api-exposure-door.test.ts`). A configured cube, or a dataset
 * `registerDataset` compiled, over such an object used to register silently and
 * be listed by `getMeta` — a cube on the discovery surface that answered 404 to
 * every query, with nothing telling the author when they declared it.
 *
 * What this file pins, per registration door:
 *
 * - the configured cubes (`AnalyticsServiceConfig.cubes`, and the plugin's
 *   `cubes`): a cube whose base object or declared join is denied is warned
 *   with a located refusal and skipped, and every other cube still registers;
 * - `registerDataset`, and the constructor's `datasets` that go through it: the
 *   same refusal is thrown, in the query face's code and status, and nothing is
 *   registered;
 * - a cube written to the service's public `cubeRegistry` directly: the
 *   registry's own admission refuses it;
 * - every refused definition is absent from `getMeta`;
 * - the controls: an exposed object's cube and dataset register and list as
 *   before;
 * - the tiering (cannot answer, do not block): an object with no declaration at
 *   registration time, or a lookup that throws, registers as before, and the
 *   query face still refuses the object at every query.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsService, type AnalyticsServiceConfig } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import type { ObjectDeclaration } from '../api-exposure-door.js';

const HIDDEN = 'reg_hidden';
const NO_LIST = 'reg_nolist';
const OPEN = 'reg_open';
const PARTNER = 'reg_partner';

const DECLARATIONS: Record<string, ObjectDeclaration> = {
  [HIDDEN]: { enable: { apiEnabled: false } },
  [NO_LIST]: { enable: { apiMethods: ['get'] } },
  [OPEN]: { enable: { apiEnabled: true } },
  [PARTNER]: {},
};

const measures = { rows: { label: 'Rows', type: 'count' as const, sql: '*' } };

const cube = (name: string, base: string, joins?: Record<string, { name: string }>): Cube =>
  ({ name, title: name, sql: base, public: true, measures, dimensions: {}, ...(joins ? { joins } : {}) }) as Cube;

const dataset = (name: string, object: string, include?: string[]) =>
  DatasetSchema.parse({
    name,
    label: name,
    object,
    ...(include ? { include } : {}),
    dimensions: [],
    measures: [{ name: 'row_count', label: 'Rows', aggregate: 'count' }],
  });

/** `reg_open.partner` and `reg_open.hidden` resolve to the objects named. */
const relationshipResolver = (object: string, relationship: string) =>
  object === OPEN && relationship === 'partner'
    ? { object: PARTNER, table: PARTNER }
    : object === OPEN && relationship === 'hidden'
      ? { object: HIDDEN, table: HIDDEN }
      : undefined;

interface Refusal extends Error {
  code?: string;
  status?: number;
  object?: string;
}

const pick = (e: Refusal) => ({ code: e.code, status: e.status, object: e.object });

/** The error a call threw — and a loud failure if it returned. */
function thrown(call: () => unknown): Refusal {
  let returned: unknown;
  try {
    returned = call();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, got ${JSON.stringify(returned)}`);
}

async function rejection(call: () => Promise<unknown>): Promise<Refusal> {
  let resolved: unknown;
  try {
    resolved = await call();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, got ${JSON.stringify(resolved)}`);
}

const recordingLogger = () => {
  const warnings: string[] = [];
  const logger = {
    debug() {},
    info() {},
    warn(message: string) { warnings.push(String(message)); },
    error() {},
    child() { return logger; },
  };
  return { logger: logger as unknown as AnalyticsServiceConfig['logger'], warnings };
};

const serviceWith = (config: AnalyticsServiceConfig = {}) =>
  new AnalyticsService({
    getObjectDeclaration: (object) => DECLARATIONS[object],
    relationshipResolver,
    ...config,
  });

const listed = async (service: AnalyticsService) => (await service.getMeta()).map((c) => c.name).sort();

describe('a configured cube over an object the API does not serve is refused at registration', () => {
  const CUBES = [
    cube('open_cube', OPEN),
    cube('hidden_cube', HIDDEN),
    cube('nolist_cube', NO_LIST),
    cube('hidden_join_cube', OPEN, { hidden: { name: HIDDEN } }),
    cube('partner_join_cube', OPEN, { partner: { name: PARTNER } }),
  ];

  it('each refused cube is warned, located, and skipped; the others register and list as before', async () => {
    const { logger, warnings } = recordingLogger();
    const service = serviceWith({ cubes: CUBES, logger });

    expect(await listed(service)).toEqual(['open_cube', 'partner_join_cube']);
    for (const name of ['hidden_cube', 'nolist_cube', 'hidden_join_cube']) {
      expect(service.cubeRegistry.get(name), name).toBeUndefined();
      expect(await service.getMeta(name), name).toEqual([]);
    }

    const said = (name: string) => warnings.filter((w) => w.includes(`"${name}"`));
    expect(said('hidden_cube')).toHaveLength(1);
    expect(said('hidden_cube')[0]).toContain(`"${HIDDEN}"`);
    expect(said('hidden_cube')[0]).toContain('apiEnabled: false');
    expect(said('nolist_cube')).toHaveLength(1);
    expect(said('nolist_cube')[0]).toContain(`"${NO_LIST}"`);
    expect(said('nolist_cube')[0]).toContain('apiMethods');
    // The joined object is the one named, not the exposed base object.
    expect(said('hidden_join_cube')).toHaveLength(1);
    expect(said('hidden_join_cube')[0]).toContain(`"${HIDDEN}"`);
    expect(said('open_cube')).toEqual([]);
    expect(said('partner_join_cube')).toEqual([]);
  });

  it('the refusal is the query face\'s envelope: 404 OBJECT_API_DISABLED / 405 OBJECT_API_METHOD_NOT_ALLOWED', () => {
    const service = serviceWith();
    expect(pick(thrown(() => service.cubeRegistry.register(cube('hidden_cube', HIDDEN))))).toEqual({
      code: 'OBJECT_API_DISABLED', status: 404, object: HIDDEN,
    });
    expect(pick(thrown(() => service.cubeRegistry.register(cube('nolist_cube', NO_LIST))))).toEqual({
      code: 'OBJECT_API_METHOD_NOT_ALLOWED', status: 405, object: NO_LIST,
    });
    expect(pick(thrown(() => service.cubeRegistry.register(cube('hidden_join_cube', OPEN, { hidden: { name: HIDDEN } }))))).toEqual({
      code: 'OBJECT_API_DISABLED', status: 404, object: HIDDEN,
    });
  });

  it('a cube written to the public registry directly is refused there too, and nothing is stored', async () => {
    const service = serviceWith();
    const before = await listed(service);
    thrown(() => service.cubeRegistry.register(cube('hidden_cube', HIDDEN)));
    expect(service.cubeRegistry.has('hidden_cube')).toBe(false);
    expect(await listed(service)).toEqual(before);
  });
});

describe('a dataset over an object the API does not serve is refused by registerDataset', () => {
  it('throws the located refusal, and registers nothing', async () => {
    const service = serviceWith();
    const err = thrown(() => service.registerDataset(dataset('hidden_rows', HIDDEN)));
    expect(pick(err)).toEqual({ code: 'OBJECT_API_DISABLED', status: 404, object: HIDDEN });
    expect(err.message).toContain('"hidden_rows"');
    expect(err.message).toContain(`"${HIDDEN}"`);
    expect(service.cubeRegistry.has('hidden_rows')).toBe(false);
    expect(await service.getMeta('hidden_rows')).toEqual([]);

    expect(pick(thrown(() => service.registerDataset(dataset('nolist_rows', NO_LIST))))).toEqual({
      code: 'OBJECT_API_METHOD_NOT_ALLOWED', status: 405, object: NO_LIST,
    });
    expect(service.cubeRegistry.has('nolist_rows')).toBe(false);
  });

  it('a JOINED object the API does not serve refuses the dataset, naming the joined object', async () => {
    const service = serviceWith();
    const err = thrown(() => service.registerDataset(dataset('open_by_hidden', OPEN, ['hidden'])));
    expect(pick(err)).toEqual({ code: 'OBJECT_API_DISABLED', status: 404, object: HIDDEN });
    expect(err.message).toContain('"open_by_hidden"');
    expect(service.cubeRegistry.has('open_by_hidden')).toBe(false);
    expect(await service.getMeta('open_by_hidden')).toEqual([]);
  });

  it('the constructor\'s datasets take the per-definition channel: warned and skipped, the others register', async () => {
    const { logger, warnings } = recordingLogger();
    const service = serviceWith({
      datasets: [dataset('hidden_rows', HIDDEN), dataset('open_rows', OPEN), dataset('open_by_hidden', OPEN, ['hidden'])],
      logger,
    });
    expect(await listed(service)).toEqual(['open_rows']);
    expect(warnings.filter((w) => w.includes('"hidden_rows"'))).toHaveLength(1);
    expect(warnings.filter((w) => w.includes('"open_by_hidden"'))).toHaveLength(1);
  });

  it('CONTROL: an exposed object\'s dataset, joined to an exposed object, registers and lists as before', async () => {
    const service = serviceWith();
    const compiled = service.registerDataset(dataset('open_by_partner', OPEN, ['partner']));
    expect(compiled.cube.joins?.partner?.name).toBe(PARTNER);
    expect(await listed(service)).toEqual(['open_by_partner']);
  });
});

describe('cannot answer, do not block — the registration doors\' own tiering', () => {
  it('an object with no declaration yet registers as before, and the query face judges it once it is declared', async () => {
    const declared: Record<string, ObjectDeclaration> = {};
    const service = new AnalyticsService({
      cubes: [cube('late_cube', 'reg_late')],
      getObjectDeclaration: (object) => declared[object],
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [{ rows: 1 }],
    });
    expect(await listed(service)).toEqual(['late_cube']);

    declared.reg_late = { enable: { apiEnabled: false } };
    expect(pick(await rejection(() => service.query({ cube: 'late_cube', measures: ['rows'] })))).toEqual({
      code: 'OBJECT_API_DISABLED', status: 404, object: 'reg_late',
    });
  });

  it('a lookup that throws registers as before, and the query face refuses fail-closed', async () => {
    const service = new AnalyticsService({
      cubes: [cube('open_cube', OPEN)],
      getObjectDeclaration: () => {
        throw new Error('registry unavailable');
      },
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [{ rows: 1 }],
      logger: recordingLogger().logger,
    });
    expect(await listed(service)).toEqual(['open_cube']);
    expect(pick(await rejection(() => service.query({ cube: 'open_cube', measures: ['rows'] })))).toEqual({
      code: 'PERMISSION_DENIED', status: 403, object: OPEN,
    });
  });

  it('a host that wires no declaration probe registers every definition as before', async () => {
    const service = new AnalyticsService({ cubes: [cube('hidden_cube', HIDDEN)], relationshipResolver });
    service.registerDataset(dataset('hidden_rows', HIDDEN));
    expect(await listed(service)).toEqual(['hidden_cube', 'hidden_rows']);
  });
});

describe('the shipped wiring: AnalyticsServicePlugin over a real ObjectQL engine', () => {
  const quiet: any = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };
  const text = (name: string) => ({ name, type: 'text' as const });
  const OBJECTS = [
    { name: HIDDEN, label: 'Hidden', enable: { apiEnabled: false, apiMethods: [] }, fields: { region: text('region') } },
    { name: NO_LIST, label: 'No list', enable: { apiMethods: ['get'] }, fields: { region: text('region') } },
    { name: OPEN, label: 'Open', fields: { region: text('region') } },
  ];
  let engine: ObjectQL;
  let service: AnalyticsService;
  const warnings: string[] = [];

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL({ logger: quiet } as any);
    engine.registerDriver(driver, true);
    await engine.init();
    for (const obj of OBJECTS) engine.registry.registerObject(obj as any);

    const registered: Record<string, unknown> = {};
    await new AnalyticsServicePlugin({
      cubes: [cube('open_cube', OPEN), cube('hidden_cube', HIDDEN), cube('nolist_cube', NO_LIST)],
    }).init({
      getService: (name: string) => (name === 'data' ? engine : registered[name]),
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      hook: () => {},
      logger: { ...quiet, warn: (message: string) => { warnings.push(String(message)); } },
    } as never);
    service = registered.analytics as AnalyticsService;
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the plugin\'s configured cubes over unexposed objects are refused at init, warned, and absent from getMeta', async () => {
    expect(await listed(service)).toEqual(['open_cube']);
    expect(warnings.filter((w) => w.includes('"hidden_cube"') && w.includes(`"${HIDDEN}"`))).toHaveLength(1);
    expect(warnings.filter((w) => w.includes('"nolist_cube"') && w.includes(`"${NO_LIST}"`))).toHaveLength(1);
  });

  it('registerDataset on the plugin\'s service refuses a dataset over an unexposed object', async () => {
    expect(pick(thrown(() => service.registerDataset(dataset('hidden_rows', HIDDEN))))).toEqual({
      code: 'OBJECT_API_DISABLED', status: 404, object: HIDDEN,
    });
    expect(await service.getMeta('hidden_rows')).toEqual([]);
    service.registerDataset(dataset('open_rows', OPEN));
    expect(await listed(service)).toEqual(['open_cube', 'open_rows']);
  });
});
