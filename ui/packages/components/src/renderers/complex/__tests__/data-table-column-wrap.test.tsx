/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6650 — `TableColumn.wrap` is READ HERE, and this file is the pin
 * that says so.
 *
 * ## Why this file exists in this shape
 *
 * ⭐ It is a RETARGET, and the shape it replaces is the defect the card
 * records. `@objectstack/spec` declares `ListColumn.wrap` and describes it to
 * authors as "Allow text wrapping". The only test that ever mentioned the key
 * asserted that a producer PASSED IT THROUGH — `expect(col.wrap).toBe(true)` —
 * and the triage analysis named exactly what is wrong with that:
 *
 *   「即便每一个消费者都消失它也会保持绿色，而那正是现在已经发生的事」
 *   (2026-08-28 triage, objectui#6650)
 *
 * That is precisely what happened: objectui#5453 retired the last forward,
 * objectui#6632 retired the whole spec-bridge that owned the pin, and no test
 * anywhere went red, because nothing anywhere had ever asserted that the key
 * REACHED A RENDERER. A pin that survives the disappearance of everything it
 * exists to protect is not a weak pin, it is an inert one.
 *
 * ⇒ Every assertion below is about the DOM this renderer produces. If the
 * `wrap` read is deleted from `data-table.tsx` again, these go red. Proven,
 * not assumed: with `data-table.tsx` reverted to `origin/main` and this file
 * kept, the measurement is recorded in the PR body.
 *
 * ## What is pinned
 *
 * 1. `wrap: true`  → the cell body is `whitespace-normal break-words`, and the
 *    one-line `truncate` clamp is GONE.
 * 2. `wrap` absent → `truncate`, byte-identical to the behaviour that shipped
 *    before this card. This is the ruling's "leaves today's behaviour
 *    untouched" half, and it is a control as much as a pin: without it, a
 *    renderer that wrapped EVERYTHING would satisfy assertion 1.
 * 3. `wrap: false` → `truncate` as well. An explicit `false` is a decision,
 *    and it must land on the same side as absence.
 * 4. ⭐ PRECEDENCE, the confidence gap the ruling assigned to implementation:
 *    `fitContent` WINS over `wrap`. See the block comment on that test.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

/** Long enough that truncation vs wrapping is a real question for it. */
const LONG = 'A note long enough that one line cannot hold it without clipping';

function renderTable(columns: any[]) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  return render(
    <DataTable
      schema={{
        data: [{ id: '1', notes: LONG }],
        pagination: false,
        searchable: false,
        columns,
      }}
    />,
  );
}

/** The cell BODY — the element carrying the wrap/truncate decision. */
const body = () => screen.getByText(LONG);

describe('data-table honours TableColumn.wrap (objectui#6650)', () => {
  beforeAll(() => {
    expect(ComponentRegistry.has('data-table')).toBe(true);
  });

  it('wraps the cell when the column says so', () => {
    renderTable([{ header: 'Notes', accessorKey: 'notes', wrap: true }]);
    const el = body();
    expect(el.className).toContain('whitespace-normal');
    expect(el.className).toContain('break-words');
    // The clamp this key exists to switch off must actually be gone. Asserting
    // only the added classes would pass on a renderer that wrote both.
    expect(el.className).not.toContain('truncate');
  });

  it('truncates the cell when the column does not', () => {
    renderTable([{ header: 'Notes', accessorKey: 'notes' }]);
    const el = body();
    expect(el.className).toContain('truncate');
    expect(el.className).not.toContain('whitespace-normal');
  });

  it('truncates on an explicit `wrap: false` — a decision lands where absence lands', () => {
    renderTable([{ header: 'Notes', accessorKey: 'notes', wrap: false }]);
    const el = body();
    expect(el.className).toContain('truncate');
    expect(el.className).not.toContain('whitespace-normal');
  });

  /**
   * ⭐ THE PRECEDENCE, pinned. The ruling carried this forward as a confidence
   * gap and assigned it here: "in fit mode, column width and wrapping can
   * conflict; the implementer sets the precedence and pins it."
   *
   * `fitContent` WINS, and the reason is structural rather than a preference
   * between two styles. A fit cell is `width: 1%` with `minWidth` and
   * `maxWidth` left UNDEFINED — deliberately, so the column hugs its content
   * instead of being pinned to the auto-sizer's 80px floor (objectui#6424).
   * With the box that under-specified, the auto table layout sizes the column
   * from its content, and `whitespace-nowrap` is what holds that content's
   * min-content width at its max-content width — one line. Drop nowrap and
   * min-content falls back to the longest WORD. So `wrap` on a fit column does
   * not wrap it, it COLLAPSES it — measured in Chromium 1194 on this card with
   * the cell shape reproduced exactly (900px container, auto layout, sibling
   * column at 400px): 463.9px wide on ONE line with nowrap, 70.9px wide over
   * TEN lines without it — 6.5x narrower and 5.9x taller.
   *
   * ⚠️ What the same measurement does NOT show, recorded because the obvious
   * argument for this precedence turns out to be the weaker one: the shipped
   * fit producer — `ObjectGrid`'s injected `_actions` column — measures
   * IDENTICALLY both ways (179px), because `RowActionMenu` carries its own
   * `whitespace-nowrap` on a nowrap flex row. The collapse is therefore not a
   * risk to that column. It is what a TEXT column authored with both keys
   * would get, and that case — not the actions column — is what this branch
   * refuses.
   *
   * The two keys are therefore not composable, and the author asking for both
   * has asked for two incompatible things. `fitContent` holds because it is a
   * SIZING contract with a shipped producer and a pinned no-clip requirement
   * behind it (`data-table-fit-content.test.tsx`), while the outcome of
   * yielding to `wrap` is not "wrapped text" but a column squeezed to its
   * longest word — which serves neither key's author.
   */
  it('fitContent WINS over wrap — a fit column stays on one line', () => {
    renderTable([
      {
        header: 'Actions',
        accessorKey: 'notes',
        fitContent: true,
        wrap: true,
      },
    ]);
    const el = body();
    expect(el.className).toContain('whitespace-nowrap');
    expect(el.className).not.toContain('whitespace-normal');
    expect(el.className).not.toContain('break-words');

    // And the sizing contract `fitContent` owns is untouched by the presence
    // of `wrap` — the collapse above is exactly what these two lines prevent.
    const cell = el.closest('td')!;
    const style = cell.getAttribute('style') || '';
    expect(style).toContain('width: 1%');
    expect(style).not.toContain('max-width');
  });

  /**
   * A control for the whole file: `wrap` must not leak sideways. A wrapping
   * column and a truncating column in the SAME table decide independently —
   * a per-column key that turned out to be per-table would pass every test
   * above.
   */
  it('the decision is per column, not per table', () => {
    renderTable([
      { header: 'Notes', accessorKey: 'notes', wrap: true },
      { header: 'Id', accessorKey: 'id' },
    ]);
    expect(body().className).toContain('whitespace-normal');
    expect(screen.getByText('1').className).toContain('truncate');
  });
});
