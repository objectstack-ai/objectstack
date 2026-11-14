// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D4 and D8 row R11, #31699] ADR-0150 gives `sys_connector_connection`
// the key `(organization_id, connector_package, connector_name)`, which this
// driver builds NULL-distinct (#29278), so under it a connection naming no
// package is constrained no longer. The collection also carries
// `uniq_sys_connector_connection_packageless`: one such connection per
// `(connector_name)` — the key this driver built for the earlier
// `{ fields: ['connector_name'], unique: 'organization' }` (verbatim: no
// row-level tenancy here, #3724), so the widening arm reads it as that key's
// guard. See `RUNTIME_OWNED_UNIQUES` in `mongodb-schema.ts`; the SQL copy is
// metadata-protocol's `connector-connection-packageless-index.ts`.
//
// Two suites, as the grant's `mongodb-user-permission-set-packageless.test.ts`
// has them: the DDL shape and the widening arm against a recording fake `Db`
// (every lane), and the server's answer against a real mongod (opt-in, #5517).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Db } from 'mongodb';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { syncCollectionSchema } from './mongodb-schema.js';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

const CONNECTIONS = 'sys_connector_connection';
const GUARD = 'uniq_sys_connector_connection_packageless';
const NON_NULL_TYPES = [
  'double', 'string', 'object', 'array', 'binData', 'objectId', 'bool', 'date',
  'regex', 'javascript', 'int', 'timestamp', 'long', 'decimal', 'minKey', 'maxKey',
];
const nonNull = (fields: string[]) => Object.fromEntries(fields.map((f) => [f, { $type: NON_NULL_TYPES }]));

const OLD_FIELDS = ['connector_name'];
const NEW_FIELDS = ['organization_id', 'connector_package', 'connector_name'];
const OLD_UNIQUE = `idx_${OLD_FIELDS.join('_')}_unique`;
const NEW_UNIQUE = `idx_${NEW_FIELDS.join('_')}_unique`;

/** The connection object as service-automation declares it, reduced to what schema sync reads. */
const connectionSchema = {
  name: CONNECTIONS,
  fields: {
    organization_id: { type: 'text', required: true },
    connector_name: { type: 'text', required: true },
    connector_package: { type: 'text' },
  },
  indexes: [{ fields: NEW_FIELDS, unique: 'global' as const }],
};
/** The declaration an earlier release synced. */
const oldConnectionSchema = { ...connectionSchema, indexes: [{ fields: OLD_FIELDS, unique: 'organization' as const }] };

/** The old unique exactly as an earlier release's sync built it (verbatim, NULL-distinct, #29278). */
const oldUnique = { name: OLD_UNIQUE, key: { connector_name: 1 }, unique: true, partialFilterExpression: nonNull(OLD_FIELDS) };

/** A stateful recording `Db`, as the grant suite's. */
function statefulDb(seed: Array<Record<string, unknown>>, collection = CONNECTIONS) {
  const live = new Map<string, Record<string, unknown>>(seed.map((i) => [i.name as string, i]));
  const ops: string[] = [];
  const created: Array<{ spec: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const db = {
    listCollections: () => ({ toArray: async () => [{ name: collection }] }),
    createCollection: async () => {},
    collection: () => ({
      createIndex: async (spec: Record<string, unknown>, options: Record<string, unknown>) => {
        created.push({ spec, options });
        const name = options.name as string;
        if (!live.has(name)) {
          ops.push(`create ${name}`);
          live.set(name, { ...options, key: spec });
        }
      },
      indexes: async () => [...live.values()],
      dropIndex: async (name: string) => {
        ops.push(`drop ${name}`);
        live.delete(name);
      },
    }),
  } as unknown as Db;
  return { db, ops, created, names: () => [...live.keys()].sort() };
}

describe('the package-less connection index — DDL (recording Db, runs on every lane)', () => {
  it('the connection collection gets a partial unique on the old key (connector_name) over connections whose package is null or missing', async () => {
    const { db, created } = statefulDb([]);
    await syncCollectionSchema(db, CONNECTIONS, connectionSchema, { logger: { warn: vi.fn() } });

    const guard = created.filter((c) => c.options.name === GUARD);
    expect(guard).toHaveLength(1);
    expect(Object.keys(guard[0].spec)).toEqual(OLD_FIELDS);
    expect(guard[0].options).toEqual({
      name: GUARD,
      unique: true,
      partialFilterExpression: { ...nonNull(OLD_FIELDS), connector_package: null },
    });
    expect(created.find((c) => c.options.name === NEW_UNIQUE)?.options)
      .toMatchObject({ unique: true, partialFilterExpression: nonNull(NEW_FIELDS) });
  });

  it('no other collection gets it, whatever it declares', async () => {
    const { db, created } = statefulDb([], 'lead');
    await syncCollectionSchema(db, 'lead', { ...connectionSchema, name: 'lead' }, { logger: { warn: vi.fn() } });
    expect(created.some((c) => c.options.name === GUARD)).toBe(false);
  });
});

describe('the widening arm — an upgraded connection collection (recording Db, runs on every lane)', () => {
  it('retires the old (connector_name) unique AFTER the wider key and the package-less guard are created', async () => {
    const { db, ops, names } = statefulDb([oldUnique]);
    const logger = { warn: vi.fn() };
    await syncCollectionSchema(db, CONNECTIONS, connectionSchema, { logger });

    expect(names()).not.toContain(OLD_UNIQUE);
    expect(names()).toEqual(expect.arrayContaining([NEW_UNIQUE, GUARD]));
    expect(ops.at(-1)).toBe(`drop ${OLD_UNIQUE}`);
    expect(ops.indexOf(`create ${GUARD}`)).toBeLessThan(ops.indexOf(`drop ${OLD_UNIQUE}`));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toEqual({ collection: CONNECTIONS, retired: OLD_UNIQUE, oldKey: OLD_FIELDS, newKey: NEW_FIELDS });
  });

  it('CONTROL — the same shapes on another collection (no guard) keep the old unique', async () => {
    const { db, ops } = statefulDb([oldUnique], 'lead');
    await syncCollectionSchema(db, 'lead', { ...connectionSchema, name: 'lead' }, { logger: { warn: vi.fn() } });
    expect(ops).not.toContain(`drop ${OLD_UNIQUE}`);
  });
});

// ---------------------------------------------------------------------------
// Against a real mongod (opt-in, #5517)
// ---------------------------------------------------------------------------

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('MongoDB connection package-less');

afterAll(async () => {
  await sharedMongod?.stop();
});

async function outcome(write: () => Promise<unknown>): Promise<'ok' | number> {
  try {
    await write();
    return 'ok';
  } catch (error: any) {
    return typeof error?.code === 'number' ? error.code : -1;
  }
}

describe.skipIf(!sharedMongod)('the package-less connection index — against a real mongod', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;
  let oldDriver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'connection_packageless' });
    await driver.connect();
    await driver.syncSchema(CONNECTIONS, connectionSchema);
    oldDriver = new MongoDBDriver({ url: mongod.getUri(), database: 'connection_packageless_old_key' });
    await oldDriver.connect();
    await oldDriver.syncSchema(CONNECTIONS, oldConnectionSchema);
  }, 90_000);

  afterAll(async () => {
    await driver?.disconnect();
    await oldDriver?.disconnect();
  });

  const coll = (d: MongoDBDriver) => ((d as any).db as Db).collection(CONNECTIONS);
  const row = (id: string, extra: Record<string, unknown>) => ({ id, organization_id: 'org_1', connector_name: 'github', ...extra });

  it('side by side with the old key: refuses what it refused among package-less rows, and admits a second package\'s instance of the name', async () => {
    const rows: Array<[string, Record<string, unknown>]> = [
      ['n1', {}],
      ['n2', {}],
      ['n3', { connector_package: null }],
      ['p1', { connector_package: 'com.acme.crm' }],
      ['p2', { connector_package: 'com.acme.hr' }],
      ['p3', { connector_package: 'com.acme.crm' }],
    ];
    const answers: Array<{ id: string; old: 'ok' | number; now: 'ok' | number }> = [];
    for (const [id, extra] of rows) {
      answers.push({
        id,
        old: await outcome(() => coll(oldDriver).insertOne(row(id, extra))),
        now: await outcome(() => coll(driver).insertOne(row(id, extra))),
      });
    }
    expect(answers).toEqual([
      { id: 'n1', old: 'ok', now: 'ok' },
      { id: 'n2', old: 11000, now: 11000 },
      { id: 'n3', old: 11000, now: 11000 },
      // The old (connector_name) key refused every second row of the name.
      { id: 'p1', old: 11000, now: 'ok' },
      { id: 'p2', old: 11000, now: 'ok' },
      { id: 'p3', old: 11000, now: 11000 },
    ]);
  });
});
