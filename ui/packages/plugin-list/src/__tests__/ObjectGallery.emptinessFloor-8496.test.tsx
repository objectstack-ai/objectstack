/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The gallery's card-field filter asks the shared FLOOR (objectui#8496).
 *
 * ## What changed, and why it is the ruling and not a drive-by
 *
 * The filter used to be `value == null || value === ''` — three of the floor's
 * four members, spelled privately, which is the shape the card counted five
 * times. The missing member is `[]`, and the gap was VISIBLE: a card omits
 * every valueless field outright, yet an empty array fell through to the shared
 * cell renderer, which since objectui#8481 answers it with the "No value"
 * em-dash. So one card could show a labelled em-dash for `tags: []` while
 * silently omitting the `null` field right beside it — two answers to one
 * question on one card.
 *
 * ## ⛔ What did NOT change, and must not
 *
 * The gallery does NOT trim. `'   '` is a value here, and that is the reason
 * the floor's string member is `''` and not "blank": `record:details` and
 * `RelatedList` trim, this surface and the kanban do not, so a floor that
 * trimmed could not be the weakest common claim.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ObjectGallery } from '../ObjectGallery';
import { SchemaRendererProvider } from '@object-ui/react';
import { isEmptyValue } from '@object-ui/core';

const objectSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    tags: {
      type: 'multiselect',
      label: 'Tags',
      options: [{ value: 'alpha', label: 'Alpha', color: 'indigo' }],
    },
    note: { type: 'text', label: 'Note' },
  },
};

const data = [
  { id: 'a1', name: 'Populated card', tags: ['alpha'], note: 'real note' },
  { id: 'a2', name: 'Empty array card', tags: [], note: null },
  { id: 'a3', name: 'Whitespace card', tags: ['alpha'], note: '   ' },
];

const mockDataSource = {
  find: vi.fn().mockResolvedValue(data),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
};

const renderGallery = () =>
  render(
    <SchemaRendererProvider dataSource={mockDataSource as any}>
      <ObjectGallery
        schema={{
          type: 'object-gallery',
          objectName: 'account',
          gallery: { titleField: 'name', visibleFields: ['tags', 'note'] },
        }}
      />
    </SchemaRendererProvider>,
  );

describe('objectui#8496 — ObjectGallery asks the floor', () => {
  it('a card field holding [] is OMITTED, not drawn as a labelled em-dash', async () => {
    expect(isEmptyValue([]), 'CONTROL: [] is a floor member').toBe(true);

    const { container } = renderGallery();
    await waitFor(() => expect(screen.getByText('Populated card')).toBeInTheDocument());
    // CONTROL: the gallery really did render card fields.
    expect(
      screen.getAllByText('Alpha').length,
      'CONTROL: the populated card fields rendered',
    ).toBe(2);
    expect(screen.getByText('real note'), 'CONTROL: a populated text field renders').toBeInTheDocument();

    expect(
      container.querySelectorAll('[data-slot="empty-value"]').length,
      'a gallery card omits valueless fields; it must not draw the No-value affordance for []',
    ).toBe(0);
  });

  it('⛔ NOT FLATTENED — the gallery does NOT trim: a whitespace-only value is still drawn', async () => {
    expect(isEmptyValue('   '), 'CONTROL: the floor keeps whitespace a value').toBe(false);

    const { container } = renderGallery();
    await waitFor(() => expect(screen.getByText('Whitespace card')).toBeInTheDocument());

    // The whitespace value reaches TextCellRenderer and is drawn as stored.
    // If the gallery ever grew the trim, this card would lose the row and the
    // affordance count above would stop being a statement about `[]` alone.
    const truncated = Array.from(container.querySelectorAll('div,span')).filter(
      (el) => el.children.length === 0 && el.textContent === '   ',
    );
    expect(
      truncated.length,
      "a stored '   ' is a value on this surface — only record:details and RelatedList trim",
    ).toBeGreaterThan(0);
  });
});
