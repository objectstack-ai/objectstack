// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20446] The flip, on this driver's live query path: a STORED view rule's
 * 「is empty」 / 「is not empty」 reaches the driver as `$empty` (the spec's
 * `parseFilterAST` — the one lowering every door runs — emits it since #20446;
 * it emitted `$null` before) and is answered by the field's DECLARED row.
 *
 * The rules are lowered here by `parseFilterAST`, exactly as the engine's
 * array door and the protocol's `?filter=` door lower them, and handed to
 * `find` — so what is pinned is the stored rule, not the operator.
 *
 * - Ruling A on #20399 (record 5865693155): a stored rule's 「is empty」 on a
 *   multi-value field returns the rows holding `[]` or null, and refuses
 *   nothing.
 * - Ruling B on #20311 (record 5861435168): a text field holding `''` is
 *   empty; `is_not_empty` is the exact complement.
 * - N2, the narrowing the changeset declares: where this driver holds no
 *   declaration for the column, the rule is REFUSED, loudly, with the `$null`
 *   prescription — where the old `$null` lowering answered. Two compositions
 *   reach it here: the built-in `id` (no object declares it), and a federated
 *   (ADR-0015) object, which the engine never hands this driver's `syncSchema`
 *   because it has no `registerExternalObject` (objectql `plugin.ts`'s boot
 *   loop; the boot reports such an object as NOT bound).
 * - The QueryAST-node spelling (`{ type: 'comparison', operator: 'is_empty' }`)
 *   answers through the same arm as the lowered rule, not the old `$null`.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { parseFilterAST, type FilterCondition } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';

const TABLE = 'os20446_task';
/** A federated object: never synced here, the way the engine's boot skips it on this driver. */
const FEDERATED = 'os20446_ext_task';

/** What the engine's registry hands `syncSchema` — `id` is NOT a declared field there. */
const FIELDS = {
  title: { type: 'text' },
  tags: { type: 'tags' },
  amount: { type: 'number' },
};

const ROWS: Array<Record<string, unknown>> = [
  { id: 'r1', title: null, tags: null, amount: null },
  { id: 'r2', title: '', tags: [], amount: 1 },
  { id: 'r3', title: 'a', tags: ['x'], amount: 2 },
];
const ALL = ['r1', 'r2', 'r3'];

type Refusal = { code?: string; status?: number; message: string };

async function refusalOf(run: () => Promise<unknown>): Promise<Refusal | 'answered'> {
  try {
    await run();
    return 'answered';
  } catch (err) {
    const e = err as { code?: string; status?: number; message?: string };
    return { code: e.code, status: e.status, message: String(e.message) };
  }
}

describe('[#20446] InMemoryDriver — a stored 「is empty」 rule, lowered to $empty, on the live path', () => {
  let driver: InMemoryDriver;
  const rows = async (object: string, where: unknown) =>
    ((await driver.find(object, { where } as never)) as Array<Record<string, unknown>>).map((r) => String(r.id)).sort();
  /** A stored rule, lowered the way every door lowers it. */
  const rule = (field: string, op: string) => parseFilterAST([field, op, true]) as FilterCondition;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema(TABLE, { fields: FIELDS });
    for (const row of ROWS) await driver.create(TABLE, { ...row });
    for (const row of ROWS) await driver.create(FEDERATED, { ...row });
  });

  it('the lowering this file drives is the flipped one', () => {
    expect(rule('tags', 'is_empty')).toEqual({ tags: { $empty: true } });
    expect(rule('tags', 'is_not_empty')).toEqual({ tags: { $empty: false } });
  });

  it('ruling A: a stored 「is empty」 on a multi-value field returns the [] and null rows, and refuses nothing', async () => {
    for (const op of ['is_empty', 'isempty']) {
      expect(await rows(TABLE, rule('tags', op)), op).toEqual(['r1', 'r2']);
    }
  });

  it('ruling B: a stored 「is empty」 on a text field finds \'\' as well as null', async () => {
    expect(await rows(TABLE, rule('title', 'is_empty'))).toEqual(['r1', 'r2']);
    // A scalar field keeps the null-only row.
    expect(await rows(TABLE, rule('amount', 'is_empty'))).toEqual(['r1']);
  });

  it('is_not_empty is the exact complement of is_empty on every declared field', async () => {
    for (const field of Object.keys(FIELDS)) {
      const empty = await rows(TABLE, rule(field, 'is_empty'));
      const full = await rows(TABLE, rule(field, 'is_not_empty'));
      expect(empty.filter((id) => full.includes(id)), `${field}: overlap`).toEqual([]);
      expect([...empty, ...full].sort(), `${field}: union`).toEqual(ALL);
    }
    expect(await rows(TABLE, rule('tags', 'is_not_empty'))).toEqual(['r3']);
    expect(await rows(TABLE, rule('title', 'is_not_empty'))).toEqual(['r3']);
  });

  it('N2: a stored rule on the built-in `id` is REFUSED with the $null prescription, both directions', async () => {
    for (const op of ['is_empty', 'is_not_empty']) {
      const got = await refusalOf(() => rows(TABLE, rule('id', op)));
      expect(got, op).not.toBe('answered');
      const r = got as Refusal;
      expect({ code: r.code, status: r.status }, op).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(r.message, op).toContain('Operator "$empty" on field "id"');
      expect(r.message, op).toContain('use "$null" for "has no value"');
    }
  });

  it('N2: a federated object this driver was never handed is REFUSED on its author-declared columns', async () => {
    // The composition: the engine binds a federated object through
    // `registerExternalObject`, and skips it on a driver without one.
    expect((driver as unknown as { registerExternalObject?: unknown }).registerExternalObject).toBeUndefined();
    for (const field of Object.keys(FIELDS)) {
      const got = await refusalOf(() => rows(FEDERATED, rule(field, 'is_empty')));
      expect(got, field).not.toBe('answered');
      const r = got as Refusal;
      expect({ code: r.code, status: r.status }, field).toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(r.message, field).toContain('the object\'s schema was never synced');
      expect(r.message, field).toContain('use "$null" for "has no value"');
    }
  });

  it('the QueryAST-node spelling answers through the same arm as the lowered rule', async () => {
    const node = (field: string, operator: string) => ({ type: 'comparison', field, operator, value: true });
    for (const [field, op, lowered] of [
      ['tags', 'is_empty', 'is_empty'],
      ['tags', 'isempty', 'is_empty'],
      ['title', 'is_empty', 'is_empty'],
      ['tags', 'is_not_empty', 'is_not_empty'],
      ['title', 'isnotempty', 'is_not_empty'],
    ] as const) {
      expect(await rows(TABLE, node(field, op)), `${field} ${op}`).toEqual(await rows(TABLE, rule(field, lowered)));
    }
    expect(await rows(TABLE, node('tags', 'is_empty'))).toEqual(['r1', 'r2']);
    const refused = await refusalOf(() => rows(TABLE, node('id', 'is_empty')));
    expect(refused).not.toBe('answered');
    expect((refused as Refusal).code).toBe('INVALID_FILTER');
  });
});
