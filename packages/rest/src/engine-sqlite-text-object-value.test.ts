// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29645] A `Date`, a `Map`, a `Set`, a class instance or a typed array
 * written to a text-family field, through the engine's write doors (the ones
 * flows, hooks and server code use; a JSON body carries none of these), on a
 * real engine (`ObjectQL` + sqlite `SqlDriver`). The PHYSICAL column is read
 * with the driver's own query builder, past every engine read coercion.
 *
 * Base (`origin/main` @ `7dae3b3c`) stored a `Date` as its epoch number in
 * TEXT (`"1767312000000.0"`), a `Map` or a `Set` as `"{}"`, a class instance
 * and a typed array as their JSON text, on insert, update by id and update by
 * predicate alike. Each is now refused `VALIDATION_FAILED` with the field's
 * `invalid_type`, and the row is not written.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

class Widget {
  k = 1;
}

const NON_PLAIN: ReadonlyArray<readonly [string, () => unknown]> = [
  ['a Date', () => new Date('2026-01-02T00:00:00Z')],
  ['a Map', () => new Map([['a', 1]])],
  ['a Set', () => new Set(['a'])],
  ['a class instance', () => new Widget()],
  ['a typed array', () => new Uint8Array([1, 2])],
];

const OBJ = {
  name: 'text_object_sql', label: 'Text object', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    body: { name: 'body', type: 'markdown' as const },
  },
};

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(OBJ as any);
  await engine.syncSchemas();
  const stored = async (id: string) =>
    (await (driver as any).knex('text_object_sql').where({ id }).first()) as Record<string, unknown> | undefined;
  const refusal = (run: () => Promise<unknown>) =>
    run().then(() => null, (e: any) => ({ code: e?.code, fields: (e?.fields ?? []).map((f: any) => [f.field, f.code]) }));
  return { engine, stored, refusal };
}

describe('engine write doors on SQLite: any object on a text-family field is refused, nothing stored (#29645)', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => {
    ctx = await boot();
    await ctx.engine.insert('text_object_sql', { id: 'u1', title: 'orig', body: 'orig' });
  });

  for (const [shape, make] of NON_PLAIN) {
    it(`${shape}: insert, update by id and update by predicate`, async () => {
      expect(await ctx.refusal(() => ctx.engine.insert('text_object_sql', { id: 'n1', title: make() } as any)))
        .toEqual({ code: 'VALIDATION_FAILED', fields: [['title', 'invalid_type']] });
      expect(await ctx.stored('n1')).toBeUndefined();

      expect(await ctx.refusal(() => ctx.engine.update('text_object_sql', { body: make() } as any, { where: { id: 'u1' } } as any)))
        .toEqual({ code: 'VALIDATION_FAILED', fields: [['body', 'invalid_type']] });
      expect(await ctx.refusal(() => ctx.engine.update('text_object_sql', { title: make() } as any, { where: { id: 'u1' }, multi: true } as any)))
        .toEqual({ code: 'VALIDATION_FAILED', fields: [['title', 'invalid_type']] });
      expect(await ctx.stored('u1')).toEqual(expect.objectContaining({ title: 'orig', body: 'orig' }));
    });
  }

  it('control: a plain string is stored as sent, and a number keeps its string reading (#29241)', async () => {
    await ctx.engine.insert('text_object_sql', { id: 's1', title: 'plain', body: 42 } as any);
    expect(await ctx.stored('s1')).toEqual(expect.objectContaining({ title: 'plain', body: '42' }));
  });
});
