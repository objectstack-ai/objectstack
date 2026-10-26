/**
 * Column summary ↔ spec vocabulary parity.
 *
 * `ColumnSummarySchema` is the contract: a name it accepts is a name an author
 * can publish, and every published name has to render something. When the
 * renderer implemented five of the eleven aggregations, a view configured with
 * `count_unique` validated at authoring time and then rendered a blank footer
 * cell — the failure was invisible on both sides.
 *
 * This test closes that gap in the direction that matters: the spec widening
 * without the renderer following. It fails the moment a twelfth aggregation
 * lands in the spec, which is exactly when someone needs to decide how the
 * footer should show it.
 */
import { describe, it, expect } from 'vitest';
import { ColumnSummarySchema } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
import { SUPPORTED_SUMMARY_TYPES } from '../useColumnSummary';

describe('useColumnSummary covers the spec summary vocabulary', () => {
  const specNames: string[] = enumOptions(ColumnSummarySchema);

  it('reads a non-empty enum from the spec', () => {
    // Guards the assertions below against silently passing on an empty list if
    // the spec's lazy-schema wrapper ever stops exposing `.options`.
    expect(specNames, 'could not read ColumnSummarySchema.options from the spec').not.toEqual([]);
  });

  it('implements every aggregation the spec accepts', () => {
    const unimplemented = specNames.filter((name) => !SUPPORTED_SUMMARY_TYPES.has(name));
    expect(
      unimplemented,
      'these pass schema validation but render a blank footer cell — implement them in useColumnSummary',
    ).toEqual([]);
  });

  it('does not accept aggregations the spec rejects', () => {
    const extra = [...SUPPORTED_SUMMARY_TYPES].filter((name) => !specNames.includes(name));
    expect(
      extra,
      'these are renderer-local dialect — promote them into @objectstack/spec instead',
    ).toEqual([]);
  });
});
