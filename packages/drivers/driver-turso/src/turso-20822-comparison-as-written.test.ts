// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20822 · ADR-0053 D-D1 items 5 and 9, as amended] Both faces of
 * `TursoDriver` keep no copy of the filter meaning the shared lowering applies
 * at the seams: each compiles the comparison it is handed.
 *
 * The whole-day rule is applied once, by `lowerFilterCondition`
 * (`@objectstack/spec/data`) at the seams, so every seamed read hands this
 * driver `$lt` the next day and no `$between` on a declared `datetime`. The
 * copies are deleted: LOCAL mode inherited `SqlDriver`'s
 * (`calendarDayUpperBoundRewrite` / `calendarDayBetweenRewrite`), and REMOTE
 * mode's `toRemoteFilter` carried its own in its `$lte` and `$between` arms
 * (`toRemoteUpperBound`). `toRemoteFilter` still splits a `$between` into the
 * `$gte` / `$lte` pair the remote transport compiles — structurally, both ends
 * inclusive — and still converts each comparand to storage form.
 *
 * §A **Item 5 — a caller that passes no seam gets the comparison it wrote**, on
 * both faces, one cell per deleted branch of the remote face (the `$lte` arm,
 * the `$between` max, and the last supported day in each). The last `it` is
 * the control: the same filters through the lowering keep the whole day, and
 * the two faces agree on every cell either way.
 *
 * §B **The same for the NULL-polarity rewrite of `$not`** (#5146, #5903). The
 * lowering's rule 3 totalises every leaf of a `$not` operand at the seams, and
 * both faces' copies are deleted: LOCAL inherited `SqlDriver`'s
 * (`nullSafeNegationOperand`), and REMOTE's transport carried its own (the
 * third hand copy). A direct `$not` is compiled as written on both — SQL's
 * three-valued `NOT` — and the two faces still agree, which is what #5903's
 * parity asks. `$ne` / `$nin` / `$notContains` keep the NULL-safe form each
 * emitter spells for the operator itself (#5298), so a `$not` over `$ne` does
 * not move. The control: through the lowering, the NULL rows return.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { lowerFilterCondition, type FilterCondition } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const ids = (rows: ReadonlyArray<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();

const OBJECT = { name: 'task', fields: { title: { type: 'string' }, at: { type: 'datetime' } } };

/** What a TYPED seam hands this driver: the filter through the shared lowering. */
const seamed = (where: FilterCondition): FilterCondition =>
  lowerFilterCondition(where, {
    isDatetimeColumn: (column) => (OBJECT.fields as Record<string, { type: string }>)[column]?.type === 'datetime',
  });

const ROWS: ReadonlyArray<readonly [id: string, at: string]> = [
  ['r_prev', '2026-07-27T14:00:00.000Z'],
  ['r_midnight', '2026-07-28T00:00:00.000Z'],
  ['r_evening', '2026-07-28T21:40:00.000Z'],
  ['r_next', '2026-07-29T00:00:00.000Z'],
  ['r_last_open', '9999-12-31T00:00:00.000Z'],
  ['r_last_mid', '9999-12-31T10:00:00.000Z'],
];

/** `where` · the ids a direct call answers (as written) · the ids a seamed call answers. */
const CELLS: ReadonlyArray<readonly [name: string, where: FilterCondition, asWritten: string[], lowered: string[]]> = [
  [
    '$lte a bare day: `<=` its midnight',
    { at: { $lte: '2026-07-28' } },
    ['r_midnight', 'r_prev'],
    ['r_evening', 'r_midnight', 'r_prev'],
  ],
  [
    '$lte the last supported day: `<=` its midnight',
    { at: { $lte: '9999-12-31' } },
    ['r_evening', 'r_last_open', 'r_midnight', 'r_next', 'r_prev'],
    ['r_evening', 'r_last_mid', 'r_last_open', 'r_midnight', 'r_next', 'r_prev'],
  ],
  [
    '$between with a bare-day max: inclusive at both ends',
    { at: { $between: ['2026-07-28', '2026-07-28'] } },
    ['r_midnight'],
    ['r_evening', 'r_midnight'],
  ],
  [
    '$between whose max is the last supported day: inclusive at both ends',
    { at: { $between: ['2026-07-28', '9999-12-31'] } },
    ['r_evening', 'r_last_open', 'r_midnight', 'r_next'],
    ['r_evening', 'r_last_mid', 'r_last_open', 'r_midnight', 'r_next'],
  ],
];

describe('[#20822] TursoDriver compiles the whole-day comparison it is handed, on both faces (ADR-0053 D-D1 item 5)', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([OBJECT]);

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://comparison-as-written.turso.io', client: stub as never });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    // `syncSchema` registers the field types remote mode converts comparands by.
    await remote.syncSchema(OBJECT.name, OBJECT);

    for (const driver of [local, remote]) {
      for (const [id, at] of ROWS) await driver.create(OBJECT.name, { id, title: id, at });
    }
  });

  afterAll(async () => {
    await local?.disconnect?.();
    await remote?.disconnect?.();
    stub?.close();
  });

  describe('§A item 5: a direct call that passed no seam — one cell per deleted branch', () => {
    for (const [name, where, asWritten] of CELLS) {
      it(`remote — ${name}`, async () => {
        expect(ids(await remote.find(OBJECT.name, { where } as never))).toEqual(asWritten);
      });
      it(`local — ${name}`, async () => {
        expect(ids(await local.find(OBJECT.name, { where } as never))).toEqual(asWritten);
      });
    }
  });

  it('control — the same filters through the shared lowering keep the whole day, on both faces', async () => {
    for (const [name, where, , lowered] of CELLS) {
      expect(ids(await remote.find(OBJECT.name, { where: seamed(where) } as never)), `remote ${name}`).toEqual(lowered);
      expect(ids(await local.find(OBJECT.name, { where: seamed(where) } as never)), `local ${name}`).toEqual(lowered);
    }
  });
});

const DEAL = { name: 'deal', fields: { stage: { type: 'string' }, amount: { type: 'number' } } };

/** Rows 3 and 4 have no `stage`; row 3 has no `amount` either. */
const POLARITY_ROWS = [
  { id: '1', stage: 'won', amount: 10 },
  { id: '2', stage: 'lost', amount: 20 },
  { id: '3', stage: null, amount: null },
  { id: '4', stage: null, amount: 40 },
];

/** `where` · the ids a direct call answers (as written) · the ids a seamed call answers. */
const POLARITY_CELLS: ReadonlyArray<readonly [name: string, where: FilterCondition, asWritten: string[], lowered: string[]]> = [
  ['$not over an implicit equality: three-valued', { $not: { stage: 'won' } }, ['2'], ['2', '3', '4']],
  ['$not over an ordering comparison: three-valued', { $not: { amount: { $gt: 15 } } }, ['1'], ['1', '3']],
  ['$not over $in: three-valued', { $not: { stage: { $in: ['won'] } } }, ['2'], ['2', '3', '4']],
  ['$not over a $or: three-valued', { $not: { $or: [{ stage: 'won' }, { amount: 40 }] } }, ['2'], ['2', '3']],
  ['$not over $ne: unchanged, each emitter spells $ne NULL-safe itself', { $not: { stage: { $ne: 'won' } } }, ['1'], ['1']],
];

describe('[#20822] §B TursoDriver compiles the $not it is handed, on both faces (ADR-0053 D-D1 item 5; #5146, #5903)', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    await local.initObjects([DEAL]);
    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://not-as-written.turso.io', client: stub as never });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(DEAL.name, DEAL);
    for (const driver of [local, remote]) {
      for (const row of POLARITY_ROWS) await driver.create(DEAL.name, row);
    }
  });

  afterAll(async () => {
    await local?.disconnect?.();
    await remote?.disconnect?.();
    stub?.close();
  });

  for (const [name, where, asWritten] of POLARITY_CELLS) {
    it(`a direct call, both faces alike — ${name}`, async () => {
      expect(ids(await remote.find(DEAL.name, { where } as never)), 'remote').toEqual(asWritten);
      expect(ids(await local.find(DEAL.name, { where } as never)), 'local').toEqual(asWritten);
    });
  }

  it('control — the same filters through the shared lowering return the NULL rows (#5146), on both faces', async () => {
    for (const [name, where, , lowered] of POLARITY_CELLS) {
      const seamedWhere = lowerFilterCondition(where, { isDatetimeColumn: () => false });
      expect(ids(await remote.find(DEAL.name, { where: seamedWhere } as never)), `remote ${name}`).toEqual(lowered);
      expect(ids(await local.find(DEAL.name, { where: seamedWhere } as never)), `local ${name}`).toEqual(lowered);
    }
  });
});
