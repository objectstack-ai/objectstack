/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27380 row 1 — a bulk action's result panel
 * reports what each record's own dispatch answered, and names every refused
 * record by its title.
 *
 * Measured on HotCRM's Leads list: "Add to Campaign", a single-record script
 * action named in the view's `bulkActions`, run over two leads of which the
 * server refuses one. These drive the REAL ObjectGrid, a real ActionProvider
 * and the real `createServerActionHandler` (the dispatch the console
 * registers as `script`) over a stubbed transport that answers per record.
 *
 * A record the server refuses answers a 4xx (the `/actions` door's rule:
 * a handler that says no throws), so the counts follow each record's answer;
 * the first case pins that. What a refusal is listed under is the record's
 * title, read the way the confirm step lists the affected records.
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ isLoaded: false, checkField: () => true, getObjectApiOperations: () => undefined, can: () => true }),
  };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { createServerActionHandler, type ServerActionFetch } from '@object-ui/core';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'crm_lead';
const ROWS = [
  { id: 'lead_1', name: 'Ada Lovelace' },
  { id: 'lead_2', name: 'Grace Hopper' },
  { id: 'lead_3', name: 'Edsger Dijkstra' },
];

/** HotCRM's shape, the keys this chain reads: a record-scoped script action. */
const ADD_TO_CAMPAIGN = {
  name: 'add_to_campaign',
  label: 'Add to Campaign',
  type: 'script',
  objectName: OBJECT,
  locations: ['list_toolbar', 'list_item'],
};

/** A transport that answers each record from `refusals` (record id → message), 200 otherwise. */
function perRecordFetch(refusals: Record<string, string>) {
  return vi.fn(async (_url: string, init: { body: string }) => {
    const { recordId } = JSON.parse(init.body) as { recordId: string };
    const refusal = refusals[recordId];
    return refusal
      ? { ok: false, status: 400, json: async () => ({ success: false, error: { code: 'VALIDATION_ERROR', message: refusal } }) }
      : { ok: true, status: 200, json: async () => ({ success: true, data: { added: 1 } }) };
  });
}

async function runOverAll(fetch: ReturnType<typeof perRecordFetch>) {
  const dataSource: any = {
    find: vi.fn(async () => ({ data: ROWS.map(r => ({ ...r })), total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      nameField: 'name',
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
      actions: [ADD_TO_CAMPAIGN],
    }),
  };
  const script = createServerActionHandler({ fetch: fetch as unknown as ServerActionFetch });
  render(
    <ActionProvider handlers={{ script }}>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: OBJECT,
          columns: [{ field: 'name', label: 'Name' }],
          pagination: { pageSize: 50 },
          bulkActions: ['add_to_campaign'],
        } as any}
        dataSource={dataSource}
      />
    </ActionProvider>,
  );
  await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
  await waitFor(() => expect(document.querySelector('thead [role="checkbox"]')).toBeTruthy());
  fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
  fireEvent.click(await screen.findByTestId('bulk-action-add_to_campaign'));
  fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(ROWS.length));
}

afterEach(() => {
  cleanup();
});

describe('bulk result reports each record’s own answer (objectstack#27380 row 1)', () => {
  it('counts the refused records apart from the ones that landed', async () => {
    const fetch = perRecordFetch({
      lead_2: 'Grace Hopper is already a member of this campaign',
      lead_3: 'Edsger Dijkstra has opted out of marketing',
    });
    await runOverAll(fetch);

    await waitFor(() => expect(screen.getByText(/Succeeded 1 \/ 3/)).toBeInTheDocument());
    expect(screen.getByText(/Failed 2/)).toBeInTheDocument();
  });

  it('lists every refusal, each under the record it refused, by that record’s title', async () => {
    const fetch = perRecordFetch({
      lead_2: 'Grace Hopper is already a member of this campaign',
      lead_3: 'Edsger Dijkstra has opted out of marketing',
    });
    await runOverAll(fetch);

    const inspector = await screen.findByTestId('bulk-error-inspector');
    const second = within(inspector).getByTestId('bulk-error-row-lead_2');
    const third = within(inspector).getByTestId('bulk-error-row-lead_3');
    expect(second).toHaveTextContent('Grace Hopper is already a member of this campaign');
    expect(third).toHaveTextContent('Edsger Dijkstra has opted out of marketing');
    // The record is named the way the confirm step named it, not by its id.
    expect(within(second).getByTestId('bulk-error-record-lead_2')).toHaveTextContent('Grace Hopper');
    expect(within(third).getByTestId('bulk-error-record-lead_3')).toHaveTextContent('Edsger Dijkstra');
    expect(within(inspector).queryByTestId('bulk-error-row-lead_1')).toBeNull();
  });

  it('reports a clean run as every record succeeded, with no refusal list', async () => {
    const fetch = perRecordFetch({});
    await runOverAll(fetch);

    await waitFor(() => expect(screen.getByText(/Succeeded 3 \/ 3/)).toBeInTheDocument());
    expect(screen.queryByTestId('bulk-error-inspector')).toBeNull();
  });
});
