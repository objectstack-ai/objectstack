/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression (#1763): a direct `object-grid` schema using the spec-canonical
 * `bulkActions` key (no legacy `batchActions`) used to silently no-op — the
 * grid only read `batchActions`, so bulk actions just disappeared with no
 * error. This locks in the fallback: `bulkActions` alone must auto-enable
 * multi-select and render the bulk action button, and `batchActions` must
 * still win when both keys are set (legacy precedence).
 *
 * ⭐ Also the MEMBER pin for `object-grid`'s `batchActions` (objectui#8071).
 * The two rows #1763 left are the forwarding half — a populated legacy array
 * wins over a populated canonical one — and they are why the key is pinned
 * here rather than in a new file. What they could not say, because both
 * fixtures are non-empty: the read site is `schema.batchActions ??
 * schema.bulkActions`, and an EMPTY legacy array wins too. Half-migrated
 * metadata that moves its members to `bulkActions` and leaves
 * `batchActions: []` behind therefore loses every bulk action — the checkboxes
 * still tick, the selection bar still counts, and the buttons the author
 * declared are simply not in it. Nothing is thrown and no diagnostic names the
 * key.
 *
 * ⚠️ NOT because the coalesce is nullish. That was this pin's first reading and
 * ablation refused it: an empty array is BOTH non-nullish and truthy, so `??`
 * and `||` answer identically here — swapping one for the other leaves every
 * row below green. The emptiness survives because a declared `[]` is a VALUE,
 * and the only spelling that would drop it is an explicit length test
 * (`batchActions?.length ? batchActions : bulkActions`) — which is precisely
 * the plausible repair a reader reaches for, and precisely what the recorded
 * ablation applies to prove the row below can fail.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import type { ObjectGridSchema } from '@object-ui/types';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'os_prod_plan';

function makeDataSource() {
  const rows = [
    { id: 'r1', name: 'Plan A', status: 'draft' },
    { id: 'r2', name: 'Plan B', status: 'draft' },
  ];
  return {
    find: vi.fn(async () => ({ data: rows.map((r) => ({ ...r })), total: rows.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        status: { type: 'text' },
      },
    }),
  } as any;
}

function renderGrid(schema: ObjectGridSchema, handlers: Record<string, any> = {}) {
  return render(
    <ActionProvider handlers={handlers}>
      <ObjectGrid schema={schema} dataSource={makeDataSource()} />
    </ActionProvider>,
  );
}

async function selectAllRows() {
  await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
  const headerCheckbox = document.querySelector('thead [role="checkbox"]') as HTMLElement;
  expect(headerCheckbox).toBeTruthy();
  fireEvent.click(headerCheckbox);
}

describe('ObjectGrid — spec-canonical bulkActions key (#1763)', () => {
  it('renders bulk actions from `bulkActions` alone (no batchActions)', async () => {
    renderGrid({
      type: 'object-grid',
      objectName: OBJECT,
      bulkActions: ['approve'],
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'status', label: 'Status' },
      ],
      pagination: { pageSize: 50 },
    });

    await selectAllRows();
    expect(await screen.findByTestId('bulk-action-approve')).toBeInTheDocument();
  });

  it('keeps legacy precedence: batchActions wins when both keys are set', async () => {
    renderGrid({
      type: 'object-grid',
      objectName: OBJECT,
      batchActions: ['approve'],
      bulkActions: ['reject'],
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'status', label: 'Status' },
      ],
      pagination: { pageSize: 50 },
    });

    await selectAllRows();
    expect(await screen.findByTestId('bulk-action-approve')).toBeInTheDocument();
    expect(screen.queryByTestId('bulk-action-reject')).not.toBeInTheDocument();
  });

  it('the members of `batchActions` alone auto-enable multi-select', async () => {
    // The legacy key drives the SAME gate the canonical one does: its members
    // are what `hasBulkActions` reads, and that is what turns selection on when
    // the schema declares no `selection` object.
    renderGrid({
      type: 'object-grid',
      objectName: OBJECT,
      batchActions: ['approve'],
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'status', label: 'Status' },
      ],
      pagination: { pageSize: 50 },
    });

    await selectAllRows();
    expect(await screen.findByTestId('bulk-action-approve')).toBeInTheDocument();
  });

  it('an EMPTY `batchActions` still wins — a declared `[]` is a VALUE, not an absence', async () => {
    // The half-migrated schema. `selection` is authored so the checkboxes do
    // not depend on the very gate under test: the selection is real, the bar
    // counts it, and the action the author moved to `bulkActions` is absent.
    renderGrid({
      type: 'object-grid',
      objectName: OBJECT,
      batchActions: [],
      bulkActions: ['approve'],
      selection: { type: 'multiple' },
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'status', label: 'Status' },
      ],
      pagination: { pageSize: 50 },
    });

    await selectAllRows();
    expect(
      screen.queryByTestId('bulk-action-approve'),
      'an empty legacy array must not fall through to `bulkActions`',
    ).not.toBeInTheDocument();
  });
});

