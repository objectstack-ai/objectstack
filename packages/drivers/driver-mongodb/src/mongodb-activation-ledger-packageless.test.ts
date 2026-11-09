// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D4] `sys_metadata_activation` is unique on
// `(metadata_type, package_id, name)`, built NULL-distinct here (#29278), so a
// row naming no package is constrained by it no longer. The collection also
// carries `uniq_sys_metadata_activation_packageless`: one such row per
// `(metadata_type, name)`. See `RUNTIME_OWNED_UNIQUES` in `mongodb-schema.ts`.
//
// Two suites, as `mongodb-unique-null-distinct.test.ts` has them: the DDL shape
// against a recording fake `Db` (every lane), and the server's answer against a
// real mongod (opt-in, #5517).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Db } from 'mongodb';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { syncCollectionSchema } from './mongodb-schema.js';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

const LEDGER = 'sys_metadata_activation';
const GUARD = 'uniq_sys_metadata_activation_packageless';
const NON_NULL_TYPES = [
  'double', 'string', 'object', 'array', 'binData', 'objectId', 'bool', 'date',
  'regex', 'javascript', 'int', 'timestamp', 'long', 'decimal', 'minKey', 'maxKey',
];

/** The ledger as `platform-objects` declares it, reduced to what schema sync reads. */
const ledgerSchema = {
  name: LEDGER,
  fields: {
    metadata_type: { type: 'text' },
    name: { type: 'text' },
    package_id: { type: 'text' },
    active: { type: 'boolean' },
  },
  indexes: [{ fields: ['metadata_type', 'package_id', 'name'], unique: 'global' as const }],
};

function recordingDb() {
  const created: Array<{ spec: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const db = {
    listCollections: () => ({ toArray: async () => [{ name: LEDGER }] }),
    createCollection: async () => {},
    collection: () => ({
      createIndex: async (spec: Record<string, unknown>, options: Record<string, unknown>) => {
        created.push({ spec, options });
      },
      indexes: async () => [],
      dropIndex: async () => {},
    }),
  } as unknown as Db;
  return { db, created };
}

describe('the package-less ledger index — DDL (recording Db, runs on every lane)', () => {
  it('the ledger collection gets a partial unique on (metadata_type, name) over rows whose package_id is null or missing', async () => {
    const { db, created } = recordingDb();
    await syncCollectionSchema(db, LEDGER, ledgerSchema);

    const guard = created.filter((c) => c.options.name === GUARD);
    expect(guard).toHaveLength(1);
    expect(Object.keys(guard[0].spec)).toEqual(['metadata_type', 'name']);
    expect(guard[0].options).toEqual({
      name: GUARD,
      unique: true,
      partialFilterExpression: {
        metadata_type: { $type: NON_NULL_TYPES },
        name: { $type: NON_NULL_TYPES },
        // Equality with null: matches a missing field AND an explicit null.
        package_id: null,
      },
    });
    // The declared key is still built as before, NULL-distinct on every part.
    expect(created.find((c) => c.options.name === 'idx_metadata_type_package_id_name_unique')?.options)
      .toMatchObject({ unique: true, partialFilterExpression: { package_id: { $type: NON_NULL_TYPES } } });
  });

  it('no other collection gets it, whatever it declares', async () => {
    const { db, created } = recordingDb();
    await syncCollectionSchema(db, 'lead', { ...ledgerSchema, name: 'lead' });
    expect(created.some((c) => c.options.name === GUARD)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Against a real mongod (opt-in, #5517)
// ---------------------------------------------------------------------------

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('MongoDB activation ledger package-less');

async function outcome(write: () => Promise<unknown>): Promise<'ok' | number> {
  try {
    await write();
    return 'ok';
  } catch (error: any) {
    return typeof error?.code === 'number' ? error.code : -1;
  }
}

describe.skipIf(!sharedMongod)('the package-less ledger index — against a real mongod', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'activation_ledger_packageless' });
    await driver.connect();
    await driver.syncSchema(LEDGER, ledgerSchema);
  }, 90_000);

  afterAll(async () => {
    await driver?.disconnect();
    await mongod?.stop();
  });

  const coll = () => ((driver as any).db as Db).collection(LEDGER);

  it('refuses a second row naming no package for one (metadata_type, name) — missing field or explicit null', async () => {
    expect(await outcome(() => coll().insertOne({ id: 'a', metadata_type: 'flow', name: 'x' }))).toBe('ok');
    expect(await outcome(() => coll().insertOne({ id: 'b', metadata_type: 'flow', name: 'x' }))).toBe(11000);
    expect(await outcome(() => coll().insertOne({ id: 'c', metadata_type: 'flow', name: 'x', package_id: null }))).toBe(11000);
  });

  it('admits two packages\' rows of that name, and refuses one package twice', async () => {
    expect(await outcome(() => coll().insertOne({ id: 'd', metadata_type: 'flow', name: 'x', package_id: 'p1' }))).toBe('ok');
    expect(await outcome(() => coll().insertOne({ id: 'e', metadata_type: 'flow', name: 'x', package_id: 'p2' }))).toBe('ok');
    expect(await outcome(() => coll().insertOne({ id: 'f', metadata_type: 'flow', name: 'x', package_id: 'p1' }))).toBe(11000);
  });
});
