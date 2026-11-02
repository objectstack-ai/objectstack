// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #29278 — a unique index here is NULL-distinct, like driver-sql's and
// driver-memory's: two records whose unique field is `null` (or missing) never
// collide, and every non-null duplicate is still refused.
//
// Two suites, for the reason `mongodb-schema-declared-indexes.test.ts` gives:
// the real-server suite is OPT-IN (`OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1`,
// #5517), so the DDL shape is ALSO pinned against a recording fake `Db`, which
// is the copy every ordinary CI lane runs. The real-server suite is the one that
// proves MongoDB answers the shape the way the docblock on
// `NON_NULL_BSON_TYPES` in `mongodb-schema.ts` says.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { syncCollectionSchema } from './mongodb-schema.js';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

interface Recorded {
  op: 'createIndex' | 'dropIndex';
  spec?: Record<string, unknown>;
  options?: Record<string, unknown>;
  name?: string;
}

const NON_NULL_TYPES = [
  'double', 'string', 'object', 'array', 'binData', 'objectId', 'bool', 'date',
  'regex', 'javascript', 'int', 'timestamp', 'long', 'decimal', 'minKey', 'maxKey',
];

/**
 * A recording fake of the `Db` slice `syncCollectionSchema` touches. `existing`
 * seeds `collection.indexes()`; `conflictOn` names indexes whose FIRST
 * `createIndex` throws the given server error, as a real server does when an
 * index of that name already exists with other options.
 */
function fakeDb(opts: {
  existing?: Array<Record<string, unknown>>;
  conflictOn?: Record<string, { code: number; codeName: string }>;
} = {}) {
  const calls: Recorded[] = [];
  const thrown = new Set<string>();
  const db = {
    listCollections: () => ({ toArray: async () => [{ name: 'lead' }] }),
    createCollection: async () => {},
    collection: () => ({
      createIndex: async (spec: Record<string, unknown>, options: Record<string, unknown>) => {
        calls.push({ op: 'createIndex', spec, options });
        const name = options.name as string;
        const conflict = opts.conflictOn?.[name];
        if (conflict && !thrown.has(name)) {
          thrown.add(name);
          throw Object.assign(new Error(`conflict on ${name}`), conflict);
        }
      },
      indexes: async () => opts.existing ?? [],
      dropIndex: async (name: string) => {
        calls.push({ op: 'dropIndex', name });
      },
    }),
  } as unknown as Db;
  return { db, calls };
}

const created = (calls: Recorded[], name: string) =>
  calls.filter((c) => c.op === 'createIndex' && c.options?.name === name);

const LEGACY_86 = { code: 86, codeName: 'IndexKeySpecsConflict' };

describe('#29278 — the unique index DDL (recording Db, runs on every lane)', () => {
  it('a field-level unique index is partial over the non-null types, never sparse', async () => {
    const { db, calls } = fakeDb();
    await syncCollectionSchema(db, 'lead', { name: 'lead', fields: { code: { type: 'text', unique: true } } });

    const [idx] = created(calls, 'idx_code_unique');
    expect(idx.spec).toEqual({ code: 1 });
    expect(idx.options).toEqual({
      name: 'idx_code_unique',
      unique: true,
      partialFilterExpression: { code: { $type: NON_NULL_TYPES } },
    });
    expect(idx.options).not.toHaveProperty('sparse');
  });

  it('adds a plain read index over the same key, BEFORE the unique index', async () => {
    // The planner cannot use the partial index for `find({ code: 'x' })`, so
    // this is the index that serves lookups by the unique field.
    const { db, calls } = fakeDb();
    await syncCollectionSchema(db, 'lead', { name: 'lead', fields: { code: { type: 'text', unique: true } } });

    const names = calls.map((c) => c.options?.name);
    const [read] = created(calls, 'idx_code');
    expect(read.spec).toEqual({ code: 1 });
    expect(read.options).toEqual({ name: 'idx_code' });
    expect(names.indexOf('idx_code')).toBeLessThan(names.indexOf('idx_code_unique'));
  });

  it('a declared multi-column unique index exempts a row with a null in ANY key part', async () => {
    const { db, calls } = fakeDb();
    await syncCollectionSchema(db, 'lead', {
      name: 'lead',
      fields: { region: { type: 'text' }, code: { type: 'text' } },
      indexes: [{ fields: ['region', 'code'], unique: 'global' }],
    });

    const [idx] = created(calls, 'idx_region_code_unique');
    expect(Object.keys(idx.spec!)).toEqual(['region', 'code']);
    expect(idx.options!.partialFilterExpression).toEqual({
      region: { $type: NON_NULL_TYPES },
      code: { $type: NON_NULL_TYPES },
    });
    expect(idx.options).not.toHaveProperty('sparse');
    expect(created(calls, 'idx_region_code')).toHaveLength(1);
  });

  it('an author-named unique index that already takes the read name gets no second index of that name', async () => {
    const { db, calls } = fakeDb();
    await syncCollectionSchema(db, 'lead', {
      name: 'lead',
      fields: { code: { type: 'text' } },
      indexes: [{ name: 'idx_code', fields: ['code'], unique: true }],
    });

    const named = created(calls, 'idx_code');
    expect(named).toHaveLength(1);
    expect(named[0].options!.unique).toBe(true);
  });

  it('rebuilds the legacy sparse unique index a collection synced before this change still carries', async () => {
    const { db, calls } = fakeDb({
      existing: [{ name: 'idx_code_unique', key: { code: 1 }, unique: true, sparse: true }],
      conflictOn: { idx_code_unique: LEGACY_86 },
    });
    await syncCollectionSchema(db, 'lead', { name: 'lead', fields: { code: { type: 'text', unique: true } } });

    const seq = calls.filter((c) => c.name === 'idx_code_unique' || c.options?.name === 'idx_code_unique');
    expect(seq.map((c) => c.op)).toEqual(['createIndex', 'dropIndex', 'createIndex']);
    expect(seq[2].options!.partialFilterExpression).toEqual({ code: { $type: NON_NULL_TYPES } });
  });

  it('leaves a same-name index it did not build alone, and the conflict still throws', async () => {
    // Deliberately exact: an index carrying an option this driver never wrote
    // (here `collation`) is not the legacy shape, so it is neither dropped nor
    // skipped; the sync fails as it did before this change.
    const { db, calls } = fakeDb({
      existing: [{ name: 'idx_code_unique', key: { code: 1 }, unique: true, collation: { locale: 'en' } }],
      conflictOn: { idx_code_unique: LEGACY_86 },
    });
    await expect(
      syncCollectionSchema(db, 'lead', { name: 'lead', fields: { code: { type: 'text', unique: true } } }),
    ).rejects.toMatchObject({ code: 86 });
    expect(calls.some((c) => c.op === 'dropIndex')).toBe(false);
  });

  it('does not rebuild a sparse unique index over OTHER keys that happens to hold the name', async () => {
    const { db, calls } = fakeDb({
      existing: [{ name: 'idx_code_unique', key: { other: 1 }, unique: true, sparse: true }],
      conflictOn: { idx_code_unique: LEGACY_86 },
    });
    await expect(
      syncCollectionSchema(db, 'lead', { name: 'lead', fields: { code: { type: 'text', unique: true } } }),
    ).rejects.toMatchObject({ code: 86 });
    expect(calls.some((c) => c.op === 'dropIndex')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Against a real mongod (opt-in, #5517)
// ---------------------------------------------------------------------------

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('MongoDB unique NULL-distinct');

/** The server's answer to a write: `'ok'`, or the server error code. */
async function outcome(write: () => Promise<unknown>): Promise<'ok' | number> {
  try {
    await write();
    return 'ok';
  } catch (error: any) {
    return typeof error?.code === 'number' ? error.code : -1;
  }
}

const DUPLICATE_KEY = 11000;

describe.skipIf(!sharedMongod)('#29278 — the unique index against a real mongod', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;
  const schema = {
    name: 'lead',
    fields: { code: { type: 'text', unique: true }, region: { type: 'text' }, tag: { type: 'text' } },
    indexes: [{ fields: ['region', 'tag'], unique: true }],
  };

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'unique_null_distinct' });
    await driver.connect();
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
    const db = driver.getDb();
    for (const col of await db.listCollections().toArray()) await db.dropCollection(col.name);
    await driver.syncSchema('lead', schema);
  });

  it('admits two records whose unique field is null', async () => {
    expect(await outcome(() => driver.create('lead', { code: null }))).toBe('ok');
    expect(await outcome(() => driver.create('lead', { code: null }))).toBe('ok');
    expect(await driver.count('lead')).toBe(2);
  });

  it('admits two records cleared to null by update', async () => {
    const a = await driver.create('lead', { code: 'A' });
    const b = await driver.create('lead', { code: 'B' });
    expect(await outcome(() => driver.update('lead', a.id as string, { code: null }))).toBe('ok');
    expect(await outcome(() => driver.update('lead', b.id as string, { code: null }))).toBe('ok');
  });

  it('admits two records that omit the unique field', async () => {
    expect(await outcome(() => driver.create('lead', {}))).toBe('ok');
    expect(await outcome(() => driver.create('lead', {}))).toBe('ok');
  });

  it('still refuses a non-null duplicate with the server\'s duplicate-key error', async () => {
    await driver.create('lead', { code: 'X' });
    let error: any;
    try {
      await driver.create('lead', { code: 'X' });
    } catch (e) {
      error = e;
    }
    expect(error?.code).toBe(DUPLICATE_KEY);
    expect(String(error?.message)).toMatch(/^E11000 duplicate key error/);
  });

  it('still refuses two empty strings — `\'\'` is a value, as on driver-sql', async () => {
    expect(await outcome(() => driver.create('lead', { code: '' }))).toBe('ok');
    expect(await outcome(() => driver.create('lead', { code: '' }))).toBe(DUPLICATE_KEY);
  });

  it('a declared two-column unique index exempts a row with a null part and refuses a full duplicate', async () => {
    expect(await outcome(() => driver.create('lead', { region: 'eu', tag: null }))).toBe('ok');
    expect(await outcome(() => driver.create('lead', { region: 'eu', tag: null }))).toBe('ok');
    expect(await outcome(() => driver.create('lead', { region: 'eu', tag: 't' }))).toBe('ok');
    expect(await outcome(() => driver.create('lead', { region: 'eu', tag: 't' }))).toBe(DUPLICATE_KEY);
  });

  it('serves a lookup by the unique field from an index, not a collection scan', async () => {
    await driver.create('lead', { code: 'X' });
    const plan = await driver.getDb().collection('lead').find({ code: 'X' }).explain();
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).not.toContain('COLLSCAN');
  });

  it('migrates a collection synced before this change: the legacy sparse index is rebuilt at the next sync', async () => {
    const db = driver.getDb();
    await db.dropCollection('lead');
    await db.createCollection('lead');
    await db.collection('lead').createIndex({ code: 1 }, { name: 'idx_code_unique', unique: true, sparse: true });
    await driver.create('lead', { code: null });
    await driver.create('lead', { code: 'X' });
    // The premise, on the legacy index.
    expect(await outcome(() => driver.create('lead', { code: null }))).toBe(DUPLICATE_KEY);

    await driver.syncSchema('lead', schema);

    const idx = (await db.collection('lead').indexes()).find((i) => i.name === 'idx_code_unique');
    expect(idx?.sparse).toBeUndefined();
    expect(idx?.partialFilterExpression).toEqual({ code: { $type: NON_NULL_TYPES } });
    expect(await outcome(() => driver.create('lead', { code: null }))).toBe('ok');
    expect(await outcome(() => driver.create('lead', { code: 'X' }))).toBe(DUPLICATE_KEY);
    // And a second sync is a no-op.
    await driver.syncSchema('lead', schema);
    expect((await db.collection('lead').indexes()).filter((i) => i.name === 'idx_code_unique')).toHaveLength(1);
  });
});
