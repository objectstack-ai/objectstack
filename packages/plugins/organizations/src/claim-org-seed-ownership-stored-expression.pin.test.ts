// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25668] The organization seed-ownership claim on an object whose STORED
 * computed field reads `owner_id` — measured on a REAL `ObjectQL` over a real
 * `SqliteWasmDriver` (the driver `objectstack dev` uses). The multi-tenant twin
 * of plugin-security's `claim-seed-ownership-stored-expression.pin.test.ts`.
 *
 * A predicate update stores ONE value per stored field for every matched row,
 * and the engine refuses one that moves the field to different values on
 * different rows, by contract ("update those rows by id"). The claim's patch
 * moves only `owner_id`, so the refusal reaches it exactly when a stored
 * expression reads `owner_id` — directly, or one hop through the lookup — and
 * the rows compute different values; before this, every seeded row of such an
 * object stayed owner-less.
 *
 * What is pinned:
 *
 *  1. both shapes (direct, and one hop through the lookup): after the claim,
 *     every seeded owner-less row of the organization is owned by its owner,
 *     and each row's stored value is its own expression over its own row;
 *  2. the rows the claim must leave alone stay as they were: another
 *     organization's row, a row a member owns, and a guest's row the seed
 *     replay never reported (ADR-0138 D1);
 *  3. an object whose stored expression does not read `owner_id` keeps the
 *     chunked predicate write — one write per chunk, not one per row;
 *  4. a row whose write is refused stays owner-less and is reported, while the
 *     other rows of that object are claimed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { claimOrgSeedOwnership } from './claim-org-seed-ownership.js';

const SYS = { context: { isSystem: true } } as const;
const ORG = 'org_alpha';
const OTHER_ORG = 'org_north';
const OWNER = 'usr_org_owner';
const OWNER_NAME = 'Nina Reyes';
const SOMEONE = 'usr_someone';
const PERSON = 'probe_person';

/** The HotCRM `display_title` shape: the owner's name read one hop through the lookup. */
const HOP_SOURCE =
  'record.?owner_id.?name.orValue("") == "" ? record.name : record.name + " · " + record.?owner_id.?name.orValue("")';

interface Shape {
  what: string;
  object: string;
  source: string;
  /** The value the stored field must hold for a row named `name` once the owner owns it. */
  expected: (name: string) => string;
}

const SHAPES: Shape[] = [
  {
    what: 'direct — the expression reads `owner_id` itself',
    object: 'probe_forecast_direct',
    source: 'record.name + " · " + record.?owner_id.orValue("")',
    expected: (name) => `${name} · ${OWNER}`,
  },
  {
    what: 'one hop — the expression reads the owner\'s name through the lookup',
    object: 'probe_forecast_hop',
    source: HOP_SOURCE,
    expected: (name) => `${name} · ${OWNER_NAME}`,
  },
];

/** A stored expression that reads no owner: the claim's patch never moves it. */
const CONTROL_OBJECT = 'probe_forecast_plain';

const objectWith = (name: string, source: string): any => ({
  name,
  label: name,
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
    owner_id: { name: 'owner_id', type: 'lookup', reference: PERSON },
    organization_id: { name: 'organization_id', type: 'text' },
    display_title: { name: 'display_title', type: 'text', expression: { dialect: 'cel', source } },
  },
});

const PERSON_OBJECT: any = {
  name: PERSON,
  label: 'Probe Person',
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
    organization_id: { name: 'organization_id', type: 'text' },
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
  engine.registerDriver(new SqliteWasmDriver({ filename: ':memory:' } as never) as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.org-claim-stored-expression-25668',
    name: 'Organization claim stored expression',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      PERSON_OBJECT,
      ...SHAPES.map((s) => objectWith(s.object, s.source)),
      objectWith(CONTROL_OBJECT, 'record.name + " (seeded)"'),
    ],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const people = (engine as any).getDriverForObject(PERSON);
  await people.bulkCreate(PERSON, [
    { id: OWNER, name: OWNER_NAME, organization_id: ORG },
    { id: SOMEONE, name: 'Omar Diaz', organization_id: ORG },
  ]);
  return engine;
}

const SEEDED = ['f1', 'f2', 'f3', 'f4'];
const nameOf = (id: string) => `Q4 2026 ${id}`;

async function seed(engine: ObjectQL, object: string): Promise<void> {
  // Straight through the driver, the way the replay's rows are already stored
  // when the claim runs; the stored column holds what an owner-less write computed.
  const driver = (engine as any).getDriverForObject(object);
  const row = (id: string, organization_id: string, owner_id: string | null) =>
    ({ id, name: nameOf(id), organization_id, owner_id, display_title: nameOf(id) });
  await driver.bulkCreate(object, [
    ...SEEDED.map((id) => row(id, ORG, null)),
    row('foreign', OTHER_ORG, null),
    row('owned', ORG, SOMEONE),
    row('guest', ORG, null),
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

/** The replay reported every seeded row, plus rows the claim's predicate must still refuse. */
const seededOf = (object: string) => (name: string): readonly string[] =>
  (name === object ? [...SEEDED, 'foreign', 'owned'] : []);

describe('[#25668] the organization seed-ownership claim on an object whose stored expression reads owner_id (real engine)', () => {
  for (const shape of SHAPES) {
    it(`${shape.what}: every seeded row is owned and its stored value matches its own row`, async () => {
      const engine = await boot();
      await seed(engine, shape.object);
      const { warns, logger } = recordingLogger();

      const result = await claimOrgSeedOwnership(engine as never, ORG, OWNER, {
        logger,
        seededRecordIds: seededOf(shape.object),
      });

      expect(warns.filter((w) => w.message.includes('claimOrgSeedOwnership failed')), 'the claim was refused').toEqual([]);
      expect(result).toEqual([{ object: shape.object, count: SEEDED.length }]);

      const rows = await rowsOf(engine, shape.object);
      for (const id of SEEDED) {
        expect(rows.get(id), id).toEqual({ owner: OWNER, title: shape.expected(nameOf(id)) });
      }
      expect(rows.get('foreign')).toEqual({ owner: null, title: nameOf('foreign') });
      expect(rows.get('owned')).toEqual({ owner: SOMEONE, title: nameOf('owned') });
      expect(rows.get('guest')).toEqual({ owner: null, title: nameOf('guest') });
    });
  }

  it('an object whose stored expression reads no owner keeps the chunked predicate write', async () => {
    const engine = await boot();
    await seed(engine, CONTROL_OBJECT);
    const calls = countUpdates(engine);

    const result = await claimOrgSeedOwnership(engine as never, ORG, OWNER, {
      seededRecordIds: seededOf(CONTROL_OBJECT),
    });

    expect(result).toEqual([{ object: CONTROL_OBJECT, count: SEEDED.length }]);
    // Six seeded ids are one chunk: one predicate write.
    expect(calls.get(CONTROL_OBJECT)).toBe(1);
    const rows = await rowsOf(engine, CONTROL_OBJECT);
    for (const id of SEEDED) expect(rows.get(id)?.owner, id).toBe(OWNER);
  });

  it('a row whose write is refused stays owner-less and reported; the rest of the object is claimed', async () => {
    const engine = await boot();
    const shape = SHAPES[1]!;
    await seed(engine, shape.object);
    // A code-registered hook refusing one row: the shape of a capability gate.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      const ids = [ctx.input?.id, ctx.previous?.id, ctx.input?.options?.where?.id].filter(Boolean);
      if (ids.includes('f3')) throw new Error('probe refusal for f3');
    }, { object: shape.object, packageId: 'probe.refusing-hook' });
    const { warns, logger } = recordingLogger();

    const result = await claimOrgSeedOwnership(engine as never, ORG, OWNER, {
      logger,
      seededRecordIds: seededOf(shape.object),
    });

    const failed = warns.filter((w) => w.message.includes(`claimOrgSeedOwnership failed for ${shape.object}`));
    expect(failed, 'the refused row was not reported').toHaveLength(1);
    expect(failed[0]!.meta?.error).toContain('probe refusal for f3');
    expect(result).toEqual([{ object: shape.object, count: SEEDED.length - 1 }]);

    const rows = await rowsOf(engine, shape.object);
    expect(rows.get('f3')).toEqual({ owner: null, title: nameOf('f3') });
    for (const id of ['f1', 'f2', 'f4']) {
      expect(rows.get(id), id).toEqual({ owner: OWNER, title: shape.expected(nameOf(id)) });
    }
  });
});
