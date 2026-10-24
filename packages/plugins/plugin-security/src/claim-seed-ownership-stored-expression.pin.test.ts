// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25668] The seed-ownership claim on an object whose STORED computed field
 * reads `owner_id` — measured on a REAL `ObjectQL` over a real `SqlDriver`.
 *
 * A stored field (a non-formula field declaring an `expression`) is computed by
 * the engine on every write. A predicate update stores ONE value per stored
 * field for every matched row, so the engine refuses one that moves the field
 * to different values on different rows ("update those rows by id"), and that
 * refusal is deliberate. The claim's patch moves only `owner_id`, so the
 * refusal reaches it exactly when a stored expression reads `owner_id` —
 * directly, or one hop through the lookup — and the rows compute different
 * values. HotCRM's `crm_forecast.display_title` is that shape; before this,
 * every seeded row of such an object stayed ownerless after the claim.
 *
 * What is pinned:
 *
 *  1. both shapes (direct, and one hop through the lookup): after the claim,
 *     every seeded and seed-identity row is owned by the admin, and each row's
 *     stored value is its own expression over its own row;
 *  2. the rows the claim must leave alone stay as they were: a guest's unowned
 *     row the seed never reported (ADR-0138 D1) and a row a human owns;
 *  3. an object whose stored expression does not read `owner_id` keeps the
 *     bulk path — one predicate write per unowned shape, not one per row;
 *  4. a row whose write is refused stays unowned and is reported with the
 *     claim's existing `claimSeedOwnership failed for …` warning, while the
 *     other rows of that object are claimed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { claimSeedOwnership } from './claim-seed-ownership.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYS = { context: { isSystem: true } } as const;
const ADMIN = 'usr_admin_human';
const ADMIN_NAME = 'Nina Reyes';
const SEED_IDENTITY = 'usr_system';
const SOMEONE = 'usr_someone';
const PERSON = 'probe_person';

/** The HotCRM `display_title` shape: the owner's name read one hop through the lookup. */
const HOP_SOURCE =
  'record.?owner_id.?name.orValue("") == "" ? record.name : record.name + " · " + record.?owner_id.?name.orValue("")';

interface Shape {
  what: string;
  object: string;
  source: string;
  /** The value the stored field must hold for a row named `name` once the admin owns it. */
  expected: (name: string) => string;
}

const SHAPES: Shape[] = [
  {
    what: 'direct — the expression reads `owner_id` itself',
    object: 'probe_forecast_direct',
    source: 'record.name + " · " + record.?owner_id.orValue("")',
    expected: (name) => `${name} · ${ADMIN}`,
  },
  {
    what: 'one hop — the expression reads the owner\'s name through the lookup',
    object: 'probe_forecast_hop',
    source: HOP_SOURCE,
    expected: (name) => `${name} · ${ADMIN_NAME}`,
  },
];

/** A stored expression that reads no owner: the claim's patch never moves it. */
const CONTROL_OBJECT = 'probe_forecast_plain';

const objectWith = (name: string, source: string): any => ({
  name,
  label: name,
  fields: {
    id: { type: 'text', label: 'Id', primary: true },
    name: { type: 'text', label: 'Name' },
    owner_id: { type: 'lookup', label: 'Owner', reference: PERSON },
    display_title: { type: 'text', label: 'Display title', expression: { dialect: 'cel', source } },
  },
});

const PERSON_OBJECT: any = {
  name: PERSON,
  label: 'Probe Person',
  fields: {
    id: { type: 'text', label: 'Id', primary: true },
    name: { type: 'text', label: 'Name' },
  },
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  const objects = [
    PERSON_OBJECT,
    ...SHAPES.map((s) => objectWith(s.object, s.source)),
    objectWith(CONTROL_OBJECT, 'record.name + " (seeded)"'),
  ];
  engine.registerApp({
    id: 'com.objectstack.claim-stored-expression-25668',
    name: 'Claim stored expression',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects,
  } as any);
  await engine.syncSchemas();
  // The rows below carry no organization: a store built before 18.x
  // (ADR-0131 D1 makes a fresh tenant column NOT NULL).
  await relaxTenantColumns(engine, objects.map((o) => o.name));
  engines.push(engine);

  const people = (engine as any).getDriverForObject(PERSON);
  await people.bulkCreate(PERSON, [
    { id: ADMIN, name: ADMIN_NAME },
    { id: SOMEONE, name: 'Omar Diaz' },
  ]);
  return engine;
}

/** The rows one object starts with, and which of them the seed reported. */
const SEEDED_NULL = ['f1', 'f2', 'f3', 'f4'];
const SEEDED_SYSTEM = ['s1', 's2'];
const nameOf = (id: string) => `Q4 2026 ${id}`;

async function seed(engine: ObjectQL, object: string): Promise<void> {
  // Straight through the driver, the way a seed's rows are already stored when
  // the claim runs; the stored column holds what an ownerless write computed.
  const driver = (engine as any).getDriverForObject(object);
  await driver.bulkCreate(object, [
    ...SEEDED_NULL.map((id) => ({ id, name: nameOf(id), owner_id: null, display_title: nameOf(id) })),
    ...SEEDED_SYSTEM.map((id) => ({ id, name: nameOf(id), owner_id: SEED_IDENTITY, display_title: nameOf(id) })),
    // Out of the claim's reach: a guest's row the seed never reported, and a row a human owns.
    { id: 'guest', name: nameOf('guest'), owner_id: null, display_title: nameOf('guest') },
    { id: 'owned', name: nameOf('owned'), owner_id: SOMEONE, display_title: nameOf('owned') },
  ]);
}

async function rowsOf(engine: ObjectQL, object: string): Promise<Map<string, { owner: unknown; title: unknown }>> {
  const rows = await (engine as any).find(object, { fields: ['id', 'owner_id', 'display_title'] }, SYS);
  return new Map(rows.map((r: any) => [r.id, { owner: r.owner_id ?? null, title: r.display_title ?? null }]));
}

function recordingLogger() {
  const warns: { message: string; meta?: Record<string, any> }[] = [];
  return {
    warns,
    logger: {
      info: () => {},
      warn: (message: string, meta?: Record<string, any>) => { warns.push({ message, meta }); },
    },
  };
}

/** Count the engine writes per object, without changing what they do. */
function countUpdates(engine: ObjectQL): Map<string, number> {
  const calls = new Map<string, number>();
  const original = engine.update.bind(engine);
  (engine as any).update = (object: string, data: any, options?: any) => {
    calls.set(object, (calls.get(object) ?? 0) + 1);
    return original(object, data, options);
  };
  return calls;
}

describe('[#25668] the seed ownership claim on an object whose stored expression reads owner_id (real engine)', () => {
  for (const shape of SHAPES) {
    it(`${shape.what}: every seeded row is owned and its stored value matches its own row`, async () => {
      const engine = await boot();
      await seed(engine, shape.object);
      const { warns, logger } = recordingLogger();

      const result = await claimSeedOwnership(engine, ADMIN, {
        logger,
        seededRecordIds: (object) => (object === shape.object ? [...SEEDED_NULL, 'owned'] : []),
      });

      expect(warns.filter((w) => w.message.includes('claimSeedOwnership failed')), 'the claim was refused').toEqual([]);
      expect(result).toEqual([{ object: shape.object, count: SEEDED_NULL.length + SEEDED_SYSTEM.length }]);

      const rows = await rowsOf(engine, shape.object);
      for (const id of [...SEEDED_NULL, ...SEEDED_SYSTEM]) {
        expect(rows.get(id), id).toEqual({ owner: ADMIN, title: shape.expected(nameOf(id)) });
      }
      // ADR-0138 D1: the guest's row keeps no owner; the human's row keeps its owner.
      expect(rows.get('guest')).toEqual({ owner: null, title: nameOf('guest') });
      expect(rows.get('owned')).toEqual({ owner: SOMEONE, title: nameOf('owned') });
    });
  }

  it('an object whose stored expression reads no owner keeps the bulk path: one write per unowned shape', async () => {
    const engine = await boot();
    await seed(engine, CONTROL_OBJECT);
    const calls = countUpdates(engine);

    const result = await claimSeedOwnership(engine, ADMIN, {
      seededRecordIds: (object) => (object === CONTROL_OBJECT ? SEEDED_NULL : []),
    });

    expect(result).toEqual([{ object: CONTROL_OBJECT, count: SEEDED_NULL.length + SEEDED_SYSTEM.length }]);
    // The NULL arm's one chunk, then the seed identity: two predicate writes.
    expect(calls.get(CONTROL_OBJECT)).toBe(2);
    const rows = await rowsOf(engine, CONTROL_OBJECT);
    for (const id of [...SEEDED_NULL, ...SEEDED_SYSTEM]) expect(rows.get(id)?.owner, id).toBe(ADMIN);
  });

  it('a row whose write is refused stays unowned and reported; the rest of the object is claimed', async () => {
    const engine = await boot();
    const shape = SHAPES[1]!;
    await seed(engine, shape.object);
    // A code-registered hook refusing one row: the shape of a capability gate.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      const ids = [ctx.input?.id, ctx.previous?.id, ctx.input?.options?.where?.id].filter(Boolean);
      if (ids.includes('f3')) throw new Error('probe refusal for f3');
    }, { object: shape.object, packageId: 'probe.refusing-hook' });
    const { warns, logger } = recordingLogger();

    const result = await claimSeedOwnership(engine, ADMIN, {
      logger,
      seededRecordIds: (object) => (object === shape.object ? SEEDED_NULL : []),
    });

    const failed = warns.filter((w) => w.message.includes(`claimSeedOwnership failed for ${shape.object}`));
    expect(failed, 'the refused row was not reported').toHaveLength(1);
    expect(failed[0]!.meta?.error).toContain('probe refusal for f3');
    expect(result).toEqual([{ object: shape.object, count: SEEDED_NULL.length - 1 + SEEDED_SYSTEM.length }]);

    const rows = await rowsOf(engine, shape.object);
    expect(rows.get('f3')).toEqual({ owner: null, title: nameOf('f3') });
    for (const id of ['f1', 'f2', 'f4', ...SEEDED_SYSTEM]) {
      expect(rows.get(id), id).toEqual({ owner: ADMIN, title: shape.expected(nameOf(id)) });
    }
  });
});
