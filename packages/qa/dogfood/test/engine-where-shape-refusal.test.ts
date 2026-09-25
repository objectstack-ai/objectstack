// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20121 — the WRITE half, on a real SQL driver: a `multi: true` update or
 * delete whose `where` is not a filter is refused by the engine, and the table
 * is untouched.
 *
 * Measured on the base, `ObjectQL` over `SqlDriver` (better-sqlite3
 * `:memory:`), four rows seeded, a system context:
 *
 *   update('probe_order', { name: 'Z' }, { where: 'amount > 100', multi: true })  -> 4 of 4 rewritten
 *   delete('probe_order', { where: 42, multi: true })                             -> 4 of 4 deleted
 *   delete('probe_order', { where: new Map(...), multi: true })                   -> 4 of 4 deleted
 *
 * The engine dropped the value and the driver's `updateMany` / `deleteMany`
 * ran with no predicate. The unit pin in `packages/objectql`
 * (`engine-where-shape-refusal.test.ts`) proves no driver call is made; this
 * file proves the consequence that matters on the driver that ships: the rows,
 * read straight off the table past the engine, are exactly the seeded ones.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

const SYS = { context: { isSystem: true, userId: 'usr_system' } };

const PROBE_ORDER = {
  name: 'probe_order',
  label: 'Probe order',
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
    amount: { name: 'amount', type: 'number' },
  },
};

const SEEDED = ['o1:a:50', 'o2:b:150', 'o3:c:50', 'o4:d:150'];

/** The four shapes the card names. Each is type-illegal on purpose. */
const BAD_SHAPES: ReadonlyArray<readonly [string, () => unknown]> = [
  ['a string', () => 'amount > 100'],
  ['a number', () => 42],
  ['a Map', () => new Map([['amount', { $gt: 100 }]])],
  ['a non-filter array', () => [1, 2, 3]],
];

type Engine = {
  update(object: string, data: Record<string, unknown>, options: unknown): Promise<unknown>;
  delete(object: string, options: unknown): Promise<unknown>;
};

let engine: ObjectQL;
let driver: SqlDriver;

beforeEach(async () => {
  driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.dogfood.where-shape-20121',
    name: 'Where shape',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [PROBE_ORDER],
  } as never);
  await engine.syncSchemas();
  for (const [id, name, amount] of [['o1', 'a', 50], ['o2', 'b', 150], ['o3', 'c', 50], ['o4', 'd', 150]] as const) {
    await engine.insert('probe_order', { id, name, amount }, SYS as never);
  }
});

afterEach(async () => {
  await engine.destroy();
});

/** Ground truth, read off the table through knex — past every engine layer. */
async function stored(): Promise<string[]> {
  const knex = (driver as unknown as { knex: (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> } }).knex;
  const rows = await knex('probe_order').select('id', 'name', 'amount');
  return rows.map((r) => `${r.id}:${r.name}:${r.amount}`).sort();
}

async function refusalOf(run: () => Promise<unknown>): Promise<{ code?: unknown; status?: unknown }> {
  try {
    await run();
  } catch (e) {
    return e as { code?: unknown; status?: unknown };
  }
  throw new Error('expected the engine to refuse, and it answered');
}

describe('a multi-row write with a non-filter `where` leaves a SQL table untouched (#20121)', () => {
  for (const [label, shape] of BAD_SHAPES) {
    it(`update(multi): ${label} is INVALID_FILTER / 400 and rewrites nothing`, async () => {
      const err = await refusalOf(() =>
        (engine as unknown as Engine).update('probe_order', { name: 'Z' }, { where: shape(), multi: true, ...SYS }));

      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(await stored()).toEqual(SEEDED);
    });

    it(`delete(multi): ${label} is INVALID_FILTER / 400 and deletes nothing`, async () => {
      const err = await refusalOf(() =>
        (engine as unknown as Engine).delete('probe_order', { where: shape(), multi: true, ...SYS }));

      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(await stored()).toEqual(SEEDED);
    });
  }

  it('control: a filter object rewrites exactly the two matching rows', async () => {
    await (engine as unknown as Engine).update('probe_order', { name: 'Z' }, { where: { amount: { $gt: 100 } }, multi: true, ...SYS });
    expect(await stored()).toEqual(['o1:a:50', 'o2:Z:150', 'o3:c:50', 'o4:Z:150']);
  });

  it('control: a filter array deletes exactly the two matching rows', async () => {
    await (engine as unknown as Engine).delete('probe_order', { where: [['amount', '>', 100]], multi: true, ...SYS });
    expect(await stored()).toEqual(['o1:a:50', 'o3:c:50']);
  });
});
