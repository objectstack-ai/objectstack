/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34615 — on a phone the list card's AMOUNT is drawn whole. The
 * card's amount is its first shown body column whose field type is
 * `currency`. It does not take a subtitle slot (where it split the width with
 * the account name and both were truncated); it sits on a line of its own
 * under the subtitle, at the right edge, `shrink-0` and never truncated, and
 * the status chip moves to that line's left.
 *
 * Pinned at 375 px. jsdom has no layout engine, so "drawn whole" is pinned as
 * the full formatted text in the amount slot plus no truncating box between
 * that slot and the card; the geometry itself was measured once in Chromium
 * on the pull request.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   amount slot exists, holds the full amount       RED  (no slot; in subtitle)
 *   subtitle carries no amount                      RED
 *   status chip on the amount line, left of it      RED  (card's last child)
 *   control: no currency column keeps the old row   GREEN
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, waitFor, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { LocalizationProvider } from '@object-ui/i18n';
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

const OBJECT = 'crm_opportunity_34615';

const FIELDS = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Opportunity' },
  account: { type: 'text', label: 'Account' },
  amount: { type: 'currency', label: 'Amount' },
  stage: {
    type: 'select',
    label: 'Stage',
    options: [
      { value: 'negotiation', label: 'Negotiation' },
      { value: 'proposal', label: 'Proposal' },
    ],
  },
  next_step: { type: 'text', label: 'Next Step' },
};

const ROWS = [
  { id: 'o1', name: 'Wayne Enterprise License', account: 'Wayne Enterprises', amount: 1200000, stage: 'negotiation', next_step: 'Sign by 11-27' },
  { id: 'o2', name: 'Acme Platform Upgrade', account: 'Acme Corporation', amount: null, stage: 'proposal', next_step: 'Demo' },
];

/** The amount sits between the subtitle's columns, as a real list view puts it. */
const COLUMNS = ['name', 'account', 'amount', 'stage', 'next_step'].map((field) => ({ field }));

function renderGrid(columns: unknown[] = COLUMNS) {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({ name, nameField: 'name', fields: structuredClone(FIELDS) }),
  } as never;
  return render(
    <LocalizationProvider value={{ currency: 'CNY', locale: 'en' }}>
      <ActionProvider>
        <SchemaRendererProvider dataSource={dataSource}>
          <ObjectGrid
            schema={{ type: 'object-grid', objectName: OBJECT, columns, pagination: { pageSize: 50 } } as never}
            dataSource={dataSource}
          />
        </SchemaRendererProvider>
      </ActionProvider>
    </LocalizationProvider>,
  );
}

const cards = () => [...document.querySelectorAll('[data-testid="grid-mobile-card"]')] as HTMLElement[];
const cardOf = (title: string) =>
  cards().find((card) => within(card).queryByTestId('grid-card-title')?.textContent === title)!;

async function phoneCards(columns?: unknown[]) {
  setWidth(375);
  renderGrid(columns);
  // The status chip reads its label off the object schema, so it proves the
  // field defs (and with them the `currency` type) have arrived.
  await waitFor(() => expect(screen.getByText('Negotiation')).toBeInTheDocument());
  expect(document.querySelector('table'), 'the card layout, not the table').toBeNull();
}

describe('the phone list card draws its amount whole, on a line of its own (objectstack#34615)', () => {
  it('draws the full amount in its own slot, with no truncating box between it and the card', async () => {
    await phoneCards();
    const card = cardOf('Wayne Enterprise License');
    const amount = within(card).getByTestId('grid-card-amount');
    expect(amount.textContent).toBe('CN¥1,200,000.00');
    expect(amount).toHaveClass('shrink-0', 'whitespace-nowrap');
    for (let el: HTMLElement | null = amount; el && el !== card; el = el.parentElement) {
      expect(el.className, `no truncation on ${el.dataset.testid ?? el.tagName}`).not.toMatch(/\btruncate\b|\boverflow-hidden\b/);
    }
  });

  it('keeps the amount out of the subtitle, which takes the next shown column instead', async () => {
    await phoneCards();
    const card = cardOf('Wayne Enterprise License');
    expect(within(card).getByTestId('grid-card-subtitle').textContent).toBe('Wayne Enterprises · Sign by 11-27');
    expect(within(card).getByTestId('grid-card-subtitle')).not.toContainElement(within(card).getByTestId('grid-card-amount'));
  });

  it('puts the status chip at the left of the amount line, not beside the title block', async () => {
    await phoneCards();
    const card = cardOf('Wayne Enterprise License');
    const line = within(card).getByTestId('grid-card-amount-line');
    const chips = within(card).getAllByTestId('grid-card-status');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe('Negotiation');
    expect([...line.children]).toEqual([chips[0], within(card).getByTestId('grid-card-amount')]);
  });

  it('a row with no amount keeps the same shape: the chip still on the amount line, no amount slot', async () => {
    await phoneCards();
    const card = cardOf('Acme Platform Upgrade');
    expect(within(card).queryByTestId('grid-card-amount')).toBeNull();
    expect(within(card).getByTestId('grid-card-amount-line')).toContainElement(within(card).getByTestId('grid-card-status'));
  });

  it('CONTROL: a view with no currency column keeps the objectstack#28484 row (chip at the right, no amount line)', async () => {
    await phoneCards(['name', 'account', 'stage', 'next_step'].map((field) => ({ field })));
    const card = cardOf('Wayne Enterprise License');
    expect(within(card).queryByTestId('grid-card-amount-line')).toBeNull();
    expect(card.lastElementChild).toBe(within(card).getByTestId('grid-card-status'));
    expect(within(card).getByTestId('grid-card-subtitle').textContent).toBe('Wayne Enterprises · Sign by 11-27');
  });
});
