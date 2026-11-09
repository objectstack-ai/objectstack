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

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
// The widening arm: an upgraded collection's old two-part unique (#31732)
// ---------------------------------------------------------------------------

const OLD_UNIQUE = 'idx_metadata_type_name_unique';
const NEW_UNIQUE = 'idx_metadata_type_package_id_name_unique';
const nonNull = (fields: string[]) => Object.fromEntries(fields.map((f) => [f, { $type: NON_NULL_TYPES }]));
/** The old unique exactly as an earlier release's sync built it (NULL-distinct, #29278). */
const oldUnique = { name: OLD_UNIQUE, key: { metadata_type: 1, name: 1 }, unique: true, partialFilterExpression: nonNull(['metadata_type', 'name']) };

/**
 * A stateful recording `Db`: `indexes()` answers what was seeded plus what the
 * sync created since, and `dropIndex` removes one — so the arm's "confirmed
 * present" read sees the create loop's work, as on a real server.
 */
function statefulDb(seed: Array<Record<string, unknown>>) {
  const live = new Map<string, Record<string, unknown>>(seed.map((i) => [i.name as string, i]));
  const ops: string[] = [];
  const db = {
    listCollections: () => ({ toArray: async () => [{ name: LEDGER }] }),
    createCollection: async () => {},
    collection: () => ({
      createIndex: async (spec: Record<string, unknown>, options: Record<string, unknown>) => {
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
  return { db, ops, names: () => [...live.keys()].sort() };
}

describe('the widening arm — an upgraded collection (recording Db, runs on every lane)', () => {
  it('retires the old two-part unique AFTER the wider key and the package-less guard are created, with one log line', async () => {
    const { db, ops, names } = statefulDb([oldUnique]);
    const logger = { warn: vi.fn() };
    await syncCollectionSchema(db, LEDGER, ledgerSchema, { logger });

    expect(names()).not.toContain(OLD_UNIQUE);
    expect(names()).toEqual(expect.arrayContaining([NEW_UNIQUE, GUARD]));
    // Create-before-drop: the drop is the last op, after both creates.
    expect(ops.at(-1)).toBe(`drop ${OLD_UNIQUE}`);
    expect(ops.indexOf(`create ${NEW_UNIQUE}`)).toBeLessThan(ops.indexOf(`drop ${OLD_UNIQUE}`));
    expect(ops.indexOf(`create ${GUARD}`)).toBeLessThan(ops.indexOf(`drop ${OLD_UNIQUE}`));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toEqual({
      collection: LEDGER,
      retired: OLD_UNIQUE,
      oldKey: ['metadata_type', 'name'],
      newKey: ['metadata_type', 'package_id', 'name'],
    });
    // The plain READ index over the old key is not the arm's: it refuses nothing and still serves lookups.
    expect(ops).not.toContain('drop idx_metadata_type_name');
  });

  it('the pre-#29278 sparse shape of the old unique is this driver\'s too, and is retired the same way', async () => {
    const { db, names } = statefulDb([{ name: OLD_UNIQUE, key: { metadata_type: 1, name: 1 }, unique: true, sparse: true }]);
    await syncCollectionSchema(db, LEDGER, ledgerSchema, { logger: { warn: vi.fn() } });
    expect(names()).not.toContain(OLD_UNIQUE);
  });

  it('CONTROL — a fresh collection: nothing to retire, nothing dropped, no log line', async () => {
    const { db, ops } = statefulDb([]);
    const logger = { warn: vi.fn() };
    await syncCollectionSchema(db, LEDGER, ledgerSchema, { logger });
    expect(ops.filter((o) => o.startsWith('drop'))).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('CONTROL — a narrower unique metadata still declares is KEPT', async () => {
    const { db, ops } = statefulDb([oldUnique]);
    const schema = { ...ledgerSchema, indexes: [...ledgerSchema.indexes, { fields: ['metadata_type', 'name'], unique: 'global' as const }] };
    await syncCollectionSchema(db, LEDGER, schema, { logger: { warn: vi.fn() } });
    expect(ops).not.toContain(`drop ${OLD_UNIQUE}`);
  });

  it('a nullable gained field with NO package-less guard keeps the old unique (another collection, same shapes)', async () => {
    // `RUNTIME_OWNED_UNIQUES` builds the guard on the ledger only, so on any
    // other collection the old index is still the only rule over rows whose
    // gained field is null — dropping it would drop that rule, not relax it.
    const { db, ops } = statefulDb([oldUnique]);
    await syncCollectionSchema(db, 'lead', { ...ledgerSchema, name: 'lead' }, { logger: { warn: vi.fn() } });
    expect(ops).not.toContain(`drop ${OLD_UNIQUE}`);
  });

  it('a gained field the object declares required needs no guard: retired', async () => {
    const { db, ops } = statefulDb([oldUnique]);
    const schema = { ...ledgerSchema, name: 'lead', fields: { ...ledgerSchema.fields, package_id: { type: 'text', required: true } } };
    await syncCollectionSchema(db, 'lead', schema, { logger: { warn: vi.fn() } });
    expect(ops).toContain(`drop ${OLD_UNIQUE}`);
  });

  it('never drops an index of that name this driver did not build (other options), nor one whose wider key is missing', async () => {
    const foreign = { ...oldUnique, partialFilterExpression: { metadata_type: { $exists: true } } };
    const a = statefulDb([foreign]);
    await syncCollectionSchema(a.db, LEDGER, ledgerSchema, { logger: { warn: vi.fn() } });
    expect(a.ops).not.toContain(`drop ${OLD_UNIQUE}`);

    // The wider key's create silently skipped (an operator's own index holds its name with other options).
    const b = statefulDb([oldUnique, { name: NEW_UNIQUE, key: { metadata_type: 1, package_id: 1, name: 1 } }]);
    await syncCollectionSchema(b.db, LEDGER, ledgerSchema, { logger: { warn: vi.fn() } });
    expect(b.ops).not.toContain(`drop ${OLD_UNIQUE}`);
  });

  it('claims nothing for a NAMED declaration (its name never changed, so there is no second name to retire)', async () => {
    const { db, ops } = statefulDb([oldUnique]);
    const schema = { ...ledgerSchema, indexes: [{ name: 'ledger_key', fields: ['metadata_type', 'package_id', 'name'], unique: 'global' as const }] };
    await syncCollectionSchema(db, LEDGER, schema, { logger: { warn: vi.fn() } });
    expect(ops).not.toContain(`drop ${OLD_UNIQUE}`);
  });
});

// ---------------------------------------------------------------------------
// Against a real mongod (opt-in, #5517)
// ---------------------------------------------------------------------------

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('MongoDB activation ledger package-less');

// One server for both real-mongod suites below, stopped once after the last.
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

describe.skipIf(!sharedMongod)('the widening arm — an upgraded collection on a real mongod', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'activation_ledger_widened' });
    await driver.connect();
    // The collection an earlier release built…
    await driver.syncSchema(LEDGER, { ...ledgerSchema, indexes: [{ fields: ['metadata_type', 'name'], unique: 'global' }] });
    // …synced by this release's declaration.
    await driver.syncSchema(LEDGER, ledgerSchema);
  }, 90_000);

  afterAll(async () => {
    await driver?.disconnect();
  });

  const coll = () => ((driver as any).db as Db).collection(LEDGER);

  it('the old two-part unique is gone; the wider key, the guard and the read index stand', async () => {
    const names = (await coll().indexes()).map((i) => i.name);
    expect(names).not.toContain(OLD_UNIQUE);
    expect(names).toEqual(expect.arrayContaining([NEW_UNIQUE, GUARD, 'idx_metadata_type_name']));
  });

  it('two packages\' rows of one name are admitted; a second package-less row and one package twice are refused', async () => {
    expect(await outcome(() => coll().insertOne({ id: 'w1', metadata_type: 'flow', name: 'y' }))).toBe('ok');
    expect(await outcome(() => coll().insertOne({ id: 'w2', metadata_type: 'flow', name: 'y', package_id: null }))).toBe(11000);
    expect(await outcome(() => coll().insertOne({ id: 'w3', metadata_type: 'flow', name: 'y', package_id: 'p1' }))).toBe('ok');
    expect(await outcome(() => coll().insertOne({ id: 'w4', metadata_type: 'flow', name: 'y', package_id: 'p2' }))).toBe('ok');
    expect(await outcome(() => coll().insertOne({ id: 'w5', metadata_type: 'flow', name: 'y', package_id: 'p1' }))).toBe(11000);
  });
});
