/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27520 (row 6) — the grid's default inline saves
 * check the record form's field rules before sending.
 *
 * Measured on the card: Tasks › Grid, Title cleared and Estimate set to -5
 * (`min: 0`), "Save All". The `PATCH` went out with -5 and came back refused.
 * Now a row whose edits break a declared rule is refused here, unsent, in the
 * shape the server refuses it in, so the table marks its cells and names its
 * reasons; the other rows still save.
 *
 * The real `ObjectGrid` and `data-table` over an in-memory data source whose
 * `update` persists.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: Object.assign(vi.fn(), toasts) };
});

import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { inlineEditRuleRefusals } from '../objectGridInlineRules';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
  for (const fn of Object.values(toasts)) fn.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OBJECT = 'task_27520';

const FIELDS = {
  id: { type: 'text' },
  title: { type: 'text', label: 'Title', required: true, maxLength: 20 },
  estimate_hours: { type: 'number', label: 'Estimate (h)', min: 0, max: 1000 },
};

function makeDataSource() {
  const store: Record<string, Record<string, unknown>> = {
    t1: { id: 't1', title: 'Ingest pipeline', estimate_hours: 60 },
    t2: { id: 't2', title: 'Warehouse schema', estimate_hours: 33 },
  };
  return {
    store,
    find: vi.fn(async () => {
      const data = Object.values(store).map((r) => ({ ...r }));
      return { data, total: data.length, hasMore: false, pageSize: 50 };
    }),
    update: vi.fn(async (_object: string, id: string, changes: Record<string, unknown>) => {
      store[id] = { ...store[id], ...changes };
      return { ...store[id] };
    }),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: FIELDS })),
  };
}

type GridProps = React.ComponentProps<typeof ObjectGrid>;

async function loaded(dataSource: ReturnType<typeof makeDataSource>) {
  const schema = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [
      { field: 'title', label: 'Title', editable: false },
      { field: 'estimate_hours', label: 'Estimate (h)', type: 'number' },
    ],
    pagination: { pageSize: 50 },
  } as GridProps['schema'];
  render(
    <ActionProvider>
      <ObjectGrid
        schema={schema}
        dataSource={dataSource as unknown as GridProps['dataSource']}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </ActionProvider>,
  );
  await waitFor(() => expect(screen.getByText('Ingest pipeline')).toBeInTheDocument());
}

const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;

async function editEstimate(title: string, from: string, to: string) {
  const td = await waitFor(() => {
    const cell = Array.from(rowOf(title).querySelectorAll('td')).find((c) => c.textContent?.trim() === from);
    if (!cell) throw new Error(`no ${from} cell on ${title}`);
    return cell as HTMLElement;
  });
  fireEvent.click(td);
  const input = await waitFor(() => {
    const el = td.querySelector('input') as HTMLInputElement | null;
    if (!el) throw new Error('editor not open');
    return el;
  });
  fireEvent.change(input, { target: { value: to } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(within(rowOf(title)).getByText(to)).toBeInTheDocument());
  return td;
}

describe('ObjectGrid default saves — a field rule is checked before sending (#27520)', () => {
  it('"Save All": the row below `min` is refused unsent, its cell marked; the other row saves', async () => {
    const ds = makeDataSource();
    await loaded(ds);
    const refusedCell = await editEstimate('Ingest pipeline', '60', '-5');
    await editEstimate('Warehouse schema', '33', '31');
    fireEvent.click(screen.getByRole('button', { name: /Save All/ }));

    await waitFor(() =>
      expect(screen.getByTestId('table-save-refusal')).toHaveTextContent('Estimate (h) must be at least 0'),
    );
    // Only the row that keeps every rule was sent.
    expect(ds.update).toHaveBeenCalledTimes(1);
    expect(ds.update).toHaveBeenCalledWith(OBJECT, 't2', { estimate_hours: 31 }, undefined);
    expect(ds.store.t1.estimate_hours).toBe(60);
    expect(refusedCell).toHaveAttribute('aria-invalid', 'true');
    expect(refusedCell).toHaveAttribute('data-cell-error', 'Estimate (h) must be at least 0');
    expect(toasts.success).toHaveBeenCalledWith('1 row saved');
  });

  it('the per-row save refuses the same edit unsent', async () => {
    const ds = makeDataSource();
    await loaded(ds);
    await editEstimate('Ingest pipeline', '60', '-7');
    fireEvent.click(within(rowOf('Ingest pipeline')).getByTitle('Save row'));

    await waitFor(() =>
      expect(screen.getByTestId('table-save-refusal')).toHaveTextContent('Estimate (h) must be at least 0'),
    );
    expect(ds.update).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('CONTROL — an edit inside the rules is sent as before', async () => {
    const ds = makeDataSource();
    await loaded(ds);
    await editEstimate('Ingest pipeline', '60', '0');
    fireEvent.click(screen.getByRole('button', { name: /Save All/ }));

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('table-save-refusal')).toBeNull();
  });
});

describe('inlineEditRuleRefusals — the record form’s rules, one entry per broken rule', () => {
  const t = (key: string, o?: Record<string, unknown>) => `${key}|${JSON.stringify(o ?? {})}`;
  const label = (f: string) => (FIELDS as Record<string, { label?: string }>)[f]?.label ?? f;

  it('names each broken rule with its field and the localized message', () => {
    expect(inlineEditRuleRefusals({ title: '', estimate_hours: -5 }, FIELDS, label, t)).toEqual([
      { field: 'title', code: 'required', message: 'validation.required|{"field":"Title"}' },
      { field: 'estimate_hours', code: 'min_value', message: 'validation.min|{"field":"Estimate (h)","min":0}' },
    ]);
  });

  it('reads a staged number string the way the server will read it, and judges length on text', () => {
    expect(inlineEditRuleRefusals({ estimate_hours: '-1' }, FIELDS, label, t).map((r) => r.code)).toEqual(['min_value']);
    expect(inlineEditRuleRefusals({ title: 'x'.repeat(21) }, FIELDS, label, t).map((r) => r.code)).toEqual(['max_length']);
  });

  it('judges nothing it has no declaration for, and passes values inside the rules', () => {
    expect(inlineEditRuleRefusals({ estimate_hours: 0, title: 'ok' }, FIELDS, label, t)).toEqual([]);
    expect(inlineEditRuleRefusals({ unknown: -5 }, FIELDS, label, t)).toEqual([]);
    expect(inlineEditRuleRefusals({ estimate_hours: -5 }, undefined, label, t)).toEqual([]);
  });

  it('an authored rule message wins over the localized default', () => {
    const fields = { qty: { type: 'number', label: 'Qty', min: 1, min_message: 'Order at least one.' } };
    expect(inlineEditRuleRefusals({ qty: 0 }, fields, label, t)).toEqual([
      { field: 'qty', code: 'min_value', message: 'Order at least one.' },
    ]);
  });
});
