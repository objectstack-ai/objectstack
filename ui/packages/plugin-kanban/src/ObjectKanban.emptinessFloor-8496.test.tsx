/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectKanban`'s card-field loop asks the shared FLOOR (objectui#8496).
 *
 * ## What changed
 *
 * The loop opened with `raw == null || raw === ''` — three of the floor's four
 * members, spelled privately, and the fourth (`[]`) fell through. objectui#8489
 * caught one consequence a step later (a fully coloured pill with no children,
 * on the picklist fork) and repaired it AT THE LABEL, deliberately declining to
 * make the kanban learn what "empty" means. The OTHER fork was still open: a
 * non-picklist card field holding `[]` reached the shared cell renderer, which
 * since objectui#8481 answers it with the "No value" em-dash — so the card drew
 * a labelled placeholder for a field it omits outright when the value is `null`.
 *
 * Now the loop asks the floor by name, and objectui#8489's guard STAYS: it
 * answers every non-array value that resolves to no label, which the floor says
 * nothing about. Both pins have to be green at once.
 *
 * ## ⛔ What must not change
 *
 * The kanban does NOT trim. `'   '` is a value here — that is why the floor's
 * string member is `''` and not "blank".
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { isEmptyValue } from '@object-ui/core';
// Registers `object-kanban`.
import './index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase
// instead of racing a `waitFor` budget (objectui#3010).
import './KanbanImpl';

const OBJECT_SCHEMA = {
  name: 'test_object',
  fields: {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    status: { type: 'text' },
    // Deliberately NOT a picklist and carrying no `options`, so the loop takes
    // the `getCellRenderer` fork rather than objectui#8489's badge fork.
    notes: { type: 'text', label: 'Notes' },
  },
};

const ROWS: any[] = [
  { id: 'c1', name: 'Populated card', status: 'open', notes: 'real note' },
  { id: 'c2', name: 'Empty array card', status: 'open', notes: [] },
  { id: 'c3', name: 'Whitespace card', status: 'open', notes: '   ' },
];

const LANES = [{ id: 'open', title: 'Open' }];

function makeDataSource(rows: any[]) {
  return {
    find: vi.fn().mockResolvedValue({ data: rows, total: rows.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  } as any;
}

/** The card whose accessible name is `title` — `SortableCard`'s own handle. */
const cardNamed = (title: string): HTMLElement =>
  screen.getByRole('listitem', { name: title });

async function renderBoard() {
  const result = render(
    <SchemaRendererProvider dataSource={makeDataSource(ROWS) as any}>
      <SchemaRenderer
        schema={
          {
            type: 'object-kanban',
            objectName: 'test_object',
            groupBy: 'status',
            columns: LANES,
            cardFields: ['notes'],
          } as any
        }
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(result.container.textContent).toContain('Populated card'));
  return result;
}

afterEach(cleanup);

describe('objectui#8496 — ObjectKanban asks the floor', () => {
  it('CONTROL — a populated card field still renders its value under its label', async () => {
    await renderBoard();
    const card = cardNamed('Populated card');
    expect(card.textContent, 'CONTROL: the card-field list rendered').toContain('real note');
    expect(
      card.querySelectorAll('dt').length,
      'CONTROL: the field label is present as the list term',
    ).toBe(1);
  });

  it('a card field holding [] is OMITTED, not drawn as a labelled em-dash', async () => {
    expect(isEmptyValue([]), 'CONTROL: [] is a floor member').toBe(true);

    await renderBoard();
    const card = cardNamed('Empty array card');

    expect(
      card.querySelectorAll('dt').length,
      'a kanban card omits valueless fields; [] must not keep a label alive',
    ).toBe(0);
    expect(
      card.querySelectorAll('[data-slot="empty-value"]').length,
      'the shared No-value affordance is what [] used to reach through getCellRenderer',
    ).toBe(0);
  });

  it('⛔ NOT FLATTENED — the kanban does NOT trim: a whitespace-only value keeps its row', async () => {
    expect(isEmptyValue('   '), 'CONTROL: the floor keeps whitespace a value').toBe(false);

    await renderBoard();
    const card = cardNamed('Whitespace card');

    expect(
      card.querySelectorAll('dt').length,
      "a stored '   ' is a value on this surface — only record:details and RelatedList trim",
    ).toBe(1);
  });
});
