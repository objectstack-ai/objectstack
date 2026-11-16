/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A record form names, on a lookup it draws, the object each `{ $record }`
 * hop of its `lookupFilters` points at (`withRecordHopObjects`), so the
 * picker reads `account.cb_market` for the account id the form holds. Both
 * field builders stamp it: the auto-layout `ObjectForm` and the authored
 * sections (`buildSectionFields`, through `ModalForm`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { ObjectForm } from '../ObjectForm';
import { ModalForm } from '../ModalForm';

registerAllFields();
afterEach(cleanup);

const QUOTE = {
  name: 'quote',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    quote_date: { type: 'date', label: 'Quote date' },
    account: { type: 'lookup', label: 'Account', reference: 'account' },
    price_book: {
      type: 'lookup',
      label: 'Price Book',
      reference: 'price_book',
      lookupFilters: [
        { field: 'valid_from', operator: 'lte', value: { $record: 'quote_date' }, orEmpty: true },
        { field: 'cb_market', operator: 'eq', value: { $record: 'account.cb_market' }, orEmpty: true },
      ],
    },
  },
};
const ROW = { id: 'q1', subject: 'Q', quote_date: '2026-11-01', account: 'a1', price_book: null };

function dataSource() {
  const priceBookFilters: unknown[] = [];
  const ds = {
    getObjectSchema: async (name: string) => (name === 'quote' ? QUOTE : { name, fields: { name: { type: 'text' } } }),
    findOne: async (object: string) => (object === 'account' ? { id: 'a1', name: 'Acme', cb_market: 'm9' } : ROW),
    find: async (object: string, params: any) => {
      if (object === 'price_book') priceBookFilters.push(params?.$filter);
      return { data: [], total: 0 };
    },
    create: async () => ROW,
    update: async () => ROW,
  };
  return { ds, priceBookFilters };
}

const EXPECTED = {
  $and: [
    { $or: [{ valid_from: { $lte: '2026-11-01' } }, { valid_from: { $null: true } }] },
    { $or: [{ cb_market: 'm9' }, { cb_market: { $null: true } }] },
  ],
};

async function openPriceBook() {
  let trigger: HTMLElement | null = null;
  await waitFor(() => {
    trigger = document.querySelector('[data-testid="lookup-trigger-price_book"]');
    if (!trigger) throw new Error('form not ready');
  }, { timeout: 5000 });
  await act(async () => {
    fireEvent.click(trigger!);
  });
}

describe('record forms name the object a { $record } hop reads (#34197)', () => {
  it('auto-layout ObjectForm: the picker queries with the hop value read for the account the form holds', async () => {
    const { ds, priceBookFilters } = dataSource();
    render(
      <SchemaRendererProvider dataSource={ds as any}>
        <ObjectForm schema={{ type: 'object-form', objectName: 'quote', mode: 'edit', recordId: 'q1' } as any} dataSource={ds as any} />
      </SchemaRendererProvider>,
    );
    await openPriceBook();
    await waitFor(() => expect(priceBookFilters.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(priceBookFilters).toEqual([EXPECTED]);
  });

  it('authored sections (ModalForm): the same hop value reaches the query', async () => {
    const { ds, priceBookFilters } = dataSource();
    render(
      <SchemaRendererProvider dataSource={ds as any}>
        <ModalForm
          schema={{
            type: 'object-form', objectName: 'quote', mode: 'edit', recordId: 'q1', formType: 'modal', open: true,
            sections: [{ label: 'S', fields: ['subject', 'quote_date', 'account', 'price_book'] }],
          } as any}
          dataSource={ds as any}
        />
      </SchemaRendererProvider>,
    );
    await openPriceBook();
    await waitFor(() => expect(priceBookFilters.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(priceBookFilters).toEqual([EXPECTED]);
  });
});
