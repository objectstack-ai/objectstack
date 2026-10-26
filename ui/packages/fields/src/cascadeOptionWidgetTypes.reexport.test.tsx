/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4770 — `@object-ui/fields` re-exports the cascade allow-table, it
 * does not redefine it.
 *
 * The set of widget keys that must be fed the live record (`dependentValues`)
 * is defined once, in `@object-ui/core` next to `resolveCascadingOptions` — the
 * evaluator that reads that record — because core is the only package all three
 * consuming surfaces can depend on (the object form in `@object-ui/components`
 * cannot reach `@object-ui/fields`: that dependency runs the other way). It is
 * surfaced HERE as well because this package's `resolveFormWidgetType` produces
 * the keys the set is keyed on, so a consumer resolving widget keys finds the
 * allow-table where it resolves them.
 *
 * Two doorways, one definition. If someone ever "restores discoverability" by
 * writing a second `new Set([...])` in this package instead of re-exporting,
 * the first assertion fails — while a membership-only check would happily pass
 * on a copy and let the two definitions drift apart later, which is the exact
 * failure objectui#4770 removed.
 */
import { describe, it, expect } from 'vitest';
import { CASCADE_OPTION_WIDGET_TYPES as fromCore } from '@object-ui/core';
// This package's own entry is imported RELATIVELY, not as `@object-ui/fields`.
// A package self-import resolves through the published `exports` map to
// `dist/*.d.ts`, and `fields:type-check` has no dependency edge on this
// package's own build — so on a cold CI cache the declarations do not exist yet
// and the self-import fails with TS2307 (it passes locally only because a
// previous build left `dist/` behind). The relative specifier reads the SOURCE
// entry, which is also what the vitest alias resolves `@object-ui/fields` to,
// so the identity assertion below is over the same module either way.
import { CASCADE_OPTION_WIDGET_TYPES as fromFields, resolveFormWidgetType } from './index';

describe('CASCADE_OPTION_WIDGET_TYPES re-export (objectui#4770)', () => {
  it('is the SAME object as the core definition, not a copy', () => {
    expect(fromFields).toBe(fromCore);
  });

  it('holds exactly the four option widgets that take the live record', () => {
    // Membership is pinned so changing WHICH widgets receive `dependentValues`
    // stays a deliberate, reviewable edit on all surfaces at once. Adding a key
    // here is not a formality: the picker family (`filter-condition`,
    // `recipient-picker`, the lookup family) reads a specific SIBLING KEY off
    // the same channel, and whether the action / bulk dialogs should feed those
    // is an open question recorded on objectui#4771, not settled by this set.
    expect([...fromFields].sort()).toEqual(['checkboxes', 'multiselect', 'radio', 'select']);
  });

  it('is keyed on this package widget keys: every member resolves to itself', () => {
    // What makes the shared set safe to read from surfaces that normalize
    // differently: these are `resolveFormWidgetType` OUTPUT (what the two
    // dialogs look up), which for these four coincides with the form's
    // `normalizeFieldType` output (the `field:` prefix stripped). A member that
    // is not a real widget key would resolve to `text` here.
    for (const key of fromFields) {
      expect(resolveFormWidgetType(key)).toBe(key);
    }
  });
});
