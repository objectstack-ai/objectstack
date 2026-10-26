/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9244 — the col-span ladder the form renderer emits for a field that
 * must occupy the whole row.
 *
 * ⭐ WHICH LAYER THIS PINS, said out loud because the blind spot this card
 * closes is a pin one layer too high. `plugin-form`'s `resolveColSpan` already
 * had a green pin named «span: 'full' spans the whole row at any grid width»,
 * and it is honest: that function DOES return the full grid count. It never
 * observes the class that reaches the DOM. The class is picked HERE, and until
 * this file existed nothing asserted it. So every assertion below reads a
 * rendered `className`, never a resolver's return value.
 *
 * The contract, from the published declaration rather than from the helper's
 * behaviour — `@objectstack/spec` 17.4.0, `FormField.span`'s `.describe()`:
 *
 *   'full': whole row at any column count. Prefer this over the absolute
 *   `colSpan`.
 *
 * «at any column count» is the load-bearing half. The form's column count is
 * resolved by CONTAINER QUERIES, so one authored field passes through several
 * column counts on one screen (`grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3`
 * is three of them). A single class for the widest tier satisfies the sentence
 * at the top tier only; at the middle tier the field renders identically to
 * authoring nothing at all — measured in Chromium at 285px of a 586px grid by
 * objectstack#17328, and reproduced here as an emitted-class reading.
 *
 * ⚠️ `span: 'full'` never reaches this renderer as `span`. `plugin-form`'s
 * `resolveColSpan` collapses it to a NUMBER (the grid's column count) before
 * the schema is handed down, which is why `span: 'full'` and a clamped
 * `colSpan: 4` are byte-identical here — objectstack#17328's measurement #4.
 * The cross-layer leg, from an authored `span: 'full'` all the way to the DOM,
 * lives in `plugin-form/src/__tests__/spanFullTierLadder-9244.test.tsx`; this
 * file pins the emission itself, with the container classes `plugin-form`'s
 * `CONTAINER_GRID_COLS` actually produces written out as literals (components
 * must not depend on plugin-form, and a literal is what Tailwind's scanner
 * sees anyway).
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import '../../../renderers';

afterEach(() => cleanup());

/**
 * The three container classes `plugin-form`'s `CONTAINER_GRID_COLS` emits,
 * verbatim. Kept as literals rather than imported: `@object-ui/components` is
 * downstream of nothing in `plugin-form`, and a drift between the two is
 * caught by `containerGridColsLiteralsAgree` in the plugin-form sibling file.
 */
const CONTAINER = {
  2: 'grid gap-4 grid-cols-1 @md:grid-cols-2',
  3: 'grid gap-4 grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3',
  4: 'grid gap-4 grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4',
} as const;

/** The viewport-prefixed family the renderer falls back to with no override. */
const VIEWPORT = {
  2: 'grid gap-4 md:grid-cols-2',
  3: 'grid gap-4 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
} as const;

/**
 * Render one field at `colSpan` inside `fieldContainerClass` and return the
 * class tokens the renderer put on its grid cell.
 */
function spanTokens(colSpan: number | undefined, fieldContainerClass: string): string[] {
  // ⚠️ Unmount first. The read below is a `document.body` query, so a second
  // render inside one `it` would be read through the FIRST render's cell and
  // silently answer the previous question — which is how the four-tier leg
  // first came back short by one tier with the implementation already correct.
  cleanup();
  const Form = ComponentRegistry.get('form')!;
  render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: false,
        showCancel: false,
        fieldContainerClass,
        fields: [
          { name: 'notes', label: 'Notes', type: 'input', ...(colSpan ? { colSpan } : {}) },
          { name: 'other', label: 'Other', type: 'input' },
        ],
      }}
    />,
  );
  const cell = document.body.querySelector('[data-field="notes"]');
  if (!cell) throw new Error('field not rendered: notes');
  return (cell.getAttribute('class') || '').split(/\s+/).filter(Boolean);
}

const spanClasses = (tokens: string[]) => tokens.filter((t) => /(^|:)col-span-/.test(t));

describe("objectui#9244 — a whole-row field spans the whole row at EVERY tier", () => {
  it('3-column container: 2 of 2 at the middle tier, 3 of 3 at the top', () => {
    const emitted = spanClasses(spanTokens(3, CONTAINER[3]));

    // Acceptance 1. The middle tier is the defect: without `@md:col-span-2`
    // the field occupies 1 of 2 there — pixel-identical to authoring nothing.
    expect(emitted).toEqual(['@md:col-span-2', '@2xl:col-span-3']);
  });

  it('4-column container: one class per tier, each clamped to that tier', () => {
    const emitted = spanClasses(spanTokens(4, CONTAINER[4]));

    expect(emitted).toEqual(['@md:col-span-2', '@2xl:col-span-3', '@4xl:col-span-4']);
  });

  it('2-column container: the single tier that exists', () => {
    const emitted = spanClasses(spanTokens(2, CONTAINER[2]));

    expect(emitted).toEqual(['@md:col-span-2']);
  });

  it('viewport-prefixed family: the same ladder, viewport prefixes', () => {
    // ⭐ This is the string `plugin-detail`'s `getResponsiveSpanClass` has
    // always returned for the same input — two renderers, one concept, and
    // after this card one answer. `pickSpanClass` derives its tiers from the
    // container class rather than hard-coding the ladder, so it also handles
    // the container-query family above, which `getResponsiveSpanClass` cannot.
    expect(spanClasses(spanTokens(3, VIEWPORT[3]))).toEqual(['md:col-span-2', 'lg:col-span-3']);
    expect(spanClasses(spanTokens(4, VIEWPORT[4]))).toEqual([
      'md:col-span-2',
      'lg:col-span-3',
      'xl:col-span-4',
    ]);
  });
});

describe('objectui#9244 — the negative controls the prefixing exists for', () => {
  it('⭐ never emits a BARE col-span on a container whose base tier is 1 column', () => {
    // Acceptance 2. A bare `col-span-2` on `grid-cols-1` makes CSS grid
    // synthesize an implicit second track and distorts every column width —
    // the distortion the prefixing was introduced to prevent. Asserted as a
    // token check, not a substring check: `@md:col-span-2` CONTAINS the text
    // `col-span-2`, so `toContain` would pass on the broken output.
    for (const container of [CONTAINER[2], CONTAINER[3], CONTAINER[4], VIEWPORT[3]]) {
      for (const colSpan of [2, 3, 4]) {
        const bare = spanTokens(colSpan, container).filter((t) => /^col-span-\d+$/.test(t));
        expect(bare, `bare span leaked for colSpan ${colSpan} in "${container}"`).toEqual([]);
      }
    }
  });

  it('emits no span class at all for a 1-cell field', () => {
    expect(spanClasses(spanTokens(1, CONTAINER[3]))).toEqual([]);
    expect(spanClasses(spanTokens(undefined, CONTAINER[3]))).toEqual([]);
  });

  it('does not repeat a tier whose span is unchanged from the tier below', () => {
    // A `colSpan: 2` field in a 3-column container is 2 of 2 at `@md` and
    // still 2 of 3 at `@2xl`. Tailwind's prefixes are min-width, so the `@md`
    // class is already in force at `@2xl`; a second `@2xl:col-span-2` would be
    // dead weight in the class attribute and in the generated CSS.
    expect(spanClasses(spanTokens(2, CONTAINER[3]))).toEqual(['@md:col-span-2']);
  });

  it('a container with no responsive grid information still gets a bare class', () => {
    // Unchanged behaviour, pinned so the ladder cannot swallow it: with no
    // tier to mirror, the grid is multi-column at every width and the bare
    // class is the correct — and only — answer.
    expect(spanClasses(spanTokens(2, 'grid gap-4 grid-cols-2'))).toEqual(['col-span-2']);
  });
});
