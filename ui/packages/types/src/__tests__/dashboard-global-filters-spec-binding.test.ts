/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4032 — `DashboardComponentSchema.globalFilters` is BOUND to
 * `@objectstack/spec`'s `GlobalFilter`, not restated.
 *
 * ## Why this file exists at all
 *
 * This is the one part of #4032 that **no runtime test can falsify**. The
 * restatement was a hand-written object literal carrying the same nine keys, so
 * it type-checked, rendered, and shipped — it was simply NARROWER than the
 * contract in one place (`label`, and `options[].label`, declared `string` after
 * the spec widened both to `I18nLabel`). A type that is too narrow does not
 * fail; it makes the read sites that would have failed invisible to `tsc`
 * instead. That invisibility is the whole reason the filter bar shipped
 * `[object Object]: All` and `normalizeFilterOptions` shipped a coercion that
 * discarded map labels in every locale, English included.
 *
 * So the pins below are compile-time by necessity: reverting `globalFilters` to
 * the old inline literal turns THIS FILE red (`tsc -p tsconfig.test.json`, run
 * by `type-check`) and leaves every runtime suite green — which is precisely the
 * failure signature the drift had, reproduced deliberately.
 *
 * The sibling half of the same widening WAS compile-visible and got repaired in
 * #4208, for one structural reason: `DashboardWidgetSchema` takes its keys from
 * the spec through `extends`. These pins hold `globalFilters` to that same
 * route.
 */

import { describe, it, expect } from 'vitest';
import type { DashboardComponentSchema } from '../complex';

type GlobalFilterOf = NonNullable<DashboardComponentSchema['globalFilters']>[number];

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** True when `V` is assignable to the type of `K` on a global filter. */
type Accepts< K extends keyof GlobalFilterOf, V > = V extends GlobalFilterOf[K] ? true : false;

describe('DashboardComponentSchema.globalFilters — bound to the spec, not restated (#4032)', () => {
  it('accepts an inline per-locale map on the filter label', () => {
    // The exact shape the restatement made unrepresentable. `Record< string,
    // string >` is `I18nLabel`'s inline-map half.
    type _MapLabel = Assert< Accepts< 'label', { en: string; 'zh-CN': string } > >;
    // …without having lost the plain-string half.
    type _StringLabel = Assert< Accepts< 'label', string > >;

    const filter: GlobalFilterOf = {
      field: 'owner',
      name: 'owner',
      label: { en: 'Owner', 'zh-CN': '负责人' },
    };
    expect(filter.label).toEqual({ en: 'Owner', 'zh-CN': '负责人' });
  });

  it('accepts an inline per-locale map on a static option label', () => {
    // The second, worse site: this one was not merely unrendered, it was
    // DISCARDED by `normalizeFilterOptions` in every locale.
    const filter: GlobalFilterOf = {
      field: 'sales_channel',
      name: 'channel',
      type: 'select',
      options: [{ value: 'domestic', label: { en: 'Domestic', 'zh-CN': '国内' } }],
    };
    expect(filter.options).toHaveLength(1);
  });

  it('no longer DECLARES the bare-string option shorthand, which the spec rejects', () => {
    // Measured, not assumed — `DashboardSchema.safeParse` on
    // `options: ['EMEA', 'APAC']` returns two issues, both
    // "Invalid input: expected object, received string". So the restatement was
    // not only too narrow on `label`, it was also too WIDE here: it declared a
    // shorthand `@objectstack/spec` refuses at publish, i.e. a second de-facto
    // contract of exactly the kind AGENTS.md #0.1 forbids. A dashboard authored
    // that way type-checked and rendered in objectui and would have been
    // rejected the moment it reached the platform.
    //
    // Binding fixes both directions at once, which is the point of binding.
    type _ShorthandGone = Assert< Equal< Accepts< 'options', string[] >, false > >;

    // This card was the TYPE half only. The runtime half followed on its own
    // card (objectui#4356, the objectstack#7917 option-② schedule):
    // `normalizeFilterOptions` in `@object-ui/core` no longer lifts a bare
    // string for STORED documents either — the member yields no option and a
    // dev-mode warning names it. Narrowing the authoring type and retiring the
    // runtime tolerance were different changes, and landed apart.
    expect(true).toBe(true);
  });

  it('is the spec type by identity, not a structural look-alike', () => {
    // The load-bearing assertion. Every check above would also pass against a
    // hand-written literal that happened to be widened by hand today — which is
    // exactly how the drift was born the first time. This one can only pass
    // while the binding itself is in place, so a future "just widen it locally"
    // edit fails here rather than silently restarting the same divergence.
    type SpecGlobalFilter = import('@objectstack/spec/ui').GlobalFilter;
    type _Bound = Assert< Equal< GlobalFilterOf, SpecGlobalFilter > >;
    expect(true).toBe(true);
  });
});
