/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `extractRecords` reads a `find()` answer as `QueryResult` DECLARES it — and
 * does NOT read `records` (objectui#6839, following #5945 / #6726 / #6840).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one rows member: `data`.
 * This helper's ladder was `array -> records -> data -> value`, i.e. `records`
 * AHEAD of the contract's own member — the same precedence inversion #5945 was
 * filed about and #6726 repaired by hand at seven other seams. `records` is
 * the below-the-adapter spelling that `ObjectStackAdapter.normalizeQueryResult`
 * and `ApiDataSource.normalizeQueryResult` already fold into `data` BELOW every
 * consumer of this helper.
 *
 * ## What this file measures that the per-module pins cannot
 *
 * The nine renderers get their own `*.contractEnvelope-6839.*` pins, because a
 * single "nothing reads `records`" assertion would pass even if one module
 * routed around the helper. This file is the other half: the ARM ORDER itself.
 * A per-module render pin answers "did a `records` envelope paint rows"; only a
 * direct call can answer "when BOTH keys are present, which one wins" — and
 * that question is the defect this card names in its title.
 *
 * ⚠️ Read the refusal cases together with the live ones. Every "returns []"
 * assertion below is also satisfied by a helper that returns `[]` for
 * EVERYTHING — an implementation strictly worse than the bug. The `data`, bare
 * array and `value` cases are what refuse that implementation, and the two
 * precedence cases refuse a helper that merely REORDERED the arms instead of
 * deleting `records` (a reorder leaves `records` reachable whenever `data` is
 * absent, which is precisely the tolerance AGENTS.md #0.1 is about).
 *
 * ⛔ `value` is NOT under test for removal here. It is LIVE at this seam — five
 * `find()` doubles in `plugin-kanban` (3) and `plugin-calendar` (2) answer with
 * `{ value: [...] }` today — and objectui#6840 explicitly refused to let its own
 * zero at `ObjectView`'s seam transfer here. Its case below is a NON-REGRESSION
 * case, not an endorsement of the key.
 */

import { describe, it, expect } from 'vitest';
import { extractRecords } from '../extract-records';

const ROWS = [{ id: 'r1', name: 'Ada' }, { id: 'r2', name: 'Grace' }];
/** Distinct rows, so "which arm answered" is readable off the RESULT. */
const OTHER = [{ id: 'x9', name: 'Nobody' }];

describe('extractRecords — the find() envelope it reads (objectui#6839)', () => {
  describe('the shapes it still reads — the live arms', () => {
    it("reads the contract's `data` member", () => {
      expect(extractRecords({ data: ROWS, total: 2 })).toEqual(ROWS);
    });

    it('reads a bare array — the live non-envelope shape fakes answer with', () => {
      expect(extractRecords(ROWS)).toEqual(ROWS);
    });

    it('still reads `value` — LIVE at this seam (objectui#6840 refused to transfer its zero)', () => {
      expect(extractRecords({ value: ROWS, total: 2 })).toEqual(ROWS);
    });
  });

  describe('the shape it refuses', () => {
    it('does NOT read `records` — not a QueryResult member', () => {
      // Before the fix this returned the two rows, off a key the adapters
      // below this seam have already folded into `data`.
      expect(extractRecords({ records: ROWS, total: 2 })).toEqual([]);
    });
  });

  describe('the arm ORDER — the defect this card is named for', () => {
    it('`data` OUTRANKS `records`: a producer emitting both is read as QueryResult', () => {
      // Before the fix `records` was tried FIRST, so this returned OTHER — the
      // contract's own member was ignored in favour of a key it does not
      // declare. This is the case a mere reorder would also pass, which is why
      // the `records`-only case above is asserted alongside it.
      expect(extractRecords({ data: ROWS, records: OTHER })).toEqual(ROWS);
    });

    it('`value` outranks `records` too — the deleted arm outranks nothing', () => {
      expect(extractRecords({ value: ROWS, records: OTHER })).toEqual(ROWS);
    });

    it('a bare array outranks every envelope key', () => {
      // The array leg sits above the object branch, so an array that also
      // carries envelope-shaped own properties is read as the array it is.
      // `Array.from` strips those own properties before the compare —
      // `toEqual` weighs them, and would fail on the decoration rather than
      // on the ELEMENTS, which is the only thing this case is about.
      const withProps = Object.assign([...ROWS], { records: OTHER, data: OTHER });
      expect(Array.from(extractRecords(withProps))).toEqual(ROWS);
    });
  });

  describe('the shapes that were never rows', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a number', 42],
      ['a string', 'rows'],
      ['an empty object', {}],
      ['a non-array `data`', { data: { id: 'r1' } }],
      ['a non-array `value`', { value: 'rows' }],
    ])('answers [] for %s', (_label, input) => {
      expect(extractRecords(input)).toEqual([]);
    });
  });
});
