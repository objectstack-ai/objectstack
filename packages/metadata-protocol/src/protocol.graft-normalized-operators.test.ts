// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `saveMeta` persists the operator spellings the spec normalized (objectui#2945).
 *
 * `ViewFilterRuleSchema.operator` is `z.preprocess(normalizeFilterOperator, …)`,
 * so validation folds `notEquals`/`gt`/`isNull` to canonical — and the result
 * used to be discarded, because the authored body is persisted verbatim. Every
 * save therefore minted fresh `VIEW_FILTER_OPERATOR_ALIASES` rows, and an alias
 * table that keeps growing can never be retired.
 *
 * `graftNormalizedOperators` copies the normalization back on and nothing else.
 * The tests below pin both halves of that claim: operators DO change, and
 * everything else — auxiliary fields, unknown keys, `$`-token conditions, array
 * order, absent optionals — does NOT.
 *
 * Parsing goes through `ViewMetadataSchema`, which is what
 * `getMetadataTypeSchema('view')` returns and therefore what `saveMetaItem`
 * actually validates against.
 */
import { describe, it, expect } from 'vitest';
import {
  ViewMetadataSchema,
  VIEW_FILTER_OPERATORS,
  VIEW_FILTER_OPERATOR_ALIASES,
  VIEW_FILTER_LIST_VALUE_OPERATORS,
  VIEW_FILTER_PAIR_VALUE_OPERATORS,
} from '@objectstack/spec/ui';
import { graftNormalizedOperators } from './protocol.js';

/** Graft through the real spec schema, the way `saveMetaItem` does. */
function graftThroughSchema(authored: unknown): unknown {
  const parsed = (ViewMetadataSchema as unknown as {
    safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown };
  }).safeParse(authored);
  expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
  return graftNormalizedOperators(authored, parsed.data);
}

/**
 * A `value` whose SHAPE the given canonical operator can carry (#6227).
 *
 * This suite's subject is the ALIAS FOLD, and the fold is only observable on a
 * rule that PARSES. Since #6227 the spec couples `value` to `operator` — the
 * three aliases that fold to `not_in` (`nin` / `notin` / `notIn`) need an array,
 * and a range needs two bounds — so a single hard-coded scalar would be refused
 * for a reason that has nothing to do with what is being tested.
 *
 * Read from the spec's own exported vocabularies rather than a local list, so a
 * list-valued operator added later cannot silently reintroduce the breakage:
 * that is the same "one declared vocabulary, not N dialects" rule the alias
 * table itself exists to serve.
 */
function valueFor(canonicalOperator: string): unknown {
  if ((VIEW_FILTER_LIST_VALUE_OPERATORS as readonly string[]).includes(canonicalOperator)) {
    return ['x'];
  }
  if ((VIEW_FILTER_PAIR_VALUE_OPERATORS as readonly string[]).includes(canonicalOperator)) {
    return ['x', 'y'];
  }
  return 'x';
}

/** Flattened runtime view overlay — the shape a console personalization PUT sends. */
const view = (filter: unknown, extra: Record<string, unknown> = {}) => ({
  name: 'showcase_task.open',
  object: 'showcase_task',
  viewKind: 'list' as const,
  label: 'Open',
  type: 'grid' as const,
  columns: ['name'],
  filter,
  ...extra,
});

describe('graftNormalizedOperators — through the real view metadata schema', () => {
  it('canonicalizes a legacy operator spelling on the persisted body', () => {
    const authored = view([{ field: 'status', operator: 'notEquals', value: 'done' }]);
    const out = graftThroughSchema(authored) as { filter: Array<{ operator: string }> };
    expect(out.filter[0].operator).toBe('not_equals');
  });

  it('canonicalizes every alias the spec still folds', () => {
    const canonical = new Set<string>(VIEW_FILTER_OPERATORS);
    const stillLegacy: string[] = [];
    for (const [alias, foldsTo] of Object.entries(VIEW_FILTER_OPERATOR_ALIASES)) {
      const out = graftThroughSchema(
        view([{ field: 'status', operator: alias, value: valueFor(foldsTo) }]),
      ) as { filter: Array<{ operator: string }> };
      if (!canonical.has(out.filter[0].operator)) stillLegacy.push(alias);
    }
    expect(stillLegacy).toEqual([]);
  });

  it('leaves a canonical operator identical — same object, nothing allocated', () => {
    const authored = view([{ field: 'status', operator: 'not_equals', value: 'done' }]);
    expect(graftThroughSchema(authored)).toBe(authored);
  });

  it('normalizes a tab filter, not just the view filter', () => {
    const authored = view(
      [{ field: 'status', operator: 'eq', value: 'open' }],
      { tabs: [{ name: 'mine', label: 'Mine', filter: [{ field: 'owner', operator: 'isNotNull' }] }] },
    );
    const out = graftThroughSchema(authored) as {
      filter: Array<{ operator: string }>;
      tabs: Array<{ filter: Array<{ operator: string }> }>;
    };
    expect(out.filter[0].operator).toBe('equals');
    expect(out.tabs[0].filter[0].operator).toBe('is_not_null');
  });
});

describe('graftNormalizedOperators — what it must never touch', () => {
  it('keeps Studio-only auxiliary fields a `parsed.data` swap would strip', () => {
    // The exact reason saveMeta persists verbatim (ADR-0005 §Validation).
    const authored = view(
      [{ field: 'status', operator: 'gt', value: 1 }],
      { isPinned: true, isDefault: false, sortOrder: 3 },
    );
    const out = graftThroughSchema(authored) as Record<string, unknown>;
    expect(out.isPinned).toBe(true);
    expect(out.isDefault).toBe(false);
    expect(out.sortOrder).toBe(3);
    expect((out.filter as Array<{ operator: string }>)[0].operator).toBe('greater_than');
  });

  it('adds no defaults and no keys the author did not write', () => {
    const authored = view([{ field: 'status', operator: 'ne', value: 'done' }]);
    const out = graftThroughSchema(authored) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(Object.keys(authored).sort());
    // The unary form carries no `value`; grafting must not materialize one,
    // even though the schema's own output would.
    const unary = view([{ field: 'owner', operator: 'isNull' }]);
    const unaryOut = graftThroughSchema(unary) as { filter: Array<Record<string, unknown>> };
    expect(Object.keys(unaryOut.filter[0]).sort()).toEqual(['field', 'operator']);
  });

  it('preserves filter order', () => {
    const authored = view([
      { field: 'a', operator: 'eq', value: 1 },
      { field: 'b', operator: 'gt', value: 2 },
      { field: 'c', operator: 'notIn', value: ['x'] },
    ]);
    const out = graftThroughSchema(authored) as { filter: Array<{ field: string; operator: string }> };
    expect(out.filter.map(f => f.field)).toEqual(['a', 'b', 'c']);
    expect(out.filter.map(f => f.operator)).toEqual(['equals', 'greater_than', 'not_in']);
  });
});

describe('graftNormalizedOperators — structural safety, no schema involved', () => {
  it('rewrites only an `operator` string, never a nested object', () => {
    // A `$`-token FilterCondition is a DIFFERENT operator vocabulary. Even if a
    // parsed tree somehow offered a string here, the object must survive.
    const authored = { criteria: { operator: { $eq: 'active' } } };
    const parsed = { criteria: { operator: 'equals' } };
    expect(graftNormalizedOperators(authored, parsed)).toBe(authored);
  });

  it('ignores a parsed tree whose shape does not match', () => {
    const authored = { filter: [{ field: 'a', operator: 'eq' }] };
    expect(graftNormalizedOperators(authored, { filter: 'not-an-array' })).toBe(authored);
    expect(graftNormalizedOperators(authored, undefined)).toBe(authored);
    expect(graftNormalizedOperators(authored, null)).toBe(authored);
  });

  it('does not read past the authored array — a longer parsed array adds nothing', () => {
    const authored = { filter: [{ field: 'a', operator: 'eq' }] };
    const out = graftNormalizedOperators(authored, {
      filter: [{ field: 'a', operator: 'equals' }, { field: 'b', operator: 'equals' }],
    }) as { filter: unknown[] };
    expect(out.filter).toHaveLength(1);
  });

  it('passes primitives and empty structures through unchanged', () => {
    expect(graftNormalizedOperators('x', 'y')).toBe('x');
    expect(graftNormalizedOperators(7, 8)).toBe(7);
    expect(graftNormalizedOperators(null, { a: 1 })).toBe(null);
    const empty = {};
    expect(graftNormalizedOperators(empty, { a: 1 })).toBe(empty);
  });
});
