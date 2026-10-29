// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27277] The engine's floor over a plugin driver on an external datasource
 * (`external-driver-floor.ts`), driven through the real engine.
 *
 * The driver under test is the worst honest plugin driver: it pushes NOTHING
 * down — no filter, no sort — and only stops reading at the `limit` it is
 * sent, the way a remote API's page size does. Every read must still answer
 * exactly the rows the query asks for, or refuse.
 */

import { describe, it, expect } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine';
import { EXTERNAL_ROW_CAP, ExternalRowCapExceededError, ExternalWriteRefusedError } from './external-driver-errors.js';
import { DatasourceUnavailableError } from './driver-connect-errors.js';
import { isExternalDriverFloor, needsExternalDriverFloor, unwrapExternalDriverFloor } from './external-driver-floor.js';

type Row = Record<string, unknown>;

interface RemoteDouble {
  driver: IDataDriver;
  /** Every query `find` received, as received. */
  sent: Row[];
}

/** A plugin driver over `rows` that applies no part of a query but its `limit`. */
function remoteDriver(name: string, rows: Row[], extra: Record<string, unknown> = {}): RemoteDouble {
  const sent: Row[] = [];
  const driver = {
    name,
    version: '0.0.1',
    supports: { transactionsUnsupported: true },
    async connect() {},
    async disconnect() {},
    async find(_object: string, query: Row = {}) {
      sent.push({ ...query });
      const page = rows.map((r) => ({ ...r }));
      return typeof query.limit === 'number' ? page.slice(0, query.limit) : page;
    },
    async findOne() { throw new Error('the floor answers findOne itself'); },
    async count() { throw new Error('the floor answers count itself'); },
    async aggregate() { throw new Error('the floor hides aggregate'); },
    async syncSchema() {},
    ...extra,
  } as unknown as IDataDriver;
  return { driver, sent };
}

const TREE_ROWS: Row[] = [
  { id: 'n1', kind: 'leaf', label: 'Echo', weight: 3 },
  { id: 'n2', kind: 'branch', label: 'Alpha', weight: 1 },
  { id: 'n3', kind: 'leaf', label: 'Charlie', weight: 2 },
  { id: 'n4', kind: 'leaf', label: 'Bravo', weight: null },
  { id: 'n5', kind: 'branch', label: 'Delta', weight: 5 },
  { id: 'n6', kind: 'leaf', label: 'Foxtrot', weight: 2 },
];

function makeEngine(opts: {
  rows?: Row[];
  driverId?: string;
  schemaMode?: 'managed' | 'external' | 'validate-only';
  extra?: Record<string, unknown>;
  order?: 'driver-first' | 'def-first';
} = {}) {
  const engine = new ObjectQL();
  const remote = remoteDriver('tree', opts.rows ?? TREE_ROWS, opts.extra);
  const def = {
    name: 'tree',
    driver: opts.driverId ?? 'spike_tree',
    schemaMode: opts.schemaMode ?? 'external',
    external: { allowWrites: true },
  };
  if (opts.order === 'def-first') {
    engine.registerDatasourceDef(def);
    engine.registerDriver(remote.driver);
  } else {
    engine.registerDriver(remote.driver);
    engine.registerDatasourceDef(def);
  }
  engine.registerApp({
    id: 'tree_pkg',
    name: 'Tree',
    objects: [{
      name: 'tree_node',
      datasource: 'tree',
      external: { remoteName: 'nodes', writable: true },
      fields: { kind: { type: 'text' }, label: { type: 'text' }, weight: { type: 'number' } },
    }],
  } as any);
  return { engine, remote };
}

const ids = (rows: Row[]) => rows.map((r) => r.id);

describe('[#27277] which datasources get the floor', () => {
  it('a non-managed datasource on a driver id that is not built in', () => {
    expect(needsExternalDriverFloor({ driver: 'spike_tree', schemaMode: 'external' })).toBe(true);
    expect(needsExternalDriverFloor({ driver: 'spike_tree', schemaMode: 'validate-only' })).toBe(true);
  });

  it('never a managed datasource, a built-in driver (federated SQL), or a def that names no driver', () => {
    expect(needsExternalDriverFloor({ driver: 'spike_tree', schemaMode: 'managed' })).toBe(false);
    expect(needsExternalDriverFloor({ driver: 'spike_tree' })).toBe(false);
    for (const builtin of ['memory', 'sqlite', 'postgres', 'mysql', 'mongodb', 'turso']) {
      expect(needsExternalDriverFloor({ driver: builtin, schemaMode: 'external' }), builtin).toBe(false);
    }
    expect(needsExternalDriverFloor({ schemaMode: 'external' })).toBe(false);
    expect(needsExternalDriverFloor(undefined)).toBe(false);
  });

  it('a built-in driver on an external datasource is the registered instance itself — zero change', () => {
    const { engine, remote } = makeEngine({ driverId: 'sqlite' });
    expect(engine.getDriverByName('tree')).toBe(remote.driver);
  });

  it('a managed datasource is the registered instance itself', () => {
    const { engine, remote } = makeEngine({ schemaMode: 'managed' });
    expect(engine.getDriverByName('tree')).toBe(remote.driver);
  });

  it('either registration order floors the driver, and a managed redefinition takes it back out', () => {
    for (const order of ['driver-first', 'def-first'] as const) {
      const { engine, remote } = makeEngine({ order });
      const held = engine.getDriverByName('tree')!;
      expect(isExternalDriverFloor(held), order).toBe(true);
      expect(unwrapExternalDriverFloor(held)).toBe(remote.driver);
      engine.registerDatasourceDef({ name: 'tree', driver: 'spike_tree', schemaMode: 'managed' });
      expect(engine.getDriverByName('tree'), order).toBe(remote.driver);
    }
  });
});

describe('[#27277] one instance', () => {
  it('every reader of the drivers map holds the same floored instance', () => {
    const { engine } = makeEngine();
    const held = engine.getDriverByName('tree')!;
    expect(isExternalDriverFloor(held)).toBe(true);
    expect(engine.datasource('tree')).toBe(held);
    expect((engine as any).getDriver('tree_node')).toBe(held);
    // Re-applying the def does not wrap twice.
    engine.registerDatasourceDef({ name: 'tree', driver: 'spike_tree', schemaMode: 'external' });
    expect(engine.getDriverByName('tree')).toBe(held);
  });

  it('re-registering the same driver is not a name collision with its floored instance', () => {
    const { engine, remote } = makeEngine();
    const held = engine.getDriverByName('tree');
    expect(() => engine.registerDriver(remote.driver)).not.toThrow();
    expect(engine.getDriverByName('tree')).toBe(held);
  });
});

describe('[#27277] reads: the engine applies the query', () => {
  it('a driver that pushes nothing down still answers the filtered, sorted, paged, projected rows', async () => {
    const { engine, remote } = makeEngine();
    const rows = await engine.find('tree_node', {
      where: { kind: 'leaf' },
      orderBy: [{ field: 'weight', order: 'asc' }],
      limit: 2,
      offset: 1,
      fields: ['label'],
    });
    // leaves by weight asc, nulls last: n3(2), n6(2), n1(3), n4(null) — page 2 of size 2 from offset 1
    expect(ids(rows)).toEqual(['n6', 'n1']);
    expect(rows.map((r) => r.label)).toEqual(['Foxtrot', 'Echo']);
    // The driver was sent the filter and sort it may push down, the cap, and nothing else.
    const query = remote.sent.at(-1)!;
    expect(query.where).toEqual({ kind: 'leaf' });
    expect(query.orderBy).toEqual([{ field: 'weight', order: 'asc' }]);
    expect(query.limit).toBe(EXTERNAL_ROW_CAP + 1);
    expect(query).not.toHaveProperty('offset');
    expect(query).not.toHaveProperty('fields');
  });

  it('findOne answers the first matching row under the requested order', async () => {
    const { engine } = makeEngine();
    const row = await engine.findOne('tree_node', { where: { kind: 'branch' }, orderBy: [{ field: 'label', order: 'desc' }] });
    expect(row?.id).toBe('n5');
    expect(await engine.findOne('tree_node', { where: { kind: 'none' } })).toBeNull();
  });

  it('count answers the number of matching rows', async () => {
    const { engine } = makeEngine();
    expect(await engine.count('tree_node', { where: { kind: 'leaf' } })).toBe(4);
    expect(await engine.count('tree_node')).toBe(TREE_ROWS.length);
  });

  it('aggregate is hidden, so the engine aggregates the floored rows in memory', async () => {
    const { engine } = makeEngine();
    expect('aggregate' in engine.getDriverByName('tree')!).toBe(false);
    const groups = await engine.aggregate('tree_node', {
      where: { kind: 'leaf' },
      groupBy: ['kind'],
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(groups).toEqual([{ kind: 'leaf', n: 4 }]);
  });

  it(`exactly ${EXTERNAL_ROW_CAP} rows is answered`, async () => {
    const rows = Array.from({ length: EXTERNAL_ROW_CAP }, (_, i) => ({ id: `r${i}`, kind: 'leaf' }));
    const { engine } = makeEngine({ rows });
    expect(await engine.count('tree_node')).toBe(EXTERNAL_ROW_CAP);
  });

  it(`more than ${EXTERNAL_ROW_CAP} rows is refused 422 with the prescription, on every read`, async () => {
    const rows = Array.from({ length: EXTERNAL_ROW_CAP + 5 }, (_, i) => ({ id: `r${i}`, kind: 'leaf' }));
    const { engine } = makeEngine({ rows });
    for (const read of [
      () => engine.find('tree_node', { limit: 5 }),
      () => engine.findOne('tree_node', { where: { kind: 'leaf' } }),
      () => engine.count('tree_node'),
    ]) {
      const err = await read().then(() => undefined, (e) => e);
      expect(err).toBeInstanceOf(ExternalRowCapExceededError);
      expect(err.code).toBe('EXTERNAL_ROW_CAP_EXCEEDED');
      expect(err.status).toBe(422);
      expect(err.message).toContain('Narrow the filter');
      expect(err.message).toContain('DataSync');
    }
  });

  it('a read the remote fails is ERR_DATASOURCE_UNAVAILABLE / 503, the cause logged and never in the message', async () => {
    const { engine } = makeEngine({
      extra: { async find() { throw new Error('ECONNRESET talking to tree.internal:8443'); } },
    });
    const err = await engine.find('tree_node', {}).then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(DatasourceUnavailableError);
    expect(err.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
    expect(err.kind).toBe('remote');
    expect(err.message).not.toContain('tree.internal');
  });
});

describe('[#27277] writes pass through; a remote refusal is 422', () => {
  it('a write the remote accepts is the remote\'s answer', async () => {
    const { engine } = makeEngine({
      extra: { async create(_o: string, data: Row) { return { id: 'n9', ...data }; } },
    });
    const row = await engine.insert('tree_node', { kind: 'leaf', label: 'Golf' });
    expect(row).toMatchObject({ id: 'n9', label: 'Golf' });
  });

  it('a 4xx from the remote is EXTERNAL_WRITE_REFUSED / 422 carrying the remote\'s message and status', async () => {
    const { engine } = makeEngine({
      extra: {
        async create() {
          throw Object.assign(new Error('label must be unique within a parent'), { status: 409 });
        },
      },
    });
    const err = await engine.insert('tree_node', { kind: 'leaf', label: 'Echo' }).then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(ExternalWriteRefusedError);
    expect(err.code).toBe('EXTERNAL_WRITE_REFUSED');
    expect(err.status).toBe(422);
    expect(err.message).toContain('label must be unique within a parent');
    expect(err.details).toMatchObject({ datasource: 'tree', object: 'tree_node', operation: 'create', remoteStatus: 409 });
  });

  it('a write failure with no 4xx status is ERR_DATASOURCE_UNAVAILABLE / 503', async () => {
    const { engine } = makeEngine({
      extra: { async create() { throw Object.assign(new Error('upstream exploded'), { statusCode: 502 }); } },
    });
    const err = await engine.insert('tree_node', { kind: 'leaf' }).then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(DatasourceUnavailableError);
    expect(err.message).not.toContain('upstream exploded');
  });
});
