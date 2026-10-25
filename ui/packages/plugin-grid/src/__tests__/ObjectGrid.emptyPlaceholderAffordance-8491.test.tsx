/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectGrid`'s hand-rolled empty placeholders become the shared `EmptyValue`
 * (objectui#8491).
 *
 * ## What was wrong
 *
 * Four sites in `ObjectGrid.tsx` drew their own muted placeholder — a plain
 * span classed `text-muted-foreground/50 text-xs italic` holding a bare
 * em-dash (three cell sites) and one classed `...text-sm italic` holding the
 * `grid.empty` string (the record-detail drawer). None of them carried:
 *
 *   - `data-slot="empty-value"`, which is how tests and tooling find
 *     placeholders;
 *   - an `aria-label`, so an empty cell had **no accessible name at all**
 *     while its renderer-supplied neighbour in the very next column did;
 *   - `select-none` / `no-underline` / `pointer-events-none`, so a missing
 *     value inside a LINK column looked clickable and got copied into a
 *     selection.
 *
 * The accessibility gap is what decides it. The typography is the second
 * half: the same table showed a 12px italic placeholder in one column and the
 * shared 14px upright one in the next, because the no-renderer default branch
 * already returned `EmptyValue`.
 *
 * ## The card counted THREE cell sites. There are FOUR sites.
 *
 * The fourth is the record-detail drawer's own empty branch, which the card's
 * census missed because it grepped for one exact class string and the drawer
 * spells `text-sm`, not `text-xs`. It is pinned here by `THE DRAWER` cases.
 *
 * ## Why the drawer keeps its glyph and the cells do not
 *
 * The three cell sites adopt the bare shared component, so they agree with the
 * `EmptyValue` the default branch already draws one column over — that
 * agreement is the point, and it is a DELIBERATE visual change (the `text-xs
 * italic` treatment goes away).
 *
 * The drawer instead keeps its rendered text through `glyph`, for a measured
 * reason: `grid.empty` has exactly one call site in the workspace, and
 * `i18n/src/__tests__/dead-key-batch-retired-4730.test.ts` names that call site
 * as its evidence that the key is live. Swapping the drawer to a bare em-dash
 * would silently strand a translated string in ten locale packs. So the
 * drawer's delta is purely additive — same text, same typography, plus the
 * three affordances — and `THE DRAWER — the rendered text is unchanged` is the
 * case that holds that line.
 *
 * ## Which cases DISCRIMINATE — MEASURED, not predicted
 *
 * The lesson objectui#8474 and objectui#8481 each measured independently: the
 * most quotable assertion in a pin is usually the one that cannot tell the fix
 * from its worst caricature. So the caricature was RUN, not reasoned about —
 * `EmptyValue` rendered unconditionally at all four sites, filled cells
 * included. Result: 8 of these 12 cases red, 4 GREEN.
 *
 * The four that a give-up-on-values implementation still passes, labelled here
 * rather than shipped as if they proved something:
 *
 *   - `THE DEFECT — an empty LINK+ACTION cell`
 *   - `THE DEFECT — the auto-linked PRIMARY cell`
 *   - `AGREEMENT — the linked branch and the no-renderer default branch`
 *   - `MOBILE CARD VIEW — the card layout OMITS an empty field`
 *
 * The first two are the vivid ones. "The cell has an accessible name" is true
 * of a grid that has stopped rendering values at all. The third is a scope
 * declaration about typography — it is the only case pinning the deliberate
 * visual change, which is why it is kept. The fourth is a scope declaration
 * about a path this change does not touch.
 *
 * What REFUSES the caricature, by asserting BOTH that the value is present AND
 * that no placeholder shares its cell:
 *
 *   - `NON-REGRESSION — a FILLED linked cell`
 *   - `NON-REGRESSION — a FILLED link+action cell`
 *   - `NON-REGRESSION — a FILLED primary cell`
 *   - `NON-REGRESSION — a FILLED card field`
 *   - `THE DRAWER — a FILLED field`
 *
 * `THE DEFECT — an empty LINK cell` and both empty-drawer cases also go red
 * under the caricature, but through their value-bearing CONTROLS rather than
 * their headline assertion. That is what the controls are for, and it is worth
 * distinguishing: without them those three would have joined the green four.
 *
 * `THE DRAWER — the rendered TEXT is unchanged` is the one instrument for the
 * glyph decision: it is the ONLY case that reddens when the drawer adopts the
 * bare shared component and strands `grid.empty`.
 *
 * ## Every DOM lookup is scoped to ONE row or ONE card
 *
 * Measured on PR #8495: a grid pin that asserted "no childless flex-wrap
 * anywhere in the grid" FAILED against the correct implementation, because
 * `ObjectGrid`'s toolbar renders a legitimately empty one. Nothing here reads
 * the whole container; `emptyIn` / `valueIn` always take a single cell.
 *
 * ## The viewport is pinned in BOTH directions, and the mobile answer is a
 * ## MEASURED correction
 *
 * `ObjectGrid` swaps the whole table for a stacked card layout below 768px,
 * and that layout does call the very same `col.cell(val, row)` renderers this
 * change edits — so it looks like a second read path for the placeholder. It
 * is not. Its secondary-field loop drops empty values BEFORE the call ("hide
 * empty values on mobile"), so an empty field is omitted from the card
 * entirely, label and all, and no placeholder of either spelling has ever
 * reached it. Measured by rendering, not read from source.
 *
 * What that leaves: the card layout is a real second read path for the
 * POPULATED half, and both viewports are pinned explicitly so neither claim
 * rests on whatever `window.innerWidth` a previous test happened to set.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

/**
 * Deliberately NOT calling `registerAllFields()`. These four branches are the
 * ones `ObjectGrid` takes when a column resolves NO cell renderer, which is
 * exactly what `getCellRenderer` is never asked for when the column carries no
 * resolvable type. The columns below are typeless and their names match none
 * of the grid's inference patterns, so `CellRenderer` is null and the
 * placeholder branch under test runs.
 */

const DESKTOP = 1280;
const MOBILE = 480; // below the 768px card-view breakpoint

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

/** Desktop unless a case says otherwise — see the docblock. */
beforeEach(() => setViewport(DESKTOP));
afterEach(() => cleanup());

const ROWS = [
  { id: 'r1', title: 'Alpha', note: '', memo: '' },
  { id: 'r2', title: 'Beta', note: 'a real note', memo: 'a real memo' },
];

function renderGrid(columns: unknown, extra: Record<string, unknown> = {}) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: 'test_object',
          columns,
          data: { provider: 'value', items: ROWS },
          ...extra,
        } as never}
      />
    </ActionProvider>,
  );
}

/** The `rowIndex`-th body row of the rendered table. */
async function row(container: HTMLElement, rowIndex: number): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector('tbody tr')).not.toBeNull());
  const tr = container.querySelectorAll('tbody tr')[rowIndex];
  expect(tr, `row ${rowIndex} rendered`).toBeTruthy();
  return tr as HTMLElement;
}

/** The cell under `header` within ONE row — never a container-wide lookup. */
function cellIn(container: HTMLElement, tr: HTMLElement, header: string): HTMLElement {
  const headers = Array.from(container.querySelectorAll('thead th')).map((th) =>
    (th.textContent ?? '').trim(),
  );
  const idx = headers.indexOf(header);
  expect(idx, `the ${header} column is present — headers were ${JSON.stringify(headers)}`)
    .toBeGreaterThanOrEqual(0);
  const td = tr.querySelectorAll('td')[idx];
  expect(td, `row has a cell under ${header}`).toBeTruthy();
  return td as HTMLElement;
}

/** The shared placeholder inside ONE element, or null. */
const emptyIn = (el: HTMLElement): HTMLElement | null =>
  el.querySelector('[data-slot="empty-value"]');

/** The ONE mobile card holding `title` — never a container-wide lookup. */
function cardFor(title: string): HTMLElement {
  const card = screen.getByText(title).closest('div[class*="rounded-lg"]');
  expect(card, `a card rendered for ${title}`).toBeTruthy();
  return card as HTMLElement;
}

describe('ObjectGrid empty placeholders use the shared EmptyValue (objectui#8491)', () => {
  it('THE DEFECT — an empty LINK cell carries an accessible name', async () => {
    const { container } = renderGrid([
      { field: 'title', label: 'Title' },
      { field: 'note', label: 'Note', link: true },
    ]);
    const placeholder = emptyIn(cellIn(container, await row(container, 0), 'Note'));

    expect(placeholder, 'the empty linked cell draws the shared placeholder').not.toBeNull();
    expect(placeholder, 'and therefore has an accessible name').toHaveAttribute('aria-label');
    expect(
      (placeholder as HTMLElement).getAttribute('aria-label'),
      'the name is a word, never a naked punctuation mark',
    ).toBe('No value');
    // CONTROL — without this, a grid that rendered no values at all passes above.
    const filled = cellIn(container, await row(container, 1), 'Note');
    expect(within(filled).queryByText('a real note'), 'CONTROL: the sibling row rendered by value')
      .not.toBeNull();
  });

  it('NON-REGRESSION — a FILLED linked cell renders its value and NO placeholder', async () => {
    const { container } = renderGrid([
      { field: 'title', label: 'Title' },
      { field: 'note', label: 'Note', link: true },
    ]);
    const filled = cellIn(container, await row(container, 1), 'Note');

    expect(within(filled).queryByText('a real note'), 'the value reaches the cell').not.toBeNull();
    // THE DISCRIMINATING HALF: red for an EmptyValue-everywhere implementation.
    expect(emptyIn(filled), 'a filled cell carries NO placeholder').toBeNull();
  });

  it('THE DEFECT — an empty LINK+ACTION cell carries an accessible name', async () => {
    const { container } = renderGrid([
      { field: 'title', label: 'Title' },
      { field: 'note', label: 'Note', link: true, action: 'ping' },
    ]);
    const placeholder = emptyIn(cellIn(container, await row(container, 0), 'Note'));

    expect(placeholder, 'the empty link+action cell draws the shared placeholder').not.toBeNull();
    expect(placeholder, 'and therefore has an accessible name').toHaveAttribute('aria-label');
  });

  it('NON-REGRESSION — a FILLED link+action cell renders its value and NO placeholder', async () => {
    const { container } = renderGrid([
      { field: 'title', label: 'Title' },
      { field: 'note', label: 'Note', link: true, action: 'ping' },
    ]);
    const filled = cellIn(container, await row(container, 1), 'Note');

    expect(within(filled).queryByText('a real note'), 'the value reaches the cell').not.toBeNull();
    expect(emptyIn(filled), 'a filled cell carries NO placeholder').toBeNull();
  });

  it('THE DEFECT — the auto-linked PRIMARY cell of a bare string column list', async () => {
    // The string-array column path: index 0 is the auto-linked primary field.
    const { container } = renderGrid(['note', 'title']);
    const placeholder = emptyIn(cellIn(container, await row(container, 0), 'Note'));

    expect(placeholder, 'the empty primary cell draws the shared placeholder').not.toBeNull();
    expect(placeholder, 'and therefore has an accessible name').toHaveAttribute('aria-label');
  });

  it('NON-REGRESSION — a FILLED primary cell renders its value and NO placeholder', async () => {
    const { container } = renderGrid(['note', 'title']);
    const filled = cellIn(container, await row(container, 1), 'Note');

    expect(within(filled).queryByText('a real note'), 'the value reaches the cell').not.toBeNull();
    expect(emptyIn(filled), 'a filled cell carries NO placeholder').toBeNull();
  });

  it('AGREEMENT — the linked branch and the no-renderer default branch draw the IDENTICAL placeholder', async () => {
    // SCOPE DECLARATION, not an instrument against the caricature — see the
    // docblock. It is the only case pinning the deliberate visual change.
    const { container } = renderGrid([
      { field: 'title', label: 'Title' },
      { field: 'note', label: 'Note', link: true },
      { field: 'memo', label: 'Memo' },
    ]);
    const tr = await row(container, 0);
    const linked = emptyIn(cellIn(container, tr, 'Note'));
    const fallback = emptyIn(cellIn(container, tr, 'Memo'));

    expect(linked, 'the linked column drew a placeholder').not.toBeNull();
    expect(fallback, 'CONTROL: the default branch drew one too').not.toBeNull();
    expect(
      (linked as HTMLElement).className,
      'two placeholders in ONE row are now typographically identical',
    ).toBe((fallback as HTMLElement).className);
    expect(
      (linked as HTMLElement).className,
      'and the retired text-xs italic treatment is gone from both',
    ).not.toContain('italic');
  });

  it('MOBILE CARD VIEW — the card layout OMITS an empty field rather than drawing a placeholder', async () => {
    // SCOPE DECLARATION, and a MEASURED correction to the brief's premise: the
    // card layout below 768px is NOT a second read path for these three cell
    // sites. Its secondary-field loop drops empty values before it would call
    // `col.cell(val, row)` ("hide empty values on mobile"), so no placeholder
    // of either spelling has ever reached a card. Green before AND after this
    // change; it is here so a later edit to that loop cannot quietly start
    // drawing one without a reader noticing.
    setViewport(MOBILE);
    const { container } = renderGrid([
      { field: 'title', label: 'Title' },
      { field: 'note', label: 'Note', link: true },
    ]);
    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeNull());
    // No table below the breakpoint — this is a genuinely different renderer.
    expect(container.querySelector('tbody tr'), 'the card layout renders no table rows').toBeNull();

    const emptyCard = cardFor('Alpha');
    expect(emptyCard, 'the empty record rendered as a card').toBeTruthy();
    expect(within(emptyCard).queryByText('Note'), 'the empty field is omitted, label and all').toBeNull();
    expect(emptyIn(emptyCard), 'and no placeholder is drawn in its place').toBeNull();
    // CONTROL — without this, a run that rendered no cards at all passes above.
    const filledCard = cardFor('Beta');
    expect(within(filledCard).queryByText('Note'), 'CONTROL: a populated field DOES get a label').not.toBeNull();
  });

  it('NON-REGRESSION — a FILLED card field renders its value and NO placeholder', async () => {
    // The card layout reaches the edited `col.cell` renderers for POPULATED
    // values, so this half is a real second read path.
    setViewport(MOBILE);
    renderGrid([
      { field: 'title', label: 'Title' },
      { field: 'note', label: 'Note', link: true },
    ]);
    await waitFor(() => expect(screen.queryByText('Beta')).not.toBeNull());

    const card = cardFor('Beta');
    expect(card, 'the populated record rendered as a card').toBeTruthy();
    expect(within(card).queryByText('a real note'), 'the value reaches the card').not.toBeNull();
    expect(emptyIn(card), 'a fully populated card carries NO placeholder').toBeNull();
  });

  it('THE DRAWER — the fourth site: an empty detail field carries an accessible name', async () => {
    const { container } = renderGrid(
      [
        { field: 'title', label: 'Title' },
        { field: 'note', label: 'Note' },
      ],
      { navigation: { mode: 'drawer' } },
    );
    fireEvent.click(await screen.findByText('Alpha'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const dialog = screen.getByRole('dialog');
    const placeholder = emptyIn(dialog);

    expect(placeholder, 'the drawer field draws the shared placeholder').not.toBeNull();
    expect(placeholder, 'and therefore has an accessible name').toHaveAttribute('aria-label');
    // CONTROL — the drawer really did render this record, not an empty shell.
    expect(within(dialog).queryByText('Alpha'), 'CONTROL: the drawer rendered by value').not.toBeNull();
    void container;
  });

  it('THE DRAWER — the rendered TEXT is unchanged, the change is purely additive', async () => {
    // This is what forbids swapping the drawer to a bare em-dash: `grid.empty`
    // would lose its only call site. See the docblock.
    renderGrid(
      [
        { field: 'title', label: 'Title' },
        { field: 'note', label: 'Note' },
      ],
      { navigation: { mode: 'drawer' } },
    );
    fireEvent.click(await screen.findByText('Alpha'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const placeholder = emptyIn(screen.getByRole('dialog')) as HTMLElement;

    expect(placeholder, 'the drawer drew a placeholder').not.toBeNull();
    expect(placeholder.textContent, "the localized 'Empty' text survives verbatim").toBe('Empty');
    expect(placeholder.className, 'and so does the drawer typography').toContain('text-sm');
    expect(placeholder.className, 'and so does the drawer typography').toContain('italic');
  });

  it('THE DRAWER — a FILLED field renders its value and NO placeholder', async () => {
    renderGrid(
      [
        { field: 'title', label: 'Title' },
        { field: 'note', label: 'Note' },
      ],
      { navigation: { mode: 'drawer' } },
    );
    fireEvent.click(await screen.findByText('Beta'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).queryByText('a real note'), 'the value reaches the drawer').not.toBeNull();
    // THE DISCRIMINATING HALF for the drawer.
    expect(emptyIn(dialog), 'a fully populated record draws NO placeholder').toBeNull();
  });
});
