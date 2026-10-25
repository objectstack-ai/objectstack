/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * The saved-mapping summary's transform column draws the shared `EmptyValue`
 * (objectui#8504).
 *
 * ## The defect
 *
 * `SavedMappingSummary` spelled its own placeholder — `<span
 * className="text-muted-foreground">—</span>` — for an entry with no transform,
 * with no `data-slot`, no `aria-label` and none of the shared component's
 * `select-none` / `no-underline` / `pointer-events-none`. In a column headed
 * "Transform", a screen-reader user heard a naked punctuation mark where the
 * next row announced "lookup".
 *
 * ⚠️ This file is why "truncated output is not a reading" is a rule. A `head -4`
 * of an em-dash grep over `ImportWizard.tsx` shows only `'— None —'`, `'— Map
 * columns manually —'` and `'— Skip —'` — em dashes used as LABEL DECORATION
 * inside i18n strings, not placeholders — and makes the file look clean. The
 * real carrier was at `:1034`, well below the first screen. Those three
 * decorations are deliberately untouched.
 *
 * ## Why this renders the component directly
 *
 * `SavedMappingSummary` is reached only through `StepMapping`, which requires a
 * parsed spreadsheet and a Radix `Select` interaction — neither of which this
 * component owns, and both of which would make the pin measure the wizard's
 * routing rather than its cell. It is read through the file's existing
 * `__testables` seam (21 entries before this one, same `@internal` contract).
 * What that seam does NOT cover: that `StepMapping` still routes to this
 * component. That line is untouched by this card.
 *
 * ## Which case DISCRIMINATES — MEASURED, not predicted
 *
 * The caricature was RUN: the transform cell rewritten to `<EmptyValue />`
 * unconditionally, transformed entries included. All three cases go red, on
 * three different assertions:
 *
 *   - `an explicit transform of 'none'` fails on "CONTROL: the transformed
 *     sibling is still not a placeholder" — the one assertion here that fails
 *     BECAUSE a filled cell gained a placeholder.
 *   - `NON-REGRESSION` fails one assertion earlier, on "the transform reaches
 *     the cell": the caricature also stops the column printing transforms, so
 *     its own `no placeholder` half is never reached.
 *   - `THE DEFECT` fails ONLY on its control — its headline claim is equally
 *     true of a table that prints no transforms at all.
 *
 * Reverting the fix turns `THE DEFECT` and the `'none'` case red on their
 * headline assertions and leaves `NON-REGRESSION` green.
 *
 * ## The visual delta
 *
 * `text-muted-foreground` (full opacity) becomes the shared
 * `text-muted-foreground/50`: one step more muted, deliberately, plus the three
 * affordances and the accessible name. The glyph is unchanged.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { __testables } from './ImportWizard';
import type { SavedMapping } from './savedMapping';

afterEach(cleanup);

const { SavedMappingSummary } = __testables;

/** The shared placeholder inside ONE element, or null. */
const emptyIn = (el: HTMLElement): HTMLElement | null =>
  el.querySelector('[data-slot="empty-value"]');

/** One entry with no transform, one with a real one. */
const MAPPING: SavedMapping = {
  name: 'invoice_import',
  label: 'Invoice import',
  targetObject: 'invoice',
  fieldMapping: [
    { source: 'Customer', target: 'account' },
    { source: 'Currency', target: 'currency', transform: 'lookup' },
  ],
};

function mount(mapping: SavedMapping) {
  const { container } = render(<SavedMappingSummary mapping={mapping} />);
  const summary = container.querySelector(
    '[data-testid="import-saved-mapping-summary"]',
  ) as HTMLElement;
  expect(summary, 'the summary table rendered').not.toBeNull();

  /** The LAST cell (Transform) of ONE row — never a table-wide lookup. */
  const transformCell = (rowIndex: number): HTMLElement => {
    const tr = summary.querySelectorAll('tbody tr')[rowIndex];
    expect(tr, `row ${rowIndex} rendered`).toBeTruthy();
    const cells = tr.querySelectorAll('td');
    expect(cells.length, `row ${rowIndex} has three columns`).toBe(3);
    return cells[2] as HTMLElement;
  };
  return { summary, transformCell };
}

describe('SavedMappingSummary transform cell uses the shared EmptyValue (objectui#8504)', () => {
  it('THE DEFECT — an entry with no transform carries an accessible name', () => {
    const { transformCell } = mount(MAPPING);
    const placeholder = emptyIn(transformCell(0));

    expect(placeholder, 'the untransformed cell draws the shared placeholder').not.toBeNull();
    expect(placeholder, 'and therefore has an accessible name').toHaveAttribute('aria-label');
    expect(
      (placeholder as HTMLElement).getAttribute('aria-label'),
      'the name is a word, never a naked punctuation mark',
    ).toBe('No value');
    expect((placeholder as HTMLElement).textContent, 'the glyph is unchanged').toBe('—');
    // CONTROL — without this, a table that prints NO transforms passes above.
    expect(
      within(transformCell(1)).queryByText('lookup'),
      'CONTROL: the sibling row still prints its transform',
    ).not.toBeNull();
  });

  it('NON-REGRESSION — a TRANSFORMED entry renders its badge and NO placeholder', () => {
    const { transformCell } = mount(MAPPING);
    const filled = transformCell(1);

    expect(within(filled).queryByText('lookup'), 'the transform reaches the cell').not.toBeNull();
    // THE DISCRIMINATING HALF: red for an EmptyValue-everywhere implementation.
    expect(emptyIn(filled), 'a transformed cell carries NO placeholder').toBeNull();
  });

  it("an explicit transform of 'none' is empty too", () => {
    // `summarizeSavedMapping` normalises `'none'` to `''`, so it takes the same
    // branch as an absent transform — pinned so the two spellings cannot drift.
    const { transformCell } = mount({
      ...MAPPING,
      fieldMapping: [
        { source: 'Customer', target: 'account', transform: 'none' },
        { source: 'Currency', target: 'currency', transform: 'lookup' },
      ],
    });
    expect(emptyIn(transformCell(0)), "'none' is not a transform").not.toBeNull();
    expect(
      emptyIn(transformCell(1)),
      'CONTROL: the transformed sibling is still not a placeholder',
    ).toBeNull();
  });
});
