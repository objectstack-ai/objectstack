// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins for the contract boundary declared on #7287 (maintainer ruling
 * 2026-08-10, 「宣告边界」, treatment (2)):
 *
 *   On an UNANCHORED format (`prefix === '' && suffix === ''`), a stored value
 *   carrying non-digit content is OUT OF CONTRACT for counter readback.
 *   `readAutonumberCounter`'s `undefined` for that slot is the contract, not a
 *   gap — permanently.
 *
 * These cases exist to make that boundary fail loudly if a later change tries to
 * fill the slot in: hoisting the engine's reading (last digit run) or the SQL
 * driver's (concatenate every digit) into the shared helper would move live
 * behavior on the other side, over record numbers that are not reclaimable once
 * issued. #7247 refused that hoist as a rider; #7287 rejects it outright.
 *
 * The tests below assert only `readAutonumberCounter` — spec's declared surface.
 * The two consumers' readings are modelled here ONLY to show WHY the slot is out
 * of contract (they disagree on exactly the inputs the boundary excludes, and
 * agree on the ones it admits); neither model is a contract, and the real
 * implementations live at their own call sites.
 */

import { describe, it, expect } from 'vitest';
import { parseAutonumberFormat, renderAutonumber, readAutonumberCounter } from './autonumber-format';

const NOW = new Date('2026-06-17T21:30:00.000Z');

/**
 * The engine's unanchored reading, mirrored from `readStoredAutonumberCounter`
 * in `packages/objectql/src/engine.ts` — the LAST digit run of the value.
 * Illustration only: this file pins nothing about the engine.
 */
function engineUnanchoredReading(value: string): number | undefined {
  const runs = value.match(/\d+/g);
  const digits = runs ? runs[runs.length - 1] : undefined;
  return digits ? parseInt(digits, 10) : undefined;
}

/**
 * The SQL driver's unanchored reading, mirrored from `scanMaxNumericTail` in
 * `packages/drivers/driver-sql/src/sql-driver.ts` — EVERY digit, concatenated.
 * Illustration only: this file pins nothing about the driver.
 */
function driverSqlUnanchoredReading(value: string): number | undefined {
  const n = parseInt(value.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

describe('the unanchored readback boundary (#7287 ruling: mixed content is out of contract)', () => {
  it('the declared default format {0000} (#6555, PR #7265) really does render an UNANCHORED pair', () => {
    // The premise the boundary hangs on: the default authoring shape is the one
    // that lands in this slot, which is why the boundary is worth declaring.
    const r = renderAutonumber({ tokens: parseAutonumberFormat('{0000}'), seq: 7, now: NOW });
    expect(r.prefix).toBe('');
    expect(r.suffix).toBe('');
    expect(r.value).toBe('0007');
  });

  describe('OUT OF CONTRACT — non-digit content on an unanchored format reads as undefined', () => {
    it.each([
      ['A1B2', 'digits split by letters — the shape the two readings disagree on most sharply'],
      ['CASE-12', 'a dash-separated legacy value against a bare {0000}'],
      ['SO-2024-0007', 'the issue-body example: engine reads 7, driver-sql reads 20240007'],
      ['2026-06-17', 'a date-looking value in a column later declared autonumber'],
      ['INV/0042', 'a separator other than a dash — the boundary is content, not punctuation'],
      ['0007 (void)', 'digits first, non-digit content trailing'],
      ['v2.1', 'digits inside an unrelated version-shaped identifier'],
      ['DRAFT', 'no digits at all — still out of contract, and still undefined'],
    ])(
      'out of contract: %s reads as undefined — the declared boundary, not a gap (#7287)',
      (value) => {
        expect(readAutonumberCounter(value, '', '')).toBeUndefined();
      },
    );

    it.each([
      ['A1B2'],
      ['SO-2024-0007'],
      ['2026-06-17'],
      ['v2.1'],
    ])(
      'why %s is out of contract: the two consumers read it as DIFFERENT numbers',
      (value) => {
        expect(engineUnanchoredReading(value)).not.toBe(driverSqlUnanchoredReading(value));
        // And spec declines to break the tie — that refusal IS the contract.
        expect(readAutonumberCounter(value, '', '')).toBeUndefined();
      },
    );

    it.each([['CASE-12', 12], ['INV/0042', 42], ['DRAFT-7', 7]])(
      'out of contract even though the two consumers happen to agree on %s (%i)',
      (value, agreed) => {
        // The boundary is drawn by CONTENT, deliberately wider than the observed
        // divergence: divergence needs TWO digit runs, so a mixed-content value
        // carrying only one reads the same number either way. Narrowing the
        // boundary to "values the two sides actually disagree on" would make it
        // undecidable from the value alone — a caller would have to know which
        // consumer is running to know whether it is in contract, which is the
        // very "same metadata, different driver, different number" property
        // #7287 exists to bound. So: still out of contract, still undefined.
        expect(engineUnanchoredReading(value)).toBe(agreed);
        expect(driverSqlUnanchoredReading(value)).toBe(agreed);
        expect(readAutonumberCounter(value, '', '')).toBeUndefined();
      },
    );
  });

  describe('INSIDE the contract — pure-digit unanchored values, where both sides agree', () => {
    it.each([['0007', 7], ['10', 10], ['0000', 0], ['123456', 123456]])(
      'in contract: %s carries no non-digit content, so both consumers read %i',
      (value, expected) => {
        expect(engineUnanchoredReading(value)).toBe(expected);
        expect(driverSqlUnanchoredReading(value)).toBe(expected);
      },
    );

    it('what renderAutonumber itself emits for {0000} stays inside the boundary', () => {
      // The in-contract face is the one the platform generates: an unanchored
      // format renders pure digits, so a store the platform filled reads the
      // same number on either side. The out-of-contract face is legacy/migrated
      // data that arrived by some other path.
      const tokens = parseAutonumberFormat('{0000}');
      for (const seq of [0, 7, 42, 9999, 123456]) {
        const { value } = renderAutonumber({ tokens, seq, now: NOW });
        expect(engineUnanchoredReading(value)).toBe(seq);
        expect(driverSqlUnanchoredReading(value)).toBe(seq);
      }
    });

    it('agreement on the digits does NOT make the shared helper answer for the slot', () => {
      // The boundary is about which INPUTS are in contract; the shared helper's
      // declared job stays the ANCHORED inverse of renderAutonumber. Even where
      // the two consumers agree, spec does not underwrite an unanchored reading
      // — each side answers from its own implementation detail.
      expect(readAutonumberCounter('0007', '', '')).toBeUndefined();
    });
  });

  it('an anchored format is untouched by this boundary — non-digit content still reads normally there', () => {
    // Guard against the boundary being read too widely: it is scoped to the
    // unanchored slot. `CASE-0007` against the pair `{prefix: 'CASE-'}` is in
    // contract and answers 7, mixed content and all.
    expect(readAutonumberCounter('CASE-0007', 'CASE-', '')).toBe(7);
  });
});
