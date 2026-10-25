/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7179 — the grouping-field harvester's own contract.
 *
 * The two renderer suites (`plugin-grid`'s `groupingProjection-7179` and
 * `plugin-list`'s `ListView.groupingProjection-7179`) pin what reaches the
 * QUERY. This pins the harvest itself, which is the half those two cannot
 * fully reach: a malformed entry that crashes a consumer's own unrelated code
 * before the projection is built is invisible to them, and the `null` case
 * below is exactly that — `ObjectGrid`'s `groupValueFormatter` memo throws on
 * it today, so the only place the harvester's handling of `null` is observable
 * is here.
 */
import { describe, it, expect } from 'vitest';
import { collectGroupingFieldRefs } from '../grouping-fields';

describe('collectGroupingFieldRefs (objectui#7179)', () => {
  it('harvests the field name from the spec shape', () => {
    expect(
      collectGroupingFieldRefs({ fields: [{ field: 'business_unit', order: 'asc', collapsed: false }] }),
    ).toEqual(['business_unit']);
  });

  it('preserves first-seen order across a multi-level block', () => {
    expect(
      collectGroupingFieldRefs({ fields: [{ field: 'business_unit' }, { field: 'region' }] }),
    ).toEqual(['business_unit', 'region']);
  });

  it('deduplicates a repeated field', () => {
    expect(
      collectGroupingFieldRefs({ fields: [{ field: 'region' }, { field: 'region' }] }),
    ).toEqual(['region']);
  });

  it('trims surrounding whitespace so a padded name is not sent as an unknown key', () => {
    expect(collectGroupingFieldRefs({ fields: [{ field: '  region  ' }] })).toEqual(['region']);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty block', {}],
    ['a non-array `fields`', { fields: 'business_unit' }],
    ['an empty `fields`', { fields: [] }],
  ])('harvests nothing from %s', (_label, input) => {
    expect(collectGroupingFieldRefs(input)).toEqual([]);
  });

  it('contributes nothing for a NULL entry rather than throwing', () => {
    // The shape no consumer survives today. The harvester must not be the
    // thing that throws, so the crash stays attributable to its real owner.
    expect(collectGroupingFieldRefs({ fields: [null, { field: 'region' }] })).toEqual(['region']);
  });

  it('contributes nothing for an entry with no `field`', () => {
    expect(collectGroupingFieldRefs({ fields: [{}, { field: 'region' }] })).toEqual(['region']);
  });

  it('contributes nothing for a non-string `field`', () => {
    expect(collectGroupingFieldRefs({ fields: [{ field: 42 }, { field: 'region' }] })).toEqual(['region']);
  });

  it('contributes nothing for an empty or whitespace-only `field`', () => {
    expect(collectGroupingFieldRefs({ fields: [{ field: '' }, { field: '   ' }] })).toEqual([]);
  });

  it('REFUSES a bare string entry — the shorthand the spec does not accept', () => {
    // `GroupingConfigSchema.fields` is an array of `$strict` OBJECTS. Reading a
    // bare string anyway would be the lenient renderer-side alias AGENTS.md
    // #0.1 forbids: it fossilizes a second de-facto contract instead of having
    // the producer rejected at publish. It also could not work end to end —
    // `useGroupedData` reads `f.field` off each entry, so a bare string groups
    // by `undefined` no matter what the projection asks for.
    expect(collectGroupingFieldRefs({ fields: ['business_unit'] })).toEqual([]);
  });
});
