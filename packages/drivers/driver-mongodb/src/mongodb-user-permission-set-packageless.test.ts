// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D4, #32164] `sys_user_permission_set` is unique on
// `(user_id, permission_set, permission_set_package, organization_id)`, built
// NULL-distinct here (#29278), so a grant naming no package is constrained by
// it no longer. The collection also carries
// `uniq_sys_user_permission_set_packageless`: one such grant per
// `(user_id, permission_set, organization_id)`. See `RUNTIME_OWNED_UNIQUES` in
// `mongodb-schema.ts`; the SQL copy is metadata-protocol's
// `user-permission-set-packageless-index.ts`.
//
// Two suites, as the ledger's `mongodb-activation-ledger-packageless.test.ts`
// has them: the DDL shape and the widening arm against a recording fake `Db`
// (every lane), and the server's answer against a real mongod (opt-in, #5517).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Db } from 'mongodb';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { syncCollectionSchema } from './mongodb-schema.js';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

const GRANTS = 'sys_user_permission_set';
const GUARD = 'uniq_sys_user_permission_set_packageless';
const NON_NULL_TYPES = [
  'double', 'string', 'object', 'array', 'binData', 'objectId', 'bool', 'date',
  'regex', 'javascript', 'int', 'timestamp', 'long', 'decimal', 'minKey', 'maxKey',
];
const nonNull = (fields: string[]) => Object.fromEntries(fields.map((f) => [f, { $type: NON_NULL_TYPES }]));

const OLD_FIELDS = ['user_id', 'permission_set', 'organization_id'];
const NEW_FIELDS = ['user_id', 'permission_set', 'permission_set_package', 'organization_id'];
const OLD_UNIQUE = `idx_${OLD_FIELDS.join('_')}_unique`;
const NEW_UNIQUE = `idx_${NEW_FIELDS.join('_')}_unique`;

/** The grant object as plugin-security declares it, reduced to what schema sync reads. */
const grantSchema = {
  name: GRANTS,
  fields: {
    user_id: { type: 'lookup', reference: 'sys_user', required: true },
    permission_set: { type: 'text', required: true },
    permission_set_package: { type: 'text' },
    organization_id: { type: 'lookup', reference: 'sys_organization' },
  },
  indexes: [
    { fields: NEW_FIELDS, unique: 'global' as const },
    { fields: ['user_id'] },
    { fields: ['organization_id'] },
  ],
};
/** The declaration an earlier release synced. */
const oldGrantSchema = { ...grantSchema, indexes: [{ fields: OLD_FIELDS, unique: 'organization' as const }] };

/** The old unique exactly as an earlier release's sync built it (verbatim, NULL-distinct, #29278). */
const oldUnique = { name: OLD_UNIQUE, key: { user_id: 1, permission_set: 1, organization_id: 1 }, unique: true, partialFilterExpression: nonNull(OLD_FIELDS) };

/**
 * A stateful recording `Db`: `indexes()` answers what was seeded plus what the
 * sync created since, and `dropIndex` removes one.
 */
function statefulDb(seed: Array<Record<string, unknown>>, collection = GRANTS) {
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

describe('the package-less grant index — DDL (recording Db, runs on every lane)', () => {
  it('the grant collection gets a partial unique on (user_id, permission_set, organization_id) over grants whose package is null or missing', async () => {
    const { db, created } = statefulDb([]);
    await syncCollectionSchema(db, GRANTS, grantSchema, { logger: { warn: vi.fn() } });

    const guard = created.filter((c) => c.options.name === GUARD);
    expect(guard).toHaveLength(1);
    expect(Object.keys(guard[0].spec)).toEqual(OLD_FIELDS);
    expect(guard[0].options).toEqual({
      name: GUARD,
      unique: true,
      partialFilterExpression: {
        ...nonNull(OLD_FIELDS),
        // Equality with null: matches a missing field AND an explicit null.
        permission_set_package: null,
      },
    });
    // The declared key is built as every declared unique is, NULL-distinct on every part.
    expect(created.find((c) => c.options.name === NEW_UNIQUE)?.options)
      .toMatchObject({ unique: true, partialFilterExpression: nonNull(NEW_FIELDS) });
  });

  it('no other collection gets it, whatever it declares', async () => {
    const { db, created } = statefulDb([], 'lead');
    await syncCollectionSchema(db, 'lead', { ...grantSchema, name: 'lead' }, { logger: { warn: vi.fn() } });
    expect(created.some((c) => c.options.name === GUARD)).toBe(false);
  });
});

describe('the widening arm — an upgraded grant collection (recording Db, runs on every lane)', () => {
  it('retires the old three-part unique AFTER the wider key and the package-less guard are created', async () => {
    const { db, ops, names } = statefulDb([oldUnique]);
    const logger = { warn: vi.fn() };
    await syncCollectionSchema(db, GRANTS, grantSchema, { logger });

    expect(names()).not.toContain(OLD_UNIQUE);
    expect(names()).toEqual(expect.arrayContaining([NEW_UNIQUE, GUARD]));
    expect(ops.at(-1)).toBe(`drop ${OLD_UNIQUE}`);
    expect(ops.indexOf(`create ${GUARD}`)).toBeLessThan(ops.indexOf(`drop ${OLD_UNIQUE}`));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toEqual({ collection: GRANTS, retired: OLD_UNIQUE, oldKey: OLD_FIELDS, newKey: NEW_FIELDS });
  });

  it('CONTROL — the same shapes on another collection (no guard) keep the old unique', async () => {
    const { db, ops } = statefulDb([oldUnique], 'lead');
    await syncCollectionSchema(db, 'lead', { ...grantSchema, name: 'lead' }, { logger: { warn: vi.fn() } });
    expect(ops).not.toContain(`drop ${OLD_UNIQUE}`);
  });
});

// ---------------------------------------------------------------------------
// Against a real mongod (opt-in, #5517)
// ---------------------------------------------------------------------------

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('MongoDB grant package-less');

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

describe.skipIf(!sharedMongod)('the package-less grant index — against a real mongod', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;
  let oldDriver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'grant_packageless' });
    await driver.connect();
    await driver.syncSchema(GRANTS, grantSchema);
    // The key this one replaced, alone, in its own database: the side-by-side reading.
    oldDriver = new MongoDBDriver({ url: mongod.getUri(), database: 'grant_packageless_old_key' });
    await oldDriver.connect();
    await oldDriver.syncSchema(GRANTS, oldGrantSchema);
  }, 90_000);

  afterAll(async () => {
    await driver?.disconnect();
    await oldDriver?.disconnect();
  });

  const coll = (d: MongoDBDriver) => ((d as any).db as Db).collection(GRANTS);
  const grant = (id: string, extra: Record<string, unknown>) => ({ id, user_id: 'u1', permission_set: 'sales_rep', ...extra });

  it('refuses a second grant naming no package in one organization — missing field or explicit null', async () => {
    expect(await outcome(() => coll(driver).insertOne(grant('a', { organization_id: 'org_1' })))).toBe('ok');
    expect(await outcome(() => coll(driver).insertOne(grant('b', { organization_id: 'org_1' })))).toBe(11000);
    expect(await outcome(() => coll(driver).insertOne(grant('c', { organization_id: 'org_1', permission_set_package: null })))).toBe(11000);
  });

  it('admits two packages\' grants of that set, and refuses one package twice', async () => {
    expect(await outcome(() => coll(driver).insertOne(grant('d', { organization_id: 'org_1', permission_set_package: 'com.acme.crm' })))).toBe('ok');
    expect(await outcome(() => coll(driver).insertOne(grant('e', { organization_id: 'org_1', permission_set_package: 'com.acme.hr' })))).toBe('ok');
    expect(await outcome(() => coll(driver).insertOne(grant('f', { organization_id: 'org_1', permission_set_package: 'com.acme.crm' })))).toBe(11000);
  });

  it('admits nothing the old key refused, with a non-null and a missing organization (epic condition 1)', async () => {
    const rows: Array<[string, Record<string, unknown>]> = [
      ['n1', { organization_id: 'org_2' }],
      ['n2', { organization_id: 'org_2' }],
      ['z1', {}],
      ['z2', {}],
    ];
    const answers: Array<{ id: string; old: 'ok' | number; now: 'ok' | number }> = [];
    for (const [id, extra] of rows) {
      answers.push({
        id,
        old: await outcome(() => coll(oldDriver).insertOne(grant(id, extra))),
        now: await outcome(() => coll(driver).insertOne(grant(id, extra))),
      });
    }
    expect(answers).toEqual([
      { id: 'n1', old: 'ok', now: 'ok' },
      { id: 'n2', old: 11000, now: 11000 },
      // Both keys exempt a grant missing its organization (NULL-distinct, #29278).
      { id: 'z1', old: 'ok', now: 'ok' },
      { id: 'z2', old: 'ok', now: 'ok' },
    ]);
  });
});
