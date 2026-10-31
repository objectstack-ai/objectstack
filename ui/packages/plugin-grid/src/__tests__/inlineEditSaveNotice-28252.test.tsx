/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#28252 — the grid's inline-edit saves carry the
 * write answer's `notice` (the message a hook set,
 * objectstack-ai/objectstack#28000) on their own save toast, so the write is
 * one toast: the per-row save and "Save All" claim their rows' answer
 * feedback, and the write-warning channel raises none of its own.
 *
 * The channel is stood in for by its own door, `parkAnswerWarnings` from
 * `@object-ui/react`, called synchronously inside the write as the adapter's
 * write-warning event is; `channelToast` is the toast the channel would show.
 *
 * Direction, written before the run: with the grid's claims removed, every
 * "one toast" row RED (the channel toasts the notice, the save toast carries
 * no notice line); the CONTROL row GREEN on both sides.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// The `toast` this grid raises is `@object-ui/components`' re-export of
// sonner's. `plugin-grid` does not depend on `sonner`, so a bare
// `vi.mock('sonner')` here would register against an id nothing in this
// package resolves to (the trap `WizardForm.outcomeToastSupersede.test.tsx`
// measured); the components entry is the module the grid imports it from.
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: Object.assign(vi.fn(), toasts) };
});

import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, parkAnswerWarnings } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';

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

const OBJECT = 'task_28252';
const NOTICE = 'Sent to your manager for approval';

/**
 * An in-memory data source whose writes answer `notice` (and, for the ids in
 * `warned`, a warning), announced the way the adapter's write-warning event
 * is: inside the write, before its promise settles.
 */
function makeDataSource(channelToast: (line: string) => void, warned: Set<string> = new Set()) {
  const store: Record<string, Record<string, unknown>> = {
    t1: { id: 't1', title: 'Ingest pipeline', estimate_hours: 60 },
    t2: { id: 't2', title: 'Warehouse schema', estimate_hours: 33 },
  };
  const ds = {
    store,
    find: vi.fn(async () => {
      const data = Object.values(store).map((r) => ({ ...r }));
      return { data, total: data.length, hasMore: false, pageSize: 50 };
    }),
    update: vi.fn(async (object: string, id: string, changes: Record<string, unknown>) => {
      store[id] = { ...store[id], ...changes };
      const ev = {
        operation: 'update' as const,
        resource: object,
        id,
        notice: NOTICE,
        ...(warned.has(id) ? { warnings: [{ message: `Estimate is high on ${id}` }] } : {}),
      };
      if (!parkAnswerWarnings(ds, ev, () => channelToast(NOTICE))) channelToast(NOTICE);
      return { ...store[id] };
    }),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        title: { type: 'text', label: 'Title' },
        estimate_hours: { type: 'number', label: 'Estimate' },
      },
    })),
  };
  return ds;
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
      { field: 'estimate_hours', label: 'Estimate', type: 'number' },
    ],
    pagination: { pageSize: 50 },
  } as GridProps['schema'];
  render(
    <ActionProvider>
      {/* Row Edit/Delete handlers: the per-row save button exists. */}
      <ObjectGrid
        schema={schema}
        // The in-memory double implements the three members the default saves read.
        dataSource={dataSource as unknown as GridProps['dataSource']}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </ActionProvider>,
  );
  await waitFor(() => expect(screen.getByText('Ingest pipeline')).toBeInTheDocument());
}

const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;

/** Stage a new Estimate on the row titled `title`, the way a user types it. */
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
}

const clickSaveAll = () => fireEvent.click(screen.getByRole('button', { name: /Save All/ }));

describe('ObjectGrid inline-edit saves carry the hook notice (objectstack-ai/objectstack#28252)', () => {
  it('the per-row save: one success toast, the notice under "1 row saved"; the channel shows nothing', async () => {
    const channelToast = vi.fn();
    const ds = makeDataSource(channelToast);
    await loaded(ds);
    await editEstimate('Ingest pipeline', '60', '61');
    fireEvent.click(within(rowOf('Ingest pipeline')).getByTitle('Save row'));

    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    expect(toasts.success).toHaveBeenCalledWith('1 row saved', { description: NOTICE });
    expect(toasts.warning).not.toHaveBeenCalled();
    expect(channelToast).not.toHaveBeenCalled();
  });

  it('"Save All" over two rows: one toast, the shared notice once, the warning lines under it', async () => {
    const channelToast = vi.fn();
    const ds = makeDataSource(channelToast, new Set(['t2']));
    await loaded(ds);
    await editEstimate('Ingest pipeline', '60', '61');
    await editEstimate('Warehouse schema', '33', '31');
    clickSaveAll();

    await waitFor(() => expect(toasts.warning).toHaveBeenCalledTimes(1));
    expect(toasts.warning).toHaveBeenCalledWith('2 rows saved', { description: `${NOTICE}\nEstimate is high on t2` });
    expect(toasts.success).not.toHaveBeenCalled();
    expect(channelToast).not.toHaveBeenCalled();
  });

  it('CONTROL: a write the grid did not make keeps the channel toast once the save is over', async () => {
    const channelToast = vi.fn();
    const ds = makeDataSource(channelToast);
    await loaded(ds);
    await editEstimate('Ingest pipeline', '60', '61');
    fireEvent.click(within(rowOf('Ingest pipeline')).getByTitle('Save row'));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));

    await ds.update(OBJECT, 't1', { estimate_hours: 62 });
    expect(channelToast).toHaveBeenCalledTimes(1);
  });
});
