/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list cell's state-machine confirm names the flows the move would start
 * (objectstack#35928, ruling record 7073655354), read through
 * `@object-ui/plugin-detail`'s `useRecordUpdateStarts` — the reader the record
 * page's stage confirm shares.
 *
 *   1. List: the confirm asks `POST /api/v1/automation/_record-starts` for
 *      the row's record and the move, and names each flow it answers by label
 *      under today's sentence, a flow holding an approval marked as such.
 *   2. Empty: an answer of no flows draws no list; the sentence stands alone.
 *   3. Failure: a refused read draws no list; the sentence stands alone, and
 *      the move still saves on Change.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { __resetApprovalsServiceLatch } from '../hooks/useRowApprovalLocks';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'deal';
const SENTENCE = 'Stage changes from New to Won. Saving may trigger related automation.';
const CLOSURE = { name: 'deal_won', label: 'Deal Won Sign-off', startsApproval: true };
const NOTIFY = { name: 'deal_notify', label: 'Notify Owner', startsApproval: false };

type StartsAnswer = { status: number; body: unknown };

/**
 * The global `fetch`: the explain probe answers permissively (as
 * `explainDouble` does), `_record-starts` answers `starts`; every call is
 * recorded so the request the confirm sends can be read back.
 */
function installFetch(starts: StartsAnswer) {
  const calls: Array<{ url: string; body: any }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/automation/_record-starts')) {
      return { ok: starts.status < 400, status: starts.status, json: async () => starts.body };
    }
    const recordIds = Array.isArray(body?.recordIds) ? body.recordIds : undefined;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        allowed: true,
        layers: [],
        ...(recordIds ? { records: recordIds.map((id: string) => ({ recordId: id, visible: true })) } : {}),
        ...(typeof body?.recordId === 'string' ? { record: { visible: true } } : {}),
      }),
    };
  }));
  return calls;
}

function makeDataSource() {
  const store: Record<string, any> = {
    d1: { id: 'd1', name: 'alpha', stage: 'new', updated_at: '2026-11-20T10:00:00.000Z' },
    d2: { id: 'd2', name: 'beta', stage: 'qualified', updated_at: '2026-11-20T10:00:00.000Z' },
  };
  return {
    store,
    find: vi.fn(async () => {
      const data = Object.values(store).map((r) => ({ ...r }));
      return { data, total: data.length, hasMore: false, pageSize: 50 };
    }),
    update: vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
      store[id] = { ...store[id], ...changes, updated_at: '2026-11-20T11:00:00.000Z' };
      return { ...store[id] };
    }),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        stage: {
          type: 'select',
          label: 'Stage',
          options: [
            { value: 'new', label: 'New' },
            { value: 'qualified', label: 'Qualified' },
            { value: 'won', label: 'Won' },
          ],
        },
        updated_at: { type: 'datetime' },
      },
      validations: [{
        name: 'stage_flow',
        type: 'state_machine',
        field: 'stage',
        transitions: { new: ['qualified', 'won'], qualified: ['won'] },
      }],
    }),
  } as any;
}

function renderGrid(ds: any) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'stage', label: 'Stage' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds} cellSelection />
    </ActionProvider>,
  );
}

const dataCell = (container: HTMLElement, row: number, text: string) =>
  Array.from(container.querySelectorAll('tbody tr')[row].querySelectorAll<HTMLElement>('td'))
    .find((td) => td.textContent === text)!;

/** Paste `Won` into the first row's stage cell and wait for the confirm. */
async function moveFirstRowToWon(container: HTMLElement): Promise<HTMLElement> {
  fireEvent.click(dataCell(container, 0, 'New'));
  const catcher = container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
  fireEvent.paste(catcher, { clipboardData: { getData: () => 'Won' } });
  return screen.findByRole('alertdialog');
}

const startsCalls = (calls: Array<{ url: string; body: any }>) =>
  calls.filter((c) => c.url.endsWith('/automation/_record-starts'));

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  __resetApprovalsServiceLatch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ObjectGrid — the state-machine confirm names the flows the move starts (objectstack#35928)', () => {
  it('list: asks for the row and the move, and names each flow under the sentence, approval marked', async () => {
    const calls = installFetch({ status: 200, body: { success: true, data: { flows: [CLOSURE, NOTIFY] } } });
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await screen.findByText('beta');
    const dialog = await moveFirstRowToWon(container);

    const list = await within(dialog).findByTestId('stage-change-starts');
    expect(dialog).toHaveTextContent(SENTENCE);
    expect(list).toHaveTextContent('Saving this change starts these flows:');
    const closure = list.querySelector('[data-stage-change-start="deal_won"]')!;
    const notify = list.querySelector('[data-stage-change-start="deal_notify"]')!;
    expect(closure).toHaveTextContent('Deal Won Sign-off');
    expect(closure.querySelector('[data-stage-change-start-approval]')).toHaveTextContent('starts an approval');
    expect(notify).toHaveTextContent('Notify Owner');
    expect(notify.querySelector('[data-stage-change-start-approval]')).toBeNull();
    expect(startsCalls(calls).map((c) => c.body)).toEqual([
      { object: OBJECT, recordId: 'd1', changes: { stage: 'won' } },
    ]);
  });

  it('empty: no flows answered draws no list, and the sentence stands alone', async () => {
    const calls = installFetch({ status: 200, body: { success: true, data: { flows: [] } } });
    const { container } = renderGrid(makeDataSource());
    await screen.findByText('beta');
    const dialog = await moveFirstRowToWon(container);
    await waitFor(() => expect(startsCalls(calls)).toHaveLength(1));
    // Let the answer land before reading that nothing was drawn for it.
    await new Promise((r) => setTimeout(r, 0));
    expect(within(dialog).queryByTestId('stage-change-starts')).toBeNull();
    expect(dialog).toHaveTextContent(SENTENCE);
  });

  it('failure: a refused read draws no list, the sentence stands, and Change still saves the move', async () => {
    const calls = installFetch({ status: 500, body: { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } } });
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await screen.findByText('beta');
    const dialog = await moveFirstRowToWon(container);
    await waitFor(() => expect(startsCalls(calls)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(within(dialog).queryByTestId('stage-change-starts')).toBeNull();
    expect(dialog).toHaveTextContent(SENTENCE);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toEqual({ stage: 'won' });
  });
});
