// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6468 — `scanMaxNumericTail` must locate the counter by the format's DECLARED
 * `suffix` instead of concatenating every digit it finds after the prefix.
 *
 * `renderAutonumber` composes `prefix + zero-padded(seq) + suffix`, and `suffix`
 * is a declared return value: tokens after the `{0..0}` slot render BEHIND the
 * counter, so `{000}-{YYYY}` produces `001-2026` — a value that does not end in
 * its counter. Stripping the non-digits and parsing what is left turned `001-2026`
 * into `12026`, so a table holding counters 1..3 bootstrapped its sequence at
 * 12026 and the next record number jumped to `12027-2026`. Numbers burned that
 * way are not reclaimable.
 *
 * The engine's fallback `seedAutonumber` read the same rows as `2026` — a
 * DIFFERENT wrong answer, so the same metadata over the same rows produced a
 * different band depending on which driver ran. The two sides now apply one rule
 * to one pair of strings (`renderAutonumber`'s own `prefix`/`suffix`, computed by
 * the caller and passed down); the convergence itself is pinned in
 * `packages/runtime/src/autonumber-seed-cross-side-parity.integration.test.ts`.
 *
 * Formats with no suffix — `D-{0000}`, `{0000}` — were already correct here and
 * are pinned below against drift, as is the unanchored legacy reading.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqlDriver } from '../src/index.js';

/** Date tokens render from the wall clock, so the clock is pinned. Only `Date`. */
const FIXED_NOW = new Date('2026-06-15T09:00:00Z');

describe('SqlDriver autonumber seeding — the counter is located by the declared suffix (#6468)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
  });

  afterEach(async () => {
    await driver.disconnect();
    vi.useRealTimers();
  });

  /** Register one object whose single autonumber field carries `format`. */
  async function initRec(format?: string) {
    await driver.initObjects([
      {
        name: 'rec',
        fields: {
          title: { type: 'string' },
          rec_no: format === undefined ? { type: 'autonumber' } : { type: 'autonumber', format },
        },
      },
    ] as any);
  }

  /** Land pre-existing record numbers directly, bypassing the sequence. */
  async function seedRows(values: string[]) {
    const k = (driver as any).knex;
    await k('rec').insert(values.map((v, i) => ({ id: `l${i + 1}`, rec_no: v, title: `legacy ${i + 1}` })));
  }

  // ------------------------------------- (1) suffix, no prefix — the defect --

  describe('`{000}-{YYYY}` — the counter leads, the year trails', () => {
    it('bootstraps from the counter (3), not from the digits concatenated (12026)', async () => {
      await initRec('{000}-{YYYY}');
      await seedRows(['001-2026', '002-2026', '003-2026']);

      const r = await driver.create('rec', { title: 'next' });

      expect(r.rec_no).toBe('004-2026');
      // The precise regression: `parseInt('0012026')` seeded 12026.
      expect(r.rec_no).not.toBe('12027-2026');
    });

    it('scans the max as the counter value itself', async () => {
      await initRec('{000}-{YYYY}');
      await seedRows(['001-2026', '002-2026', '003-2026']);

      // Straight at the seeding scan: prefix '', suffix '-2026'.
      const max = await (driver as any).scanMaxNumericTail(
        (driver as any).knex,
        'rec',
        'rec_no',
        '',
        null,
        null,
        '-2026',
      );

      expect(max).toBe(3);
    });

    it('counts rows whose suffix rendered differently — one counter spans the years', async () => {
      // The counter scope is the rendered PREFIX, '' here, so `{000}-{YYYY}` keeps
      // ONE counter and only the displayed year moves. Last year's `007-2025`
      // holds counter 7 and must be counted; a `like '%-2026'` predicate would
      // drop it and re-issue 004..007 over rows that already exist.
      await initRec('{000}-{YYYY}');
      await seedRows(['005-2025', '006-2025', '007-2025', '003-2026']);

      const r = await driver.create('rec', { title: 'next' });

      expect(r.rec_no).toBe('008-2026');
    });
  });

  // --------------------------------------- (2) suffix AND prefix — same rule --

  describe('`CASE-{000}-{YYYY}` — text on both sides of the slot', () => {
    it('reads the counter between the prefix and the suffix', async () => {
      await initRec('CASE-{000}-{YYYY}');
      await seedRows(['CASE-001-2026', 'CASE-002-2026', 'CASE-003-2026']);

      const r = await driver.create('rec', { title: 'next' });

      expect(r.rec_no).toBe('CASE-004-2026');
    });

    it('ignores rows outside the prefix scope', async () => {
      await initRec('CASE-{000}-{YYYY}');
      await seedRows(['CASE-001-2026', 'CASE-002-2026', 'OTHER-900-2026']);

      const r = await driver.create('rec', { title: 'next' });

      expect(r.rec_no).toBe('CASE-003-2026');
    });
  });

  // ------------------------------------------------ (3) controls — unchanged --

  describe('formats with no suffix keep their existing behaviour', () => {
    it('`D-{0000}` bootstraps from the digit run after the prefix', async () => {
      await initRec('D-{0000}');
      await seedRows(['D-0001', 'D-0002', 'D-0003']);

      const r = await driver.create('rec', { title: 'next' });

      expect(r.rec_no).toBe('D-0004');
    });

    it('`{0000}` bootstraps from the bare padded counter', async () => {
      await initRec('{0000}');
      await seedRows(['0001', '0002', '0003']);

      const r = await driver.create('rec', { title: 'next' });

      expect(r.rec_no).toBe('0004');
    });
  });

  // ------------------------------------------- (4) legacy unanchored reading --

  describe('a format declaring neither prefix nor suffix keeps the legacy reading', () => {
    it('keeps the digits-concatenated reading of the whole value', async () => {
      // No format at all. With nothing to anchor on, the legacy reading stands
      // byte-for-byte: `'10'` wins over `'2'` — a numeric max, never a
      // lexicographic one — so the counter continues at 11.
      //
      // The RENDERING of a format-less field is a separate, pre-existing matter
      // this fix does not touch: a format-less field resolves to the contract
      // default `{0000}` (`resolveAutonumberFormat`, #6555), so 11 renders
      // `0011` here — while the engine's fallback still emits the bare `11`
      // until #7262 lands the other half. That divergence is in the render
      // default, not in the seeding parse #6468 is about, so the cross-side
      // parity test uses explicitly-formatted fields.
      await initRec();
      await seedRows(['1', '2', '10']);

      const r = await driver.create('rec', { title: 'next' });

      expect(r.rec_no).toBe('0011');
    });

    it('still concatenates the digits of values no format describes', async () => {
      await initRec();
      await seedRows(['SO-2024-0007']);

      const max = await (driver as any).scanMaxNumericTail((driver as any).knex, 'rec', 'rec_no', '', null, null, '');

      // 2024 and 0007 run together, exactly as before — unanchored is unchanged.
      expect(max).toBe(20240007);
    });
  });
});
