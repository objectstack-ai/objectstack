/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A record made through the picker's quick-create is selected only when the
 * picker could have offered it (objectstack#36865, half 2).
 *
 * ## The defect
 *
 * The create form takes whatever the user enters, so the record it returns can
 * fail the field's `lookupFilters` — measured in an expense app: the field asks
 * for an `approved` request, the form saves a `draft`. The picker selected it
 * anyway; the action that read the field then refused the run.
 *
 * ## What holds it now
 *
 * The new id is re-read through the picker's own filter (the field's
 * `lookupFilters` merged with the id), the same query the recents rail sends,
 * so the server decides. Absent from the answer: the record is not selected,
 * and the picker reopens with a line saying why, in the slot a failed create
 * already uses.
 *
 * ## The rows
 *
 * - modal create, the record fails the filters: not selected, the line shows;
 * - CONTROL, modal create, the record passes: selected, no line;
 * - the one-field inline create (no modal host) is held the same way;
 * - the re-read carries the field's filter AND the new id;
 * - CONTROL, a field with no filter selects without a re-read.
 */
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ActionProvider } from '@object-ui/react';
import { LookupField } from './LookupField';

afterEach(cleanup);

const TARGET = 'crm_expense_request';
const OUTSIDE = "The record was created, but it does not match this field's filters, so it cannot be chosen here.";

const filteredField = {
  name: 'crm_expense_request',
  label: 'Travel Request',
  reference: TARGET,
  reference_field: 'name',
  lookupFilters: [{ field: 'status', operator: 'eq', value: 'approved' }],
} as any;

/**
 * The server, as the picker sees it: a query answers the rows of `table` its
 * `$filter` admits. The picker sends either an object filter (field equality,
 * bare or `$eq`) or a filter AST (`['and', …]`, `[field, '=', value]`, a list
 * of conditions); equality under any nesting is all these rows need.
 */
function admits(row: Record<string, unknown>, filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return true;
  if (Array.isArray(filter)) {
    const [head, ...rest] = filter as unknown[];
    if (head === 'and') return rest.every((part) => admits(row, part));
    if (head === 'or') return rest.some((part) => admits(row, part));
    if (typeof head === 'string' && filter.length === 3) {
      const [, op, value] = filter as [string, string, unknown];
      if (op === '=' || op === '==' || op === 'eq') return row[head] === value;
      if (op === 'in') return Array.isArray(value) && value.includes(row[head]);
      throw new Error(`test server: unhandled operator ${op}`);
    }
    return (filter as unknown[]).every((part) => admits(row, part));
  }
  return Object.entries(filter as Record<string, unknown>).every(([key, cond]) => {
    if (key === '$and' && Array.isArray(cond)) return cond.every((part) => admits(row, part));
    const want = cond && typeof cond === 'object' && '$eq' in (cond as object) ? (cond as any).$eq : cond;
    return row[key] === want;
  });
}

/** Open the picker, type a name nothing matches, and quick-create `created`. */
async function quickCreate(opts: { field?: any; created: Record<string, unknown>; modal: boolean }) {
  const table: Array<Record<string, unknown>> = [];
  const ds = {
    find: vi.fn(async (_object: string, params: any) => {
      const data = table.filter((r) => admits(r, params?.$filter));
      return { data, total: data.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(async () => {
      table.push(opts.created);
      return opts.created;
    }),
    update: vi.fn(),
    delete: vi.fn(),
  };
  // The console's create-modal host: the user saved `created` in the form.
  const onModal = vi.fn(async () => {
    table.push(opts.created);
    return { success: true, data: opts.created };
  });
  const onChange = vi.fn();
  const widget = (
    <LookupField field={opts.field ?? filteredField} value={undefined} onChange={onChange} readonly={false} dataSource={ds as any} />
  );
  render(opts.modal ? <ActionProvider onModal={onModal as any}>{widget}</ActionProvider> : widget);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Select/i }));
  });
  const input = await screen.findByRole('combobox');
  await act(async () => {
    fireEvent.change(input, { target: { value: 'Trip' } });
  });
  await act(async () => {
    fireEvent.click(await screen.findByText('Create new "Trip"'));
  });
  return { ds, onChange, onModal };
}

describe('LookupField selects a quick-created record only when the field\'s filters admit it (objectstack#36865)', () => {
  it('modal create, the record fails the filters: not selected, and the picker says why', async () => {
    const { onChange, onModal } = await quickCreate({
      modal: true,
      created: { id: 'req_draft', name: 'Trip', status: 'draft' },
    });
    await waitFor(() => expect(onModal).toHaveBeenCalled());
    expect(await screen.findByText(OUTSIDE)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('CONTROL — modal create, the record passes the filters: selected, and no line', async () => {
    const { onChange } = await quickCreate({
      modal: true,
      created: { id: 'req_ok', name: 'Trip', status: 'approved' },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('req_ok'));
    expect(screen.queryByText(OUTSIDE)).toBeNull();
  });

  it('the one-field inline create (no modal host) is held the same way', async () => {
    const { ds, onChange } = await quickCreate({
      modal: false,
      created: { id: 'req_draft', name: 'Trip', status: 'draft' },
    });
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(await screen.findByText(OUTSIDE)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the re-read asks for the new id under the field\'s own filter', async () => {
    const { ds, onModal } = await quickCreate({
      modal: true,
      created: { id: 'req_draft', name: 'Trip', status: 'draft' },
    });
    await waitFor(() => expect(onModal).toHaveBeenCalled());
    await screen.findByText(OUTSIDE);
    const reRead = ds.find.mock.calls.find(([, p]: any[]) => JSON.stringify(p?.$filter ?? {}).includes('req_draft'));
    expect(reRead).toBeDefined();
    const filterText = JSON.stringify(reRead![1].$filter);
    expect(filterText).toContain('approved');
    expect(filterText).toContain('req_draft');
  });

  it('CONTROL — a field with no filter selects the created record without a re-read', async () => {
    const { lookupFilters: _f, ...plain } = filteredField;
    const { ds, onChange } = await quickCreate({
      modal: true,
      field: plain,
      created: { id: 'req_draft', name: 'Trip', status: 'draft' },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('req_draft'));
    expect(ds.find.mock.calls.some(([, p]: any[]) => JSON.stringify(p?.$filter ?? {}).includes('req_draft'))).toBe(false);
  });
});
