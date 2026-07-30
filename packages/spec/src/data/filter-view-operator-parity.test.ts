// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The view vocabulary and the AST vocabulary must agree. (#3948)
 *
 * `VIEW_FILTER_OPERATORS` (`ui/view.zod.ts`) is what an author may declare on a
 * `ViewFilterRule`, and what `ViewFilterRuleSchema` validates against.
 * `VALID_AST_OPERATORS` (`data/filter.zod.ts`) gates `isFilterAST()`, which
 * decides whether a filter is parsed into a query at all.
 *
 * They disagreed on **8 of 19** members — `equals`, `not_equals`,
 * `greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal`,
 * `before`, `after`. An author could declare any of them, the schema accepted
 * them, `defineStack` accepted them, and then `isFilterAST()` refused the filter,
 * the protocol passed the array through unconverted, and the driver dropped it:
 * an unfiltered result set with no error anywhere.
 *
 * Six of the eight were reachable only in theory, because ObjectUI's adapter
 * alias table happened to translate them. The safety of the query path was
 * resting on a hand-written table in a different repository being complete, and
 * it wasn't — `before`/`after` had no entry, which is how this surfaced.
 *
 * `data/` cannot import `ui/` (that direction is already taken, so it would be
 * circular), which is why the AST map is not literally derived from the view
 * vocabulary. This test is the enforcement instead: it fails the moment the view
 * layer gains an operator the AST layer cannot lower.
 */

import { describe, it, expect } from 'vitest';
import {
  VALID_AST_OPERATORS,
  isFilterAST,
  parseFilterAST,
} from './filter.zod';
import {
  VIEW_FILTER_OPERATORS,
  VIEW_FILTER_OPERATOR_ALIASES,
} from '../ui/view.zod';

/**
 * View operators that resolve to a value-shape before an operator is ever
 * emitted, so they legitimately need no AST lowering.
 *
 * Empty today: `is_empty`/`is_not_empty` DO have lowerings (to `$null`), because
 * clients send them as operators rather than resolving them client-side. Kept as
 * an explicit, empty exemption list so that adding to it is a visible decision
 * rather than a quiet edit to the assertion.
 */
const NO_AST_LOWERING_REQUIRED = new Set<string>([]);

describe('every view filter operator has an AST lowering', () => {
  it('reads both vocabularies', () => {
    // Guards the assertions below from passing vacuously.
    expect(VIEW_FILTER_OPERATORS.length).toBeGreaterThan(0);
    expect(VALID_AST_OPERATORS.size).toBeGreaterThan(0);
  });

  it('VALID_AST_OPERATORS covers every canonical view operator', () => {
    const missing = VIEW_FILTER_OPERATORS
      .filter((op) => !NO_AST_LOWERING_REQUIRED.has(op))
      .filter((op) => !VALID_AST_OPERATORS.has(op.toLowerCase()));
    expect(
      missing,
      'an author can declare these on a ViewFilterRule and the schema validates them, '
        + 'but isFilterAST() refuses the filter — it is passed through unconverted and '
        + 'the driver cannot apply it. Add a lowering to AST_OPERATOR_MAP.',
    ).toEqual([]);
  });

  it('VALID_AST_OPERATORS covers every legacy alias spelling too', () => {
    // `saveMeta` persists the authored body verbatim, so the schema's own
    // `z.preprocess` normalization never reaches the stored row — every alias in
    // this table is live in metadata, not merely historical.
    const missing = Object.keys(VIEW_FILTER_OPERATOR_ALIASES)
      .filter((alias) => !NO_AST_LOWERING_REQUIRED.has(VIEW_FILTER_OPERATOR_ALIASES[alias]))
      .filter((alias) => !VALID_AST_OPERATORS.has(alias.toLowerCase()));
    expect(
      missing,
      'these spellings exist in stored view metadata and have no AST lowering',
    ).toEqual([]);
  });

  it.each([...VIEW_FILTER_OPERATORS])('%s survives isFilterAST as a bare triple', (op) => {
    // The bare triple is the shape that used to vanish: a single AND condition
    // is emitted as `[field, op, value]`, and when isFilterAST() rejects it the
    // whole filter is silently dropped.
    if (NO_AST_LOWERING_REQUIRED.has(op)) return;
    const value = op === 'in' || op === 'not_in' ? ['a'] : op === 'between' ? [1, 2] : 'x';
    expect(isFilterAST(['some_field', op, value]), `isFilterAST rejects "${op}"`).toBe(true);
  });

  it('lowers each view operator to a real $-operator, never the $${op} fallback', () => {
    // `convertComparison` ends in `{ [field]: { [`$${op}`]: value } }` for an
    // unmapped operator, which produces e.g. `$before` — a key no driver knows,
    // so the failure moves from "silently unfiltered" to "driver throws". Both
    // are wrong; this asserts we produce a real operator.
    const KNOWN = new Set([
      '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
      '$between', '$contains', '$notContains', '$startsWith', '$endsWith',
      '$null', '$exists',
    ]);
    const bad: string[] = [];
    for (const op of VIEW_FILTER_OPERATORS) {
      if (NO_AST_LOWERING_REQUIRED.has(op)) continue;
      const value = op === 'in' || op === 'not_in' ? ['a'] : op === 'between' ? [1, 2] : 'x';
      const parsed = parseFilterAST(['some_field', op, value]) as Record<string, unknown>;
      const arm = parsed.some_field;
      // The equality shorthand is `{ field: value }` — a bare value, not an
      // operator object. That is a real lowering, not a fallback.
      if (arm === null || typeof arm !== 'object') continue;
      const keys = Object.keys(arm as Record<string, unknown>);
      if (!keys.every((k) => KNOWN.has(k))) bad.push(`${op} → ${keys.join(',')}`);
    }
    expect(bad, 'these fell through to the $${op} fallback').toEqual([]);
  });

  it('the date comparisons that regressed now lower correctly', () => {
    expect(parseFilterAST(['close_date', 'before', '2024-01-01']))
      .toEqual({ close_date: { $lt: '2024-01-01' } });
    expect(parseFilterAST(['close_date', 'after', '2024-01-01']))
      .toEqual({ close_date: { $gt: '2024-01-01' } });
  });

  it('spells equality one way regardless of which alias the author used', () => {
    const shorthand = { status: 'active' };
    for (const op of ['=', '==', 'equals', 'eq']) {
      expect(parseFilterAST(['status', op, 'active']), `via "${op}"`).toEqual(shorthand);
    }
  });

  it('keeps null-direction keyed on the operator name, not the filler value', () => {
    // Clients send a truthy placeholder for both directions.
    expect(parseFilterAST(['note', 'is_empty', true])).toEqual({ note: { $null: true } });
    expect(parseFilterAST(['note', 'isempty', true])).toEqual({ note: { $null: true } });
    expect(parseFilterAST(['note', 'is_not_empty', true])).toEqual({ note: { $null: false } });
    expect(parseFilterAST(['note', 'isnotempty', true])).toEqual({ note: { $null: false } });
  });

  it('still refuses an operator in neither vocabulary', () => {
    // Widening must not turn the gate off.
    expect(isFilterAST(['some_field', 'sounds_like', 'x'])).toBe(false);
  });
});
