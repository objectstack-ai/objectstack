// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20822 · ADR-0053 D-D1 items 5 and 9, as amended] `SqlDriver` keeps no copy
 * of the filter meaning the shared lowering applies at the seams: it compiles
 * the comparison it is handed.
 *
 * The rules — a bare `YYYY-MM-DD` upper bound means "through the whole of that
 * day" and on the last supported day it bounds nothing — are applied once, by
 * `lowerFilterCondition` (`@objectstack/spec/data`) at the seams (the engine's
 * `where` positions, `aggregations[i].filter`, the RLS compile seam). Every
 * seamed read therefore hands this driver `$lt` the next day, never a bare-day
 * `$lte`, and no `$between` on a declared `datetime` (item 9: the copy was
 * idempotent on that input, so deleting it moves no seamed answer). This
 * driver's own copy — `calendarDayUpperBoundRewrite` /
 * `calendarDayBetweenRewrite`, compiled on the plain and the legacy-normalised
 * column paths — is deleted.
 *
 * §A **Item 5 — a caller that passes no seam gets the comparison it wrote.** A
 * direct `find()` with a bare-day `$lte` compares against midnight, and a
 * `$between` is inclusive at both ends, as written. One cell per deleted
 * branch: each spelling on canonical storage and on the un-backfilled legacy
 * column (the normalised-expression path), and the last supported day. The
 * last `it` is the control: the same filters through the lowering keep the
 * whole day, on both storages.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { lowerFilterCondition, type FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './index.js';
import { LegacyStorageDriver } from './legacy-datetime-storage.testkit.js';

const ids = (rows: ReadonlyArray<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();

const FIELDS: Record<string, { type: string }> = { title: { type: 'string' }, at: { type: 'datetime' } };

/** What a TYPED seam hands this driver: the filter through the shared lowering. */
const seamed = (where: FilterCondition): FilterCondition =>
  lowerFilterCondition(where, { isDatetimeColumn: (column) => FIELDS[column]?.type === 'datetime' });

/** The instants, in canonical ISO. The legacy block stores each in a pre-#3912 form. */
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
    "$lte a bare day: `<=` its midnight",
    { at: { $lte: '2026-07-28' } },
    ['r_midnight', 'r_prev'],
    ['r_evening', 'r_midnight', 'r_prev'],
  ],
  [
    "$lte the last supported day: `<=` its midnight",
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

describe('[#20822] SqlDriver compiles the whole-day comparison it is handed (ADR-0053 D-D1 item 5)', () => {
  let canonical: SqlDriver;
  let legacy: LegacyStorageDriver;

  beforeAll(async () => {
    const options = { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as const;
    canonical = new SqlDriver(options);
    await canonical.initObjects([{ name: 'task', fields: FIELDS }]);
    for (const [id, at] of ROWS) await canonical.create('task', { id, title: id, at }, { bypassTenantAudit: true });

    legacy = new LegacyStorageDriver(options);
    await legacy.initObjects([{ name: 'task', fields: FIELDS }]);
    // Both pre-#3912 storage forms, alternating: an INTEGER epoch and zone-naive
    // TEXT — so every cell runs through the normalised column expression.
    await legacy.seedLegacyRows(
      'task',
      'at',
      ROWS.map(([id, at], i) => ({ id, title: id, at: i % 2 === 0 ? Date.parse(at) : at.replace('T', ' ').replace('Z', '') })),
    );
  });

  afterAll(async () => {
    await canonical?.disconnect?.();
    await legacy?.disconnect?.();
  });

  describe('§A item 5: a direct call that passed no seam — one cell per deleted branch', () => {
    for (const [name, where, asWritten] of CELLS) {
      it(`canonical storage — ${name}`, async () => {
        expect(ids(await canonical.find('task', { where } as never))).toEqual(asWritten);
      });
      it(`legacy storage, the normalised column path — ${name}`, async () => {
        expect(ids(await legacy.find('task', { where } as never))).toEqual(asWritten);
      });
    }
  });

  it('control — the same filters through the shared lowering keep the whole day, on both storages', async () => {
    for (const [name, where, , lowered] of CELLS) {
      expect(ids(await canonical.find('task', { where: seamed(where) } as never)), `canonical ${name}`).toEqual(lowered);
      expect(ids(await legacy.find('task', { where: seamed(where) } as never)), `legacy ${name}`).toEqual(lowered);
    }
  });
});
