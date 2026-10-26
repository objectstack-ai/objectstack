/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The bulk-action confirm step names every affected record by its display
 * title, through the ONE ADR-0079 resolver (`getRecordDisplayName`,
 * `@object-ui/core`), whatever the action's shape (objectui#12332).
 *
 * The step used to read `row[labelKey]` with `labelKey` defaulting to `'name'`
 * and no caller ever passing another one. So an object whose title field is
 * not literally `name` — HotCRM's `crm_lead`, `nameField: 'display_title'` —
 * listed its records as raw ids. The card was filed against the bare-string
 * `bulkActions` fan-out path, with an aggregate def on a different object as
 * the "correct" control; the defect follows the OBJECT, not the dispatch path,
 * and both paths are pinned here on the same object.
 *
 * Drives the real ObjectGrid + BulkActionDialog, no params on the action, so
 * the dialog opens straight on the confirm step.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
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

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADD_TO_CAMPAIGN = {
  name: 'create_campaign',
  label: 'Add to Campaign',
  type: 'api',
  target: '/api/v1/leads/enroll',
};

/** HotCRM's lead shape: the title lives in a `nameField` that is not `name`. */
const LEAD_FIELDS = {
  id: { type: 'text' },
  display_title: { type: 'formula', label: 'Display Title' },
  first_name: { type: 'text', label: 'First Name' },
  company: { type: 'text', label: 'Company' },
};
const LEAD_ROWS = [
  { id: 'NZlnBCoFRGzxCw4O', display_title: 'Mira Costa - Atlas Construction', first_name: 'Mira', company: 'Atlas Construction' },
  { id: 'Y-5E63TwqDGmfwfW', display_title: 'Kai Watanabe - Coral Reef Hotels', first_name: 'Kai', company: 'Coral Reef Hotels' },
];

function renderGrid(opts: {
  fields: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  objectExtra?: Record<string, unknown>;
  view: Record<string, unknown>;
  firstColumn: string;
}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true }),
  }));
  const dataSource: any = {
    find: vi.fn(async () => ({ data: opts.rows.map(r => ({ ...r })), total: opts.rows.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: opts.fields,
      actions: [ADD_TO_CAMPAIGN],
      ...opts.objectExtra,
    }),
  };
  render(
    <ActionProvider handlers={{}}>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: 'crm_lead',
          columns: [{ field: opts.firstColumn }, { field: 'company' }],
          pagination: { pageSize: 50 },
          ...opts.view,
        } as any}
        dataSource={dataSource}
      />
    </ActionProvider>,
  );
}

/** Select every row, click the bulk button, and return the confirm step's list. */
async function openConfirm(firstCellText: string): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByText(firstCellText)).toBeInTheDocument());
  await waitFor(() => expect(document.querySelector('thead [role="checkbox"]')).toBeTruthy());
  fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
  fireEvent.click(await screen.findByTestId('bulk-action-create_campaign'));
  await screen.findByRole('button', { name: 'Run' });
  const dialog = screen.getByRole('dialog');
  return within(dialog).getByRole('list');
}

const listed = (list: HTMLElement) =>
  within(list).getAllByRole('listitem').map(li => li.textContent?.replace(/^•\s*/, '').trim());

describe('bulk confirm step names records by display title (objectui#12332)', () => {
  it('bare-string bulkActions fan-out: lists the nameField titles, not ids', async () => {
    renderGrid({
      fields: LEAD_FIELDS,
      rows: LEAD_ROWS,
      objectExtra: { nameField: 'display_title' },
      view: { bulkActions: ['create_campaign'] },
      firstColumn: 'display_title',
    });
    const list = await openConfirm('Mira Costa - Atlas Construction');
    expect(listed(list)).toEqual([
      'Mira Costa - Atlas Construction',
      'Kai Watanabe - Coral Reef Hotels',
    ]);
  });

  it('aggregate bulkActionDefs on the same object: the same titles (one naming for both paths)', async () => {
    renderGrid({
      fields: LEAD_FIELDS,
      rows: LEAD_ROWS,
      objectExtra: { nameField: 'display_title' },
      view: { bulkActionDefs: [{ name: 'create_campaign', operation: 'custom', execution: 'aggregate' }] },
      firstColumn: 'display_title',
    });
    const list = await openConfirm('Mira Costa - Atlas Construction');
    expect(listed(list)).toEqual([
      'Mira Costa - Atlas Construction',
      'Kai Watanabe - Coral Reef Hotels',
    ]);
  });

  it('a row with no resolvable title shows its id, marked as an id', async () => {
    renderGrid({
      fields: { amount: { type: 'number' }, company: { type: 'number' } },
      rows: [{ id: 'q1', amount: 5, company: 1 }],
      view: { bulkActions: ['create_campaign'] },
      firstColumn: 'amount',
    });
    const list = await openConfirm('5');
    expect(listed(list)).toEqual(['Record #q1']);
  });

  it('CONTROL: an object titled by `name` still lists its names', async () => {
    renderGrid({
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, company: { type: 'text' } },
      rows: [{ id: 'o1', name: 'QA v18 Stage Click', company: 'Acme' }],
      view: { bulkActions: ['create_campaign'] },
      firstColumn: 'name',
    });
    const list = await openConfirm('QA v18 Stage Click');
    expect(listed(list)).toEqual(['QA v18 Stage Click']);
  });
});
