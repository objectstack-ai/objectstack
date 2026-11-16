/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34197 — an action's parameter dialog is not a record form, so a
 * lookup param whose `lookupFilters` read `{ $record }` leaves that entry out,
 * even when a SIBLING param carries a value of the same name.
 *
 * The dialog hands every picker its own in-progress values as
 * `dependentValues` (objectui#8672 ruling A), and those values are not the
 * record a `{ $record: 'quote_date' }` path names. The picker resolves a
 * reference only on a field a record form stamped (`withRecordBeingEdited`);
 * `paramToField` builds the widget field from enumerated keys and stamps
 * nothing, so a param that writes `recordBeingEdited` itself is not let opt
 * in either. Driven through the real `ActionParamDialog`.
 *
 * CONTROL: the literal entry beside it reaches the candidate query, so the
 * dialog does forward `lookupFilters` — the missing entry is left out, not
 * lost with the rest.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ActionParamDef } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
// Module scope, per AGENTS.md 测试纪律: the picker sits behind `React.lazy`.
import '@object-ui/fields';
import { ActionParamDialog } from './ActionParamDialog';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn() as never;
});

const QUOTE_DATE: ActionParamDef = { name: 'quote_date', label: 'Quote date', type: 'text' };
const PRICE_BOOK: ActionParamDef = {
  name: 'price_book',
  label: 'Price Book',
  type: 'lookup',
  referenceTo: 'price_book',
  lookupFilters: [
    { field: 'is_active', operator: 'eq', value: true },
    { field: 'valid_from', operator: 'lte', value: { $record: 'quote_date' }, orEmpty: true },
  ],
} as ActionParamDef;

async function pickerQueries(priceBook: ActionParamDef) {
  const ds = {
    find: vi.fn(async () => ({ data: [{ id: 'b1', name: 'Standard 2026' }], total: 1 })),
    findOne: vi.fn(async () => null),
  };
  render(
    <SchemaRendererProvider dataSource={ds as never}>
      <ActionParamDialog state={{ open: true, params: [QUOTE_DATE, priceBook], resolve: () => {} }} onOpenChange={() => {}} />
    </SchemaRendererProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Quote date'), { target: { value: '2026-11-01' } });
  const trigger = await screen.findByTestId('lookup-trigger-price_book');
  await act(async () => {
    fireEvent.click(trigger);
  });
  const queries = () => ds.find.mock.calls.filter((c: any[]) => c[0] === 'price_book').map((c: any[]) => c[1]?.$filter);
  await waitFor(() => expect(queries().length).toBeGreaterThan(0));
  return { queries: queries(), ds };
}

describe('ActionParamDialog — a { $record } lookup filter is left out (objectstack#34197)', () => {
  it('a param that writes the record-form stamp itself gains nothing: the entry is still left out', async () => {
    const { queries, ds } = await pickerQueries({ ...PRICE_BOOK, recordBeingEdited: { hopObjects: {} } } as ActionParamDef);
    for (const filter of queries) expect(filter).toEqual({ is_active: true });
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  it('leaves the entry out although a sibling param holds a value of that name', async () => {
    const ds = {
      find: vi.fn(async () => ({ data: [{ id: 'b1', name: 'Standard 2026' }], total: 1 })),
      findOne: vi.fn(async () => null),
    };
    render(
      <SchemaRendererProvider dataSource={ds as never}>
        <ActionParamDialog state={{ open: true, params: [QUOTE_DATE, PRICE_BOOK], resolve: () => {} }} onOpenChange={() => {}} />
      </SchemaRendererProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Quote date'), { target: { value: '2026-11-01' } });

    const trigger = await screen.findByTestId('lookup-trigger-price_book');
    await act(async () => {
      fireEvent.click(trigger);
    });
    const queries = () => ds.find.mock.calls.filter((c: any[]) => c[0] === 'price_book').map((c: any[]) => c[1]?.$filter);
    await waitFor(() => expect(queries().length).toBeGreaterThan(0));
    for (const filter of queries()) expect(filter).toEqual({ is_active: true });
    expect(ds.findOne).not.toHaveBeenCalled();
  });
});
