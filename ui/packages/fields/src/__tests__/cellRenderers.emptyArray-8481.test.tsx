/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8481 — an empty array is not a cell value, and the SHARED renderer
 * is where that has to be said.
 *
 * Three renderers in `@object-ui/fields` open a multi-value container and map
 * their entries into it. Their opening guards tested only `null`/`undefined`/
 * `''`, so `[]` passed and each mapped over zero entries — the renderer's
 * whole output was a childless container:
 *
 * | field types                                          | renderer             | output for `[]` on `7cf6f38fb` |
 * |------------------------------------------------------|----------------------|--------------------------------|
 * | select, status, multiselect, radio, checkboxes, tags | `SelectCellRenderer` | a DIV classed `flex flex-wrap gap-1`, no children |
 * | lookup, master_detail, tree                          | `LookupCellRenderer` | a DIV classed `flex flex-wrap gap-1`, no children |
 * | user                                                 | `UserCellRenderer`   | a DIV classed `flex -space-x-2`, no children |
 *
 * `@object-ui/plugin-detail` had already grown two private upstream
 * pre-checks against this (objectui#8474, objectui#8459). Every consumer that
 * does not pre-check reached the renderer directly. The consumer half of the
 * evidence lives in `plugin-grid`'s `emptyArrayCell-8481.test.tsx`.
 *
 * ── Why the POPULATED cases are the load-bearing ones ─────────────────────
 * An implementation that answered "empty" for EVERY value would satisfy every
 * `[]`-renders-the-affordance case in this file, including the ones that read
 * most convincingly. What refuses it is the four NON-REGRESSION cases below —
 * a populated multiselect drawing its badges, a populated lookup its chips, a
 * populated user field its avatars, and a scalar select value its single
 * badge. That is objectui#8474's measured lesson applied here: the vivid
 * assertion is rarely the discriminating one.
 *
 * ── Why the fix is NOT a package-wide emptiness predicate ─────────────────
 * Measured, by rendering every registered field type against `[]`: the
 * renderers in this package hold at least seven different private answers to
 * "is this empty", and several of the disagreements are deliberate.
 * `JsonCellRenderer` draws the two-character literal for `[]` (objectui#8474
 * measured that and kept it) and `FileCellRenderer` states "0 files" — both
 * pinned below as the declared boundary of this change, so widening it later
 * has to delete an assertion rather than merely forget a consideration.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getCellRenderer, resolveCellRendererType } from '../index';

afterEach(() => cleanup());

const OPTIONS = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
];

/** Resolve + render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown, field: Record<string, unknown> = {}) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return render(
    <Renderer value={value as any} field={{ type, name: type, ...field } as any} />,
  );
}

/** The shared "No value" affordance — a muted glyph carrying an aria-label. */
const affordance = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="empty-value"]');

/**
 * The defect's signature: an element that exists, occupies the cell and has
 * nothing inside it. Asserted structurally rather than by text, because its
 * whole problem is that it has no text to look for.
 */
function childlessContainers(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('div')).filter(
    (el) => el.childElementCount === 0 && (el.textContent ?? '') === '',
  );
}

/** Every multi-value type that reaches one of the three fixed renderers. */
const MULTI_VALUE_TYPES = [
  'select', 'status', 'multiselect', 'radio', 'checkboxes', 'tags',
  'lookup', 'master_detail', 'tree',
  'user',
] as const;

describe('objectui#8481 — an empty array is not a cell value', () => {
  describe('THE DEFECT — a multi-value container with no entries says so', () => {
    for (const type of MULTI_VALUE_TYPES) {
      it(`THE DEFECT — \`${type}\` holding [] renders the No-value affordance, not a childless container`, () => {
        const { container } = renderCell(type, [], { options: OPTIONS });

        const empty = affordance(container);
        expect(empty, `${type}: expected the shared EmptyValue affordance for []`).not.toBeNull();
        expect(
          empty?.getAttribute('aria-label'),
          `${type}: the affordance must carry its accessible name`,
        ).toBe('No value');

        expect(
          childlessContainers(container).length,
          `${type}: [] must not render a childless container (the objectui#8481 defect)`,
        ).toBe(0);
      });
    }
  });

  describe('NON-REGRESSION — these refuse an EMPTY-for-everything implementation', () => {
    it('NON-REGRESSION — a POPULATED multiselect still renders one badge per entry', () => {
      const { container } = renderCell('multiselect', ['alpha', 'beta'], { options: OPTIONS });

      expect(
        within(container).queryByText('Alpha'),
        'a populated multiselect must still draw the first option badge',
      ).not.toBeNull();
      expect(
        within(container).queryByText('Beta'),
        'a populated multiselect must still draw the second option badge',
      ).not.toBeNull();
      expect(
        affordance(container),
        'a populated multiselect must NOT render the No-value affordance',
      ).toBeNull();
    });

    it('NON-REGRESSION — a POPULATED lookup still renders one chip per referenced record', () => {
      const { container } = renderCell('lookup', ['alpha', 'beta'], { reference: 'other' });

      expect(
        within(container).queryByText('alpha'),
        'a populated lookup must still draw the first record chip',
      ).not.toBeNull();
      expect(
        within(container).queryByText('beta'),
        'a populated lookup must still draw the second record chip',
      ).not.toBeNull();
      expect(
        affordance(container),
        'a populated lookup must NOT render the No-value affordance',
      ).toBeNull();
    });

    it('NON-REGRESSION — a POPULATED user field still renders its avatar stack', () => {
      const { container } = renderCell('user', [{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }]);

      const stack = container.querySelector('div.flex');
      expect(stack, 'a populated user field must still render its stack container').not.toBeNull();
      expect(
        stack!.childElementCount,
        'a populated user field must still render one avatar per user',
      ).toBe(2);
      expect(
        affordance(container),
        'a populated user field must NOT render the No-value affordance',
      ).toBeNull();
    });

    it('NON-REGRESSION — a SCALAR select value still renders its badge', () => {
      const { container } = renderCell('select', 'alpha', { options: OPTIONS });

      expect(
        within(container).queryByText('Alpha'),
        'a scalar select value must still draw its badge',
      ).not.toBeNull();
      expect(
        affordance(container),
        'a scalar select value must NOT render the No-value affordance',
      ).toBeNull();
    });

    it('NON-REGRESSION — a ONE-entry array is a value, even when the entry itself is falsy', () => {
      // Refuses a widening spelled as "every entry is falsy" rather than
      // "there are no entries": `[0]` has something to draw and draws it.
      const { container } = renderCell('multiselect', [0], { options: OPTIONS });

      expect(
        affordance(container),
        'a one-entry array must NOT render the No-value affordance',
      ).toBeNull();
      const row = container.querySelector('div.flex.flex-wrap');
      expect(row, 'a one-entry array must still open its multi-value row').not.toBeNull();
      expect(row!.childElementCount, 'a one-entry array renders exactly one entry').toBe(1);
    });
  });

  describe('THE BOUNDARY — the renderers this change deliberately did not move', () => {
    it('THE BOUNDARY — `json` still draws the two-character literal for [] and for {}', () => {
      // objectui#8474 measured this and kept it: a json-family cell holding
      // `[]` was never blank, it printed two characters of punctuation, and
      // turning that into a placeholder is a taste change, not a bug fix.
      const arr = renderCell('json', []);
      expect(
        within(arr.container).queryByText('[]'),
        '`json` holding [] must still print the array literal',
      ).not.toBeNull();
      cleanup();

      const obj = renderCell('json', {});
      expect(
        within(obj.container).queryByText('{}'),
        '`json` holding {} must still print the object literal',
      ).not.toBeNull();
    });

    it('THE BOUNDARY — `file` still states its count rather than the affordance', () => {
      const { container } = renderCell('file', []);
      expect(
        within(container).queryByText('0 files'),
        '`file` holding [] states a count; it was never blank, so it did not move',
      ).not.toBeNull();
    });

    it('THE BOUNDARY — `{}` is untouched on the three renderers this change DOES move', () => {
      // The widening that would have swept `{}` in — `Object.keys(v).length
      // === 0` — is separately unsafe (a Date, a populated Map/Set and a
      // getter-backed class instance all report zero own keys while
      // rendering). This change tests `Array.isArray`, so `{}` cannot reach it.
      const { container } = renderCell('multiselect', {}, { options: OPTIONS });
      expect(
        affordance(container),
        '{} must NOT be swept into the empty-array fix',
      ).toBeNull();
    });
  });
});
