/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The FLOOR itself (objectui#8496 — director seat, decision batch #86).
 *
 * This file pins the cheap half: the four members, and the ⛔ that keeps them
 * four. The EXPENSIVE half — that no surface's deliberate disagreement was
 * flattened into the floor — is pinned next to each surface:
 * `emptinessFloorExtensions-8496.test.tsx` in `@object-ui/fields` and in
 * `@object-ui/plugin-detail`, `galleryEmptinessFloor-8496.test.tsx` in
 * `@object-ui/plugin-list`, `kanbanEmptinessFloor-8496.test.tsx` in
 * `@object-ui/plugin-kanban`.
 *
 * ⚠️ A suite that only proves the floor works proves the half that was never
 * in doubt. Read the four files above as one pin.
 */

import { describe, it, expect } from 'vitest';
import { isEmptyValue } from '../emptiness.js';
import { isOptionGroupGated, isValueStillOffered } from '../../evaluator/optionRules.js';

/** The four members, and nothing else is one. */
const MEMBERS: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['the empty string', ''],
  ['the empty array', []],
];

/**
 * Every candidate FIFTH member, each with the measurement that refused it.
 * These are values, and the floor calling any of them empty is the failure
 * this table exists to catch.
 */
const REFUSED_FIFTH_MEMBERS: Array<[string, unknown, string]> = [
  ['a whitespace-only string', '   ',
    'EMPTY only on record:details and RelatedList (objectui#8350) — an extension, not a member'],
  ['an empty object literal', {},
    'measured a VALUE and pinned (objectui#8474): a type-aware renderer draws it'],
  ['a populated object', { a: 1 }, 'a populated object is drawn by a type-aware renderer'],
  ['a one-entry array', [1], 'one entry is one thing to draw'],
  ['an array of one undefined', [undefined], 'length 1: the container has an entry'],
  ['zero', 0, 'a stored zero is a value on every surface'],
  ['false', false, 'BooleanCellRenderer keeps false a value (objectui#8582)'],
  ['the numeric epoch', 0, "DateCellRenderer's `!value` calls it empty — that is its extension"],
  ['the Date epoch', new Date(0),
    'Object.keys(new Date(0)).length === 0, which is why that shape is not the test'],
  ['a populated Map', new Map([['a', 1]]),
    'Object.keys() is empty on it — a false-empty the floor must not have'],
  ['a populated Set', new Set([1]), 'same false-empty shape as Map'],
  ['a class instance behind getters', new (class { get a() { return 1; } })(),
    'same false-empty shape: state that Object.keys() cannot see'],
  ['the string "0"', '0', 'a non-empty string is a value however falsy it coerces'],
  ['NaN', NaN, 'falsy, but not one of the four members'],
];

describe('objectui#8496 — the emptiness floor in @object-ui/core', () => {
  describe('THE FLOOR — exactly four members', () => {
    for (const [label, value] of MEMBERS) {
      it(`${label} is EMPTY`, () => {
        expect(isEmptyValue(value), `${label} must be a floor member`).toBe(true);
      });
    }
  });

  describe('⛔ THE FLOOR NEVER GROWS — every candidate fifth member is a VALUE', () => {
    for (const [label, value, why] of REFUSED_FIFTH_MEMBERS) {
      it(`${label} is a VALUE — ${why}`, () => {
        expect(
          isEmptyValue(value),
          `${label}: the floor grew a fifth member. ${why}`,
        ).toBe(false);
      });
    }
  });

  describe('THE MEMBER COUNT — stated as a number, so a widening cannot pass unnoticed', () => {
    it('exactly 4 of the probed shapes are empty', () => {
      const probes: unknown[] = [
        ...MEMBERS.map(([, v]) => v),
        ...REFUSED_FIFTH_MEMBERS.map(([, v]) => v),
      ];
      expect(
        probes.filter((v) => isEmptyValue(v)).length,
        'the floor answered EMPTY for something outside its four members',
      ).toBe(MEMBERS.length);
    });
  });

  /**
   * The floor was not invented: it was PROMOTED out of this package's own
   * private copy in `evaluator/optionRules.ts`, which had spelled the same four
   * members since before the card. These two exports are that copy's only
   * readers, so their answers are the promotion's non-regression evidence.
   */
  describe('THE PROMOTION — core’s own former private copy still answers the same', () => {
    for (const [label, value] of MEMBERS) {
      it(`a dependency holding ${label} gates the option list`, () => {
        expect(
          isOptionGroupGated('parent', { parent: value }),
          `${label}: an unmet dependency must still gate`,
        ).toBe(true);
      });
    }

    it('a dependency holding a value does NOT gate', () => {
      expect(isOptionGroupGated('parent', { parent: 'cn' })).toBe(false);
      expect(isOptionGroupGated('parent', { parent: 0 })).toBe(false);
      expect(isOptionGroupGated('parent', { parent: false })).toBe(false);
    });

    it('an empty value is always still offered (nothing to clear)', () => {
      for (const [label, value] of MEMBERS) {
        expect(
          isValueStillOffered(value, [{ label: 'A', value: 'a' }]),
          `${label}: an empty value has no stale choice to clear`,
        ).toBe(true);
      }
      expect(isValueStillOffered('gone', [{ label: 'A', value: 'a' }])).toBe(false);
    });
  });
});
