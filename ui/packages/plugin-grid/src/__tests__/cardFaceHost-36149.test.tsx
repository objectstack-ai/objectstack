/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36149 — a host whose box is a phone's width on a desktop window
 * (the side preview's child tab) asks for the phone's card rows with the
 * `cardFace` host prop: one row per record, its title and one summary line,
 * at any window width.
 *
 * Control: without `cardFace` a desktop window keeps the table, and a phone's
 * window keeps its cards.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;
function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: px });
}

afterEach(() => {
  cleanup();
  setWidth(ORIGINAL_INNER_WIDTH);
});

const ROWS = [
  { id: 'r1', name: 'Call Ada', subject: 'Renewal', notes: 'Monday' },
  { id: 'r2', name: 'Email Alan', subject: 'Pricing', notes: 'Friday' },
];

function renderGrid({ width, cardFace }: { width: number; cardFace?: boolean }) {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      nameField: 'name',
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        subject: { type: 'text', label: 'Subject' },
        notes: { type: 'text', label: 'Notes' },
      },
    }),
  } as any;
  const schema: any = {
    type: 'object-grid',
    objectName: 'activity',
    columns: [{ field: 'name' }, { field: 'subject' }, { field: 'notes' }],
    pagination: { pageSize: 50 },
  };
  setWidth(width);
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid schema={schema} dataSource={dataSource} {...(cardFace ? { cardFace } : {})} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

describe('the cardFace host prop draws the phone card rows at any width (objectstack#36149)', () => {
  it('a desktop window with cardFace: one card row per record, its title and one summary line', async () => {
    renderGrid({ width: 1440, cardFace: true });
    const titles = await screen.findAllByTestId('grid-card-title');
    expect(titles.map((el) => el.textContent)).toEqual(['Call Ada', 'Email Alan']);
    const subtitles = screen.getAllByTestId('grid-card-subtitle');
    expect(subtitles.map((el) => el.textContent)).toEqual(['Renewal · Monday', 'Pricing · Friday']);
    expect(screen.queryByRole('columnheader', { name: /Subject/ })).toBeNull();
  });

  it('CONTROL: a desktop window without cardFace keeps the table', async () => {
    renderGrid({ width: 1440 });
    await waitFor(() => expect(screen.getAllByText('Call Ada').length).toBeGreaterThan(0));
    expect(screen.queryAllByTestId('grid-card-title')).toHaveLength(0);
  });

  it('CONTROL: a phone window without cardFace keeps its cards', async () => {
    renderGrid({ width: 390 });
    const titles = await screen.findAllByTestId('grid-card-title');
    expect(titles).toHaveLength(2);
  });
});
