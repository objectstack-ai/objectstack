/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6650 — the hop objectui#5453 deleted, back WITH a reader, pinned
 * END TO END rather than at the hop.
 *
 * ## Why end to end, and not `expect(col.wrap).toBe(true)`
 *
 * ⭐ Because that is the exact shape this card exists to retire. The only test
 * that ever mentioned this key asserted that a producer passed it through, and
 * the 2026-08-28 triage named what is wrong with that:
 *
 *   「即便每一个消费者都消失它也会保持绿色，而那正是现在已经发生的事」
 *
 * It was not hypothetical. objectui#5453 retired the downstream forward and
 * objectui#6632 retired the entire spec-bridge that owned the pin; nothing
 * went red either time, because nothing had ever asserted that an AUTHORED
 * `wrap` reached a rendered cell. A pass-through assertion cannot tell a live
 * chain from a chain whose far end has been demolished.
 *
 * ⇒ This file authors `wrap` the way a metadata author does — on a
 * `ListColumn` in an `object-grid` schema — and asserts on the DOM at the far
 * end. It goes red if ANY link breaks: the forward here, the declaration on
 * `TableColumn`, or the read in `data-table.tsx`.
 *
 * The sibling pin in `@object-ui/components`
 * (`data-table-column-wrap.test.tsx`) covers the renderer's own branches in
 * isolation, including the `fitContent` precedence. This file covers the one
 * thing that file cannot see: that the authored key actually ARRIVES.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

const LONG = 'A note long enough that one line cannot hold it without clipping';
const rows = [{ id: 'r1', notes: LONG }];

function renderGrid(columns: any[]) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid' as const,
          objectName: 'test_object',
          columns,
          data: { provider: 'value', items: rows },
        } as any}
      />
    </ActionProvider>,
  );
}

/**
 * The whole rendered CELL for the notes column — the `<td>`, not one element
 * inside it.
 *
 * ⭐ Reading the `<td>` is the load-bearing choice, and it is one this file got
 * wrong first. `data-table` owns the cell BODY and puts the wrap/truncate class
 * there, but a link column's content is `ObjectGrid`'s own `LinkCell`, which
 * carried its own `truncate`. Asserting on `getByText(...)` alone therefore
 * read whichever of the two elements happened to hold the text — and for the
 * record-link column that is the inner one, so the two "still truncates"
 * controls below passed while reading a `truncate` that had nothing to do with
 * the key under test. Asserting over the whole cell cannot be satisfied by one
 * layer while the other contradicts it.
 */
async function noteCell(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByText(LONG)).toBeInTheDocument());
  return screen.getByText(LONG).closest('td') as HTMLElement;
}

/** Every class present anywhere in the cell, one string. */
const classesIn = (cell: HTMLElement) =>
  [cell, ...Array.from(cell.querySelectorAll('*'))]
    .map((el) => (el as HTMLElement).className)
    .filter((c) => typeof c === 'string')
    .join(' ');

describe('ObjectGrid forwards the authored ListColumn.wrap all the way to the cell (objectui#6650)', () => {
  it('an authored `wrap: true` reaches the DOM as whitespace-normal break-words', async () => {
    renderGrid([{ field: 'notes', label: 'Notes', wrap: true }]);
    const classes = classesIn(await noteCell());
    expect(classes).toContain('whitespace-normal');
    expect(classes).toContain('break-words');
    // ⭐ NOTHING in the cell may still clamp it to one line. This is the half
    // that caught the `LinkCell` gap: the outer body wrapped, the inner span
    // truncated, and the text stayed on one line.
    expect(classes).not.toContain('truncate');
  });

  /**
   * The control that makes the assertion above a measurement. Same authored
   * column, same renderer, same query — only the key removed. Without this,
   * a renderer that wrapped every cell regardless would pass.
   */
  it('the same column without `wrap` still truncates', async () => {
    renderGrid([{ field: 'notes', label: 'Notes' }]);
    const classes = classesIn(await noteCell());
    expect(classes).toContain('truncate');
    expect(classes).not.toContain('whitespace-normal');
  });

  it('an authored `wrap: false` truncates — the forward carries the decision, not just its presence', async () => {
    renderGrid([{ field: 'notes', label: 'Notes', wrap: false }]);
    const classes = classesIn(await noteCell());
    expect(classes).toContain('truncate');
    expect(classes).not.toContain('whitespace-normal');
  });

  /**
   * ⭐ The SECOND column, which is a different code path and not a variation of
   * the first. Column zero is auto-linked to the record (Airtable-style), so
   * every assertion above runs through `LinkCell`. A later column renders the
   * value straight into `data-table`'s own cell body, so this is the one that
   * pins the read in `data-table.tsx` end to end, through a real authored
   * `ListColumn` rather than a hand-built `TableColumn`.
   */
  it('a non-link column honours the authored key too — both cell shapes, one key', async () => {
    renderGrid([
      { field: 'id', label: 'Id' },
      { field: 'notes', label: 'Notes', wrap: true },
    ]);
    const classes = classesIn(await noteCell());
    expect(classes).toContain('whitespace-normal');
    expect(classes).toContain('break-words');
    expect(classes).not.toContain('truncate');
  });

  /**
   * Per column, not per table — the same control the components-side pin
   * carries, repeated here because the forward is where a per-column decision
   * would most plausibly be flattened into a per-table one.
   */
  it('a wrapping column and a truncating column coexist in one grid', async () => {
    renderGrid([
      { field: 'id', label: 'Id' },
      { field: 'notes', label: 'Notes', wrap: true },
    ]);
    expect(classesIn(await noteCell())).not.toContain('truncate');
    const idCell = screen.getByText('r1').closest('td') as HTMLElement;
    expect(classesIn(idCell)).toContain('truncate');
    expect(classesIn(idCell)).not.toContain('whitespace-normal');
  });
});
