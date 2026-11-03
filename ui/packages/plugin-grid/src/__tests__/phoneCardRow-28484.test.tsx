/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28484 — a phone's list card row is the board's list row: the
 * declared name field as the title, ONE subtitle line joining the first two
 * shown non-status columns' display values with 「 · 」 (a masked or empty
 * value skipped), ONE status chip at the right, and no per-column label lines.
 *
 * The status chip is the object's status field as `detectStatusField` names
 * it, drawn through that column's own desktop cell (the option's label, never
 * the stored value). Pinned at 390 px; the control at 768 px still draws the
 * table and no card.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';

beforeAll(() => {
  registerAllFields();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
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

const OBJECT = 'crm_lead_28484';

const FIELDS = {
  id: { type: 'text' },
  owner: { type: 'text', label: 'Owner' },
  full_name: { type: 'text', label: 'Name' },
  company: { type: 'text', label: 'Company' },
  status: {
    type: 'select',
    label: 'Status',
    options: [
      { value: 'new', label: 'New Lead' },
      { value: 'working', label: 'Working' },
    ],
  },
  title: { type: 'text', label: 'Job Title' },
  source: { type: 'text', label: 'Source' },
  api_key: { type: 'password', label: 'API Key' },
};

const LEADS = [
  { id: 'l1', owner: 'Dev Admin', full_name: 'Ada Lovelace', company: 'Atlas Construction', status: 'new', title: 'Director of Sales', source: 'Web', api_key: 'RAW-KEY-28484' },
  { id: 'l2', owner: 'Dev Admin', full_name: 'Alan Turing', company: '', status: 'working', title: 'CTO', source: 'Referral', api_key: 'RAW-KEY-28484' },
];

/** Owner leads the view, status sits between the subtitle columns, then more. */
const COLUMNS = ['owner', 'company', 'status', 'title', 'source'].map((field) => ({ field }));

function renderGrid(opts: { columns?: unknown[]; onRowClick?: (row: unknown) => void } = {}) {
  const dataSource = {
    find: vi.fn(async () => ({ data: LEADS, total: LEADS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({ name, nameField: 'full_name', fields: structuredClone(FIELDS) }),
  } as never;
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: OBJECT,
            columns: opts.columns ?? COLUMNS,
            pagination: { pageSize: 50 },
          } as never}
          dataSource={dataSource}
          onRowClick={opts.onRowClick}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

const cards = () => [...document.querySelectorAll('[data-testid="grid-mobile-card"]')] as HTMLElement[];
const cardOf = (title: string) =>
  cards().find((card) => within(card).queryByTestId('grid-card-title')?.textContent === title)!;
const subtitleOf = (card: HTMLElement) => within(card).queryByTestId('grid-card-subtitle')?.textContent ?? null;

async function phoneCards() {
  setWidth(390);
  renderGrid();
  // The status chip reads its label off the object schema, so it proves the
  // field defs have arrived.
  await waitFor(() => expect(screen.getByText('New Lead')).toBeInTheDocument());
}

describe('the phone list card row: title, one subtitle line, one status chip (objectstack#28484)', () => {
  it('titles the card by the declared name field and joins the first two non-status columns on one subtitle line', async () => {
    await phoneCards();
    expect(document.querySelector('table'), 'the card layout, not the table').toBeNull();
    expect(cards()).toHaveLength(2);
    const ada = cardOf('Ada Lovelace');
    // Owner and Company are the first two shown columns that are neither the
    // title nor the status field; Job Title and Source are not drawn.
    expect(subtitleOf(ada)).toBe('Dev Admin · Atlas Construction');
    expect(within(ada).queryByText('Director of Sales')).toBeNull();
    expect(within(ada).queryByText('Web')).toBeNull();
  });

  it('draws one status chip at the right, through the status column\'s own cell', async () => {
    await phoneCards();
    const ada = cardOf('Ada Lovelace');
    const chips = within(ada).getAllByTestId('grid-card-status');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe('New Lead');
    // The chip is the card's last child: it sits to the right of the text.
    expect(ada.lastElementChild).toBe(chips[0]);
    expect(within(ada).queryByText('new'), 'the stored value never reaches the reader').toBeNull();
    expect(within(cardOf('Alan Turing')).getByTestId('grid-card-status').textContent).toBe('Working');
  });

  it('draws no per-column label lines', async () => {
    await phoneCards();
    for (const label of ['Owner', 'Company', 'Status', 'Job Title', 'Source']) {
      expect(screen.queryByText(label), `no "${label}" label line`).toBeNull();
    }
  });

  it('skips an empty subtitle value rather than drawing a separator or a placeholder', async () => {
    await phoneCards();
    expect(subtitleOf(cardOf('Alan Turing'))).toBe('Dev Admin');
  });

  it('skips a masked subtitle value: the raw value is nowhere on the card', async () => {
    setWidth(390);
    renderGrid({ columns: ['api_key', 'company', 'status'].map((field) => ({ field })) });
    await waitFor(() => expect(screen.getByText('New Lead')).toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain('RAW-KEY-28484');
    expect(subtitleOf(cardOf('Ada Lovelace'))).toBe('Atlas Construction');
  });

  it('a row tap still hands the row to the host\'s onRowClick', async () => {
    setWidth(390);
    const onRowClick = vi.fn();
    renderGrid({ onRowClick });
    await waitFor(() => expect(screen.getByText('New Lead')).toBeInTheDocument());
    fireEvent.click(within(cardOf('Alan Turing')).getByTestId('grid-card-subtitle'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'l2', full_name: 'Alan Turing' });
  });

  it('CONTROL: at 768 px the same view still draws the table and no card', async () => {
    setWidth(768);
    renderGrid();
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(2));
    expect(cards()).toHaveLength(0);
    expect(screen.getAllByText('Atlas Construction').length).toBeGreaterThan(0);
  });
});
