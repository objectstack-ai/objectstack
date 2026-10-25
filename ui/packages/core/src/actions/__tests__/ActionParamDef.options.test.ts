/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3559 — the resolved param's option vocabulary and the reader that
 * consumes it are the same package's two halves, so pin that they agree.
 *
 * `ActionParamDef.options` used to be `Array<{ label, value }>`: a closed
 * restatement of a field's option shape, one interface away from
 * `resolveVisibleOptions()` in this very package, which reads a key that
 * restatement did not list (`visibleWhen`, ADR-0058 / #2284). The resolver in
 * `@object-ui/app-shell` rebuilt every field-inherited option to match the narrow
 * type and the predicate stopped narrowing action dialogs. `ActionParamOption`
 * now names the two keys the param layer itself uses and passes the rest through.
 *
 * Scope of this file, stated honestly: vitest does not typecheck, but this file
 * IS compiled — `packages/core/tsconfig.test.json` takes the package's test tree
 * by glob and is chained off the package's `type-check` script. That was not so
 * when this note was written: `@object-ui/core` was then TEST_DEBT in
 * `scripts/check-type-check-coverage.mjs` and nothing here could fail for a type
 * reason at all. The package graduated in objectui#4040 and the debt table is now
 * empty. Note what still limits the type reach of THIS file specifically: the
 * deliberate `as OptionLike[]` seam described below opts its cases out of the
 * narrowing check, compiler or no compiler.
 *
 * So the type half stays pinned where the narrowing actually bites — in
 * `@object-ui/app-shell`'s `utils/resolveActionParams.test.ts`, compiled by that
 * package's own `tsconfig.test.json`. What these cases hold is the behavioural
 * agreement: an option list of the shape a resolved param carries is filtered by
 * this package's own predicate reader, per option, on the keys it declares.
 *
 * The `as OptionLike[]` below is written out rather than left implicit, because it
 * is the one visible cost of the catch-all route this widening took: extras are
 * typed `unknown`, so `ActionParamOption` is not STATICALLY an `OptionLike` (whose
 * `visibleWhen` is a `FieldRulePredicate`) even though every value it carries is.
 * No runtime path pays it — the option widgets receive their metadata from
 * `paramToField()` as `Record< string, any >` — and the alternative (enumerating
 * `visibleWhen` here) would re-open the vocabulary question objectui#3559 settled
 * once for both this type and objectui#3309. Recorded so the next reader sees a
 * deliberate seam, not an oversight.
 */
import { describe, it, expect } from 'vitest';
import { resolveVisibleOptions, resolveCascadingOptions, type OptionLike } from '../../evaluator/optionRules';
import type { ActionParamDef } from '../ActionRunner';

/** The param's options as core's typed option reader accepts them (see header). */
const asOptions = (param: ActionParamDef): OptionLike[] => param.options as OptionLike[];

/** A resolved `select` param as `resolveActionParams()` now emits it. */
const tierParam: ActionParamDef = {
  name: 'tier',
  label: 'Tier',
  type: 'select',
  options: [
    { label: 'Standard', value: 'standard', color: 'gray' },
    {
      label: 'Admin only',
      value: 'admin_only',
      visibleWhen: "'admin' in current_user.positions",
      color: 'red',
    },
  ],
};

describe('ActionParamDef options — read by resolveVisibleOptions (objectui#3559)', () => {
  it('filters a resolved param option by its visibleWhen', () => {
    const offered = resolveVisibleOptions(asOptions(tierParam), {}, {
      current_user: { positions: ['sales'] },
    });
    expect(offered.map((o) => o.value)).toEqual(['standard']);
  });

  it('offers it to a viewer the predicate admits', () => {
    const offered = resolveVisibleOptions(asOptions(tierParam), {}, {
      current_user: { positions: ['admin'] },
    });
    expect(offered.map((o) => o.value)).toEqual(['standard', 'admin_only']);
  });

  it('carries the non-predicate keys through the filter untouched', () => {
    const offered = resolveVisibleOptions(asOptions(tierParam), {}, {
      current_user: { positions: ['admin'] },
    });
    // Filtering selects entries, it never rebuilds them — the option a widget
    // renders is the one the field declared, `color` and all.
    expect(offered[1]).toEqual({
      label: 'Admin only',
      value: 'admin_only',
      visibleWhen: "'admin' in current_user.positions",
      color: 'red',
    });
  });

  it('resolves the same list through the widgets\' entry point (dependsOn gating)', () => {
    // `resolveCascadingOptions` is what `useCascadingOptions` wraps; a param
    // option list flows through it unchanged when no `dependsOn` is declared.
    const { options, gated, dependsOnFields } = resolveCascadingOptions(
      asOptions(tierParam),
      {},
      undefined,
      { current_user: { positions: ['sales'] } },
    );
    expect(gated).toBe(false);
    expect(dependsOnFields).toEqual([]);
    expect(options.map((o) => o.value)).toEqual(['standard']);
  });

  it('leaves an unpredicated param option list whole', () => {
    const param: ActionParamDef = {
      name: 'stage',
      label: 'Stage',
      type: 'select',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'Won', value: 'won' },
      ],
    };
    expect(resolveVisibleOptions(asOptions(param), {}).map((o) => o.value)).toEqual(['open', 'won']);
  });
});
