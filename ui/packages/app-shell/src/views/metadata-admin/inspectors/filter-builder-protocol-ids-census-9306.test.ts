// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The 22-id round-trip census across every consumer of the FilterBuilder's
 * operator ids (objectui#9306).
 *
 * The dropdown stopped speaking camelCase and started speaking the protocol's
 * own ids. Every table that reads a builder row was keyed on the camelCase
 * spelling, and the hazard is specific: `FilterConditionField.condToMongo`
 * has a `default` arm that stores an EQUALITY, and the dataset bridge DROPS an
 * operator it does not map. A table left on camelCase would not fail — it
 * would store a different predicate. So the ruling's bar is "⛔ no row may
 * change which predicate it stores", and this file is where it is held.
 *
 * ## What each column is, and where its "before" came from
 *
 * The expected value in every column is the predicate the SAME row stored on
 * the tree before objectui#9306, when it carried the camelCase id — measured
 * once, by running each consumer over the 22 camelCase rows on the base tree
 * and over the 22 canonical rows on the branch (recorded in the PR). Every
 * cell matched, with one named exception: the dataset bridge column for
 * `icontains`. That operator was opt-in as `containsCaseInsensitive`, and the
 * dataset inspector never granted it, so no row there could carry it and the
 * bridge had no mapping; objectui#9306 made it an ordinary operator and mapped
 * it to `$icontains`, the token `FilterConditionField` has always written for
 * it. A new row, not a changed one.
 *
 * A second, later exception is deliberate and is a CHANGED predicate: the
 * `mongo` cells for `is_empty` / `is_not_empty` (objectui#10790). They stored
 * `{ f: { $in: [null, ''] } }` / `{ f: { $nin: [null, ''] } }`, and a `null`
 * list member is refused by every objectstack filter face, so those rows
 * stored the spelling that refusal prescribes — "no value OR the empty string"
 * and its complement, as an `$or` entry.
 *
 * A third, also a CHANGED predicate, and in BOTH columns: the same two rows
 * since objectui#10813. Three builders offered 「is empty」 with three meanings
 * — this `mongo` column's "no value OR `''`" on every type, the `dataset`
 * column's `$exists` (has no value), and the live grid's equality to `null` —
 * and all three now store the spec's ONE operator, `{ f: { $empty: true } }` /
 * `{ f: { $empty: false } }`, whose meaning is the column's declared row of the
 * spec's per-type table (ruling B on objectstack#20311). Both read halves read
 * it back as the same row.
 *
 *   - `mongo` / `readBack` — `@object-ui/fields`' sharing-rule criteria
 *     (`condToMongo`, then `kvToCondition` on what it wrote).
 *   - `dataset` / `datasetReadBack` — `app-shell`'s `dataset.filter` bridge
 *     (`groupToCondition`, then `conditionToGroup`).
 *   - the saved-view fold and the override recovery pass, which fold every
 *     spelling through the spec's `normalizeFilterOperator` and are asked to
 *     answer the canonical row and the camelCase row IDENTICALLY.
 *
 * The live grid (`plugin-list`'s `convertFilterGroupToAST`) and the view
 * config reader (`plugin-view`'s `specToBuilderOperator`) are not exported to
 * this package; their legs of the same census live beside them, in
 * `convertFilterGroupToAST.canonicalSpelling.test.ts` and
 * `view-operator-builder-parity.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { FILTER_BUILDER_OPERATORS, normalizeFilterBuilderOperator } from '@object-ui/components';
import { condToMongo, kvToCondition } from '@object-ui/fields';
import { groupToCondition, conditionToGroup } from './datasetFilterCondition';
import { foldFilterGroupToSpecRules } from '../../viewFilterFold';
import { sanitizeViewOverride } from '../../ObjectView';

const DATE = '2026-01-01';

/**
 * One row per former dropdown id: the camelCase id, the protocol id it became
 * (the amendment's mapping, with ruling B keeping the existence pair
 * unfolded), a value that makes the row complete, and the predicate each
 * consumer stores for it.
 */
const CENSUS: ReadonlyArray<{
  legacy: string;
  id: string;
  value: unknown;
  mongo: unknown;
  readBack: string;
  dataset: unknown;
  datasetReadBack: string | null;
}> = [
  { legacy: 'equals', id: 'equals', value: 'x', mongo: { f: 'x' }, readBack: 'equals', dataset: { f: { $eq: 'x' } }, datasetReadBack: 'equals' },
  { legacy: 'notEquals', id: 'not_equals', value: 'x', mongo: { f: { $ne: 'x' } }, readBack: 'not_equals', dataset: { f: { $ne: 'x' } }, datasetReadBack: 'not_equals' },
  { legacy: 'contains', id: 'contains', value: 'x', mongo: { f: { $contains: 'x' } }, readBack: 'contains', dataset: { f: { $contains: 'x' } }, datasetReadBack: 'contains' },
  // The named exception in the `dataset` column — see the file header.
  { legacy: 'containsCaseInsensitive', id: 'icontains', value: 'x', mongo: { f: { $icontains: 'x' } }, readBack: 'icontains', dataset: { f: { $icontains: 'x' } }, datasetReadBack: 'icontains' },
  { legacy: 'notContains', id: 'not_contains', value: 'x', mongo: { f: { $notContains: 'x' } }, readBack: 'not_contains', dataset: { f: { $notContains: 'x' } }, datasetReadBack: 'not_contains' },
  // The named exceptions in BOTH columns since objectui#10813 (the `mongo` one also objectui#10790) — see the file header.
  { legacy: 'isEmpty', id: 'is_empty', value: '', mongo: { f: { $empty: true } }, readBack: 'is_empty', dataset: { f: { $empty: true } }, datasetReadBack: 'is_empty' },
  { legacy: 'isNotEmpty', id: 'is_not_empty', value: '', mongo: { f: { $empty: false } }, readBack: 'is_not_empty', dataset: { f: { $empty: false } }, datasetReadBack: 'is_not_empty' },
  { legacy: 'greaterThan', id: 'greater_than', value: 5, mongo: { f: { $gt: 5 } }, readBack: 'greater_than', dataset: { f: { $gt: 5 } }, datasetReadBack: 'greater_than' },
  { legacy: 'lessThan', id: 'less_than', value: 5, mongo: { f: { $lt: 5 } }, readBack: 'less_than', dataset: { f: { $lt: 5 } }, datasetReadBack: 'less_than' },
  { legacy: 'greaterOrEqual', id: 'greater_than_or_equal', value: 5, mongo: { f: { $gte: 5 } }, readBack: 'greater_than_or_equal', dataset: { f: { $gte: 5 } }, datasetReadBack: 'greater_than_or_equal' },
  { legacy: 'lessOrEqual', id: 'less_than_or_equal', value: 5, mongo: { f: { $lte: 5 } }, readBack: 'less_than_or_equal', dataset: { f: { $lte: 5 } }, datasetReadBack: 'less_than_or_equal' },
  // `before` / `after` share `$lt` / `$gt` with the comparison pair, so a
  // field-less read-back lands on the comparison id — a collapse that predates
  // this change and that objectui#9382 settles from the field's type.
  { legacy: 'before', id: 'before', value: DATE, mongo: { f: { $lt: DATE } }, readBack: 'less_than', dataset: { f: { $lt: DATE } }, datasetReadBack: 'less_than' },
  { legacy: 'after', id: 'after', value: DATE, mongo: { f: { $gt: DATE } }, readBack: 'greater_than', dataset: { f: { $gt: DATE } }, datasetReadBack: 'greater_than' },
  { legacy: 'between', id: 'between', value: [1, 5], mongo: { f: { $gte: 1, $lte: 5 } }, readBack: 'between', dataset: { f: { $between: [1, 5] } }, datasetReadBack: 'between' },
  { legacy: 'in', id: 'in', value: ['a', 'b'], mongo: { f: { $in: ['a', 'b'] } }, readBack: 'in', dataset: { f: { $in: ['a', 'b'] } }, datasetReadBack: 'in' },
  { legacy: 'notIn', id: 'not_in', value: ['a', 'b'], mongo: { f: { $nin: ['a', 'b'] } }, readBack: 'not_in', dataset: { f: { $nin: ['a', 'b'] } }, datasetReadBack: 'not_in' },
  { legacy: 'startsWith', id: 'starts_with', value: 'x', mongo: { f: { $startsWith: 'x' } }, readBack: 'starts_with', dataset: { f: { $startsWith: 'x' } }, datasetReadBack: 'starts_with' },
  { legacy: 'endsWith', id: 'ends_with', value: 'x', mongo: { f: { $endsWith: 'x' } }, readBack: 'ends_with', dataset: { f: { $endsWith: 'x' } }, datasetReadBack: 'ends_with' },
  { legacy: 'isNull', id: 'is_null', value: '', mongo: { f: { $null: true } }, readBack: 'is_null', dataset: { f: { $null: true } }, datasetReadBack: 'is_null' },
  { legacy: 'isNotNull', id: 'is_not_null', value: '', mongo: { f: { $null: false } }, readBack: 'is_not_null', dataset: { f: { $null: false } }, datasetReadBack: 'is_not_null' },
  // Ruling B: stored as `$exists`, never folded onto `$null`. The dataset
  // inspector does not grant the pair, so its bridge has no row for it.
  { legacy: 'exists', id: 'exists', value: '', mongo: { f: { $exists: true } }, readBack: 'exists', dataset: undefined, datasetReadBack: null },
  { legacy: 'notExists', id: 'notExists', value: '', mongo: { f: { $exists: false } }, readBack: 'notExists', dataset: undefined, datasetReadBack: null },
];

const noTypes = () => undefined;
const row = (operator: string, value: unknown) => ({ id: 'c1', field: 'f', operator, value });
const group = (operator: string, value: unknown) => ({ id: 'root', logic: 'and' as const, conditions: [row(operator, value)] });

describe('objectui#9306 census — the table covers the whole vocabulary', () => {
  it('has one row per id the dropdown draws, and each row\'s id is what the builder reads its legacy id as', () => {
    expect(CENSUS).toHaveLength(22);
    expect(CENSUS.map((r) => r.id).sort()).toEqual([...FILTER_BUILDER_OPERATORS].sort());
    for (const r of CENSUS) expect(normalizeFilterBuilderOperator(r.legacy), r.legacy).toBe(r.id);
  });
});

describe('objectui#9306 census — sharing-rule criteria (`condToMongo` / `kvToCondition`)', () => {
  it.each(CENSUS)('`$id` stores the predicate `$legacy` stored', ({ id, value, mongo }) => {
    // ⚠️ The column that matters most: `condToMongo`'s `default` arm stores an
    // EQUALITY, so a protocol id with no arm would not throw — it would
    // silently become `{ f: value }`, and a sharing rule would match a
    // different set of records than the one on screen.
    expect(condToMongo(row(id, value) as never, noTypes)).toEqual(mongo);
  });

  it.each(CENSUS)('`$id` reads back as `$readBack`', ({ id, value, readBack }) => {
    const stored = condToMongo(row(id, value) as never, noTypes) as Record<string, unknown>;
    const [[field, v]] = Object.entries(stored);
    expect(kvToCondition(field, v, 0)?.operator).toBe(readBack);
  });

  it('CONTROL: an id with no arm really does fall to the equality — the hazard is live', () => {
    // Without this the column above could pass for a `condToMongo` that
    // refused every unknown id, and the equality hazard would be unmeasured.
    expect(condToMongo(row('no_such_operator', 5) as never, noTypes)).toEqual({ f: 5 });
  });
});

describe('objectui#9306 census — dataset filters (`groupToCondition` / `conditionToGroup`)', () => {
  it.each(CENSUS)('`$id` stores the dataset predicate', ({ id, value, dataset }) => {
    expect(groupToCondition(group(id, value))).toEqual(dataset);
  });

  it.each(CENSUS.filter((r) => r.dataset !== undefined))(
    '`$id` reads back as `$datasetReadBack`',
    ({ dataset, datasetReadBack }) => {
      const { group: g, representable } = conditionToGroup(dataset as never);
      expect(representable).toBe(true);
      expect(g.conditions.map((c) => c.operator)).toEqual([datasetReadBack]);
    },
  );
});

describe('objectui#9306 census — the folding readers answer both spellings identically', () => {
  it.each(CENSUS.filter((r) => r.legacy !== 'containsCaseInsensitive'))(
    'the saved-view fold stores the same rule for `$legacy` and `$id`',
    ({ legacy, id, value }) => {
      const canonical = foldFilterGroupToSpecRules(group(id, value));
      expect(foldFilterGroupToSpecRules(group(legacy, value))).toEqual(canonical);
      expect(canonical.ok).toBe(true);
    },
  );

  it('`containsCaseInsensitive` is the one spelling that fold cannot read — and the builder reads it first', () => {
    // The spec's alias table has no row for it (objectstack-ai/objectstack#20092),
    // so the fold passes it verbatim and the server's enum refuses it. It never
    // reaches the fold from the builder: the builder folds it onto `icontains`
    // at its own read boundary, and it was never offered to the view surfaces.
    expect(foldFilterGroupToSpecRules(group('containsCaseInsensitive', 'x'))).toEqual({
      ok: true,
      rules: [{ field: 'f', operator: 'containsCaseInsensitive', value: 'x' }],
    });
    expect(normalizeFilterBuilderOperator('containsCaseInsensitive')).toBe('icontains');
    expect(foldFilterGroupToSpecRules(group('icontains', 'x'))).toEqual({
      ok: true,
      rules: [{ field: 'f', operator: 'icontains', value: 'x' }],
    });
  });

  it.each(CENSUS)('the override recovery pass keeps or drops `$legacy` exactly as `$id`', ({ legacy, id, value }) => {
    const keep = (operator: string) => {
      const overlay = { name: 'v', object: 'o', filter: [{ field: 'f', operator, value }] };
      return sanitizeViewOverride(overlay) === overlay;
    };
    expect(keep(legacy)).toBe(keep(id));
    // Every census row is complete, so both are kept — a drop here is a stored
    // filter losing a condition on read.
    expect(keep(id)).toBe(true);
  });
});
