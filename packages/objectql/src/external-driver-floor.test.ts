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
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
import { ObjectQL } from './engine';
import {
  EXTERNAL_ROW_CAP, ExternalReadRefusedError, ExternalRowCapExceededError, ExternalWriteRefusedError,
} from './external-driver-errors.js';
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

describe('[#27471] a read the driver refuses with a request-shaped 4xx is 400', () => {
  const refusingRead = (error: unknown) => makeEngine({ extra: { async find() { throw error; } } });
  /** The virtual-objects guide's `refuse()`: a by-name refusal carrying the status the floor reads. */
  const refuse = (what: string) =>
    Object.assign(new Error(`tree driver: the remote cannot run ${what}`), { status: 400 });
  /** A `where` a merge boundary vouched for as the caller's own. */
  const authored = <T>(where: T): T => markFilterSubtreeProvenance(where, 'author');

  it('the guide\'s refuse() answers INVALID_QUERY / 400 naming what the remote cannot run, on every read', async () => {
    const { engine } = refusingRead(refuse('the operator $gte on \'weight\''));
    for (const read of [
      () => engine.find('tree_node', { where: authored({ weight: { $gte: 2 } }) }),
      () => engine.findOne('tree_node', { where: authored({ weight: { $gte: 2 } }) }),
      () => engine.count('tree_node', { where: authored({ weight: { $gte: 2 } }) }),
    ]) {
      const err = await read().then(() => undefined, (e) => e);
      expect(err).toBeInstanceOf(ExternalReadRefusedError);
      expect(err.code).toBe('INVALID_QUERY');
      expect(err.status).toBe(400);
      expect(err.message).toContain("the remote cannot run the operator $gte on 'weight'");
      expect(err.details).toEqual({ datasource: 'tree', object: 'tree_node', operation: 'find', remoteStatus: 400 });
    }
  });

  for (const status of [400, 404, 422]) {
    it(`${status} (as \`status\` or \`statusCode\`) is 400 carrying the driver's message`, async () => {
      for (const key of ['status', 'statusCode']) {
        const { engine } = refusingRead(Object.assign(new Error(`remote said ${status}`), { [key]: status }));
        const err = await engine.find('tree_node', {}).then(() => undefined, (e) => e);
        expect(err).toBeInstanceOf(ExternalReadRefusedError);
        expect(err.code).toBe('INVALID_QUERY');
        expect(err.status).toBe(400);
        expect(err.message).toContain(`remote said ${status}`);
        expect(err.details.remoteStatus).toBe(status);
      }
    });
  }

  it('a registered code the driver declared is kept (ADR-0112), and remoteCode names it', async () => {
    const { engine } = refusingRead(
      Object.assign(new Error('tree driver: $regex is not a filter'), { status: 400, code: 'INVALID_FILTER' }),
    );
    const err = await engine.find('tree_node', {}).then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(ExternalReadRefusedError);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.details.remoteCode).toBe('INVALID_FILTER');
  });

  it('a code that is not registered answers INVALID_QUERY, and remoteCode still names it', async () => {
    const { engine } = refusingRead(
      Object.assign(new Error('tree driver: no such filter'), { status: 400, code: 'TREE_BAD_FILTER' }),
    );
    const err = await engine.find('tree_node', {}).then(() => undefined, (e) => e);
    expect(err.code).toBe('INVALID_QUERY');
    expect(err.details.remoteCode).toBe('TREE_BAD_FILTER');
  });

  it('a where no boundary vouched for is refused 400 with its reason withheld and logged', async () => {
    const warned: Array<Record<string, unknown> | undefined> = [];
    const { engine } = refusingRead(refuse("a filter on 'region' with comparand EMEA"));
    (engine as unknown as { logger: { warn: (m: string, meta?: Record<string, unknown>) => void } }).logger.warn =
      (_m, meta) => { warned.push(meta); };
    const err = await engine.find('tree_node', { where: { kind: 'leaf' } }).then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(ExternalReadRefusedError);
    expect(err.status).toBe(400);
    expect(err.message).not.toContain('EMEA');
    expect(err.message).toContain('server log');
    expect(warned.some((meta) => String(meta?.error).includes('EMEA'))).toBe(true);
  });

  it('a policy arm under an author root withholds the reason (#7929 fail-closed)', async () => {
    const { engine } = refusingRead(refuse("a filter on 'region' with comparand EMEA"));
    const where = authored({
      $and: [authored({ kind: 'leaf' }), markFilterSubtreeProvenance({ region: 'EMEA' }, 'policy')],
    });
    const err = await engine.find('tree_node', { where }).then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(ExternalReadRefusedError);
    expect(err.status).toBe(400);
    expect(err.message).not.toContain('EMEA');
    expect(err.details.remoteStatus).toBe(400);
  });

  for (const status of [401, 403, 407, 429, 500, 502, 503, 409, 412]) {
    it(`${status} stays ERR_DATASOURCE_UNAVAILABLE / 503, its text withheld`, async () => {
      const { engine } = refusingRead(Object.assign(new Error('token sk_live_123 rejected'), { status }));
      const err = await engine.find('tree_node', {}).then(() => undefined, (e) => e);
      expect(err).toBeInstanceOf(DatasourceUnavailableError);
      expect(err.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
      expect(err.kind).toBe('remote');
      expect(err.message).not.toContain('sk_live_123');
    });
  }

  it('a throw that declares no status stays ERR_DATASOURCE_UNAVAILABLE / 503, its text withheld', async () => {
    const { engine } = refusingRead(new Error('tree driver: the remote cannot run the combinator $or'));
    const err = await engine.find('tree_node', {}).then(() => undefined, (e) => e);
    expect(err).toBeInstanceOf(DatasourceUnavailableError);
    expect(err.message).not.toContain('$or');
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

describe('[#27277] only a request-shaped 4xx is a refusal of the write', () => {
  const refusing = (status: number, message: string) => makeEngine({
    extra: { async create() { throw Object.assign(new Error(message), { status }); } },
  });

  for (const status of [400, 404, 409, 412, 422]) {
    it(`${status} is EXTERNAL_WRITE_REFUSED / 422`, async () => {
      const { engine } = refusing(status, `remote said ${status}`);
      const err = await engine.insert('tree_node', { kind: 'leaf' }).then(() => undefined, (e) => e);
      expect(err).toBeInstanceOf(ExternalWriteRefusedError);
      expect(err.details.remoteStatus).toBe(status);
    });
  }

  for (const status of [401, 403, 407, 429]) {
    it(`${status} (a credential or rate-limit condition) is ERR_DATASOURCE_UNAVAILABLE / 503, its text withheld`, async () => {
      const { engine } = refusing(status, 'token sk_live_123 expired');
      const err = await engine.insert('tree_node', { kind: 'leaf' }).then(() => undefined, (e) => e);
      expect(err).toBeInstanceOf(DatasourceUnavailableError);
      expect(err.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
      expect(err.kind).toBe('remote');
      expect(err.message).not.toContain('sk_live_123');
    });
  }
});

describe('[#27277] predicate writes are not offered: every write reaches the driver by id', () => {
  const predicateDouble = () => {
    const writes: Row[] = [];
    const { engine, remote } = makeEngine({
      extra: {
        async update(_o: string, id: string, data: Row) { writes.push({ via: 'update', id }); return { id, ...data }; },
        async updateMany() { writes.push({ via: 'updateMany' }); return 99; },
        async deleteMany() { writes.push({ via: 'deleteMany' }); return 99; },
      },
    });
    return { engine, remote, writes };
  };

  it('updateMany and deleteMany are hidden on the floored instance', () => {
    const { engine, remote } = predicateDouble();
    const held = engine.getDriverByName('tree')!;
    expect('updateMany' in held).toBe(false);
    expect('deleteMany' in held).toBe(false);
    expect(held.updateMany).toBeUndefined();
    expect(held.deleteMany).toBeUndefined();
    expect(typeof (remote.driver as any).updateMany).toBe('function');
  });

  it('a by-id write under a precondition (ADR-0142 D4) takes the by-id path, not updateMany', async () => {
    const { engine, writes } = predicateDouble();
    await (engine as any).updateByIdExpecting(
      engine.getDriverByName('tree'), 'tree_node', 'n1', { label: 'Echo 2' }, { label: 'Echo' }, {},
    );
    expect(writes).toEqual([{ via: 'update', id: 'n1' }]);
  });

  it('a multi-row predicate update is refused, and the driver writes nothing', async () => {
    const { engine, writes } = predicateDouble();
    const err = await engine.update('tree_node', { label: 'x' }, { where: { kind: 'leaf' }, multi: true })
      .then(() => undefined, (e) => e);
    // A named refusal with its prescription, not the generic "requires an ID
    // or options.multi=true" this caller already satisfied.
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("Datasource 'tree' is served by a plugin driver");
    expect(err.message).toContain('multi-row predicate update');
    expect(err.message).toContain('update each record by id');
    expect(err.message).not.toContain('options.multi=true');
    expect(writes).toEqual([]);
  });

  it('a multi-row predicate delete is refused, and the driver writes nothing', async () => {
    const { engine, writes } = predicateDouble();
    const err = await engine.delete('tree_node', { where: { kind: 'leaf' }, multi: true })
      .then(() => undefined, (e) => e);
    // A named refusal with its prescription, not the generic "requires an ID
    // or options.multi=true" this caller already satisfied.
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("Datasource 'tree' is served by a plugin driver");
    expect(err.message).toContain('multi-row predicate delete');
    expect(err.message).toContain('delete each record by id');
    expect(err.message).not.toContain('options.multi=true');
    expect(writes).toEqual([]);
  });
});

describe('[#27277] a re-registration that names no driver keeps the floor', () => {
  it('a caller registering only the write-gate facts: def with driver, driver, then a def without driver', async () => {
    const engine = new ObjectQL();
    const remote = remoteDriver('tree', TREE_ROWS);
    engine.registerDatasourceDef({ name: 'tree', driver: 'spike_tree', schemaMode: 'external', external: { allowWrites: true } });
    engine.registerDriver(remote.driver);
    // A caller that registers only the write-gate facts (`schemaMode` and
    // `external`) and names no `driver`. The datasource-connection service is
    // not that caller: it names `driver` on every registration (the [#27666]
    // block below).
    engine.registerDatasourceDef({ name: 'tree', schemaMode: 'external', external: { allowWrites: true } });
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
    const held = engine.getDriverByName('tree')!;
    expect(isExternalDriverFloor(held)).toBe(true);
    expect(unwrapExternalDriverFloor(held)).toBe(remote.driver);
    // The where-ignoring driver still answers only the matching rows.
    expect(ids(await engine.find('tree_node', { where: { kind: 'branch' } }))).toEqual(['n2', 'n5']);
  });
});

describe('[#27666] the datasource-connection service\'s registrations floor a plugin driver, and a reconnect keeps it', () => {
  const TREE_PKG = {
    id: 'tree_pkg',
    name: 'Tree',
    objects: [{
      name: 'tree_node',
      datasource: 'tree',
      external: { remoteName: 'nodes', writable: true },
      fields: { kind: { type: 'text' }, label: { type: 'text' }, weight: { type: 'number' } },
    }],
  };
  /** What `DatasourceConnectionService.connect` registers after `registerDriver`: the def WITH its driver id. */
  const connectDef = (driver: string) => ({ name: 'tree', driver, schemaMode: 'external', external: { allowWrites: true } });

  it('a runtime-origin datasource (no manifest def): driver, then the connect def naming the driver id', async () => {
    const engine = new ObjectQL();
    const remote = remoteDriver('tree', TREE_ROWS);
    engine.registerDriver(remote.driver);
    engine.registerDatasourceDef(connectDef('spike_tree'));
    engine.registerApp(TREE_PKG as any);
    const held = engine.getDriverByName('tree')!;
    expect(isExternalDriverFloor(held)).toBe(true);
    expect(unwrapExternalDriverFloor(held)).toBe(remote.driver);
    expect(ids(await engine.find('tree_node', { where: { kind: 'branch' } }))).toEqual(['n2', 'n5']);
  });

  it('a reconnect (unregisterDriver, then the connect sequence) is still floored', async () => {
    const engine = new ObjectQL();
    const first = remoteDriver('tree', TREE_ROWS);
    engine.registerDriver(first.driver);
    engine.registerDatasourceDef(connectDef('spike_tree'));
    engine.registerApp(TREE_PKG as any);
    expect(isExternalDriverFloor(engine.getDriverByName('tree')!)).toBe(true);

    // `reconnect`: the eviction door drops the driver AND the stored def …
    expect(engine.unregisterDriver('tree')).toBe(true);
    expect(engine.getDriverByName('tree')).toBeUndefined();
    // … then `connect` registers the rebuilt pool and the def again, driver id included.
    const rebuilt = remoteDriver('tree', TREE_ROWS);
    engine.registerDriver(rebuilt.driver);
    engine.registerDatasourceDef(connectDef('spike_tree'));

    const held = engine.getDriverByName('tree')!;
    expect(isExternalDriverFloor(held)).toBe(true);
    expect(unwrapExternalDriverFloor(held)).toBe(rebuilt.driver);
    expect(ids(await engine.find('tree_node', { where: { kind: 'branch' } }))).toEqual(['n2', 'n5']);
    expect(rebuilt.sent).toHaveLength(1);
  });

  it('the failed-rebuild restore (unregisterDriver, then the OLD pool and its def back) is still floored', async () => {
    const engine = new ObjectQL();
    const old = remoteDriver('tree', TREE_ROWS);
    engine.registerDriver(old.driver);
    engine.registerDatasourceDef(connectDef('spike_tree'));
    engine.registerApp(TREE_PKG as any);

    engine.unregisterDriver('tree');
    // `restoreOldPool`: the kept driver instance and the def it was serving under, `previous.driver` included.
    engine.registerDriver(old.driver, false);
    engine.registerDatasourceDef(connectDef('spike_tree'));

    const held = engine.getDriverByName('tree')!;
    expect(isExternalDriverFloor(held)).toBe(true);
    expect(unwrapExternalDriverFloor(held)).toBe(old.driver);
    expect(ids(await engine.find('tree_node', { where: { kind: 'branch' } }))).toEqual(['n2', 'n5']);
  });

  it('control: after the eviction a re-registration that names no driver has nothing to keep, and the where-ignoring driver answers every row', async () => {
    // The defect's mechanism, pinned so the positive cases above are known to
    // depend on the driver id reaching `registerDatasourceDef`: the engine's
    // "keep the stored id" only keeps what the eviction left, which is nothing.
    const engine = new ObjectQL();
    const first = remoteDriver('tree', TREE_ROWS);
    engine.registerDriver(first.driver);
    engine.registerDatasourceDef(connectDef('spike_tree'));
    engine.registerApp(TREE_PKG as any);
    engine.unregisterDriver('tree');
    const rebuilt = remoteDriver('tree', TREE_ROWS);
    engine.registerDriver(rebuilt.driver);
    engine.registerDatasourceDef({ name: 'tree', schemaMode: 'external', external: { allowWrites: true } });
    expect(engine.getDriverByName('tree')).toBe(rebuilt.driver);
    expect(ids(await engine.find('tree_node', { where: { kind: 'branch' } }))).toHaveLength(TREE_ROWS.length);
  });

  it('a built-in driver through the same connect and reconnect sequences stays the registered instance itself', () => {
    const engine = new ObjectQL();
    const first = remoteDriver('tree', TREE_ROWS);
    engine.registerDriver(first.driver);
    engine.registerDatasourceDef(connectDef('sqlite'));
    engine.registerApp(TREE_PKG as any);
    expect(engine.getDriverByName('tree')).toBe(first.driver);
    engine.unregisterDriver('tree');
    const rebuilt = remoteDriver('tree', TREE_ROWS);
    engine.registerDriver(rebuilt.driver);
    engine.registerDatasourceDef(connectDef('sqlite'));
    expect(engine.getDriverByName('tree')).toBe(rebuilt.driver);
  });
});

describe('[#27727] listDatasourceDefs answers the stored driver id, the key the floor is decided on', () => {
  it('answers the id a registration named, and the id a later registration without one kept', () => {
    const engine = new ObjectQL();
    engine.registerDatasourceDef({ name: 'tree', driver: 'spike_tree', schemaMode: 'external', external: { allowWrites: true } });
    expect(engine.listDatasourceDefs()).toEqual([
      { name: 'tree', driver: 'spike_tree', schemaMode: 'external', external: { allowWrites: true } },
    ]);
    engine.registerDatasourceDef({ name: 'tree', schemaMode: 'external', external: { allowWrites: false } });
    expect(engine.listDatasourceDefs()).toEqual([
      { name: 'tree', driver: 'spike_tree', schemaMode: 'external', external: { allowWrites: false } },
    ]);
  });

  it('answers the id a package manifest declared', () => {
    const engine = new ObjectQL();
    engine.registerApp({
      id: 'tree_pkg',
      name: 'Tree',
      datasources: [{ name: 'tree', driver: 'spike_tree', schemaMode: 'external', external: { allowWrites: true } }],
    } as any);
    expect(engine.listDatasourceDefs().find((d) => d.name === 'tree')?.driver).toBe('spike_tree');
  });

  it('a definition that never named a driver is listed without the key, never as built in', () => {
    const engine = new ObjectQL();
    engine.registerDatasourceDef({ name: 'bare', schemaMode: 'external' });
    expect(engine.listDatasourceDefs()).toEqual([{ name: 'bare', schemaMode: 'external' }]);
  });
});
