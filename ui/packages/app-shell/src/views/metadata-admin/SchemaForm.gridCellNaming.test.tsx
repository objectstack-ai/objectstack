// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5063 — every control in a `RepeaterField` grid/table row is named by
 * its column header.
 *
 * ## What was measured (baseline `90517e1a2`, real `SchemaForm` render,
 * `widget: 'grid'`, two sub-fields `field` / `order`)
 *
 * ```
 * cell id=rep-0-field label[for]=NONE aria-label=NONE aria-labelledby=NONE
 * cell id=rep-0-order label[for]=NONE aria-label=NONE aria-labelledby=NONE
 * th "Field" id=NONE scope=NONE
 * th "Order" id=NONE scope=NONE
 * th ""      id=NONE scope=NONE
 * ```
 *
 * All three naming channels absent on every cell: the column name existed only
 * as the header's visible TEXT — not a `label`, no `id` for an IDREF to reach,
 * no `scope`. A screen reader walking the table announced a row of unnamed edit
 * boxes. Same failure class as #3994 (a visible `Label` beside a control it is
 * not associated with, leaving the name as orphan text), with the repeater's
 * table as the host.
 *
 * The card layout is NOT affected and is asserted here as the control: each of
 * its rows goes through `FieldRow`, which writes a real `<label for>`.
 *
 * ## The shape, and the one that was rejected
 *
 * Direction 1 (taken): the `<th>` publishes an id and `scope="col"`, and each
 * cell control answers `aria-labelledby` — the column name is written once, in
 * the header where table semantics already put it. Direction 2 (per-cell
 * `aria-label`) was rejected: it copies the column name into every row and
 * drifts the moment a column is renamed.
 *
 * Row identity is deliberately NOT part of the accessible name — the measured
 * gap is the missing column name, and the `<td>`'s position in a real table
 * already carries the row.
 *
 * ## What this file pins
 *
 *  1. every cell control's ACCESSIBLE NAME is its column's name — asserted
 *     through the computed name and through the IDREF landing on a `<th>`, not
 *     merely on the attribute being present;
 *  2. `scope="col"` on the headers, including the nameless row-actions column;
 *  3. the header ids are path-scoped (objectui#5062), so two repeaters with the
 *     same column names in one form neither collide nor cross-name each other;
 *  4. the card layout's own `label[for]` association is untouched.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';

afterEach(cleanup);

const ROW_ITEMS = {
  type: 'object',
  properties: { field: { type: 'string' }, order: { type: 'string', enum: ['asc', 'desc'] } },
};

function gridForm(fieldName: string, layout: 'grid' | 'card') {
  return {
    type: 'simple',
    sections: [
      {
        label: 'S',
        fields: [
          {
            field: fieldName,
            type: 'repeater',
            ...(layout === 'grid' ? { widget: 'grid' } : {}),
            fields: [
              { field: 'field', type: 'text', label: 'Field' },
              { field: 'order', type: 'text', label: 'Order' },
            ],
          },
        ],
      },
    ],
  } as never;
}

/** The cell controls of the rendered table, in document order. */
function cellControls() {
  return Array.from(document.querySelectorAll('td input, td textarea, td [role="combobox"]')) as HTMLElement[];
}

describe('#5063 — grid/table repeater cells are named by their column header', () => {
  it('each cell control resolves its name from the matching `th`', () => {
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { cols: { type: 'array', title: 'Cols', items: ROW_ITEMS } } } as never}
        form={gridForm('cols', 'grid')}
        value={{ cols: [{ field: 'name', order: 'asc' }] }}
        onChange={() => {}}
      />,
    );

    const cells = cellControls();
    expect(cells).toHaveLength(2);

    for (const [cell, columnName] of [
      [cells[0], 'Field'],
      [cells[1], 'Order'],
    ] as const) {
      // The channel: an IDREF that actually lands on the column's header cell.
      const ref = cell.getAttribute('aria-labelledby');
      expect(ref, 'cell has no aria-labelledby').not.toBeNull();
      const header = document.getElementById(ref!);
      expect(header, `aria-labelledby="${ref}" resolves to nothing`).not.toBeNull();
      expect(header!.tagName).toBe('TH');
      expect(header).toHaveTextContent(columnName);
      // And the name that actually reaches assistive tech.
      expect(cell).toHaveAccessibleName(columnName);
    }
  });

  it('every column header carries `scope="col"`, the row-actions one included', () => {
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { cols: { type: 'array', title: 'Cols', items: ROW_ITEMS } } } as never}
        form={gridForm('cols', 'grid')}
        value={{ cols: [{ field: 'name', order: 'asc' }] }}
        onChange={() => {}}
      />,
    );

    const headers = Array.from(document.querySelectorAll('th'));
    expect(headers).toHaveLength(3); // Field, Order, row actions
    for (const th of headers) expect(th).toHaveAttribute('scope', 'col');
    // Only the two NAMED columns publish an id — nothing points at the actions
    // column, so an id there would be an unreferenced anchor.
    expect(headers.filter((th) => th.id)).toHaveLength(2);
  });

  it('a cell that renders a select is named the same way as a plain input', () => {
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { cols: { type: 'array', title: 'Cols', items: ROW_ITEMS } } } as never}
        form={
          {
            type: 'simple',
            sections: [
              {
                label: 'S',
                fields: [
                  {
                    field: 'cols',
                    type: 'repeater',
                    widget: 'grid',
                    // No `type: 'text'` on `order`, so the schema enum wins and
                    // the cell renders a Select instead of an Input.
                    fields: [{ field: 'field', type: 'text', label: 'Field' }, { field: 'order', label: 'Order' }],
                  },
                ],
              },
            ],
          } as never
        }
        value={{ cols: [{ field: 'name', order: 'asc' }] }}
        onChange={() => {}}
      />,
    );

    const select = document.querySelector('td [role="combobox"]')!;
    expect(select).toHaveAccessibleName('Order');
  });

  it('two grid repeaters with the same column names neither collide nor cross-name', () => {
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              sortBy: { type: 'array', title: 'Sort By', items: ROW_ITEMS },
              groupBy: { type: 'array', title: 'Group By', items: ROW_ITEMS },
            },
          } as never
        }
        form={
          {
            type: 'simple',
            sections: [
              {
                label: 'S',
                fields: [
                  { field: 'sortBy', type: 'repeater', widget: 'grid', fields: [{ field: 'field', type: 'text', label: 'Field' }] },
                  { field: 'groupBy', type: 'repeater', widget: 'grid', fields: [{ field: 'field', type: 'text', label: 'Field' }] },
                ],
              },
            ],
          } as never
        }
        value={{ sortBy: [{ field: 'a' }], groupBy: [{ field: 'b' }] }}
        onChange={() => {}}
      />,
    );

    const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);

    // Each cell must be named by ITS OWN table's header — with one shared id
    // both would have resolved to the first table's `th`.
    const [first, second] = Array.from(document.querySelectorAll('table')) as HTMLTableElement[];
    for (const table of [first, second]) {
      const cell = table.querySelector('td input')!;
      const header = document.getElementById(cell.getAttribute('aria-labelledby')!)!;
      expect(table.contains(header), "a cell is named by the other table's header").toBe(true);
      expect(cell).toHaveAccessibleName('Field');
    }
  });
});

describe('#5063 — the card layout keeps its own `label for` association', () => {
  it('control: each card row sub-field is labelled the plain way', () => {
    render(
      <SchemaForm
        schema={{ type: 'object', properties: { cols: { type: 'array', title: 'Cols', items: ROW_ITEMS } } } as never}
        form={gridForm('cols', 'card')}
        value={{ cols: [{ field: 'name', order: 'asc' }] }}
        onChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByText(/#1/));

    const label = screen.getByText('Field').closest('label')!;
    const target = document.getElementById(label.getAttribute('for')!)!;
    expect(target.tagName).toBe('INPUT');
    expect(target).toHaveValue('name');
    expect(target).toHaveAccessibleName('Field');
    // The card row is named by its label, not by an IDREF — this layout was
    // never part of the gap.
    expect(target).not.toHaveAttribute('aria-labelledby');
  });
});
