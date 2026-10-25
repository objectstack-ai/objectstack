/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3309 — `BulkActionParam.options`' ENTRY is open, and the three layers
 * that touch it agree.
 *
 * The entry used to be a closed `{ label, value }`. Nothing else in the path
 * agreed with it:
 *
 *  - the runtime spreads every entry into the metadata it hands the widget
 *    (`bulkParamToField`: `{ ...o, value: String(o.value) }`), so extra keys
 *    survive;
 *  - the destination shape, {@link SelectOptionMetadata}, declares
 *    `color` / `icon` / `disabled` / `visibleWhen`, and `@object-ui/fields`
 *    genuinely reads them (`option?.color`);
 *  - `@objectstack/spec`'s `BulkActionParamSchema` makes the same entry
 *    `.passthrough()` (objectstack#4001), so the server accepts them;
 *  - the parent interface `BulkActionParam` had a `[key: string]: unknown`
 *    catch-all one level up all along.
 *
 * So the type was the only layer rejecting `options: [{ label, value, color }]`
 * — a configuration the renderer honours. Not a runtime bug; a machine-readable
 * surface that lied, which is the worst kind for an AI author that trusts it.
 * The fix follows the idiom objectui#3559 settled one interface over (core's
 * `ActionParamOption`): name the two keys this layer reads, pass the rest through.
 *
 * These pins really do run: `packages/types/tsconfig.test.json` compiles every
 * test file in this package (#3009), so the `@ts-expect-error` and `Assert<…>`
 * lines below are `tsc` errors when violated — unlike the same pins in
 * `@object-ui/core`, whose tests are excluded from its `tsc`.
 *
 * Reverse verification (predicted, then run — see the PR): reverting the index
 * signature turns the two compile-time pins below red — the authored entry with
 * `color`/`visibleWhen` becomes an excess-property error, and
 * `BulkParamOption['color']` stops resolving — while the `@ts-expect-error`
 * required-key pins are unaffected in either direction (they are about the
 * DECLARED pair, which this change does not touch).
 */

import { describe, it, expect } from 'vitest';
import { BulkActionParamSchema as SpecBulkActionParamSchema } from '@objectstack/spec/ui';
import type { BulkActionParam } from '../objectql';
import type { SelectOptionMetadata } from '../field-types';

/** One entry of the option list, exactly as the type declares it. */
type BulkParamOption = NonNullable<BulkActionParam['options']>[number];

/**
 * The working configuration the closed type used to reject: the two declared
 * keys plus the widget config the option renderers read.
 */
const authoredOption: BulkParamOption = {
  label: 'Purple',
  value: 'purple',
  color: '#8B5CF6',
  visibleWhen: "'admin' in current_user.positions",
};

/** …and the same thing at the surface an author actually writes. */
const authoredParam: BulkActionParam = {
  name: 'tier',
  type: 'select',
  options: [
    { label: 'Standard', value: 'standard' },
    { label: 'Admin only', value: 'admin_only', color: 'red', disabled: false, icon: 'shield' },
  ],
};

/**
 * What `bulkParamToField` (plugin-grid) builds from an entry: the spread, plus
 * the `String(value)` the Radix selects need. Restated here rather than imported
 * — this package takes no workspace dependency, and plugin-grid depends on it.
 */
const toFieldOption = (o: BulkParamOption) => ({ ...o, value: String(o.value) });

describe('BulkActionParam.options entry is open (objectui#3309)', () => {
  it('accepts the widget-config keys the option renderers read', () => {
    // Compile-time: the assignments above are the pin. Runtime: the keys are
    // present, not swallowed by the type-level widening.
    expect(authoredOption.color).toBe('#8B5CF6');
    expect(authoredOption.visibleWhen).toBe("'admin' in current_user.positions");
    expect(authoredParam.options?.[1]).toEqual({
      label: 'Admin only',
      value: 'admin_only',
      color: 'red',
      disabled: false,
      icon: 'shield',
    });
  });

  it('keeps `label` and `value` REQUIRED — open is not optional', () => {
    // @ts-expect-error `label` is not optional; the catch-all widens the entry,
    // it does not soften the two keys this layer itself reads.
    const noLabel: BulkParamOption = { value: 'purple', color: '#8B5CF6' };
    // @ts-expect-error `value` is not optional, same reason.
    const noValue: BulkParamOption = { label: 'Purple', color: '#8B5CF6' };
    expect([noLabel, noValue]).toHaveLength(2);
  });

  it('pins the catch-all itself, and the declared pair it must not have loosened', () => {
    // An undeclared key resolves through the index signature as `unknown`.
    // Without the index signature this is a `tsc` error, not a `false` — which
    // is exactly the reverse-verification signal.
    type _CatchAll = Assert<Equal<BulkParamOption['color'], unknown>>;
    // The two declared keys keep their exact types and their required-ness.
    type _DeclaredPair = Assert<
      Equal<Pick<BulkParamOption, 'label' | 'value'>, { label: string; value: string | number | boolean }>
    >;
    expect(true).toBe(true);
  });

  it('stays structurally compatible with what a SelectOptionMetadata consumer accepts', () => {
    // The renderer's own projection of the entry lands in the destination shape
    // without a cast — the three layers now describe one thing. (`value` is
    // where they differ by design: this entry admits number/boolean for form
    // binding, and the projection is what closes that gap.)
    const consumed: SelectOptionMetadata = toFieldOption(authoredOption);
    expect(consumed.label).toBe('Purple');
    expect(consumed.value).toBe('purple');
    // The key `@object-ui/fields` reads survives the whole trip.
    expect(consumed.color).toBe('#8B5CF6');

    // A number-valued entry is what the projection stringifies (#2204 forms
    // bind numbers; the widgets compare option values as strings).
    const numeric: BulkParamOption = { label: 'Ten', value: 10, color: 'gray' };
    const projected: SelectOptionMetadata = toFieldOption(numeric);
    expect(projected.value).toBe('10');
  });

  it('agrees with the spec schema that made the same entry passthrough (objectstack#4001)', () => {
    // The precondition for this widening, asserted rather than assumed: if the
    // spec ever re-closes the entry, this fails and names the layer to revisit.
    const res = SpecBulkActionParamSchema.safeParse(authoredParam);
    expect(res.success).toBe(true);
    const parsed = res.success ? (res.data.options as SelectOptionMetadata[]) : [];
    expect(parsed[1]?.color).toBe('red');
    expect(parsed[1]?.icon).toBe('shield');
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pin helpers. A violation is a `tsc` error, not a test failure. */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
