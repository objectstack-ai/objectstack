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

/**
 * objectstack#37890 — the amount slot takes any column whose value draws as
 * money, not only a literal `currency` column: a formula declaring
 * `returnType: 'currency'` and a summary declaring its currency are amounts
 * too, so an order line's card shows the line total rather than the unit
 * price. Measured on the base tree with this fixture: with `unit_price` shown
 * first the slot read the unit price; with `total_price` first it still read
 * the unit price and the total fell into the subtitle; with no plain currency
 * column there was no slot at all.
 *
 * ── Directions on the base tree (measured before the fix) ────────────────
 *   formula total shown before the unit price → slot holds the total   RED
 *   formula total as the only money column → slot holds the total      RED
 *   currency summary as the only money column → slot holds it          RED
 *   control: a view that presents the formula as text → not promoted   GREEN
 *   control: a number-returning formula → not promoted                 GREEN
 */
describe('the phone card amount slot takes a formula or summary that draws as money (objectstack#37890)', () => {
  const LINE_OBJECT = 'order_line_37890';
  const LINE_FIELDS = {
    id: { type: 'text' },
    name: { type: 'text', label: 'Product' },
    quantity: { type: 'number', label: 'Quantity' },
    unit_price: { type: 'currency', label: 'Unit Price' },
    total_price: {
      type: 'formula',
      label: 'Total',
      returnType: 'currency',
      expression: 'record.quantity * record.unit_price * (1 - record.discount)',
    },
    line_weight: { type: 'formula', label: 'Weight', returnType: 'number', expression: 'record.quantity * 3' },
    lines_total: {
      type: 'summary',
      label: 'Lines Total',
      summaryOperations: { object: 'order_item', field: 'amount', function: 'sum' },
      currencyConfig: { currencyMode: 'dynamic' },
    },
  };
  const LINE_ROWS = [
    { id: 'l1', name: 'Admin Training Workshop', quantity: 2, unit_price: 6000, total_price: 10800, line_weight: 6, lines_total: 777 },
  ];

  async function lineCard(columns: unknown[]) {
    setWidth(390);
    const dataSource = {
      find: vi.fn(async () => ({ data: LINE_ROWS, total: LINE_ROWS.length, hasMore: false, pageSize: 50 })),
      getObjectSchema: async (name: string) => ({ name, nameField: 'name', fields: structuredClone(LINE_FIELDS) }),
    } as never;
    render(
      <LocalizationProvider value={{ currency: 'CNY', locale: 'en' }}>
        <ActionProvider>
          <SchemaRendererProvider dataSource={dataSource}>
            <ObjectGrid
              schema={{ type: 'object-grid', objectName: LINE_OBJECT, columns, pagination: { pageSize: 50 } } as never}
              dataSource={dataSource}
            />
          </SchemaRendererProvider>
        </ActionProvider>
      </LocalizationProvider>,
    );
    // The quantity column draws through the number cell once the field defs
    // arrive; the money cells below read the same defs.
    await waitFor(() => expect(screen.getByTestId('grid-card-subtitle').textContent).toMatch(/^2\b/));
    expect(document.querySelector('table'), 'the card layout, not the table').toBeNull();
    return cardOf('Admin Training Workshop');
  }
  const fields = (...names: string[]) => names.map((field) => ({ field }));

  it('takes a currency formula shown before the unit price: the card reads the line total', async () => {
    const card = await lineCard(fields('name', 'quantity', 'total_price', 'unit_price'));
    expect(within(card).getByTestId('grid-card-amount').textContent).toBe('CN¥10,800.00');
    expect(within(card).getByTestId('grid-card-subtitle').textContent).toBe('2 · CN¥6,000.00');
  });

  it('takes a currency formula that is the only money column', async () => {
    const card = await lineCard(fields('name', 'quantity', 'total_price'));
    expect(within(card).getByTestId('grid-card-amount').textContent).toBe('CN¥10,800.00');
    expect(within(card).getByTestId('grid-card-subtitle').textContent).toBe('2');
  });

  it('takes a summary that declares its currency', async () => {
    const card = await lineCard(fields('name', 'quantity', 'lines_total'));
    expect(within(card).getByTestId('grid-card-amount').textContent).toBe('CN¥777.00');
  });

  it('keeps the first money column in view order: a unit price shown first stays the amount', async () => {
    const card = await lineCard(fields('name', 'quantity', 'unit_price', 'total_price'));
    expect(within(card).getByTestId('grid-card-amount').textContent).toBe('CN¥6,000.00');
  });

  it('CONTROL: a number-returning formula is not an amount', async () => {
    const card = await lineCard(fields('name', 'quantity', 'line_weight'));
    expect(within(card).queryByTestId('grid-card-amount-line')).toBeNull();
    expect(within(card).getByTestId('grid-card-subtitle').textContent).toBe('2 · 6');
  });

  it('CONTROL: a view that presents the currency formula as text keeps it a plain value', async () => {
    const card = await lineCard([{ field: 'name' }, { field: 'quantity' }, { field: 'total_price', type: 'text' }]);
    expect(within(card).queryByTestId('grid-card-amount-line')).toBeNull();
  });
});

/**
 * objectstack#37891 — when the object declares `highlightFields` (ADR-0085,
 * "which fields matter most", in order), the phone card reads its amount and
 * subtitle from that list, not from the view's column order: the amount is
 * the first highlighted field that draws as money, the subtitle the next
 * three, in that order, empty values dropped, and a number, currency or
 * percent part carries its field label. A highlighted field no column shows
 * is drawn too, and the grid's fetch asks for it. An object that declares no
 * `highlightFields` keeps the column-order rule above.
 *
 * The fixture is HotCRM's order line (`crm_sales_order_line`), whose related
 * list shows `line_number, product_title, quantity, unit_price, discount,
 * total_price`: on the base tree its card read `1 · 2` with the unit price as
 * the amount, whatever `highlightFields` said.
 *
 * ── Directions on the base tree (measured by reverting the fix) ──────────
 *   amount is the highlighted total, not the unit price                RED
 *   subtitle is the labelled highlighted parts, in order               RED
 *   a text part is drawn bare                                          RED
 *   a highlighted field no column shows is drawn and fetched           RED
 *   an empty highlighted part is dropped                               RED
 *   control: a masked highlighted field is neither amount nor part     RED  (its amount half: the base tree shows the unit price)
 *   control: no highlightFields keeps `1 · 2`, unit price, no labels   GREEN
 */
describe('the phone card follows the object\'s highlightFields (objectstack#37891)', () => {
  const LINE_OBJECT = 'crm_sales_order_line_37891';
  const LINE_FIELDS = {
    id: { type: 'text' },
    product_title: { type: 'text', label: 'Product Title' },
    crm_product: { type: 'text', label: 'Product' },
    quantity: { type: 'number', label: 'Quantity', scale: 0 },
    unit_price: { type: 'currency', label: 'Sales Price' },
    discount: { type: 'percent', label: 'Discount %', scale: 2 },
    total_price: {
      type: 'formula',
      label: 'Total',
      returnType: 'currency',
      expression: 'record.quantity * record.unit_price * (1 - record.discount)',
    },
    line_number: { type: 'number', label: 'Line #', scale: 0 },
    access_pin: { type: 'password', label: 'Access PIN' },
  };
  const LINE_ROWS = [
    { id: 'l1', line_number: 1, product_title: 'Admin Training Workshop', crm_product: 'Training', quantity: 2, unit_price: 6000, discount: 0.1, total_price: 10800, access_pin: 's3cr3t-pin' },
    { id: 'l2', line_number: 2, product_title: 'AI Agent Seat (Annual)', crm_product: 'Seat', quantity: 10, unit_price: 1000, discount: null, total_price: 10000, access_pin: 's3cr3t-pin' },
  ];
  /** HotCRM's `relatedListColumns` for the order's lines. */
  const RELATED = ['line_number', 'product_title', 'quantity', 'unit_price', 'discount', 'total_price'];

  async function lineCards(columns: string[], highlightFields?: string[]) {
    setWidth(390);
    const find = vi.fn(async () => ({ data: LINE_ROWS, total: LINE_ROWS.length, hasMore: false, pageSize: 50 }));
    const dataSource = {
      find,
      getObjectSchema: async (name: string) => ({
        name,
        nameField: 'product_title',
        ...(highlightFields ? { highlightFields } : {}),
        fields: structuredClone(LINE_FIELDS),
      }),
    } as never;
    render(
      <LocalizationProvider value={{ currency: 'CNY', locale: 'en' }}>
        <ActionProvider>
          <SchemaRendererProvider dataSource={dataSource}>
            <ObjectGrid
              schema={{ type: 'object-grid', objectName: LINE_OBJECT, columns: columns.map((field) => ({ field })), pagination: { pageSize: 50 } } as never}
              dataSource={dataSource}
            />
          </SchemaRendererProvider>
        </ActionProvider>
      </LocalizationProvider>,
    );
    // The money cells read the field defs, so a CN¥ amount proves they landed.
    await waitFor(() => expect(cards()).toHaveLength(2));
    await waitFor(() => expect(document.body.textContent).toContain('CN¥'));
    expect(document.querySelector('table'), 'the card layout, not the table').toBeNull();
    return { find, first: cardOf('Admin Training Workshop'), second: cardOf('AI Agent Seat (Annual)') };
  }
  const parts = (card: HTMLElement) => within(card).getAllByTestId('grid-card-subtitle-part');
  const labels = (card: HTMLElement) =>
    within(card).queryAllByTestId('grid-card-subtitle-label').map((el) => el.textContent?.trim());

  it('takes the first highlighted money field as the amount: the line total, not the unit price the table shows first', async () => {
    const { first } = await lineCards(RELATED, ['total_price', 'quantity', 'unit_price', 'discount']);
    expect(within(first).getByTestId('grid-card-amount').textContent).toBe('CN¥10,800.00');
  });

  it('draws the next highlighted fields as the subtitle, in order, each figure under its field label', async () => {
    const { first } = await lineCards(RELATED, ['total_price', 'quantity', 'unit_price', 'discount']);
    expect(parts(first)).toHaveLength(3);
    expect(labels(first)).toEqual(['Quantity', 'Sales Price', 'Discount %']);
    const [quantity, price, discount] = parts(first).map((p) => p.textContent);
    expect(quantity).toBe('Quantity 2');
    expect(price).toBe('Sales Price CN¥6,000.00');
    expect(discount).toMatch(/^Discount % 10\.00\s?%$/);
    // The line number the table shows first is no longer a subtitle part.
    expect(within(first).getByTestId('grid-card-subtitle').textContent).not.toMatch(/^1 ·/);
  });

  it('labels only figures: a text part is drawn bare', async () => {
    const { first } = await lineCards(RELATED, ['total_price', 'crm_product', 'quantity']);
    expect(parts(first).map((p) => p.textContent)).toEqual(['Training', 'Quantity 2']);
    expect(labels(first)).toEqual(['Quantity']);
  });

  it('drops an empty highlighted part rather than drawing it', async () => {
    const { second } = await lineCards(RELATED, ['total_price', 'quantity', 'unit_price', 'discount']);
    expect(within(second).getByTestId('grid-card-amount').textContent).toBe('CN¥10,000.00');
    expect(labels(second)).toEqual(['Quantity', 'Sales Price']);
  });

  it('draws a highlighted field no column shows, and the fetch asks for it', async () => {
    const { first, find } = await lineCards(
      ['line_number', 'product_title', 'quantity', 'unit_price'],
      ['total_price', 'quantity', 'unit_price', 'discount'],
    );
    expect(within(first).getByTestId('grid-card-amount').textContent).toBe('CN¥10,800.00');
    expect(labels(first)).toEqual(['Quantity', 'Sales Price', 'Discount %']);
    const select = (find.mock.calls.at(-1) as unknown[] | undefined)?.[1] as { $select?: string[] } | undefined;
    expect(select?.$select).toEqual(expect.arrayContaining(['total_price', 'discount']));
  });

  it('CONTROL: an object with no highlightFields keeps the column-order card (line number · quantity, unit price, no labels)', async () => {
    const { first } = await lineCards(RELATED);
    expect(within(first).getByTestId('grid-card-subtitle').textContent).toBe('1 · 2');
    expect(within(first).getByTestId('grid-card-amount').textContent).toBe('CN¥6,000.00');
    expect(labels(first)).toEqual([]);
  });

  it('CONTROL: a masked highlighted field is neither the amount nor a subtitle part, and its value is never printed', async () => {
    const { first } = await lineCards(RELATED, ['access_pin', 'total_price', 'quantity']);
    expect(within(first).getByTestId('grid-card-amount').textContent).toBe('CN¥10,800.00');
    expect(labels(first)).toEqual(['Quantity']);
    expect(first.textContent).not.toContain('s3cr3t-pin');
  });
});
