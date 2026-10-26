/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * View operator → FilterBuilder operator parity (#2901, #2945).
 *
 * The third of objectui's spec-operator translation tables. The other two —
 * `ListView.mapOperator` and `data-objectstack`'s `toAstFilterOperator` (spelled
 * `normalizeFilterOperator` until objectui#7265 renamed it off the spec's own
 * export of that name) — were pinned to the spec in #2974, which found eight
 * spellings they had missed by enumerating instead of deriving. This one maps
 * the same vocabulary onto the FilterBuilder's operator ids, and it had missed
 * nine:
 *
 *   not_equals, greater_than, less_than, greater_than_or_equal,
 *   less_than_or_equal, starts_with, ends_with, is_null, is_not_null
 *
 * All nine are canonical `VIEW_FILTER_OPERATORS` members, so a stored view
 * legitimately carries them, and all nine reached the builder as a raw spelling
 * its dropdown cannot select. Five now map; four are recorded as deliberate
 * gaps, asserted below so the list cannot grow silently.
 *
 * ## After objectui#9306
 *
 * The table this file used to sweep, `CANONICAL_TO_BUILDER`, is gone: the
 * builder's ids ARE the canonical `VIEW_FILTER_OPERATORS` spellings now, so the
 * table had become the identity over the twenty. What it guaranteed is asked
 * of {@link specToBuilderOperator} directly instead — every canonical member,
 * every alias the spec folds and every infix spelling must resolve to an id
 * the builder can draw — and the NULL / empty-string distinction is pinned on
 * that same function.
 */
import { describe, it, expect } from 'vitest';
import { VIEW_FILTER_OPERATORS, VIEW_FILTER_OPERATOR_ALIASES } from '@objectstack/spec/ui';
import { FILTER_BUILDER_OPERATORS } from '@object-ui/components';
import { specToBuilderOperator } from '../view-config-utils';

/**
 * Canonical view operators the FilterBuilder cannot express.
 *
 * Empty — every one of them maps. It was `starts_with`, `ends_with`,
 * `is_null`, `is_not_null` until #2942 gave the builder those four operators.
 *
 * Shrink it by adding the operator to the FilterBuilder, never by mapping onto a
 * near-equivalent: `is_null` → `is_empty` would rewrite a NULL predicate into an
 * empty-string one on the next save.
 */
const NO_BUILDER_EQUIVALENT: string[] = [];

describe('every canonical view operator is a builder id (objectui#9306)', () => {
  it('resolves to ITSELF — the builder speaks the protocol\'s spelling', () => {
    // The identity the removed table had become, asserted instead of stored.
    const moved = VIEW_FILTER_OPERATORS
      .filter(op => !NO_BUILDER_EQUIVALENT.includes(op))
      .filter(op => specToBuilderOperator(op) !== op);
    expect(moved).toEqual([]);
  });

  it('and every one of them is an id the FilterBuilder actually renders', () => {
    const builderIds = new Set<string>(FILTER_BUILDER_OPERATORS);
    const notRenderable = VIEW_FILTER_OPERATORS.filter(op => !builderIds.has(op));
    expect(notRenderable).toEqual([...NO_BUILDER_EQUIVALENT]);
  });

  it('keeps the NULL and empty-string predicates distinct', () => {
    expect(specToBuilderOperator('is_null')).toBe('is_null');
    expect(specToBuilderOperator('is_not_null')).toBe('is_not_null');
    expect(specToBuilderOperator('is_empty')).toBe('is_empty');
    expect(specToBuilderOperator('is_not_empty')).toBe('is_not_empty');
    expect(specToBuilderOperator('is_null')).not.toBe(specToBuilderOperator('is_empty'));
  });
});

/**
 * The view-config reader's leg of objectui#9306's 22-id census: every former
 * dropdown id reads onto the id the dropdown draws now. `containsCaseInsensitive`
 * is the one this reader leaves verbatim (the spec's alias table has no row for
 * it); the builder folds it onto `icontains` at its own read boundary.
 */
describe('every former dropdown id reads onto the id the dropdown draws now (objectui#9306)', () => {
  const CENSUS: ReadonlyArray<readonly [string, string]> = [
    ['equals', 'equals'], ['notEquals', 'not_equals'], ['contains', 'contains'],
    ['notContains', 'not_contains'], ['isEmpty', 'is_empty'], ['isNotEmpty', 'is_not_empty'],
    ['greaterThan', 'greater_than'], ['lessThan', 'less_than'],
    ['greaterOrEqual', 'greater_than_or_equal'], ['lessOrEqual', 'less_than_or_equal'],
    ['before', 'before'], ['after', 'after'], ['between', 'between'], ['in', 'in'], ['notIn', 'not_in'],
    ['startsWith', 'starts_with'], ['endsWith', 'ends_with'], ['isNull', 'is_null'], ['isNotNull', 'is_not_null'],
    ['exists', 'exists'], ['notExists', 'notExists'],
  ];

  it.each(CENSUS)('`%s` reads as `%s`, an id the builder draws', (legacy, id) => {
    expect(specToBuilderOperator(legacy)).toBe(id);
    expect(FILTER_BUILDER_OPERATORS as readonly string[]).toContain(id);
  });
});

describe('specToBuilderOperator', () => {
  it('resolves every canonical view operator that has an equivalent', () => {
    const builderIds = new Set<string>(FILTER_BUILDER_OPERATORS);
    const unresolved = VIEW_FILTER_OPERATORS
      .filter(op => !NO_BUILDER_EQUIVALENT.includes(op))
      .filter(op => !builderIds.has(specToBuilderOperator(op)));
    expect(unresolved).toEqual([]);
  });

  it('resolves every legacy alias the spec still folds', () => {
    // Including the builder's own former camelCase ids (`notEquals`,
    // `greaterOrEqual`, …), which are rows of this table and which a view
    // stored before objectui#9306 may carry.
    const builderIds = new Set<string>(FILTER_BUILDER_OPERATORS);
    const unresolved = Object.entries(VIEW_FILTER_OPERATOR_ALIASES)
      .filter(([, canonical]) => !NO_BUILDER_EQUIVALENT.includes(canonical))
      .filter(([alias]) => !builderIds.has(specToBuilderOperator(alias)))
      .map(([alias]) => alias);
    expect(unresolved).toEqual([]);
  });

  it('resolves the infix spellings a stored filter array carries', () => {
    expect(specToBuilderOperator('=')).toBe('equals');
    expect(specToBuilderOperator('==')).toBe('equals');
    expect(specToBuilderOperator('!=')).toBe('not_equals');
    expect(specToBuilderOperator('<>')).toBe('not_equals');
    expect(specToBuilderOperator('>')).toBe('greater_than');
    expect(specToBuilderOperator('<')).toBe('less_than');
    expect(specToBuilderOperator('>=')).toBe('greater_than_or_equal');
    expect(specToBuilderOperator('<=')).toBe('less_than_or_equal');
    expect(specToBuilderOperator('nin')).toBe('not_in');
    expect(specToBuilderOperator('like')).toBe('contains');
  });

  it('folds case and separators, so one spelling class is one entry', () => {
    for (const spelling of ['not_in', 'notIn', 'not in', 'NOT_IN', 'not-in', 'notin']) {
      expect(specToBuilderOperator(spelling)).toBe('not_in');
    }
    for (const spelling of ['greater_than_or_equal', 'greaterThanOrEqual', 'greaterorequal', 'greaterOrEqual']) {
      expect(specToBuilderOperator(spelling)).toBe('greater_than_or_equal');
    }
  });

  it('keeps contains and icontains two operators (objectui#7379)', () => {
    expect(specToBuilderOperator('icontains')).toBe('icontains');
    expect(specToBuilderOperator('contains')).toBe('contains');
  });

  it('returns an unrecognised operator unchanged rather than coercing it', () => {
    // Visible in the UI as an incomplete condition row beats a silent rewrite
    // to `equals`, which would drop the author's predicate on the next save.
    // (`containsCaseInsensitive` is one of these HERE — the spec's alias table
    // has no row for it — and the builder's own read boundary folds it.)
    expect(specToBuilderOperator('totally_made_up')).toBe('totally_made_up');
    expect(specToBuilderOperator('$regex')).toBe('$regex');
    expect(specToBuilderOperator('containsCaseInsensitive')).toBe('containsCaseInsensitive');
  });

  it('defaults an absent operator to equals', () => {
    expect(specToBuilderOperator('')).toBe('equals');
    expect(specToBuilderOperator(undefined as unknown as string)).toBe('equals');
  });
});
