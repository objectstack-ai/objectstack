// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20822 · ADR-0053 D-D1 items 5, 7 and 9, as amended] This driver keeps no
 * copy of the whole-day rule: it compiles the comparison it is handed.
 *
 * The rule — a bare `YYYY-MM-DD` upper bound means "through the whole of that
 * day", and on the last supported day it bounds nothing — is applied once, by
 * the shared lowering (`lowerFilterCondition`, `@objectstack/spec/data`), at the
 * seams. This face carried its own copy at four sites (the `$lte` and
 * `$between` arms of the FilterCondition translator, the `<=` and `between`
 * arms of the AST-node translator) until #20822 deleted them. Two consequences,
 * pinned here:
 *
 * - §A **Item 5 — a caller that passes no seam gets the comparison it wrote.**
 *   A direct `find()` with a bare-day `$lte` compares against midnight, as
 *   written; so does the AST-node spelling, which no seam emits. The one
 *   in-repo production caller that used to rely on the copy,
 *   `@objectstack/metadata`'s `DatabaseLoader.queryHistory` in driver mode, now
 *   lowers its own filter (its pin: `database-loader-20822-history-whole-day.test.ts`).
 *   One cell per deleted site, so restoring any one of them turns its cell red.
 * - §B **Item 7 — what a typed seam leaves alone reaches this driver as
 *   written.** The engine's `where` seam reads the object's declared field
 *   map and rewrites a declared `datetime` column only. So on a REGISTERED
 *   object a bare-day `$lte` on a declared `text` column holding ISO text, or
 *   on a column the object does not declare, is now compared as written — the
 *   answer `SqlDriver` already gives (measured through the engine on
 *   `driver-sqlite-wasm`: the declared text column answers no row of the named
 *   day). The deleted copy applied the rule type-blind and answered the whole
 *   day on both. A declared `datetime` keeps the whole day (the seam lowers it)
 *   and a declared `date` does not move (`< next-day` orders exactly as
 *   `<= day` on calendar-day text).
 *
 * An object with NO field map is lowered type-blind by the engine's seam (item
 * 7, `@objectstack/objectql`'s `engine-20822-no-field-map-type-blind-lowering.test.ts`),
 * so it keeps the whole day on every column; §C pins that reading here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { lowerFilterCondition, type FilterCondition } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';

const ids = (rows: ReadonlyArray<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();

/** The declared field map of the registered object §B stands for. */
const EVENT_FIELDS: Record<string, { type: string }> = {
  at: { type: 'datetime' },
  stamp_text: { type: 'text' },
  on: { type: 'date' },
};

/** The same instants in the declared datetime, the declared text and an undeclared column. */
const ROWS = [
  { id: 'r_yesterday', at: '2026-07-27T14:00:00.000Z', stamp_text: '2026-07-27T14:00:00.000Z', extra: '2026-07-27T14:00:00.000Z', on: '2026-07-27' },
  { id: 'r_midnight', at: '2026-07-28T00:00:00.000Z', stamp_text: '2026-07-28T00:00:00.000Z', extra: '2026-07-28T00:00:00.000Z', on: '2026-07-28' },
  { id: 'r_evening', at: '2026-07-28T21:40:00.000Z', stamp_text: '2026-07-28T21:40:00.000Z', extra: '2026-07-28T21:40:00.000Z', on: '2026-07-28' },
  { id: 'r_next', at: '2026-07-29T00:00:00.000Z', stamp_text: '2026-07-29T00:00:00.000Z', extra: '2026-07-29T00:00:00.000Z', on: '2026-07-29' },
  { id: 'r_last', at: '9999-12-31T10:00:00.000Z', stamp_text: '9999-12-31T10:00:00.000Z', extra: '9999-12-31T10:00:00.000Z', on: '9999-12-31' },
];

/** The whole of 2026-07-28 and everything before it. */
const WHOLE_DAY = ['r_evening', 'r_midnight', 'r_yesterday'];
/**
 * `<=` a bare day, as written, on the declared `datetime`: the comparand takes
 * the column's storage form, the midnight instant, so the midnight row is in
 * and the rest of the day is out.
 */
const THROUGH_MIDNIGHT = ['r_midnight', 'r_yesterday'];
/**
 * `<=` a bare day, as written, on text (a declared `text` column, or a column
 * with no declaration and so no storage form): every instant of the day sorts
 * after the bare day's text, midnight included.
 */
const BEFORE_THE_DAY = ['r_yesterday'];
/** `<=` the last supported day's midnight, as written: every row but the one later that day. */
const EVERY_ORDINARY_DAY = ['r_evening', 'r_midnight', 'r_next', 'r_yesterday'];

describe('[#20822] InMemoryDriver compiles the comparison it is handed (ADR-0053 D-D1 items 5 and 7)', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({});
    await driver.connect();
    await driver.syncSchema('event', { name: 'event', fields: EVENT_FIELDS });
    for (const row of ROWS) await driver.create('event', { ...row });
  });

  const find = async (where: FilterCondition) => ids(await driver.find('event', { where }));
  /**
   * The AST-node spelling (`{ type: 'comparison', field, operator, value }`) is
   * not a `FilterCondition` — no seam emits it — yet this driver still
   * translates it for a direct caller; the cast names that bypass.
   */
  const astNode = (operator: string, value: unknown) =>
    ({ type: 'comparison', field: 'at', operator, value }) as unknown as FilterCondition;

  describe('§A item 5: a direct call that passed no seam — one cell per deleted site', () => {
    it('FilterCondition `$lte` a bare day: `<=` midnight, as written', async () => {
      expect(await find({ at: { $lte: '2026-07-28' } })).toEqual(THROUGH_MIDNIGHT);
    });

    it('FilterCondition `$lte` the last supported day: `<=` its midnight, as written', async () => {
      expect(await find({ at: { $lte: '9999-12-31' } })).toEqual(EVERY_ORDINARY_DAY);
    });

    it('FilterCondition `$between` with a bare-day max: both ends inclusive, as written', async () => {
      expect(await find({ at: { $between: ['2026-07-27', '2026-07-28'] } })).toEqual(THROUGH_MIDNIGHT);
      expect(await find({ at: { $between: ['2026-07-27', '9999-12-31'] } })).toEqual(EVERY_ORDINARY_DAY);
    });

    it('AST node `<=` a bare day, and the last supported day: as written', async () => {
      expect(await find(astNode('<=', '2026-07-28'))).toEqual(THROUGH_MIDNIGHT);
      expect(await find(astNode('<=', '9999-12-31'))).toEqual(EVERY_ORDINARY_DAY);
    });

    it('AST node `between` with a bare-day max, and with the last supported day: as written', async () => {
      expect(await find(astNode('between', ['2026-07-27', '2026-07-28']))).toEqual(THROUGH_MIDNIGHT);
      expect(await find(astNode('between', ['2026-07-27', '9999-12-31']))).toEqual(EVERY_ORDINARY_DAY);
    });

    it('the same filters through the shared lowering keep the whole day — the rule is the seam\'s', async () => {
      const typed = (where: FilterCondition) =>
        lowerFilterCondition(where, { isDatetimeColumn: (column) => EVENT_FIELDS[column]?.type === 'datetime' });
      expect(await find(typed({ at: { $lte: '2026-07-28' } }))).toEqual(WHOLE_DAY);
      expect(await find(typed({ at: { $between: ['2026-07-27', '2026-07-28'] } }))).toEqual(WHOLE_DAY);
      expect(await find(typed({ at: { $lte: '9999-12-31' } }))).toEqual([...EVERY_ORDINARY_DAY, 'r_last'].sort());
    });
  });

  describe('§B item 7: a REGISTERED object — the typed seam rewrites the declared datetime only', () => {
    /** What the engine's `where` seam hands this driver for an object with {@link EVENT_FIELDS}. */
    const seamed = (where: FilterCondition) =>
      lowerFilterCondition(where, {
        isDatetimeColumn: (column) =>
          Object.prototype.hasOwnProperty.call(EVENT_FIELDS, column) && EVENT_FIELDS[column]!.type === 'datetime',
      });

    it('the declared `datetime` keeps the whole named day', async () => {
      expect(await find(seamed({ at: { $lte: '2026-07-28' } }))).toEqual(WHOLE_DAY);
    });

    it('a declared `text` column holding ISO text is compared as written (SqlDriver\'s answer; the copy answered the whole day)', async () => {
      expect(await find(seamed({ stamp_text: { $lte: '2026-07-28' } }))).toEqual(BEFORE_THE_DAY);
      expect(await find(seamed({ stamp_text: { $between: ['2026-07-27', '2026-07-28'] } }))).toEqual(BEFORE_THE_DAY);
    });

    it('a column the object does not declare is compared as written (the copy answered the whole day)', async () => {
      expect(await find(seamed({ extra: { $lte: '2026-07-28' } }))).toEqual(BEFORE_THE_DAY);
    });

    it('control — a declared `date` does not move: calendar-day text orders `<= day` exactly as `< next-day`', async () => {
      expect(await find(seamed({ on: { $lte: '2026-07-28' } }))).toEqual(['r_evening', 'r_midnight', 'r_yesterday']);
    });
  });

  describe('§C item 7: an object with NO field map — the seam lowers type-blind', () => {
    const typeBlind = (where: FilterCondition) => lowerFilterCondition(where);

    it('every column keeps the whole named day', async () => {
      expect(await find(typeBlind({ at: { $lte: '2026-07-28' } }))).toEqual(WHOLE_DAY);
      expect(await find(typeBlind({ stamp_text: { $lte: '2026-07-28' } }))).toEqual(WHOLE_DAY);
      expect(await find(typeBlind({ extra: { $between: ['2026-07-27', '2026-07-28'] } }))).toEqual(WHOLE_DAY);
    });
  });
});
